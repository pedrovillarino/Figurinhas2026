import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { cookies } from 'next/headers'

export const maxDuration = 30

const SYSTEM_INSTRUCTION = `Scanner de figurinhas Panini Copa do Mundo. Identifique números de figurinhas na foto.

REGRAS:
- "filled": figurinha colada ou individual. "empty": slot vazio.
- Use número EXATO impresso (ex: FWC-1, BRA-10, ARG-12). NÃO invente.
- confidence < 0.7 se incerto. Países em Português.
- Se não é página de álbum: {"error":"not_album_page","message":"descrição"}

Retorne APENAS JSON:
{"scan_confidence":0.9,"stickers":[{"number":"BRA-1","player_name":"Neymar","country":"Brasil","status":"filled","confidence":0.95}],"unreadable":[],"warnings":[]}`

export async function POST(request: Request) {
  try {
    // 1. Validate auth
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

    // 2. Parse request
    const body = await request.json()
    const { image, mimeType } = body as { image: string; mimeType: string }

    if (!image || !mimeType) {
      return NextResponse.json({ error: 'Imagem não enviada' }, { status: 400 })
    }

    // 3. Check Gemini API key
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey || apiKey === 'your-gemini-api-key-here') {
      return NextResponse.json(
        { error: 'Serviço de scan indisponível. Configure a GEMINI_API_KEY.' },
        { status: 503 }
      )
    }

    // 4. Call Gemini
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      systemInstruction: SYSTEM_INSTRUCTION,
    })

    const result = await model.generateContent([
      {
        inlineData: {
          mimeType,
          data: image,
        },
      },
      { text: 'Scan this album page and return the sticker inventory as JSON.' },
    ])

    const responseText = result.response.text()
    console.log('Gemini response:', responseText.substring(0, 500))

    // 5. Parse Gemini response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.log('No JSON found in response')
      return NextResponse.json(
        { error: 'Não foi possível analisar a imagem. Tente uma foto mais nítida.' },
        { status: 422 }
      )
    }

    let parsed
    try {
      parsed = JSON.parse(jsonMatch[0])
    } catch {
      console.log('Failed to parse JSON:', jsonMatch[0].substring(0, 200))
      return NextResponse.json(
        { error: 'Erro ao interpretar resposta da IA. Tente novamente.' },
        { status: 422 }
      )
    }

    // Check for error response from Gemini
    if (parsed.error) {
      const msg = parsed.error === 'not_album_page'
        ? 'Não parece ser uma página do álbum. Tente outra foto.'
        : parsed.message || 'Erro ao analisar imagem.'
      console.log('Gemini error:', parsed.error, parsed.message)
      return NextResponse.json({ error: msg }, { status: 422 })
    }

    if (!parsed.stickers || !Array.isArray(parsed.stickers)) {
      console.log('No stickers array in parsed:', Object.keys(parsed))
      return NextResponse.json(
        { error: 'Foto com pouca qualidade. Mande uma mais nítida.' },
        { status: 422 }
      )
    }

    // 6. Check confidence
    const warnings: string[] = [...(parsed.warnings || [])]
    if (parsed.scan_confidence && parsed.scan_confidence < 0.5) {
      warnings.push('Qualidade da foto baixa. Verifique os resultados com atenção.')
    }
    if (parsed.unreadable && parsed.unreadable.length > 0) {
      warnings.push(`Slots ilegíveis: ${parsed.unreadable.join(', ')}`)
    }

    // 7. Match against stickers table (use service_role to bypass RLS)
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const detectedNumbers = parsed.stickers.map((s: { number: string }) => s.number)
    const { data: dbStickers } = await supabaseAdmin
      .from('stickers')
      .select('id, number, player_name, country, section, type')
      .in('number', detectedNumbers)

    const dbMap = new Map((dbStickers || []).map((s) => [s.number, s]))

    const matched: Array<{
      sticker_id: number
      number: string
      player_name: string | null
      country: string
      status: string
    }> = []
    const unmatched: string[] = []

    for (const detected of parsed.stickers) {
      const db = dbMap.get(detected.number)
      if (db) {
        matched.push({
          sticker_id: db.id,
          number: db.number,
          player_name: db.player_name,
          country: db.country,
          status: detected.status,
        })
      } else {
        unmatched.push(detected.number)
      }
    }

    if (unmatched.length > 0) {
      warnings.push(`${unmatched.length} figurinha(s) detectada(s) mas não encontrada(s) no banco de dados: ${unmatched.join(', ')}. Pode ser número lido incorretamente pela IA.`)
    }

    // Add per-sticker low confidence warnings
    const lowConfStickers = parsed.stickers.filter((s: { confidence?: number; number: string }) => s.confidence && s.confidence < 0.7)
    if (lowConfStickers.length > 0) {
      warnings.push(`Leitura incerta: ${lowConfStickers.map((s: { number: string }) => s.number).join(', ')}. Verifique se estão corretas.`)
    }

    return NextResponse.json({
      matched,
      unmatched,
      warnings,
      confidence: parsed.scan_confidence || parsed.confidence || 'medium',
    })
  } catch (err) {
    console.error('Scan error:', err)

    const errMsg = err instanceof Error ? err.message : ''
    let message = 'Erro ao processar scan. Tente novamente.'

    if (errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('Too Many Requests')) {
      message = 'Limite de uso da API atingido. Aguarde 1 minuto e tente novamente.'
    } else if (errMsg.includes('timeout')) {
      message = 'Scan demorou muito. Tente uma foto com mais luz.'
    } else if (errMsg.includes('403') || errMsg.includes('PERMISSION_DENIED')) {
      message = 'API key sem permissão. Verifique a configuração da GEMINI_API_KEY.'
    } else if (errMsg.includes('404')) {
      message = 'Modelo de IA indisponível. Tente novamente em instantes.'
    }

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
