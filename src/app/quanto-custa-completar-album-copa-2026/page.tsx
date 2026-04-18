import type { Metadata } from 'next'
import Link from 'next/link'

const PAGE_URL = 'https://www.completeai.com.br/quanto-custa-completar-album-copa-2026'

export const metadata: Metadata = {
  title: 'Quanto custa completar o álbum da Copa 2026?',
  description:
    'Cálculo real: quantas figurinhas tem o álbum da Copa do Mundo 2026, quanto custa em pacotes e como economizar trocando figurinhas repetidas.',
  alternates: { canonical: PAGE_URL },
  openGraph: {
    title: 'Quanto custa completar o álbum da Copa 2026?',
    description:
      'Estimativa real do custo de completar o álbum da Copa 2026 e como reduzir esse valor com trocas inteligentes.',
    url: PAGE_URL,
    type: 'article',
  },
}

const articleSchema = {
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: 'Quanto custa completar o álbum da Copa 2026?',
  description:
    'Cálculo real do custo de completar o álbum da Copa do Mundo 2026 e como economizar com trocas.',
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
          Quanto custa completar o álbum da Copa 2026?
        </h1>
        <p className="text-white/70 text-sm max-w-md mx-auto">
          Cálculo real, com base em estatística e nos números oficiais do álbum.
        </p>
      </header>

      <article className="max-w-2xl mx-auto px-5 py-10 prose prose-sm sm:prose-base prose-headings:text-navy prose-strong:text-navy">
        <p className="text-base text-gray-700 leading-relaxed">
          Se você está montando o álbum oficial da Copa do Mundo 2026, provavelmente
          já se perguntou: <strong>quanto eu preciso gastar para completar?</strong>{' '}
          A resposta envolve um pouco de matemática — e a conta costuma assustar.
        </p>

        <h2 className="text-xl font-bold text-navy mt-8 mb-3">
          Quantas figurinhas o álbum da Copa 2026 tem?
        </h2>
        <p className="text-gray-700 leading-relaxed">
          O álbum oficial da Copa do Mundo 2026 traz <strong>1.028 figurinhas</strong>{' '}
          no total, divididas entre:
        </p>
        <ul className="list-disc pl-5 space-y-1 text-gray-700 my-3">
          <li>864 figurinhas de jogadores das 48 seleções classificadas</li>
          <li>96 figurinhas especiais (legendas, estrelas, momentos icônicos)</li>
          <li>48 emblemas oficiais (um por seleção)</li>
          <li>15 figurinhas dos estádios-sede da Copa</li>
          <li>5 figurinhas do troféu e elementos decorativos</li>
        </ul>

        <h2 className="text-xl font-bold text-navy mt-8 mb-3">
          Quanto custa em pacotes (cálculo direto)
        </h2>
        <p className="text-gray-700 leading-relaxed">
          O preço esperado do pacote da Copa 2026 é de cerca de{' '}
          <strong>R$ 5,00 com 5 figurinhas cada</strong>. Se você tivesse a sorte
          impossível de nunca pegar nenhuma figurinha repetida, precisaria comprar:
        </p>
        <p className="text-gray-700 leading-relaxed bg-brand-light/40 border-l-4 border-brand px-4 py-3 my-4 rounded-r-lg">
          <strong>1.028 ÷ 5 = 206 pacotes</strong>
          <br />
          206 × R$ 5 ={' '}
          <strong className="text-brand-dark">R$ 1.030 (cenário ideal)</strong>
        </p>
        <p className="text-gray-700 leading-relaxed">
          Esse é o piso teórico. Na prática, o valor real é{' '}
          <strong>muito mais alto</strong> — porque você vai pegar muita figurinha
          repetida.
        </p>

        <h2 className="text-xl font-bold text-navy mt-8 mb-3">
          O problema das figurinhas repetidas
        </h2>
        <p className="text-gray-700 leading-relaxed">
          Em estatística, esse fenômeno tem nome:{' '}
          <strong>problema do colecionador de cupons</strong>. Quanto mais perto do
          fim do álbum você chega, maior a chance de cada nova figurinha ser
          repetida — porque sobram poucas faltantes para sortear.
        </p>
        <p className="text-gray-700 leading-relaxed">
          Aplicando a fórmula a um álbum de 1.028 figurinhas, a expectativa é que
          você precise abrir aproximadamente{' '}
          <strong>7.140 figurinhas no total</strong> (entre repetidas e novas) para
          conseguir todas. Isso significa:
        </p>
        <p className="text-gray-700 leading-relaxed bg-red-50 border-l-4 border-red-400 px-4 py-3 my-4 rounded-r-lg">
          7.140 ÷ 5 = <strong>1.428 pacotes</strong>
          <br />
          1.428 × R$ 5 ={' '}
          <strong className="text-red-700">R$ 7.140 (custo realista)</strong>
        </p>
        <p className="text-gray-700 leading-relaxed">
          Em outras palavras: se você comprar pacotes aleatórios do começo ao fim,
          provavelmente vai gastar perto de <strong>R$ 7 mil</strong> e ainda vai
          terminar com cerca de <strong>6.100 figurinhas repetidas</strong> em casa.
        </p>

        <h2 className="text-xl font-bold text-navy mt-8 mb-3">
          Como reduzir esse custo: trocar figurinhas
        </h2>
        <p className="text-gray-700 leading-relaxed">
          A solução clássica para esse problema é <strong>trocar figurinhas</strong>.
          Suas repetidas viram a moeda que outros colecionadores precisam, e
          vice-versa. Em teoria, se você conseguir trocar todas as suas repetidas,
          o custo cai para perto do cenário ideal de R$ 1.030.
        </p>
        <p className="text-gray-700 leading-relaxed">
          Na prática, organizar trocas dá trabalho:
        </p>
        <ul className="list-disc pl-5 space-y-1 text-gray-700 my-3">
          <li>Manter uma planilha atualizada de faltantes e repetidas</li>
          <li>Procurar grupos de WhatsApp e fóruns de colecionadores</li>
          <li>Combinar troca, distância, horário e segurança</li>
          <li>Conferir se a pessoa tem mesmo o que diz ter</li>
        </ul>

        <h2 className="text-xl font-bold text-navy mt-8 mb-3">
          Comparativo: comprar tudo vs. trocar usando o Complete Aí
        </h2>
        <div className="overflow-x-auto my-4">
          <table className="w-full text-sm border border-gray-200 rounded-lg overflow-hidden">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-3 py-2 font-semibold text-navy">Estratégia</th>
                <th className="text-right px-3 py-2 font-semibold text-navy">Custo estimado</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-gray-100">
                <td className="px-3 py-2 text-gray-700">Comprar pacotes até completar</td>
                <td className="px-3 py-2 text-right text-red-700 font-semibold">~R$ 7.140</td>
              </tr>
              <tr className="border-t border-gray-100 bg-gray-50/50">
                <td className="px-3 py-2 text-gray-700">Comprar pacotes + trocar repetidas</td>
                <td className="px-3 py-2 text-right text-gray-700 font-semibold">~R$ 1.500–2.500</td>
              </tr>
              <tr className="border-t border-gray-100">
                <td className="px-3 py-2 text-gray-700">
                  Comprar pacotes + trocar pelo <strong>Complete Aí</strong>
                </td>
                <td className="px-3 py-2 text-right text-brand-dark font-semibold">
                  ~R$ 1.030–1.500
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-gray-700 leading-relaxed">
          O Complete Aí usa <strong>inteligência artificial</strong> para escanear
          suas figurinhas com a câmera do celular, organizar a lista
          automaticamente e encontrar trocas compatíveis com colecionadores perto
          de você. Isso elimina o trabalho manual e torna a troca prática o
          suficiente para todo mundo fazer.
        </p>

        <h2 className="text-xl font-bold text-navy mt-8 mb-3">
          Vale a pena completar o álbum?
        </h2>
        <p className="text-gray-700 leading-relaxed">
          Depende do que vale para você: a memória, a coleção física ou a
          experiência de acompanhar a Copa figurinha por figurinha. O que dá para
          afirmar é que o jogo muda muito quando você tem uma ferramenta para{' '}
          <strong>trocar de forma inteligente</strong> — o que custa R$ 7 mil
          comprando às cegas pode custar menos de R$ 1.500 com trocas bem feitas.
        </p>

        <div className="bg-brand-light/50 rounded-2xl p-5 mt-10 text-center">
          <p className="text-base font-bold text-navy mb-1">
            Quer começar a economizar agora?
          </p>
          <p className="text-sm text-gray-600 mb-4">
            Crie sua conta grátis no Complete Aí, escaneie suas figurinhas com IA
            e descubra trocas perto de você.
          </p>
          <Link
            href="/"
            className="inline-block bg-[#00C896] text-white rounded-2xl px-8 py-3 text-sm font-semibold hover:bg-[#00A67D] transition"
          >
            Começar grátis
          </Link>
        </div>

        <p className="text-xs text-gray-500 mt-8 leading-relaxed">
          Os valores são estimativas baseadas em preços médios esperados de pacotes
          oficiais e na fórmula estatística do problema do colecionador. O custo
          real pode variar conforme o preço do pacote, sua sorte na compra e a
          eficiência das trocas. O Complete Aí não é afiliado, endossado ou
          patrocinado pela FIFA, Panini, Topps ou qualquer organização oficial.
        </p>

        <p className="text-sm text-gray-600 mt-6">
          Veja também:{' '}
          <Link href="/como-trocar-figurinhas-copa-2026" className="text-brand hover:text-brand-dark underline">
            Como trocar figurinhas da Copa 2026
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
