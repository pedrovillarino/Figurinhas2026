import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// GET /register?phone=5521XXXXXXXXX
//
// Entry point for users coming from the WhatsApp bot's welcome message.
// Stores the phone number in a short-lived cookie so we can auto-attach
// it to the profile after the user finishes Google/email signup, then
// redirects to the home page with a hint flag for analytics.
export async function GET(req: NextRequest) {
  const phone = (req.nextUrl.searchParams.get('phone') ?? '').replace(/\D/g, '')

  const response = NextResponse.redirect(new URL('/?from=whatsapp', req.url))

  if (/^\d{10,13}$/.test(phone)) {
    response.cookies.set('pending_phone', phone, {
      maxAge: 60 * 60 * 24, // 1 day
      sameSite: 'lax',
      secure: true,
      path: '/',
    })
  }

  return response
}
