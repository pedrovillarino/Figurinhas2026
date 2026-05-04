import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { sendText, formatPhone } from '@/lib/zapi'
import { sendPushToUser } from '@/lib/push'
import { sendEmail, tradeRequestEmailHtml } from '@/lib/email'
import { cookies } from 'next/headers'
import { checkRateLimit, getIp, tradeLimiter } from '@/lib/ratelimit'
import { createPerfLogger } from '@/lib/perf'
import { getTradeLimit } from '@/lib/tiers'
import type { Tier } from '@/lib/tiers'
import { trackEvent, trackEventOnce, FUNNEL_EVENTS } from '@/lib/funnel'

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
  // Rate limit
  const rlResponse = await checkRateLimit(getIp(req), tradeLimiter)
  if (rlResponse) return rlResponse

  const perf = createPerfLogger('trade-request')

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

    if (!target_user_id || typeof target_user_id !== 'string') {
      return NextResponse.json({ error: 'target_user_id obrigatório' }, { status: 400 })
    }

    if (target_user_id === user.id) {
      return NextResponse.json({ error: 'Não é possível solicitar troca consigo mesmo' }, { status: 400 })
    }

    // Pedro 2026-05-04: client values são ignorados — server calcula
    // os reais abaixo (após carregar profiles). Mantém só pra logging.
    void they_have
    void i_have
    void match_score

    const admin = getAdmin()

    // 1.5. Check if requester is a minor (blocked from trades) + get tier for limit check
    const { data: requesterCheck } = await admin
      .from('profiles')
      .select('is_minor, tier')
      .eq('id', user.id)
      .single()

    if (requesterCheck?.is_minor) {
      return NextResponse.json({ error: 'Trocas não disponíveis para menores de 18 anos.' }, { status: 403 })
    }

    // 1.6. Check and increment trade usage (enforces tier limit + purchased credits)
    const userTier = (requesterCheck?.tier || 'free') as Tier
    const tierTradeLimit = getTradeLimit(userTier)
    const pTierLimit = tierTradeLimit === Infinity ? -1 : tierTradeLimit

    const { data: usageData, error: usageError } = await admin.rpc('increment_trade_usage', {
      p_user_id: user.id,
      p_tier_limit: pTierLimit,
    })

    if (usageError) {
      console.error('[trade-request] Usage check error:', usageError.message)
      // Don't block on usage tracking errors — log and continue
    } else if (usageData && !usageData.allowed) {
      // Funnel: trade limit hit
      trackEvent(user.id, FUNNEL_EVENTS.TRADE_LIMIT_HIT, {
        tier: userTier,
        metadata: { current: usageData.current, limit: usageData.limit },
      })
      return NextResponse.json(
        { error: 'Você atingiu o limite de trocas do seu plano. Faça upgrade ou compre um pacote extra.', needsPack: true },
        { status: 429 }
      )
    }

    // Funnel: trade accepted
    trackEventOnce(user.id, FUNNEL_EVENTS.FIRST_TRADE, { tier: userTier })
    trackEvent(user.id, FUNNEL_EVENTS.TRADE_USED, { tier: userTier })

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
      admin.from('profiles').select('display_name, phone, email, location_lat, location_lng, notify_channel').eq('id', target_user_id).single(),
    ])

    if (!targetProfile) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })
    }

    // 3.5. ⚠️ Validação BILATERAL real (Pedro 2026-05-04 caso Nathallya):
    // antes confiávamos nos valores que o client mandava — bug permitia
    // pedido com i_have=0 (nada pra dar). Agora server calcula sozinho.
    // Query inline pega user_stickers dos 2 e calcula o match em memória.
    const { data: pairRows } = await admin
      .from('user_stickers')
      .select('sticker_id, status, user_id')
      .in('user_id', [user.id, target_user_id])
      .in('status', ['owned', 'duplicate'])
    type PairRow = { sticker_id: number; status: string; user_id: string }
    const pairList = (pairRows || []) as PairRow[]
    const reqDup = new Set(pairList.filter((r) => r.user_id === user.id && r.status === 'duplicate').map((r) => r.sticker_id))
    const reqHave = new Set(pairList.filter((r) => r.user_id === user.id).map((r) => r.sticker_id))
    const tgtDup = new Set(pairList.filter((r) => r.user_id === target_user_id && r.status === 'duplicate').map((r) => r.sticker_id))
    const tgtHave = new Set(pairList.filter((r) => r.user_id === target_user_id).map((r) => r.sticker_id))
    const realIHave = Array.from(reqDup).filter((id) => !tgtHave.has(id)).length
    const realTheyHave = Array.from(tgtDup).filter((id) => !reqHave.has(id)).length

    if (realIHave === 0 || realTheyHave === 0) {
      console.warn(`[trade-request] BLOCKED unilateral: requester=${user.id} target=${target_user_id} i_have=${realIHave} they_have=${realTheyHave}`)
      return NextResponse.json({
        error: realIHave === 0
          ? 'Você não tem figurinhas que esse usuário precisa pra trocar. Trocas exigem que ambos tenham figurinhas pra dar.'
          : 'Esse usuário não tem figurinhas que você precisa pra trocar.',
        unilateral: true,
      }, { status: 400 })
    }
    // Sobrescreve os valores recebidos do client com os reais
    const realMatchScore = realIHave + realTheyHave

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
    // Expire in 7 days
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

    const { data: tradeReq, error: insertError } = await admin
      .from('trade_requests')
      .insert({
        requester_id: user.id,
        target_id: target_user_id,
        status: 'pending',
        match_score: realMatchScore, // server-side, não confia client
        they_have: realTheyHave,
        i_have: realIHave,
        distance_km: distance,
        token,
        expires_at: expiresAt,
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
    const totalTrade = realTheyHave + realIHave

    const channel = targetProfile.notify_channel || 'whatsapp'
    const phone = targetProfile.phone ? formatPhone(targetProfile.phone) : null

    // Fire notifications in background (non-blocking)
    const whatsappSent = !!(phone && (channel === 'whatsapp' || channel === 'both'))
    const notifyAsync = async () => {
      const notifications: Promise<unknown>[] = []

      if (whatsappSent) {
        const approveUrl = `${APP_URL}/trade-approve?token=${token}&action=approve`
        const rejectUrl = `${APP_URL}/trade-approve?token=${token}&action=reject`

        const msg =
          `🔔 *Solicitação de troca!*\n\n` +
          `*${requesterName}* (a ${distStr} de você) quer trocar figurinhas!\n\n` +
          `📊 Potencial: *${totalTrade} figurinhas* para trocar\n` +
          `   • ${realTheyHave} que você precisa\n` +
          `   • ${realIHave} que você tem pra dar\n\n` +
          `✅ *Aceitar* (compartilhar seu contato):\n${approveUrl}\n\n` +
          `❌ *Recusar*:\n${rejectUrl}\n\n` +
          `Ou abra o app para ver detalhes:\n${APP_URL}/trades`

        notifications.push(sendText(phone, msg))
      }

      // Email notification to target user
      const targetEmail = targetProfile.email
      if (targetEmail && (channel === 'email' || channel === 'both' || !phone)) {
        const approveUrl = `${APP_URL}/trade-approve?token=${token}&action=approve`
        const rejectUrl = `${APP_URL}/trade-approve?token=${token}&action=reject`
        const html = tradeRequestEmailHtml(
          requesterName, distStr, totalTrade,
          realTheyHave, realIHave,
          approveUrl, rejectUrl, APP_URL
        )
        notifications.push(sendEmail(targetEmail, `🔔 ${requesterName} quer trocar figurinhas com você!`, html))
      }

      // Push notification to target user
      notifications.push(sendPushToUser(target_user_id, {
        title: '🔔 Solicitação de troca!',
        body: `${requesterName} (a ${distStr}) quer trocar ${totalTrade} figurinhas com você!`,
        url: '/trades',
      }))

      await Promise.allSettled(notifications)
    }
    notifyAsync().catch(err => console.error('Async trade-request notification error:', err))

    perf.end({ whatsapp: whatsappSent ? 1 : 0 })

    return NextResponse.json({
      ok: true,
      request_id: tradeReq.id,
      whatsapp_sent: !!(phone && (channel === 'whatsapp' || channel === 'both')),
    })
  } catch (err) {
    perf.end({ error: 'true' })
    console.error('Trade request error:', err)
    return NextResponse.json({ error: 'Erro ao processar solicitação.' }, { status: 500 })
  }
}
