import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ScanHub from './ScanHub'
import { type Tier } from '@/lib/tiers'
import type { Metadata } from 'next'

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
    supabase.from('profiles').select('tier').eq('id', user.id).single(),
    supabase.from('stickers').select('id', { count: 'exact', head: true }),
  ])

  const tier = (profile?.tier || 'free') as Tier

  return <ScanHub userId={user.id} totalStickers={count || 1028} tier={tier} />
}
