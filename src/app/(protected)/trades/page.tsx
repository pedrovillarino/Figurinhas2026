import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import TradesClient from './TradesClient'
import TradesPaywall from './TradesPaywall'
import { canTrade, type Tier } from '@/lib/tiers'

export const dynamic = 'force-dynamic'

export default async function TradesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('tier')
    .eq('id', user.id)
    .single()

  const tier = (profile?.tier || 'free') as Tier

  if (!canTrade(tier)) {
    return <TradesPaywall currentTier={tier} />
  }

  return <TradesClient userId={user.id} />
}
