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

    // Pedro 2026-05-08: detecção de silêncio HÍBRIDA:
    //
    // Janelas (mantidas):
    //   - Pico (18:30-22:00 BR): janela 30min
    //   - Dia (06:00-18:30 BR): janela 60min
    //   - Cooldown noturno (22:00-01:00 BR): janela 60min
    //   - Sleep (01:00-06:00 BR): watchdog não dispara
    //
    // Decisão de disparo (NOVO):
    //   - Com 3+ dias de histórico: usa BASELINE da mesma hora-do-dia
    //     dos últimos 7 dias (mediana). Só dispara se atual=0 E baseline≥5
    //     E ratio<0.2 — anomalia genuína comparada ao padrão.
    //   - Com <3 dias de histórico: fallback pra threshold fixo (atual=0
    //     dispara). App novo, sem dado pra comparar.
    //
    // Vantagens: zero falso positivo em horas naturalmente quietas.
    const nowBR = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
    const hourBR = nowBR.getHours()
    const minutesBR = nowBR.getMinutes()
    const totalMinutesBR = hourBR * 60 + minutesBR

    const isPeakHour = totalMinutesBR >= 18 * 60 + 30 && totalMinutesBR < 22 * 60
    const isLateNightCooldown =
      (totalMinutesBR >= 22 * 60 && totalMinutesBR < 24 * 60) ||
      (totalMinutesBR < 60)
    const isDayHour = totalMinutesBR >= 6 * 60 && totalMinutesBR < 18 * 60 + 30
    const isActiveHour = isDayHour || isPeakHour || isLateNightCooldown
    const silenceThresholdMin = isPeakHour ? 30 : 60

    // Pega current_count + baseline_median + days_with_data + ratio
    const { data: baselineRows } = await sb.rpc('get_webhook_baseline', {
      window_minutes: silenceThresholdMin,
    })
    const baseline = baselineRows?.[0] ?? { current_count: 0, baseline_median: 0, days_with_data: 0, ratio_to_baseline: 1 }

    const recentMsgs = Number(baseline.current_count ?? 0)
    const baselineMed = Number(baseline.baseline_median ?? 0)
    const daysWithData = Number(baseline.days_with_data ?? 0)
    const ratio = Number(baseline.ratio_to_baseline ?? 1)

    results.webhook_inbound = {
      msgs_in_window: recentMsgs,
      window_minutes: silenceThresholdMin,
      baseline_median: baselineMed,
      days_with_baseline_data: daysWithData,
      ratio_to_baseline: ratio,
      hour_br: hourBR,
      is_peak_hour: isPeakHour,
      is_active_hour: isActiveHour,
    }

    // Trigger logic:
    const zapiOk = (results.whatsapp as { connected?: boolean })?.connected
    const useBaseline = daysWithData >= 3
    const isAnomaly = useBaseline
      ? (recentMsgs === 0 && baselineMed >= 5 && ratio < 0.2)
      : (recentMsgs === 0)  // fallback: app novo, sem dado pra comparar

    // Pedro 2026-05-12: nova lógica conservadora pra anti-spam.
    //   1. Exige 2 ciclos consecutivos de anomalia antes de agir.
    //      Mata falso positivo de janela quieta natural.
    //   2. Notificação em TRANSIÇÃO de estado (ok→failed, failed→recovered).
    //      Sucesso repetido na mesma série = silêncio (não floodar).
    //      Falha repetida = cooldown 2h (ação humana ainda pode ser preciso).
    //   3. Estado persistido em watchdog_state (id='webhook_recovery'):
    //      consecutive_anomaly_count, last_state ('ok'|'recovered'|'failed'),
    //      last_alert_at (mantido pra gate do cooldown 2h em falha).
    const { data: stateRow } = await sb
      .from('watchdog_state')
      .select('consecutive_anomaly_count, last_state, last_alert_at')
      .eq('id', 'webhook_recovery')
      .maybeSingle()

    const prevCount = Number(stateRow?.consecutive_anomaly_count ?? 0)
    const prevState = String(stateRow?.last_state ?? 'ok')
    const prevLastAlertAt = (stateRow?.last_alert_at as string | null) ?? null

    if (isAnomaly && isActiveHour && zapiOk) {
      const newCount = prevCount + 1
      results.webhook_consecutive_anomalies = newCount

      if (newCount < 2) {
        // 1º ciclo consecutivo — observa só. Janela única quieta pode ser
        // padrão natural (fim de semana cedo, horário morto). Espera 2º.
        await sb.from('watchdog_state')
          .update({ consecutive_anomaly_count: newCount })
          .eq('id', 'webhook_recovery')
        results.webhook_action = 'observing'
      } else {
        console.warn('[Health] Webhook silence confirmado (2+ ciclos) — auto-recovery')
        const recovered = await setReceiveWebhook()
        const newState = recovered ? 'recovered' : 'failed'
        results.webhook_action = recovered ? 'recovery_triggered' : 'recovery_failed'

        const stateChanged = prevState !== newState
        let shouldNotify = false

        if (newState === 'recovered') {
          // Sucesso: só notifica em transição. Repetido = silêncio total.
          shouldNotify = stateChanged
          await sb.from('watchdog_state')
            .update({
              consecutive_anomaly_count: newCount,
              last_state: newState,
              ...(shouldNotify ? { last_alert_at: new Date().toISOString() } : {}),
            })
            .eq('id', 'webhook_recovery')
        } else {
          // Falha: transição notifica direto; persistente respeita cooldown 2h.
          if (stateChanged) {
            shouldNotify = true
            await sb.from('watchdog_state')
              .update({
                consecutive_anomaly_count: newCount,
                last_state: newState,
                last_alert_at: new Date().toISOString(),
              })
              .eq('id', 'webhook_recovery')
          } else {
            const COOLDOWN_HOURS = 2
            const cutoff = new Date(Date.now() - COOLDOWN_HOURS * 3600 * 1000).toISOString()
            const { data: claimed } = await sb
              .from('watchdog_state')
              .update({
                consecutive_anomaly_count: newCount,
                last_state: newState,
                last_alert_at: new Date().toISOString(),
              })
              .eq('id', 'webhook_recovery')
              .or(`last_alert_at.is.null,last_alert_at.lt.${cutoff}`)
              .select('id')
            shouldNotify = !!(claimed && claimed.length > 0)
            if (!shouldNotify) {
              // Cooldown ativo — só persiste count/state, mantém last_alert_at.
              await sb.from('watchdog_state')
                .update({ consecutive_anomaly_count: newCount, last_state: newState })
                .eq('id', 'webhook_recovery')
            }
          }
        }

        results.recovery_alert_cooldown = shouldNotify ? 'sent' : 'suppressed'

        if (shouldNotify && ADMIN_PHONE) {
          const baselineLine = useBaseline
            ? `Mediana dos últimos 7 dias nessa janela: *${baselineMed} msgs*. Atual: *0*. Anomalia confirmada em 2 ciclos.`
            : `2 ciclos consecutivos de ${silenceThresholdMin}min sem mensagens (sem histórico ainda pra comparar).`
          const recoveryMsg = recovered
            ? `🔧 *Watchdog WhatsApp — auto-recovery executado*\n\n` +
              `${baselineLine} ` +
              `Acabamos de reconfigurar a URL (PUT update-webhook-received). ` +
              `Verifique se voltaram mensagens nos próximos minutos.\n\n` +
              `_(Próximo aviso só se o estado mudar — não vou re-avisar enquanto continuar OK.)_\n` +
              `⏰ ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`
            : `🚨 *Watchdog WhatsApp — auto-recovery FALHOU*\n\n` +
              `${baselineLine} PUT update-webhook-received não funcionou. ` +
              `Verificar manualmente Z-API (instance status, sessão, plano).\n\n` +
              `_(Próximo aviso só daqui a 2h se ainda falhar.)_\n` +
              `⏰ ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`
          try {
            await sendText(ADMIN_PHONE, recoveryMsg)
            results.recovery_alert_sent = 'whatsapp'
          } catch (e) {
            console.error('[Health] failed to notify admin of recovery:', e)
            results.recovery_alert_sent = 'failed'
          }
        } else if (!shouldNotify) {
          console.log('[Health] recovery alert suprimido (cooldown 2h ou success repetido)')
        }
      }
    } else {
      // Sem anomalia / fora de janela ativa / Z-API down: reset série + marca ok.
      if (prevCount !== 0 || prevState !== 'ok') {
        await sb.from('watchdog_state')
          .update({ consecutive_anomaly_count: 0, last_state: 'ok' })
          .eq('id', 'webhook_recovery')
      }
    }
    void prevLastAlertAt
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
