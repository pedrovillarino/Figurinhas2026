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
      .select('tier, referral_code, display_name, quick_start_step')
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
  const quickStartStep = ((profile as { quick_start_step?: string | null })?.quick_start_step ?? null) as QuickStartStep

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
