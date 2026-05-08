import { NextRequest, NextResponse } from 'next/server'
import { getInstanceStatus, restartInstance, sendText, setReceiveWebhook } from '@/lib/zapi'
import { sendEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const ADMIN_PHONE = process.env.ADMIN_PHONE
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'pedrovillarino@gmail.com'

/**
 * System Health Check + WhatsApp Monitor
 *
 * Public GET — returns system status (used by UptimeRobot every 5 min).
 * When called with CRON_SECRET auth — also sends alerts and processes queue.
 *
 * Checks:
 * 1. WhatsApp Z-API connection → auto-restart if down
 * 2. Supabase connectivity + latency
 * 3. Critical env vars
 * 4. Notification queue health
 * 5. Processes pending notification queue
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  const isAuthed = !cronSecret || authHeader === `Bearer ${cronSecret}`

  const results: Record<string, unknown> = {}
  const alerts: string[] = []

  // ── 1. WhatsApp Z-API Status ──
  try {
    const status = await getInstanceStatus()
    results.whatsapp = {
      connected: status.connected,
      smartphoneConnected: status.smartphoneConnected,
    }

    if (!status.connected) {
      console.warn('[Health] WhatsApp disconnected! Attempting restart...')
      const restarted = await restartInstance()
      results.whatsapp_action = restarted ? 'restarted' : 'restart_failed'

      if (!restarted) {
        alerts.push('WhatsApp Z-API desconectado e restart falhou. Reconectar via QR code.')
      } else {
        // Wait 10s and re-check
        await new Promise((r) => setTimeout(r, 10000))
        const recheck = await getInstanceStatus()
        if (!recheck.connected) {
          alerts.push('WhatsApp Z-API nao reconectou apos restart. Sessao expirada — reconectar QR code.')
        } else {
          results.whatsapp = { connected: true, smartphoneConnected: recheck.smartphoneConnected }
          results.whatsapp_action = 'reconnected'
        }
      }
    }
  } catch (err) {
    results.whatsapp = { error: String(err) }
    alerts.push(`Erro ao verificar WhatsApp: ${String(err).slice(0, 100)}`)
  }

  // ── 1.5. Inbound webhook health (Pedro 2026-05-08) ──
  // Z-API pode estar tecnicamente "connected" mas o webhook URL pode ter
  // sido apagado/inválido — incident de hoje ficou ~14h sem receber msgs
  // antes de detectarmos manualmente. Agora checamos:
  //   1. Quantas msgs recebemos via webhook_dedup nas últimas 30min
  //   2. Se 0 msgs E é horário de uso ativo (8h-23h BR)
  //   3. Auto-recovery: SOMENTE PUT update-webhook-received (hardcoded em
  //      setReceiveWebhook — nunca aliasar outros tipos pra essa URL).
  //   4. Notifica Pedro do auto-recovery via WhatsApp.
  try {
    const { createClient } = await import('@supabase/supabase-js')
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    // Pedro 2026-05-08: threshold de silêncio é DINÂMICO conforme volume:
    //   - Pico (18:30-22:00 BR): 30min → mais agressivo, volume típico alto
    //   - Cooldown noturno (22:00-01:00 BR): 60min → ainda monitora mas
    //     conservador (cruzando meia-noite até 1h da manhã)
    //   - Dia (06:00-18:30 BR): 60min → conservador
    //   - Sleep (01:00-06:00 BR): watchdog não dispara
    const nowBR = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
    const hourBR = nowBR.getHours()
    const minutesBR = nowBR.getMinutes()
    const totalMinutesBR = hourBR * 60 + minutesBR

    const isPeakHour = totalMinutesBR >= 18 * 60 + 30 && totalMinutesBR < 22 * 60
    // Cooldown noturno cruza meia-noite: 22:00-23:59 OR 00:00-00:59
    const isLateNightCooldown =
      (totalMinutesBR >= 22 * 60 && totalMinutesBR < 24 * 60) ||
      (totalMinutesBR < 60)
    // Dia: 06:00-18:30
    const isDayHour = totalMinutesBR >= 6 * 60 && totalMinutesBR < 18 * 60 + 30
    const isActiveHour = isDayHour || isPeakHour || isLateNightCooldown
    const silenceThresholdMin = isPeakHour ? 30 : 60

    const cutoff = new Date(Date.now() - silenceThresholdMin * 60 * 1000).toISOString()
    const { count: recentMsgs } = await sb
      .from('webhook_dedup')
      .select('message_id', { count: 'exact', head: true })
      .gte('created_at', cutoff)

    results.webhook_inbound = {
      msgs_in_window: recentMsgs ?? 0,
      window_minutes: silenceThresholdMin,
      hour_br: hourBR,
      is_peak_hour: isPeakHour,
      is_active_hour: isActiveHour,
    }

    // Trigger auto-recovery: 0 msgs no janela atual + horário ativo + Z-API ok.
    const zapiOk = (results.whatsapp as { connected?: boolean })?.connected
    if ((recentMsgs ?? 0) === 0 && isActiveHour && zapiOk) {
      console.warn('[Health] Webhook inbound silent — triggering auto-recovery')
      const recovered = await setReceiveWebhook()
      results.webhook_action = recovered ? 'recovery_triggered' : 'recovery_failed'

      // Pedro 2026-05-08: notifica Pedro IMEDIATAMENTE quando auto-recovery
      // dispara — independente de auth. Esse alerta é raro (só roda quando
      // 30min de silêncio + horário ativo + Z-API connected), então não
      // tem risco de spam vindo do cron pg_net (que pinga sem auth a cada
      // 15min). É um sinal genuíno e o admin DEVE saber na hora.
      if (ADMIN_PHONE) {
        const recoveryMsg = recovered
          ? `🔧 *Watchdog WhatsApp — auto-recovery executado*\n\n` +
            `Webhook estava quieto há ${silenceThresholdMin}min ` +
            `(${isPeakHour ? 'pico noturno' : 'horário diurno'}). ` +
            `Acabamos de reconfigurar a URL (PUT update-webhook-received). ` +
            `Verifique se voltaram mensagens nos próximos minutos.\n\n` +
            `⏰ ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`
          : `🚨 *Watchdog WhatsApp — auto-recovery FALHOU*\n\n` +
            `Webhook quieto há ${silenceThresholdMin}min E PUT update-webhook-received não funcionou. ` +
            `Verificar manualmente Z-API (instance status, sessão, plano).\n\n` +
            `⏰ ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`
        try {
          await sendText(ADMIN_PHONE, recoveryMsg)
          results.recovery_alert_sent = 'whatsapp'
        } catch (e) {
          console.error('[Health] failed to notify admin of recovery:', e)
          results.recovery_alert_sent = 'failed'
        }
      }

      // Também adiciona ao alerts array (pra email + log se authed)
      if (recovered) {
        alerts.push(
          `Webhook estava quieto há ${silenceThresholdMin}min — auto-corrigi ` +
          `(PUT update-webhook-received). Verifique se voltaram mensagens nos próximos minutos.`
        )
      } else {
        alerts.push(
          `Webhook quieto há ${silenceThresholdMin}min E auto-recovery falhou. ` +
          `Verificar manualmente Z-API.`
        )
      }
    }
  } catch (err) {
    results.webhook_inbound = { error: String(err).slice(0, 100) }
    // Non-critical — don't alert (reading webhook_dedup might fail with table missing/perm)
  }

  // ── 2. Supabase Connectivity ──
  try {
    const { createClient } = await import('@supabase/supabase-js')
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
    const start = Date.now()
    const { error } = await sb.from('stickers').select('id').limit(1).single()
    const ms = Date.now() - start
    results.supabase = { ok: !error, latency_ms: ms }

    if (error) {
      alerts.push(`Supabase com problema: ${error.message}`)
    } else if (ms > 5000) {
      alerts.push(`Supabase lento: ${ms}ms para query simples`)
    }
  } catch (err) {
    results.supabase = { ok: false, error: String(err) }
    alerts.push('Supabase FORA DO AR!')
  }

  // ── 3. Critical Env Vars ──
  const missingVars: string[] = []
  const criticalVars = [
    'GEMINI_API_KEY', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
    'ZAPI_INSTANCE_ID', 'ZAPI_TOKEN', 'RESEND_API_KEY',
  ]
  for (const v of criticalVars) {
    if (!process.env[v]) missingVars.push(v)
  }
  results.env = missingVars.length === 0 ? 'ok' : { missing: missingVars }
  if (missingVars.length > 0) {
    alerts.push(`Env vars faltando: ${missingVars.join(', ')}`)
  }

  // ── 4. Notification Queue Health ──
  try {
    const { createClient } = await import('@supabase/supabase-js')
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
    const { count } = await sb
      .from('notification_queue')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'failed')
    results.notification_queue = { failed: count ?? 0 }
    if ((count ?? 0) > 10) {
      alerts.push(`${count} notificacoes falhadas na fila de retry`)
    }
  } catch {
    results.notification_queue = { error: 'table not accessible' }
  }

  // ── 5. Process notification queue (piggyback on health check) ──
  try {
    const { createClient } = await import('@supabase/supabase-js')
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
    const { data: pending } = await sb
      .from('notification_queue')
      .select('id, channel, recipient, subject, message, retry_count, max_retries')
      .eq('status', 'pending')
      .lte('next_retry_at', new Date().toISOString())
      .order('next_retry_at')
      .limit(10)

    let processed = 0
    if (pending && pending.length > 0) {
      for (const item of pending) {
        try {
          // Mark as processing
          await sb.from('notification_queue').update({ status: 'processing' }).eq('id', item.id)

          let sent = false
          if (item.channel === 'whatsapp') {
            sent = await sendText(item.recipient, item.message)
          } else if (item.channel === 'email') {
            sent = await sendEmail(item.recipient, item.subject || 'Complete Ai', item.message)
          }

          if (sent) {
            await sb.from('notification_queue').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', item.id)
            processed++
          } else {
            const nextRetry = item.retry_count >= item.max_retries ? 'failed' : 'pending'
            const backoffMinutes = Math.pow(4, item.retry_count + 1) // 4, 16, 64 min
            await sb.from('notification_queue').update({
              status: nextRetry,
              retry_count: item.retry_count + 1,
              next_retry_at: new Date(Date.now() + backoffMinutes * 60 * 1000).toISOString(),
              last_error: 'Send returned false',
            }).eq('id', item.id)
          }
        } catch (err) {
          await sb.from('notification_queue').update({
            status: 'pending',
            last_error: String(err).slice(0, 200),
          }).eq('id', item.id)
        }
      }
    }
    results.queue_processed = processed
  } catch {
    // Non-critical — don't alert
  }

  // ── 6. Send Alerts (only on authed requests to prevent spam) ──
  if (alerts.length > 0 && isAuthed) {
    const alertMsg = `🚨 *ALERTA Complete Ai*\n\n${alerts.map((a, i) => `${i + 1}. ${a}`).join('\n')}\n\n⏰ ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`
    console.error('[Health] ALERTS:', alerts)

    const whatsappOk = (results.whatsapp as { connected?: boolean })?.connected
    if (ADMIN_PHONE && whatsappOk) {
      try {
        await sendText(ADMIN_PHONE, alertMsg)
        results.alert_sent = 'whatsapp'
      } catch { results.alert_whatsapp = 'failed' }
    }

    if (ADMIN_EMAIL) {
      try {
        const htmlBody = `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
            <h2 style="color:#EF4444">🚨 Alerta do Sistema — Complete Ai</h2>
            <ul style="color:#374151;font-size:15px;line-height:1.8">
              ${alerts.map((a) => `<li>${a}</li>`).join('')}
            </ul>
            <p style="color:#9CA3AF;font-size:13px;margin-top:20px">
              ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
            </p>
          </div>`
        await sendEmail(ADMIN_EMAIL, `🚨 Alerta Complete Ai: ${alerts.length} problema(s)`, htmlBody)
        results.alert_email = 'sent'
      } catch { results.alert_email = 'failed' }
    }
  }

  const ok = alerts.length === 0
  console.log('[Health]', ok ? 'All systems OK' : `${alerts.length} alert(s)`, JSON.stringify(results))

  return NextResponse.json(
    {
      ok,
      timestamp: new Date().toISOString(),
      alerts: alerts.length > 0 ? alerts : undefined,
      ...results,
    },
    { status: ok ? 200 : 503 },
  )
}
