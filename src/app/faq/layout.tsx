import type { Metadata } from 'next'
import { FAQ_SECTIONS } from './faq-data'

export const metadata: Metadata = {
  title: 'Perguntas Frequentes',
  description: 'Tudo sobre o Complete Aí: scanner com IA, trocas de figurinhas da Copa 2026, planos, pagamento e privacidade.',
  alternates: { canonical: 'https://www.completeai.com.br/faq' },
}

export default function FaqLayout({ children }: { children: React.ReactNode }) {
  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ_SECTIONS.flatMap((section) =>
      section.items.map((item) => ({
        '@type': 'Question',
        name: item.q,
        acceptedAnswer: {
          '@type': 'Answer',
          text: item.a,
        },
      }))
    ),
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
