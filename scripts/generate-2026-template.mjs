#!/usr/bin/env node
/**
 * Gera o template do stickers-data.json para a Copa do Mundo 2026.
 *
 * 48 seleções, 12 grupos (A–L), 4 times por grupo.
 * Estrutura Panini estimada: ~20 figurinhas por seleção + seções especiais.
 *
 * USO:
 *   node scripts/generate-2026-template.mjs
 *
 * Depois preencha os player_name com os nomes reais do checklist Panini.
 * Rode `npm run seed` para popular o banco.
 */

import { writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── Grupos confirmados da Copa 2026 (48 seleções) ──
// Fonte: sorteio FIFA. Ajuste se houver mudanças.
const GROUPS = {
  'A': ['MAR', 'CRO', 'equipe_a3', 'equipe_a4'],
  'B': ['por', 'equipe_b2', 'equipe_b3', 'equipe_b4'],
  'C': ['equipe_c1', 'equipe_c2', 'equipe_c3', 'equipe_c4'],
  'D': ['equipe_d1', 'equipe_d2', 'equipe_d3', 'equipe_d4'],
  'E': ['equipe_e1', 'equipe_e2', 'equipe_e3', 'equipe_e4'],
  'F': ['equipe_f1', 'equipe_f2', 'equipe_f3', 'equipe_f4'],
  'G': ['equipe_g1', 'equipe_g2', 'equipe_g3', 'equipe_g4'],
  'H': ['equipe_h1', 'equipe_h2', 'equipe_h3', 'equipe_h4'],
  'I': ['equipe_i1', 'equipe_i2', 'equipe_i3', 'equipe_i4'],
  'J': ['equipe_j1', 'equipe_j2', 'equipe_j3', 'equipe_j4'],
  'K': ['equipe_k1', 'equipe_k2', 'equipe_k3', 'equipe_k4'],
  'L': ['equipe_l1', 'equipe_l2', 'equipe_l3', 'equipe_l4'],
}

// ── Nomes completos das seleções (code → nome em PT-BR) ──
// Preencha os códigos FIFA corretos das 48 seleções classificadas
const COUNTRY_NAMES = {
  // Sedes
  'USA': 'Estados Unidos',
  'MEX': 'México',
  'CAN': 'Canadá',
  // Cabeças de chave prováveis
  'BRA': 'Brasil',
  'ARG': 'Argentina',
  'FRA': 'França',
  'ENG': 'Inglaterra',
  'ESP': 'Espanha',
  'GER': 'Alemanha',
  'POR': 'Portugal',
  'NED': 'Holanda',
  'BEL': 'Bélgica',
  'CRO': 'Croácia',
  'URU': 'Uruguai',
  'COL': 'Colômbia',
  'JPN': 'Japão',
  'KOR': 'Coreia do Sul',
  'AUS': 'Austrália',
  'MAR': 'Marrocos',
  'SEN': 'Senegal',
  'IRN': 'Irã',
  'SRB': 'Sérvia',
  'SUI': 'Suíça',
  'DEN': 'Dinamarca',
  'POL': 'Polônia',
  'WAL': 'País de Gales',
  'AUT': 'Áustria',
  'TUR': 'Turquia',
  'UKR': 'Ucrânia',
  'SCO': 'Escócia',
  'CRC': 'Costa Rica',
  'PAN': 'Panamá',
  'HON': 'Honduras',
  'JAM': 'Jamaica',
  'ECU': 'Equador',
  'PAR': 'Paraguai',
  'CHI': 'Chile',
  'PER': 'Peru',
  'BOL': 'Bolívia',
  'VEN': 'Venezuela',
  'NGA': 'Nigéria',
  'GHA': 'Gana',
  'CMR': 'Camarões',
  'EGY': 'Egito',
  'TUN': 'Tunísia',
  'ALG': 'Argélia',
  'KSA': 'Arábia Saudita',
  'QAT': 'Catar',
  'CHN': 'China',
  'IDN': 'Indonésia',
  'IND': 'Índia',
  'NZL': 'Nova Zelândia',
  'FIFA': 'FIFA',
}

// ── Gerar figurinhas ──

const stickers = []
let globalIndex = 1

// 1. Seção FIFA / Introdução (~10-15 figurinhas)
const introStickers = [
  { name: 'FIFA Logo', type: 'special' },
  { name: 'Trophy', type: 'trophy' },
  { name: 'Official Ball', type: 'special' },
  { name: 'Official Mascot', type: 'special' },
  { name: 'Official Poster', type: 'special' },
  { name: 'FIFA Fair Play', type: 'special' },
]
for (const s of introStickers) {
  stickers.push({
    number: `FIFA-${globalIndex}`,
    player_name: s.name,
    country: 'FIFA',
    section: 'Introduction',
    type: s.type,
    edition: '2026',
  })
  globalIndex++
}

// 2. Estádios (~16 estádios na Copa 2026)
const stadiums = [
  'MetLife Stadium (New York/New Jersey)',
  'AT&T Stadium (Dallas)',
  'Hard Rock Stadium (Miami)',
  'NRG Stadium (Houston)',
  'SoFi Stadium (Los Angeles)',
  'Lumen Field (Seattle)',
  'Lincoln Financial Field (Philadelphia)',
  'Mercedes-Benz Stadium (Atlanta)',
  'Levi\'s Stadium (San Francisco)',
  'Arrowhead Stadium (Kansas City)',
  'Gillette Stadium (Boston)',
  'Estadio Azteca (Mexico City)',
  'Estadio BBVA (Monterrey)',
  'Estadio Akron (Guadalajara)',
  'BMO Field (Toronto)',
  'BC Place (Vancouver)',
]
for (const name of stadiums) {
  stickers.push({
    number: `FIFA-${globalIndex}`,
    player_name: name,
    country: 'FIFA',
    section: 'Stadiums',
    type: 'stadium',
    edition: '2026',
  })
  globalIndex++
}

// 3. Seleções por grupo
// Estrutura Panini por seleção: 1 badge + 1 team photo + 18 jogadores = 20 figurinhas
const PLAYERS_PER_TEAM = 18

for (const [groupLetter, teams] of Object.entries(GROUPS)) {
  const section = `Group ${groupLetter}`

  for (const code of teams) {
    const upperCode = code.toUpperCase()
    let stickerNum = 1

    // Badge/Escudo
    stickers.push({
      number: `${upperCode}-${stickerNum}`,
      player_name: 'Emblem',
      country: COUNTRY_NAMES[upperCode] || upperCode,
      section,
      type: 'badge',
      edition: '2026',
    })
    stickerNum++

    // Team Photo
    stickers.push({
      number: `${upperCode}-${stickerNum}`,
      player_name: 'Team Photo',
      country: COUNTRY_NAMES[upperCode] || upperCode,
      section,
      type: 'special',
      edition: '2026',
    })
    stickerNum++

    // Jogadores (placeholder — preencher com nomes reais)
    for (let p = 1; p <= PLAYERS_PER_TEAM; p++) {
      stickers.push({
        number: `${upperCode}-${stickerNum}`,
        player_name: `Jogador ${p}`,  // ← SUBSTITUIR pelo nome real
        country: COUNTRY_NAMES[upperCode] || upperCode,
        section,
        type: 'player',
        edition: '2026',
      })
      stickerNum++
    }
  }
}

// ── Salvar ──
const outPath = resolve(__dirname, '..', 'stickers-data-2026-template.json')
writeFileSync(outPath, JSON.stringify(stickers, null, 2), 'utf-8')

console.log(`✅ Template gerado: ${outPath}`)
console.log(`   Total de figurinhas: ${stickers.length}`)
console.log(`   Seções especiais: ${introStickers.length + stadiums.length}`)
console.log(`   Seleções: ${Object.values(GROUPS).flat().length}`)
console.log(`   Figurinhas por seleção: ${2 + PLAYERS_PER_TEAM} (1 badge + 1 team photo + ${PLAYERS_PER_TEAM} jogadores)`)
console.log(`\n⚠️  PRÓXIMOS PASSOS:`)
console.log(`   1. Atualize GROUPS com os grupos reais do sorteio FIFA`)
console.log(`   2. Substitua os códigos placeholder (equipe_xx) pelos códigos FIFA corretos`)
console.log(`   3. Substitua "Jogador N" pelos nomes reais do checklist Panini`)
console.log(`   4. Renomeie para stickers-data.json e rode: npm run seed`)
