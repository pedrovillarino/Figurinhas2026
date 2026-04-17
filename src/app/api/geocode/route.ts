import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { checkRateLimit, getIp, generalLimiter } from '@/lib/ratelimit'

export const dynamic = 'force-dynamic'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

interface NominatimAddress {
  city?: string
  town?: string
  village?: string
  state?: string
}

/**
 * POST /api/geocode
 *
 * Reverse-geocodes lat/lng to city and state using Nominatim,
 * then updates the user's profile.
 *
 * Body: { lat: number, lng: number }
 */
export async function POST(req: NextRequest) {
  // Rate limit
  const rlResponse = await checkRateLimit(getIp(req), generalLimiter)
  if (rlResponse) return rlResponse

  try {
    // 1. Auth
    const cookieStore = cookies()
    const supabaseAuth = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll() },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              )
            } catch {}
          },
        },
      }
    )
    const { data: { user } } = await supabaseAuth.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }

    // 2. Parse and validate body
    const body = await req.json()
    const { lat, lng } = body

    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return NextResponse.json({ error: 'lat e lng devem ser números.' }, { status: 400 })
    }

    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return NextResponse.json({ error: 'Coordenadas fora do intervalo válido.' }, { status: 400 })
    }

    // 3. Reverse geocode via Nominatim
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=pt`

    const geoResponse = await fetch(url, {
      headers: {
        'User-Agent': 'CompleteAi/1.0 (contato@completeai.com.br)',
      },
    })

    if (!geoResponse.ok) {
      console.error('[geocode] Nominatim error:', geoResponse.status, await geoResponse.text())
      return NextResponse.json({ error: 'Erro ao buscar localização.' }, { status: 502 })
    }

    const geoData = await geoResponse.json()
    const address: NominatimAddress = geoData.address || {}

    const city = address.city || address.town || address.village || null
    const state = address.state || null

    // 4. Update profile with city and state
    const admin = getAdmin()

    const { error: updateError } = await admin
      .from('profiles')
      .update({ city, state })
      .eq('id', user.id)

    if (updateError) {
      console.error('[geocode] Profile update error:', updateError)
      return NextResponse.json({ error: 'Erro ao atualizar perfil.' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, city, state })
  } catch (err) {
    console.error('[geocode] Error:', err)
    return NextResponse.json({ error: 'Erro ao processar localização.' }, { status: 500 })
  }
}
