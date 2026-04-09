import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import TradesClient from './TradesClient'

export const dynamic = 'force-dynamic'

export default async function TradesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  return <TradesClient userId={user.id} />
}
