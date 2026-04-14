'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

/**
 * Listens for Supabase auth state changes (token refresh, sign-out)
 * and triggers a Next.js router refresh so the middleware re-runs
 * with the updated cookies. This prevents "phantom logouts" where
 * the access token expires while the tab is in background.
 */
export default function AuthRefresh() {
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_OUT') {
        router.refresh()
      }
    })

    // Also refresh when the tab regains focus (handles background token expiry)
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        // getUser() triggers token refresh internally if access token expired
        supabase.auth.getUser()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      subscription.unsubscribe()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [router, supabase])

  return null
}
