import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { cookies } from 'next/headers'

export const maxDuration = 30

const LIST_INSTRUCTION = `Você é um leitor de listas de figurinhas Panini da Copa do Mundo.

Você vai receber uma foto de uma lista escrita à mão, impressa, ou screenshot de uma lista de figurinhas.

Sua tarefa: extrair TODOS os códigos/números de figurinhas visíveis na imagem.

REGRAS:
- Figurinhas seguem o padrão: CÓDIGO-NÚMERO (ex: BRA-1, ARG-12, FWC-3, QAT-7)
- Podem aparecer só números (ex: 1, 15, 234) — retorne como estão
- Podem aparecer agrupados por país (ex: "Brasil: 1, 3, 5" → BRA-1, BRA-3, BRA-5)
- Ignore texto que não seja código de figurinha (títulos, decorações, nomes de pessoas)
- Se a imagem não contém uma lista de figurinhas, retorne erro

Retorne APENAS JSON válido:
{
  "numbers": ["BRA-1", "BRA-2", "ARG-5"],
  "confidence": "high" | "medium" | "low",
  "warnings": []
}

Se não for uma lista:
{"error": "not_a_list", "message": "Descrição do problema"}`

export async function POST(request: Request) {
  try {
    // 1. Auth
    const cookieStore = cookies()
    const supabaseAuth = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll() },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              )
            } catch {}
          },
        },
      }
    )
    const { data: { user } } = await supabaseAuth.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }

    const body = await request.json()
    const { image, mimeType, text } = body as {
      image?: string
      mimeType?: string
      text?: string
    }

    let extractedNumbers: string[] = []
    const warnings: string[] = []

    if (text) {
      // ─── TEXT MODE: parse sticker numbers from text ───
      extractedNumbers = parseTextList(text)
      if (extractedNumbers.length === 0) {
        return NextResponse.json(
          { error: 'Nenhum número de figurinha encontrado no texto. Use o formato: BRA-1, BRA-2 ou 1, 2, 3' },
          { status: 422 }
        )
      }
    } else if (image && mimeType) {
      // ─── IMAGE MODE: use Gemini to read the list ───
      const apiKey = process.env.GEMINI_API_KEY
      if (!apiKey || apiKey === 'your-gemini-api-key-here') {
        return NextResponse.json(
          { error: 'Serviço de leitura indisponível. Configure a GEMINI_API_KEY.' },
          { status: 503 }
        )
      }

      const genAI = new GoogleGenerativeAI(apiKey)
      const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        systemInstruction: LIST_INSTRUCTION,
      })

      const result = await model.generateContent([
        { inlineData: { mimeType, data: image } },
        { text: 'Leia todos os códigos de figurinhas desta lista e retorne como JSON.' },
      ])

      const responseText = result.response.text()
      const jsonMatch = responseText.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        return NextResponse.json(
          { error: 'Não foi possível ler a lista. Tente uma foto mais nítida.' },
          { status: 422 }
        )
      }

      let parsed
      try {
        parsed = JSON.parse(jsonMatch[0])
      } catch {
        return NextResponse.json(
          { error: 'Erro ao interpretar a lista. Tente novamente.' },
          { status: 422 }
        )
      }

      if (parsed.error) {
        return NextResponse.json(
          { error: parsed.message || 'Não parece ser uma lista de figurinhas.' },
          { status: 422 }
        )
      }

      if (!parsed.numbers || !Array.isArray(parsed.numbers)) {
        return NextResponse.json(
          { error: 'Nenhuma figurinha encontrada na imagem.' },
          { status: 422 }
        )
      }

      extractedNumbers = parsed.numbers
      if (parsed.warnings) warnings.push(...parsed.warnings)
      if (parsed.confidence === 'low') {
        warnings.push('Qualidade da foto baixa. Verifique os resultados.')
      }
    } else {
      return NextResponse.json({ error: 'Envie uma imagem ou texto.' }, { status: 400 })
    }

    // ─── Match against stickers table ───
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // Normalize: remove spaces, uppercase
    const normalized = extractedNumbers.map((n) => n.trim().toUpperCase())

    const { data: dbStickers } = await supabaseAdmin
      .from('stickers')
      .select('id, number, player_name, country')

    if (!dbStickers) {
      return NextResponse.json({ error: 'Erro ao carregar figurinhas.' }, { status: 500 })
    }

    // Build lookup maps: exact match + number-only match
    const exactMap = new Map(dbStickers.map((s) => [s.number.toUpperCase(), s]))
    // For bare numbers like "1", "23", try matching against the numeric part
    const numberPartMap = new Map<string, typeof dbStickers>()
    dbStickers.forEach((s) => {
      const parts = s.number.split('-')
      if (parts.length === 2) {
        const num = parts[1]
        if (!numberPartMap.has(num)) numberPartMap.set(num, [])
        numberPartMap.get(num)!.push(s)
      }
    })

    const matched: Array<{ sticker_id: number; number: string; player_name: string | null; country: string }> = []
    const unmatched: string[] = []

    for (const num of normalized) {
      if (!num) continue
      const exact = exactMap.get(num)
      if (exact) {
        matched.push({ sticker_id: exact.id, number: exact.number, player_name: exact.player_name, country: exact.country })
      } else {
        // Try bare number match (only if it produces exactly 1 result to avoid ambiguity)
        const bareNum = num.replace(/^[^0-9]*/, '')
        const candidates = numberPartMap.get(bareNum)
        if (candidates && candidates.length === 1) {
          const s = candidates[0]
          matched.push({ sticker_id: s.id, number: s.number, player_name: s.player_name, country: s.country })
        } else {
          unmatched.push(num)
        }
      }
    }

    if (unmatched.length > 0) {
      warnings.push(`${unmatched.length} código(s) não encontrado(s): ${unmatched.slice(0, 10).join(', ')}${unmatched.length > 10 ? '...' : ''}`)
    }

    return NextResponse.json({ matched, unmatched, warnings, total: extractedNumbers.length })
  } catch (err) {
    console.error('Import list error:', err)
    return NextResponse.json({ error: 'Erro ao processar lista. Tente novamente.' }, { status: 500 })
  }
}

/** Parse a text string into sticker numbers */
function parseTextList(text: string): string[] {
  // Normalize line breaks and common separators
  const cleaned = text
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/;/g, ',')
    .replace(/\|/g, ',')

  const numbers: string[] = []
  const lines = cleaned.split('\n')

  // Detect if lines are grouped by country: "Brasil: 1, 3, 5" or "BRA: 1, 3, 5"
  const countryPrefixRegex = /^([A-Za-zÀ-ú\s]+)[:–\-]\s*(.+)$/

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const countryMatch = trimmed.match(countryPrefixRegex)
    if (countryMatch) {
      const prefix = countryMatch[1].trim()
      const rest = countryMatch[2]
      // Extract numbers/codes from the rest
      const codes = rest.split(/[,\s]+/).filter(Boolean)
      for (const code of codes) {
        const c = code.trim().replace(/[()]/g, '')
        if (!c) continue
        // If code already has a dash (like BRA-1), use as-is
        if (c.includes('-')) {
          numbers.push(c)
        } else {
          // Prepend prefix if it looks like a country code
          const upperPrefix = prefix.toUpperCase().replace(/\s+/g, '')
          if (upperPrefix.length <= 4) {
            numbers.push(`${upperPrefix}-${c}`)
          } else {
            numbers.push(c)
          }
        }
      }
    } else {
      // Just split by common separators
      const codes = trimmed.split(/[,\s]+/).filter(Boolean)
      for (const code of codes) {
        const c = code.trim().replace(/[()]/g, '')
        if (c && /[A-Za-z0-9]/.test(c)) {
          numbers.push(c)
        }
      }
    }
  }

  return numbers
}
