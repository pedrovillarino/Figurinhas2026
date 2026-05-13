// Pedro 2026-05-12: fonte única pra métrica de "repetidas".
// Decisão (Opção A): TODA figurinha duplicada conta como repetida — completable,
// Coca-Cola e PANINI Extras são todas inventário tradeável. Antes desse helper,
// cada superfície (Dashboard, PDF, /status WA, Album) tinha um escopo diferente
// e os números não batiam.
//
// O helper é SCOPE-AGNOSTIC: ele só conta. A decisão de quais cromos passar
// é do caller — pra Opção A, passe a lista inteira. Não filtre.

type MinimalSticker = { id: number }
type MinimalUserSticker = { status: string; quantity: number }

export type DuplicateStats = {
  /** Quantos cromos distintos têm status='duplicate'. */
  uniqueDuplicates: number
  /** Soma de (quantity - 1) — i.e., "quantas figurinhas repetidas tenho",
   *  desconsiderando a colada. É o número exibido como "X repetidas". */
  totalExtras: number
}

export function getDuplicateStats(
  stickers: MinimalSticker[],
  userStickerByStickerId:
    | Map<number, MinimalUserSticker>
    | Record<number, MinimalUserSticker | undefined>,
): DuplicateStats {
  const get = (id: number): MinimalUserSticker | undefined =>
    userStickerByStickerId instanceof Map
      ? userStickerByStickerId.get(id)
      : userStickerByStickerId[id]

  let uniqueDuplicates = 0
  let totalExtras = 0
  for (const s of stickers) {
    const us = get(s.id)
    if (us?.status === 'duplicate') {
      uniqueDuplicates++
      totalExtras += Math.max(0, (us.quantity || 0) - 1)
    }
  }
  return { uniqueDuplicates, totalExtras }
}
