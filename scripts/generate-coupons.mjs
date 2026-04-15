#!/usr/bin/env node
/**
 * Gera cupons de desconto para campanha de lançamento do Complete Aí.
 *
 * Campanha:
 *   - 500 cupons de 20% (distribuição em massa — redes sociais, WhatsApp)
 *   - 100 cupons de 50% (influencers, parcerias, early adopters)
 *   -  50 cupons de 100% (easter eggs, premios, equipe)
 *
 * Cada cupom é válido para QUALQUER plano pago (estreante, colecionador, copa_completa).
 * Uso único por usuário, sem expiração (pode ser desativado manualmente).
 *
 * Uso:
 *   node scripts/generate-coupons.mjs
 *   node scripts/generate-coupons.mjs --dry-run
 *   node scripts/generate-coupons.mjs --tier estreante   (só gera pra 1 tier)
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)
const dryRun = process.argv.includes('--dry-run')
const tierFilter = process.argv.find(a => a.startsWith('--tier='))?.split('=')[1] || null

// ─── Config ───
const TIERS = tierFilter ? [tierFilter] : ['estreante', 'colecionador', 'copa_completa']

const CAMPAIGNS = [
  { percent_off: 20, count: 500, prefix: 'COPA20', label: '20% off (massa)' },
  { percent_off: 50, count: 100, prefix: 'COPA50', label: '50% off (parceiros)' },
  { percent_off: 100, count: 50, prefix: 'GRATIS', label: '100% off (easter eggs)' },
]

function generateCode(prefix, index) {
  // Format: PREFIX-XXXX where XXXX is random alphanumeric
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no I/O/1/0 to avoid confusion
  let suffix = ''
  for (let i = 0; i < 5; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)]
  }
  return `${prefix}-${suffix}`
}

async function main() {
  console.log('🎫 Gerando cupons de desconto para campanha de lançamento\n')
  if (dryRun) console.log('   (DRY RUN — nada será salvo)\n')

  let totalGenerated = 0
  const allCodes = []

  for (const tier of TIERS) {
    console.log(`\n📦 Tier: ${tier.toUpperCase()}`)
    console.log('─'.repeat(40))

    for (const campaign of CAMPAIGNS) {
      const codes = []
      const usedCodes = new Set()

      for (let i = 0; i < campaign.count; i++) {
        let code
        do {
          code = generateCode(campaign.prefix, i)
        } while (usedCodes.has(code))
        usedCodes.add(code)

        codes.push({
          code,
          tier,
          percent_off: campaign.percent_off,
          max_uses: 1,
          times_used: 0,
          active: true,
          valid_until: null, // sem expiração
        })
      }

      if (!dryRun) {
        // Insert in batches of 100
        for (let i = 0; i < codes.length; i += 100) {
          const batch = codes.slice(i, i + 100)
          const { error } = await supabase.from('discount_codes').insert(batch)
          if (error) {
            console.error(`   ❌ Erro ao inserir batch: ${error.message}`)
            // Try one by one to find duplicates
            for (const code of batch) {
              const { error: singleError } = await supabase.from('discount_codes').insert(code)
              if (singleError) {
                console.error(`      ⚠️  ${code.code}: ${singleError.message}`)
              }
            }
          }
        }
      }

      allCodes.push(...codes)
      totalGenerated += codes.length
      console.log(`   ✅ ${campaign.label}: ${codes.length} cupons`)
      console.log(`      Exemplo: ${codes[0].code}`)
    }
  }

  console.log('\n' + '═'.repeat(40))
  console.log(`📊 Total: ${totalGenerated} cupons gerados`)
  console.log(`   ${TIERS.length} tier(s) × ${CAMPAIGNS.length} faixas`)

  if (dryRun) {
    console.log('\n⚠️  DRY RUN — rode sem --dry-run para salvar no banco')
  } else {
    console.log('\n✅ Cupons salvos no banco com sucesso!')
  }

  // Export summary CSV
  if (!dryRun) {
    const csv = ['code,tier,percent_off']
    allCodes.forEach(c => csv.push(`${c.code},${c.tier},${c.percent_off}`))
    const fs = await import('fs')
    const path = `scripts/coupons-${new Date().toISOString().slice(0, 10)}.csv`
    fs.writeFileSync(path, csv.join('\n'))
    console.log(`\n📄 CSV exportado: ${path}`)
  }
}

main().catch(console.error)
