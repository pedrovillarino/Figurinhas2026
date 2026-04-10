import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ExportPageClient from './ExportPageClient'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Exportar Lista',
  description: 'Exporte sua lista de figurinhas faltantes ou repetidas da Copa 2026.',
}

export const dynamic = 'force-dynamic'

export default async function ExportPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const [{ data: stickers }, { data: userStickers }] = await Promise.all([
    supabase.from('stickers').select('*').order('number'),
    supabase.from('user_stickers').select('*').eq('user_id', user.id),
  ])

  const userStickersMap: Record<number, { status: string; quantity: number }> = {}
  userStickers?.forEach((us) => {
    userStickersMap[us.sticker_id] = { status: us.status, quantity: us.quantity }
  })

  return (
    <ExportPageClient
      stickers={stickers || []}
      userStickersMap={userStickersMap}
    />
  )
}
