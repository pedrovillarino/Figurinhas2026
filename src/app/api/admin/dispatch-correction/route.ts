import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendText, formatPhone } from '@/lib/zapi'

export const dynamic = 'force-dynamic'

// Admin-only: enfileira correção(ões) e envia o WhatsApp pedindo SIM/NÃO.
// Auth: header `x-admin-secret` igual a ADMIN_SECRET (mesmo do /admin).
//
// POST /api/admin/dispatch-correction
// Body (single correction):
//   {
//     "user_phone": "5521997838210",
//     "wrong_sticker_number": "ESP-19",
//     "correct_sticker_number": "CC-1",
//     "scans_bonus": 5,
//     "reason": "bug Coca-Cola"
//   }
//
// Body (bundle — múltiplas correções, uma única mensagem agregada):
//   {
//     "user_phone": "5521997838210",
//     "scans_bonus": 5,                      // total pro bundle inteiro
//     "reason": "bug Coca-Cola scan",
//     "corrections": [
//       { "wrong_sticker_number": "ESP-15", "correct_sticker_number": "CC-1" },
//       { "wrong_sticker_number": "URU-10", "correct_sticker_number": "CC-6" }
//     ]
//   }

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

export async function POST(req: NextRequest) {
  // Auth via shared secret (ADMIN_SECRET — mesmo usado em /admin).
  // Mantém o endpoint protegido sem precisar de sessão de auth.
  const provided = req.headers.get('x-admin-secret')
  const expected = process.env.ADMIN_SECRET
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const supabase = getAdmin()

  // Resolve user
  let userId: string | null = body.user_id || null
  let userPhone = body.user_phone || ''
  let displayName = ''

  if (!userId && userPhone) {
    const cleanedPhone = formatPhone(userPhone)
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, phone, display_name')
      .or(`phone.eq.${cleanedPhone},phone.eq.${cleanedPhone.replace(/^55/, '')}`)
      .maybeSingle()
    if (!profile) {
      return NextResponse.json({ error: `User not found by phone ${userPhone}` }, { status: 404 })
    }
    userId = profile.id
    userPhone = profile.phone || cleanedPhone
    displayName = profile.display_name || ''
  } else if (userId) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('phone, display_name')
      .eq('id', userId)
      .maybeSingle()
    if (!profile) {
      return NextResponse.json({ error: `User ${userId} not found` }, { status: 404 })
    }
    userPhone = profile.phone || ''
    displayName = profile.display_name || ''
  } else {
    return NextResponse.json({ error: 'user_phone or user_id required' }, { status: 400 })
  }

  if (!userPhone) {
    return NextResponse.json({ error: 'User has no phone — cannot dispatch via WhatsApp' }, { status: 400 })
  }

  // Resolve stickers
  async function resolveSticker(number: string | undefined, id: number | undefined, label: string) {
    if (id) {
      const { data } = await supabase.from('stickers').select('id, number, player_name, section').eq('id', id).maybeSingle()
      if (!data) throw new Error(`${label} sticker_id=${id} not found`)
      return data
    }
    if (number) {
      const { data } = await supabase.from('stickers').select('id, number, player_name, section').eq('number', number.toUpperCase()).maybeSingle()
      if (!data) throw new Error(`${label} sticker number="${number}" not found`)
      return data
    }
    throw new Error(`${label}: must provide ${label}_sticker_number or ${label}_sticker_id`)
  }

  // Normalize: aceita bundle (corrections: [...]) ou single (campos no root)
  type RawCorrection = {
    wrong_sticker_number?: string
    wrong_sticker_id?: number
    correct_sticker_number?: string
    correct_sticker_id?: number
  }
  const rawList: RawCorrection[] = Array.isArray(body.corrections) && body.corrections.length > 0
    ? body.corrections
    : [{
        wrong_sticker_number: body.wrong_sticker_number,
        wrong_sticker_id: body.wrong_sticker_id,
        correct_sticker_number: body.correct_sticker_number,
        correct_sticker_id: body.correct_sticker_id,
      }]

  if (rawList.length === 0) {
    return NextResponse.json({ error: 'no corrections to dispatch' }, { status: 400 })
  }

  // Resolve all stickers
  type ResolvedCorrection = { wrong: { id: number; number: string; player_name: string; section: string }, correct: { id: number; number: string; player_name: string; section: string } }
  const resolved: ResolvedCorrection[] = []
  try {
    for (const c of rawList) {
      const wrong = await resolveSticker(c.wrong_sticker_number, c.wrong_sticker_id, 'wrong')
      const correct = await resolveSticker(c.correct_sticker_number, c.correct_sticker_id, 'correct')
      resolved.push({ wrong, correct })
    }
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }

  const totalScansBonus = Number(body.scans_bonus) || 0
  const reason = body.reason || null

  // Insert one pending_correction row per item.
  // O bonus total fica na PRIMEIRA correção; as demais ficam com 0.
  // O webhook handler soma todos os bonuses do bundle ao aplicar.
  const rows = resolved.map((r, idx) => ({
    user_id: userId,
    phone: userPhone,
    wrong_sticker_id: r.wrong.id,
    correct_sticker_id: r.correct.id,
    scans_bonus: idx === 0 ? totalScansBonus : 0,
    reason,
  }))

  const { data: inserted, error: insertErr } = await supabase
    .from('pending_corrections')
    .insert(rows)
    .select('id, expires_at')

  if (insertErr || !inserted || inserted.length === 0) {
    return NextResponse.json({ error: `Insert failed: ${insertErr?.message}` }, { status: 500 })
  }

  // Build aggregated message — tom: auditoria interna + pedido de desculpas no fim
  const firstName = displayName?.split(' ')[0] || ''
  const greeting = firstName ? `Oi, *${firstName}*!` : 'Oi!'
  const allCoca = resolved.every((r) => r.correct.section === 'Coca-Cola')
  const explainer = allCoca
    ? `No nosso processo interno de auditoria do álbum identificamos que ${resolved.length === 1 ? 'um cromo' : 'alguns cromos'} *Coca-Cola* ${resolved.length === 1 ? 'seu pode ter sido registrado' : 'seus podem ter sido registrados'} como ${resolved.length === 1 ? 'cromo normal' : 'cromos normais'} do país.`
    : `No nosso processo interno de auditoria identificamos ${resolved.length === 1 ? 'um cromo seu que foi registrado errado' : `${resolved.length} cromos seus que foram registrados errados`}.`

  const items = resolved
    .map((r, i) => {
      const tag = allCoca ? ' _(Coca-Cola)_' : ''
      const prefix = resolved.length > 1 ? `*${i + 1}.* ` : ''
      return `${prefix}❌ Marcado como: *${r.wrong.number}* ${r.wrong.player_name}\n   ✅ Deveria ser: *${r.correct.number}* ${r.correct.player_name}${tag}`
    })
    .join('\n\n')

  const askVerb = resolved.length === 1 ? 'corrigir' : 'corrigir todos'
  const msg =
    `${greeting} 👋\n\n` +
    `${explainer}\n\n` +
    `📋 *Detectamos no seu álbum:*\n${items}\n\n` +
    `Posso ${askVerb} agora? Responde *SIM* ou *NÃO*.\n\n` +
    (totalScansBonus > 0
      ? `🎁 *Como pedido de desculpas pelo erro, vou te dar +${totalScansBonus} scans grátis na conta assim que confirmar.*\n\n`
      : '') +
    `_(Se não responder em 7 dias, não faço nada e mantenho como está.)_`

  // Permite preview (não envia, só retorna a mensagem) com ?preview=1
  const url = new URL(req.url)
  const previewMode = url.searchParams.get('preview') === '1'

  let sent = false
  if (!previewMode) {
    sent = await sendText(formatPhone(userPhone), msg)
  } else {
    // Em preview, deletar as rows criadas (não queremos pendentes fantasmas)
    await supabase
      .from('pending_corrections')
      .delete()
      .in('id', (inserted as Array<{ id: number }>).map((r) => r.id))
  }

  return NextResponse.json({
    ok: true,
    preview: previewMode,
    pending_correction_ids: previewMode ? [] : (inserted as Array<{ id: number }>).map((r) => r.id),
    user_id: userId,
    phone: userPhone,
    corrections: resolved.map((r) => ({
      wrong: `${r.wrong.number} ${r.wrong.player_name}`,
      correct: `${r.correct.number} ${r.correct.player_name}`,
    })),
    scans_bonus: totalScansBonus,
    message: msg,
    message_sent: sent,
  })
}
