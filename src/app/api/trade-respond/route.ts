import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { sendText, formatPhone } from '@/lib/zapi'
import { sendPushToUser } from '@/lib/push'
import { sendEmail, tradeApprovedEmailHtml, tradeRejectedEmailHtml } from '@/lib/email'
import { cookies } from 'next/headers'
import { checkRateLimit, getIp, tradeLimiter } from '@/lib/ratelimit'

export const maxDuration = 30

export const dynamic = 'force-dynamic'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.completeai.com.br'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * POST /api/trade-respond
 *
 * Responds to a trade request (approve/reject).
 * Can be called:
 *  - From the app (authenticated user)
 *  - Via token link (from WhatsApp)
 *
 * Body: { request_id?: string, token?: string, action: 'approve' | 'reject' }
 */
export async function POST(req: NextRequest) {
  const rlResponse = await checkRateLimit(getIp(req), tradeLimiter)
  if (rlResponse) return rlResponse

  try {
    const { request_id, token, action } = await req.json()

    if (!action || !['approve', 'reject'].includes(action)) {
      return NextResponse.json({ error: 'Ação inválida. Use "approve" ou "reject".' }, { status: 400 })
    }

    if (!request_id && !token) {
      return NextResponse.json({ error: 'request_id ou token obrigatório.' }, { status: 400 })
    }

    const admin = getAdmin()

    // Find the trade request
    let tradeReq
    if (token) {
      // Token-based (from WhatsApp link)
      const { data } = await admin
        .from('trade_requests')
        .select('id, requester_id, target_id, status, expires_at, they_have, i_have, match_score, distance_km')
        .eq('token', token)
        .single()
      tradeReq = data
    } else {
      // Authenticated user (from app)
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

      const { data } = await admin
        .from('trade_requests')
        .select('id, requester_id, target_id, status, expires_at, they_have, i_have, match_score, distance_km')
        .eq('id', request_id)
        .eq('target_id', user.id)
        .single()
      tradeReq = data
    }

    if (!tradeReq) {
      return NextResponse.json({ error: 'Solicitação não encontrada.' }, { status: 404 })
    }

    if (tradeReq.status !== 'pending') {
      const statusLabel = tradeReq.status === 'approved' ? 'aprovada' : tradeReq.status === 'rejected' ? 'recusada' : 'expirada'
      return NextResponse.json({ error: `Esta solicitação já foi ${statusLabel}.`, already_responded: true }, { status: 409 })
    }

    // Check expiration
    if (new Date(tradeReq.expires_at) < new Date()) {
      await admin
        .from('trade_requests')
        .update({ status: 'expired' })
        .eq('id', tradeReq.id)
      return NextResponse.json({ error: 'Esta solicitação expirou.' }, { status: 410 })
    }

    // Update status
    const newStatus = action === 'approve' ? 'approved' : 'rejected'
    const { error: updateError } = await admin
      .from('trade_requests')
      .update({
        status: newStatus,
        responded_at: new Date().toISOString(),
      })
      .eq('id', tradeReq.id)

    if (updateError) {
      console.error('Update trade request error:', updateError)
      return NextResponse.json({ error: 'Erro ao responder solicitação.' }, { status: 500 })
    }

    // If approved, share contacts between both users
    if (action === 'approve') {
      const [{ data: requesterProfile }, { data: targetProfile }] = await Promise.all([
        admin.from('profiles').select('display_name, phone, email').eq('id', tradeReq.requester_id).single(),
        admin.from('profiles').select('display_name, phone, email').eq('id', tradeReq.target_id).single(),
      ])

      const requesterName = requesterProfile?.display_name || 'Usuário'
      const targetName = targetProfile?.display_name || 'Usuário'

      // Notify requester: trade was approved! Here's the contact.
      const requesterPhone = requesterProfile?.phone ? formatPhone(requesterProfile.phone) : null
      const targetPhone = targetProfile?.phone ? formatPhone(targetProfile.phone) : null

      // Fire notifications in background (non-blocking)
      const totalTrade = tradeReq.they_have + tradeReq.i_have
      const notifyAsync = async () => {
        const notifications: Promise<unknown>[] = []

        // WhatsApp to requester
        if (requesterPhone) {
          const contactLine = targetPhone
            ? `📱 WhatsApp: wa.me/${targetPhone}`
            : targetProfile?.email
              ? `📧 E-mail: ${targetProfile.email}`
              : `Abra o app: ${APP_URL}/trades`

          const msgToRequester =
            `🎉 *Troca aprovada!*\n\n` +
            `*${targetName}* aceitou sua solicitação de troca!\n\n` +
            `📊 Potencial: ${totalTrade} figurinhas\n` +
            `   • ${tradeReq.they_have} que você precisa\n` +
            `   • ${tradeReq.i_have} que você tem pra dar\n\n` +
            `📞 *Contato:*\n${contactLine}\n\n` +
            `Boa troca de figurinhas! ⚽`

          notifications.push(sendText(requesterPhone, msgToRequester))
        }

        // WhatsApp to target
        if (targetPhone) {
          const contactLine = requesterPhone
            ? `📱 WhatsApp: wa.me/${requesterPhone}`
            : requesterProfile?.email
              ? `📧 E-mail: ${requesterProfile.email}`
              : `Abra o app: ${APP_URL}/trades`

          const msgToTarget =
            `✅ Troca aprovada com *${requesterName}*!\n\n` +
            `📞 *Contato dele(a):*\n${contactLine}\n\n` +
            `Boa troca de figurinhas! ⚽`

          notifications.push(sendText(targetPhone, msgToTarget))
        }

        // Email to requester
        if (requesterProfile?.email) {
          const contact = targetPhone ? `wa.me/${targetPhone}` : targetProfile?.email || ''
          const html = tradeApprovedEmailHtml(targetName, contact, totalTrade, APP_URL)
          notifications.push(sendEmail(requesterProfile.email, `🎉 ${targetName} aceitou sua troca!`, html))
        }

        // Email to target
        if (targetProfile?.email) {
          const contact = requesterPhone ? `wa.me/${requesterPhone}` : requesterProfile?.email || ''
          const html = tradeApprovedEmailHtml(requesterName, contact, totalTrade, APP_URL)
          notifications.push(sendEmail(targetProfile.email, `✅ Troca aprovada com ${requesterName}!`, html))
        }

        // Push notification to requester
        notifications.push(sendPushToUser(tradeReq.requester_id, {
          title: '🎉 Troca aprovada!',
          body: `${targetName} aceitou sua troca! Abra o app para ver o contato.`,
          url: '/trades',
        }))

        await Promise.allSettled(notifications)
      }
      notifyAsync().catch(err => console.error('Async approve notification error:', err))

      return NextResponse.json({
        ok: true,
        status: 'approved',
        requester_name: requesterName,
        target_name: targetName,
        requester_contact: requesterPhone ? `wa.me/${requesterPhone}` : requesterProfile?.email || null,
        target_contact: targetPhone ? `wa.me/${targetPhone}` : targetProfile?.email || null,
      })
    }

    // Rejected — notify requester
    if (action === 'reject') {
      const [{ data: requesterProfile }, { data: targetProfile }] = await Promise.all([
        admin.from('profiles').select('display_name, phone, email').eq('id', tradeReq.requester_id).single(),
        admin.from('profiles').select('display_name').eq('id', tradeReq.target_id).single(),
      ])

      const requesterPhone = requesterProfile?.phone ? formatPhone(requesterProfile.phone) : null
      const targetName = targetProfile?.display_name?.split(' ')[0] || 'O usuário'

      // Fire notifications in background (non-blocking)
      const notifyRejectAsync = async () => {
        const notifications: Promise<unknown>[] = []

        if (requesterPhone) {
          notifications.push(sendText(
            requesterPhone,
            `😕 *${targetName}* preferiu não trocar dessa vez.\n\nTente outros colecionadores na página de trocas:\n${APP_URL}/trades`
          ))
        }

        // Email fallback (send if no phone available)
        if (requesterProfile?.email && !requesterPhone) {
          const html = tradeRejectedEmailHtml(targetName)
          notifications.push(sendEmail(requesterProfile.email, `😕 ${targetName} preferiu não trocar dessa vez`, html))
        }

        await Promise.allSettled(notifications)
      }
      notifyRejectAsync().catch(err => console.error('Async reject notification error:', err))

      return NextResponse.json({ ok: true, status: 'rejected' })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Trade respond error:', err)
    return NextResponse.json({ error: 'Erro ao processar resposta.' }, { status: 500 })
  }
}
