import { createBrowserClient } from '@supabase/ssr'

// Branch preview deploys on Vercel don't have NEXT_PUBLIC_SUPABASE_* set,
// only Production does. createBrowserClient throws synchronously at module
// evaluation time when these are undefined, breaking prerender of every
// page that imports this. Fall back to placeholders during build so the
// prerender shell can render — at runtime in any real env, the actual
// values are inlined into the bundle and the placeholders never run.
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key'

export function createClient() {
  return createBrowserClient(URL, KEY, {
    cookieOptions: {
      path: '/',
      maxAge: 60 * 60 * 24 * 365, // 1 year
      sameSite: 'lax' as const,
      secure: process.env.NODE_ENV === 'production',
    },
  })
}
