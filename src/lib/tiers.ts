export type Tier = 'free' | 'estreante' | 'colecionador' | 'copa_completa'

// ─── Scan pack pricing (Pedro 2026-05-03 — revisão) ─────────────────
// Filosofia: pacote = "compra de emergência". Cada um vale ~1× tier
// limit (sente dopamina), mas upgrade rende mais por R$. Preços
// diminuem por unidade conforme tier sobe (Colec ganha 50% off).
export const SCAN_PACK_AMOUNTS: Record<string, number> = {
  free: 5,         // = scanLimit free (dobra o que tem)
  estreante: 30,   // = scanLimit estreante
  colecionador: 50,
}
export const SCAN_PACK_AMOUNT = 30 // default for paid tiers

export const SCAN_PACK_CONFIG: Partial<Record<Tier, { priceBrl: number; priceDisplay: string }>> = {
  free: { priceBrl: 299, priceDisplay: 'R$2,99' },
  estreante: { priceBrl: 500, priceDisplay: 'R$5,00' },
  colecionador: { priceBrl: 500, priceDisplay: 'R$5,00' },
}

// ─── Trade pack pricing (Pedro 2026-05-03 — revisão) ───────────────
// Trocas têm valor humano (interação real) — preço mais alto/un.
export const TRADE_PACK_AMOUNTS: Record<string, number> = {
  free: 2,
  estreante: 5,
  colecionador: 10,
}
export const TRADE_PACK_AMOUNT = 5 // default fallback

export const TRADE_PACK_CONFIG: Partial<Record<Tier, { priceBrl: number; priceDisplay: string }>> = {
  free: { priceBrl: 299, priceDisplay: 'R$2,99' },
  estreante: { priceBrl: 500, priceDisplay: 'R$5,00' },
  colecionador: { priceBrl: 500, priceDisplay: 'R$5,00' },
}

// ─── Audio pack pricing (Pedro 2026-05-03 — revisão) ───────────────
// Mais barato que scan (Gemini áudio < Gemini visão).
// Free +7 / Estreante +15 (½ tier limit, suficiente "emergência").
// Colec/Copa já ilimitado, sem pacote.
export const AUDIO_PACK_AMOUNTS: Record<string, number> = {
  free: 7,
  estreante: 15,
}
export const AUDIO_PACK_AMOUNT = 15 // default fallback

export const AUDIO_PACK_CONFIG: Partial<Record<Tier, { priceBrl: number; priceDisplay: string }>> = {
  free: { priceBrl: 199, priceDisplay: 'R$1,99' },
  estreante: { priceBrl: 300, priceDisplay: 'R$3,00' },
}

// ─── Tier definitions ───
// audioLimit: lifetime, áudios via WhatsApp (transcrição via Gemini).
// Pedro 2026-05-03: free=7, estreante=30, colecionador+copa=ilimitado.
// Pedro 2026-05-03: estreante scanLimit 50→30 (mais pressão pra Colec).
// Foto WhatsApp = scan (usa scanLimit). Texto WhatsApp = sem limite.
export const TIER_CONFIG = {
  free: {
    label: 'Free',
    scanLimit: 5, // ~40 figurinhas
    audioLimit: 7,
    canScan: true,
    canTrade: true, // can view matches + 2 included trades
    tradeLimit: 2,
    hasAds: true,
    canBuyScanPack: true,
    canBuyTradePack: true,
    stickerLimit: Infinity,
  },
  estreante: {
    label: 'Estreante',
    scanLimit: 30, // ~240 figurinhas
    audioLimit: 30,
    canScan: true,
    canTrade: true,
    tradeLimit: 5,
    hasAds: false,
    canBuyScanPack: true,
    canBuyTradePack: true,
    stickerLimit: Infinity,
    priceBrl: 990,
    priceDisplay: 'R$9,90',
  },
  colecionador: {
    label: 'Colecionador',
    scanLimit: 150, // ~1.200 figurinhas
    audioLimit: Infinity,
    canScan: true,
    canTrade: true,
    tradeLimit: 15,
    hasAds: false,
    canBuyScanPack: true,
    canBuyTradePack: true,
    stickerLimit: Infinity,
    priceBrl: 1990,
    priceDisplay: 'R$19,90',
  },
  copa_completa: {
    label: 'Copa Completa',
    scanLimit: 500, // ~4.000 figurinhas
    audioLimit: Infinity,
    canScan: true,
    canTrade: true,
    tradeLimit: Infinity,
    hasAds: false,
    canBuyScanPack: false,
    canBuyTradePack: false,
    stickerLimit: Infinity,
    priceBrl: 2990,
    priceDisplay: 'R$29,90',
  },
} as const

export function canScan(tier: Tier): boolean {
  return TIER_CONFIG[tier].canScan
}

export function canTrade(tier: Tier): boolean {
  return TIER_CONFIG[tier].canTrade
}

export function getStickerLimit(tier: Tier): number {
  return TIER_CONFIG[tier].stickerLimit
}

export function getScanLimit(tier: Tier): number {
  return TIER_CONFIG[tier].scanLimit
}

export function getAudioLimit(tier: Tier): number {
  return TIER_CONFIG[tier].audioLimit
}

export function getTradeLimit(tier: Tier): number {
  return TIER_CONFIG[tier].tradeLimit
}

export function hasAds(tier: Tier): boolean {
  return TIER_CONFIG[tier].hasAds
}

export function isPaid(tier: Tier): boolean {
  return tier !== 'free'
}

/** Order of tiers for upgrade logic */
export const TIER_ORDER: Tier[] = ['free', 'estreante', 'colecionador', 'copa_completa']

export function tierIndex(tier: Tier): number {
  return TIER_ORDER.indexOf(tier)
}
