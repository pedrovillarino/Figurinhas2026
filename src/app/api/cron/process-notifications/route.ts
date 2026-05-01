import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendText, formatPhone } from '@/lib/zapi'
import { sendEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// ─── Match-digest cron — runs daily at 12h UTC (9h BRT) ──────────────────
// Was hourly, but Vercel Hobby plan limits crons to 1x/day. Daily is enough
// because cooldowns are 1d (configured) / 3d (not configured) anyway. If we
// ever upgrade to Pro, can bump to hourly and the quiet-hours guard below
// will start mattering.
//
// Drains the `match_candidates` queue (filled by /api/notify-matches on each
// scan) and sends ONE consolidated digest per recipient with all the trade
// opportunities currently available within their radius, ranked by
// (distance ASC, sticker count DESC).
//
// Spam controls (Pedro's spec, 2026-05-01):
//   - Quiet hours 22h–8h BRT → skip the entire run
//   - Cooldown per recipient:
//       · notify_configured = false  → 3 days between notifications
//       · notify_configured = true   → 1 day  (cap minimum, even if user
//                                              configured aggressive prefs)
//   - Channel='none' → opted out, never notified
//
// Re-validation at send time (state may have changed since enqueue):
//   - Scanner still has the sticker as 'duplicate'
//   - Recipient still doesn't own the sticker
//   - No pending or recent (24h) trade between the pair
//
// TTL: rows older than 7 days are deleted at the end of the run, even if
// the recipient was never reachable, to keep the queue from growing forever.

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.completeai.com.br'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

const COOLDOWN_NOT_CONFIGURED_MS = 3 * 24 * 60 * 60 * 1000
const COOLDOWN_CONFIGURED_MS = 24 * 60 * 60 * 1000
const CANDIDATE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const CANDIDATE_FRESHNESS_MS = 3 * 24 * 60 * 60 * 1000 // only consider last 3 days

type Candidate = {
  recipient_id: string
  scanner_id: string
  sticker_id: number
  distance_km: number
  is_priority: boolean
  created_at: string
}

type RecipientProfile = {
  id: string
  display_name: string | null
  phone: string | null
  email: string | null
  notify_channel: string | null
  notify_configured: boolean | null
  notify_min_threshold: number | null
  notify_priority_stickers: number[] | null
  notify_radius_km: number | null
  last_match_notified_at: string | null
}

type ScannerInfo = {
  id: string
  display_name: string | null
}

type StickerInfo = {
  id: number
  number: string
  player_name: string | null
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Quiet hours guard ──
  // BRT = UTC-3 (no DST in Brazil since 2019). The cron fires hourly in UTC,
  // so we compare against São Paulo wall-clock time and bail during 22h–8h.
  const nowSP = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
  const hourBRT = nowSP.getHours()
  if (hourBRT < 8 || hourBRT >= 22) {
    return NextResponse.json({ ok: true, skipped: 'quiet-hours', hourBRT })
  }

  const supabase = getAdmin()
  const result = { recipients: 0, sent: 0, skipped: 0, errors: 0, gc: 0 }

  try {
    // 1. Pull all fresh candidates (<3 days old). One query, then group in memory.
    const freshSince = new Date(Date.now() - CANDIDATE_FRESHNESS_MS).toISOString()
    const { data: rawCandidates, error: candErr } = await supabase
      .from('match_candidates')
      .select('recipient_id, scanner_id, sticker_id, distance_km, is_priority, created_at')
      .gte('created_at', freshSince)
      .order('recipient_id')

    if (candErr) {
      console.error('[notif-cron] candidate fetch error:', candErr)
      return NextResponse.json({ ok: false, error: 'fetch_failed' }, { status: 500 })
    }
    const candidates = (rawCandidates || []) as Candidate[]
    if (candidates.length === 0) {
      return NextResponse.json({ ok: true, ...result })
    }

    // 2. Group by recipient
    const byRecipient = new Map<string, Candidate[]>()
    for (const c of candidates) {
      if (!byRecipient.has(c.recipient_id)) byRecipient.set(c.recipient_id, [])
      byRecipient.get(c.recipient_id)!.push(c)
    }
    result.recipients = byRecipient.size

    // 3. Bulk-fetch all relevant profiles + stickers + ownership + trades upfront
    //    so the per-recipient loop has no DB queries.
    const recipientIds = Array.from(byRecipient.keys())
    const scannerIds = Array.from(new Set(candidates.map((c) => c.scanner_id)))
    const stickerIds = Array.from(new Set(candidates.map((c) => c.sticker_id)))
    const allUserIds = Array.from(new Set([...recipientIds, ...scannerIds]))

    const [
      { data: profiles },
      { data: stickers },
      { data: ownerships },
      { data: trades },
      { data: scannerDupes },
    ] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, display_name, phone, email, notify_channel, notify_configured, notify_min_threshold, notify_priority_stickers, notify_radius_km, last_match_notified_at')
        .in('id', allUserIds),
      supabase
        .from('stickers')
        .select('id, number, player_name')
        .in('id', stickerIds),
      // Recipient ownership of these stickers (to filter out what they already have)
      supabase
        .from('user_stickers')
        .select('user_id, sticker_id, status')
        .in('user_id', recipientIds)
        .in('sticker_id', stickerIds),
      // Trade history between any recipient/scanner pair we care about
      supabase
        .from('trade_requests')
        .select('requester_id, target_id, status, created_at')
        .or(`requester_id.in.(${allUserIds.join(',')}),target_id.in.(${allUserIds.join(',')})`),
      // Scanner still has the sticker as duplicate?
      supabase
        .from('user_stickers')
        .select('user_id, sticker_id')
        .in('user_id', scannerIds)
        .in('sticker_id', stickerIds)
        .eq('status', 'duplicate'),
    ])

    const profileById = new Map<string, RecipientProfile>()
    for (const p of (profiles || []) as RecipientProfile[]) profileById.set(p.id, p)

    const stickerById = new Map<number, StickerInfo>()
    for (const s of (stickers || []) as StickerInfo[]) stickerById.set(s.id, s)

    // recipientOwned: user → set of sticker_ids they currently OWN (any status that means "got it")
    const recipientOwned = new Map<string, Set<number>>()
    for (const us of (ownerships || []) as Array<{ user_id: string; sticker_id: number; status: string }>) {
      if (!recipientOwned.has(us.user_id)) recipientOwned.set(us.user_id, new Set())
      recipientOwned.get(us.user_id)!.add(us.sticker_id)
    }

    // scannerStillHas: scanner → set of sticker_ids they STILL have as duplicate
    const scannerStillHas = new Map<string, Set<number>>()
    for (const us of (scannerDupes || []) as Array<{ user_id: string; sticker_id: number }>) {
      if (!scannerStillHas.has(us.user_id)) scannerStillHas.set(us.user_id, new Set())
      scannerStillHas.get(us.user_id)!.add(us.sticker_id)
    }

    // tradeBlocked: pair "scannerId|recipientId" → true if pending OR recent (24h)
    const tradeBlocked = new Set<string>()
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000
    for (const tr of (trades || []) as Array<{ requester_id: string; target_id: string; status: string; created_at: string }>) {
      const isPending = tr.status === 'pending' || tr.status === 'approved'
      const isRecent = new Date(tr.created_at).getTime() > oneDayAgo
      if (!isPending && !isRecent) continue
      tradeBlocked.add(`${tr.requester_id}|${tr.target_id}`)
      tradeBlocked.add(`${tr.target_id}|${tr.requester_id}`)
    }

    // 4. Process each recipient
    const consumedCandidateRecipientIds: string[] = []

    for (const [recipientId, recCandidates] of Array.from(byRecipient.entries())) {
      const profile = profileById.get(recipientId)
      if (!profile) {
        result.skipped++
        continue
      }

      const channel = profile.notify_channel || 'whatsapp'
      if (channel === 'none') {
        // Opted out — drop their candidates so the queue doesn't grow
        consumedCandidateRecipientIds.push(recipientId)
        result.skipped++
        continue
      }

      // Cooldown
      const cooldownMs = profile.notify_configured
        ? COOLDOWN_CONFIGURED_MS
        : COOLDOWN_NOT_CONFIGURED_MS
      if (profile.last_match_notified_at) {
        const since = Date.now() - new Date(profile.last_match_notified_at).getTime()
        if (since < cooldownMs) {
          result.skipped++
          continue
        }
      }

      const radiusKm = profile.notify_radius_km || 50
      const minThreshold = profile.notify_min_threshold || 1
      const prioritySet = new Set(profile.notify_priority_stickers || [])

      // Re-validate each candidate
      type ValidCandidate = Candidate & { sticker: StickerInfo }
      const valid: ValidCandidate[] = []
      const ownedByRecipient = recipientOwned.get(recipientId) || new Set()

      for (const c of recCandidates) {
        if (c.distance_km > radiusKm) continue
        if (ownedByRecipient.has(c.sticker_id)) continue
        const stillHas = scannerStillHas.get(c.scanner_id)
        if (!stillHas || !stillHas.has(c.sticker_id)) continue
        if (tradeBlocked.has(`${c.scanner_id}|${recipientId}`)) continue
        const sticker = stickerById.get(c.sticker_id)
        if (!sticker) continue
        valid.push({ ...c, sticker, is_priority: c.is_priority || prioritySet.has(c.sticker_id) })
      }

      if (valid.length === 0) {
        // Nothing valid to send — drop the (now stale) candidates
        consumedCandidateRecipientIds.push(recipientId)
        result.skipped++
        continue
      }

      // Group by scanner
      type ScannerGroup = {
        scannerId: string
        scannerName: string
        distanceKm: number
        stickers: { number: string; is_priority: boolean }[]
        hasPriority: boolean
      }
      const byScanner = new Map<string, ScannerGroup>()
      for (const v of valid) {
        if (!byScanner.has(v.scanner_id)) {
          const s = profileById.get(v.scanner_id) as ScannerInfo | undefined
          byScanner.set(v.scanner_id, {
            scannerId: v.scanner_id,
            scannerName: s?.display_name?.split(' ')[0] || 'Alguém',
            distanceKm: v.distance_km,
            stickers: [],
            hasPriority: false,
          })
        }
        const g = byScanner.get(v.scanner_id)!
        // Use closest distance recorded for this scanner
        if (v.distance_km < g.distanceKm) g.distanceKm = v.distance_km
        g.stickers.push({ number: v.sticker.number, is_priority: v.is_priority })
        if (v.is_priority) g.hasPriority = true
      }

      // Apply threshold to total opportunities
      const totalOpps = valid.length
      const hasAnyPriority = Array.from(byScanner.values()).some((g) => g.hasPriority)
      if (!hasAnyPriority && totalOpps < minThreshold) {
        // Don't burn the cooldown for sub-threshold runs — just drop and wait
        consumedCandidateRecipientIds.push(recipientId)
        result.skipped++
        continue
      }

      // Rank scanners: distance ASC, sticker count DESC, priority first
      const groups = Array.from(byScanner.values()).sort((a, b) => {
        if (a.hasPriority !== b.hasPriority) return a.hasPriority ? -1 : 1
        if (a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm
        return b.stickers.length - a.stickers.length
      })

      // Render WhatsApp message
      const TOP_SCANNERS = 5
      const top = groups.slice(0, TOP_SCANNERS)
      const moreScanners = groups.length - top.length

      const lines = top.map((g) => {
        const distStr = g.distanceKm < 1 ? '<1km' : `${Math.round(g.distanceKm)}km`
        const stickersText = g.stickers
          .slice(0, 8)
          .map((s) => (s.is_priority ? `⭐${s.number}` : s.number))
          .join(', ')
        const tail = g.stickers.length > 8 ? ` e +${g.stickers.length - 8}` : ''
        return `📍 *${g.scannerName}* (${distStr}) — ${g.stickers.length} fig.: ${stickersText}${tail}`
      })

      const moreLine = moreScanners > 0 ? `\n_+${moreScanners} colecionador${moreScanners > 1 ? 'es' : ''} também perto_` : ''
      const priorityNote = hasAnyPriority ? '\n⭐ Inclui figurinhas prioritárias!' : ''

      const msg =
        `🔔 *Novidades de trocas perto de você*\n\n` +
        `Tem *${totalOpps}* figurinha${totalOpps > 1 ? 's' : ''} disponível${totalOpps > 1 ? 'is' : ''} em ${groups.length} colecionador${groups.length > 1 ? 'es' : ''} perto:\n\n` +
        lines.join('\n') +
        moreLine +
        priorityNote +
        `\n\nSolicita as trocas no app:\n${APP_URL}/trades`

      // Send via channel(s)
      const phone = profile.phone ? formatPhone(profile.phone) : null
      let sent = false

      if ((channel === 'whatsapp' || channel === 'both') && phone) {
        try {
          const ok = await sendText(phone, msg)
          if (ok) sent = true
          // Throttle to avoid Z-API rate limit
          await new Promise((r) => setTimeout(r, 1100))
        } catch (err) {
          console.error(`[notif-cron] WhatsApp failed for ${recipientId}:`, err)
        }
      }

      const shouldEmail =
        channel === 'email' ||
        channel === 'both' ||
        (channel === 'whatsapp' && !sent)

      if (shouldEmail && profile.email) {
        const html = renderDigestEmail(top, totalOpps, groups.length, hasAnyPriority, moreScanners)
        const subject = `🔔 ${totalOpps} figurinha${totalOpps > 1 ? 's' : ''} disponível${totalOpps > 1 ? 'is' : ''} perto de você`
        const ok = await sendEmail(profile.email, subject, html)
        if (ok) sent = true
      }

      if (sent) {
        await supabase
          .from('profiles')
          .update({ last_match_notified_at: new Date().toISOString() })
          .eq('id', recipientId)
        consumedCandidateRecipientIds.push(recipientId)
        result.sent++
      } else {
        result.errors++
      }
    }

    // 5. Drop consumed candidates (sent, opted-out, threshold-not-met, all-stale)
    if (consumedCandidateRecipientIds.length > 0) {
      await supabase
        .from('match_candidates')
        .delete()
        .in('recipient_id', consumedCandidateRecipientIds)
    }

    // 6. TTL gc — drop anything older than 7 days regardless of recipient
    const ttlCutoff = new Date(Date.now() - CANDIDATE_TTL_MS).toISOString()
    const { count: gcCount } = await supabase
      .from('match_candidates')
      .delete({ count: 'exact' })
      .lt('created_at', ttlCutoff)
    result.gc = gcCount || 0

    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[notif-cron] error:', err)
    return NextResponse.json({ ok: false, error: String(err), ...result }, { status: 500 })
  }
}

function renderDigestEmail(
  top: Array<{ scannerName: string; distanceKm: number; stickers: { number: string; is_priority: boolean }[]; hasPriority: boolean }>,
  totalOpps: number,
  totalScanners: number,
  hasAnyPriority: boolean,
  moreScanners: number,
): string {
  const priorityBadge = hasAnyPriority
    ? `<div style="background: #FEF3C7; border-radius: 8px; padding: 8px 12px; margin-bottom: 12px; text-align: center;">
         <span style="color: #92400E; font-size: 13px; font-weight: 600;">⭐ Inclui figurinhas prioritárias!</span>
       </div>`
    : ''

  const cards = top
    .map((g) => {
      const distStr = g.distanceKm < 1 ? '< 1km' : `${Math.round(g.distanceKm)}km`
      const stickerList = g.stickers
        .slice(0, 12)
        .map((s) => (s.is_priority ? `⭐ ${s.number}` : s.number))
        .join(', ')
      const tail = g.stickers.length > 12 ? ` e +${g.stickers.length - 12}` : ''
      return `
        <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 14px; margin-bottom: 8px;">
          <p style="margin: 0; font-weight: 600; color: #0A1628; font-size: 14px;">📍 ${g.scannerName} <span style="color: #6b7280; font-weight: 400;">(${distStr})</span></p>
          <p style="margin: 4px 0 0; color: #374151; font-size: 13px;"><strong>${g.stickers.length} figurinha${g.stickers.length > 1 ? 's' : ''}:</strong> ${stickerList}${tail}</p>
        </div>`
    })
    .join('')

  const moreNote = moreScanners > 0
    ? `<p style="text-align: center; color: #6b7280; font-size: 12px; margin: 12px 0 0;">+${moreScanners} colecionador${moreScanners > 1 ? 'es' : ''} também perto</p>`
    : ''

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <h1 style="color: #0A1628; font-size: 22px; margin: 0;">🔔 Novidades perto de você</h1>
        <p style="color: #6b7280; font-size: 14px; margin: 8px 0 0;">${totalOpps} figurinha${totalOpps > 1 ? 's' : ''} em ${totalScanners} colecionador${totalScanners > 1 ? 'es' : ''}</p>
      </div>
      ${priorityBadge}
      <div style="background: #f8fafc; border-radius: 12px; padding: 16px;">
        ${cards}
        ${moreNote}
      </div>
      <div style="text-align: center; margin-top: 24px;">
        <a href="${APP_URL}/trades" style="display: inline-block; background: #00C896; color: white; padding: 14px 40px; border-radius: 10px; font-weight: bold; font-size: 15px; text-decoration: none;">
          🔄 Ver e solicitar trocas
        </a>
      </div>
      <p style="text-align: center; color: #9ca3af; font-size: 11px; margin-top: 24px;">
        Complete Aí — Seu álbum de figurinhas
      </p>
    </div>
  `
}
