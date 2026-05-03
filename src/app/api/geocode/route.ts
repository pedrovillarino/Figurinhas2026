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
 * Two modes, picked by what's in the body:
 *
 * 1. REVERSE — body { lat, lng }: turn coordinates into city/state. Used
 *    after the browser geolocation grant. Updates city/state.
 *
 * 2. FORWARD — body { city, neighborhood?, state? }: turn a typed
 *    cidade/bairro into approximate lat/lng (centroid of the named place
 *    via Nominatim) so the user shows up in proximity-based rankings and
 *    trades even without granting GPS. Updates city/state AND
 *    location_lat/location_lng (overwriting any DDD-only city).
 *
 * Both modes share auth, rate limiting, sanitization, and the Nominatim
 * timeout. Either lat+lng OR city must be provided.
 */
export async function POST(req: NextRequest) {
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

    const body = await req.json()
    const { lat, lng, city: bodyCity, neighborhood: bodyNeighborhood, state: bodyState, cep: bodyCep } = body

    const sanitize = (s: string | undefined) =>
      s ? s.replace(/[<>"'&;]/g, '').trim().slice(0, 100) || null : null

    const admin = getAdmin()

    // ── CEP: 8 dígitos → cidade/state via ViaCEP, depois forward → lat/lng ──
    // Pedro 2026-05-03: nudge de CEP. ViaCEP é gratuito e brasileiro.
    if (bodyCep) {
      const cepDigits = String(bodyCep).replace(/\D/g, '')
      if (cepDigits.length !== 8) {
        return NextResponse.json({ error: 'CEP inválido. Tem que ter 8 dígitos.' }, { status: 400 })
      }
      try {
        const viacepRes = await fetch(`https://viacep.com.br/ws/${cepDigits}/json/`, {
          signal: AbortSignal.timeout(6000),
        })
        if (!viacepRes.ok) {
          return NextResponse.json({ error: 'Erro ao consultar CEP.' }, { status: 502 })
        }
        const viacepData = await viacepRes.json()
        if (viacepData.erro) {
          return NextResponse.json({ error: 'CEP não encontrado.' }, { status: 404 })
        }
        const cepCity = sanitize(viacepData.localidade)
        const cepState = sanitize(viacepData.uf)
        const cepNeighborhood = sanitize(viacepData.bairro)
        if (!cepCity) {
          return NextResponse.json({ error: 'CEP sem cidade.' }, { status: 502 })
        }
        // Forward geocode (cidade + bairro → lat/lng) reusando código abaixo
        // Substitui as variáveis e cai no fluxo FORWARD
        ;(body as Record<string, unknown>).city = cepCity
        ;(body as Record<string, unknown>).state = cepState
        ;(body as Record<string, unknown>).neighborhood = cepNeighborhood
        // Reatribui pra escopo local
        const cleanCity = cepCity
        const cleanState = cepState
        const cleanNeighborhood = cepNeighborhood

        const params = new URLSearchParams({
          format: 'json',
          country: 'Brazil',
          city: cleanCity,
          'accept-language': 'pt',
          limit: '1',
        })
        if (cleanState) params.set('state', cleanState)
        const url = `https://nominatim.openstreetmap.org/search?${params.toString()}${cleanNeighborhood ? `&q=${encodeURIComponent(`${cleanNeighborhood}, ${cleanCity}, Brasil`)}` : ''}`

        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 8000)
        const geoResponse = await fetch(url, {
          headers: { 'User-Agent': 'CompleteAi/1.0 (contato@completeai.com.br)' },
          signal: controller.signal,
        })
        clearTimeout(timeout)
        if (!geoResponse.ok) {
          return NextResponse.json({ error: 'Erro ao buscar localização do CEP.' }, { status: 502 })
        }
        const results = await geoResponse.json()
        if (!Array.isArray(results) || results.length === 0) {
          // CEP achou cidade mas Nominatim não geocodou — salva só cidade/estado
          await admin.from('profiles').update({
            city: cleanCity,
            state: cleanState ?? null,
            cep_nudge_dismissed_at: new Date().toISOString(),
          }).eq('id', user.id)
          return NextResponse.json({ ok: true, mode: 'cep', city: cleanCity, state: cleanState, lat: null, lng: null })
        }
        const top = results[0]
        const lat2 = parseFloat(top.lat)
        const lng2 = parseFloat(top.lon)
        const update: Record<string, unknown> = {
          city: cleanCity,
          state: cleanState ?? null,
          cep_nudge_dismissed_at: new Date().toISOString(),
        }
        if (Number.isFinite(lat2)) update.location_lat = lat2
        if (Number.isFinite(lng2)) update.location_lng = lng2
        await admin.from('profiles').update(update).eq('id', user.id)
        return NextResponse.json({ ok: true, mode: 'cep', city: cleanCity, state: cleanState, neighborhood: cleanNeighborhood, lat: lat2, lng: lng2 })
      } catch (err) {
        const isAbort = err instanceof Error && err.name === 'AbortError'
        return NextResponse.json({ error: isAbort ? 'CEP demorou pra responder.' : 'Erro ao consultar CEP.' }, { status: 502 })
      }
    }

    // ── REVERSE: lat/lng → city/state ─────────────────────────────────
    if (typeof lat === 'number' && typeof lng === 'number') {
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return NextResponse.json({ error: 'Coordenadas fora do intervalo válido.' }, { status: 400 })
      }
      const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=pt`
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 8000)
      const geoResponse = await fetch(url, {
        headers: { 'User-Agent': 'CompleteAi/1.0 (contato@completeai.com.br)' },
        signal: controller.signal,
      })
      clearTimeout(timeout)
      if (!geoResponse.ok) {
        console.error('[geocode] Nominatim reverse error:', geoResponse.status, await geoResponse.text())
        return NextResponse.json({ error: 'Erro ao buscar localização.' }, { status: 502 })
      }
      const geoData = await geoResponse.json()
      const address: NominatimAddress = geoData.address || {}
      const city = sanitize(address.city || address.town || address.village)
      const state = sanitize(address.state)
      const { error: updateError } = await admin
        .from('profiles')
        .update({ city, state, cep_nudge_dismissed_at: new Date().toISOString() })
        .eq('id', user.id)
      if (updateError) {
        console.error('[geocode] Profile update error (reverse):', updateError)
        return NextResponse.json({ error: 'Erro ao atualizar perfil.' }, { status: 500 })
      }
      return NextResponse.json({ ok: true, mode: 'reverse', city, state })
    }

    // ── FORWARD: city (+ neighborhood) → lat/lng ──────────────────────
    const cleanCity = sanitize(bodyCity)
    if (!cleanCity) {
      return NextResponse.json({ error: 'Informe lat/lng OU cidade.' }, { status: 400 })
    }
    const cleanNeighborhood = sanitize(bodyNeighborhood)
    const cleanState = sanitize(bodyState)

    // Build Nominatim structured query: country=br + city + optional state/neighborhood.
    const params = new URLSearchParams({
      format: 'json',
      country: 'Brazil',
      city: cleanCity,
      'accept-language': 'pt',
      limit: '1',
    })
    if (cleanState) params.set('state', cleanState)

    const url = `https://nominatim.openstreetmap.org/search?${params.toString()}${cleanNeighborhood ? `&q=${encodeURIComponent(`${cleanNeighborhood}, ${cleanCity}, Brasil`)}` : ''}`

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    const geoResponse = await fetch(url, {
      headers: { 'User-Agent': 'CompleteAi/1.0 (contato@completeai.com.br)' },
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!geoResponse.ok) {
      console.error('[geocode] Nominatim forward error:', geoResponse.status, await geoResponse.text())
      return NextResponse.json({ error: 'Erro ao buscar localização.' }, { status: 502 })
    }

    const results = await geoResponse.json()
    if (!Array.isArray(results) || results.length === 0) {
      return NextResponse.json(
        { error: 'Não encontramos esse endereço. Confira a grafia da cidade e do bairro.' },
        { status: 404 },
      )
    }

    const top = results[0]
    const lat2 = parseFloat(top.lat)
    const lng2 = parseFloat(top.lon)
    if (!Number.isFinite(lat2) || !Number.isFinite(lng2)) {
      return NextResponse.json({ error: 'Endereço sem coordenadas válidas.' }, { status: 502 })
    }

    const update: Record<string, unknown> = {
      city: cleanCity,
      state: cleanState ?? null,
      location_lat: lat2,
      location_lng: lng2,
      cep_nudge_dismissed_at: new Date().toISOString(),
    }

    const { error: updateError } = await admin
      .from('profiles')
      .update(update)
      .eq('id', user.id)
    if (updateError) {
      console.error('[geocode] Profile update error (forward):', updateError)
      return NextResponse.json({ error: 'Erro ao atualizar perfil.' }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      mode: 'forward',
      city: cleanCity,
      state: cleanState,
      neighborhood: cleanNeighborhood,
      lat: lat2,
      lng: lng2,
    })
  } catch (err) {
    console.error('[geocode] Error:', err)
    return NextResponse.json({ error: 'Erro ao processar localização.' }, { status: 500 })
  }
}
