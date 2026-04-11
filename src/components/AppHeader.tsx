export default function AppHeader() {
  return (
    <header className="sticky top-0 z-40">
      {/* Glass background */}
      <div className="absolute inset-0 bg-white/60 backdrop-blur-2xl" />

      <div className="relative flex items-center px-5 h-11 max-w-lg mx-auto">
        {/* Logo — left aligned */}
        <div className="flex items-center gap-1.5">
          <LogoMark />
          <span className="text-[13px] font-extrabold tracking-tight text-navy/80 leading-none">
            Complete<span className="text-brand"> Aí</span>
          </span>
        </div>
      </div>
    </header>
  )
}

function LogoMark() {
  return (
    <div className="w-5 h-5 rounded bg-brand flex items-center justify-center p-[2.5px]">
      <div className="grid grid-cols-2 gap-[1px] w-full h-full">
        <div className="bg-white/90 rounded-[0.5px]" />
        <div className="bg-white/90 rounded-[0.5px]" />
        <div className="bg-white/90 rounded-[0.5px]" />
        <div className="border border-dashed border-white/50 rounded-[0.5px]" />
      </div>
    </div>
  )
}
