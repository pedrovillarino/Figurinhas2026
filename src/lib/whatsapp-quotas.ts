// ─── WhatsApp paywall quotas (Pedro 2026-05-02) ──────────────────────────
//
// Estratégia em escada quando user free atinge um limite:
//   1. Acabou scan → ainda tem áudio? Sugere áudio + upgrade
//   2. Acabou áudio → ainda tem scan? Sugere foto + upgrade
//   3. Acabou ambos → texto WhatsApp (∞) + registro manual no site + upgrade
//
// Esta lib centraliza a lógica de checagem de saldo (sem incrementar) e
// geração de mensagem de paywall consistente entre as 3 entradas (scan
// web, scan WhatsApp foto, áudio WhatsApp).

import { createClient } from '@supabase/supabase-js'
import { type Tier, getScanLimit, getAudioLimit, TIER_CONFIG } from '@/lib/tiers'

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
  scansLimit: number  // pode ser Infinity
  scansRemaining: number  // pode ser Infinity
  audiosUsed: number
  audiosLimit: number  // pode ser Infinity
  audiosRemaining: number  // pode ser Infinity
}

/**
 * Lê (sem incrementar) os contadores de scan e áudio do user.
 * Para uso em mensagens de paywall que precisam saber se a OUTRA modalidade
 * ainda tem saldo (scan acabou mas áudio tem? sugere áudio).
 */
export async function getQuotas(userId: string, tier: Tier): Promise<Quotas> {
  const supabase = getAdmin()
  const scansLimit = getScanLimit(tier)
  const audiosLimit = getAudioLimit(tier)

  // Scans usados: SUM(scan_count) na tabela scan_usage (igual increment_scan_usage faz)
  const { data: scanRows } = await supabase
    .from('scan_usage')
    .select('scan_count')
    .eq('user_id', userId)
  const scansUsed = (scanRows || []).reduce((acc, r) => acc + (r.scan_count || 0), 0)

  // Audios usados: coluna audio_uses_count em profiles
  const { data: profile } = await supabase
    .from('profiles')
    .select('audio_uses_count, scan_credits')
    .eq('id', userId)
    .maybeSingle()
  const audiosUsed = profile?.audio_uses_count || 0
  const scanCredits = profile?.scan_credits || 0

  // Effective scan limit = tier limit + credits comprados
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
 * Lista de opções de upgrade VÁLIDAS pro tier atual (não mostra Estreante
 * pra quem já é Estreante, etc). Cada item é uma linha pronta pra exibir.
 *
 * Inclui label, preço e benefícios chave.
 */
export function getUpgradeOptions(tier: Tier): string[] {
  const opts: string[] = []
  if (tier === 'free') {
    opts.push(`💚 *Estreante* — ${TIER_CONFIG.estreante.priceDisplay} (pagamento único — 30 scans + 30 áudios)`)
  }
  if (tier === 'free' || tier === 'estreante') {
    opts.push(`⭐ *Colecionador* — ${TIER_CONFIG.colecionador.priceDisplay} (pagamento único — 150 scans + áudio ilimitado)`)
  }
  if (tier !== 'copa_completa') {
    opts.push(`🏆 *Copa Completa* — ${TIER_CONFIG.copa_completa.priceDisplay} (pagamento único — 500 scans + tudo ilimitado)`)
  }
  return opts
}

/**
 * Monta a mensagem em escada quando o user atinge um limite.
 *
 * @param appUrl Base URL do site (pra link de upgrade)
 * @param hitWhich Qual modalidade acabou ('scan' = foto, 'audio' = voz)
 * @param quotas Saldos atuais
 * @returns Mensagem completa pronta pra sendText
 */
export function buildPaywallMessage(
  appUrl: string,
  hitWhich: 'scan' | 'audio',
  quotas: Quotas,
): string {
  const { tier, audiosRemaining, scansRemaining, scansLimit, audiosLimit } = quotas
  const upgradeOpts = getUpgradeOptions(tier)
  const hasUpgrade = upgradeOpts.length > 0

  const fmtRemaining = (n: number) => (n === Infinity ? 'ilimitado' : `${n} restantes`)

  // ── Cenário A: scan acabou ──
  if (hitWhich === 'scan') {
    const audioOpen = audiosRemaining > 0 || audiosRemaining === Infinity
    if (audioOpen) {
      // Acabou scan, mas tem áudio → sugere áudio
      return (
        `🚫 *Você usou seus ${scansLimit === Infinity ? '' : scansLimit} scans${tier === 'free' ? ' gratuitos' : ''}!*\n\n` +
        `Mas ainda dá pra continuar grátis aqui:\n` +
        `🎤 *Áudio* — fala os códigos (${fmtRemaining(audiosRemaining)})\n` +
        `✏️ *Texto* — _"BRA-1 ARG-3"_ (sem limite)\n\n` +
        (hasUpgrade
          ? `Ou faz upgrade pra mais scans:\n${upgradeOpts.join('\n')}\n👉 ${appUrl}/planos`
          : `📦 Compra pacote extra: ${appUrl}/profile`)
      )
    }
    // Acabou scan E áudio → texto + upgrade
    return (
      `🚫 *Você usou seus ${scansLimit === Infinity ? '' : scansLimit} scans e seus ${audiosLimit === Infinity ? '' : audiosLimit} áudios!*\n\n` +
      `Pra continuar grátis:\n` +
      `✏️ *Texto* aqui no WhatsApp — _"BRA-1 ARG-3"_ ou _"Brasil 1, Argentina 3"_ (sem limite)\n` +
      `🌐 Ou registra manual no site: ${appUrl}/album\n\n` +
      (hasUpgrade
        ? `Ou faz upgrade:\n${upgradeOpts.join('\n')}\n👉 ${appUrl}/planos`
        : `📦 Compra pacote extra: ${appUrl}/profile`)
    )
  }

  // ── Cenário B: áudio acabou ──
  const scanOpen = scansRemaining > 0 || scansRemaining === Infinity
  if (scanOpen) {
    // Acabou áudio, mas tem scan → sugere foto
    return (
      `🎤 *Você usou seus ${audiosLimit === Infinity ? '' : audiosLimit} áudios${tier === 'free' ? ' gratuitos' : ''}!*\n\n` +
      `Mas ainda dá pra continuar grátis:\n` +
      `📸 *Foto* das figurinhas (${fmtRemaining(scansRemaining)} de scan)\n` +
      `✏️ *Texto* — _"BRA-1 ARG-3"_ (sem limite)\n\n` +
      (hasUpgrade
        ? `Ou faz upgrade pra áudio ilimitado:\n${upgradeOpts.join('\n')}\n👉 ${appUrl}/planos`
        : '')
    )
  }
  // Acabou áudio E scan → texto + upgrade
  return (
    `🎤 *Você usou seus ${audiosLimit === Infinity ? '' : audiosLimit} áudios e seus ${scansLimit === Infinity ? '' : scansLimit} scans!*\n\n` +
    `Pra continuar grátis:\n` +
    `✏️ *Texto* aqui no WhatsApp — _"BRA-1 ARG-3"_ ou _"Brasil 1, Argentina 3"_ (sem limite)\n` +
    `🌐 Ou registra manual no site: ${appUrl}/album\n\n` +
    (hasUpgrade
      ? `Ou faz upgrade:\n${upgradeOpts.join('\n')}\n👉 ${appUrl}/planos`
      : `📦 Compra pacote extra: ${appUrl}/profile`)
  )
}
