'use client'

import { useEffect } from 'react'

/**
 * Checks localStorage for a pending referral code (set when user
 * visited with ?ref=CODE) and applies it via the API.
 * Renders nothing — just a side-effect component.
 */
export default function ReferralApplier() {
  useEffect(() => {
    const code = localStorage.getItem('referral_code')
    if (!code) return

    fetch('/api/referral/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ referral_code: code }),
    })
      .then(() => localStorage.removeItem('referral_code'))
      .catch(() => {
        // Keep it for next attempt — non-critical
      })
  }, [])

  return null
}
