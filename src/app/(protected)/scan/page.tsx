import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ScanClient from './ScanClient'

export const dynamic = 'force-dynamic'

export default async function ScanPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { count } = await supabase
    .from('stickers')
    .select('*', { count: 'exact', head: true })

  return <ScanClient userId={user.id} totalStickers={count || 670} />
}
