import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ScanClient from './ScanClient'
import ScanPaywall from './ScanPaywall'
import { canScan, type Tier } from '@/lib/tiers'

export const dynamic = 'force-dynamic'

export default async function ScanPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const [{ data: profile }, { count }] = await Promise.all([
    supabase.from('profiles').select('tier').eq('id', user.id).single(),
    supabase.from('stickers').select('*', { count: 'exact', head: true }),
  ])

  const tier = (profile?.tier || 'free') as Tier

  if (!canScan(tier)) {
    return <ScanPaywall currentTier={tier} />
  }

  return <ScanClient userId={user.id} totalStickers={count || 670} />
}
