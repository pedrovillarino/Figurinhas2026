import BottomNav from '@/components/BottomNav'
import AppHeader from '@/components/AppHeader'
import InstallBanner from '@/components/InstallBanner'
import PushPermission from '@/components/PushPermission'
import ReferralApplier from '@/components/ReferralApplier'
import AuthRefresh from '@/components/AuthRefresh'
import ClientHealthCheck from '@/components/ClientHealthCheck'
import LaunchPromoModal from '@/components/LaunchPromoModal'
import AuthCompletionTracker from '@/components/AuthCompletionTracker'

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
      <PushPermission />
      <ReferralApplier />
      <AuthRefresh />
      <ClientHealthCheck />
      <LaunchPromoModal />
      <AuthCompletionTracker />
      <footer>
        <BottomNav />
      </footer>
    </div>
  )
}
