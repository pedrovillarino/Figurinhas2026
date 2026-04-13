'use client'

import { useState } from 'react'
import Link from 'next/link'

type FaqItem = {
  q: string
  a: string
}

const FAQ_SECTIONS: { title: string; icon: string; items: FaqItem[] }[] = [
  {
    title: 'Sobre o App',
    icon: '📱',
    items: [
      {
        q: 'O que é o Complete Aí?',
        a: 'O Complete Aí é o primeiro app que usa inteligência artificial para te ajudar a organizar e completar seu álbum de figurinhas da Copa do Mundo 2026. Você escaneia suas figurinhas com a câmera, e a IA identifica automaticamente quais você tem.',
      },
      {
        q: 'O app é gratuito?',
        a: 'Sim! O plano gratuito permite registrar até 50 figurinhas manualmente e fazer 5 scans com IA. Para desbloquear scans ilimitados, trocas e outras funcionalidades, temos planos a partir de R$9,90.',
      },
      {
        q: 'Funciona para qual álbum?',
        a: 'Atualmente funciona para o álbum oficial Panini da Copa do Mundo FIFA 2026. Estamos trabalhando para suportar outros álbuns no futuro.',
      },
      {
        q: 'Preciso instalar alguma coisa?',
        a: 'Não! O Complete Aí é um app web (PWA). Basta acessar completeai.com.br pelo navegador do celular. Você pode adicionar à tela inicial para ter a experiência de um app nativo.',
      },
    ],
  },
  {
    title: 'Scanner com IA',
    icon: '📸',
    items: [
      {
        q: 'Como funciona o scanner?',
        a: 'Tire uma foto de uma página do álbum ou de figurinhas soltas. Nossa IA (Google Gemini) analisa a imagem e identifica automaticamente os números e jogadores. Você confirma antes de salvar.',
      },
      {
        q: 'O scanner erra?',
        a: 'A IA tem alta precisão, mas pode errar em fotos com pouca luz ou figurinhas muito pequenas. Por isso, sempre mostramos uma tela de confirmação antes de registrar. Você pode desmarcar qualquer figurinha identificada incorretamente.',
      },
      {
        q: 'Quantos scans posso fazer?',
        a: 'Depende do seu plano: Grátis = 5 scans, Estreante = 50 scans, Colecionador = 150 scans, Copa Completa = ilimitado. Cada foto enviada (pelo site ou WhatsApp) conta como 1 scan.',
      },
      {
        q: 'Posso escanear pelo WhatsApp?',
        a: 'Sim! Adicione nosso número no WhatsApp e envie fotos das suas figurinhas. O bot analisa e pede sua confirmação antes de registrar. Mande "oi" para o nosso número para começar.',
      },
    ],
  },
  {
    title: 'Trocas',
    icon: '🔁',
    items: [
      {
        q: 'Como funcionam as trocas?',
        a: 'O app encontra automaticamente outros colecionadores perto de você que têm figurinhas que você precisa (e vice-versa). Você envia uma solicitação de troca, e se a pessoa aceitar, vocês recebem o contato um do outro.',
      },
      {
        q: 'Preciso compartilhar minha localização?',
        a: 'Sim, para encontrar trocas próximas pedimos sua localização aproximada (cidade/bairro). Nunca mostramos sua posição exata — apenas a distância aproximada entre vocês.',
      },
      {
        q: 'É seguro trocar?',
        a: 'Toda troca passa por aprovação. Ninguém recebe seu contato sem que você aceite primeiro. Você pode aprovar ou recusar solicitações pelo app ou WhatsApp.',
      },
      {
        q: 'Recebo notificação quando alguém quer trocar?',
        a: 'Sim! Se você cadastrou seu celular, recebe alertas por WhatsApp quando há um match de troca perto de você. Você pode configurar a frequência e o raio de distância nas configurações.',
      },
    ],
  },
  {
    title: 'Planos e Pagamento',
    icon: '💎',
    items: [
      {
        q: 'Quais são os planos?',
        a: 'Temos 4 planos: Grátis (R$0 — controle manual, 5 scans, 2 trocas), Estreante (R$9,90 — 50 scans, 5 trocas, sem anúncios), Colecionador (R$19,90 — 150 scans, 15 trocas, sem anúncios) e Copa Completa (R$29,90 — scans e trocas ilimitados). Pagamento único!',
      },
      {
        q: 'O pagamento é único ou mensal?',
        a: 'Pagamento único! Você paga uma vez e tem acesso ao plano durante toda a Copa 2026. Sem mensalidade, sem surpresas.',
      },
      {
        q: 'Posso fazer upgrade depois?',
        a: 'Sim! Você pode fazer upgrade a qualquer momento. O valor que já pagou é descontado do novo plano.',
      },
      {
        q: 'Quais formas de pagamento?',
        a: 'Aceitamos cartão de crédito e PIX via Stripe, a plataforma de pagamentos mais segura do mundo.',
      },
    ],
  },
  {
    title: 'Indicações',
    icon: '🎁',
    items: [
      {
        q: 'Como funciona o programa de indicação?',
        a: 'Compartilhe seu link de indicação (disponível no seu perfil). Quando um amigo se cadastrar pelo seu link, vocês dois ganham benefícios: seu amigo ganha +1 crédito de troca, e se ele fizer upgrade, você ganha +5 trocas e +10 scans extras!',
      },
      {
        q: 'Onde encontro meu link de indicação?',
        a: 'Acesse seu perfil no app. Lá você encontra seu código e link de indicação, com opção de copiar ou compartilhar direto no WhatsApp.',
      },
    ],
  },
  {
    title: 'Conta e Privacidade',
    icon: '🔒',
    items: [
      {
        q: 'Como crio minha conta?',
        a: 'Basta acessar completeai.com.br e fazer login com Google ou e-mail. É rápido e seguro.',
      },
      {
        q: 'Meus dados estão seguros?',
        a: 'Sim. Usamos Supabase (infraestrutura segura) para armazenar seus dados. Não vendemos nem compartilhamos suas informações. Seu número de WhatsApp só é revelado quando você aprova uma troca.',
      },
      {
        q: 'Posso usar sem WhatsApp?',
        a: 'Com certeza! O WhatsApp é opcional. Você pode usar o app 100% pelo site, escanear pelo navegador e gerenciar trocas sem precisar do WhatsApp.',
      },
      {
        q: 'Como apago minha conta?',
        a: 'Acesse seu perfil no app e clique em "Excluir conta". Todos os seus dados serão removidos permanentemente.',
      },
    ],
  },
]

export default function FaqPage() {
  const [openIndex, setOpenIndex] = useState<string | null>(null)

  const toggle = (key: string) => {
    setOpenIndex(openIndex === key ? null : key)
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="bg-gradient-to-b from-[#0A1628] to-[#1A2332] text-white px-6 py-10 text-center">
        <Link href="/" className="inline-block mb-4 text-sm text-white/60 hover:text-white/90 transition">
          &larr; Voltar
        </Link>
        <h1 className="text-3xl font-black mb-2">Perguntas Frequentes</h1>
        <p className="text-white/70 text-sm max-w-md mx-auto">
          Tudo que você precisa saber sobre o Complete Aí
        </p>
      </header>

      {/* FAQ Sections */}
      <main className="max-w-2xl mx-auto px-4 py-8 space-y-8">
        {FAQ_SECTIONS.map((section, sIdx) => (
          <section key={sIdx}>
            <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900 mb-3">
              <span className="text-xl">{section.icon}</span>
              {section.title}
            </h2>
            <div className="space-y-2">
              {section.items.map((item, iIdx) => {
                const key = `${sIdx}-${iIdx}`
                const isOpen = openIndex === key
                return (
                  <div
                    key={key}
                    className="border border-gray-200 rounded-xl overflow-hidden"
                  >
                    <button
                      onClick={() => toggle(key)}
                      className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition"
                    >
                      <span className="text-sm font-semibold text-gray-800 pr-4">
                        {item.q}
                      </span>
                      <svg
                        className={`w-5 h-5 text-gray-400 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {isOpen && (
                      <div className="px-4 pb-4 text-sm text-gray-600 leading-relaxed border-t border-gray-100 pt-3">
                        {item.a}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        ))}

        {/* CTA */}
        <div className="text-center pt-4 pb-8">
          <p className="text-sm text-gray-500 mb-4">
            Ainda tem dúvidas? Mande uma mensagem no WhatsApp!
          </p>
          <Link
            href="/"
            className="inline-block bg-[#00C896] text-white rounded-2xl px-8 py-3 text-sm font-semibold hover:bg-[#00A67D] transition"
          >
            Começar agora
          </Link>
        </div>
      </main>
    </div>
  )
}
