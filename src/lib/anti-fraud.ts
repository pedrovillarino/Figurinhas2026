// Anti-fraud helpers for the Embaixadores campaign.
//
// Strategy (Pedro's call, 2026-04-29 — "trust but verify"):
//   - Don't block signup itself (Supabase Auth runs client-side; intercepting
//     would require client refactor + risk breaking real users)
//   - Block at the REWARD-CLAIM step (/api/referral/apply) — that's where
//     fraud has incentive
//   - Layer cheap, invisible checks; let Pedro invalidate manually if needed
//
// Layers implemented here:
//   1. Disposable-email blocklist (mailinator, 10minutemail, etc)
//   2. IP rate limit (max N referral activations per IP per window)
//   3. Honeypot field detection (body.website must be empty/absent)
//   4. Optional fingerprint logging (forensic only)
import { createClient } from '@supabase/supabase-js'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

// ─── Disposable / temp email blocklist ───────────────────────────────────────
// Curated subset of the most-used disposable email domains. The full list
// (~10k domains) lives at github.com/disposable-email-domains/disposable-email-domains
// and would be overkill to ship in-bundle. This catches the popular ones; the
// ranking is tiny (R$190/week prizes), so a determined attacker is the worst
// case and we have manual review for that.
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  '10minutemail.com', '10minutemail.net', '10minutemail.org',
  'mailinator.com', 'mailinator.net', 'mailinator.org',
  'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org', 'guerrillamail.biz',
  'sharklasers.com', 'spam4.me', 'pokemail.net',
  'temp-mail.org', 'tempmail.com', 'tempmail.net', 'tempmailo.com',
  'throwawaymail.com', 'maildrop.cc', 'getnada.com', 'getairmail.com',
  'yopmail.com', 'yopmail.fr', 'yopmail.net',
  'fakeinbox.com', 'mintemail.com', 'mytemp.email',
  'trashmail.com', 'trashmail.net', 'trashmail.de',
  'dispostable.com', 'mailcatch.com', 'spambox.us',
  'tempinbox.com', 'tempr.email', 'discard.email',
  'emailfake.com', 'emailtemporanea.net', 'fake-mail.net',
  'mohmal.com', 'tempemail.com', 'wegwerfemail.de',
  'spamgourmet.com', 'spamex.com', 'mytrashmail.com',
  'mailnesia.com', 'mailtothis.com', 'mailtemp.info',
  'mvrht.net', 'nbusr123.com', 'objectmail.com',
])

export function isDisposableEmail(email: string | null | undefined): boolean {
  if (!email || typeof email !== 'string') return false
  const at = email.lastIndexOf('@')
  if (at === -1) return false
  const domain = email.slice(at + 1).toLowerCase().trim()
  return DISPOSABLE_EMAIL_DOMAINS.has(domain)
}

// ─── IP rate limit (referral activations) ────────────────────────────────────
const DEFAULT_IP_WINDOW_HOURS = 24
const DEFAULT_IP_MAX_ACTIVATIONS = 5

export type RateLimitResult = {
  allowed: boolean
  count: number
  limit: number
  windowHours: number
}

export async function checkReferralIpRateLimit(
  ip: string | null,
  opts?: { windowHours?: number; max?: number },
): Promise<RateLimitResult> {
  const windowHours = opts?.windowHours ?? DEFAULT_IP_WINDOW_HOURS
  const max = opts?.max ?? DEFAULT_IP_MAX_ACTIVATIONS

  // Localhost / no-IP fallback — never rate-limit (dev environment)
  if (!ip || ip === '127.0.0.1' || ip === '::1' || ip === 'unknown') {
    return { allowed: true, count: 0, limit: max, windowHours }
  }

  const admin = getAdmin()
  const since = new Date(Date.now() - windowHours * 3600 * 1000).toISOString()

  // Count successful referral activations from this IP in the window
  const { count } = await admin
    .from('referral_rewards')
    .select('*', { count: 'exact', head: true })
    .eq('signup_ip', ip)
    .gte('created_at', since)

  const used = count ?? 0
  return {
    allowed: used < max,
    count: used,
    limit: max,
    windowHours,
  }
}

// ─── Honeypot field detection ────────────────────────────────────────────────
// We add a hidden `website` input to the signup/referral form. Real users
// never see/fill it; bots auto-complete every field. If it's present and
// non-empty, we silently reject.
export function isHoneypotTriggered(body: Record<string, unknown> | null): boolean {
  if (!body) return false
  // Common honeypot field names — accept any of them as positive signal
  const fields = ['website', 'url', 'company_url', 'phone_number_alt']
  return fields.some((f) => {
    const val = body[f]
    return typeof val === 'string' && val.trim().length > 0
  })
}

// ─── Forensic log (always succeeds) ──────────────────────────────────────────
export async function logSignupAttempt(params: {
  ip: string | null
  fingerprint: string | null
  email: string | null
  succeeded: boolean
}): Promise<void> {
  try {
    const admin = getAdmin()
    await admin.from('signup_attempts').insert({
      ip: params.ip,
      fingerprint: params.fingerprint,
      email: params.email,
      succeeded: params.succeeded,
    })
  } catch (err) {
    // Never let logging failures break the request
    console.error('signup_attempts log failed:', err)
  }
}
