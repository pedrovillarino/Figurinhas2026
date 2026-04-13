import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Termos de Serviço — Complete Aí',
  description: 'Termos de Serviço do Complete Aí — aplicativo de álbum de figurinhas com IA.',
  openGraph: {
    title: 'Termos de Serviço — Complete Aí',
    url: 'https://www.completeai.com.br/termos',
  },
  alternates: { canonical: 'https://www.completeai.com.br/termos' },
}

function Section({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-bold text-navy">
        {number}. {title}
      </h2>
      {children}
    </section>
  )
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-gray-600 leading-relaxed">{children}</p>
}

function SubSection({ id, children }: { id: string; children: React.ReactNode }) {
  return <div id={id} className="space-y-2 pl-4 border-l-2 border-gray-100">{children}</div>
}

function UL({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc list-inside text-sm text-gray-600 leading-relaxed space-y-1 ml-2">{children}</ul>
}

export default function TermosPage() {
  return (
    <main className="min-h-screen bg-white px-5 py-10 max-w-2xl mx-auto">
      <a
        href="/"
        className="text-brand text-sm font-medium hover:text-brand-dark transition mb-6 inline-block"
      >
        &larr; Voltar
      </a>

      <h1 className="text-2xl font-black text-navy mb-2">Termos de Serviço</h1>
      <p className="text-xs text-gray-400 mb-8">
        Última atualização: 13 de abril de 2026 — Versão 1.2
      </p>

      <div className="bg-gold-light border border-gold rounded-lg p-4 mb-8">
        <p className="text-xs text-gray-700 leading-relaxed font-medium">
          Este app NÃO é afiliado, endossado, patrocinado ou de qualquer forma associado à FIFA,
          Panini, Topps, Fanatics ou qualquer organização oficial. Todas as marcas registradas
          pertencem a seus respectivos titulares.
        </p>
      </div>

      <div className="space-y-8">
        {/* 1. Identificação */}
        <Section number={1} title="Identificação">
          <P>
            O aplicativo <strong>Complete Aí</strong> (&quot;Plataforma&quot;, &quot;App&quot;, &quot;Serviço&quot;) é
            operado pelo Complete Aí (&quot;nós&quot;, &quot;nosso&quot;), contactável pelo e-mail{' '}
            <a href="mailto:contato@completeai.com.br" className="text-brand hover:text-brand-dark underline">
              contato@completeai.com.br
            </a>.
          </P>
          <P>
            O Encarregado de Proteção de Dados (DPO) pode ser contatado pelo e-mail{' '}
            <a href="mailto:contato@completeai.com.br" className="text-brand hover:text-brand-dark underline">
              contato@completeai.com.br
            </a>.
          </P>
        </Section>

        {/* 2. Aceitação */}
        <Section number={2} title="Aceitação dos Termos">
          <P>
            Ao criar uma conta ou utilizar o Serviço, você declara que leu, compreendeu e concorda
            integralmente com estes Termos de Serviço e com a nossa Política de Privacidade. Caso
            não concorde com qualquer disposição, não utilize o App.
          </P>
          <P>
            Estes Termos constituem um contrato vinculante entre você (&quot;Usuário&quot;) e o Complete Aí,
            regulando o acesso e uso da Plataforma.
          </P>
        </Section>

        {/* 3. Descrição do Serviço */}
        <Section number={3} title="Descrição do Serviço">
          <P>O Complete Aí é uma plataforma digital que oferece:</P>
          <UL>
            <li>Gerenciamento digital de álbum de figurinhas colecionáveis;</li>
            <li>Escaneamento de figurinhas por meio de inteligência artificial (câmera/IA);</li>
            <li>Listagem e busca de figurinhas faltantes e repetidas;</li>
            <li>Facilitação de trocas entre usuários;</li>
            <li>Exportação de listas em diversos formatos;</li>
            <li>Estatísticas e progresso de coleção.</li>
          </UL>
          <P>
            O Serviço é fornecido &quot;como está&quot; (<em>as is</em>). Não garantimos que o App estará
            disponível de forma ininterrupta, livre de erros ou que os resultados do escaneamento
            por IA serão 100% precisos.
          </P>
          <SubSection id="3.1">
            <P>
              <strong>Vigência:</strong> O Complete Aí é um serviço temporário vinculado à edição 2026 do maior
              torneio internacional de futebol de seleções.
              A prestação do serviço está prevista até <strong>31 de dezembro de 2026</strong>, podendo ser
              encerrada antes ou estendida a critério exclusivo do Complete Aí, mediante aviso prévio aos usuários.
              Após o encerramento, os dados do usuário serão mantidos por 90 dias e então excluídos.
            </P>
          </SubSection>
        </Section>

        {/* 4. Planos e Preços */}
        <Section number={4} title="Planos e Preços">
          <SubSection id="4.1">
            <p className="text-sm font-semibold text-navy">4.1. Planos disponíveis</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left border border-gray-200 rounded-lg overflow-hidden">
                <thead className="bg-gray-50 text-navy">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Plano</th>
                    <th className="px-3 py-2 font-semibold">Preço</th>
                    <th className="px-3 py-2 font-semibold">Recursos</th>
                  </tr>
                </thead>
                <tbody className="text-gray-600 divide-y divide-gray-100">
                  <tr>
                    <td className="px-3 py-2 font-medium">Free</td>
                    <td className="px-3 py-2">Grátis</td>
                    <td className="px-3 py-2">Controle manual do álbum, 5 scans com IA (~40 figurinhas), 2 trocas incluídas, com anúncios</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 font-medium">Estreante</td>
                    <td className="px-3 py-2">R$&nbsp;9,90 (pagamento único)</td>
                    <td className="px-3 py-2">50 scans com IA (~400 figurinhas), 5 trocas incluídas, sem anúncios</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 font-medium">Colecionador</td>
                    <td className="px-3 py-2">R$&nbsp;19,90 (pagamento único)</td>
                    <td className="px-3 py-2">150 scans com IA (~1.200 figurinhas), 15 trocas incluídas, packs avulsos mais baratos, sem anúncios</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 font-medium">Copa Completa</td>
                    <td className="px-3 py-2">R$&nbsp;29,90 (pagamento único)</td>
                    <td className="px-3 py-2">500 scans com IA (~4.000 figurinhas), trocas ilimitadas, sem anúncios</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </SubSection>

          <SubSection id="4.2">
            <p className="text-sm font-semibold text-navy">4.2. Forma de pagamento</p>
            <P>
              Os planos pagos são cobrados uma única vez via Stripe. Não há renovação automática.
              O pagamento concede acesso vitalício aos recursos do plano para a edição atual do álbum.
              Os preços são expressos em Reais (BRL) e incluem todos os tributos aplicáveis.
            </P>
          </SubSection>

          <SubSection id="4.3">
            <p className="text-sm font-semibold text-navy">4.3. Direito de arrependimento</p>
            <P>
              Conforme o Art. 49 do Código de Defesa do Consumidor (CDC), você tem o direito de
              solicitar o reembolso integral em até 7 (sete) dias corridos a partir da data do
              pagamento, sem necessidade de justificativa. Para exercer esse direito, entre em
              contato pelo e-mail{' '}
              <a href="mailto:contato@completeai.com.br" className="text-brand hover:text-brand-dark underline">
                contato@completeai.com.br
              </a>.
            </P>
          </SubSection>

          <SubSection id="4.4">
            <p className="text-sm font-semibold text-navy">4.4. Acesso ao plano pago</p>
            <P>
              O acesso ao plano pago é permanente para a edição atual do álbum. Caso uma nova
              edição do álbum seja lançada (por exemplo, para uma nova competição ou temporada),
              os recursos pagos se aplicam apenas à edição para a qual o pagamento foi realizado.
              Novas edições poderão exigir aquisição separada.
            </P>
          </SubSection>

          <SubSection id="4.5">
            <p className="text-sm font-semibold text-navy">4.5. Downgrade</p>
            <P>
              Caso você solicite o reembolso dentro do prazo previsto na seção 4.3, seu plano será
              revertido ao Free. Dados de figurinhas serão mantidos, porém recursos exclusivos do
              plano pago deixarão de estar disponíveis.
            </P>
          </SubSection>

          <SubSection id="4.6">
            <p className="text-sm font-semibold text-navy">4.6. Alteração de preços</p>
            <P>
              Os preços dos planos são: Estreante R$&nbsp;9,90, Colecionador R$&nbsp;19,90 e Copa Completa R$&nbsp;29,90.
              Eventuais alterações de preço serão comunicadas com pelo menos 30 dias de antecedência
              por meio do App ou e-mail. Usuários que já realizaram o pagamento mantêm o plano
              adquirido nas condições originais, visto que o pagamento é único e já foi concluído.
            </P>
          </SubSection>

          <SubSection id="4.7">
            <p className="text-sm font-semibold text-navy">4.7. Pacotes extras de scans</p>
            <P>
              Usuários dos planos Estreante e Colecionador que esgotarem seus scans ou trocas incluídos podem adquirir
              pacotes extras de <strong>+100 scans</strong> ou <strong>+10 trocas</strong> (pagamento único por pacote).
              Os preços variam conforme o plano: Estreante paga R$&nbsp;10,00 por pacote e Colecionador paga R$&nbsp;5,00.
              Cada scan processa uma foto e pode detectar múltiplas figurinhas de uma vez. Os créditos
              extras não expiram e são cumulativos com o saldo do plano. Usuários do plano Free e Copa Completa
              não possuem opção de compra avulsa.
            </P>
          </SubSection>
        </Section>

        {/* 5. Menores de Idade */}
        <Section number={5} title="Menores de Idade">
          <P>
            O uso do App por menores de 18 anos requer consentimento expresso de um dos pais ou
            responsável legal, conforme o Art. 14 da Lei Geral de Proteção de Dados (LGPD).
            O responsável legal assume inteira responsabilidade pelas atividades do menor na
            Plataforma, incluindo eventuais compras.
          </P>
          <P>
            Menores de 13 anos não estão autorizados a utilizar o Serviço.
          </P>
        </Section>

        {/* 6. Conta do Usuário */}
        <Section number={6} title="Conta do Usuário">
          <P>
            Para utilizar o Serviço, é necessário criar uma conta por meio de e-mail/senha ou
            autenticação social (Google). Você é responsável por manter a confidencialidade de
            suas credenciais e por todas as atividades realizadas em sua conta.
          </P>
          <UL>
            <li>Cada pessoa pode manter apenas uma conta ativa;</li>
            <li>Informações fornecidas devem ser verdadeiras e atualizadas;</li>
            <li>
              Notifique-nos imediatamente em caso de uso não autorizado pelo e-mail{' '}
              <a href="mailto:contato@completeai.com.br" className="text-brand hover:text-brand-dark underline">
                contato@completeai.com.br
              </a>;
            </li>
            <li>Reservamo-nos o direito de suspender ou encerrar contas que violem estes Termos.</li>
          </UL>
        </Section>

        {/* 7. Trocas entre Usuários */}
        <Section number={7} title="Trocas entre Usuários">
          <P>
            O Complete Aí facilita a conexão entre colecionadores para troca de figurinhas físicas.
            No entanto:
          </P>
          <UL>
            <li>
              O App <strong>não intermedia, garante ou se responsabiliza</strong> pela efetiva
              realização das trocas;
            </li>
            <li>As trocas ocorrem diretamente entre os usuários, sob sua própria responsabilidade;</li>
            <li>
              Não nos responsabilizamos por figurinhas danificadas, extraviadas, falsificadas ou
              por qualquer prejuízo decorrente de trocas;
            </li>
            <li>
              Ao propor ou aceitar uma troca, você concorda em agir de boa-fé e tratar os demais
              usuários com respeito.
            </li>
          </UL>
        </Section>

        {/* 8. Regras de Uso */}
        <Section number={8} title="Regras de Uso">
          <P>Ao utilizar o Serviço, você concorda em NÃO:</P>
          <UL>
            <li>Criar contas falsas ou múltiplas contas;</li>
            <li>Utilizar bots, scrapers ou ferramentas automatizadas;</li>
            <li>Tentar acessar áreas restritas do sistema ou de outros usuários;</li>
            <li>Publicar conteúdo ofensivo, ilegal, difamatório ou que viole direitos de terceiros;</li>
            <li>Usar o App para qualquer finalidade comercial não autorizada;</li>
            <li>Realizar engenharia reversa, descompilação ou desmontagem do software;</li>
            <li>Manipular ou fraudar o sistema de trocas ou progresso de coleção;</li>
            <li>Compartilhar credenciais de acesso com terceiros.</li>
          </UL>
          <P>
            O descumprimento destas regras poderá resultar em suspensão ou exclusão permanente da
            conta, sem direito a reembolso (exceto quando previsto no CDC).
          </P>
        </Section>

        {/* 9. Propriedade Intelectual */}
        <Section number={9} title="Propriedade Intelectual">
          <P>
            Todo o conteúdo do App — incluindo, mas não se limitando a, código-fonte, design,
            textos, logotipos, ícones, algoritmos de IA e interfaces — é de propriedade exclusiva
            do Complete Aí ou de seus licenciadores, protegido pela Lei de Direitos Autorais
            (Lei 9.610/98) e pela Lei de Software (Lei 9.609/98).
          </P>
          <P>
            As imagens de figurinhas pertencem aos seus respectivos titulares. O App exibe apenas
            representações para fins de identificação e gerenciamento de coleção.
          </P>
          <P>
            O usuário concede ao Complete Aí uma licença não exclusiva, gratuita e mundial para
            utilizar os dados anonimizados e agregados de uso do App para fins de melhoria do
            Serviço e geração de estatísticas.
          </P>
        </Section>

        {/* 10. Publicidade */}
        <Section number={10} title="Publicidade">
          <P>
            O plano Free poderá exibir anúncios de terceiros. Os planos pagos (Estreante, Colecionador e Copa Completa)
            oferecem experiência livre de anúncios. Não compartilhamos dados pessoais
            identificáveis com anunciantes sem o seu consentimento explícito.
          </P>
        </Section>

        {/* 11. Disponibilidade e Limitação de Responsabilidade */}
        <Section number={11} title="Disponibilidade e Limitação de Responsabilidade">
          <P>
            Empenhamo-nos para manter o Serviço disponível 24 horas por dia, 7 dias por semana.
            Contudo, poderão ocorrer interrupções para manutenção, atualizações ou por motivos de
            força maior.
          </P>
          <P>
            Na máxima extensão permitida pela legislação aplicável, o Complete Aí não será
            responsável por:
          </P>
          <UL>
            <li>Danos indiretos, incidentais, especiais ou consequenciais;</li>
            <li>Perda de dados decorrente de falhas técnicas;</li>
            <li>Indisponibilidade temporária do Serviço;</li>
            <li>Atos ou omissões de terceiros (incluindo outros usuários);</li>
            <li>Imprecisões no reconhecimento de figurinhas pela IA.</li>
          </UL>
          <P>
            A responsabilidade total do Complete Aí, em qualquer hipótese, estará limitada ao
            valor efetivamente pago pelo Usuário no plano ativo, conforme descrito na seção 4.
          </P>
        </Section>

        {/* 12. Alteração dos Termos */}
        <Section number={12} title="Alteração dos Termos">
          <P>
            Reservamo-nos o direito de alterar estes Termos a qualquer momento. As alterações
            entrarão em vigor após publicação na Plataforma. Alterações substanciais serão
            comunicadas por e-mail ou notificação no App com antecedência mínima de 15 dias.
          </P>
          <P>
            O uso continuado do Serviço após a publicação das alterações constitui aceitação dos
            novos Termos. Caso discorde, você poderá encerrar sua conta a qualquer momento.
          </P>
        </Section>

        {/* 13. Lei Aplicável e Foro */}
        <Section number={13} title="Lei Aplicável e Foro">
          <P>
            Estes Termos são regidos pela legislação da República Federativa do Brasil. Para
            dirimir quaisquer controvérsias oriundas destes Termos, fica eleito o foro da Comarca
            do domicílio do consumidor, conforme Art. 101, I, do Código de Defesa do Consumidor.
          </P>
          <P>
            Antes de recorrer ao Judiciário, encorajamos a resolução amigável de disputas através
            do nosso canal de atendimento.
          </P>
        </Section>

        {/* 14. Contato */}
        <Section number={14} title="Contato">
          <P>
            Para dúvidas, solicitações ou reclamações, entre em contato conosco:
          </P>
          <UL>
            <li>
              <strong>E-mail:</strong>{' '}
              <a href="mailto:contato@completeai.com.br" className="text-brand hover:text-brand-dark underline">
                contato@completeai.com.br
              </a>
            </li>
            <li>
              <strong>DPO (Encarregado de Proteção de Dados):</strong>{' '}
              <a href="mailto:contato@completeai.com.br" className="text-brand hover:text-brand-dark underline">
                contato@completeai.com.br
              </a>
            </li>
          </UL>
          <P>Prazo de resposta: até 15 dias corridos.</P>
        </Section>
      </div>

      {/* Footer disclaimer */}
      <div className="mt-12 pt-6 border-t border-gray-200">
        <p className="text-xs text-gray-400 italic text-center">
          O Complete Aí é operado por Pedro Villarino, pessoa física domiciliada no Brasil.
          A identificação completa do responsável pode ser solicitada por requerimento formal
          ao e-mail contato@completeai.com.br.
        </p>
      </div>
    </main>
  )
}
