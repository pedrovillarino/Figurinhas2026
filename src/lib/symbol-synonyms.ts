/**
 * Pedro 2026-05-03 (caso Taciane): scanner identifica símbolos visualmente
 * mas devolve nome em inglês ("Official Ball", "World Cup Trophy") que não
 * casa com o nome canônico no DB ("TRIONDA - Bola Oficial", "Taça Oficial").
 *
 * Solução: mapa de SINÔNIMOS — qualquer descrição livre desses símbolos
 * resolve pro número canônico (FWC-X, ou {COUNTRY}-1/13). O matching backend
 * tenta esse mapa ANTES da busca por nome de jogador.
 */

/** Retorna o number canônico (ex: "FWC-5") ou null. */
export function matchSymbolByName(
  rawName: string | null | undefined,
  rawCountry: string | null | undefined,
): string | null {
  if (!rawName) return null
  const name = rawName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!name) return null

  const country = (rawCountry || '').toLowerCase().trim()

  // ─── Bola TRIONDA / Bola Oficial → FWC-5 ───
  if (
    /\btrionda\b/.test(name) ||
    /\b(official\s+)?ball\b/.test(name) ||
    /\b(world\s+cup\s+)?ball\b/.test(name) ||
    /\bbola\s+(oficial|panini|fifa)\b/.test(name) ||
    /\boficial\s+ball\b/.test(name)
  ) {
    return 'FWC-5'
  }

  // ─── Taça / Trophy ───
  // Hoje DB tem 2 partes: FWC-1 (cima), FWC-2 (baixo provável).
  // Default = FWC-1 quando ambiguo. Se contexto diz "lower"/"baixo"/"bottom"/"base", FWC-2.
  if (
    /\b(world\s+cup\s+)?(trophy|trofeu|trofeo)\b/.test(name) ||
    /\bfifa\s+trophy\b/.test(name) ||
    /\b(taca|taça|cup)\s+(oficial|do\s+mundo|fifa)\b/.test(name) ||
    /\b(taca|taça)\b/.test(name)
  ) {
    if (/\b(lower|bottom|baixo|inferior|base|down|stand|pedestal)\b/.test(name)) {
      return 'FWC-2'
    }
    return 'FWC-1'
  }

  // ─── Mascote(s) → FWC-3 ───
  if (
    /\bmascot[se]?\b/.test(name) ||
    /\bzayu\b/.test(name) ||
    /\b(maple|moose|alce)\b/.test(name) ||
    /\b(clutch|eagle|aguia)\b/.test(name)
  ) {
    return 'FWC-3'
  }

  // ─── Quadro de Honra / Roll of Honor → FWC-0 (We are Panini fica de fora,
  //     pq tem desenho próprio) ───
  // Pedro 2026-05-03: FWC-0 mudou pra "We are Panini" — esse é a figurinha
  // foil holográfica do jogador chutando bicicleta. Sinônimos:
  if (
    /\bwe\s+are\s+panini\b/.test(name) ||
    /\bbicycle\s+kick\b/.test(name) ||
    /\b(panini\s+)?bicicleta\b/.test(name)
  ) {
    return 'FWC-0'
  }

  // ─── Slogan oficial (já não tem mais — virou taça cima — mas mantém) ───
  // Não retorna nada — slogan agora é parte da decoração da página, não sticker.

  // ─── Emblema oficial da Copa (logo da FIFA WC 2026) → FWC-2 (provável) ───
  // Cuidado: "Emblem" sozinho com country='Brasil' deve ir pra BRA-1, não FWC-2.
  // Só matcha "Official Emblem" / "World Cup Emblem" sem país específico.
  if (
    (country === '' || country === 'fifa') &&
    /\b(world\s+cup\s+|official\s+|fifa\s+)emblem\b/.test(name)
  ) {
    return 'FWC-2'
  }

  // ─── Emblemas dos países-sede (Canadá/México/USA na seção FIFA) → FWC-6/7/8 ───
  if (country === 'fifa' || country === '') {
    if (/\b(canada|canadian|canadense|maple\s+leaf)\s+(emblem|crest|logo|escudo)/.test(name)) return 'FWC-6'
    if (/\b(mexico|mexican|mexicano|fmf)\s+(emblem|crest|logo|escudo)/.test(name)) return 'FWC-7'
    if (/\b(usa|us|american|united\s+states|u\.?s\.?\s+soccer)\s+(emblem|crest|logo|escudo)/.test(name)) return 'FWC-8'
  }

  return null
}

/**
 * Tenta achar o sticker no DB usando o mapa de sinônimos.
 * Retorna o sticker ou null.
 */
export function findSymbolSticker<T extends { number: string }>(
  rawName: string | null | undefined,
  rawCountry: string | null | undefined,
  numberMap: Map<string, T>,
): T | null {
  const canonicalNumber = matchSymbolByName(rawName, rawCountry)
  if (!canonicalNumber) return null
  return numberMap.get(canonicalNumber) || null
}
