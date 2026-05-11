import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getCachedStickers } from '@/lib/stickers-cache'
import AlbumClient from './AlbumClient'
import CepNudgeWrapper from '@/components/CepNudgeWrapper'
import ShareReferralCard from '@/components/ShareReferralCard'
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
    supabase
      .from('profiles')
      .select('tier, referral_code, display_name')
      .eq('id', user.id)
      .single(),
  ])

  // Pedro 2026-05-11: quick_start_step em query separada com try/catch pra
  // tolerar caso a migration 026 ainda não tenha rodado em produção.
  // Sem isso o select inteiro do profile falharia com PostgREST 42703 e
  // a página /album quebraria pra todos os usuários.
  let initialQuickStartStep:
    | 'missing' | 'extras' | 'duplicates' | 'done' | null = null
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('quick_start_step')
      .eq('id', user.id)
      .maybeSingle()
    if (!error && data) {
      const raw = (data as { quick_start_step?: string | null }).quick_start_step ?? null
      if (raw === 'missing' || raw === 'extras' || raw === 'duplicates' || raw === 'done') {
        initialQuickStartStep = raw
      }
    }
  } catch {
    // Coluna ainda não existe — Quick Start fica desativado até migration rodar.
  }

  const userStickersMap: Record<number, { status: string; quantity: number }> = {}
  userStickers?.forEach((us) => {
    userStickersMap[us.sticker_id] = { status: us.status, quantity: us.quantity }
  })

  return (
    <>
      <div className="px-4 pt-4 space-y-2">
        {/* Pedro 2026-05-03: nudge contextual de CEP — só aparece se user
            tem engajamento mínimo e ainda não preencheu cidade */}
        <CepNudgeWrapper userId={user.id} />
        {/* Pedro 2026-05-08: card de indicação 1-clique. Variant compact pra
            não competir com CepNudge no topo. +2 scans por amigo confirmado. */}
        <ShareReferralCard
          referralCode={(profile as { referral_code?: string | null })?.referral_code ?? null}
          displayName={(profile as { display_name?: string | null })?.display_name ?? null}
          source="album"
          variant="compact"
        />
      </div>
      <AlbumClient
        stickers={stickers}
        userStickersMap={userStickersMap}
        userId={user.id}
        tier={(profile?.tier || 'free') as Tier}
        initialQuickStartStep={initialQuickStartStep}
      />
    </>
  )
}
