// GET /api/profile/cep-nudge-data
// Pedro 2026-05-06: endpoint client-side pra decidir se mostra CepNudge
// dentro de client components (ex: ScanHub no estado 'success').
//
// Mesmo helper server-side já usado pelo CepNudgeWrapper.

import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getCepNudgeData } from '@/lib/cep-nudge'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ show: false, stickersOwned: 0 })
  }
  const data = await getCepNudgeData(user.id)
  return NextResponse.json(data)
}
