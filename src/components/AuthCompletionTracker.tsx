'use client'

import { useEffect } from 'react'
import { track } from '@vercel/analytics'

const STORAGE_KEY = 'auth_completed_tracked'

export default function AuthCompletionTracker() {
  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY) === 'true') return
    track('auth_completed')
    localStorage.setItem(STORAGE_KEY, 'true')
  }, [])

  return null
}
