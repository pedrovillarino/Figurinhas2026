import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Política de Privacidade',
  description: 'Política de Privacidade do Complete Aí',
}

export default function PrivacidadePage() {
  return (
    <main className="min-h-screen bg-white px-5 py-10 max-w-2xl mx-auto">
      <a href="/" className="text-brand text-sm font-medium hover:text-brand-dark transition mb-6 inline-block">
        &larr; Voltar
      </a>

      <h1 className="text-2xl font-black text-navy mb-2">Política de Privacidade</h1>
      <p className="text-xs text-gray-400 mb-8">Última atualização: 12 de abril de 2026 — Versão 1.1</p>

      <div className="space-y-8 text-sm text-gray-600 leading-relaxed">
        <Section title="1. Responsável pelo Tratamento">
          <p>
            O responsável pelo tratamento dos dados pessoais é <strong>Pedro Villarino Muniz de Mello</strong>,
            pessoa física, inscrito no CPF sob n.o 109.353.577-69, atuando como Controlador nos termos da Lei Geral
            de Proteção de Dados (Lei 13.709/2018).
          </p>
          <p className="mt-2">
            <strong>Encarregado de Proteção de Dados (DPO):</strong> Pedro Villarino — pedrovillarino@gmail.com
          </p>
        </Section>

        <Section title="2. Dados Coletados">
          <p className="font-medium text-navy mb-2">2.1 Dados fornecidos pelo usuário:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Nome e e-mail (cadastro via Google ou formulário)</li>
            <li>Data de nascimento (verificação de idade)</li>
            <li>Telefone/WhatsApp (opcional, para recurso de trocas)</li>
            <li>Lista de figurinhas (coladas, faltantes, repetidas)</li>
          </ul>

          <p className="font-medium text-navy mb-2 mt-4">2.2 Dados coletados automaticamente:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Localização aproximada (com consentimento, para recurso de trocas — precisão de ~1km)</li>
            <li>Dados de uso do aplicativo (páginas visitadas, funcionalidades utilizadas)</li>
            <li>Contagem de scans realizados (para controle de limites do plano — sem armazenamento das imagens)</li>
          </ul>

          <p className="font-medium text-navy mb-2 mt-4">2.3 Dados NÃO coletados:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Fotos do scanner — são processadas em memória e descartadas imediatamente, sem armazenamento</li>
            <li>Dados biométricos</li>
            <li>Histórico de localização — apenas o último ponto informado é salvo</li>
          </ul>
        </Section>

        <Section title="3. Finalidade do Tratamento">
          <ul className="list-disc pl-5 space-y-1">
            <li>Prestar o serviço de organização de álbum digital de figurinhas</li>
            <li>Identificar figurinhas via Scanner IA (processamento em memória, sem armazenamento de imagens)</li>
            <li>Conectar colecionadores para trocas (com base em localização aproximada e consentimento)</li>
            <li>Enviar notificações sobre trocas compatíveis (via WhatsApp e/ou e-mail, conforme preferência)</li>
            <li>Processar pagamentos de planos e pacotes extras (via Stripe — não armazenamos dados de cartão)</li>
            <li>Controlar limites de uso de scans por plano contratado</li>
            <li>Cumprir obrigações legais (ECA Digital, LGPD, CDC)</li>
          </ul>
        </Section>

        <Section title="4. Base Legal">
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Consentimento</strong> (Art. 7o, I, LGPD) — para coleta de localização, compartilhamento de WhatsApp em trocas</li>
            <li><strong>Execução de contrato</strong> (Art. 7o, V, LGPD) — para prestação do serviço e processamento de pagamentos</li>
            <li><strong>Legítimo interesse</strong> (Art. 7o, IX, LGPD) — para melhorias no serviço e comunicações sobre o app</li>
            <li><strong>Cumprimento de obrigação legal</strong> (Art. 7o, II, LGPD) — para verificação de idade e proteção de menores</li>
          </ul>
        </Section>

        <Section title="5. Compartilhamento de Dados">
          <p>Seus dados pessoais podem ser compartilhados com:</p>
          <ul className="list-disc pl-5 space-y-1 mt-2">
            <li><strong>Outros usuários</strong> — apenas WhatsApp, apenas mediante consentimento explícito por troca, revogável a qualquer momento</li>
            <li><strong>Stripe</strong> — processamento de pagamentos (nome, e-mail)</li>
            <li><strong>Google</strong> — autenticação via Google Sign-In</li>
            <li><strong>Supabase</strong> — infraestrutura de banco de dados e autenticação</li>
            <li><strong>Google Gemini</strong> — processamento de imagens no scanner (imagem processada em memória, sem armazenamento)</li>
          </ul>
          <p className="mt-2">
            NÃO vendemos, alugamos ou comercializamos dados pessoais a terceiros.
          </p>
        </Section>

        <Section title="6. Proteção de Menores">
          <p>
            Em conformidade com a Lei 15.211/2025 (ECA Digital), adotamos as seguintes medidas para menores de 18 anos:
          </p>
          <ul className="list-disc pl-5 space-y-1 mt-2">
            <li>Verificação de idade no cadastro (data de nascimento)</li>
            <li>Menores de 13 anos não podem usar o serviço</li>
            <li>Menores de 18 anos não compartilham WhatsApp — usam chat mediado pelo app</li>
            <li>Geolocalização reduzida (apenas cidade/bairro, sem coordenadas precisas)</li>
            <li>Sem anúncios personalizados</li>
            <li>Planos pagos exigem autorização do responsável legal</li>
          </ul>
        </Section>

        <Section title="7. Segurança dos Dados">
          <ul className="list-disc pl-5 space-y-1">
            <li>Dados armazenados em servidores Supabase com criptografia em trânsito (TLS) e em repouso</li>
            <li>Autenticação com OAuth 2.0 (Google) ou senha com hash bcrypt</li>
            <li>Row Level Security (RLS) no banco de dados — cada usuário acessa apenas seus próprios dados</li>
            <li>Coordenadas de localização armazenadas com precisão reduzida (~1km)</li>
          </ul>
        </Section>

        <Section title="8. Seus Direitos (LGPD Art. 18)">
          <p>Você tem direito a:</p>
          <ul className="list-disc pl-5 space-y-1 mt-2">
            <li>Confirmar a existência de tratamento dos seus dados</li>
            <li>Acessar seus dados pessoais</li>
            <li>Corrigir dados incompletos, inexatos ou desatualizados</li>
            <li>Solicitar anonimização, bloqueio ou eliminação de dados desnecessários</li>
            <li>Revogar consentimento a qualquer momento</li>
            <li>Solicitar portabilidade dos dados</li>
            <li>Solicitar exclusão dos dados pessoais tratados com base no consentimento</li>
          </ul>
          <p className="mt-2">
            Para exercer qualquer direito, entre em contato: <strong>pedrovillarino@gmail.com</strong>
          </p>
        </Section>

        <Section title="9. Retenção de Dados">
          <ul className="list-disc pl-5 space-y-1">
            <li>Dados do perfil e figurinhas — mantidos enquanto a conta estiver ativa</li>
            <li>Dados de pagamento — conforme exigência fiscal (5 anos)</li>
            <li>Logs de consentimento — mantidos por prazo legal</li>
            <li>Após exclusão da conta — dados removidos em até 15 dias úteis, exceto obrigações legais</li>
          </ul>
        </Section>

        <Section title="10. Cookies e Rastreamento">
          <p>
            O Complete Aí utiliza apenas cookies essenciais para autenticação e funcionamento do app.
            Não utilizamos cookies de rastreamento ou publicidade comportamental.
          </p>
        </Section>

        <Section title="11. Alterações nesta Política">
          <p>
            Esta política pode ser atualizada. Alterações relevantes serão comunicadas por e-mail e/ou
            notificação no app com pelo menos 15 dias de antecedência.
          </p>
        </Section>

        <Section title="12. Contato">
          <p>
            Para dúvidas, solicitações ou exercício de direitos:
          </p>
          <ul className="list-disc pl-5 space-y-1 mt-2">
            <li><strong>E-mail:</strong> pedrovillarino@gmail.com</li>
            <li><strong>DPO:</strong> Pedro Villarino — pedrovillarino@gmail.com</li>
          </ul>
        </Section>

        <div className="border-t border-gray-100 pt-6 mt-8">
          <p className="text-[10px] text-gray-300 text-center italic">
            Este documento deve ser validado por advogado antes da publicação.
          </p>
          <p className="text-[10px] text-gray-300 text-center mt-2">
            Este app não é afiliado, endossado ou patrocinado pela FIFA, Panini, Topps, Fanatics ou qualquer organização oficial.
          </p>
        </div>
      </div>
    </main>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-base font-bold text-navy mb-3">{title}</h2>
      {children}
    </section>
  )
}
