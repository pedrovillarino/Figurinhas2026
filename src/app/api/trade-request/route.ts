import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { sendText, formatPhone } from '@/lib/zapi'
import { cookies } from 'next/headers'

export const maxDuration = 30
import { randomBytes } from 'crypto'

export const dynamic = 'force-dynamic'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.completeai.com.br'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/**
 * POST /api/trade-request
 *
 * Creates a trade request from the authenticated user to another user.
 * Sends approval notification via WhatsApp and/or creates in-app pending request.
 *
 * Body: { target_user_id: string, they_have: number, i_have: number, match_score: number }
 */
export async function POST(req: NextRequest) {
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

    const { target_user_id, they_have, i_have, match_score } = await req.json()

    if (!target_user_id) {
      return NextResponse.json({ error: 'target_user_id obrigatório' }, { status: 400 })
    }

    if (target_user_id === user.id) {
      return NextResponse.json({ error: 'Não é possível solicitar troca consigo mesmo' }, { status: 400 })
    }

    const admin = getAdmin()

    // 2. Check for existing pending request
    const { data: existing } = await admin
      .from('trade_requests')
      .select('id')
      .eq('requester_id', user.id)
      .eq('target_id', target_user_id)
      .eq('status', 'pending')
      .single()

    if (existing) {
      return NextResponse.json({ error: 'Você já tem uma solicitação pendente para este usuário.' }, { status: 409 })
    }

    // 3. Get both profiles
    const [{ data: requesterProfile }, { data: targetProfile }] = await Promise.all([
      admin.from('profiles').select('display_name, location_lat, location_lng').eq('id', user.id).single(),
      admin.from('profiles').select('display_name, phone, location_lat, location_lng, notify_channel').eq('id', target_user_id).single(),
    ])

    if (!targetProfile) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })
    }

    // 4. Calculate distance
    let distance: number | null = null
    if (requesterProfile?.location_lat && requesterProfile?.location_lng &&
        targetProfile.location_lat && targetProfile.location_lng) {
      distance = Math.round(haversine(
        requesterProfile.location_lat, requesterProfile.location_lng,
        targetProfile.location_lat, targetProfile.location_lng
      ) * 10) / 10
    }

    // 5. Generate unique token for WhatsApp approve/reject links
    const token = randomBytes(24).toString('hex')

    // 6. Insert trade request
    const { data: tradeReq, error: insertError } = await admin
      .from('trade_requests')
      .insert({
        requester_id: user.id,
        target_id: target_user_id,
        status: 'pending',
        match_score: match_score || 0,
        they_have: they_have || 0,
        i_have: i_have || 0,
        distance_km: distance,
        token,
      })
      .select('id')
      .single()

    if (insertError) {
      console.error('Insert trade request error:', insertError)
      // Unique constraint violation = duplicate pending request
      if (insertError.code === '23505') {
        return NextResponse.json({ error: 'Solicitação já existe para este usuário.' }, { status: 409 })
      }
      return NextResponse.json({ error: 'Erro ao criar solicitação.' }, { status: 500 })
    }

    // 7. Send WhatsApp notification to target user
    const requesterName = requesterProfile?.display_name?.split(' ')[0] || 'Alguém'
    const distStr = distance != null ? (distance < 1 ? 'menos de 1km' : `${Math.round(distance)}km`) : 'sua região'
    const totalTrade = (they_have || 0) + (i_have || 0)

    const channel = targetProfile.notify_channel || 'whatsapp'
    const phone = targetProfile.phone ? formatPhone(targetProfile.phone) : null

    if (phone && (channel === 'whatsapp' || channel === 'both')) {
      const approveUrl = `${APP_URL}/trade-approve?token=${token}&action=approve`
      const rejectUrl = `${APP_URL}/trade-approve?token=${token}&action=reject`

      const msg =
        `🔔 *Solicitação de troca!*\n\n` +
        `*${requesterName}* (a ${distStr} de você) quer trocar figurinhas!\n\n` +
        `📊 Potencial: *${totalTrade} figurinhas* para trocar\n` +
        `   • ${they_have || 0} que você precisa\n` +
        `   • ${i_have || 0} que você tem pra dar\n\n` +
        `✅ *Aceitar* (compartilhar seu contato):\n${approveUrl}\n\n` +
        `❌ *Recusar*:\n${rejectUrl}\n\n` +
        `Ou abra o app para ver detalhes:\n${APP_URL}/trades`

      await sendText(phone, msg).catch((err: unknown) => {
        console.error('WhatsApp notification error:', err)
      })
    }

    return NextResponse.json({
      ok: true,
      request_id: tradeReq.id,
      whatsapp_sent: !!(phone && (channel === 'whatsapp' || channel === 'both')),
    })
  } catch (err) {
    console.error('Trade request error:', err)
    return NextResponse.json({ error: 'Erro ao processar solicitação.' }, { status: 500 })
  }
}
