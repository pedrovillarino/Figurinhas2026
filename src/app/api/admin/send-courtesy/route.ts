import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendText, formatPhone } from '@/lib/zapi'

export const dynamic = 'force-dynamic'

// Admin-only: envia uma mensagem de cortesia/desculpa pra um user via Z-API.
// Diferente do dispatch-correction (que pede confirmação SIM/NÃO), aqui é
// envio puro de texto livre. Pensado pra mensagens de "fix de bug + cupom"
// onde o user só recebe — não há fluxo de resposta.
//
// Auth: header `x-admin-secret` = ADMIN_SECRET.
//
// POST /api/admin/send-courtesy
// Body:
//   {
//     "user_phone": "5511999741449",   // OU user_id
//     "message": "Oi, Cintia! ...",
//     "courtesy_message_label": "sorry-cintia-9e08"   // opcional, pra log/audit
//   }

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

export async function POST(req: NextRequest) {
  const provided = req.headers.get('x-admin-secret')
  const expected = process.env.ADMIN_SECRET
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const message = (body.message || '').trim()
  if (!message) {
    return NextResponse.json({ error: 'message required' }, { status: 400 })
  }

  const supabase = getAdmin()
  let userId: string | null = body.user_id || null
  let userPhone = body.user_phone || ''

  if (!userId && userPhone) {
    const cleaned = formatPhone(userPhone)
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, phone')
      .or(`phone.eq.${cleaned},phone.eq.${cleaned.replace(/^55/, '')}`)
      .maybeSingle()
    if (!profile) {
      return NextResponse.json({ error: `User not found by phone ${userPhone}` }, { status: 404 })
    }
    userId = profile.id
    userPhone = profile.phone || cleaned
  } else if (userId) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('phone')
      .eq('id', userId)
      .maybeSingle()
    if (!profile) {
      return NextResponse.json({ error: `User ${userId} not found` }, { status: 404 })
    }
    userPhone = profile.phone || ''
  } else {
    return NextResponse.json({ error: 'user_id or user_phone required' }, { status: 400 })
  }

  if (!userPhone) {
    return NextResponse.json({ error: 'user has no phone on file' }, { status: 400 })
  }

  const sent = await sendText(formatPhone(userPhone), message)
  const label = (body.courtesy_message_label || '').toString().slice(0, 80)
  console.log(
    `[admin-courtesy] sent=${sent} user_id=${userId} ` +
    `phone=${formatPhone(userPhone).slice(0, 4)}****${formatPhone(userPhone).slice(-4)} ` +
    `label=${label} msg_chars=${message.length}`,
  )
  return NextResponse.json({ ok: sent, user_id: userId })
}
