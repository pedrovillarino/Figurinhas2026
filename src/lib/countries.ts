export const countryFlags: Record<string, string> = {
  'Argentina': '🇦🇷', 'Australia': '🇦🇺', 'Belgium': '🇧🇪', 'Brazil': '🇧🇷',
  'Cameroon': '🇨🇲', 'Canada': '🇨🇦', 'Chile': '🇨🇱', 'Colombia': '🇨🇴',
  'Costa Rica': '🇨🇷', 'Croatia': '🇭🇷', 'Denmark': '🇩🇰', 'Ecuador': '🇪🇨',
  'England': '🏴󠁧󠁢󠁥󠁮󠁧󠁿', 'France': '🇫🇷', 'Germany': '🇩🇪', 'Ghana': '🇬🇭',
  'Iran': '🇮🇷', 'Italy': '🇮🇹', 'Japan': '🇯🇵', 'Mexico': '🇲🇽',
  'Morocco': '🇲🇦', 'Netherlands': '🇳🇱', 'Nigeria': '🇳🇬', 'Paraguay': '🇵🇾',
  'Peru': '🇵🇪', 'Poland': '🇵🇱', 'Portugal': '🇵🇹', 'Qatar': '🇶🇦',
  'Saudi Arabia': '🇸🇦', 'Senegal': '🇸🇳', 'Serbia': '🇷🇸', 'South Korea': '🇰🇷',
  'Spain': '🇪🇸', 'Switzerland': '🇨🇭', 'Tunisia': '🇹🇳', 'Turkey': '🇹🇷',
  'USA': '🇺🇸', 'Uruguay': '🇺🇾', 'Wales': '🏴󠁧󠁢󠁷󠁬󠁳󠁿',
  'FWC': '🏆', 'Special': '⭐', 'Stadiums': '🏟️',
}

export function getFlag(country: string): string {
  return countryFlags[country] || '🏳️'
}
