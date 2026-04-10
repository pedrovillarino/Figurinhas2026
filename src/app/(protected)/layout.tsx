import BottomNav from '@/components/BottomNav'

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen pb-20">
      <div id="main-content">{children}</div>
      <footer>
        <BottomNav />
      </footer>
    </div>
  )
}
