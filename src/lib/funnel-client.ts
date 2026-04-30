// Client-side helper for the funnel beacon endpoint.
// Use this from React components to record view/click events.
//
// All calls are fire-and-forget — never await, never throw.

import { FUNNEL_EVENTS, type FunnelEventName } from './funnel'

export { FUNNEL_EVENTS }
export type { FunnelEventName }

export function trackClient(event: FunnelEventName, metadata?: Record<string, unknown>) {
  if (typeof window === 'undefined') return
  // Use keepalive so the request survives page unload (e.g. user clicks
  // upgrade then navigates away)
  fetch('/api/funnel/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, metadata }),
    keepalive: true,
  }).catch(() => { /* swallow */ })
}
