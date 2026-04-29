import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Regulamento — Concurso de Engajamento Complete Aí',
  description:
    'Regulamento oficial do concurso de engajamento Complete Aí + Panini Copa do Mundo 2026 (29/04 a 02/05).',
  robots: 'index, follow',
}

export default function RegulamentoConcursoPage() {
  return (
    <main className="max-w-3xl mx-auto px-5 py-10 text-gray-800">
      <p className="text-[11px] uppercase tracking-widest text-brand font-bold mb-2">Regulamento oficial</p>
      <h1 className="text-2xl sm:text-3xl font-black text-navy mb-2">
        Concurso de Engajamento — Álbum + Porta-Figurinhas Complete Aí
      </h1>
      <p className="text-sm text-gray-500 mb-8">
        Vigente de 29/04/2026 a 02/05/2026.
      </p>

      <div className="prose prose-sm max-w-none space-y-6">
        <Section number="1" title="Promotora">
          <p>
            <strong>Complete Aí</strong> —{' '}
            <a href="https://www.completeai.com.br" className="text-brand underline">
              completeai.com.br
            </a>
            <br />
            CNPJ: 66.419.914/0001-08
          </p>
        </Section>

        <Section number="2" title="Natureza">
          <p>
            Concurso de engajamento <strong>gratuito</strong>, sem qualquer obrigação de
            compra ou pagamento. O resultado depende exclusivamente do mérito do
            participante (engajamento orgânico no perfil oficial).
          </p>
          <p>Esta promoção não tem vínculo com a Meta/Instagram.</p>
        </Section>

        <Section number="3" title="Período">
          <ul>
            <li><strong>Início:</strong> 29/04/2026</li>
            <li><strong>Encerramento das participações:</strong> 01/05/2026 às 23:59 (BRT)</li>
            <li><strong>Apuração do resultado:</strong> 02/05/2026</li>
            <li><strong>Anúncio do ganhador:</strong> 02/05/2026</li>
          </ul>
        </Section>

        <Section number="4" title="Como participar">
          <p>Para concorrer, o participante deve cumprir cumulativamente:</p>
          <ol className="list-[lower-alpha] pl-5 space-y-1">
            <li>Seguir o perfil <strong>@completeai</strong> no Instagram</li>
            <li>Comentar no post oficial do concurso marcando <strong>1 (um) amigo</strong></li>
            <li>
              Possuir cadastro ativo em{' '}
              <a href="https://www.completeai.com.br" className="text-brand underline">
                completeai.com.br
              </a>{' '}
              até o encerramento das participações
            </li>
          </ol>
        </Section>

        <Section number="5" title="Múltiplas participações">
          <p>
            O participante pode comentar até <strong>10 (dez) vezes</strong> no post oficial,
            desde que cada comentário marque <strong>APENAS 1 amigo</strong> e amigos
            <strong> diferentes</strong> em cada comentário.
          </p>
          <p>
            Comentários com mais de uma marcação serão desconsiderados. O mesmo amigo marcado
            em comentários diferentes conta como uma única entrada.
          </p>
        </Section>

        <Section number="6" title="Prêmio">
          <p>Cada ganhador recebe:</p>
          <ul>
            <li>1 álbum oficial Panini Copa do Mundo FIFA 2026 (versão capa mole)</li>
            <li>1 porta-figurinhas</li>
          </ul>
          <p>
            Se o amigo marcado pelo vencedor também atender a todos os requisitos do item 4,
            <strong> ambos receberão</strong> o prêmio descrito acima.
          </p>
        </Section>

        <Section number="7" title="Apuração">
          <p>
            Realizada via plataforma <strong>Sorteiogram</strong>{' '}
            (<a href="https://sorteiogram.com" target="_blank" rel="noopener noreferrer" className="text-brand underline">
              sorteiogram.com
            </a>),
            com gravação em tela publicada nos stories oficiais{' '}
            <strong>@completeai</strong>.
          </p>
        </Section>

        <Section number="8" title="Checagem de elegibilidade">
          <p>
            A elegibilidade do ganhador e do amigo marcado será confirmada via solicitação de
            comprovação direta antes do envio do prêmio (print da tela de cadastro logado em
            completeai.com.br + confirmação do email cadastrado).
          </p>
          <p>
            Apenas serão considerados elegíveis cadastros realizados até{' '}
            <strong>01/05/2026 às 23:59</strong>. Cadastros realizados após o encerramento não
            serão aceitos para reivindicação do prêmio.
          </p>
          <p>
            Caso o ganhador ou o amigo marcado não comprovem elegibilidade dentro de{' '}
            <strong>48h</strong> após o contato, nova apuração será realizada.
          </p>
        </Section>

        <Section number="9" title="Entrega">
          <p>
            <strong>Envio gratuito</strong> via Correios para qualquer endereço no Brasil.
          </p>
          <p>
            Postagem em até <strong>7 dias úteis</strong> após o fornecimento do endereço pelo(s)
            ganhador(es).
          </p>
        </Section>

        <Section number="10" title="Contato">
          <p>
            Vencedores serão comunicados por DM no Instagram em até <strong>24h</strong> após
            a apuração.
          </p>
          <p>
            Caso não respondam em <strong>7 dias corridos</strong>, nova apuração será
            realizada.
          </p>
        </Section>

        <Section number="11" title="Dados pessoais">
          <p>
            Os dados coletados serão usados <strong>exclusivamente</strong> para verificação
            de elegibilidade e envio do prêmio, em conformidade com a{' '}
            <Link href="/privacidade" className="text-brand underline">LGPD</Link>.
          </p>
        </Section>
      </div>

      <hr className="my-8 border-gray-200" />

      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between text-xs text-gray-500">
        <Link href="/campanha" className="text-brand font-medium hover:underline">
          ← Voltar para a campanha
        </Link>
        <span>Última atualização: 29/04/2026</span>
      </div>
    </main>
  )
}

function Section({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-base font-bold text-navy mb-2">
        {number}. {title}
      </h2>
      <div className="text-sm leading-relaxed space-y-2 text-gray-700">{children}</div>
    </section>
  )
}
