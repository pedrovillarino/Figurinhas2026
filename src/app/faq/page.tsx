import Link from 'next/link'
import { FAQ_SECTIONS } from './faq-data'

export default function FaqPage() {
  return (
    <div className="min-h-screen bg-white">
      <header className="bg-gradient-to-b from-[#0A1628] to-[#1A2332] text-white px-6 py-10 text-center">
        <Link href="/" className="inline-block mb-4 text-sm text-white/60 hover:text-white/90 transition">
          &larr; Voltar
        </Link>
        <h1 className="text-3xl font-black mb-2">Perguntas Frequentes</h1>
        <p className="text-white/70 text-sm max-w-md mx-auto">
          Tudo que você precisa saber sobre o Complete Aí
        </p>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-8">
        {FAQ_SECTIONS.map((section) => (
          <section key={section.title}>
            <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900 mb-3">
              <span className="text-xl" aria-hidden="true">{section.icon}</span>
              {section.title}
            </h2>
            <div className="space-y-2">
              {section.items.map((item) => (
                <details
                  key={item.q}
                  className="group border border-gray-200 rounded-xl overflow-hidden open:bg-gray-50/40"
                >
                  <summary className="flex items-center justify-between px-4 py-3 cursor-pointer list-none hover:bg-gray-50 transition [&::-webkit-details-marker]:hidden">
                    <span className="text-sm font-semibold text-gray-800 pr-4">
                      {item.q}
                    </span>
                    <svg
                      className="w-5 h-5 text-gray-400 flex-shrink-0 transition-transform group-open:rotate-180"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                      aria-hidden="true"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </summary>
                  <div className="px-4 pb-4 text-sm text-gray-600 leading-relaxed border-t border-gray-100 pt-3">
                    {item.a}
                  </div>
                </details>
              ))}
            </div>
          </section>
        ))}

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
