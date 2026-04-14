import { LogoFull } from './Logo'
import NotificationBell from './NotificationBell'

export default function AppHeader() {
  return (
    <header className="sticky top-0 z-40">
      {/* Glass background — alta transparência */}
      <div className="absolute inset-0 bg-white/40 backdrop-blur-2xl" />

      <div className="relative flex items-center justify-between px-4 h-12">
        <LogoFull size={28} showSubtitle={true} />
        <NotificationBell />
      </div>
    </header>
  )
}
