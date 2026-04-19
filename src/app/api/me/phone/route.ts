import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// POST /api/me/phone — body { phone: string }
//
// Sets the authenticated user's phone if (and only if) it is currently
// empty. Used to attach the WhatsApp number captured by /register before
// signup. Refuses to overwrite an existing phone.
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
    .select('phone')
    .eq('id', user.id)
    .single()

  if (profile?.phone) {
    return NextResponse.json({ ok: true, skipped: 'already_set' })
  }

  const { error } = await supabase.from('profiles').update({ phone }).eq('id', user.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, updated: true })
}
