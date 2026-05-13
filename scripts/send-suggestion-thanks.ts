/**
 * Emails de agradecimento pra users que mandaram sugestões/feedback via
 * /api/suggestion. One-off — Pedro 2026-05-13.
 *
 * MODO PADRÃO = DRY-RUN. Mostra os emails no terminal.
 *   npx ts-node --compiler-options '{"module":"commonjs","esModuleInterop":true}' scripts/send-suggestion-thanks.ts
 *
 * PRA ENVIAR: --send
 */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import path from 'path'

config({ path: path.join(__dirname, '..', '.env.local') })

import { sendEmail } from '../src/lib/email'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.completeai.com.br'
const REPLY_TO = 'contato@completeai.com.br'

type Recipient = {
  email: string
  firstName: string  // pra greeting
  subject: string
  bodyHtml: string   // conteúdo do corpo (entre header e footer)
}

// Wrapper compartilhado pra evitar duplicar header/footer.
function buildHtml(firstName: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #0A1628;">
  <div style="max-width: 560px; margin: 0 auto; padding: 24px 16px;">
    <p style="font-size: 11px; font-weight: 700; letter-spacing: 1px; color: #6B7280; text-transform: uppercase; margin: 0 0 10px;">Complete Aí · Sugestão recebida</p>
    <h1 style="font-size: 22px; font-weight: 900; color: #0A1628; margin: 0 0 18px;">Oi, ${firstName} 👋</h1>
    ${bodyHtml}
    <div style="text-align: center; padding-top: 16px; border-top: 1px solid #E5E7EB; margin-top: 24px;">
      <p style="font-size: 12px; color: #6B7280; margin: 0 0 4px;">Equipe Complete Aí ⚽</p>
      <p style="font-size: 11px; color: #D1D5DB; margin: 0;">${APP_URL}</p>
    </div>
  </div>
</body>
</html>`
}

const RECIPIENTS: Recipient[] = [
  {
    email: 'isadorahoelscher@gmail.com',
    firstName: 'Isadora',
    subject: 'Sua sugestão foi resolvida — bairro + nova opção de foto',
    bodyHtml: `
      <p style="font-size: 15px; color: #374151; line-height: 1.6; margin: 0 0 14px;">
        Recebemos sua sugestão sobre não conseguir adicionar o bairro no perfil e a opção de remover a foto. Olhamos com cuidado os dois pontos e:
      </p>

      <div style="background: #ECFDF5; border-left: 4px solid #10B981; border-radius: 8px; padding: 14px 18px; margin: 0 0 14px;">
        <p style="font-size: 13px; font-weight: 700; color: #065F46; margin: 0 0 6px;">✅ Bug do bairro: corrigido</p>
        <p style="font-size: 13px; color: #047857; line-height: 1.5; margin: 0;">
          Era um problema real do nosso lado — o app recebia o bairro mas não estava salvando direito. Agora persiste e volta a aparecer no próximo carregamento.
        </p>
      </div>

      <div style="background: #ECFDF5; border-left: 4px solid #10B981; border-radius: 8px; padding: 14px 18px; margin: 0 0 14px;">
        <p style="font-size: 13px; font-weight: 700; color: #065F46; margin: 0 0 6px;">✅ Foto de perfil: agora dá pra trocar e remover</p>
        <p style="font-size: 13px; color: #047857; line-height: 1.5; margin: 0;">
          Na página do perfil, ao lado da sua foto, aparecem dois botões: <strong>Mudar foto</strong> (escolhe uma nova imagem do celular) e <strong>Remover</strong> (volta pra inicial). Suporta JPG, PNG e WebP.
        </p>
      </div>

      <p style="font-size: 14px; color: #374151; line-height: 1.6; margin: 0 0 14px;">
        As duas mudanças já estão no ar — basta atualizar a página do perfil pra ver. Se ainda assim você notar algo estranho, é só responder aqui mesmo — sua mensagem cai em <strong>${REPLY_TO}</strong>.
      </p>

      <p style="font-size: 14px; color: #374151; line-height: 1.6; margin: 0;">
        Valeu por ter avisado. Feedback assim deixa o app melhor pra todo mundo.
      </p>
    `,
  },
  {
    email: 'petroniobenevides@gmail.com',
    firstName: 'Petronio',
    subject: 'Recebemos sua ideia sobre a tabela da Copa',
    bodyHtml: `
      <p style="font-size: 15px; color: #374151; line-height: 1.6; margin: 0 0 14px;">
        Recebemos sua sugestão de trazer a tabela da Copa pra dentro do app — datas, horários, locais e resultados das partidas no mesmo lugar das figurinhas.
      </p>

      <p style="font-size: 14px; color: #374151; line-height: 1.6; margin: 0 0 14px;">
        Anotamos a ideia no nosso backlog. Faz total sentido — quem está colecionando o álbum naturalmente quer acompanhar os jogos. Não conseguimos prometer prazo agora porque o foco até a abertura da Copa está nos pilares atuais (scan, trocas e a nova Liga que estreia nessa sexta), mas é uma adição que dá pra encaixar no caminho.
      </p>

      <p style="font-size: 14px; color: #374151; line-height: 1.6; margin: 0;">
        Obrigado pelo cuidado em mandar a sugestão por escrito. É o tipo de input que faz diferença pra prioridade do que vem a seguir.
      </p>
    `,
  },
]

async function main() {
  const send = process.argv.includes('--send')
  const writeFiles = process.argv.includes('--write-html')
  const fs = await import('fs')
  const pathMod = await import('path')

  if (send && !process.env.RESEND_API_KEY) {
    console.error('❌ --send requer RESEND_API_KEY no .env.local')
    process.exit(1)
  }

  console.log(`\n${'='.repeat(70)}`)
  console.log(send ? '📤 MODO ENVIO REAL' : '👀 MODO DRY-RUN (passe --send pra enviar de verdade)')
  console.log('='.repeat(70))

  for (const r of RECIPIENTS) {
    const html = buildHtml(r.firstName, r.bodyHtml)
    console.log(`\n${'-'.repeat(70)}`)
    console.log(`📧 ${r.firstName} <${r.email}>`)
    console.log(`Subject: ${r.subject}`)
    console.log(`HTML bytes: ${html.length}`)
    console.log('-'.repeat(70))

    if (writeFiles) {
      const outDir = pathMod.join(__dirname, '..', 'public', '_preview')
      fs.mkdirSync(outDir, { recursive: true })
      const slug = r.firstName.toLowerCase()
      const outPath = pathMod.join(outDir, `thanks-${slug}.html`)
      fs.writeFileSync(outPath, html)
      console.log(`✓ HTML escrito em /public/_preview/thanks-${slug}.html`)
    }

    if (!send) {
      if (!writeFiles) console.log('(dry-run — sem envio)')
      continue
    }

    const ok = await sendEmail(r.email, r.subject, html, { replyTo: REPLY_TO })
    if (ok) console.log(`✅ Enviado pra ${r.email} (reply-to: ${REPLY_TO})`)
    else console.error(`❌ Falha ao enviar pra ${r.email}`)
  }

  console.log(`\n${'='.repeat(70)}`)
  console.log(send ? '✅ Envio finalizado.' : '👀 Dry-run completo.')
  console.log('='.repeat(70))
  console.log()
}

main().catch((err) => {
  console.error('❌ erro fatal:', err)
  process.exit(1)
})
