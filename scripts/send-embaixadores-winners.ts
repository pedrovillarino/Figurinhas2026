/**
 * Envia emails personalizados pros 3 vencedores da campanha Embaixadores
 * (Lançamento 29/04 → 12/05/2026). Cada email anuncia posição, confirma
 * prêmio físico e convida pra Liga Complete Aí (estreia 15/05).
 *
 * MODO PADRÃO = DRY-RUN. Mostra os 3 emails no terminal sem enviar.
 *   npx ts-node scripts/send-embaixadores-winners.ts
 *
 * PRA ENVIAR DE VERDADE: passa --send
 *   npx ts-node scripts/send-embaixadores-winners.ts --send
 *
 * O script puxa nome+email atual do DB (em vez de hard-coded) — se algum
 * vencedor atualizou o cadastro entre o fim da campanha e o envio, pega
 * o estado mais recente.
 */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import path from 'path'

config({ path: path.join(__dirname, '..', '.env.local') })

import { sendEmail } from '../src/lib/email'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.completeai.com.br'
const REPLY_TO = 'contato@completeai.com.br'

type Winner = {
  user_id: string
  position: 1 | 2 | 3
  prize: string
  prizeTotalFigs: number
  highlight: string  // texto personalizado sobre como pontuou
}

// Top 3 conforme ranking final (snapshot 13/05/2026):
//   1º Bruno Soares — 10 pts (1 confirm + 1 paid upgrade + self_upgrade)
//   2º antonio neto — 8 pts (8 cadastros via link — a maior tração da campanha)
//   3º Nayara Clivati — 6 pts (1 confirm + self_upgrade)
const WINNERS: Winner[] = [
  {
    user_id: 'f892f473-708d-4403-9b2f-4015771efe02',
    position: 1,
    prize: 'Porta-figurinha + 10 pacotes Panini + 5 trocas extras',
    prizeTotalFigs: 70,
    highlight:
      'Liderar o ranking combinando indicação, upgrade do plano e uso contínuo do app não é trivial — ' +
      'foi o reconhecimento mais completo entre os participantes.',
  },
  {
    user_id: '2a0f20cb-afaf-4230-ad3b-69ec89dba537',
    position: 2,
    prize: 'Porta-figurinha + 8 pacotes Panini + 5 trocas extras',
    prizeTotalFigs: 56,
    highlight:
      'Você fechou a campanha com 8 cadastros pelo seu link, o maior número entre todos os embaixadores no período.',
  },
  {
    user_id: '5f4dac86-73b3-4f68-8483-41c4a67f833f',
    position: 3,
    prize: '5 pacotes Panini + 5 trocas extras',
    prizeTotalFigs: 35,
    highlight:
      'Combinar indicação com assinar um plano pago durante a campanha é um perfil raro e que sustenta a operação no dia a dia.',
  },
]

const MEDAL: Record<1 | 2 | 3, string> = { 1: '🥇', 2: '🥈', 3: '🥉' }
const POSITION_LABEL: Record<1 | 2 | 3, string> = { 1: '1º lugar', 2: '2º lugar', 3: '3º lugar' }

function firstName(displayName: string | null | undefined): string {
  if (!displayName) return 'Embaixador'
  const trimmed = displayName.trim()
  if (!trimmed) return 'Embaixador'
  const first = trimmed.split(/\s+/)[0]
  // Capitaliza primeira letra (preserva resto — ex.: "MC")
  return first.charAt(0).toUpperCase() + first.slice(1)
}

function buildEmailHtml(winner: Winner, displayName: string): string {
  const fname = firstName(displayName)
  const medal = MEDAL[winner.position]
  const positionLabel = POSITION_LABEL[winner.position]
  const isFirst = winner.position === 1

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Você é Top 3 da Campanha Embaixadores 🏆</title>
</head>
<body style="margin: 0; padding: 0; background: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #0A1628;">
  <div style="max-width: 560px; margin: 0 auto; padding: 24px 16px;">

    <!-- Header com medalha -->
    <div style="background: ${isFirst ? 'linear-gradient(135deg, #FEF3C7 0%, #FEF9E7 100%)' : '#FFFFFF'}; border: 2px solid ${isFirst ? '#F59E0B' : '#E5E7EB'}; border-radius: 16px; padding: 28px 24px; text-align: center; margin-bottom: 20px;">
      <div style="font-size: 56px; line-height: 1; margin-bottom: 8px;">${medal}</div>
      <p style="font-size: 11px; font-weight: 700; letter-spacing: 1px; color: #6B7280; text-transform: uppercase; margin: 0 0 6px;">Resultado final · Campanha Embaixadores</p>
      <h1 style="font-size: 22px; font-weight: 900; color: #0A1628; margin: 0 0 6px;">${fname}, você ficou em ${positionLabel}.</h1>
      <p style="font-size: 14px; color: #374151; margin: 0;">${winner.prizeTotalFigs} figurinhas${winner.position === 3 ? '' : ' + porta-figurinha'} a caminho pelos Correios.</p>
    </div>

    <!-- Personalização + agradecimento -->
    <div style="background: #FFFFFF; border: 1px solid #E5E7EB; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
      <p style="font-size: 14px; color: #374151; line-height: 1.6; margin: 0 0 14px;">
        ${winner.highlight}
      </p>
      <p style="font-size: 14px; color: #374151; line-height: 1.6; margin: 0;">
        Comunidade maior significa mais figurinhas circulando entre colecionadores —
        e cada participante completa o álbum mais rápido. Obrigado por contribuir com isso.
      </p>
    </div>

    <!-- Prêmio + pedido de endereço -->
    <div style="background: ${isFirst ? '#FFFBEB' : '#F9FAFB'}; border-left: 4px solid ${isFirst ? '#F59E0B' : '#9CA3AF'}; border-radius: 8px; padding: 16px 18px; margin-bottom: 20px;">
      <p style="font-size: 11px; font-weight: 700; letter-spacing: 0.5px; color: #6B7280; text-transform: uppercase; margin: 0 0 6px;">🎁 Seu prêmio</p>
      <p style="font-size: 15px; font-weight: 700; color: #0A1628; margin: 0 0 14px;">${winner.prize}</p>

      <p style="font-size: 13px; font-weight: 700; color: #0A1628; margin: 0 0 8px;">Para envio pelos Correios, responda este email com:</p>
      <ul style="font-size: 13px; color: #374151; line-height: 1.7; margin: 0 0 10px; padding-left: 18px;">
        <li>Nome completo (para a etiqueta)</li>
        <li>CEP</li>
        <li>Endereço (rua, número, complemento)</li>
        <li>Bairro, cidade e UF</li>
        <li>Telefone de contato</li>
      </ul>
      <p style="font-size: 12px; color: #6B7280; margin: 0;">
        Basta responder a esta mensagem — sua resposta chega em <strong>contato@completeai.com.br</strong>.
        Postagem feita assim que recebermos os dados.
      </p>
    </div>

    <!-- Teaser Liga (sem CTA — Liga ainda sem URL pública estável) -->
    <div style="background: linear-gradient(135deg, #ECFDF5 0%, #FFFFFF 50%, #FEF3C7 100%); border: 2px solid #00C896; border-radius: 16px; padding: 22px; margin-bottom: 24px;">
      <span style="display: inline-block; background: #00C896; color: white; font-size: 10px; font-weight: 700; padding: 4px 10px; border-radius: 999px; letter-spacing: 0.5px; text-transform: uppercase; margin-bottom: 10px;">Próxima fase · 15/05</span>
      <h2 style="font-size: 18px; font-weight: 900; color: #0A1628; margin: 0 0 10px;">Liga Complete Aí — estreia nesta sexta</h2>
      <p style="font-size: 14px; color: #374151; line-height: 1.6; margin: 0 0 12px;">
        A Liga roda por <strong>Temporadas de 15 dias</strong>. O Top 3 de cada Temporada
        recebe prêmio físico. Ao final da Copa (16/07), o <strong>Campeão Geral</strong>
        leva uma mini bola Trionda oficial e protetor de álbum.
      </p>
      <p style="font-size: 13px; color: #6B7280; line-height: 1.5; margin: 0;">
        Pontuação por XP a cada ação no app: scan, troca, registro por áudio, login diário.
        Mais detalhes vão ser anunciados na sexta-feira (15/05) pelos canais oficiais.
      </p>
    </div>

    <!-- Footer -->
    <div style="text-align: center; padding-top: 8px;">
      <p style="font-size: 12px; color: #6B7280; margin: 0 0 4px;">Equipe Complete Aí ⚽</p>
      <p style="font-size: 11px; color: #D1D5DB; margin: 0;">${APP_URL}</p>
    </div>

  </div>
</body>
</html>`
}

function buildSubject(winner: Winner, fname: string): string {
  const medal = MEDAL[winner.position]
  return `${medal} ${fname}, você ficou em ${POSITION_LABEL[winner.position]} na Campanha Embaixadores`
}

async function main() {
  const send = process.argv.includes('--send')
  const writeFiles = process.argv.includes('--write-html')
  const fs = await import('fs')
  const pathMod = await import('path')

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Faltam vars do Supabase no .env.local')
    process.exit(1)
  }
  if (send && !process.env.RESEND_API_KEY) {
    console.error('❌ --send requer RESEND_API_KEY no .env.local')
    process.exit(1)
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  console.log(`\n${'='.repeat(70)}`)
  console.log(send ? '📤 MODO ENVIO REAL' : '👀 MODO DRY-RUN (passe --send pra enviar de verdade)')
  console.log('='.repeat(70))

  for (const winner of WINNERS) {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('display_name, email')
      .eq('id', winner.user_id)
      .single()

    if (error || !profile) {
      console.error(`❌ ${winner.position}º: profile não encontrado (${winner.user_id})`, error?.message)
      continue
    }

    const displayName = (profile as { display_name: string | null; email: string }).display_name || 'Embaixador'
    const email = (profile as { display_name: string | null; email: string }).email

    if (!email) {
      console.error(`❌ ${winner.position}º ${displayName}: profile sem email`)
      continue
    }

    const fname = firstName(displayName)
    const subject = buildSubject(winner, fname)
    const html = buildEmailHtml(winner, displayName)

    console.log(`\n${'-'.repeat(70)}`)
    console.log(`${MEDAL[winner.position]} ${winner.position}º · ${displayName} <${email}>`)
    console.log(`Subject: ${subject}`)
    console.log(`HTML bytes: ${html.length}`)
    console.log('-'.repeat(70))

    if (writeFiles) {
      const outDir = pathMod.join(__dirname, '..', 'public', '_preview')
      fs.mkdirSync(outDir, { recursive: true })
      const outPath = pathMod.join(outDir, `email-${winner.position}.html`)
      fs.writeFileSync(outPath, html)
      console.log(`✓ HTML escrito em /public/_preview/email-${winner.position}.html`)
    }

    if (!send) {
      if (!writeFiles) {
        console.log('\n--- HTML PREVIEW (primeiros 800 chars) ---')
        console.log(html.slice(0, 800))
        console.log('... [truncated]')
      }
      continue
    }

    const ok = await sendEmail(email, subject, html, { replyTo: REPLY_TO })
    if (ok) {
      console.log(`✅ Enviado pra ${email} (reply-to: ${REPLY_TO})`)
    } else {
      console.error(`❌ Falha ao enviar pra ${email}`)
    }
  }

  console.log(`\n${'='.repeat(70)}`)
  console.log(send ? '✅ Envio finalizado.' : '👀 Dry-run completo. Pra enviar: --send')
  console.log('='.repeat(70))
  console.log()
}

main().catch((err) => {
  console.error('❌ erro fatal:', err)
  process.exit(1)
})
