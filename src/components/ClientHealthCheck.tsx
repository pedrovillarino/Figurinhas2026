'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import * as Sentry from '@sentry/nextjs'

/**
 * Invisible component that verifies client-side Supabase connectivity.
 * Runs once on mount. If the browser can't reach Supabase (e.g., CSP
 * blocking, DNS issue, custom domain misconfiguration), it reports
 * the error to Sentry so we get alerted immediately.
 *
 * This catches the exact class of bug where server-side works fine
 * but client-side is silently broken (like a CSP connect-src miss).
 */
export default function ClientHealthCheck() {
  useEffect(() => {
    const check = async () => {
      try {
        const supabase = createClient()

        // Simple query — if CSP or network blocks this, we catch it
        const { error } = await supabase
          .from('stickers')
          .select('id', { count: 'exact', head: true })

        if (error) {
          Sentry.captureMessage(
            `[ClientHealthCheck] Supabase client-side query failed: ${error.message}`,
            { level: 'error', tags: { component: 'health-check', type: 'supabase-query' } }
          )
          console.error('[ClientHealthCheck] Supabase query error:', error.message)
        }
      } catch (err) {
        // Network/CSP errors land here
        Sentry.captureException(err, {
          tags: { component: 'health-check', type: 'network-or-csp' },
          extra: {
            supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
            hint: 'Client cannot reach Supabase. Check CSP connect-src, DNS, or custom domain config.',
          },
        })
        console.error('[ClientHealthCheck] Cannot reach Supabase from browser:', err)
      }
    }

    // Run after a short delay so it doesn't compete with page load
    const timer = setTimeout(check, 3000)
    return () => clearTimeout(timer)
  }, [])

  return null // Invisible component
}
