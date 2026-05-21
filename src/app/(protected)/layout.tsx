// Force dynamic rendering on every protected page. They all hydrate
// user-specific Supabase data at runtime (auth cookies, profile, user_stickers),
// so build-time prerender has no benefit and breaks any build that runs
// without NEXT_PUBLIC_SUPABASE_* env vars (e.g. branch previews).
export const dynamic = 'force-dynamic'

import BottomNav from '@/components/BottomNav'
import AppHeader from '@/components/AppHeader'
import InstallBanner from '@/components/InstallBanner'
import QuickStartModeBarWrapper from '@/components/QuickStartModeBarWrapper'
// PushPermission used to be rendered here at layout level — it asked for
// notification permission 10s after every page mount, which interrupted users
// before they had any reason to say yes. It now lives inline inside ScanClient
// (success state) so the prompt happens AFTER a successful scan, in context.
import ReferralApplier from '@/components/ReferralApplier'
import AuthRefresh from '@/components/AuthRefresh'
import ClientHealthCheck from '@/components/ClientHealthCheck'
import LaunchPromoModal from '@/components/LaunchPromoModal'
import TrialStateBanner from '@/components/TrialStateBanner'
import AuthCompletionTracker from '@/components/AuthCompletionTracker'
import PendingPhoneSync from '@/components/PendingPhoneSync'
import { createClient } from '@/lib/supabase/server'
import { awardLoginAndStreak } from '@/lib/liga'

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Liga Complete Aí: marca login do dia + dispara streak 3/7/15.
  // Fire-and-forget — não bloqueia o render do layout. Idempotente por dia
  // (PK em daily_logins + event_key incluindo data).
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    void awardLoginAndStreak(user.id)
  }

  return (
    <div className="min-h-screen pb-20">
      <AppHeader />
      {/* Pedro 2026-05-21: banner do trial (ativo / expirado). Fica logo
          abaixo do header em todas as telas protected. Auto-some pra
          pagantes e free legacy. */}
      <TrialStateBanner />
      {/* Pedro 2026-05-11: faixa amarela do Quick Start. Só renderiza se
          user está em modo ativo (step ≠ null && ≠ 'done'). Fica logo
          abaixo do header pra ficar visível em todas as telas. */}
      <QuickStartModeBarWrapper />
      <div id="main-content">{children}</div>
      <InstallBanner />
      <ReferralApplier />
      <AuthRefresh />
      <ClientHealthCheck />
      <LaunchPromoModal />
      <AuthCompletionTracker />
      <PendingPhoneSync />
      <footer>
        <BottomNav />
      </footer>
    </div>
  )
}
