import BottomNav from '@/components/BottomNav'
import AppHeader from '@/components/AppHeader'
import InstallBanner from '@/components/InstallBanner'
// PushPermission used to be rendered here at layout level — it asked for
// notification permission 10s after every page mount, which interrupted users
// before they had any reason to say yes. It now lives inline inside ScanClient
// (success state) so the prompt happens AFTER a successful scan, in context.
import ReferralApplier from '@/components/ReferralApplier'
import AuthRefresh from '@/components/AuthRefresh'
import ClientHealthCheck from '@/components/ClientHealthCheck'
import LaunchPromoModal from '@/components/LaunchPromoModal'
import AuthCompletionTracker from '@/components/AuthCompletionTracker'
import PendingPhoneSync from '@/components/PendingPhoneSync'

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen pb-20">
      <AppHeader />
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
