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
//
// Pedro 2026-05-05 (fair-use Copa Completa): marketing fala "scans
// ilimitados", mas backend libera em lotes de 500. getQuotas chama
// release_copa_scan_batch_if_needed antes de calcular cota — se user
// está perto do limite, libera +500 automaticamente. Termos cláusula 4.9.
// Alerta admin via Z-API a partir do 3º lote (1500 scans = 1.4× álbum).

import { createClient } from '@supabase/supabase-js'
import { type Tier, getScanLimit, getAudioLimit } from '@/lib/tiers'
import { sendText } from '@/lib/zapi'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

/**
 * Fair-use auto-release pra Copa Completa. Idempotente: chama toda vez
 * que getQuotas roda. RPC verifica se vale a pena liberar (threshold) e
 * libera +500 scan_credits + log de auditoria. Retorna true se liberou.
 *
 * Side-effect: alerta admin via Z-API quando suspicious ou batches >= 3.
 */
async function maybeReleaseCopaBatch(userId: string): Promise<boolean> {
  try {
    const supabase = getAdmin()
    const { data, error } = await supabase.rpc('release_copa_scan_batch_if_needed', {
      p_user_id: userId,
    })
    if (error) {
      console.error('[copa-fair-use] RPC error:', error)
      return false
    }
    if (!data || typeof data !== 'object') return false
    const result = data as {
      released: boolean
      reason?: string
      batch_number?: number
      scans_used?: number
      stickers_count?: number
      capture_rate?: number
      suspicious?: boolean
      should_alert_admin?: boolean
    }

    // Alerta admin se foi liberado lote alto OU se foi bloqueado por suspeita
    const adminPhone = process.env.ADMIN_PHONE
    if (adminPhone && (result.should_alert_admin || result.reason === 'paused_for_review')) {
      const tag = result.released ? '🟡 Fair-use lote liberado' : '🚨 Fair-use BLOQUEADO'
      const msg =
        `${tag}\n\n` +
        `User: ${userId}\n` +
        `Lote nº: ${result.batch_number ?? '—'}\n` +
        `Scans usados: ${result.scans_used}\n` +
        `Cromos no álbum: ${result.stickers_count}\n` +
        `Capture rate: ${result.capture_rate?.toFixed(2) ?? 'n/a'}\n` +
        `Suspicious: ${result.suspicious ? 'sim' : 'não'}` +
        (result.reason === 'paused_for_review'
          ? `\n⚠️ Liberação pausada — revisar manualmente.`
          : '')
      // fire-and-forget — não bloqueia a request
      sendText(adminPhone, msg).catch((err: unknown) => {
        console.error('[copa-fair-use] admin alert send failed:', err)
      })
    }

    return !!result.released
  } catch (err) {
    console.error('[copa-fair-use] unexpected:', err)
    return false
  }
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

  // Fair-use Copa Completa: tenta liberar +500 scans antes de calcular
  // a cota. RPC é idempotente — só libera se user está perto do limite.
  // Marketing fala "ilimitado", Termos 4.9 cobrem o lote-em-lote.
  if (tier === 'copa_completa') {
    await maybeReleaseCopaBatch(userId)
  }

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
      `   • 150 scans (*5× mais*) + áudio *ILIMITADO*\n` +
      `   • 15 trocas + 🔁 1 alerta/dia de trocas perto`,
    )
  }
  if (tier !== 'copa_completa') {
    tiers.push(
      `🏆 *Copa Completa R$29,90*\n` +
      `   • Scans, áudios e *TROCAS ILIMITADOS*\n` +
      `   • ⚡ *Match em TEMPO REAL*: avisamos NA HORA que alguém perto registra figurinha que você precisa E você tem repetida pra trocar\n` +
      `   • 🏆 Badge dourado e prioridade na fila de trocas`,
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
