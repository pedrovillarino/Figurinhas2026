import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/album'

  if (code) {
    const cookieStore = cookies()

    const cookieOptions = {
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'lax' as const,
      secure: true,
    }

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookieOptions,
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, { ...options, ...cookieOptions })
              )
            } catch {}
          },
        },
      }
    )

    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      // Generate referral code if user doesn't have one
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          const supabaseAdmin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            { auth: { autoRefreshToken: false, persistSession: false } }
          )

          const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('referral_code')
            .eq('id', user.id)
            .single()

          if (profile && !profile.referral_code) {
            // Generate a random 6-char alphanumeric code
            const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
            let referralCode = ''
            for (let i = 0; i < 6; i++) {
              referralCode += chars[Math.floor(Math.random() * chars.length)]
            }
            await supabaseAdmin
              .from('profiles')
              .update({ referral_code: referralCode })
              .eq('id', user.id)
          }
        }
      } catch (e) {
        console.error('Error generating referral code:', e)
      }

      return NextResponse.redirect(`${origin}${next}`)
    }

    console.error('Auth callback error:', error.message)
  }

  // If there's an error param from the OAuth provider, log it
  const errorParam = searchParams.get('error')
  const errorDesc = searchParams.get('error_description')
  if (errorParam) {
    console.error('OAuth error:', errorParam, errorDesc)
  }

  return NextResponse.redirect(`${origin}/?error=auth`)
}
