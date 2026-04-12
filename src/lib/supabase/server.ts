import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export function createClient() {
  const cookieStore = cookies()

  const cookieOpts = {
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax' as const,
    secure: true,
  }

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: cookieOpts,
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, { ...options, ...cookieOpts })
            )
          } catch {
            // setAll é chamado de Server Component onde não é possível setar cookies.
            // Pode ser ignorado se o middleware estiver atualizando a sessão.
          }
        },
      },
    }
  )
}
