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
  // Pedro 2026-05-03: variantes que Gemini transcreve em áudio PT-BR
  checa: 'CZE', 'republica checa': 'CZE', 'república checa': 'CZE',
  chequia: 'CZE', tchequia: 'CZE', 'tchéquia': 'CZE', 'chéquia': 'CZE',
  techa: 'CZE', 'republica techa': 'CZE', // typos de transcrição de áudio
  // Pedro 2026-05-10 (caso real áudio): user fala "República do Congo"
  // ou só "Congo" — no álbum Copa 2026 o representado é o DR Congo
  // (Kinshasa), então mapeamos todas as variantes pra COD.
  'dr congo': 'COD', 'rd congo': 'COD', 'congo dr': 'COD',
  'republica democratica do congo': 'COD', 'república democrática do congo': 'COD',
  'republica do congo': 'COD', 'república do congo': 'COD',
  'r.d. congo': 'COD', 'r.d congo': 'COD',
  'congo democratica': 'COD', 'congo democrática': 'COD',
  congo: 'COD', cod: 'COD',
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
  // Pedro 2026-05-10 (caso real áudio): user fala "Marroco" (sem o s)
  // ou "Marrocô" — Gemini transcreve assim e country code não match.
  morocco: 'MAR', marrocos: 'MAR', marroco: 'MAR', marrocô: 'MAR',
  maroc: 'MAR', mar: 'MAR',
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
  // Pedro 2026-05-10 (caso real áudio): user soletra "F C W" mas o
  // código é "FWC". Se Gemini transcreve a ordem diferente, capturamos
  // ambas as variantes (FCW errado, FVC erro de fala).
  'fifa world cup': 'FWC', 'copa do mundo': 'FWC',
  fwc: 'FWC', fcw: 'FWC', fvc: 'FWC',
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

// ─── Soletramento de código (3 letras isoladas) → sigla colada ──────────────
// Pedro 2026-05-09 (caso Cintia): user soletrou "C Z E 3 5 7" no chat e o
// parser de códigos não reconheceu (regex exige `[a-z]{2,5}` colado, não
// letras isoladas). Solução: detectar 3 letras isoladas separadas por
// espaço/hífen/ponto, validar contra a lista de códigos FIFA conhecidos,
// e juntar antes de qualquer outra normalização.
//
// Validação contra `VALID_CODES` evita falsos positivos como "a B C D" →
// "aBCD" (ABCD não é código → fica intacto). Também tenta variantes de
// 3, 4 e 5 letras pra cobrir códigos como CC e FWC se forem soletrados.

// Pedro 2026-05-10 (caso real áudio "F C W 1"): inclui também as
// chaves 3-letras de COUNTRY_NAME_TO_CODE em uppercase, pra que
// soletramentos errados ("FCW") sejam aceitos no collapse e o
// expand subsequente normalize pra "FWC".
const VALID_CODES: Set<string> = new Set([
  ...Object.values(COUNTRY_NAME_TO_CODE),
  'CC', 'FWC',
  ...Object.keys(COUNTRY_NAME_TO_CODE)
    .filter((k) => k.length >= 3 && k.length <= 5 && /^[a-z]+$/.test(k))
    .map((k) => k.toUpperCase()),
])

/**
 * Detects 3-5 isolated single letters separated by space/hyphen/period and
 * collapses them into a FIFA-style code IF the joined result is a known
 * code. Otherwise leaves the text unchanged.
 *
 * Examples:
 *   "C Z E 3 5"     → "CZE 3 5"      (CZE valid)
 *   "U-S-A 1"       → "USA 1"        (USA valid)
 *   "c.z.e. 3"      → "CZE 3"        (CZE valid, period separators)
 *   "B R A 1, A R G 3" → "BRA 1, ARG 3"  (both valid)
 *   "a B C D"       → "a B C D"      (ABCD/BCD not valid → unchanged)
 *   "I E O 1"       → "I E O 1"      (IEO not valid → unchanged)
 */
// Built dynamically to use the `u` flag (Unicode property escapes) without
// hitting TS's static lint on regex literals. Same effect as a literal /.../giu.
// Trailing `[\\s\\-.]*` consumes a stray separator after the last letter
// (e.g. "C.Z.E." has a trailing "." that should be eaten).
const SPELLED_LETTERS_RE = new RegExp(
  '(?<![\\p{L}\\d])([a-z])[\\s\\-.]+([a-z])[\\s\\-.]+([a-z])(?:[\\s\\-.]+([a-z]))?(?:[\\s\\-.]+([a-z]))?([\\-.]+(?=\\s|$))?',
  'giu',
)

export function collapseSpelledLetters(text: string): string {
  if (!text) return text
  return text.replace(SPELLED_LETTERS_RE, (match, a, b, c, d, e) => {
    const letters = [a, b, c, d, e].filter(Boolean) as string[]
    // Try the longest first (5, 4, 3 letters) — first valid wins
    for (let len = letters.length; len >= 3; len--) {
      const candidate = letters.slice(0, len).join('').toUpperCase()
      if (VALID_CODES.has(candidate)) {
        const remaining = letters.slice(len).join(' ')
        return remaining ? `${candidate} ${remaining}` : candidate
      }
    }
    return match
  })
}

// ─── Spelled-out PT-BR numbers → digits ────────────────────────────────────
// Problema observado em produção (2026-05-02): quando o user fala um áudio
// como "Espanha 3" ou "Cabo Verde 7", o Gemini transcreve com o número POR
// EXTENSO ("Espanha três", "Cabo Verde sete"). Quando fala a sigla soletrada
// ("E-S-P 3"), aí sim transcreve com o numeral. Resultado: o parser de
// figurinhas (que exige `\d{1,2}`) só funcionava com siglas. Pedro pediu
// fix (2026-05-02): "espanha 3 nao estava reconhendo no audio... so quando
// fala esp 3" + "cabo verde tbm... so quando falava a sigla".
//
// O prompt do Gemini já pede pra converter, mas LLM não é determinístico.
// Esta função é o backup em código: roda DEPOIS da transcrição e ANTES do
// expandCountryNamesToCodes. Cobre todos os números 0-99 (suficiente pra
// figurinhas, que vão até ~20).

const UNITS: Record<string, number> = {
  zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, três: 3, quatro: 4,
  cinco: 5, seis: 6, meia: 6, sete: 7, oito: 8, nove: 9,
}
const TEENS: Record<string, number> = {
  dez: 10, onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14,
  quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19,
}
const TENS: Record<string, number> = {
  vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, cinqüenta: 50,
  sessenta: 60, setenta: 70, oitenta: 80, noventa: 90,
}

// Build alternation in length-DESC order so "dezessete" matches before "dez".
const ALL_NUMBER_WORDS = [
  ...Object.keys(TENS),
  ...Object.keys(TEENS),
  ...Object.keys(UNITS),
].sort((a, b) => b.length - a.length)

/**
 * Converts spelled-out Portuguese numbers (0-99) to digits.
 *
 * Handles:
 *   "três" → "3"
 *   "treze" → "13"
 *   "vinte" → "20"
 *   "vinte e cinco" → "25"
 *   "vinte cinco" → "25" (some Gemini transcriptions skip "e")
 *   "Espanha três" → "Espanha 3"
 *   "Cabo Verde vinte e um" → "Cabo Verde 21"
 *
 * Stays defensive: only converts when the spelled-out word is clearly a
 * number in context (followed by another number-word, end-of-string, or
 * non-letter). Doesn't touch "umas figurinhas" (here "uma" is article).
 */
export function convertSpelledNumbersToDigits(text: string): string {
  if (!text) return text

  // Pass 1: compound "vinte e cinco" → "25" (and "vinte cinco" without "e")
  const tensRe = new RegExp(
    `(?<![\\p{L}\\d])(${Object.keys(TENS).join('|')})(?:\\s+e)?\\s+(${Object.keys(UNITS).join('|')})(?![\\p{L}\\d])`,
    'giu',
  )
  let result = text.replace(tensRe, (_m, t: string, u: string) => {
    const ten = TENS[t.toLowerCase()]
    const unit = UNITS[u.toLowerCase()]
    if (ten == null || unit == null) return _m
    return String(ten + unit)
  })

  // Pass 2: standalone words ("três" → "3", "treze" → "13", "vinte" → "20")
  const standaloneRe = new RegExp(
    `(?<![\\p{L}\\d])(${ALL_NUMBER_WORDS.join('|')})(?![\\p{L}\\d])`,
    'giu',
  )
  result = result.replace(standaloneRe, (_m, w: string) => {
    const lc = w.toLowerCase()
    const v = UNITS[lc] ?? TEENS[lc] ?? TENS[lc]
    return v == null ? _m : String(v)
  })

  return result
}
