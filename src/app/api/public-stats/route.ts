/**
 * GET /api/public-stats — números agregados da landing page.
 *
 * Cache HTTP de 1h (s-maxage=3600). A fonte (public_stats) só atualiza
 * 1×/dia via pg_cron, mas cache curto na CDN protege contra spike de
 * tráfego anônimo na home.
 *
 * Nunca falha — em erro devolve campos `null` e a LP esconde a seção.
 */
import { NextResponse } from 'next/server'
import { getLandingStats } from '@/lib/landing-stats'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const stats = await getLandingStats()
  return NextResponse.json(stats, {
    headers: {
      // 1h na edge/CDN, 5min em browsers privados, SWR 1 dia.
      'Cache-Control': 's-maxage=3600, stale-while-revalidate=86400',
    },
  })
}
