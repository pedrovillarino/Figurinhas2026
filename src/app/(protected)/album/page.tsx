import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getCachedStickers } from '@/lib/stickers-cache'
import AlbumClient from './AlbumClient'
import CepNudgeWrapper from '@/components/CepNudgeWrapper'
import type { Tier } from '@/lib/tiers'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Meu Álbum',
  description: 'Visualize e gerencie todas as figurinhas do seu álbum.',
}

export const dynamic = 'force-dynamic'

export default async function AlbumPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const [stickers, { data: userStickers }, { data: profile }] = await Promise.all([
    getCachedStickers(),
    supabase.from('user_stickers').select('sticker_id, status, quantity').eq('user_id', user.id),
    supabase.from('profiles').select('tier').eq('id', user.id).single(),
  ])

  const userStickersMap: Record<number, { status: string; quantity: number }> = {}
  userStickers?.forEach((us) => {
    userStickersMap[us.sticker_id] = { status: us.status, quantity: us.quantity }
  })

  return (
    <>
      {/* Pedro 2026-05-03: nudge contextual de CEP — só aparece se user
          tem engajamento mínimo e ainda não preencheu cidade */}
      <div className="px-4 pt-4 space-y-2">
        <CepNudgeWrapper userId={user.id} />
      </div>
      <AlbumClient
        stickers={stickers}
        userStickersMap={userStickersMap}
        userId={user.id}
        tier={(profile?.tier || 'free') as Tier}
      />
    </>
  )
}
