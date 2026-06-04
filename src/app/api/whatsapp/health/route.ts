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

  // ── 1.5. Inbound webhook watchdog (Pedro 2026-05-08, reescrito 2026-06-04) ──
  //
  // A Z-API pode seguir "connected" (ENVIO ok) mas PARAR de entregar as
  // mensagens RECEBIDAS no nosso webhook — silenciosamente. Foi o incident
  // 2026-06-02: ~36h sem receber nada enquanto o envio seguia normal.
  //
  // O watchdog anterior gateava o recovery numa condição composta (baseline
  // median + ratio via RPC). Empiricamente ele NUNCA disparou nesse incident
  // e não tínhamos como saber por quê — não logávamos os gates. Reescrito pra:
  //   1. Trigger SIMPLES e observável: "há quanto tempo não recebemos nada?",
  //      lido direto de webhook_dedup (sem depender de RPC/baseline/mediana).
  //   2. Logar SEMPRE todos os gates (nunca mais ficar cego).
  //   3. Recovery em 2 níveis: (a) re-setar a URL do webhook — idempotente e
  //      barato, roda toda vez que silencioso; (b) restart da instância só se
  //      o silêncio persistir e respeitando cooldown (caro: reconecta sessão).
  //   4. Alertar admin por WhatsApp E email (cooldown 12h, claim atômico).
  //
  // Janela ativa (BR): fora dela (madrugada 01:00-06:00) o watchdog dorme —
  // silêncio natural não é anomalia.
  try {
    const { createClient } = await import('@supabase/supabase-js')
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    const nowBR = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
    const hourBR = nowBR.getHours()
    const totalMinutesBR = hourBR * 60 + nowBR.getMinutes()

    const isPeakHour = totalMinutesBR >= 18 * 60 + 30 && totalMinutesBR < 22 * 60
    const isLateNightCooldown =
      (totalMinutesBR >= 22 * 60 && totalMinutesBR < 24 * 60) || (totalMinutesBR < 60)
    const isDayHour = totalMinutesBR >= 6 * 60 && totalMinutesBR < 18 * 60 + 30
    const isActiveHour = isDayHour || isPeakHour || isLateNightCooldown
    const silenceThresholdMin = isPeakHour ? 90 : 180
    const RESTART_AFTER_MIN = 30 // restart só se silencioso por tanto tempo

    // Trigger primário: nº de msgs recebidas na janela (index em created_at).
    const windowStart = new Date(Date.now() - silenceThresholdMin * 60 * 1000).toISOString()
    const { count: recentCount } = await sb
      .from('webhook_dedup')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', windowStart)
    const inboundSilent = (recentCount ?? 0) === 0

    // Minutos desde a última recebida (só quando silencioso — query rara).
    let minutesSilent: number | null = null
    if (inboundSilent) {
      const { data: lastIn } = await sb
        .from('webhook_dedup')
        .select('created_at')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (lastIn?.created_at) {
        minutesSilent = Math.round((Date.now() - Date.parse(lastIn.created_at)) / 60000)
      }
    }

    const zapiOk = (results.whatsapp as { connected?: boolean })?.connected === true
    const shouldRecover = inboundSilent && isActiveHour && zapiOk

    results.webhook_inbound = {
      msgs_in_window: recentCount ?? 0,
      window_minutes: silenceThresholdMin,
      minutes_silent: minutesSilent,
      hour_br: hourBR,
      is_active_hour: isActiveHour,
      zapi_connected: zapiOk,
      should_recover: shouldRecover,
    }
    // SEMPRE logar os gates — lição nº1 do incident 2026-06-02 (watchdog cego).
    console.log('[Health] watchdog gates', JSON.stringify(results.webhook_inbound))

    if (shouldRecover) {
      console.warn(`[Health] Inbound silent (${minutesSilent ?? '?'}min, ${recentCount ?? 0} in ${silenceThresholdMin}min) — re-setting webhook`)
      const reset = await setReceiveWebhook()
      results.webhook_action = reset ? 'webhook_reset' : 'webhook_reset_failed'

      // Nível 2: restart da instância se o silêncio persistir. Caro (reconecta
      // a sessão WhatsApp), então claim atômico com cooldown de RESTART_AFTER_MIN
      // pra rodar no máximo uma vez por janela. Isolado em try próprio: se a
      // coluna/claim falhar, o re-set acima e o alerta abaixo não são afetados.
      let restarted: boolean | undefined
      if ((minutesSilent ?? Infinity) >= RESTART_AFTER_MIN) {
        try {
          const restartCutoff = new Date(Date.now() - RESTART_AFTER_MIN * 60 * 1000).toISOString()
          const { data: claimedRestart } = await sb
            .from('watchdog_state')
            .update({ last_restart_at: new Date().toISOString() })
            .eq('id', 'webhook_recovery')
            .or(`last_restart_at.is.null,last_restart_at.lt.${restartCutoff}`)
            .select('id')
          if (claimedRestart && claimedRestart.length > 0) {
            console.warn('[Health] Inbound still silent — restarting Z-API instance')
            restarted = await restartInstance()
            results.webhook_restart = restarted ? 'restarted' : 'restart_failed'
          }
        } catch (e) {
          console.error('[Health] restart claim failed:', e)
        }
      }

      // Alerta admin com cooldown atômico de 12h (claim race-safe via "or").
      const COOLDOWN_HOURS = 12
      const cooldownCutoff = new Date(Date.now() - COOLDOWN_HOURS * 3600 * 1000).toISOString()
      const { data: claimed } = await sb
        .from('watchdog_state')
        .update({ last_alert_at: new Date().toISOString() })
        .eq('id', 'webhook_recovery')
        .or(`last_alert_at.is.null,last_alert_at.lt.${cooldownCutoff}`)
        .select('id')
      const shouldNotify = !!(claimed && claimed.length > 0)
      results.recovery_alert = shouldNotify ? 'sent' : 'suppressed'

      if (shouldNotify) {
        const silentLine = minutesSilent != null
          ? `Paramos de receber mensagens há *${minutesSilent}min* (envio segue OK).`
          : `Nenhuma mensagem recebida na janela de ${silenceThresholdMin}min (envio segue OK).`
        const restartLine = results.webhook_restart
          ? ` + restart da instância ${restarted ? '✅' : '❌'}`
          : ''
        const msg =
          `🔧 *Watchdog WhatsApp*\n\n` +
          `${silentLine}\n` +
          `Ação automática: re-set do webhook ${reset ? '✅' : '❌'}${restartLine}.\n` +
          `Confira se as mensagens voltam nos próximos minutos.\n\n` +
          `_(Próximo aviso só daqui a ${COOLDOWN_HOURS}h se persistir.)_\n` +
          `⏰ ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`
        if (ADMIN_PHONE) {
          try { await sendText(ADMIN_PHONE, msg); results.recovery_alert_whatsapp = 'sent' }
          catch (e) { console.error('[Health] recovery WhatsApp alert failed:', e); results.recovery_alert_whatsapp = 'failed' }
        }
        // Email é independente do WhatsApp — que é justamente o canal que pode
        // estar quebrado. Garante que o aviso chega mesmo no pior caso.
        if (ADMIN_EMAIL) {
          try {
            await sendEmail(
              ADMIN_EMAIL,
              '🔧 Watchdog WhatsApp — inbound silencioso',
              `<pre style="font-family:sans-serif;font-size:14px;white-space:pre-wrap">${msg.replace(/\*/g, '')}</pre>`,
            )
            results.recovery_alert_email = 'sent'
          } catch (e) { console.error('[Health] recovery email alert failed:', e); results.recovery_alert_email = 'failed' }
        }
      } else {
        console.log('[Health] recovery alert suppressed by 12h cooldown')
      }
    }
  } catch (err) {
    results.webhook_inbound = { error: String(err).slice(0, 200) }
    console.error('[Health] watchdog error:', err)
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
