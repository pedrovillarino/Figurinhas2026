// Modal coordinator — keeps only one modal visible at a time and enforces
// a cooldown between consecutive modals so the user doesn't get a stacking
// avalanche of popups (campanha + first-scan + onboarding + …).
//
// Priority (higher number = higher priority):
//   100  Onboarding (legal/age — must always run first)
//    80  FirstScanPrompt (new-user activation)
//    50  LaunchPromoModal (campaign — recurring)
//    30  Anything else
//
// Rules a caller follows:
//   1. Before showing → check shouldShowModal(name, priority).
//   2. If allowed → call markModalOpen(name) to claim the slot.
//   3. On dismiss → call markModalClosed(name).
//
// Inline banners (e.g. ScanFeedback) DON'T use this — they're not modals.

const ACTIVE_KEY = 'modal_coordinator_active'
const LAST_CLOSED_KEY = 'modal_coordinator_last_closed_at'
// Minimum gap between any two modals (seconds). 60s feels invisible to users
// who close fast but blocks the worst stacking.
const COOLDOWN_MS = 60 * 1000

export const MODAL_PRIORITY = {
  ONBOARDING: 100,
  FIRST_SCAN_PROMPT: 80,
  LAUNCH_PROMO: 50,
  DEFAULT: 30,
} as const

type ActiveEntry = { name: string; priority: number; opened_at: number }

function getActive(): ActiveEntry | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(ACTIVE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ActiveEntry
    // Stale lock: if a modal claimed slot >5min ago and never closed, free it
    if (Date.now() - parsed.opened_at > 5 * 60 * 1000) {
      sessionStorage.removeItem(ACTIVE_KEY)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function getLastClosedAt(): number {
  if (typeof window === 'undefined') return 0
  const v = sessionStorage.getItem(LAST_CLOSED_KEY)
  return v ? parseInt(v, 10) : 0
}

/**
 * Returns true if the caller is allowed to open its modal right now.
 * Same-session reasoning only (uses sessionStorage), so a fresh tab gets
 * a clean slate.
 */
export function shouldShowModal(name: string, priority: number): boolean {
  if (typeof window === 'undefined') return false

  const active = getActive()
  if (active) {
    // Another modal currently visible. Only override if we have STRICTLY
    // higher priority — otherwise wait.
    return priority > active.priority
  }

  // Cooldown after the last close
  const lastClosed = getLastClosedAt()
  if (lastClosed > 0 && Date.now() - lastClosed < COOLDOWN_MS) {
    return false
  }

  return true
}

/** Mark a modal as currently visible. Idempotent for the same name. */
export function markModalOpen(name: string, priority: number): void {
  if (typeof window === 'undefined') return
  const entry: ActiveEntry = { name, priority, opened_at: Date.now() }
  sessionStorage.setItem(ACTIVE_KEY, JSON.stringify(entry))
}

/** Release the slot. Always pair with markModalOpen. */
export function markModalClosed(name: string): void {
  if (typeof window === 'undefined') return
  const active = getActive()
  if (active && active.name !== name) return // Don't accidentally clear someone else's slot
  sessionStorage.removeItem(ACTIVE_KEY)
  sessionStorage.setItem(LAST_CLOSED_KEY, String(Date.now()))
}
