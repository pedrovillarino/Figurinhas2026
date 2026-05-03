/**
 * Suporte / escalation pro time de atendimento humano (Pedro).
 *
 * Quando o agent (whatsapp-agent) decide escalar OU quando outras heurísticas
 * detectam frustração explícita, o caso vai pra duas vias:
 *   1. Tabela support_escalations — pra histórico + admin section
 *   2. Notificação Z-API pro WhatsApp pessoal do Pedro (PEDRO_PERSONAL_PHONE)
 *
 * Rate-limit: 1 escalação por user a cada 6h. Se user manda 5 mensagens
 * unknown seguidas, só a primeira gera notification (e respondemos
 * "anotei" pras seguintes sem incomodar o time).
 */
import { createClient } from '@supabase/supabase-js'
import { sendText } from '@/lib/zapi'

const PEDRO_PERSONAL_PHONE = '5521997838210'
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://www.completeai.com.br').trim()
const RATE_LIMIT_HOURS = 6

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

export type EscalationInput = {
  userId: string
  phone: string
  displayName: string | null
  lastMessage: string
  reason: string
  classifiedIntent?: string | null
}

export type EscalationResult = {
  ok: boolean
  rateLimited: boolean
  notified: boolean
  escalationId: number | null
}

/**
 * Registra escalação + notifica Pedro (com rate-limit).
 *
 * Best-effort: se inserir/notificar falha, retorna ok=false mas não throw —
 * o webhook chamador já mandou a resposta de "anotei" pro user.
 */
export async function escalateToSupport(input: EscalationInput): Promise<EscalationResult> {
  const supabase = getAdmin()

  // Rate-limit check: outra escalação desse user nas últimas 6h?
  const cutoff = new Date(Date.now() - RATE_LIMIT_HOURS * 3600 * 1000).toISOString()
  const { data: recent } = await supabase
    .from('support_escalations')
    .select('id, notified_pedro_at')
    .eq('user_id', input.userId)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(1)

  const isRateLimited = !!(recent && recent.length > 0)

  // Sempre insere registro (pra histórico) — mesmo rate-limited.
  // Mas só notifica Pedro se NÃO estiver rate-limited.
  const { data: inserted, error: insertErr } = await supabase
    .from('support_escalations')
    .insert({
      user_id: input.userId,
      phone: input.phone,
      display_name: input.displayName,
      last_message: input.lastMessage.slice(0, 2000),
      reason: input.reason.slice(0, 500),
      classified_intent: input.classifiedIntent ?? null,
    })
    .select('id')
    .single()

  if (insertErr) {
    console.error('[support] insert escalation failed:', insertErr.message)
    return { ok: false, rateLimited: isRateLimited, notified: false, escalationId: null }
  }

  const escalationId = (inserted as { id: number }).id

  if (isRateLimited) {
    console.log(`[support] escalation ${escalationId} rate-limited (user=${input.userId})`)
    return { ok: true, rateLimited: true, notified: false, escalationId }
  }

  // Notifica Pedro WhatsApp pessoal
  const namePart = input.displayName ? `*${input.displayName}*` : '_user sem nome_'
  const msgPedro =
    `🆘 *Suporte solicitado*\n\n` +
    `${namePart} (\`${input.phone}\`)\n` +
    `_"${input.lastMessage.slice(0, 200)}${input.lastMessage.length > 200 ? '…' : ''}"_\n\n` +
    `Conversa direta: https://wa.me/${input.phone}\n` +
    `Admin: ${APP_URL}/admin?secret=completeai2026`

  let notified = false
  try {
    notified = await sendText(PEDRO_PERSONAL_PHONE, msgPedro)
  } catch (err) {
    console.error('[support] notify Pedro failed:', err)
  }

  if (notified) {
    await supabase
      .from('support_escalations')
      .update({ notified_pedro_at: new Date().toISOString() })
      .eq('id', escalationId)
  }

  return { ok: true, rateLimited: false, notified, escalationId }
}
