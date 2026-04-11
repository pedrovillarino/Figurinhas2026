import { LogoFull } from './Logo'

export default function AppHeader() {
  return (
    <header className="sticky top-0 z-40">
      {/* Glass background */}
      <div className="absolute inset-0 bg-white/60 backdrop-blur-2xl" />

      <div className="relative flex items-center px-5 h-12 max-w-lg mx-auto">
        <LogoFull size={24} showSubtitle={false} />
      </div>
    </header>
  )
}
