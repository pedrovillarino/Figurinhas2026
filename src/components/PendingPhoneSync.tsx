'use client'

import { useEffect } from 'react'

// Reads the `pending_phone` cookie set by /register?phone=... and
// attaches the number to the authenticated user's profile via
// /api/me/phone. The cookie is cleared on success so this is a
// no-op on subsequent loads.
export default function PendingPhoneSync() {
  useEffect(() => {
    const match = document.cookie.match(/(?:^|;\s*)pending_phone=(\d+)/)
    if (!match) return
    const phone = match[1]

    fetch('/api/me/phone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    })
      .then((res) => {
        if (res.ok) {
          document.cookie = 'pending_phone=; path=/; max-age=0'
        }
      })
      .catch(() => {
        // Silently fail — cookie will be retried on next page load
      })
  }, [])

  return null
}
