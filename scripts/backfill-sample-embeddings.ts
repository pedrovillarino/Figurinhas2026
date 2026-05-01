#!/usr/bin/env tsx
/**
 * Backfill embeddings on sticker_samples rows that have an image_path but no
 * embedding yet (e.g. Cohere was timing out, or COHERE_API_KEY wasn't set
 * when the scan happened, or we trocamos de modelo).
 *
 * Idempotent: only processes rows where embedding IS NULL AND image_path
 * IS NOT NULL. Logs every step. Caps the run at 500 rows by default to
 * avoid spending a fortune in one shot — re-run until "0 candidates" prints.
 *
 * Usage:
 *   COHERE_API_KEY=...
 *   NEXT_PUBLIC_SUPABASE_URL=...
 *   SUPABASE_SERVICE_ROLE_KEY=...
 *   npx tsx scripts/backfill-sample-embeddings.ts [--limit=N] [--dry-run]
 */
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { embedImage } from '../src/lib/embeddings'

const BUCKET = 'sticker-samples'
const DEFAULT_LIMIT = 500

function parseArgs() {
  const args = process.argv.slice(2)
  const limit = (() => {
    const flag = args.find((a) => a.startsWith('--limit='))
    if (!flag) return DEFAULT_LIMIT
    const n = parseInt(flag.split('=')[1], 10)
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_LIMIT
  })()
  const dryRun = args.includes('--dry-run')
  return { limit, dryRun }
}

async function main() {
  const { limit, dryRun } = parseArgs()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }
  if (!process.env.COHERE_API_KEY) {
    console.error('Missing COHERE_API_KEY — embeddings would all be null. Aborting.')
    process.exit(1)
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  console.log(`[backfill] limit=${limit} dry-run=${dryRun}`)

  const { data: candidates, error } = await admin
    .from('sticker_samples')
    .select('id, image_path, sticker_id, face')
    .is('embedding', null)
    .not('image_path', 'is', null)
    .order('id', { ascending: true })
    .limit(limit)

  if (error) {
    console.error('[backfill] query failed:', error.message)
    process.exit(1)
  }

  const rows = candidates ?? []
  console.log(`[backfill] ${rows.length} candidates`)
  if (rows.length === 0) {
    console.log('[backfill] nothing to do.')
    return
  }

  let ok = 0
  let skipped = 0
  let failed = 0

  for (const row of rows) {
    const path = row.image_path as string
    try {
      const dl = await admin.storage.from(BUCKET).download(path)
      if (dl.error || !dl.data) {
        console.warn(`[backfill] sample=${row.id} download failed: ${dl.error?.message}`)
        skipped++
        continue
      }
      const arrayBuf = await dl.data.arrayBuffer()
      const buf = Buffer.from(arrayBuf)

      const vec = await embedImage(buf, 'image/jpeg')
      if (!vec) {
        console.warn(`[backfill] sample=${row.id} embed returned null`)
        skipped++
        continue
      }

      if (dryRun) {
        console.log(`[backfill] sample=${row.id} would update (dim=${vec.length})`)
        ok++
        continue
      }

      const { error: updErr } = await admin
        .from('sticker_samples')
        .update({ embedding: vec })
        .eq('id', row.id)
      if (updErr) {
        console.error(`[backfill] sample=${row.id} update failed: ${updErr.message}`)
        failed++
        continue
      }
      ok++
      if (ok % 25 === 0) console.log(`[backfill] progress: ok=${ok} skipped=${skipped} failed=${failed}`)
    } catch (err) {
      console.error(`[backfill] sample=${row.id} error:`, err instanceof Error ? err.message : err)
      failed++
    }
  }

  console.log(`[backfill] done. ok=${ok} skipped=${skipped} failed=${failed}`)
}

main().catch((err) => {
  console.error('[backfill] fatal:', err)
  process.exit(1)
})
