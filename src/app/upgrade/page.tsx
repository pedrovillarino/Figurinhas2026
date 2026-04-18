import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { type Tier } from '@/lib/tiers'
import UpgradePlans from '@/components/UpgradePlans'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Planos e Upgrade',
  description:
    'Escolha o plano ideal pra completar seu álbum da Copa 2026. Pagamento único, sem mensalidade. Aplique seu cupom de desconto.',
  robots: { index: false, follow: false },
}

export default async function UpgradePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('tier, is_minor')
    .eq('id', user.id)
    .single()

  const tier = ((profile?.tier as Tier) || 'free') as Tier
  const isMinor = profile?.is_minor === true

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="bg-gradient-to-b from-[#0A1628] to-[#1A2332] text-white px-6 py-10 text-center">
        <Link
          href="/album"
          className="inline-block mb-4 text-sm text-white/60 hover:text-white/90 transition"
        >
          &larr; Voltar
        </Link>
        <h1 className="text-2xl sm:text-3xl font-black mb-2 leading-tight">
          Escolha seu plano
        </h1>
        <p className="text-white/70 text-sm max-w-md mx-auto">
          Pagamento único, sem mensalidade. Use seu cupom para garantir desconto.
        </p>
      </header>

      <section className="max-w-md mx-auto px-4 py-8">
        <div className="bg-white rounded-3xl p-5 shadow-sm border border-gray-100">
          <UpgradePlans currentTier={tier} feature="upgrade" isMinor={isMinor} showHeader={false} />
        </div>
      </section>
    </main>
  )
}
