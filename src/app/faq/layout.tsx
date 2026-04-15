import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Perguntas Frequentes',
  description: 'Tudo sobre o Complete Aí: scanner com IA, trocas de figurinhas, planos, pagamento e privacidade.',
  alternates: { canonical: 'https://www.completeai.com.br/faq' },
}

// FAQ items for JSON-LD (must match page.tsx content)
const FAQ_ITEMS = [
  { q: 'O que é o Complete Aí?', a: 'O Complete Aí usa inteligência artificial para te ajudar a organizar e completar seu álbum de figurinhas.' },
  { q: 'O app é gratuito?', a: 'Sim! O plano gratuito permite registrar até 50 figurinhas manualmente e fazer 5 scans com IA. Para desbloquear mais, temos planos a partir de R$9,90.' },
  { q: 'Como funciona o scanner?', a: 'Tire uma foto de uma página do álbum ou de figurinhas soltas. Nossa IA analisa a imagem e identifica automaticamente os números e jogadores.' },
  { q: 'Como funcionam as trocas?', a: 'O app encontra outros colecionadores perto de você que têm figurinhas que você precisa. Você envia uma solicitação e, se aceita, vocês trocam contatos.' },
  { q: 'O pagamento é único ou mensal?', a: 'Pagamento único! Você paga uma vez e tem acesso ao plano durante toda a Copa 2026. Sem mensalidade.' },
  { q: 'Meus dados estão seguros?', a: 'Sim. Usamos infraestrutura segura. Não vendemos nem compartilhamos suas informações. Seu WhatsApp só é revelado quando você aprova uma troca.' },
]

export default function FaqLayout({ children }: { children: React.ReactNode }) {
  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ_ITEMS.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.a,
      },
    })),
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
      {children}
    </>
  )
}
