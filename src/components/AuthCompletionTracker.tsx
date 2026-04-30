'use client'

import { useEffect } from 'react'
import { track } from '@vercel/analytics'
import { trackClient, FUNNEL_EVENTS } from '@/lib/funnel-client'

const STORAGE_KEY = 'auth_completed_tracked'

export default function AuthCompletionTracker() {
  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY) === 'true') return
    // Vercel Analytics (existing)
    track('auth_completed')
    // Server-side funnel (new) — server uses track-once so a user clearing
    // localStorage or going incognito won't double-count.
    trackClient(FUNNEL_EVENTS.SIGNUP_COMPLETED)
    localStorage.setItem(STORAGE_KEY, 'true')
  }, [])

  return null
}
