export type Tier = 'free' | 'estreante' | 'colecionador' | 'copa_completa'

// ─── Scan pack pricing (for estreante & colecionador only) ───
export const SCAN_PACK_AMOUNTS: Record<string, number> = {
  free: 10,
  estreante: 100,
  colecionador: 100,
}
export const SCAN_PACK_AMOUNT = 100 // default for paid tiers

export const SCAN_PACK_CONFIG: Partial<Record<Tier, { priceBrl: number; priceDisplay: string }>> = {
  free: { priceBrl: 299, priceDisplay: 'R$2,99' },
  estreante: { priceBrl: 1000, priceDisplay: 'R$10,00' },
  colecionador: { priceBrl: 500, priceDisplay: 'R$5,00' },
}

// ─── Trade pack pricing (for estreante & colecionador only) ───
export const TRADE_PACK_AMOUNTS: Record<string, number> = {
  free: 2,
  estreante: 10,
  colecionador: 10,
}
export const TRADE_PACK_AMOUNT = 10 // default for paid tiers

export const TRADE_PACK_CONFIG: Partial<Record<Tier, { priceBrl: number; priceDisplay: string }>> = {
  free: { priceBrl: 299, priceDisplay: 'R$2,99' },
  estreante: { priceBrl: 1000, priceDisplay: 'R$10,00' },
  colecionador: { priceBrl: 500, priceDisplay: 'R$5,00' },
}

// ─── Tier definitions ───
export const TIER_CONFIG = {
  free: {
    label: 'Free',
    scanLimit: 5, // ~40 figurinhas
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
    scanLimit: 50, // ~400 figurinhas
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
