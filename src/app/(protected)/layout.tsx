import BottomNav from '@/components/BottomNav'
import AppHeader from '@/components/AppHeader'

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen pb-20">
      <AppHeader />
      <div id="main-content">{children}</div>
      <footer>
        <BottomNav />
      </footer>
    </div>
  )
}
