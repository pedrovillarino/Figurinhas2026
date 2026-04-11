import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import AlbumClient from './AlbumClient'
import type { Tier } from '@/lib/tiers'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Meu Álbum',
  description: 'Visualize e gerencie todas as figurinhas do seu álbum da Copa 2026.',
}

export const dynamic = 'force-dynamic'

export default async function AlbumPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const [{ data: stickers }, { data: userStickers }, { data: profile }] = await Promise.all([
    supabase.from('stickers').select('*').order('number'),
    supabase.from('user_stickers').select('*').eq('user_id', user.id),
    supabase.from('profiles').select('tier').eq('id', user.id).single(),
  ])

  const userStickersMap: Record<number, { status: string; quantity: number }> = {}
  userStickers?.forEach((us) => {
    userStickersMap[us.sticker_id] = { status: us.status, quantity: us.quantity }
  })

  return (
    <AlbumClient
      stickers={stickers || []}
      userStickersMap={userStickersMap}
      userId={user.id}
      tier={(profile?.tier || 'free') as Tier}
    />
  )
}
