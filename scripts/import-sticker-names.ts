/**
 * Idempotent sticker checklist importer.
 *
 * Reads a JSON checklist and updates matching stickers in the DB by `number`.
 * Never INSERTs or DELETEs — only UPDATEs known sticker rows so user_stickers
 * (the per-user collection state) is left untouched.
 *
 * Usage:
 *   npx ts-node --compiler-options '{"module":"commonjs"}' \
 *     scripts/import-sticker-names.ts <checklist.json> [--apply]
 *
 * Without --apply: dry-run, prints validation + diff. Default.
 * With --apply: writes UPDATEs to Supabase.
 *
 * Checklist format (JSON array):
 *   [
 *     { "number": "BRA-3", "player_name": "Alisson" },
 *     { "number": "BRA-4", "player_name": "Bento", "section": "Brazil" },
 *     ...
 *   ]
 *
 * Updatable fields: player_name, country, section, type.
 * Any other field on an entry is ignored.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

// ── env ─────────────────────────────────────────────────────────────────────
const envPath = resolve(__dirname, '..', '.env.local')
const env: Record<string, string> = {}
readFileSync(envPath, 'utf-8')
  .split('\n')
  .forEach((line) => {
    const m = line.match(/^([^=]+)=(.*)$/)
    if (m) env[m[1].trim()] = m[2].trim()
  })

const supabaseUrl = env['NEXT_PUBLIC_SUPABASE_URL']
const serviceRoleKey = env['SUPABASE_SERVICE_ROLE_KEY']
if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

// ── args ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const apply = args.includes('--apply')
const checklistPath = args.find((a) => !a.startsWith('--'))
if (!checklistPath) {
  console.error('Usage: import-sticker-names.ts <checklist.json> [--apply]')
  process.exit(1)
}
if (!existsSync(checklistPath)) {
  console.error(`Checklist file not found: ${checklistPath}`)
  process.exit(1)
}

// ── types ───────────────────────────────────────────────────────────────────
type Entry = {
  number: string
  player_name?: string
  country?: string
  section?: string
  type?: string
}
type DbRow = {
  number: string
  player_name: string | null
  country: string
  section: string
  type: string
}
const UPDATABLE: (keyof Entry)[] = ['player_name', 'country', 'section', 'type']

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  // Parse + validate checklist
  let checklist: Entry[]
  try {
    checklist = JSON.parse(readFileSync(checklistPath!, 'utf-8'))
  } catch (e) {
    console.error('Invalid JSON in checklist:', (e as Error).message)
    process.exit(1)
  }
  if (!Array.isArray(checklist)) {
    console.error('Checklist root must be a JSON array')
    process.exit(1)
  }
  const seen = new Set<string>()
  const dupes: string[] = []
  for (const e of checklist) {
    if (!e || typeof e.number !== 'string' || !e.number.trim()) {
      console.error('Bad entry, missing or invalid `number`:', e)
      process.exit(1)
    }
    if (seen.has(e.number)) dupes.push(e.number)
    seen.add(e.number)
  }
  if (dupes.length) {
    console.error('Duplicate numbers in checklist:', Array.from(new Set(dupes)).join(', '))
    process.exit(1)
  }
  console.log(`Loaded ${checklist.length} entries from ${checklistPath}`)

  // Fetch current DB state (pagination, default limit is 1000)
  const supabase = createClient(supabaseUrl!, serviceRoleKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const all: DbRow[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('stickers')
      .select('number, player_name, country, section, type')
      .order('number')
      .range(from, from + 999)
    if (error) {
      console.error('Failed to fetch stickers:', error.message)
      process.exit(1)
    }
    if (!data || data.length === 0) break
    all.push(...(data as DbRow[]))
    if (data.length < 1000) break
  }
  console.log(`Current DB has ${all.length} stickers`)
  const dbByNumber = new Map(all.map((s) => [s.number, s]))

  // Compute diff
  type Change = { number: string; field: keyof Entry; from: unknown; to: unknown }
  const changes: Change[] = []
  const missingInDb: string[] = []
  for (const entry of checklist) {
    const db = dbByNumber.get(entry.number)
    if (!db) {
      missingInDb.push(entry.number)
      continue
    }
    for (const field of UPDATABLE) {
      const next = entry[field]
      if (next === undefined) continue
      const current = (db as unknown as Record<string, unknown>)[field]
      if (current !== next) changes.push({ number: entry.number, field, from: current, to: next })
    }
  }
  const checklistNumbers = new Set(checklist.map((e) => e.number))
  const inDbNotInChecklist = all.filter((s) => !checklistNumbers.has(s.number)).map((s) => s.number)

  // Report
  console.log('\n=== Validation ===')
  console.log(`Updates pending:        ${changes.length}`)
  console.log(`In checklist, not DB:   ${missingInDb.length}${missingInDb.length ? '  (will be skipped — script never INSERTs)' : ''}`)
  console.log(`In DB, not in checklist: ${inDbNotInChecklist.length}${inDbNotInChecklist.length ? '  (untouched — script never DELETEs)' : ''}`)
  if (missingInDb.length) {
    console.log('  e.g.:', missingInDb.slice(0, 10).join(', '), missingInDb.length > 10 ? '...' : '')
  }

  if (changes.length) {
    console.log('\n=== First 20 updates ===')
    for (const c of changes.slice(0, 20)) {
      console.log(`  ${c.number}.${String(c.field)}: ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`)
    }
    if (changes.length > 20) console.log(`  ...and ${changes.length - 20} more`)
  }

  if (!apply) {
    console.log('\nDRY-RUN. Re-run with --apply to write changes.')
    return
  }
  if (changes.length === 0) {
    console.log('\nNothing to apply.')
    return
  }

  // Apply: group changes by number to minimize roundtrips
  console.log(`\nApplying updates to ${new Set(changes.map((c) => c.number)).size} stickers...`)
  const byNumber = new Map<string, Partial<Entry>>()
  for (const c of changes) {
    const patch = byNumber.get(c.number) ?? {}
    ;(patch as Record<string, unknown>)[c.field as string] = c.to
    byNumber.set(c.number, patch)
  }
  let ok = 0
  let fail = 0
  const entries = Array.from(byNumber.entries())
  for (const [number, patch] of entries) {
    const { error } = await supabase.from('stickers').update(patch).eq('number', number)
    if (error) {
      console.error(`  FAIL ${number}: ${error.message}`)
      fail++
    } else {
      ok++
    }
  }
  console.log(`\nDone: ${ok} ok, ${fail} failed`)
  if (fail) process.exit(1)
}

main().catch((e) => {
  console.error('Fatal:', e)
  process.exit(1)
})
