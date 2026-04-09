import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import AlbumClient from './AlbumClient'

export const dynamic = 'force-dynamic'

export default async function AlbumPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: stickers } = await supabase
    .from('stickers')
    .select('*')
    .order('number')

  const { data: userStickers } = await supabase
    .from('user_stickers')
    .select('*')
    .eq('user_id', user.id)

  const userStickersMap: Record<number, { status: string; quantity: number }> = {}
  userStickers?.forEach((us) => {
    userStickersMap[us.sticker_id] = { status: us.status, quantity: us.quantity }
  })

  return (
    <AlbumClient
      stickers={stickers || []}
      userStickersMap={userStickersMap}
      userId={user.id}
    />
  )
}
