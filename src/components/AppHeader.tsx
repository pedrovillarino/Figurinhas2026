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
          <Link
            href="/loja"
            aria-label="Loja"
            className="flex items-center gap-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 hover:text-amber-800 rounded-full pl-2.5 pr-3 py-1.5 transition"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
            </svg>
            <span className="text-[11px] font-semibold">Loja</span>
          </Link>
          <NotificationBell />
          <Link
            href="/profile"
            aria-label="Meu perfil"
            className="flex items-center gap-1.5 bg-gray-100 hover:bg-brand-light text-gray-500 hover:text-brand rounded-full pl-2.5 pr-3 py-1.5 transition"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
            </svg>
            <span className="text-[11px] font-semibold">Perfil</span>
          </Link>
        </div>
      </div>
    </header>
  )
}
