import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import DashboardClient from './DashboardClient'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Dashboard',
  description: 'Painel com resumo do progresso do seu álbum de figurinhas da Copa 2026.',
}

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const [{ data: stickers }, { data: userStickers }] = await Promise.all([
    supabase.from('stickers').select('*').order('number'),
    supabase.from('user_stickers').select('*').eq('user_id', user.id),
  ])

  const userStickersMap: Record<number, { status: string; quantity: number; updated_at: string | null }> = {}
  userStickers?.forEach((us) => {
    userStickersMap[us.sticker_id] = {
      status: us.status,
      quantity: us.quantity,
      updated_at: us.updated_at || null,
    }
  })

  return (
    <DashboardClient
      stickers={stickers || []}
      userStickersMap={userStickersMap}
    />
  )
}
