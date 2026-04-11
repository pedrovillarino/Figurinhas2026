export default function AppHeader() {
  return (
    <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-xl border-b border-gray-100">
      <div className="flex items-center justify-between px-5 h-12 max-w-lg mx-auto">
        {/* Logo */}
        <div className="flex items-center gap-1.5">
          <LogoMark />
          <span className="text-sm font-black tracking-tight text-navy leading-none">
            Complete<span className="text-brand"> Aí</span>
          </span>
        </div>

        {/* Subtle Copa badge */}
        <span className="text-[9px] text-gray-300 font-medium tracking-wide">
          Copa 2026
        </span>
      </div>
    </header>
  )
}

function LogoMark() {
  return (
    <div className="w-6 h-6 rounded-md bg-brand flex items-center justify-center p-[3px] shadow-sm shadow-brand/15">
      <div className="grid grid-cols-2 gap-[1.5px] w-full h-full">
        <div className="bg-white/90 rounded-[1px]" />
        <div className="bg-white/90 rounded-[1px]" />
        <div className="bg-white/90 rounded-[1px]" />
        <div className="border border-dashed border-white/60 rounded-[1px] flex items-center justify-center">
          <span className="text-white text-[5px] font-bold leading-none">+</span>
        </div>
      </div>
    </div>
  )
}
