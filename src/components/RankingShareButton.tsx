'use client'

interface RankingShareButtonProps {
  nationalRank: number
  ownedCount: number
}

export default function RankingShareButton({ nationalRank, ownedCount }: RankingShareButtonProps) {
  const text = `Sou o #${nationalRank} no Complete Aí! Já colei ${ownedCount}/1028 figurinhas da Copa 2026! \u{1F3C6}`

  async function handleShare() {
    if (navigator.share) {
      try {
        await navigator.share({ text })
        return
      } catch {
        // User cancelled or share failed — fall through to clipboard
      }
    }

    if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(text)
      } catch {
        // Clipboard write failed silently
      }
    }
  }

  return (
    <button
      onClick={handleShare}
      className="mt-3 w-full rounded-xl border border-brand/30 px-4 py-2 text-sm font-semibold text-brand transition-colors hover:bg-brand/5 active:bg-brand/10"
    >
      Compartilhar
    </button>
  )
}
