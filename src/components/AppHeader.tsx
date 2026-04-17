import Link from 'next/link'
import { LogoFull } from './Logo'
import NotificationBell from './NotificationBell'

export default function AppHeader() {
  return (
    <header className="sticky top-0 z-40">
      <div className="absolute inset-0 bg-white/40 backdrop-blur-2xl" />

      <div className="relative flex items-center justify-between px-4 h-12">
        <LogoFull size={28} showSubtitle={true} />
        <div className="flex items-center gap-2">
          <NotificationBell />
          <Link
            href="/profile"
            aria-label="Meu perfil"
            className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 hover:bg-brand-light hover:text-brand transition"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
            </svg>
          </Link>
        </div>
      </div>
    </header>
  )
}
