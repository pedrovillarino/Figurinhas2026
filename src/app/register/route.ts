import { NextRequest, NextResponse } from 'next/server'
import { normalizePhoneBR } from '@/lib/phone'

export const dynamic = 'force-dynamic'

// GET /register?phone=5521XXXXXXXXX
//
// Entry point for users coming from the WhatsApp bot's welcome message.
// Stores the phone number in a short-lived cookie so we can auto-attach
// it to the profile after the user finishes Google/email signup, then
// redirects to the home page with a hint flag for analytics.
export async function GET(req: NextRequest) {
  const phone = normalizePhoneBR(req.nextUrl.searchParams.get('phone'))

  const response = NextResponse.redirect(new URL('/?from=whatsapp', req.url))

  // Só armazena se ficou no formato canônico 13 dig (55+DDD+9+8)
  if (phone && /^55\d{2}9\d{8}$/.test(phone)) {
    response.cookies.set('pending_phone', phone, {
      maxAge: 60 * 60 * 24, // 1 day
      sameSite: 'lax',
      secure: true,
      path: '/',
    })
  }

  return response
}
