import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import HomeLogin from "./HomeLogin";
import { LogoFull, LogoMark } from "@/components/Logo";
import InstagramWebViewPromo from "@/components/InstagramWebViewPromo";

export const dynamic = 'force-dynamic';

// Anonymous landing-page traffic skips the Supabase auth roundtrip entirely:
// without an sb-*-auth-token cookie there's no session to validate, so we
// render directly. Logged-in users still pay one auth call to get the redirect
// to /album.
const AUTH_COOKIE_RE = /^sb-.+-auth-token(\.\d+)?$/;

export default async function Home() {
  const hasAuthCookie = cookies()
    .getAll()
    .some((c) => AUTH_COOKIE_RE.test(c.name));

  if (hasAuthCookie) {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) redirect("/album");
  }

  return (
    <div className="min-h-screen bg-white text-navy overflow-hidden">
      <InstagramWebViewPromo />

      {/* ── Hero Section ── */}
      <section id="main-content" className="relative px-6 pt-10 pb-8">
        {/* Subtle gradient bg */}
        <div className="absolute inset-0 bg-gradient-to-b from-brand-light/60 via-white to-white" />

        <div className="relative z-10 flex flex-col items-center max-w-md mx-auto">
          {/* Logo */}
          <div className="animate-fade-up mb-1">
            <LogoFull size={40} />
          </div>

          {/* Logo icon + glow */}
          <div className="animate-fade-up-delay relative my-5">
            <div className="absolute inset-0 bg-brand/15 blur-[50px] rounded-full scale-90" />
            <div className="relative animate-float">
              <LogoMark size={120} />
            </div>
          </div>

          {/* Headline */}
          <h1 className="text-[22px] font-black text-center leading-tight animate-fade-up-delay tracking-tight">
            Escaneie. Troque.{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand to-brand-dark">
              Complete.
            </span>
          </h1>

          <p className="text-sm text-gray-500 mt-2 text-center leading-relaxed max-w-[280px] animate-fade-up-delay">
            Escaneie suas figurinhas com IA e encontre trocas perto de você.
          </p>

          {/* CTA */}
          <div className="mt-6 w-full max-w-xs animate-fade-up-delay-2">
            <Suspense><HomeLogin /></Suspense>
          </div>
        </div>
      </section>

      {/* ── Value Props ── */}
      <section className="px-6 py-8 max-w-md mx-auto">
        <div className="space-y-4 animate-fade-up-delay-3">
          {/* Scanner IA */}
          <ValueProp
            icon={
              <div className="w-10 h-10 rounded-xl bg-brand/10 flex items-center justify-center">
                <svg className="w-5 h-5 text-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
            }
            title="Scanner com IA"
            description="Escaneie e registre figurinhas automaticamente."
            badge="Exclusivo"
          />

          {/* Trocas */}
          <ValueProp
            icon={
              <div className="w-10 h-10 rounded-xl bg-gold/10 flex items-center justify-center">
                <svg className="w-5 h-5 text-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                </svg>
              </div>
            }
            title="Trocas perto de você"
            description="Encontre colecionadores na sua região que têm o que você precisa."
            badge="Geolocalização"
          />

          {/* Controle */}
          <ValueProp
            icon={
              <div className="w-10 h-10 rounded-xl bg-navy/5 flex items-center justify-center">
                <svg className="w-5 h-5 text-navy/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
              </div>
            }
            title="Controle total do álbum"
            description="Coladas, faltantes e repetidas — tudo organizado num só lugar."
          />
        </div>
      </section>


      {/* ── How it works ── */}
      <section className="px-6 py-10 max-w-md mx-auto">
        <h2 className="text-base font-bold text-center text-navy mb-6">
          Como funciona
        </h2>
        <div className="flex flex-col gap-5">
          <Step
            number="1"
            title="Crie sua conta"
            description="Login rápido com Google ou e-mail."
          />
          <Step
            number="2"
            title="Escaneie suas figurinhas"
            description="Tire uma foto — a IA registra tudo automaticamente."
          />
          <Step
            number="3"
            title="Encontre trocas"
            description="Veja quem perto de você tem as figurinhas que faltam."
          />
        </div>
      </section>

      {/* ── About / SEO content ── */}
      <section className="px-6 py-10 max-w-md mx-auto border-t border-gray-100">
        <h2 className="text-base font-bold text-navy mb-4">
          Sobre o Complete Aí
        </h2>
        <div className="space-y-3 text-sm text-gray-600 leading-relaxed">
          <p>
            O Complete Aí é o aplicativo brasileiro que usa inteligência artificial
            para ajudar colecionadores a completar o álbum da{' '}
            <strong className="font-semibold text-navy">Copa do Mundo 2026</strong>.
            Em vez de gastar centenas de reais em pacotes e acumular figurinhas
            repetidas sem controle, você escaneia sua coleção com a câmera do
            celular e a IA identifica automaticamente quais figurinhas você já tem,
            quais faltam e quais estão repetidas.
          </p>
          <p>
            Com sua lista organizada, o app conecta você a outros colecionadores
            próximos para{' '}
            <strong className="font-semibold text-navy">trocar figurinhas</strong>{' '}
            sem precisar caçar grupos no WhatsApp ou montar planilhas. O Complete
            Aí encontra trocas compatíveis perto de você automaticamente e avisa
            por WhatsApp quando aparece um match na sua região.
          </p>
          <p>
            Funciona 100% pelo navegador, sem precisar baixar nada. Tem plano
            grátis para começar e planos pagos a partir de R$ 9,90 (pagamento
            único, sem mensalidade) para desbloquear scans e trocas ilimitadas
            durante toda a Copa 2026.
          </p>
        </div>
      </section>

      {/* ── Bottom CTA ── */}
      <section className="px-6 pt-6 pb-10 bg-gradient-to-b from-white to-brand-light/40">
        <div className="max-w-xs mx-auto text-center">
          <p className="text-lg font-bold text-navy mb-1">
            Falta pouco pra completar
          </p>
          <p className="text-xs text-gray-400 mb-5">
            Crie sua conta grátis e escaneie a primeira figurinha em 30 segundos.
          </p>
          <HomeLogin />
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="px-6 py-6 border-t border-gray-100 text-center space-y-2">
        <p className="text-xs text-gray-500">
          Complete Aí — Seu álbum de figurinhas
        </p>
        <p className="text-xs text-gray-500">
          contato@completeai.com.br
        </p>
        <p className="text-[11px] text-gray-400 max-w-xs mx-auto leading-relaxed">
          Este app não é afiliado, endossado ou patrocinado pela FIFA, Panini, Topps, Fanatics ou qualquer organização oficial.
        </p>
        <div className="flex items-center justify-center gap-3 pt-1">
          <a href="/termos" className="text-[11px] text-gray-500 hover:text-brand transition">Termos de Serviço</a>
          <span className="text-gray-300">·</span>
          <a href="/privacidade" className="text-[11px] text-gray-500 hover:text-brand transition">Privacidade</a>
        </div>
      </footer>
    </div>
  );
}

/* ── Sub-components ── */


function ValueProp({
  icon,
  title,
  description,
  badge,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  badge?: string;
}) {
  return (
    <div className="flex items-start gap-3.5 p-3.5 rounded-2xl bg-white border border-gray-100 shadow-sm">
      {icon}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <p className="text-sm font-bold text-navy">{title}</p>
          {badge && (
            <span className="text-[8px] bg-brand-light text-brand-dark font-bold rounded-full px-1.5 py-0.5 uppercase tracking-wide">
              {badge}
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}


function Step({ number, title, description }: { number: string; title: string; description: string }) {
  return (
    <div className="flex items-start gap-3.5">
      <div className="w-7 h-7 rounded-full bg-brand/10 flex items-center justify-center flex-shrink-0 mt-0.5">
        <span className="text-xs font-bold text-brand">{number}</span>
      </div>
      <div>
        <p className="text-sm font-semibold text-navy">{title}</p>
        <p className="text-xs text-gray-500 mt-0.5">{description}</p>
      </div>
    </div>
  );
}
