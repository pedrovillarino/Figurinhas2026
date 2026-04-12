export type Tier = 'free' | 'plus' | 'premium'

// Scan pack pricing
export const SCAN_PACK_PRICE_BRL = 490 // R$4,90
export const SCAN_PACK_AMOUNT = 100
export const SCAN_PACK_PRICE_DISPLAY = 'R$4,90'

export const TIER_CONFIG = {
  free: {
    label: 'Free',
    stickerLimit: Infinity,
    canScan: true,
    canTrade: false,
    scanLimit: 5, // demo: ~35 figurinhas
  },
  plus: {
    label: 'Plus',
    stickerLimit: Infinity,
    canScan: true,
    canTrade: false,
    scanLimit: 200, // ~1.400 figurinhas (1 álbum + folga)
    priceBrl: 990, // R$9,90
    priceDisplay: 'R$9,90',
  },
  premium: {
    label: 'Premium',
    stickerLimit: Infinity,
    canScan: true,
    canTrade: true,
    scanLimit: 400, // dobro do plus
    priceBrl: 1990, // R$19,90
    priceDisplay: 'R$19,90',
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
