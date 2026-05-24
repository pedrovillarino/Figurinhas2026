// Fonte única para os números do álbum (Coladas / Repetidas / Faltantes / %).
//
// Toda surface (bot WA, /album, /profile, /dashboard, /ranking, /trades,
// /scan, /export, PDF, ExportModal, clear-duplicates) DEVE consumir daqui.
// Re-implementar à mão = drift garantido entre telas.
//
// Decisões canônicas (Pedro 2026-05-24):
//   1. Stats sempre devolvem cromos DISTINTOS e CÓPIAS FÍSICAS separados.
//      Surfaces decidem qual exibir — geralmente os dois sem hierarquia.
//   2. A métrica "principal" de Repetidas inclui Coca-Cola e PANINI Extras
//      (são inventário trocável), com split disponível pra surfaces que
//      precisam distinguir álbum oficial vs extras.
//   3. "Coladas" = cromos com status='owned' OU 'duplicate' (qty>=1).
//   4. Denominador do progresso é counts_for_completion=true (o álbum
//      oficial). Coca-Cola e PANINI Extras não empurram a barra.

export type UserStickerStatus = 'owned' | 'missing' | 'duplicate'

export type UserStickerEntry = {
  status: UserStickerStatus | string
  quantity: number
}

export type StickerMeta = {
  id: number
  counts_for_completion?: boolean | null
}

// Stats de uma partição (álbum oficial OU extras OU tudo combinado).
export type PartitionStats = {
  /** Tamanho da partição (denominador do progresso). */
  total: number
  /** Cromos distintos colados (status owned OU duplicate). <= total. */
  pasted: number
  /** Cromos distintos faltando (status missing ou sem registro). = total - pasted. */
  missing: number
  /** Cromos distintos marcados como duplicate (qty >= 2). */
  duplicateStickers: number
  /** Cópias físicas extras: soma de (quantity - 1) onde status='duplicate'. */
  duplicateCopies: number
  /** Percentual colado, arredondado. 0 se total=0. */
  pct: number
}

export type AlbumStats = {
  /** Apenas counts_for_completion !== false (álbum oficial — o "X/980"). */
  album: PartitionStats
  /** Apenas counts_for_completion === false (Coca-Cola + PANINI Extras). */
  extras: PartitionStats
  /** Álbum + Extras juntos (todo inventário do usuário). */
  all: PartitionStats
}

const EMPTY_PARTITION: PartitionStats = {
  total: 0,
  pasted: 0,
  missing: 0,
  duplicateStickers: 0,
  duplicateCopies: 0,
  pct: 0,
}

function isCompletable(s: StickerMeta): boolean {
  // undefined/null tratado como "true" pra backward compat com stickers
  // antigos que não tinham a coluna.
  return s.counts_for_completion !== false
}

function pctOf(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0
  return Math.round((numerator / denominator) * 100)
}

/**
 * Computa stats canônicos a partir do array de stickers (metadata) e do
 * mapa de inventário do usuário. Esta é a forma preferida quando a
 * surface já tem stickers em memória (a maioria — vêm de getCachedStickers).
 *
 * @param stickers Lista de stickers do catálogo (precisa de `id` + opcional `counts_for_completion`)
 * @param userMap Mapa sticker_id → { status, quantity }. Stickers sem entrada são tratados como missing.
 */
export function computeAlbumStats(
  stickers: StickerMeta[],
  userMap: Record<number, UserStickerEntry>,
): AlbumStats {
  let albumTotal = 0
  let albumPasted = 0
  let albumDupStickers = 0
  let albumDupCopies = 0

  let extrasTotal = 0
  let extrasPasted = 0
  let extrasDupStickers = 0
  let extrasDupCopies = 0

  for (const s of stickers) {
    const completable = isCompletable(s)
    if (completable) albumTotal++
    else extrasTotal++

    const us = userMap[s.id]
    if (!us) continue

    const pasted = us.status === 'owned' || us.status === 'duplicate'
    const isDup = us.status === 'duplicate'
    const extraCopies = isDup ? Math.max(0, (us.quantity ?? 1) - 1) : 0

    if (completable) {
      if (pasted) albumPasted++
      if (isDup) {
        albumDupStickers++
        albumDupCopies += extraCopies
      }
    } else {
      if (pasted) extrasPasted++
      if (isDup) {
        extrasDupStickers++
        extrasDupCopies += extraCopies
      }
    }
  }

  const album: PartitionStats = {
    total: albumTotal,
    pasted: albumPasted,
    missing: Math.max(0, albumTotal - albumPasted),
    duplicateStickers: albumDupStickers,
    duplicateCopies: albumDupCopies,
    pct: pctOf(albumPasted, albumTotal),
  }

  const extras: PartitionStats = {
    total: extrasTotal,
    pasted: extrasPasted,
    missing: Math.max(0, extrasTotal - extrasPasted),
    duplicateStickers: extrasDupStickers,
    duplicateCopies: extrasDupCopies,
    pct: pctOf(extrasPasted, extrasTotal),
  }

  const allTotal = albumTotal + extrasTotal
  const allPasted = albumPasted + extrasPasted
  const all: PartitionStats = {
    total: allTotal,
    pasted: allPasted,
    missing: Math.max(0, allTotal - allPasted),
    duplicateStickers: albumDupStickers + extrasDupStickers,
    duplicateCopies: albumDupCopies + extrasDupCopies,
    pct: pctOf(allPasted, allTotal),
  }

  return { album, extras, all }
}

export function emptyAlbumStats(): AlbumStats {
  return { album: EMPTY_PARTITION, extras: EMPTY_PARTITION, all: EMPTY_PARTITION }
}

// ─── Formatadores ───────────────────────────────────────────────
// Mantêm o copy consistente entre bot, modais e telas. Centralizar aqui
// é o que garante que "120 repetidas (240 cópias)" não vire "240 repetidas"
// em outra tela.

/**
 * "640/980" — fração de coladas. Use junto de "coladas" no copy.
 */
export function formatPastedFraction(p: PartitionStats): string {
  return `${p.pasted}/${p.total}`
}

/**
 * "120 cromos · 240 cópias" — distintos + cópias físicas extras.
 * Quando duplicateCopies === duplicateStickers (cada repetida tem só 1 cópia
 * extra), simplifica pra "120 repetidas". Decisão Pedro: sempre os dois
 * sem hierarquia. Surfaces tight em espaço podem usar `formatDuplicateShort`.
 */
export function formatDuplicateLabel(p: PartitionStats): string {
  if (p.duplicateStickers === 0) return '0 repetidas'
  return `${p.duplicateStickers} cromos · ${p.duplicateCopies} cópias`
}

/**
 * "120 repetidas" — variante curta pra surfaces apertadas (ranking row, etc).
 * Mostra só distintos quando não há espaço pros dois.
 */
export function formatDuplicateShort(p: PartitionStats): string {
  return `${p.duplicateStickers} repetidas`
}

/**
 * "295 + 10 extras" — split álbum vs extras. Útil quando a surface mostra
 * o total combinado (`all`) e quer revelar a quebra.
 */
export function formatDuplicateSplit(stats: AlbumStats): string {
  const albumN = stats.album.duplicateStickers
  const extrasN = stats.extras.duplicateStickers
  if (extrasN === 0) return `${albumN}`
  return `${albumN} + ${extrasN} extras`
}
