import { createClient } from '@/lib/supabase/server'
import { unstable_cache } from 'next/cache'

/**
 * Cached sticker list — revalidates every 24h.
 * The sticker catalog is static (~980 rows, ~50KB) and shared across
 * album, dashboard, trades, and export pages.
 */
export const getCachedStickers = unstable_cache(
  async () => {
    const supabase = await createClient()
    const { data } = await supabase
      .from('stickers')
      .select('id, number, player_name, country, section, type')
      .order('number')
    return data || []
  },
  ['stickers-list'],
  { revalidate: 86400 } // 24 hours
)
