import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendText, formatPhone } from '@/lib/zapi'

export const dynamic = 'force-dynamic'

// Admin-only: enfileira uma correção e envia o WhatsApp pedindo SIM/NÃO.
// Auth: header `x-admin-secret` igual a ADMIN_PANEL_SECRET (mesmo do /admin).
//
// POST /api/admin/dispatch-correction
// Body:
//   {
//     "user_phone": "5521997838210",         // ou "user_id": "uuid"
//     "wrong_sticker_number": "ESP-19",      // ou "wrong_sticker_id": 234
//     "correct_sticker_number": "CC-1",      // ou "correct_sticker_id": 1067
//     "scans_bonus": 5,                       // padrão 0
//     "reason": "bug Coca-Cola: scan marcou cromo CC como cromo normal" // opcional
//   }

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

export async function POST(req: NextRequest) {
  // Auth via shared secret (ADMIN_PANEL_SECRET — mesmo usado em /admin).
  // Mantém o endpoint protegido sem precisar de sessão de auth.
  const provided = req.headers.get('x-admin-secret')
  const expected = process.env.ADMIN_PANEL_SECRET
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

  let wrong, correct
  try {
    wrong = await resolveSticker(body.wrong_sticker_number, body.wrong_sticker_id, 'wrong')
    correct = await resolveSticker(body.correct_sticker_number, body.correct_sticker_id, 'correct')
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }

  const scansBonus = Number(body.scans_bonus) || 0
  const reason = body.reason || null

  // Insert pending correction
  const { data: pc, error: insertErr } = await supabase
    .from('pending_corrections')
    .insert({
      user_id: userId,
      phone: userPhone,
      wrong_sticker_id: wrong.id,
      correct_sticker_id: correct.id,
      scans_bonus: scansBonus,
      reason,
    })
    .select('id, expires_at')
    .single()

  if (insertErr || !pc) {
    return NextResponse.json({ error: `Insert failed: ${insertErr?.message}` }, { status: 500 })
  }

  // Build the message — tom: auditoria interna + pedido de desculpas no fim
  const firstName = displayName?.split(' ')[0] || ''
  const greeting = firstName ? `Oi, *${firstName}*!` : 'Oi!'
  const isCocaToNormal = correct.section === 'Coca-Cola'
  const explainer = isCocaToNormal
    ? `No nosso processo interno de auditoria do álbum identificamos que um cromo *Coca-Cola* seu pode ter sido registrado como cromo normal do país.`
    : `No nosso processo interno de auditoria identificamos um cromo seu que foi registrado errado.`

  const msg =
    `${greeting} 👋\n\n` +
    `${explainer}\n\n` +
    `📋 *Detectamos no seu álbum:*\n` +
    `❌ Marcado como: *${wrong.number}* ${wrong.player_name}\n` +
    `✅ Deveria ser: *${correct.number}* ${correct.player_name}` +
    (isCocaToNormal ? ` _(Coca-Cola)_` : '') + `\n\n` +
    `Posso corrigir agora? Responde *SIM* ou *NÃO*.\n\n` +
    (scansBonus > 0
      ? `🎁 *Como pedido de desculpas pelo erro, vou te dar +${scansBonus} scans grátis na conta assim que confirmar.*\n\n`
      : '') +
    `_(Se não responder em 7 dias, não faço nada e mantenho como está.)_`

  const sent = await sendText(formatPhone(userPhone), msg)

  return NextResponse.json({
    ok: true,
    pending_correction_id: pc.id,
    user_id: userId,
    phone: userPhone,
    wrong: `${wrong.number} ${wrong.player_name}`,
    correct: `${correct.number} ${correct.player_name}`,
    scans_bonus: scansBonus,
    expires_at: pc.expires_at,
    message_sent: sent,
  })
}
