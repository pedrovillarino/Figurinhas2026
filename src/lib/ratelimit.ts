import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { NextRequest, NextResponse } from 'next/server'

/**
 * Rate limiting utility using Upstash Redis.
 *
 * Requires env vars:
 *   UPSTASH_REDIS_REST_URL
 *   UPSTASH_REDIS_REST_TOKEN
 *
 * If not configured, rate limiting is silently skipped (no-op).
 */

let redis: Redis | null = null

function getRedis(): Redis | null {
  if (redis) return redis
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  redis = new Redis({ url, token })
  return redis
}

// ─── Pre-built rate limiters ───

/** 10 requests per minute — for auth/login endpoints */
export const authLimiter = createLimiter('auth', 10, '1 m')

/** 30 requests per minute — for scan endpoints (Gemini API) */
export const scanLimiter = createLimiter('scan', 30, '1 m')

/** 20 requests per hour — for trade creation */
export const tradeLimiter = createLimiter('trade', 20, '1 h')

/** 60 requests per minute — for webhook endpoints */
export const webhookLimiter = createLimiter('webhook', 60, '1 m')

/** 10 requests per minute — for Stripe checkout */
export const stripeLimiter = createLimiter('stripe', 10, '1 m')

function createLimiter(prefix: string, tokens: number, window: `${number} ${'s' | 'm' | 'h' | 'd'}`) {
  return {
    prefix,
    tokens,
    window,
  }
}

type LimiterConfig = ReturnType<typeof createLimiter>

/**
 * Check rate limit. Returns null if allowed, or a 429 Response if blocked.
 * If Upstash is not configured, always allows (returns null).
 *
 * @param identifier - IP address or user ID
 * @param limiter - one of the pre-built limiters
 */
export async function checkRateLimit(
  identifier: string,
  limiter: LimiterConfig
): Promise<NextResponse | null> {
  const r = getRedis()
  if (!r) return null // Rate limiting disabled — no Redis configured

  try {
    const rl = new Ratelimit({
      redis: r,
      limiter: Ratelimit.slidingWindow(limiter.tokens, limiter.window),
      prefix: `rl:${limiter.prefix}`,
    })

    const { success, remaining, reset } = await rl.limit(identifier)

    if (!success) {
      return NextResponse.json(
        { error: 'Muitas requisições. Tente novamente em alguns minutos.' },
        {
          status: 429,
          headers: {
            'X-RateLimit-Remaining': String(remaining),
            'X-RateLimit-Reset': String(reset),
            'Retry-After': String(Math.ceil((reset - Date.now()) / 1000)),
          },
        }
      )
    }

    return null // Allowed
  } catch (err) {
    // If Redis is down, don't block the request
    console.error('Rate limit check failed:', err)
    return null
  }
}

/** Extract IP from request headers */
export function getIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
         req.headers.get('x-real-ip') ||
         'anonymous'
}
