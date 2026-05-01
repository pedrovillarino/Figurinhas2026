export const countryFlags: Record<string, string> = {
  // Teams (2026 World Cup — 48 teams)
  'Algeria': '🇩🇿', 'Argentina': '🇦🇷', 'Australia': '🇦🇺', 'Austria': '🇦🇹',
  'Belgium': '🇧🇪', 'Bosnia and Herzegovina': '🇧🇦', 'Brazil': '🇧🇷',
  'Canada': '🇨🇦', 'Cabo Verde': '🇨🇻', 'Colombia': '🇨🇴', 'Croatia': '🇭🇷',
  'Curaçao': '🇨🇼', 'Czechia': '🇨🇿', 'DR Congo': '🇨🇩',
  'Ecuador': '🇪🇨', 'Egypt': '🇪🇬', 'England': '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
  'France': '🇫🇷', 'Germany': '🇩🇪', 'Ghana': '🇬🇭',
  'Haiti': '🇭🇹', 'Iran': '🇮🇷', 'Iraq': '🇮🇶', "Côte d'Ivoire": '🇨🇮',
  'Japan': '🇯🇵', 'Jordan': '🇯🇴',
  'Mexico': '🇲🇽', 'Morocco': '🇲🇦',
  'Netherlands': '🇳🇱', 'New Zealand': '🇳🇿', 'Norway': '🇳🇴',
  'Panama': '🇵🇦', 'Paraguay': '🇵🇾', 'Portugal': '🇵🇹',
  'Qatar': '🇶🇦',
  'Saudi Arabia': '🇸🇦', 'Scotland': '🏴󠁧󠁢󠁳󠁣󠁴󠁿', 'Senegal': '🇸🇳',
  'South Africa': '🇿🇦', 'Korea Republic': '🇰🇷', 'Spain': '🇪🇸',
  'Sweden': '🇸🇪', 'Switzerland': '🇨🇭',
  'Tunisia': '🇹🇳', 'Turkey': '🇹🇷',
  'Uruguay': '🇺🇾', 'USA': '🇺🇸', 'Uzbekistan': '🇺🇿',

  // Special sections
  'Introduction': '📖',
  'FIFA World Cup': '🏆',
  'Coca-Cola': '🥤',         // TODO: substituir por SVG do logo da Coca-Cola
  'PANINI Extras': '⭐',
  'FIFA': '⚽',
}

export function getFlag(section: string): string {
  return countryFlags[section] || '🏳️'
}
