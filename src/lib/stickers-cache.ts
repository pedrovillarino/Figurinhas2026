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
    const { data } = await supabase
      .from('stickers')
      .select('id, number, player_name, country, section, type')
      .order('number')
    return data || []
  },
  ['stickers-list'],
  { revalidate: 86400 } // 24 hours
)
