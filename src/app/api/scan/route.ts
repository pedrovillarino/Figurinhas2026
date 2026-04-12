import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { cookies } from 'next/headers'

export const maxDuration = 30

const SYSTEM_INSTRUCTION = `You are a Panini FIFA World Cup 2026 sticker album scanner.
Analyze the photo of an album page, individual stickers, or multiple stickers on a table.

For each sticker visible, determine:
- The sticker number EXACTLY as printed (e.g. "FWC-1", "BRA-10", "ARG-12")
- The player name if readable
- The country/team name in Portuguese
- Whether it is "filled" (sticker is pasted in album or is a loose sticker) or "empty" (empty slot showing placeholder)
- Your confidence for that specific sticker (0.0 to 1.0)

Return ONLY valid JSON in this exact format:
{
  "scan_confidence": 0.9,
  "stickers": [
    {"number": "BRA-1", "player_name": "Neymar Jr.", "country": "Brasil", "status": "filled", "confidence": 0.95}
  ],
  "unreadable": ["position descriptions of slots you cannot read"],
  "warnings": []
}

CRITICAL RULES:
- Read the EXACT number printed on each sticker or slot. Do NOT guess or invent numbers.
- Sticker numbers follow patterns like: FWC-1, BRA-10, ARG-12, GER-5, etc (COUNTRY_CODE-NUMBER)
- If you see a loose sticker (not in album), it is always "filled"
- If the image is blurry or not related to stickers: {"error": "not_album_page", "message": "description"}
- Set confidence below 0.7 for any number you're not sure about
- Country names must be in Portuguese (Brasil, Alemanha, Argentina, França, etc)
- Look carefully at ALL stickers in the image, don't miss any`

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
      model: 'gemini-2.5-flash',
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
    let message = 'Algo deu errado no scan. Tente novamente.'
    let status = 500

    if (errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('Too Many Requests') || errMsg.includes('RESOURCE_EXHAUSTED')) {
      message = 'Muitos scans ao mesmo tempo! Espere um minutinho e tente de novo. ☕'
      status = 429
    } else if (errMsg.includes('timeout') || errMsg.includes('DEADLINE_EXCEEDED')) {
      message = 'O scan demorou demais. Tente uma foto com melhor iluminação e mais perto das figurinhas. 📷'
    } else if (errMsg.includes('403') || errMsg.includes('PERMISSION_DENIED')) {
      message = 'Serviço de scan temporariamente indisponível. Tente novamente mais tarde.'
      status = 503
    } else if (errMsg.includes('404') || errMsg.includes('not found')) {
      message = 'Serviço de scan em manutenção. Tente novamente em alguns minutos.'
      status = 503
    } else if (errMsg.includes('500') || errMsg.includes('INTERNAL')) {
      message = 'O serviço de scan está instável. Tente novamente em instantes.'
    }

    return NextResponse.json({ error: message }, { status })
  }
}
