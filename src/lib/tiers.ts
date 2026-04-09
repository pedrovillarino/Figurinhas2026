export type Tier = 'free' | 'plus' | 'premium'

export const TIER_CONFIG = {
  free: {
    label: 'Free',
    stickerLimit: 100,
    canScan: false,
    canTrade: false,
  },
  plus: {
    label: 'Plus',
    stickerLimit: Infinity,
    canScan: true,
    canTrade: false,
    priceBrl: 990, // R$9,90
    priceDisplay: 'R$9,90',
  },
  premium: {
    label: 'Premium',
    stickerLimit: Infinity,
    canScan: true,
    canTrade: true,
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
