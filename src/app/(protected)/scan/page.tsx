import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ScanHub from './ScanHub'
import ScanQuickStartGate from '@/components/ScanQuickStartGate'
import { type Tier } from '@/lib/tiers'
import type { Metadata } from 'next'
import type { QuickStartStep } from '@/components/QuickStart'

export const metadata: Metadata = {
  title: 'Escanear Figurinhas',
  description: 'Use a câmera para escanear e registrar figurinhas no seu álbum.',
}

export const dynamic = 'force-dynamic'

export default async function ScanPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const [{ data: profile }, { count }] = await Promise.all([
    supabase
      .from('profiles')
      .select('tier, referral_code, display_name')
      .eq('id', user.id)
      .single(),
    supabase
      .from('stickers')
      .select('id', { count: 'exact', head: true })
      .eq('counts_for_completion', true),
  ])

  const tier = (profile?.tier || 'free') as Tier
  const referralCode = (profile as { referral_code?: string | null })?.referral_code ?? null
  const displayName = (profile as { display_name?: string | null })?.display_name ?? null

  // Pedro 2026-05-11: quick_start_step em query separada com try/catch
  // pra tolerar coluna ausente (migration 026 ainda não rodou).
  let quickStartStep: QuickStartStep = null
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('quick_start_step')
      .eq('id', user.id)
      .maybeSingle()
    if (!error && data) {
      const raw = (data as { quick_start_step?: string | null }).quick_start_step ?? null
      if (raw === 'missing' || raw === 'extras' || raw === 'duplicates' || raw === 'done') {
        quickStartStep = raw
      }
    }
  } catch {
    // Coluna ainda não existe — gate desativado, /scan funciona normal.
  }

  return (
    <ScanQuickStartGate initialStep={quickStartStep}>
      <ScanHub
        userId={user.id}
        totalStickers={count || 980}
        tier={tier}
        referralCode={referralCode}
        displayName={displayName}
      />
    </ScanQuickStartGate>
  )
}
