import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// Load env vars from .env.local
const envPath = resolve(__dirname, '..', '.env.local')
const envContent = readFileSync(envPath, 'utf-8')
const env: Record<string, string> = {}
envContent.split('\n').forEach((line) => {
  const match = line.match(/^([^=]+)=(.*)$/)
  if (match) env[match[1].trim()] = match[2].trim()
})

const supabaseUrl = env['NEXT_PUBLIC_SUPABASE_URL']
const serviceRoleKey = env['SUPABASE_SERVICE_ROLE_KEY']

if (!supabaseUrl || !serviceRoleKey) {
  console.error('❌ Faltam variáveis de ambiente:')
  if (!supabaseUrl) console.error('   - NEXT_PUBLIC_SUPABASE_URL')
  if (!serviceRoleKey) console.error('   - SUPABASE_SERVICE_ROLE_KEY')
  console.error('\nAdicione SUPABASE_SERVICE_ROLE_KEY ao .env.local')
  console.error('(Encontre em: Supabase Dashboard > Settings > API > service_role)')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

type StickerData = {
  number: string
  player_name: string
  country: string
  section: string
  type: string
  edition?: string
}

async function seed() {
  console.log('🌱 Iniciando seed de figurinhas...\n')

  const filePath = resolve(__dirname, '..', 'stickers-data.json')
  const raw = readFileSync(filePath, 'utf-8')
  const stickers: StickerData[] = JSON.parse(raw)

  console.log(`📦 ${stickers.length} figurinhas encontradas no JSON\n`)

  const BATCH_SIZE = 50
  let inserted = 0
  let errors = 0

  for (let i = 0; i < stickers.length; i += BATCH_SIZE) {
    const batch = stickers.slice(i, i + BATCH_SIZE).map((s) => ({
      number: s.number,
      player_name: s.player_name,
      country: s.country,
      section: s.section,
      type: s.type || 'player',
    }))

    const { error } = await supabase
      .from('stickers')
      .upsert(batch, { onConflict: 'number' })

    if (error) {
      console.error(`❌ Erro no lote ${i}-${i + batch.length}:`, error.message)
      errors += batch.length
    } else {
      inserted += batch.length
      console.log(`✅ ${inserted}/${stickers.length} figurinhas inseridas...`)
    }
  }

  console.log('\n' + '='.repeat(40))
  console.log(`🏁 Seed concluído!`)
  console.log(`   Total no JSON: ${stickers.length}`)
  console.log(`   Inseridas/atualizadas: ${inserted}`)
  if (errors > 0) console.log(`   Erros: ${errors}`)
  console.log('='.repeat(40))

  // Verify count in database
  const { count } = await supabase
    .from('stickers')
    .select('*', { count: 'exact', head: true })

  console.log(`\n📊 Total de figurinhas no banco: ${count}`)
}

seed().catch((err) => {
  console.error('Erro fatal:', err)
  process.exit(1)
})
