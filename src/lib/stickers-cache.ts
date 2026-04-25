import { createClient } from '@supabase/supabase-js'
import { unstable_cache } from 'next/cache'

/**
 * Cached sticker list — revalidates every 24h.
 * Uses admin client (no cookies needed) since stickers are public data.
 * Shared across album, dashboard, trades, and export pages.
 */
export const getCachedStickers = unstable_cache(
  async () => {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    // Supabase default limit is 1000 rows — fetch in pages for albums with 1000+ stickers
    const [page1, page2] = await Promise.all([
      supabase
        .from('stickers')
        .select('id, number, player_name, country, section, type')
        .order('number')
        .range(0, 999),
      supabase
        .from('stickers')
        .select('id, number, player_name, country, section, type')
        .order('number')
        .range(1000, 1999),
    ])
    return [...(page1.data || []), ...(page2.data || [])]
  },
  ['stickers-list-v2026-launch'],
  { revalidate: 3600 }
)
