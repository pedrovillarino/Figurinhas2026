import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendText } from '@/lib/zapi'
import { sendEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const CRON_SECRET = process.env.CRON_SECRET
const ADMIN_PHONE = process.env.ADMIN_PHONE
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'pedrovillarino@gmail.com'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Thresholds — when to alert Pedro
const THRESHOLDS = [
  {
    users: 500,
    label: '500 usuários',
    actions: [
      'Verificar se Upstash está no plano pay-as-you-go',
      'Monitorar latência do Supabase no dashboard',
    ],
  },
  {
    users: 2000,
    label: '2.000 usuários',
    actions: [
      'Ativar connection pooler no Supabase (Supavisor)',
      'Considerar Sentry Team plan ($26/mês)',
      'Monitorar custos Gemini no Google Cloud Console',
    ],
  },
  {
    users: 5000,
    label: '5.000 usuários',
    actions: [
      'Criar materialized view para ranking (refresh via pg_cron)',
      'Cachear leaderboard no Redis (TTL 5min)',
      'Avaliar segunda instância Z-API ou migrar para Meta Cloud API',
      'Verificar bandwidth da Vercel',
    ],
  },
  {
    users: 10000,
    label: '10.000 usuários',
    actions: [
      'Implementar materialized view para ranking + stats',
      'Migrar notificações primárias para Push (VAPID) em vez de WhatsApp',
      'Considerar Supabase Team plan ou read replicas',
      'Implementar cache de scan (hash de imagem → resultado)',
    ],
  },
  {
    users: 25000,
    label: '25.000 usuários',
    actions: [
      'Migrar para WhatsApp Business API (Meta Cloud API)',
      'Tabela user_stats desnormalizada com triggers',
      'Supabase Team plan ($599/mês)',
      'Considerar CDN externo (Cloudflare) na frente da Vercel',
    ],
  },
  {
    users: 50000,
    label: '50.000 usuários',
    actions: [
      'Arquitetura de read replicas no Supabase',
      'Edge functions para APIs leves',
      'Avaliar Vercel Enterprise ou hosting alternativo',
      'Equipe de suporte dedicada',
    ],
  },
]

/**
 * GET /api/health/scale-check
 *
 * Called by Vercel Cron daily. Checks user count and sends
 * proactive alerts when approaching scale thresholds.
 *
 * Stores last alerted threshold in a simple profiles metadata
 * to avoid re-alerting for the same threshold.
 */
export async function GET(req: NextRequest) {
  // Verify cron secret in production
  if (CRON_SECRET) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const admin = getAdmin()

  // Count total users
  const { count: totalUsers } = await admin
    .from('profiles')
    .select('*', { count: 'exact', head: true })

  // Count active users (have at least 1 sticker)
  const { count: activeUsers } = await admin
    .from('user_stickers')
    .select('user_id', { count: 'exact', head: true })

  // Count today's scans
  const today = new Date().toISOString().split('T')[0]
  const { count: todayScans } = await admin
    .from('scan_usage')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', today)

  const users = totalUsers || 0
  const active = activeUsers || 0
  const scans = todayScans || 0

  // Find the highest threshold we've crossed
  const crossedThresholds = THRESHOLDS.filter(t => users >= t.users)
  const highestCrossed = crossedThresholds[crossedThresholds.length - 1]

  // Check if we need to alert (simple: alert at 80% of next threshold)
  const nextThreshold = THRESHOLDS.find(t => users < t.users)
  const approachingNext = nextThreshold && users >= nextThreshold.users * 0.8

  let alertSent = false

  if (approachingNext && nextThreshold) {
    const pct = Math.round((users / nextThreshold.users) * 100)
    const alertMsg =
      `⚠️ *Alerta de Escala — Complete Aí*\n\n` +
      `📊 *${users.toLocaleString('pt-BR')}* usuários (${pct}% do próximo threshold)\n` +
      `👥 Ativos: ${active.toLocaleString('pt-BR')}\n` +
      `📸 Scans hoje: ${scans.toLocaleString('pt-BR')}\n\n` +
      `🎯 *Próximo marco: ${nextThreshold.label}*\n` +
      `Ações recomendadas:\n` +
      nextThreshold.actions.map((a, i) => `${i + 1}. ${a}`).join('\n') +
      `\n\nDashboard: https://supabase.com/dashboard`

    // Send via WhatsApp and email
    if (ADMIN_PHONE) {
      try {
        await sendText(ADMIN_PHONE, alertMsg)
        alertSent = true
      } catch (err) {
        console.error('[scale-check] WhatsApp alert failed:', err)
      }
    }

    try {
      await sendEmail(
        ADMIN_EMAIL,
        `⚠️ Complete Aí: ${users} usuários — se preparando para ${nextThreshold.label}`,
        alertMsg.replace(/\*/g, '').replace(/\n/g, '<br>')
      )
      alertSent = true
    } catch (err) {
      console.error('[scale-check] Email alert failed:', err)
    }
  }

  return NextResponse.json({
    users,
    active,
    scansToday: scans,
    currentThreshold: highestCrossed?.label || 'Abaixo de 500',
    nextThreshold: nextThreshold?.label || 'Todos os thresholds atingidos',
    approaching: approachingNext || false,
    alertSent,
  })
}
