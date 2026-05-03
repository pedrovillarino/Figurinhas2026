// Helper server-side pra decidir se mostra o CepNudge.
//
// Critérios (Pedro 2026-05-03):
//   1. Não tem city no profile (já preencheu? não precisa)
//   2. cep_nudge_dismissed_at é null
//   3. cep_nudge_snoozed_at é null OU > 3 dias atrás
//   4. Engajamento mínimo: 5+ figurinhas marcadas OU 1+ scan feito
//
// Retorna { show, stickersOwned } pra passar pro componente client.

import { createClient } from '@supabase/supabase-js'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

export type CepNudgeData = {
  show: boolean
  stickersOwned: number
}

const SNOOZE_DAYS = 3

export async function getCepNudgeData(userId: string): Promise<CepNudgeData> {
  const supabase = getAdmin()

  // 1. Profile state
  const { data: profile } = await supabase
    .from('profiles')
    .select('city, cep_nudge_dismissed_at, cep_nudge_snoozed_at')
    .eq('id', userId)
    .maybeSingle()

  if (!profile) return { show: false, stickersOwned: 0 }

  // Já tem cidade? Não precisa do nudge
  if (profile.city) return { show: false, stickersOwned: 0 }

  // Já dismissou definitivamente?
  if (profile.cep_nudge_dismissed_at) return { show: false, stickersOwned: 0 }

  // Snoozed nos últimos 3 dias?
  if (profile.cep_nudge_snoozed_at) {
    const snoozedAt = new Date(profile.cep_nudge_snoozed_at).getTime()
    const cutoff = Date.now() - SNOOZE_DAYS * 24 * 60 * 60 * 1000
    if (snoozedAt > cutoff) return { show: false, stickersOwned: 0 }
  }

  // 2. Engajamento: count figurinhas marcadas + scans feitos
  const [stickersRes, scansRes] = await Promise.all([
    supabase
      .from('user_stickers')
      .select('user_id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gt('quantity', 0),
    supabase
      .from('scan_usage')
      .select('scan_count')
      .eq('user_id', userId)
      .limit(1),
  ])

  const stickersOwned = stickersRes.count || 0
  const hasScan = (scansRes.data?.length || 0) > 0

  const engaged = stickersOwned >= 5 || hasScan

  return {
    show: engaged,
    stickersOwned,
  }
}
