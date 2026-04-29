import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { inferCityFromPhone } from '@/lib/ddd'

export const dynamic = 'force-dynamic'

// POST /api/me/phone — body { phone: string }
//
// Sets the authenticated user's phone if (and only if) it is currently
// empty. Used to attach the WhatsApp number captured by /register before
// signup. Refuses to overwrite an existing phone.
//
// Side effect: if the user has no city/state and no GPS coordinates yet,
// infer a coarse city from the DDD (area code) so they can show up in
// city-level rankings/trades right away. The values are overwritten the
// moment the user grants GPS or types a precise neighborhood.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const phone = String(body.phone ?? '').replace(/\D/g, '')

  if (!/^\d{10,13}$/.test(phone)) {
    return NextResponse.json({ error: 'invalid phone' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('phone, city, location_lat')
    .eq('id', user.id)
    .single()

  if (profile?.phone) {
    return NextResponse.json({ ok: true, skipped: 'already_set' })
  }

  const update: { phone: string; city?: string; state?: string } = { phone }

  // Only fill city from DDD when we have nothing better yet — never overwrite
  // an existing city (which would have come from GPS or manual entry).
  if (!profile?.city && profile?.location_lat == null) {
    const inferred = inferCityFromPhone(phone)
    if (inferred) {
      update.city = inferred.city
      update.state = inferred.state
    }
  }

  const { error } = await supabase.from('profiles').update(update).eq('id', user.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    updated: true,
    inferred_city: update.city ?? null,
  })
}
