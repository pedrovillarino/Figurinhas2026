import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import HomeLogin from "./HomeLogin";

export const dynamic = 'force-dynamic';

export default async function Home() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    redirect("/album");
  }

  return (
    <div className="min-h-screen bg-[#060608] text-white overflow-hidden relative">
      {/* Ambient light */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-violet-500/8 rounded-full blur-[150px]" />

      {/* Content */}
      <div className="relative z-10 min-h-screen flex flex-col">
        {/* Header */}
        <header className="px-6 pt-5 pb-2 animate-fade-up">
          <span className="text-[13px] font-semibold tracking-tight text-white/80">
            figurinhas<span className="text-violet-400">.</span>
          </span>
        </header>

        {/* Hero */}
        <main className="flex-1 flex flex-col items-center px-6 pt-4 pb-8 overflow-y-auto">
          {/* Album cover */}
          <div className="animate-fade-up mb-6 relative">
            <div className="absolute inset-0 bg-violet-500/20 blur-[60px] rounded-full scale-75" />
            <div className="relative w-36 h-auto drop-shadow-2xl">
              <Image
                src="/album-cover.jpg"
                alt="Álbum Copa do Mundo 2026"
                width={144}
                height={195}
                priority
                className="rounded-lg shadow-2xl shadow-black/50"
              />
            </div>
          </div>

          {/* Copy */}
          <h1 className="text-2xl font-black tracking-tight text-center leading-tight animate-fade-up-delay">
            Seu álbum,{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-400 to-fuchsia-400">
              do seu jeito.
            </span>
          </h1>

          <p className="text-[13px] text-white/30 mt-2 text-center leading-relaxed max-w-xs animate-fade-up-delay">
            Gerencie, escaneie e troque figurinhas com quem está perto.
          </p>

          {/* Login inline */}
          <div className="mt-6 w-full max-w-xs animate-fade-up-delay-2">
            <HomeLogin />
          </div>

          {/* Features */}
          <div className="mt-10 w-full max-w-xs space-y-2.5 animate-fade-up-delay-3">
            <div className="group flex items-center gap-3 p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.05]">
              <div className="w-9 h-9 rounded-lg bg-violet-500/10 flex items-center justify-center flex-shrink-0">
                <div className="flex gap-[2px]">
                  <div className="w-1 h-4 rounded-sm bg-violet-400/60 group-hover:h-2.5 transition-all duration-500" />
                  <div className="w-1 h-2.5 rounded-sm bg-violet-400/40 group-hover:h-4 transition-all duration-500 delay-75" />
                  <div className="w-1 h-3 rounded-sm bg-violet-400/50 group-hover:h-2 transition-all duration-500 delay-150" />
                </div>
              </div>
              <div>
                <p className="text-[12px] font-medium text-white/60">Controle total</p>
                <p className="text-[10px] text-white/20">Coladas, faltam e repetidas</p>
              </div>
            </div>

            <div className="group flex items-center gap-3 p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.05]">
              <div className="w-9 h-9 rounded-lg bg-cyan-500/10 flex items-center justify-center flex-shrink-0">
                <div className="w-4 h-4 rounded border border-cyan-400/40 relative overflow-hidden">
                  <div className="absolute left-0 right-0 h-[1px] bg-cyan-400/70 group-hover:animate-[scan_1.5s_ease-in-out_infinite] top-0" />
                </div>
              </div>
              <div>
                <p className="text-[12px] font-medium text-white/60">Scan com IA</p>
                <p className="text-[10px] text-white/20">Tire foto, registre automaticamente</p>
              </div>
            </div>

            <div className="group flex items-center gap-3 p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.05]">
              <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                <div className="flex items-center gap-[2px]">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-400/50 group-hover:-translate-x-0.5 transition-transform duration-300" />
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-400/30 group-hover:translate-x-0.5 transition-transform duration-300" />
                </div>
              </div>
              <div>
                <p className="text-[12px] font-medium text-white/60">Trocas inteligentes</p>
                <p className="text-[10px] text-white/20">Encontre quem tem o que você precisa</p>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
