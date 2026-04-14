import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 10

/**
 * Health check endpoint for UptimeRobot / monitoring.
 * Checks: Supabase connectivity + basic app readiness.
 */
export async function GET() {
  const start = Date.now()
  const checks: Record<string, 'ok' | 'fail'> = {}

  // 1. Supabase connectivity
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    const { error } = await supabase.from('stickers').select('id').limit(1).single()
    checks.supabase = error ? 'fail' : 'ok'
  } catch {
    checks.supabase = 'fail'
  }

  // 2. Environment variables present
  checks.env = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'STRIPE_SECRET_KEY',
  ].every((k) => !!process.env[k])
    ? 'ok'
    : 'fail'

  const allOk = Object.values(checks).every((v) => v === 'ok')
  const elapsed = Date.now() - start

  return NextResponse.json(
    {
      status: allOk ? 'healthy' : 'degraded',
      checks,
      latency_ms: elapsed,
      timestamp: new Date().toISOString(),
      version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || 'dev',
    },
    { status: allOk ? 200 : 503 }
  )
}
