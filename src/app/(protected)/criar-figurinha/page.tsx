import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import CriarFigurinhaClient from './CriarFigurinhaClient'
import { GENERATED_STICKER_QUOTA, GENERATED_STICKER_PRICING, type Tier } from '@/lib/tiers'

export const metadata: Metadata = {
  title: 'Criar Figurinha — Complete Aí',
  description: 'Crie sua figurinha digital personalizada estilo Copa 2026 com sua foto.',
}

export const dynamic = 'force-dynamic'

export default async function CriarFigurinhaPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('tier, generated_stickers_used, display_name')
    .eq('id', user.id)
    .single()

  const tier = ((profile?.tier as Tier) || 'free') as Tier
  const quotaLimit = GENERATED_STICKER_QUOTA[tier] || 0
  const quotaUsed = profile?.generated_stickers_used || 0
  const quotaLeft = Math.max(0, quotaLimit - quotaUsed)
  const pricing = GENERATED_STICKER_PRICING[tier]

  return (
    <CriarFigurinhaClient
      tier={tier}
      tierLabel={tier === 'free' ? 'Free' : tier === 'estreante' ? 'Estreante' : tier === 'colecionador' ? 'Colecionador' : 'Copa Completa'}
      quotaLimit={quotaLimit}
      quotaLeft={quotaLeft}
      pricingDigital={pricing.digital.priceDisplay}
      pricingWithPdf={pricing.withPrintPdf.priceDisplay}
      defaultName={profile?.display_name || ''}
    />
  )
}
