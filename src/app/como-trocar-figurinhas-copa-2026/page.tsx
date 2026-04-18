import type { Metadata } from 'next'
import Link from 'next/link'

const PAGE_URL = 'https://www.completeai.com.br/como-trocar-figurinhas-copa-2026'

export const metadata: Metadata = {
  title: 'Como trocar figurinhas da Copa 2026',
  description:
    'Guia completo: as melhores formas de trocar figurinhas da Copa do Mundo 2026, dicas de segurança e como encontrar trocas perto de você usando IA.',
  alternates: { canonical: PAGE_URL },
  openGraph: {
    title: 'Como trocar figurinhas da Copa 2026',
    description:
      'As melhores formas de trocar figurinhas da Copa 2026, com dicas práticas de segurança e como acelerar o processo com IA.',
    url: PAGE_URL,
    type: 'article',
  },
}

const articleSchema = {
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: 'Como trocar figurinhas da Copa 2026',
  description:
    'Guia prático para trocar figurinhas da Copa do Mundo 2026 de forma segura, organizada e eficiente.',
  url: PAGE_URL,
  datePublished: '2026-04-18',
  dateModified: '2026-04-18',
  author: { '@type': 'Organization', name: 'Complete Aí' },
  publisher: {
    '@type': 'Organization',
    name: 'Complete Aí',
    url: 'https://www.completeai.com.br',
  },
}

export default function Page() {
  return (
    <main className="min-h-screen bg-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema) }}
      />

      <header className="bg-gradient-to-b from-[#0A1628] to-[#1A2332] text-white px-6 py-10 text-center">
        <Link
          href="/"
          className="inline-block mb-4 text-sm text-white/60 hover:text-white/90 transition"
        >
          &larr; Voltar
        </Link>
        <h1 className="text-2xl sm:text-3xl font-black mb-3 leading-tight max-w-xl mx-auto">
          Como trocar figurinhas da Copa 2026
        </h1>
        <p className="text-white/70 text-sm max-w-md mx-auto">
          Guia prático para trocar com segurança, organização e o mínimo de
          esforço.
        </p>
      </header>

      <article className="max-w-2xl mx-auto px-5 py-10 prose prose-sm sm:prose-base prose-headings:text-navy prose-strong:text-navy">
        <p className="text-base text-gray-700 leading-relaxed">
          Trocar figurinhas é a forma mais barata, rápida e divertida de completar
          o álbum da Copa do Mundo 2026. Cada figurinha repetida sua é exatamente
          o que falta para outro colecionador — e vice-versa. Este guia mostra as
          formas mais usadas no Brasil, os problemas de cada uma e como o{' '}
          <strong>Complete Aí</strong> torna o processo simples.
        </p>

        <h2 className="text-xl font-bold text-navy mt-8 mb-3">
          Por que trocar é melhor do que comprar
        </h2>
        <p className="text-gray-700 leading-relaxed">
          Comprar pacotes até completar o álbum custa, em média,{' '}
          <strong>cerca de R$ 7.140</strong>, por causa da quantidade enorme de
          figurinhas repetidas que você inevitavelmente vai pegar. Trocando bem,
          esse custo cai para perto de <strong>R$ 1.500</strong>. (Veja o cálculo
          completo em{' '}
          <Link
            href="/quanto-custa-completar-album-copa-2026"
            className="text-brand hover:text-brand-dark underline"
          >
            Quanto custa completar o álbum da Copa 2026?
          </Link>
          )
        </p>
        <p className="text-gray-700 leading-relaxed">
          Em outras palavras: troca não é só hobby, é a parte mais importante da
          estratégia de quem quer completar o álbum sem gastar uma fortuna.
        </p>

        <h2 className="text-xl font-bold text-navy mt-8 mb-3">
          Formas tradicionais de trocar (e seus problemas)
        </h2>

        <h3 className="text-base font-bold text-navy mt-5 mb-2">
          1. Trocar com amigos e família
        </h3>
        <p className="text-gray-700 leading-relaxed">
          A forma mais antiga e segura. Funciona muito bem no começo do álbum,
          mas o limite aparece rápido: poucas pessoas, poucas figurinhas em
          comum. Quando faltam as últimas 100, dificilmente alguém do seu círculo
          tem o que você precisa.
        </p>

        <h3 className="text-base font-bold text-navy mt-5 mb-2">
          2. Grupos de WhatsApp e fóruns
        </h3>
        <p className="text-gray-700 leading-relaxed">
          A opção mais comum. Resolve o problema do volume, mas traz outros:
        </p>
        <ul className="list-disc pl-5 space-y-1 text-gray-700 my-3">
          <li>Mensagens fora de ordem com listas enormes de números</li>
          <li>Difícil saber quem ainda tem o que postou semanas atrás</li>
          <li>Risco de cair em grupos com pessoas mal-intencionadas</li>
          <li>Encontros marcados longe ou em horários ruins</li>
        </ul>

        <h3 className="text-base font-bold text-navy mt-5 mb-2">
          3. Pontos de troca em bancas, livrarias e shoppings
        </h3>
        <p className="text-gray-700 leading-relaxed">
          A própria Panini costuma promover pontos oficiais de troca. São
          encontros bons para socializar, mas dependem de horários fixos e
          deslocamento. Para quem trabalha em horário comercial, raramente
          encaixa.
        </p>

        <h3 className="text-base font-bold text-navy mt-5 mb-2">
          4. Marketplaces (Mercado Livre, OLX)
        </h3>
        <p className="text-gray-700 leading-relaxed">
          Funciona quando faltam poucas figurinhas raras e específicas, mas é
          basicamente <strong>compra disfarçada de troca</strong>: você paga pelas
          figurinhas, em geral com sobrepreço. Pouco eficiente para reduzir o
          custo total do álbum.
        </p>

        <h2 className="text-xl font-bold text-navy mt-8 mb-3">
          Como funciona a troca pelo Complete Aí
        </h2>
        <p className="text-gray-700 leading-relaxed">
          O Complete Aí foi feito para resolver os problemas das opções acima de
          uma vez só:
        </p>
        <ol className="list-decimal pl-5 space-y-2 text-gray-700 my-3">
          <li>
            <strong>Escaneie suas figurinhas com a câmera</strong>: a IA
            identifica automaticamente quais você tem, quais faltam e quais estão
            repetidas. Não precisa montar planilha.
          </li>
          <li>
            <strong>O app encontra trocas compatíveis perto de você</strong>:
            outros colecionadores próximos que precisam exatamente do que você
            tem, e têm exatamente o que você precisa.
          </li>
          <li>
            <strong>Você aprova a troca antes de qualquer contato</strong>:
            ninguém recebe seu WhatsApp ou localização sem que você aceite
            primeiro.
          </li>
          <li>
            <strong>Notificação por WhatsApp quando tem match</strong>: você não
            precisa ficar olhando o app — recebe alerta quando aparece troca
            disponível na sua região.
          </li>
        </ol>

        <h2 className="text-xl font-bold text-navy mt-8 mb-3">
          Dicas de segurança ao trocar figurinhas
        </h2>
        <ul className="list-disc pl-5 space-y-2 text-gray-700 my-3">
          <li>
            <strong>Encontre em locais públicos e movimentados</strong>: bancas,
            shoppings, padarias, escolas. Evite endereços residenciais.
          </li>
          <li>
            <strong>Confirme as figurinhas antes do encontro</strong>: peça foto
            das figurinhas exatas que serão trocadas, com os números visíveis.
          </li>
          <li>
            <strong>Leve apenas o necessário</strong>: separe só as figurinhas da
            troca combinada, não o álbum inteiro.
          </li>
          <li>
            <strong>Adolescentes só com supervisão de um adulto</strong>: evite
            que crianças ou adolescentes vão sozinhos a encontros com
            desconhecidos.
          </li>
          <li>
            <strong>Desconfie de quem só quer comprar suas raras</strong>: troca
            é troca; venda é venda. Cada coisa tem seu lugar.
          </li>
        </ul>

        <h2 className="text-xl font-bold text-navy mt-8 mb-3">
          Vale a pena trocar pelo app em vez de WhatsApp comum?
        </h2>
        <p className="text-gray-700 leading-relaxed">
          Para os primeiros 200 ou 300 encaixes, qualquer método funciona. A
          diferença aparece nas <strong>últimas 100 figurinhas</strong> — quando
          encontrar quem tem o que falta vira agulha no palheiro. É exatamente aí
          que ter sua coleção indexada e o app cruzando dados de centenas de
          colecionadores muda o jogo.
        </p>

        <div className="bg-brand-light/50 rounded-2xl p-5 mt-10 text-center">
          <p className="text-base font-bold text-navy mb-1">
            Pronto para começar a trocar de verdade?
          </p>
          <p className="text-sm text-gray-600 mb-4">
            Crie sua conta grátis, escaneie sua coleção e descubra quantas
            trocas estão te esperando perto de você.
          </p>
          <Link
            href="/"
            className="inline-block bg-[#00C896] text-white rounded-2xl px-8 py-3 text-sm font-semibold hover:bg-[#00A67D] transition"
          >
            Começar grátis
          </Link>
        </div>

        <p className="text-xs text-gray-500 mt-8 leading-relaxed">
          O Complete Aí não é afiliado, endossado ou patrocinado pela FIFA,
          Panini, Topps ou qualquer organização oficial.
        </p>

        <p className="text-sm text-gray-600 mt-6">
          Veja também:{' '}
          <Link
            href="/quanto-custa-completar-album-copa-2026"
            className="text-brand hover:text-brand-dark underline"
          >
            Quanto custa completar o álbum
          </Link>{' '}
          ·{' '}
          <Link href="/faq" className="text-brand hover:text-brand-dark underline">
            Perguntas frequentes
          </Link>
        </p>
      </article>
    </main>
  )
}
