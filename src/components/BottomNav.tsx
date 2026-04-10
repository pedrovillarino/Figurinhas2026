'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const tabs = [
  {
    href: '/album',
    label: 'Album',
    icon: (active: boolean) => (
      <svg className="w-5 h-5" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
      </svg>
    ),
  },
  {
    href: '/dashboard',
    label: 'Stats',
    icon: (active: boolean) => (
      <svg className="w-5 h-5" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
      </svg>
    ),
  },
  {
    href: '/scan',
    label: 'Scan',
    icon: (active: boolean) => (
      <svg className="w-5 h-5" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 9V6a3 3 0 013-3h3m0 18H6a3 3 0 01-3-3v-3m18 0v3a3 3 0 01-3 3h-3m0-18h3a3 3 0 013 3v3" />
        {active && <line x1="3" y1="12" x2="21" y2="12" strokeWidth="1.5" strokeDasharray="2 2" />}
      </svg>
    ),
  },
  {
    href: '/export',
    label: 'Exportar',
    icon: (active: boolean) => (
      <svg className="w-5 h-5" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
      </svg>
    ),
  },
  {
    href: '/trades',
    label: 'Trocas',
    icon: (active: boolean) => (
      <svg className="w-5 h-5" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
      </svg>
    ),
  },
  {
    href: '/profile',
    label: 'Perfil',
    icon: (active: boolean) => (
      <svg className="w-5 h-5" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
      </svg>
    ),
  },
]

export default function BottomNav() {
  const pathname = usePathname()

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 pb-safe">
      {/* Blur background */}
      <div className="absolute inset-0 bg-white/90 backdrop-blur-xl border-t border-gray-200 shadow-[0_-2px_10px_rgba(0,0,0,0.06)]" />

      <div className="relative flex justify-around items-center h-14 max-w-lg mx-auto px-1">
        {tabs.map((tab) => {
          const isActive = pathname.startsWith(tab.href)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-label={tab.label}
              aria-current={isActive ? 'page' : undefined}
              className={`relative flex flex-col items-center justify-center gap-0.5 px-2 py-1.5 rounded-xl transition-all duration-200 focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 ${
                isActive
                  ? 'text-violet-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {/* Active indicator dot */}
              {isActive && (
                <span className="absolute -top-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-violet-500" />
              )}
              {tab.icon(isActive)}
              <span className={`text-[10px] tracking-wide ${isActive ? 'font-bold' : 'font-medium'}`}>
                {tab.label}
              </span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
