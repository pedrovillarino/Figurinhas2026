import { LogoMark } from './Logo'

export default function AppHeader() {
  return (
    <header className="sticky top-0 z-40">
      {/* Glass background — alta transparência */}
      <div className="absolute inset-0 bg-white/40 backdrop-blur-2xl" />

      <div className="relative flex items-center gap-2 px-4 h-11 max-w-lg mx-auto">
        <LogoMark size={22} />
        <span className="text-[11px] font-semibold tracking-wide text-navy/50 uppercase">
          Copa do Mundo 2026
        </span>
      </div>
    </header>
  )
}
