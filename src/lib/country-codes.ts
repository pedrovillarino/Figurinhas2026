// Mapping for free-text country mentions → FIFA 3-letter codes used as
// the prefix of sticker numbers (BRA-1, ARG-3, etc.). Goal: make the
// WhatsApp register flow tolerant to natural language. The user can
// type "brasil 1, argentina 3" or "cabo verde 5, costa do marfim 7" and
// the bot expands to the canonical "BRA-1 ARG-3 CPV-5 CIV-7" before
// applying the regex parser.
//
// Includes:
//   - All 48 World Cup 2026 teams in PT-BR + EN (and a few PT-PT/ES variants)
//   - FIFA codes (3-letter)
//   - Special sections (Coca-Cola, PANINI Extras, FIFA World Cup)

export const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  // 48 teams — PT-BR + EN + 3-letter code, longer multi-word forms first
  // (the expand function sorts by length DESC so multi-word matches first).
  algeria: 'ALG', argelia: 'ALG', argélia: 'ALG', alg: 'ALG',
  argentina: 'ARG', arg: 'ARG',
  australia: 'AUS', austrália: 'AUS', aus: 'AUS',
  austria: 'AUT', áustria: 'AUT', aut: 'AUT',
  belgium: 'BEL', belgica: 'BEL', bélgica: 'BEL', bel: 'BEL',
  'bosnia and herzegovina': 'BIH', 'bósnia e herzegovina': 'BIH', bosnia: 'BIH', bósnia: 'BIH', bih: 'BIH',
  brazil: 'BRA', brasil: 'BRA', bra: 'BRA',
  canada: 'CAN', canadá: 'CAN', can: 'CAN',
  'cabo verde': 'CPV', 'cape verde': 'CPV', caboverde: 'CPV', capeverde: 'CPV', cpv: 'CPV',
  colombia: 'COL', colômbia: 'COL', col: 'COL',
  croatia: 'CRO', croacia: 'CRO', croácia: 'CRO', cro: 'CRO',
  curacao: 'CUW', curaçao: 'CUW', korsou: 'CUW', cuw: 'CUW',
  czechia: 'CZE', 'czech republic': 'CZE', tcheca: 'CZE', 'republica tcheca': 'CZE', 'república tcheca': 'CZE', cze: 'CZE',
  'dr congo': 'COD', 'rd congo': 'COD', 'congo dr': 'COD', 'republica democratica do congo': 'COD', cod: 'COD',
  ecuador: 'ECU', equador: 'ECU', ecu: 'ECU',
  egypt: 'EGY', egito: 'EGY', egy: 'EGY',
  england: 'ENG', inglaterra: 'ENG', eng: 'ENG',
  france: 'FRA', franca: 'FRA', frança: 'FRA', fra: 'FRA',
  germany: 'GER', alemanha: 'GER', ger: 'GER',
  ghana: 'GHA', gana: 'GHA', gha: 'GHA',
  haiti: 'HAI', haïti: 'HAI', hai: 'HAI',
  iran: 'IRN', irã: 'IRN', ira: 'IRN', irn: 'IRN',
  iraq: 'IRQ', iraque: 'IRQ', irq: 'IRQ',
  "côte d'ivoire": 'CIV', 'cote d ivoire': 'CIV', 'costa do marfim': 'CIV', 'costa do marfin': 'CIV', 'ivory coast': 'CIV', costadomarfim: 'CIV', civ: 'CIV',
  japan: 'JPN', japao: 'JPN', japão: 'JPN', jpn: 'JPN',
  jordan: 'JOR', jordania: 'JOR', jordânia: 'JOR', jor: 'JOR',
  mexico: 'MEX', méxico: 'MEX', mex: 'MEX',
  morocco: 'MAR', marrocos: 'MAR', mar: 'MAR',
  netherlands: 'NED', holanda: 'NED', 'paises baixos': 'NED', 'países baixos': 'NED', ned: 'NED',
  'new zealand': 'NZL', 'nova zelandia': 'NZL', 'nova zelândia': 'NZL', nzl: 'NZL',
  norway: 'NOR', noruega: 'NOR', nor: 'NOR',
  panama: 'PAN', panamá: 'PAN', pan: 'PAN',
  paraguay: 'PAR', paraguai: 'PAR', par: 'PAR',
  portugal: 'POR', por: 'POR',
  qatar: 'QAT', catar: 'QAT', qat: 'QAT',
  'saudi arabia': 'KSA', 'arabia saudita': 'KSA', 'arábia saudita': 'KSA', ksa: 'KSA',
  scotland: 'SCO', escocia: 'SCO', escócia: 'SCO', sco: 'SCO',
  senegal: 'SEN', sen: 'SEN',
  'south africa': 'RSA', 'africa do sul': 'RSA', 'áfrica do sul': 'RSA', rsa: 'RSA',
  'korea republic': 'KOR', 'south korea': 'KOR', 'coreia do sul': 'KOR', 'coréia do sul': 'KOR', coreia: 'KOR', coréia: 'KOR', kor: 'KOR',
  spain: 'ESP', espanha: 'ESP', esp: 'ESP',
  sweden: 'SWE', suecia: 'SWE', suécia: 'SWE', swe: 'SWE',
  switzerland: 'SUI', suica: 'SUI', suíça: 'SUI', sui: 'SUI',
  tunisia: 'TUN', tunísia: 'TUN', tun: 'TUN',
  turkey: 'TUR', turquia: 'TUR', tur: 'TUR',
  uruguay: 'URU', uruguai: 'URU', uru: 'URU',
  usa: 'USA', eua: 'USA', 'estados unidos': 'USA',
  uzbekistan: 'UZB', uzbequistao: 'UZB', uzbequistão: 'UZB', uzb: 'UZB',

  // Special sections
  'coca cola': 'CC', 'coca-cola': 'CC', cocacola: 'CC', coca: 'CC', cc: 'CC',
  'fifa world cup': 'FWC', 'copa do mundo': 'FWC', fwc: 'FWC',
  // PANINI Extras precisa de tier — deixamos pra outro momento (EXT-N-OUR/PRA/BRO/REG)
}

/**
 * Replace free-text country mentions with FIFA 3-letter codes so the
 * sticker-code regex matches naturally.
 *
 * Examples:
 *   "registra brasil 1, argentina 3" → "registra BRA 1, ARG 3"
 *   "cabo verde 5"                    → "CPV 5"
 *   "costa do marfim 8"               → "CIV 8"
 *   "BRA-1 ARG-3"                     → unchanged (already codes)
 *
 * Sorts keys by length DESC so multi-word names ("cabo verde") match
 * before single tokens ("verde").
 */
export function expandCountryNamesToCodes(text: string): string {
  if (!text) return text
  const keys = Object.keys(COUNTRY_NAME_TO_CODE).sort((a, b) => b.length - a.length)
  let result = text
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // Word-boundary equivalent that handles non-ASCII chars too —
    // \b doesn't work with accented chars, so use lookaround for letter neighbors.
    const re = new RegExp(`(?<![\\p{L}\\d])${escaped}(?![\\p{L}\\d])`, 'giu')
    result = result.replace(re, COUNTRY_NAME_TO_CODE[key])
  }
  return result
}
