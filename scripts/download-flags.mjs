// Download flat PNG flags from flagcdn.com (CC0) into public/flags/{FIFA_CODE}.png.
// One-shot bootstrap — re-run only when teams change. Idempotent: skips files
// already present unless --force is passed.
//
// Usage: node scripts/download-flags.mjs [--force]

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const OUT_DIR = path.resolve(__dirname, '..', 'public', 'flags')

// FIFA 3-letter code → flagcdn ISO code. flagcdn supports special subnational
// codes for UK home nations (gb-eng, gb-sct).
const FIFA_TO_ISO = {
  ALG: 'dz', ARG: 'ar', AUS: 'au', AUT: 'at', BEL: 'be',
  BIH: 'ba', BRA: 'br', CAN: 'ca', CIV: 'ci', COD: 'cd',
  COL: 'co', CPV: 'cv', CRO: 'hr', CUW: 'cw', CZE: 'cz',
  ECU: 'ec', EGY: 'eg', ENG: 'gb-eng', ESP: 'es', FRA: 'fr',
  GER: 'de', GHA: 'gh', HAI: 'ht', IRN: 'ir', IRQ: 'iq',
  JOR: 'jo', JPN: 'jp', KOR: 'kr', KSA: 'sa', MAR: 'ma',
  MEX: 'mx', NED: 'nl', NOR: 'no', NZL: 'nz', PAN: 'pa',
  PAR: 'py', POR: 'pt', QAT: 'qa', RSA: 'za', SCO: 'gb-sct',
  SEN: 'sn', SUI: 'ch', SWE: 'se', TUN: 'tn', TUR: 'tr',
  URU: 'uy', USA: 'us', UZB: 'uz',
}

const FORCE = process.argv.includes('--force')
const SIZE = 'w80' // 80px wide, enough for a 22pt PDF render at 2x scale

fs.mkdirSync(OUT_DIR, { recursive: true })

const entries = Object.entries(FIFA_TO_ISO)
let downloaded = 0
let skipped = 0
let failed = 0

for (const [fifa, iso] of entries) {
  const outPath = path.join(OUT_DIR, `${fifa}.png`)
  if (!FORCE && fs.existsSync(outPath)) {
    skipped++
    continue
  }
  const url = `https://flagcdn.com/${SIZE}/${iso}.png`
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    fs.writeFileSync(outPath, buf)
    console.log(`✓ ${fifa} (${iso}) → ${outPath} [${buf.length}B]`)
    downloaded++
  } catch (err) {
    console.error(`✗ ${fifa} (${iso}): ${err.message}`)
    failed++
  }
}

console.log(`\nDone: ${downloaded} downloaded, ${skipped} skipped, ${failed} failed (total ${entries.length})`)
process.exit(failed > 0 ? 1 : 0)
