// ─── WhatsApp paywall quotas ────────────────────────────────────────────
//
// Pedro 2026-05-02: estratégia em escada quando user free atinge um limite:
//   1. Acabou scan → ainda tem áudio? Sugere áudio + upgrade
//   2. Acabou áudio → ainda tem scan? Sugere foto + upgrade
//   3. Acabou ambos → texto WhatsApp (∞) + registro manual no site + upgrade
//
// Pedro 2026-05-05: copy reescrita pra ser mais sensibilizadora — conta
// história do app (pai ajudando filhos sem falir), enfatiza trocas como
// coração do produto, e fixa URL pra /upgrade (era /planos = 404).

import { createClient } from '@supabase/supabase-js'
import { type Tier, getScanLimit, getAudioLimit } from '@/lib/tiers'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

export type Quotas = {
  tier: Tier
  scansUsed: number
  scansLimit: number
  scansRemaining: number
  audiosUsed: number
  audiosLimit: number
  audiosRemaining: number
}

export async function getQuotas(userId: string, tier: Tier): Promise<Quotas> {
  const supabase = getAdmin()
  const scansLimit = getScanLimit(tier)
  const audiosLimit = getAudioLimit(tier)

  const { data: scanRows } = await supabase
    .from('scan_usage')
    .select('scan_count')
    .eq('user_id', userId)
  const scansUsed = (scanRows || []).reduce((acc, r) => acc + (r.scan_count || 0), 0)

  const { data: profile } = await supabase
    .from('profiles')
    .select('audio_uses_count, scan_credits')
    .eq('id', userId)
    .maybeSingle()
  const audiosUsed = profile?.audio_uses_count || 0
  const scanCredits = profile?.scan_credits || 0

  const effectiveScansLimit = scansLimit === Infinity ? Infinity : scansLimit + scanCredits

  return {
    tier,
    scansUsed,
    scansLimit: effectiveScansLimit,
    scansRemaining: effectiveScansLimit === Infinity ? Infinity : Math.max(0, effectiveScansLimit - scansUsed),
    audiosUsed,
    audiosLimit,
    audiosRemaining: audiosLimit === Infinity ? Infinity : Math.max(0, audiosLimit - audiosUsed),
  }
}

/**
 * Footer unificado de apoio — Pedro 2026-05-05. Usado em todos os cenários
 * de paywall (scan acabou, áudio acabou, ambos acabaram). Só os tiers
 * disponíveis pro user atual aparecem.
 */
export function buildSupporterFooter(tier: Tier, appUrl: string): string {
  const tiers: string[] = []
  if (tier === 'free') {
    tiers.push(
      `🌱 *Estreante R$9,90*\n` +
      `   • 30 scans + 30 áudios\n` +
      `   • 5 trocas`,
    )
  }
  if (tier === 'free' || tier === 'estreante') {
    tiers.push(
      `💎 *Colecionador R$19,90* (mais escolhido)\n` +
      `   • 150 scans + áudio ilimitado\n` +
      `   • 15 trocas + 🔁 alertas de troca`,
    )
  }
  if (tier !== 'copa_completa') {
    tiers.push(
      `🏆 *Copa Completa R$29,90*\n` +
      `   • Tudo ilimitado: scans, áudios, *TROCAS*\n` +
      `   • Match em *TEMPO REAL*: avisamos quando alguém perto registra figurinha que você precisa E você tem repetida pra trocar`,
    )
  }

  if (tiers.length === 0) {
    // user já é copa_completa — não mostra footer de upgrade
    return ''
  }

  return (
    `\n────\n` +
    `💛 *Por que apoiar o Complete Aí?*\n\n` +
    `Somos um app pequeno que surgiu da dor de um pai ajudar os filhos a completarem o álbum sem falir 🤣 — então sabemos como dói não fechar as últimas figurinhas.\n\n` +
    `Trocas perto de você é o coração do app. Quem apoia tem muito mais alcance:\n\n` +
    `🟢 *Todos os planos são pagamento único — sem mensalidade.*\n\n` +
    tiers.join('\n\n') +
    `\n\nCada apoiador ajuda a manter o app evoluindo. ⚽\n` +
    `👉 ${appUrl}/upgrade`
  )
}

export function buildPaywallMessage(
  appUrl: string,
  hitWhich: 'scan' | 'audio',
  quotas: Quotas,
): string {
  const { tier, audiosRemaining, scansRemaining, scansLimit, audiosLimit } = quotas
  const fmtRemaining = (n: number) => (n === Infinity ? 'ilimitado' : `${n} restantes`)
  const footer = buildSupporterFooter(tier, appUrl)

  // ── Cenário A: scan acabou ──
  if (hitWhich === 'scan') {
    const audioOpen = audiosRemaining > 0 || audiosRemaining === Infinity
    if (audioOpen) {
      return (
        `🚫 *Você usou seus ${scansLimit === Infinity ? '' : scansLimit} scans${tier === 'free' ? ' gratuitos' : ''}!*\n\n` +
        `Continua sem custo:\n` +
        `🎤 *Áudio* — fala os códigos (${fmtRemaining(audiosRemaining)})\n` +
        `✏️ *Texto* — _"BRA-1 ARG-3"_ (sem limite)\n` +
        `🌐 *Site* — completeai.com.br` +
        footer
      )
    }
    // Acabou scan E áudio
    return (
      `🚫 *Você usou seus ${scansLimit === Infinity ? '' : scansLimit} scans e seus ${audiosLimit === Infinity ? '' : audiosLimit} áudios!*\n\n` +
      `Continua sem custo:\n` +
      `✏️ *Texto* aqui no WhatsApp — _"BRA-1 ARG-3"_ ou _"Brasil 1, Argentina 3"_ (sem limite)\n` +
      `🌐 *Site* — registra manual em ${appUrl}/album` +
      footer
    )
  }

  // ── Cenário B: áudio acabou ──
  const scanOpen = scansRemaining > 0 || scansRemaining === Infinity
  if (scanOpen) {
    return (
      `🎤 *Você usou seus ${audiosLimit === Infinity ? '' : audiosLimit} áudios${tier === 'free' ? ' gratuitos' : ''}!*\n\n` +
      `Continua sem custo:\n` +
      `📸 *Foto* das figurinhas (${fmtRemaining(scansRemaining)} de scan) — IA identifica\n` +
      `✏️ *Texto* — _"BRA-1 ARG-3"_ (sem limite)\n` +
      `🌐 *Site* — completeai.com.br` +
      footer
    )
  }
  // Acabou áudio E scan
  return (
    `🎤 *Você usou seus ${audiosLimit === Infinity ? '' : audiosLimit} áudios e seus ${scansLimit === Infinity ? '' : scansLimit} scans!*\n\n` +
    `Continua sem custo:\n` +
    `✏️ *Texto* aqui no WhatsApp — _"BRA-1 ARG-3"_ ou _"Brasil 1, Argentina 3"_ (sem limite)\n` +
    `🌐 *Site* — registra manual em ${appUrl}/album` +
    footer
  )
}
