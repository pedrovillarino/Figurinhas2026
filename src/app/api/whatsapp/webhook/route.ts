import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { createClient } from '@supabase/supabase-js'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { sendText, sendButtonList, formatPhone, maskPhone, type ButtonOption } from '@/lib/zapi'
import { normalizePhoneBR } from '@/lib/phone'
import { trackEvent, trackEventOnce, FUNNEL_EVENTS } from '@/lib/funnel'
import { runAgent, recordBotMessage, getLastBotContext, sendBotTextFor } from '@/lib/whatsapp-agent'
import { escalateToSupport, submitUnknownSuggestion } from '@/lib/support'
import { expandCountryNamesToCodes, convertSpelledNumbersToDigits, collapseSpelledLetters } from '@/lib/country-codes'
import { createUserViaWhatsApp, isValidEmail, normalizeEmail } from '@/lib/whatsapp-register'
import { checkRateLimit, getIp, webhookLimiter } from '@/lib/ratelimit'
import { backgroundHealthPing } from '@/lib/health-ping'
import { getAudioLimit, TIER_CONFIG, type Tier } from '@/lib/tiers'
import { getQuotas, buildPaywallMessage } from '@/lib/whatsapp-quotas'
import { tryAcquireScanLock, releaseScanLock } from '@/lib/scan-lock'
import { enqueueImage, dequeueNextImage, getQueueLength, clearQueue } from '@/lib/image-queue'
import { awardScanPointsForToday, awardFirstScanIfNew, checkAndRegisterUnlocks } from '@/lib/liga'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://www.completeai.com.br').trim()

// ─── Admin Supabase client (service role) ───
function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// ─── Gemini client ───
function getGemini() {
  return new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
}

// ─── Intent detection prompt (Gemini instead of GPT-4o mini) ───
const INTENT_SYSTEM = `You are an intent classifier for a Panini sticker album WhatsApp bot. Users
write informally in Brazilian Portuguese: abbreviations ("vc", "tb", "obg"),
slang ("massa", "show", "dahora", "blz"), typos ("falando" for "faltando"),
and missing accents are normal. Be VERY generous when matching intents — only
return "unknown" if you genuinely cannot guess.

Return ONLY valid JSON:
{
  "intent": "status|missing|duplicates|owned|inventory_ambiguous|trades|ranking|register|help|unknown",
  "confidence": 0.95,
  "response_hint": "brief note about what the user wants"
}

Intent definitions:
- status: user wants their collection progress/stats. Examples:
  "status", "progresso", "quanto tenho", "quanto ja completei", "quanto que ta",
  "ja peguei quanto", "meu album", "como ta", "como esta", "ta como"
- missing: user wants list of stickers they still need. Examples:
  "faltando", "faltam", "que falta", "o que falta", "oque ta faltando", "preciso",
  "necessito", "minhas faltantes", "tô precisando", "cade o que falta"
- duplicates: user wants list of sticker duplicates SPECIFICALLY (the ones they
  have extras of, for trading). Examples:
  "repetidas", "minhas repe", "minhas dupes", "duplicatas", "que sobrou",
  "pra trocar", "o que tenho a mais", "as repetidinhas", "tenho repetida",
  "minhas a mais"
- owned: user wants list of stickers they ALREADY HAVE PASTED in the album
  (only stickers they own at least 1 copy of, including duplicates). Examples:
  "coladas", "minhas coladas", "lista das coladas", "que ja colei",
  "o que ta no album", "que ja peguei e colei", "ja peguei essa", "as do album"
- inventory_ambiguous: user asks vaguely about what they have but does NOT
  specify whether they want duplicates or pasted/owned. We must ask back which
  one. Examples (BE GENEROUS HERE — when ambiguous, prefer this over guessing):
  "quais tenho", "quais eu tenho", "o que eu tenho", "o que tenho",
  "tenho o que", "minhas figurinhas", "lista das minhas", "minhas",
  "as que tenho", "tenho quais"
- trades: user wants to see pending trade requests/notifications. Examples:
  "trocas", "trocas pendentes", "pendentes", "alguem quer trocar",
  "tem solicitação", "minhas trocas", "novas trocas", "recebi pedido"
- ranking: user wants ranking position. Examples:
  "ranking", "posicao", "colocacao", "placar", "como to no ranking",
  "qual minha posicao", "to em qual lugar"
- register: user is typing sticker codes to register. Examples:
  "BRA-1 BRA-5 ARG-3", "bra 1, bra 5, arg 3", "BRA1 BRA5", "FRA10 ESP3 POR1".
  Triggers when message contains a sequence of country-code + number.
- help: greetings, questions about how the bot works, asking for plans/pricing,
  giving feedback/suggestions/bug reports. Examples:
  "oi", "ola", "olá", "bom dia", "ajuda", "me ajuda", "menu", "comandos", "o que vc faz",
  "como funciona", "qual o preço", "tem plano", "sugestão", "ideia", "bug", "problema",
  "obrigado", "valeu", "thanks", "show de bola"
- unknown: ONLY if the message is unrelated (e.g. a random URL, a question about
  a totally different topic). When in doubt, prefer "help" so the user gets a menu.`

// ─── Sticker scan prompt (same as /api/whatsapp/scan) ───
const SCAN_INSTRUCTION = `Você é um scanner de figurinhas Panini da Copa do Mundo FIFA 2026 (edição USA/Canadá/México).

COMO LER UMA FIGURINHA PANINI:
- O NOME DO JOGADOR está em letras grandes na parte inferior (ex: "NEYMAR JR", "CASEMIRO", "MARQUINHOS")
- O CÓDIGO DO PAÍS (3 letras) está perto da bandeira (ex: "BRA", "ARG", "FRA")
- ⚠️ NÃO confunda: ano de 4 dígitos (2010, 2019) = ano de estreia, NÃO é número da figurinha. Altura/peso também NÃO.
- O NÚMERO DA FIGURINHA tem formato CÓDIGO-NÚMERO (ex: "BRA 17"). Se não conseguir ver, deixe "" — o sistema encontra pelo nome.

⚠️ VERSO DE FIGURINHA: tem texto "FIFA OFFICIAL LICENSED PRODUCT" + Panini + número em pequeno num canto. Se conseguir ler número → face="back", number="PAIS-N". Se NÃO ler número → 0 figurinhas (NÃO chute FWC-0 só pelo fundo foil).

⚠️ SÍMBOLOS (NÃO SÃO JOGADORES — figurinhas que você precisa RECONHECER VISUALMENTE):

Cada um dos 48 PAÍSES tem 2 símbolos fixos:
- {PAIS}-1: ESCUDO. LEIA AS LETRAS pra identificar país. player_name "Emblem". Acrônimos chave: CBF=Brasil, AFA=Argentina, FFF=França, DFB=Alemanha, RFEF=Espanha, FA=Inglaterra, FPF=Portugal, KNVB=Holanda, HNS=Croácia, KBVB=Bélgica, AUF=Uruguai, FCF=Colômbia, FEF=Equador, APF=Paraguai, FMF=México, USSF=USA, FRMF=Marrocos, EFA=Egito, FSF=Senegal, FAF=Argélia, FTF=Tunísia, FIF=C.Marfim, GFA=Gana, FECOFA=R.D.Congo, SAFA=África Sul, SAFF=Arábia Saudita, JFA=Jordan E Japão (visuais diferentes), QFA=Catar, UFA=Uzbequistão, KFA=Coreia, FFA=Austrália, NZF=N.Zelândia, TFF=Turquia, FAČR=Tchéquia, FSBiH=Bósnia, NFF=Noruega, SvFF=Suécia, SFV=Suíça, ÖFB=Áustria, SFA=Escócia, FEPAFUT=Panamá, FHF=Haiti, FFK=Curaçao, FFIRI=Irã, IFA=Iraque. Cuidado escudos parecidos: NOR/SUI (cruz branca em vermelho — NOR tem NORGE escrito), AUT/TUN/GHA (águia, distintas), POR/PER (mesma sigla FPF, escudos diferentes), JFA Japão (corvo) vs Jordan (falcão).
- {PAIS}-13 (13ª figurinha): foto do TIME juntos posando — fileira de 22+ jogadores de pé/agachados em campo → player_name "Team Photo"

Descrições visuais detalhadas (escudos confundíveis):
- RSA-1 (SAFA África do Sul): retângulo BRANCO com BOLA preto-e-branca à ESQUERDA + MAPA DOURADO/MARROM (continente africano OU contorno África do Sul) à DIREITA. Texto "FIFA WORLD CUP 2026" no topo. Logo "PANINI" amarelo embaixo. Fundo HOLOGRÁFICO/FOIL prismático (vermelho/verde/azul/roxo). ⚠️ NÃO CONFUNDIR com FWC-0 "We are Panini" — FWC-0 tem foto de jogador chutando de bicicleta. RSA-1 tem só bola+mapa abstratos. Se ver bola+mapa = RSA-1.
- BRA-1 (CBF Brasil): ÓVALO/CÍRCULO BRANCO com escudo CBF AZUL-MARINHO + cruz amarela em X + "CBF" branco. CINCO ESTRELAS AMARELAS em arco no topo. "BRASIL" em VERDE embaixo. Faixas diagonais verde+amarelo+azul. Texto "FIFA WORLD CUP 2026" branco no topo. Fundo PRATA FOIL HOLOGRÁFICO com "Panini" repetido.

Seção FIFA WORLD CUP (FWC-0 a FWC-19):
- FWC-0: "We are Panini" — figurinha FOIL/HOLOGRÁFICA com fundo prismático colorido, foto de JOGADOR REAL chutando de bicicleta, logo "PANINI" amarelo embaixo. ⚠️ Se a figurinha NÃO TEM jogador chutando, NÃO É FWC-0. ⚠️ O álbum imprime "00" no slot dela — se ver "00", é FWC-0.
- FWC-1: "Taça Oficial (parte de cima)" — figurinha da PARTE SUPERIOR da taça FIFA (estatueta dourada brilhante: figura humana segurando o globo dourado no topo). Recorte da metade de cima da taça
- FWC-2: "Taça Oficial (parte de baixo)" provável — PARTE INFERIOR da taça (base dourada + texto "FIFA WORLD CUP" gravado). Recorte da metade de baixo, complementa FWC-1
- FWC-3: "Mascote Oficial" — DESENHO CARTOON ANIMADO dos 3 mascotes JUNTOS (ZAYU lhama amarela, MAPLE alce vermelho, CLUTCH águia branco-preta). NÃO é foto real. Se NÃO tem mascotes cartoon, NÃO é FWC-3.
- FWC-4: "Troféu Oficial" — FOIL HOLOGRÁFICO multicolor (verde/azul/roxo/vermelho iridescente). Troféu ESTILIZADO em VERDE no centro (silhueta, NÃO a estatueta dourada da FWC-1/2). Texto "FIFA" pequeno topo-esquerdo. Logo Panini embaixo. ⚠️ NÃO confunda com FWC-0 (jogador chutando), FWC-1/2 (taça dourada), FWC-6/7/8 (fundo sólido + CAN MEX USA).
- FWC-5: "TRIONDA - Bola Oficial" — figurinha FOIL/HOLOGRÁFICA da bola TRIONDA: bola colorida (branca + azul + vermelha + verde) com logo FIFA visível na lateral, em campo gramado, fundo escuro com efeito brilhoso
- FWC-6: "Taça Canadá" — TAÇA DOURADA em fundo VERMELHO + texto "FIFA WORLD CUP 2026 CAN MEX USA". É homenagem ao país-sede.
- FWC-7: "Taça México" — TAÇA DOURADA em fundo VERDE + texto "FIFA WORLD CUP 2026 CAN MEX USA"
- FWC-8: "Taça USA" — TAÇA DOURADA em fundo AZUL + texto "FIFA WORLD CUP 2026 CAN MEX USA"
- ⚠️ NÃO CONFUNDIR FWC-6/7/8 (taça com fundo colorido sólido + "CAN MEX USA") com FWC-1/2/4 (também tem taça mas sem texto CAN MEX USA).
- FWC-9 a FWC-19: SÉRIE HISTÓRICA "FIFA MUSEUM". FOTO COLORIDA (não P&B/sépia) do time campeão posando em fileira. Embaixo faixa MARROM/VINHO ESCURO com logo "FIFA MUSEUM" à esquerda + NOME DO PAÍS em letras brancas grandes + ANO no canto direito. Bordas PRATA FOIL HOLOGRÁFICO com "Panini" repetido. Exemplos: "ARGENTINA 1986", "BRAZIL 1994", "URUGUAY 1950", "ITALY 2006", "GERMANY 2014", "ARGENTINA 2022". player_name = "{Campeão} {Ano}". NÃO é nome de jogador.

REGRAS GERAIS:
- CRÍTICO: Leia o nome EXATO. "MARQUINHOS" ≠ "NEYMAR JR" ≠ "CASEMIRO".
- CRÍTICO: Se há DUAS cópias da mesma figurinha, liste CADA uma separadamente.
- Países em Português ("Brasil", "Argentina") exceto "FIFA" pra seção FIFA World Cup.
- Se a figurinha tem só LOGO ou MASCOTE ou TROFÉU ou BOLA — é símbolo, não chute nome de jogador.

Retorne APENAS JSON:
{
  "pages_detected": 1,
  "scan_confidence": 0.9,
  "stickers": [
    {"number": "BRA-17", "player_name": "Neymar Jr", "country": "Brasil", "status": "filled", "confidence": 0.95},
    {"number": "BRA-1", "player_name": "Emblem", "country": "Brasil", "status": "filled", "confidence": 0.99},
    {"number": "FWC-3", "player_name": "Mascote Oficial", "country": "FIFA", "status": "filled", "confidence": 0.99},
    {"number": "FWC-15", "player_name": "Brazil 1994", "country": "FIFA", "status": "filled", "confidence": 0.95}
  ],
  "unreadable": [],
  "warnings": []
}`

// ─── Welcome message for unknown users ───
function getWelcomeMessage(phone: string) {
  // Email-first flow (Pedro pediu 2026-05-02): se email já tiver cadastro,
  // a gente só vincula o phone e libera tudo. Se for user novo, aí sim
  // pede o nome. Reduz atrito ao mínimo: 1 mensagem pra users existentes.
  return `Olá! 👋 Sou o assistente do *Complete Aí* ⚽

Aqui você escaneia suas figurinhas com IA, fica sabendo das *trocas perto de você* e completa o álbum mais rápido.

Não achei seu cadastro pelo seu número — ou você ainda não cadastrou, ou só não vinculou seu WhatsApp ainda. Tudo bem, podemos continuar por aqui!

*Me passa seu email?* 📧

📱 _Se preferir, cadastro completo no site: ${APP_URL}/register?phone=${phone}_`
}

// ─── Find user by phone ───
/**
 * Generate all reasonable variants of a Brazilian phone number to handle
 * the "ninth digit" problem: ANATEL added a leading "9" to mobile numbers
 * (2012-2016), but Z-API and various clients aren't consistent about
 * including it. A user might have registered with "5551991841073" (13 digits,
 * with 9) and message us with "555191841073" (12 digits, without 9), or
 * vice-versa. We try both to find the profile.
 */
function brazilianPhoneVariants(phone: string): string[] {
  const variants = new Set<string>([phone])
  const digits = phone.replace(/\D/g, '')
  variants.add(digits)
  variants.add(digits.replace(/^55/, ''))
  variants.add(`+${digits}`)
  variants.add(`+55${digits.replace(/^55/, '')}`)

  // Distinguish formats by total digit length (regex on content gave false
  // positives — e.g. "555191841073" without 9-inicial has a "9" at pos 4
  // that's part of the regular number "91841073", not a 9-inicial marker).
  // Rule: brazilian numbers are deterministic by length when DDI/9 are
  // present or absent.
  //
  // 13 digits, "55" + DDD + "9" + 8-digit number → strip the 9
  if (digits.length === 13 && digits.startsWith('55')) {
    const ddd = digits.slice(2, 4)
    const num = digits.slice(5) // skip the 9
    variants.add(`55${ddd}${num}`)
    variants.add(`${ddd}${num}`)
  }
  // 12 digits, "55" + DDD + 8-digit number (no 9) → add a 9
  if (digits.length === 12 && digits.startsWith('55')) {
    const ddd = digits.slice(2, 4)
    const num = digits.slice(4)
    variants.add(`55${ddd}9${num}`)
    variants.add(`${ddd}9${num}`)
  }
  // 11 digits, no DDI, "DDD + 9 + 8 digits" → strip the 9 + add DDI variants
  if (digits.length === 11) {
    const ddd = digits.slice(0, 2)
    const num = digits.slice(3) // skip the 9
    variants.add(`${ddd}${num}`)
    variants.add(`55${ddd}${num}`)
    variants.add(`55${ddd}9${num}`)
  }
  // 10 digits, no DDI, "DDD + 8 digits" → add 9 + add DDI variants
  if (digits.length === 10) {
    const ddd = digits.slice(0, 2)
    const num = digits.slice(2)
    variants.add(`${ddd}9${num}`)
    variants.add(`55${ddd}9${num}`)
    variants.add(`55${ddd}${num}`)
  }

  return Array.from(variants).filter(Boolean)
}

async function findUserByPhone(phone: string) {
  const supabase = getAdmin()
  const variants = brazilianPhoneVariants(phone)
  // Single query with IN clause — more efficient than N round-trips and
  // tolerant when the same user appears with multiple phone formats in DB
  const { data } = await supabase
    .from('profiles')
    .select('id, display_name, phone, tier')
    .in('phone', variants)
    .limit(1)
  return data && data.length > 0 ? data[0] : null
}

// ─── Diagnostic log for phones that DON'T match (Pedro 2026-05-03) ───
// Caso Gabriele (Conta Comercial WhatsApp): phone bate exato com DB mas
// findUserByPhone falhou. Hipótese: Z-API entrega formato peculiar pra
// Business accounts. Este log captura o phone NÃO-mascarado SÓ no caso
// de não-match, pra diagnosticar o formato real entregue pelo Z-API.
// REMOVER APÓS DIAGNOSTICAR (estimativa: 24-48h coletando casos).
async function logUnrecognizedPhone(phone: string, body: Record<string, unknown>): Promise<void> {
  const variants = brazilianPhoneVariants(phone)
  // Tenta ver se o user EXISTE no DB com qualquer phone parecido
  const supabase = getAdmin()
  const last7 = phone.replace(/\D/g, '').slice(-7)
  const { data: similar } = await supabase
    .from('profiles')
    .select('phone, email')
    .like('phone', `%${last7}`)
    .limit(3)

  console.error('[WA_DIAG_NOMATCH]', JSON.stringify({
    phone_raw: phone,                // EXATO o que Z-API entregou
    phone_digits: phone.replace(/\D/g, ''),
    phone_length: phone.replace(/\D/g, '').length,
    variants_tried: variants,
    body_phone: body.phone,
    body_isBusiness: body.isBusiness,
    body_isGroup: body.isGroup,
    body_fromMe: body.fromMe,
    body_senderPhone: body.senderPhone,
    body_connectedPhone: body.connectedPhone,
    body_keys: Object.keys(body),
    similar_in_db: similar,
    timestamp: new Date().toISOString(),
  }))
}

/**
 * Returns true if the user has any active (non-expired) pending_scan.
 * Used to serialize the WhatsApp scan/register flow — Pedro pediu
 * (2026-05-02) que o bot processe um registro por vez. Se já tem um
 * pendente, a próxima foto/áudio/texto é segurada com aviso.
 */
async function hasActivePendingScan(userId: string): Promise<boolean> {
  const supabase = getAdmin()
  const { data } = await supabase
    .from('pending_scans')
    .select('id')
    .eq('user_id', userId)
    .gt('expires_at', new Date().toISOString())
    .limit(1)
  return !!(data && data.length > 0)
}

/**
 * Quantos itens estão num pending_scan ativo do user. Retorna 0 se não tem.
 * Usado pra adaptar a mensagem WAIT_PENDING (omite "TIRAR" quando tem 1 item só).
 */
async function countPendingScanItems(userId: string): Promise<number> {
  const supabase = getAdmin()
  const { data } = await supabase
    .from('pending_scans')
    .select('scan_data')
    .eq('user_id', userId)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
  if (!data || data.length === 0) return 0
  const scanData = (data[0] as { scan_data?: unknown[] }).scan_data
  return Array.isArray(scanData) ? scanData.length : 0
}

/**
 * Mensagem "espera registro pendente" adaptativa:
 * - 1 item: oferece só SIM/NÃO (TIRAR não faz sentido)
 * - 2+ itens: também oferece TIRAR <número> com exemplo concreto
 *
 * Pedro 2026-05-03 (caso Joao Gabriel): user respondeu literalmente
 * "TIRAR N" porque o N parecia parte do comando. Trocamos pra exemplo
 * com número de verdade.
 */
// Pedro 2026-05-04 (caso Pedro Arcari): user mandou 3 mensagens em sequência
// e o bot enviou a msg "Você ainda tem registro aguardando" 3x — flood. Esse
// throttle por user evita repetir a mesma orientação em < 30s.
const recentWaitPendingSent = new Map<string, number>()
const WAIT_PENDING_DEDUP_MS = 30 * 1000

function shouldSendWaitPending(userId: string): boolean {
  const now = Date.now()
  const last = recentWaitPendingSent.get(userId) || 0
  if (now - last < WAIT_PENDING_DEDUP_MS) return false
  recentWaitPendingSent.set(userId, now)
  // GC simples — limpa entradas antigas se o map crescer
  if (recentWaitPendingSent.size > 200) {
    const cutoff = now - WAIT_PENDING_DEDUP_MS
    recentWaitPendingSent.forEach((t, k) => {
      if (t < cutoff) recentWaitPendingSent.delete(k)
    })
  }
  return true
}

// Pedro 2026-05-10 (caso Danilo): cooldown de 6h pra resposta automática
// "paguei boleto". Boleto compensa em 2-3 dias úteis, então não faz sentido
// responder mais que 1x por turno. In-memory (cold start de Vercel reseta —
// ok pra MVP, evita spam dentro de uma sessão).
const recentBoletoResponse = new Map<string, number>()
const BOLETO_RESPONSE_COOLDOWN_MS = 6 * 60 * 60 * 1000

function shouldSendBoletoResponse(userId: string): boolean {
  const now = Date.now()
  const last = recentBoletoResponse.get(userId) || 0
  if (now - last < BOLETO_RESPONSE_COOLDOWN_MS) return false
  recentBoletoResponse.set(userId, now)
  if (recentBoletoResponse.size > 200) {
    const cutoff = now - BOLETO_RESPONSE_COOLDOWN_MS
    recentBoletoResponse.forEach((t, k) => {
      if (t < cutoff) recentBoletoResponse.delete(k)
    })
  }
  return true
}

/**
 * Pedro 2026-05-04 (caso Vinicius): pendings podem ser paralelos (foto+texto+
 * áudio em sequência rápida). Mensagem agregada agrupa por origem
 * ("📸 Registro 1 — foto: ..., ✏️ Registro 2 — texto: ...") e dá opções
 * de cancelar registro inteiro OU item específico.
 *
 * Items são numerados GLOBALMENTE (1..N atravessando os pendings na ordem
 * de criação). "tirar N" e "cancelar registro N" são manipulados separadamente.
 */
type PendingItem = { sticker_id: number; number: string; player_name: string; quantity: number }
type PendingScanRow = { id: number; scan_data: PendingItem[]; source: string | null; created_at: string }

function sourceLabel(source: string | null | undefined): { emoji: string; label: string } {
  switch (source) {
    case 'photo': return { emoji: '📸', label: 'foto' }
    case 'audio': return { emoji: '🎤', label: 'áudio' }
    case 'text': return { emoji: '✏️', label: 'texto' }
    default: return { emoji: '📋', label: 'registro' }
  }
}

function buildAggregatedPendingMsg(pendings: PendingScanRow[]): string {
  if (pendings.length === 0) return ''
  const totalItems = pendings.reduce((sum, p) => sum + (p.scan_data?.length || 0), 0)

  // Numeração global (1..N) ao longo da concatenação dos pendings
  let globalIdx = 0
  const blocks: string[] = []
  pendings.forEach((p, regIdx) => {
    const { emoji, label } = sourceLabel(p.source)
    const regNum = regIdx + 1
    const lines = (p.scan_data || []).map((s) => {
      globalIdx++
      const qtyLabel = s.quantity > 1 ? ` (x${s.quantity})` : ''
      return `   *${globalIdx}.* ${s.number}${s.player_name ? ' — ' + s.player_name : ''}${qtyLabel}`
    })
    blocks.push(`${emoji} *Registro ${regNum}* — ${label}:\n${lines.join('\n')}`)
  })

  let msg = pendings.length === 1
    ? `📋 *${totalItems} figurinha(s) aguardando confirmação:*\n\n`
    : `📋 *${pendings.length} registros aguardando confirmação* (${totalItems} itens):\n\n`
  msg += blocks.join('\n\n')
  msg += `\n\n✅ *SIM* → registra todos (${totalItems} itens)`
  if (totalItems >= 2) {
    msg += `\n✏️ *TIRAR 1* → remove só o item 1 (troque pelo número que quer remover)`
  }
  if (pendings.length > 1) {
    msg += `\n🗑️ *CANCELAR REGISTRO 1* → remove só os itens do registro 1 (troque o número)`
  }
  msg += `\n❌ *NÃO* → cancela tudo`
  return msg
}

function buildWaitPendingMsg(itemCount: number): string {
  const head = '⏳ *Você ainda tem um registro aguardando confirmação.*\n\n' +
    'Responde primeiro a anterior:\n'
  const tail = '\n\n_Depois eu processo essa nova mensagem._'
  if (itemCount <= 1) {
    return head +
      '✅ *SIM* → registra\n' +
      '❌ *NÃO* → cancela' +
      tail
  }
  const exampleN = Math.min(itemCount, 3)
  return head +
    `✅ *SIM* → registra os ${itemCount} itens\n` +
    `✏️ *TIRAR ${exampleN}* → remove o item ${exampleN} (troque pelo número que quer remover)\n` +
    '❌ *NÃO* → cancela' +
    tail
}

/**
 * Pedro 2026-05-03 (Fix H — sugestão dele): se a primeira mensagem do user
 * já contém o email dele (ex: "oi sou Pedro (email: pedro@example.com)"),
 * tentamos auto-vincular o WhatsApp à conta existente sem passar por todo
 * o fluxo de registro. Site terá CTA "Conectar WhatsApp" que pré-popula
 * essa mensagem via `wa.me/?text=...`.
 *
 * Retorna o profile vinculado se sucesso, null se:
 *  - mensagem não tem email
 *  - email não corresponde a nenhum profile
 *  - ou erro ao atualizar
 *
 * IMPORTANTE: também atualiza phone se já existia outro (user está se
 * identificando ativamente — esse phone novo é mais confiável que o velho).
 */
async function tryAutoLinkByEmailInMessage(
  phone: string,
  text: string,
): Promise<{ id: string; display_name: string | null; phone: string | null; tier: string } | null> {
  if (!text) return null
  // Extrai primeiro email da mensagem (regex permissivo mas razoável)
  const emailMatch = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)
  if (!emailMatch) return null
  const email = emailMatch[0].toLowerCase().trim()

  const supabase = getAdmin()
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, display_name, phone, tier')
    .eq('email', email)
    .maybeSingle()

  if (!profile) return null

  const digitsPhone = phone.replace(/\D/g, '')
  // Atualiza phone (mesmo que já tenha um diferente — user está se
  // identificando ativamente, então esse phone é mais confiável).
  await supabase
    .from('profiles')
    .update({ phone: digitsPhone })
    .eq('id', profile.id)

  console.log(`[WA_AUTO_LINK] Linked phone=${maskPhone(phone)} to existing email=${email.slice(0, 3)}***`)
  return { ...profile, phone: digitsPhone }
}

/**
 * Pedro 2026-05-04 (caso Enzo): user clicou em deep-link wa.me dentro do
 * site (logado) → mensagem chegou com `[link:TOKEN]` no final. Token foi
 * gerado por /api/whatsapp/link-token e está atrelado ao user_id. Aqui
 * a gente extrai, valida (não expirado, não usado), vincula o phone ao
 * user e marca o token como consumido.
 *
 * Returns o profile linkado (igual tryAutoLinkByEmailInMessage) ou null.
 */
async function tryAutoLinkByTokenInMessage(
  phone: string,
  text: string,
): Promise<{ id: string; display_name: string | null; phone: string | null; tier: string } | null> {
  if (!text) return null
  const tokenMatch = text.match(/\[link:([a-f0-9]{8,32})\]/i)
  if (!tokenMatch) return null
  const token = tokenMatch[1].toLowerCase()

  const supabase = getAdmin()
  const { data: tokenRow } = await supabase
    .from('wa_link_tokens')
    .select('user_id, expires_at, used_at')
    .eq('token', token)
    .maybeSingle()

  if (!tokenRow) {
    console.warn(`[WA_TOKEN_LINK] Token not found: ${token.slice(0, 4)}***`)
    return null
  }
  if (tokenRow.used_at) {
    console.warn(`[WA_TOKEN_LINK] Token already used: ${token.slice(0, 4)}***`)
    return null
  }
  if (new Date(tokenRow.expires_at).getTime() < Date.now()) {
    console.warn(`[WA_TOKEN_LINK] Token expired: ${token.slice(0, 4)}***`)
    return null
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, display_name, phone, tier')
    .eq('id', tokenRow.user_id)
    .maybeSingle()

  if (!profile) return null

  const digitsPhone = phone.replace(/\D/g, '')
  // Vincula o phone à conta e marca o token como consumido (idempotente)
  await supabase.from('profiles').update({ phone: digitsPhone }).eq('id', profile.id)
  await supabase
    .from('wa_link_tokens')
    .update({ used_at: new Date().toISOString(), used_phone: digitsPhone })
    .eq('token', token)

  console.log(`[WA_TOKEN_LINK] Linked phone=${maskPhone(phone)} via token=${token.slice(0, 4)}***`)
  return { ...profile, phone: digitsPhone }
}

/** Remove o marker `[link:TOKEN]` do texto pra não poluir o resto do processamento. */
function stripLinkToken(text: string): string {
  return text.replace(/\s*\[link:[a-f0-9]{8,32}\]\s*/gi, ' ').trim()
}

/**
 * State machine pra cadastro inline via WhatsApp — fluxo email-first.
 *
 * Estados:
 *   awaiting_email → user envia email
 *                    ├── email já cadastrado E sem phone → vincula phone (FIM)
 *                    ├── email já cadastrado COM outro phone → manda pro site
 *                    └── email novo → avança pra awaiting_name
 *   awaiting_name  → user envia nome → cria conta com email+nome (FIM)
 *
 * Por que email-first: muitos users já cadastraram pelo site (Google/email)
 * mas sem associar phone. Pedindo email primeiro a gente reconhece esses
 * users em 1 mensagem só (auto-link). Só user 100% novo precisa dar nome.
 *
 * Aceite dos Termos: implicito ao continuar usando, registrado ao criar
 * conta (terms_accepted_at no profile).
 */
/**
 * Pedro 2026-05-04: após signup completar (auto-link OU conta nova),
 * se a 1ª mensagem original do user era uma dúvida/intenção, manda
 * follow-up direcionado em vez de só "boas-vindas genéricas".
 *
 * Heurísticas pra identificar a intenção (regex, sem custo de IA):
 *   - "áudio" → pede pra mandar áudio agora
 *   - "foto" → pede pra mandar foto
 *   - "texto" / códigos → pede pra mandar
 *   - default → ecoa a pergunta original e diz "manda de novo que eu respondo"
 */
async function sendPostSignupFollowUp(phone: string, pendingMessage: string | null): Promise<void> {
  if (!pendingMessage) return
  const lower = pendingMessage.toLowerCase().trim()

  // Pedro 2026-05-04: frases padrão de deep-link genérico ("Oi! Vim do meu
  // perfil/álbum/app") são SAUDAÇÕES, não perguntas. Welcome do bot já
  // cobre. NÃO ecoar.
  // Pedro 2026-05-07 (caso Mavi): a frase "oi sou X (email: y@z.com) [link:TOKEN]"
  // é a mensagem GERADA AUTOMATICAMENTE pelo deep-link do site (não é o user
  // perguntando algo). Bot estava ecoando como se fosse pergunta. Detectar
  // explicitamente esses padrões pra NÃO ecoar.
  const isGenericDeepLink =
    /^oi[!,.\s]*\s*vim\s+do\s+(meu\s+)?(perfil|[áa]lbum|app|site|scan|ranking|trocas?)/i.test(lower) ||
    /^oi[!,.\s]*\s*vim\s+do\s+(meu\s+)?app[,.]?\s+queria\s+conhecer/i.test(lower) ||
    /^oi[,!.\s]*\s*sou\s+\S+/i.test(lower) || // "oi sou João..."
    /\(email:\s*\S+@\S+\)/i.test(lower) ||      // "(email: x@y.com)"
    /\[link:[a-f0-9]+\]/i.test(lower)            // "[link:TOKEN]"
  if (isGenericDeepLink) return

  let followUp: string

  // Pedro 2026-05-04 (caso Vinicius): regex `\b[áa]udio\b` falhava com UTF-8
  // (word boundary em JS sem flag /u trata `á` como non-word). Usando
  // substring simples + fallback de "audio" sem acento. Cobre os 2 casos
  // (Gemini transcribe pode dar com ou sem acento).
  if (/[áa]udio/i.test(lower)) {
    followUp = `🎤 Você queria *registrar por áudio* — manda um áudio agora falando os códigos das figurinhas (ex: _"Brasil 1, Argentina 3, Marrocos 5"_) que eu transcrevo e registro!`
  } else if (/\b(foto|imagem|c[âa]mera|tirar foto)\b/i.test(lower)) {
    followUp = `📸 Você queria *registrar por foto* — manda agora uma foto bem iluminada das figurinhas que eu identifico e registro!`
  } else if (/\b(texto|c[oó]digo|escrever)\b/i.test(lower)) {
    followUp = `✏️ Você queria *registrar por texto* — manda os códigos tipo _"BRA-1 ARG-3 FRA-10"_ ou _"Brasil 1, Argentina 3"_ que eu registro!`
  } else if (/\btroca|trocar\b/.test(lower)) {
    followUp = `🔁 Você perguntou sobre *trocas* — abre as opções com *trocas* aqui, ou no site em ${APP_URL}/trades pra ver quem perto de você precisa do que você tem.`
  } else {
    // Default: ecoa a mensagem original (só pra perguntas reais)
    const truncated = pendingMessage.length > 100 ? pendingMessage.slice(0, 100) + '…' : pendingMessage
    followUp = `💬 Antes você me perguntou: _"${truncated}"_\n\nManda de novo se ainda quiser que eu responda — agora que tô conectado com sua conta posso ajudar melhor. ⚽`
  }

  await sendText(phone, followUp)
}

async function handleRegistrationFlow(phone: string, text: string): Promise<boolean> {
  if (!text) return false
  const supabase = getAdmin()

  const { data: pending } = await supabase
    .from('pending_registrations')
    .select('id, state, name, email, pending_message')
    .eq('phone', phone)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()

  if (!pending) return false

  const trimmed = text.trim()

  // ── Estado 1: aguardando email (primeiro contato) ──
  if (pending.state === 'awaiting_email') {
    if (!isValidEmail(trimmed)) {
      // Pedro 2026-05-03 (Bárbara case): se a mensagem nem tem @, é uma
      // frase tipo "vou cadastrar" — tom amigável, não acusador.
      // Se tem @ mas algo não bate, aí sim "esse email não tá certo".
      const hasAtSign = trimmed.includes('@')
      const friendlyMsg = hasAtSign
        ? `🤔 Esse email não tá no formato certo. Tem que ser tipo *seunome@gmail.com*.\n\nManda de novo?`
        : `Beleza, *${trimmed.length > 30 ? trimmed.slice(0, 30) + '…' : trimmed}* anotado! 😊\n\n` +
          `Pode mandar seu *email* aí no formato _seunome@gmail.com_? É rapidinho.`
      await sendText(phone, friendlyMsg)
      return true
    }
    const email = normalizeEmail(trimmed)
    const digitsPhone = phone.replace(/\D/g, '')

    // Cheque 1: já existe profile com esse email?
    const { data: existing } = await supabase
      .from('profiles')
      .select('id, display_name, phone')
      .eq('email', email)
      .maybeSingle()

    if (existing) {
      // Caso A: profile sem phone → AUTO-LINK do WhatsApp
      if (!existing.phone) {
        await supabase
          .from('profiles')
          .update({ phone: digitsPhone })
          .eq('id', existing.id)
        const pendingMsg = pending.pending_message
        await supabase.from('pending_registrations').delete().eq('id', pending.id)
        const firstName = (existing.display_name || '').split(' ')[0]
        await sendText(
          phone,
          `✅ *Achei seu cadastro${firstName ? `, ${firstName}` : ''}!* Conectei seu WhatsApp à conta. 🔓\n\n` +
            `Já pode usar tudo aqui:\n` +
            `📸 *Foto* das figurinhas — eu identifico com IA\n` +
            `🎤 *Áudio* falando os códigos\n` +
            `✏️ *Texto* tipo _"BRA-1 ARG-3"_ ou _"Brasil 1"_\n\n` +
            `Manda *menu* a qualquer hora pra ver tudo. ⚽`,
        )
        await sendPostSignupFollowUp(phone, pendingMsg)
        return true
      }
      // Caso B: profile já tem outro phone → manda pro site
      await supabase.from('pending_registrations').delete().eq('id', pending.id)
      await sendText(
        phone,
        `⚠️ Esse email *já está em uma conta* com outro número associado.\n\n` +
          `Se for você, entra no site (${APP_URL}/login) com esse email — recebe um link de acesso por lá. 🔗\n\n` +
          `Se não, manda *outro email* aqui (digita "começar" pra reiniciar).`,
      )
      return true
    }

    // Email é novo → avança pro nome
    await supabase
      .from('pending_registrations')
      .update({ email, state: 'awaiting_name', updated_at: new Date().toISOString() })
      .eq('id', pending.id)
    await sendText(
      phone,
      `Email anotado! 📧\n\n` +
        `Pra finalizar seu cadastro, *como devo te chamar?* 😊`,
    )
    return true
  }

  // ── Estado 2: aguardando nome (só pra user novo) ──
  if (pending.state === 'awaiting_name') {
    if (trimmed.length < 2 || !/[a-zA-ZÀ-ÿ]/.test(trimmed)) {
      await sendText(phone, `🤔 Hmm, não peguei seu nome. Manda só seu *primeiro nome* (ou nome completo).`)
      return true
    }
    const name = trimmed.slice(0, 80)
    const email = pending.email || ''

    if (!email) {
      // Estado inconsistente — reset
      await supabase.from('pending_registrations').delete().eq('id', pending.id)
      await sendText(phone, `Hmm, perdi sua sessão. Manda *oi* pra começar de novo.`)
      return true
    }

    // Cria conta com o email já validado + nome
    const result = await createUserViaWhatsApp({ phone, name, email })

    if (result.ok) {
      const pendingMsg = pending.pending_message
      await supabase.from('pending_registrations').delete().eq('id', pending.id)
      const firstName = name.split(' ')[0] || ''
      await sendText(
        phone,
        `✅ *Conta criada${firstName ? `, ${firstName}` : ''}!* 🎉\n\n` +
          `Já pode usar tudo aqui pelo WhatsApp:\n` +
          `📸 *Foto* das figurinhas — eu identifico com IA\n` +
          `🎤 *Áudio* falando os códigos (ex: _"Brasil 1, Argentina 3"_)\n` +
          `✏️ *Texto* — também aceita _"BRA-1 ARG-3"_\n\n` +
          `Manda *menu* a qualquer hora pra ver tudo que sei fazer.\n\n` +
          `Quando quiser entrar no site (${APP_URL}), faz login com esse email e te mando um link de acesso. 🔓\n\n` +
          `Bom proveito! ⚽\n\n` +
          `_Ao usar o serviço você aceita os Termos (${APP_URL}/termos) e a Privacidade (${APP_URL}/privacidade)._`,
      )
      await sendPostSignupFollowUp(phone, pendingMsg)
      return true
    }

    // Erro: criação falhou (Junior 2026-05-02). Pra evitar o user ficar
    // preso em loop tentando criar de novo, DELETAR o pending e oferecer
    // um caminho claro pelo site (já com nome+email pré-preenchidos).
    console.error('[register] createUserViaWhatsApp failed:', result)
    await supabase.from('pending_registrations').delete().eq('id', pending.id)
    const encodedEmail = encodeURIComponent(email)
    const encodedName = encodeURIComponent(name)
    await sendText(
      phone,
      `😔 Ops, deu um erro técnico criando sua conta agora.\n\n` +
        `Tenta o cadastro pelo site (rapidinho, com Google ou email):\n` +
        `👉 ${APP_URL}/register?phone=${phone}&email=${encodedEmail}&name=${encodedName}\n\n` +
        `Lá já vai aparecer seu email e nome preenchidos. Depois de cadastrar, manda *oi* aqui de novo que eu reconheço seu WhatsApp. ⚽`,
    )
    return true
  }

  return false
}

// ─── Get user stats ───
// Returns the X/980 album progress AND the per-color extras breakdown.
// Album progress only counts completable stickers; extras are tracked
// separately and serve as ranking tiebreaks (gold > silver > bronze >
// regular > coca-cola).
async function getUserStats(userId: string) {
  const supabase = getAdmin()

  const { count: totalStickers, error: totalErr } = await supabase
    .from('stickers')
    .select('*', { count: 'exact', head: true })
    .eq('counts_for_completion', true)
  if (totalErr) {
    // Pedro 2026-05-09 (caso Lorenzo): antes silenciava o erro e retornava
    // 980 default, fazendo o user ver "0/980" em vez do progresso real.
    // Agora propaga pro caller decidir como avisar.
    console.error(`[getUserStats] total stickers count FAILED user=${userId}:`, totalErr.message)
    throw new Error(`getUserStats: total count failed: ${totalErr.message}`)
  }

  // Pull every user_sticker once, joined with the sticker so we can count
  // both album progress and per-variant extras in the same pass.
  const { data: rows, error: rowsErr } = await supabase
    .from('user_stickers')
    .select('status, stickers!inner(counts_for_completion, variant, section)')
    .eq('user_id', userId)
    .in('status', ['owned', 'duplicate'])
  if (rowsErr) {
    // Mesmo motivo: antes a query falhava e a função retornava 0 owned —
    // user via "0 figurinhas" mesmo tendo um álbum cheio.
    console.error(`[getUserStats] user_stickers query FAILED user=${userId}:`, rowsErr.message)
    throw new Error(`getUserStats: user_stickers query failed: ${rowsErr.message}`)
  }

  const total = totalStickers || 980
  let owned = 0
  let duplicates = 0
  let extrasGold = 0
  let extrasSilver = 0
  let extrasBronze = 0
  let extrasRegular = 0
  let extrasCocacola = 0

  type UsRow = { status: string; stickers: { counts_for_completion: boolean; variant: string | null; section: string } | { counts_for_completion: boolean; variant: string | null; section: string }[] | null }
  ;(rows || []).forEach((row) => {
    const us = row as unknown as UsRow
    // PostgREST may shape the inner-join as either an object or an array
    // depending on relationship metadata — normalize to a single object.
    const s = Array.isArray(us.stickers) ? us.stickers[0] : us.stickers
    if (!s) return
    if (s.counts_for_completion) {
      if (us.status === 'owned') owned++
      if (us.status === 'duplicate') { owned++; duplicates++ }
    } else {
      // Extras (Coca-Cola + PANINI variants) — track presence per category for
      // the ranking tiebreak, AND count duplicates as tradeable inventory so
      // /status mirrors the album's "Repetidas" tab (which now shows ALL
      // duplicate stickers, not just album-completable ones).
      if (s.variant === 'gold') extrasGold++
      else if (s.variant === 'silver') extrasSilver++
      else if (s.variant === 'bronze') extrasBronze++
      else if (s.variant === 'regular') extrasRegular++
      else if (s.section === 'Coca-Cola') extrasCocacola++
      if (us.status === 'duplicate') duplicates++
    }
  })

  const missing = total - owned
  const pct = Math.round((owned / total) * 100)
  const extrasTotal = extrasGold + extrasSilver + extrasBronze + extrasRegular + extrasCocacola

  return {
    owned, missing, duplicates, total, pct,
    extrasTotal, extrasGold, extrasSilver, extrasBronze, extrasRegular, extrasCocacola,
  }
}

/**
 * Pedro 2026-05-09 (caso Lorenzo): wrapper que captura erro de getUserStats
 * (que agora propaga via throw em vez de retornar 0/980 silencioso).
 * Em caso de erro, manda uma mensagem amigável e retorna null pra o caller
 * pular o resto do handler. Use só fora dos blocos que já têm try/catch.
 */
async function safeGetUserStats(
  userId: string,
  phone: string,
): Promise<Awaited<ReturnType<typeof getUserStats>> | null> {
  try {
    return await getUserStats(userId)
  } catch (err) {
    console.error(`[safeGetUserStats] failed user=${userId}:`, err)
    try {
      await sendText(
        phone,
        '⚠️ Tive um problema técnico ao ler seu álbum agora. Tenta de novo em alguns minutos? 🙏',
      )
    } catch (sendErr) {
      console.error('[safeGetUserStats] sendText fallback also failed:', sendErr)
    }
    return null
  }
}

const EXTRAS_TOTAL_AVAILABLE = 92  // 12 Coca-Cola + 80 PANINI Extras (20 × 4 cores)

// Pedro 2026-05-07: ranking de seleções por % completude. User da imagem
// (54-99619-7830) perguntou "quais são as seleções que eu mais tenho
// figurinhas?" e bot caiu em status genérico. Agora respondemos direto:
// sem chamar Gemini, sem onerar — uma query agrupada que reusa o cache de
// stickers + user_stickers do user.
type CountryRow = { section: string; owned: number; total: number; pct: number }
async function getCountryBreakdown(userId: string): Promise<CountryRow[]> {
  const supabase = getAdmin()
  // Total por seção (público — pode usar service role admin)
  const [{ data: allStickers }, { data: ownedRows }] = await Promise.all([
    supabase
      .from('stickers')
      .select('id, section, counts_for_completion')
      .eq('counts_for_completion', true),
    supabase
      .from('user_stickers')
      .select('sticker_id, status')
      .eq('user_id', userId)
      .in('status', ['owned', 'duplicate']),
  ])
  const ownedSet = new Set((ownedRows || []).map((r) => r.sticker_id))
  const buckets = new Map<string, { owned: number; total: number }>()
  for (const s of (allStickers || []) as Array<{ id: number; section: string }>) {
    const key = s.section || '—'
    const b = buckets.get(key) || { owned: 0, total: 0 }
    b.total += 1
    if (ownedSet.has(s.id)) b.owned += 1
    buckets.set(key, b)
  }
  const rows: CountryRow[] = Array.from(buckets.entries()).map(([section, b]) => ({
    section,
    owned: b.owned,
    total: b.total,
    pct: b.total > 0 ? Math.round((b.owned / b.total) * 100) : 0,
  }))
  return rows
}

// ─── Section name resolver (PT/EN, fuzzy, multi-input) ────────────────────
//
// Maps user input like "brasil", "brazil", "bra", "argetina" (typo),
// "coca cola", "intro" → the canonical `section` value used in the stickers
// table ("Brazil", "Argentina", "Coca-Cola", "FIFA World Cup", ...).
// Returns the unique list of resolved sections (skips unknowns silently).

const SECTION_ALIASES: Record<string, string> = {
  // Selecoes — PT, EN e codigo de 3 letras
  brasil: 'Brazil', brazil: 'Brazil', bra: 'Brazil',
  argentina: 'Argentina', arg: 'Argentina',
  franca: 'France', france: 'France', fra: 'France',
  alemanha: 'Germany', germany: 'Germany', ger: 'Germany',
  espanha: 'Spain', spain: 'Spain', esp: 'Spain',
  inglaterra: 'England', england: 'England', eng: 'England',
  portugal: 'Portugal', por: 'Portugal',
  holanda: 'Netherlands', netherlands: 'Netherlands', ned: 'Netherlands',
  italia: 'Italy', italy: 'Italy', ita: 'Italy', // não está no álbum mas mantém por robustez
  croacia: 'Croatia', croatia: 'Croatia', cro: 'Croatia',
  belgica: 'Belgium', belgium: 'Belgium', bel: 'Belgium',
  uruguai: 'Uruguay', uruguay: 'Uruguay', uru: 'Uruguay',
  colombia: 'Colombia', col: 'Colombia',
  equador: 'Ecuador', ecuador: 'Ecuador', ecu: 'Ecuador',
  paraguai: 'Paraguay', paraguay: 'Paraguay', par: 'Paraguay',
  chile: 'Chile',
  peru: 'Peru',
  mexico: 'Mexico', mex: 'Mexico',
  canada: 'Canada', can: 'Canada',
  estadosunidos: 'USA', eua: 'USA', usa: 'USA',
  marrocos: 'Morocco', morocco: 'Morocco', mar: 'Morocco',
  egito: 'Egypt', egypt: 'Egypt', egy: 'Egypt',
  senegal: 'Senegal', sen: 'Senegal',
  argelia: 'Algeria', algeria: 'Algeria', alg: 'Algeria',
  tunisia: 'Tunisia', tun: 'Tunisia',
  capeverde: 'Cabo Verde', caboverde: 'Cabo Verde', cpv: 'Cabo Verde',
  costadomarfim: "Côte d'Ivoire", costademarfim: "Côte d'Ivoire", civ: "Côte d'Ivoire",
  ghana: 'Ghana', gana: 'Ghana', gha: 'Ghana',
  rdcongo: 'DR Congo', drcongo: 'DR Congo', cod: 'DR Congo',
  africadosul: 'South Africa', southafrica: 'South Africa', rsa: 'South Africa',
  arabiasaudita: 'Saudi Arabia', saudiarabia: 'Saudi Arabia', ksa: 'Saudi Arabia',
  ira: 'Iran', iran: 'Iran', irn: 'Iran',
  iraque: 'Iraq', iraq: 'Iraq', irq: 'Iraq',
  jordania: 'Jordan', jordan: 'Jordan', jor: 'Jordan',
  catar: 'Qatar', qatar: 'Qatar', qat: 'Qatar',
  uzbequistao: 'Uzbekistan', uzbekistan: 'Uzbekistan', uzb: 'Uzbekistan',
  japao: 'Japan', japan: 'Japan', jpn: 'Japan',
  coreiadosul: 'Korea Republic', coreia: 'Korea Republic', southkorea: 'Korea Republic', kor: 'Korea Republic',
  australia: 'Australia', aus: 'Australia',
  novazelandia: 'New Zealand', newzealand: 'New Zealand', nzl: 'New Zealand',
  turquia: 'Turkey', turkey: 'Turkey', tur: 'Turkey',
  republicatcheca: 'Czechia', tcheca: 'Czechia', cze: 'Czechia', czechia: 'Czechia',
  bosnia: 'Bosnia and Herzegovina', bih: 'Bosnia and Herzegovina',
  noruega: 'Norway', norway: 'Norway', nor: 'Norway',
  suecia: 'Sweden', sweden: 'Sweden', swe: 'Sweden',
  suica: 'Switzerland', switzerland: 'Switzerland', sui: 'Switzerland',
  austria: 'Austria', aut: 'Austria',
  escocia: 'Scotland', scotland: 'Scotland', sco: 'Scotland',
  panama: 'Panama', pan: 'Panama',
  haiti: 'Haiti', hai: 'Haiti',
  curacao: 'Curaçao', curacau: 'Curaçao', cur: 'Curaçao',
  capeverde2: 'Cabo Verde',
  // Special sections
  cocacola: 'Coca-Cola', coca: 'Coca-Cola', cocola: 'Coca-Cola', cc: 'Coca-Cola',
  intro: 'FIFA World Cup', introducao: 'FIFA World Cup', introduction: 'FIFA World Cup',
  fifa: 'FIFA World Cup', troféu: 'FIFA World Cup', trofeu: 'FIFA World Cup',
  history: 'FIFA World Cup', historia: 'FIFA World Cup',
  estadios: 'FIFA World Cup', estadio: 'FIFA World Cup',
  bola: 'FIFA World Cup', mascote: 'FIFA World Cup',
  extras: 'PANINI Extras', extra: 'PANINI Extras', lendas: 'PANINI Extras',
  lendarias: 'PANINI Extras', lendaria: 'PANINI Extras', panini: 'PANINI Extras',
}

const ALIAS_KEYS = Object.keys(SECTION_ALIASES)

function normalizeKey(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

/** Levenshtein distance, capped early when over `maxDistance`. */
function levenshtein(a: string, b: string, maxDistance = 2): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const curr = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      const v = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
      curr.push(v)
      if (v < rowMin) rowMin = v
    }
    if (rowMin > maxDistance) return maxDistance + 1
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]
  }
  return prev[b.length]
}

/**
 * Parse the user message and return the list of canonical section names the
 * user wants to filter by. Tolerates PT/EN, missing accents, common typos
 * (Levenshtein <= 2). Multi-country supported: split on whitespace/commas/+.
 *
 *   "faltando brasil"             → ['Brazil']
 *   "faltando brasil argentina"   → ['Brazil','Argentina']
 *   "faltam franca, espanha"      → ['France','Spain']
 *   "faltando coca cola"          → ['Coca-Cola']
 *   "faltam argetina"             → ['Argentina']  (typo absorved)
 */
// Stopwords: tokens que não são país nem comando — ignorar durante parsing.
// Pedro 2026-05-03 (caso 5512982127030 "Preciso de todas do Brasil"): bot
// pegou "de" → fuzzy com "ger" → Germany; "do" → fuzzy com "por" → Portugal.
// Lista cobre saudações + conectores + verbos comuns que apareciam em frases
// naturais ("preciso de todas as figurinhas do brasil" etc).
const FILTER_STOPWORDS = new Set([
  // Saudações
  'ola', 'oi', 'ei', 'oie', 'olar', 'opa', 'eai', 'eae', 'fala',
  'bomdia', 'boatarde', 'boanoite',
  // Conectores / artigos
  'a', 'as', 'o', 'os', 'um', 'uns', 'uma', 'umas',
  'de', 'do', 'da', 'dos', 'das',
  'em', 'no', 'na', 'nos', 'nas',
  'pra', 'para', 'pro', 'por', 'com', 'sem', 'sob',
  'e', 'ou', 'mas', 'ja', 'se', 'tambem',
  // Quantificadores
  'todas', 'todos', 'tudo', 'toda', 'todo',
  'qualquer', 'algum', 'alguma', 'alguns', 'algumas',
  'minhas', 'minha', 'meu', 'meus', 'seu', 'sua',
  // Verbos comuns que aparecem misturados na frase
  'preciso', 'precisa', 'necessito', 'quero', 'queria', 'gostaria',
  'tenho', 'tem', 'estou', 'tô', 'to',
  'mandar', 'manda', 'manda',
  'ver', 'vê', 've',
  'lista', 'liste', 'listar',
  'mostre', 'mostra', 'mostrar',
  'favor', 'porfavor',
  // Auxiliares
  'que', 'qual', 'quais', 'sobre', 'aqui', 'ali', 'la',
])

function parseSectionFilters(text: string): string[] {
  // Strip the leading verb/saudação so we only look at the country tokens.
  // Pedro 2026-05-03: adicionada saudação ("ola", "oi", "bom dia") pra
  // mensagens como "Olá. Preciso de todas do Brasil" não quebrarem.
  const stripped = text.toLowerCase()
    .replace(
      /^(ol[áa]|oi|opa|eai|eae|bom\s*dia|boa\s*tarde|boa\s*noite|fala|hey|hi)[.,!?\s]*/i,
      '',
    )
    .replace(/^(faltam|faltando|missing|preciso|necessito|que me falta|o que falta|quais faltam|falta)\s*/i, '')
    .trim()
  if (!stripped) return []

  // Tokenize. Treat "coca cola" / "africa do sul" / "rd congo" as compound:
  // strip whitespace before lookup.
  const tokens = stripped.split(/[\s,;+/]+/).filter(Boolean)
  if (tokens.length === 0) return []

  // Try greedy 3-then-2-then-1 token matching (handles "africa do sul").
  const found = new Set<string>()
  let i = 0
  while (i < tokens.length) {
    let matched = false
    for (const span of [3, 2, 1]) {
      if (i + span > tokens.length) continue
      const candidate = normalizeKey(tokens.slice(i, i + span).join(''))
      if (!candidate) continue
      // Exact alias hit
      if (SECTION_ALIASES[candidate]) {
        found.add(SECTION_ALIASES[candidate])
        i += span
        matched = true
        break
      }
      // Fuzzy fallback — only for span=1 to avoid spurious matches.
      // Pedro 2026-05-03: 3 guards adicionais pra evitar fuzzy match espúrio:
      //  1. Pula stopwords (de/do/todas/preciso/etc) — não eram filtros.
      //  2. Exige candidate ≥ 4 chars — pra strings de 3 chars dist=2 = 66%
      //     diferença, qualquer letra "casa" com aliases curtos (bra/ger/por).
      //  3. Distância proporcional: max 1/3 do tamanho, arredondado pra cima
      //     (consistente pra palavras maiores, mais rígido pra menores).
      if (span === 1) {
        if (FILTER_STOPWORDS.has(candidate)) {
          // stopword conhecida — não tenta fuzzy. Avança e segue.
          i += 1
          matched = true
          break
        }
        if (candidate.length < 4) {
          // Muito curto pra fuzzy seguro. Se não bateu exato, ignora.
          break
        }
        const maxDist = Math.max(1, Math.floor(candidate.length / 4))
        let best: { key: string; dist: number } | null = null
        for (const key of ALIAS_KEYS) {
          if (Math.abs(key.length - candidate.length) > maxDist) continue
          if (key.length < 4) continue // não fuzzy contra aliases muito curtos
          const d = levenshtein(candidate, key, maxDist)
          if (d <= maxDist && (!best || d < best.dist)) best = { key, dist: d }
        }
        if (best && best.dist <= maxDist) {
          found.add(SECTION_ALIASES[best.key])
          i += 1
          matched = true
          break
        }
      }
    }
    if (!matched) i += 1
  }
  return Array.from(found)
}

// ─── Get missing sticker list ───
//
// Returns at most `limit` missing stickers in physical-album order
// (display_order asc). When `sectionFilters` is non-empty, only stickers
// belonging to those sections are returned.
async function getMissingStickers(
  userId: string,
  limit = 150,
  sectionFilters: string[] = [],
  offset = 0,
) {
  const supabase = getAdmin()

  const { data: owned } = await supabase
    .from('user_stickers')
    .select('sticker_id')
    .eq('user_id', userId)
    .in('status', ['owned', 'duplicate'])

  const ownedIds = (owned || []).map((o) => o.sticker_id)

  let query = supabase
    .from('stickers')
    .select('number, player_name, country, section, display_order')
    .eq('counts_for_completion', true)
    .order('display_order')
    .range(offset, offset + limit - 1)

  if (sectionFilters.length > 0) {
    query = query.in('section', sectionFilters)
  }
  if (ownedIds.length > 0) {
    query = query.not('id', 'in', `(${ownedIds.join(',')})`)
  }

  const { data } = await query
  return data || []
}

// ─── Get duplicate sticker list ───
async function getDuplicateStickers(userId: string) {
  const supabase = getAdmin()

  // Order by display_order on the JOINed stickers row so the duplicates list
  // matches the physical album order (intro → groups A–L → history → coca →
  // extras), not the insertion order in user_stickers.
  const { data } = await supabase
    .from('user_stickers')
    .select('quantity, sticker_id, stickers(number, player_name, country, display_order)')
    .eq('user_id', userId)
    .eq('status', 'duplicate')
    .order('display_order', { foreignTable: 'stickers' })

  return (data || []).map((d: Record<string, unknown>) => {
    const sticker = d.stickers as Record<string, string | number> | null
    return {
      number: (sticker?.number as string) || '?',
      player_name: (sticker?.player_name as string) || '',
      country: (sticker?.country as string) || '',
      quantity: (d.quantity as number) || 2,
    }
  })
}

// ─── Get owned stickers (status owned OR duplicate, "as coladas") ───
// Pedro 2026-05-04: usuária perguntou "quais tenho" e bot interpretou como
// duplicates. Distinguir: owned = todas que tem >=1 cópia (coladas no álbum),
// duplicates = só as que tem 2+ (sobra pra trocar).
async function getOwnedStickers(userId: string) {
  const supabase = getAdmin()
  const { data } = await supabase
    .from('user_stickers')
    .select('quantity, sticker_id, status, stickers(number, player_name, country, display_order)')
    .eq('user_id', userId)
    .in('status', ['owned', 'duplicate'])
    .order('display_order', { foreignTable: 'stickers' })

  return (data || []).map((d: Record<string, unknown>) => {
    const sticker = d.stickers as Record<string, string | number> | null
    return {
      number: (sticker?.number as string) || '?',
      player_name: (sticker?.player_name as string) || '',
      country: (sticker?.country as string) || '',
      quantity: (d.quantity as number) || 1,
      isDuplicate: d.status === 'duplicate',
    }
  })
}

// ─── Sticker command classifier ────────────────────────────────────────
//
// Pedro 2026-05-07: o problema era detectar a INTENÇÃO sobre uma lista de
// figurinhas. Antes a gente só pegava prefixos rígidos ("tenho X?",
// "preciso X"). Agora extrai os códigos da string e classifica o RESÍDUO
// (= o que o user escreveu além dos códigos) como comando, em qualquer
// posição: antes ou depois da lista.
//
// Exemplos:
//   "registre BRA1 FRA2"          → register   (verbo antes)
//   "BRA1 FRA2 registra aí"       → register   (verbo depois)
//   "veja se tenho FRA10 BRA10"   → query_owned
//   "FRA10 BRA10 tenho?"          → query_owned (sufixo + ?)
//   "veja se falta SEN10"         → query_missing
//   "SEN10 FRA3 que falta"        → query_missing
//   "tira CC13"                   → remove
//   "BRA1 FRA2"                   → register (default sem verbo)
//   "BRA1?"                       → query_owned (só "?" já é pergunta)
//
// Retorna null se não tem códigos OU comando não foi entendido (cai no
// fluxo legado / Gemini fallback).
type StickerCmd = 'register' | 'query_owned' | 'query_missing' | 'remove'

function classifyStickerCommand(
  rawText: string,
  codeMatches: string[],
): StickerCmd | null {
  if (codeMatches.length === 0) return null

  // Remove cada código (em todas variações: BRA1, BRA-1, BRA 1, bra1, etc.)
  // pra isolar o resíduo de comando.
  let residue = rawText
  for (const code of codeMatches) {
    // Escapa o código pra usar como regex literal, mas tolera separadores
    // diferentes: o regex original já captura "[a-z]{2,5}[\s\-]?\d{1,2}"
    // com flag 'gi', então a string já vem normalizada do match. Pra
    // remover de forma resiliente, gera variantes.
    const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    residue = residue.replace(new RegExp(escaped, 'gi'), ' ')
  }
  // Limpa pontuação, conjunções e palavras de cola
  residue = residue
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[,;.!]/g, ' ')
    .replace(/\b(e|a|o|as|os|da|de|do|das|dos|um|uma|uns|umas|essa|esse|essas|esses|aqui|ai|tambem|tb)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const hasQuestionMark = /\?/.test(rawText)

  // ─── REMOVE: tirar/remover/deletar/apagar/excluir ───
  // Pedro 2026-05-10: estendido pra capturar verbos de TROCA — usuário
  // diz "dei BRA-5" / "saiu ARG-3" / "trocou CC-2" quando entrega
  // figurinha repetida pra outra pessoa. Mesma operação no DB
  // (decrement quantity), só muda o verbo. Ainda mantém o fluxo de
  // confirmação explícita ("REMOVER" / "DAR BAIXA") pra evitar
  // acidente no caso Cintia.
  // (NÃO inclui "cancelar" — handler de cancel-pending tem fluxo próprio
  // pra "cancela registro/foto/áudio".)
  if (/\b(tirar?|tire|remover?|remove|deletar?|delete|apagar?|apaga|excluir?|exclui|dei|deu|saiu?|sa[ií]ram|saiuram|trocou?|troquei|entreguei|entregou|dar\s+baixa|dou)\b/.test(residue)) {
    return 'remove'
  }

  // ─── QUERY_MISSING: precedência sobre query_owned quando residue tem
  // "falta/não tenho/preciso/não peguei/não colei" ───
  // Cobre: "veja se falta", "será que falta", "que falta", "tenho que pegar",
  // "ainda preciso", "não tenho", "nao peguei", etc.
  const hasMissingVerb = /\b(falta|faltam|faltando|nao\s+tenho|nao\s+tem|nao\s+peguei|nao\s+colei|nao\s+coloquei|preciso|me\s+falta|tenho\s+que\s+pegar|ainda\s+preciso|que\s+falta)\b/.test(residue)
  // ─── QUERY_OWNED: posse/tem/peguei + indicador interrogativo ───
  // Cobre: "veja se tenho", "será que tenho", "tenho ?", "FRA10 tenho?"
  const hasOwnedVerb = /\b(tenho|tem|tinha|peguei|colei|j[aá]\s+tenho|j[aá]\s+peguei|j[aá]\s+colei)\b/.test(residue)
  // Indicador de pergunta: "?" no fim, OU verbo de checagem "veja/vê/olha/
  // confere/confira/checa/cheque/me diz/me fala/será que"
  const hasInterrogative =
    hasQuestionMark ||
    /\b(veja|ve|olha|olhe|confere|confira|checa|cheque|sera\s+que|me\s+diz|me\s+fala|me\s+conta)\b/.test(residue)

  if (hasMissingVerb && hasInterrogative) return 'query_missing'
  // "preciso/falta/não tenho" sozinho já implica query missing (verbo de
  // negação não precisa de "?" — "não tenho FRA10" é informativo mas user
  // quer saber/listar).
  if (hasMissingVerb && !hasOwnedVerb) return 'query_missing'

  if (hasOwnedVerb && hasInterrogative) return 'query_owned'

  // ─── REGISTER: verbo explícito de cadastro ───
  // "peguei/colei" (passado): declaração de posse → cadastrar.
  // "tenho/já tenho" (presente): AMBÍGUO — pode ser declaração ou consulta.
  // No fluxo legado, "tenho X" sem "?" cai em looksLikeQuestion=true e vira
  // query. Mantemos esse comportamento: aqui só capturamos verbos
  // inequívocos de cadastro.
  if (/\b(registr[ae]r?|registre|salv[ae]r?|salve|adicion[ae]r?|adicione|coloque|cole|cola|colar|colei|marca|marque|anota|anote|peguei|j[aá]\s+peguei|j[aá]\s+colei)\b/.test(residue)) {
    return 'register'
  }

  // ─── DEFAULT: códigos sem comando explícito → register ───
  // Mas só se o resíduo é vazio ou trivial (sem verbos suspeitos).
  if (residue.length === 0 || /^[\s\-]+$/.test(residue)) {
    return 'register'
  }

  // Resíduo tem conteúdo mas não bateu em nenhum padrão → null pra cair
  // no fluxo legado (que pode ainda detectar via outras regras ou Gemini).
  return null
}

// ─── Detect intent via Gemini ───
async function detectIntent(text: string): Promise<{ intent: string; confidence: number }> {
  try {
    const genAI = getGemini()
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: INTENT_SYSTEM,
    })

    const result = await model.generateContent([{ text }])
    const response = result.response.text()
    const jsonMatch = response.match(/\{[\s\S]*\}/)

    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      return { intent: parsed.intent || 'unknown', confidence: parsed.confidence || 0.5 }
    }
  } catch (err) {
    console.error('Intent detection error:', err)
  }
  return { intent: 'unknown', confidence: 0 }
}

// ─── Transcribe an audio message via Gemini ───
async function transcribeAudio(audioBase64: string, mimeType: string): Promise<string | null> {
  try {
    const genAI = getGemini()
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction:
        'You receive a Portuguese audio message from a Panini FIFA World Cup 2026 sticker album user listing sticker codes. ' +
        'Transcribe verbatim in plain Portuguese, no punctuation cleanup, no prefix, no quotes. ' +
        '\n\n=== NUMBERS ===\n' +
        'Convert ALL spelled-out numbers to digits — "três" → "3", "treze" → "13", ' +
        '"vinte e cinco" → "25", "número quinze" → "15". ' +
        'Numbers may come BEFORE or AFTER the country: "Tcheca 3, 5, 7" or "3, 5, 7 da Tcheca" — both valid. ' +
        '\n\n=== COUNTRIES (CRITICAL) ===\n' +
        'The user is listing country names + numbers. KEEP country names INTACT and properly spelled. ' +
        'NEVER substitute a country name with a similar-sounding player name — players are CONTENT of the stickers, not what the user is saying out loud. ' +
        'Common audio variants to MAP to canonical form:\n' +
        '  • Czechia: "tcheca" / "tchéquia" / "techa" / "chéquia" / "chequia" / "checa" → "Tcheca"\n' +
        '    ⚠️ "Tcheca" is NEVER "Mero", "Mexa", "Meca", "número" — those are wrong transcriptions\n' +
        '  • Cabo Verde: "cabo verde" / "caboverde" → "Cabo Verde" (keep as 2 words)\n' +
        '  • Côte d\'Ivoire: "costa do marfim" / "marfim" → "Costa do Marfim"\n' +
        '  • Coreia do Sul: "coreia" / "coreia do sul" / "coréia" → "Coreia do Sul"\n' +
        '  • Arábia Saudita: "arabia saudita" / "saudita" → "Arábia Saudita"\n' +
        '  • Estados Unidos: "eua" / "estados unidos" → "Estados Unidos"\n' +
        '  • África do Sul: "africa do sul" / "rsa" → "África do Sul"\n' +
        '  • Nova Zelândia: "nova zelandia" → "Nova Zelândia"\n' +
        '  • Marrocos: "marrocos" / "marroco" / "marrocô" / "maroc" / "morocco" → "Marrocos"\n' +
        '    ⚠️ Pedro 2026-05-10: usuários frequentemente falam só "Marroco" sem o "s" final — preserve a INTENÇÃO e escreva "Marrocos"\n' +
        '  • RD Congo: "rd congo" / "dr congo" / "congo" / "república do congo" / "república democrática do congo" / "congo democrática" → "RD Congo"\n' +
        '    ⚠️ Pedro 2026-05-10: no álbum Copa 2026 só tem o RD Congo (Kinshasa). Se o usuário fala só "Congo" ou "República do Congo", interprete como "RD Congo".\n' +
        '  • Bósnia: "bosnia" / "bosnia e herzegovina" → "Bósnia"\n' +
        '\n=== SIGLAS ESPECIAIS (FIFA / Coca-Cola) ===\n' +
        'O usuário pode soletrar siglas das seções especiais. SEMPRE normalize para a sigla canônica:\n' +
        '  • FWC (FIFA World Cup): "F W C" / "F C W" / "F V C" / "fefa" / "fifa world cup" / "copa do mundo" → "FWC"\n' +
        '    ⚠️ Pedro 2026-05-10: se ouvir letras na ordem errada (F C W em vez de F W C), CORRIJA pra "FWC" — o álbum só tem FWC, não FCW.\n' +
        '  • CC (Coca-Cola): "C C" / "cê cê" / "coca cola" / "coca" → "CC"\n' +
        '  • EXT (PANINI Extras): "E X T" / "extras" / "extra" → "EXT"\n' +
        '\n=== EXAMPLES ===\n' +
        'Audio: "Tcheca três, cinco, sete"           → "Tcheca 3, 5, 7"\n' +
        'Audio: "República Tcheca número treze"      → "República Tcheca 13"\n' +
        'Audio: "Cabo Verde quatorze e dezesseis"    → "Cabo Verde 14 e 16"\n' +
        'Audio: "Brasil um, dois, três"              → "Brasil 1, 2, 3"\n' +
        'Audio: "Esp três e Arg cinco"               → "ESP 3 e ARG 5"\n' +
        '\nIf the audio is silent, unintelligible, or not Portuguese, respond with the literal token UNINTELLIGIBLE.',
    })
    const result = await model.generateContent([
      { inlineData: { mimeType, data: audioBase64 } },
      { text: 'Transcreva este áudio em português, convertendo números por extenso para dígitos.' },
    ])
    const text = result.response.text().trim()
    if (!text || text.toUpperCase().includes('UNINTELLIGIBLE')) return null
    return text
  } catch (err) {
    console.error('[WhatsApp] Audio transcription failed:', err)
    return null
  }
}

// ─── Scan image via Gemini ───
async function scanImage(imageBase64: string, mimeType: string) {
  const genAI = getGemini()
  // Use gemini-2.5-flash for WhatsApp — much faster than 2.5-flash for image analysis
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: SCAN_INSTRUCTION,
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
    },
  })

  const result = await model.generateContent([
    { inlineData: { mimeType, data: imageBase64 } },
    { text: 'Identify the sticker(s) in this photo. Return JSON.' },
  ])

  const responseText = result.response.text()
  const jsonMatch = responseText.match(/\{[\s\S]*\}/)

  if (!jsonMatch) return null

  try {
    const parsed = JSON.parse(jsonMatch[0])
    if (!parsed.stickers || !Array.isArray(parsed.stickers)) return null
    return parsed
  } catch {
    return null
  }
}

// ─── Save scanned stickers to DB ───
async function saveScannedStickers(userId: string, stickerNumbers: string[], playerNames?: string[]) {
  const supabase = getAdmin()

  // Match by number first
  const { data: dbStickers } = await supabase
    .from('stickers')
    .select('id, number, player_name')
    .in('number', stickerNumbers)

  // If no match by number, try by player name
  if ((!dbStickers || dbStickers.length === 0) && playerNames && playerNames.length > 0) {
    const names = playerNames.filter(Boolean).map(n => n.trim())
    if (names.length > 0) {
      for (const name of names) {
        const { data: byName } = await supabase
          .from('stickers')
          .select('id, number, player_name')
          .ilike('player_name', `%${name}%`)
          .limit(1)
        if (byName && byName.length > 0) {
          if (!dbStickers) {
            return saveScannedStickersFromList(userId, byName)
          }
          // Add to existing results if not already there
          const existingIds = new Set(dbStickers.map(s => s.id))
          byName.forEach(s => { if (!existingIds.has(s.id)) dbStickers.push(s) })
        }
      }
    }
  }

  if (!dbStickers || dbStickers.length === 0) return { saved: 0, numbers: [] }

  return batchSaveStickers(supabase, userId, dbStickers.map((s) => ({ sticker_id: s.id, number: s.number })))
}

// Helper for when we already resolved DB stickers by name
async function saveScannedStickersFromList(userId: string, dbStickers: { id: number; number: string; player_name: string }[]) {
  const supabase = getAdmin()
  return batchSaveStickers(supabase, userId, dbStickers.map((s) => ({ sticker_id: s.id, number: s.number })))
}

/**
 * Batch save stickers — single query to fetch existing, then batch upserts.
 * Replaces the old N-query-per-sticker loop.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function batchSaveStickers(supabase: any, userId: string, stickers: { sticker_id: number; number: string; quantity?: number }[]) {
  if (stickers.length === 0) return { saved: 0, numbers: [] }

  // 1. Single query: fetch existing stickers for this user
  const { data: existing } = await supabase
    .from('user_stickers')
    .select('sticker_id, status, quantity')
    .eq('user_id', userId)
    .in('sticker_id', stickers.map((s) => s.sticker_id))

  const existingMap = new Map((existing || []).map((e: { sticker_id: number; status: string; quantity: number }) => [e.sticker_id, e]))

  // 2. Categorize: new inserts vs updates
  const toInsert: Array<{ user_id: string; sticker_id: number; status: string; quantity: number }> = []
  const toUpdate: Array<{ sticker_id: number; status: string; quantity: number }> = []
  const savedNumbers: string[] = []
  const now = new Date().toISOString()

  for (const sticker of stickers) {
    const qty = sticker.quantity || 1
    const ex = existingMap.get(sticker.sticker_id) as { status: string; quantity: number } | undefined
    if (!ex) {
      toInsert.push({ user_id: userId, sticker_id: sticker.sticker_id, status: qty > 1 ? 'duplicate' : 'owned', quantity: qty })
      savedNumbers.push(qty > 1 ? `${sticker.number} (x${qty})` : sticker.number)
    } else if (ex.status === 'missing' || ex.quantity === 0) {
      // Pedro 2026-05-05: bug do "0 figurinhas registradas" — quando user
      // tem sticker_row com status='missing' e quantity=0 (estado inicial
      // OU removeu antes), batchSaveStickers IGNORAVA. Fix: trata como
      // primeira aquisição — vira 'owned' (ou 'duplicate' se qty>1).
      toUpdate.push({ sticker_id: sticker.sticker_id, status: qty > 1 ? 'duplicate' : 'owned', quantity: qty })
      savedNumbers.push(qty > 1 ? `${sticker.number} (x${qty})` : sticker.number)
    } else if (ex.status === 'owned') {
      toUpdate.push({ sticker_id: sticker.sticker_id, status: 'duplicate', quantity: ex.quantity + qty })
      savedNumbers.push(`${sticker.number} (rep${qty > 1 ? ` x${ex.quantity + qty}` : ''})`)
    } else if (ex.status === 'duplicate') {
      toUpdate.push({ sticker_id: sticker.sticker_id, status: 'duplicate', quantity: ex.quantity + qty })
      savedNumbers.push(`${sticker.number} (rep x${ex.quantity + qty})`)
    }
  }

  // Pedro 2026-05-09 (caso Cintia): captura errors do insert/upsert
  // (antes silenciosos — `saved` retornava N mesmo se zero salvou).
  // Caso Cintia: 9 CZE confirmadas mas não registradas. Sem logs era
  // impossível diagnosticar.
  let actualSaved = 0
  let savedFailedReason: string | null = null

  // 3. Batch insert new stickers (single query)
  if (toInsert.length > 0) {
    const { error: insertErr, data: insertData } = await supabase
      .from('user_stickers')
      .insert(toInsert)
      .select('sticker_id')
    if (insertErr) {
      savedFailedReason = `insert error: ${insertErr.message}`
      console.error(`[batchSaveStickers] insert FAILED for user ${userId}:`, insertErr.message, `attempted=${toInsert.length}`)
    } else {
      actualSaved += (insertData?.length ?? toInsert.length)
    }
  }

  // 4. Batch update existing stickers (upsert with onConflict)
  if (toUpdate.length > 0) {
    const upsertData = toUpdate.map((u) => ({
      user_id: userId,
      sticker_id: u.sticker_id,
      status: u.status,
      quantity: u.quantity,
      updated_at: now,
    }))
    const { error: upsertErr, data: upsertResult } = await supabase
      .from('user_stickers')
      .upsert(upsertData, { onConflict: 'user_id,sticker_id' })
      .select('sticker_id')
    if (upsertErr) {
      savedFailedReason = (savedFailedReason ? savedFailedReason + ' | ' : '') + `upsert error: ${upsertErr.message}`
      console.error(`[batchSaveStickers] upsert FAILED for user ${userId}:`, upsertErr.message, `attempted=${toUpdate.length}`)
    } else {
      actualSaved += (upsertResult?.length ?? toUpdate.length)
    }
  }

  if (savedFailedReason) {
    console.error(
      `[batchSaveStickers] SAVE PARTIAL/FAILED user=${userId} ` +
      `attempted=${toInsert.length + toUpdate.length} actual_saved=${actualSaved} ` +
      `reason="${savedFailedReason}"`
    )
  }

  // Pedro 12/05/2026 — Liga Complete Aí: pontua scans salvos.
  // - 1 ponto por sticker (cap 30/dia, fail-open no awardLigaPoints)
  // - FIRST_PHOTO_SCAN se for o primeiro scan lifetime do user
  // - Re-check unlocks (Trilha Digital) — dispara modal se atingir marco
  // Fire-and-forget pra não atrasar response.
  if (actualSaved > 0) {
    void awardScanPointsForToday(userId, actualSaved)
      .then(() => awardFirstScanIfNew(userId, 'photo'))
      .then(() => checkAndRegisterUnlocks(userId))
      .catch((err) => console.error('[liga] hook in batchSaveStickers failed:', err))
  }

  return { saved: actualSaved, numbers: savedNumbers }
}

// ─── Download image from Z-API URL ───
async function downloadImage(url: string, messageId?: string): Promise<{ base64: string; mimeType: string } | null> {
  // Try Z-API's get-media-message endpoint first (more reliable)
  if (messageId) {
    try {
      const INSTANCE_ID = process.env.ZAPI_INSTANCE_ID!
      const TOKEN = process.env.ZAPI_TOKEN!
      const CLIENT_TOKEN = process.env.ZAPI_CLIENT_TOKEN!
      const zapiUrl = `https://api.z-api.io/instances/${INSTANCE_ID}/token/${TOKEN}/download-media-message/${messageId}`
      const res = await fetch(zapiUrl, {
        headers: { 'Client-Token': CLIENT_TOKEN },
      })
      if (res.ok) {
        const data = await res.json()
        if (data.url) {
          const imgRes = await fetch(data.url)
          if (imgRes.ok) {
            const buffer = await imgRes.arrayBuffer()
            return {
              base64: Buffer.from(buffer).toString('base64'),
              mimeType: imgRes.headers.get('content-type') || 'image/jpeg',
            }
          }
        }
      }
    } catch (err) {
      console.error('Z-API media download error:', err)
    }
  }

  // Fallback: direct URL download (with and without auth)
  try {
    const CLIENT_TOKEN_FALLBACK = process.env.ZAPI_CLIENT_TOKEN || ''
    // Try with Client-Token first (Z-API URLs may require it)
    let res = await fetch(url, {
      headers: CLIENT_TOKEN_FALLBACK ? { 'Client-Token': CLIENT_TOKEN_FALLBACK } : {},
    })
    // If auth header caused issues, try without
    if (!res.ok && CLIENT_TOKEN_FALLBACK) {
      res = await fetch(url)
    }
    if (!res.ok) {
      console.error('[WhatsApp] Direct image download failed:', res.status, res.statusText)
      return null
    }

    const buffer = await res.arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')
    const mimeType = res.headers.get('content-type') || 'image/jpeg'

    return { base64, mimeType }
  } catch (err) {
    console.error('[WhatsApp] Direct image download error:', err)
    return null
  }
}

// ─── Cleanup expired pending scans (fire-and-forget, throttled) ───
let lastCleanup = 0
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000 // 10 minutes

function cleanupExpiredScans() {
  const now = Date.now()
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return
  lastCleanup = now

  const supabase = getAdmin()
  Promise.resolve(supabase
    .from('pending_scans')
    .delete()
    .lt('expires_at', new Date().toISOString()))
    .then(({ error, count }) => {
      if (error) console.error('[cleanup] Failed to delete expired scans:', error.message)
      else if (count && count > 0) console.log(`[cleanup] Deleted ${count} expired pending scans`)
    })
    .catch(() => {}) // fire-and-forget
}

// ─── Dispatcher: processa próxima foto da fila (Pedro 2026-05-10, Opt 2) ───
// Chamado após cada finalização de pending (SIM, NÃO, cancelar, desfaz).
// Pega a próxima foto enfileirada, acquire lock, e dispara fetch /api/whatsapp/scan.
// Sem perda — fotos enfileiradas durante busy state são re-baixadas e processadas.
async function dispatchNextQueuedImage(userId: string, fallbackPhone: string): Promise<boolean> {
  const next = await dequeueNextImage(userId)
  if (!next) return false

  // Tenta acquire lock — se algo correu errado e ainda há lock, recoloca a
  // foto na fila pra próximo dispatch.
  const acquired = await tryAcquireScanLock(userId, 5)
  if (!acquired) {
    console.warn(`[image-queue-dispatch] lock busy for ${userId}, re-enqueueing item ${next.id}`)
    await enqueueImage({
      userId,
      phone: next.phone || fallbackPhone,
      imageUrl: next.image_url,
      imageBase64: next.image_base64,
      mimeType: next.mime_type || 'image/jpeg',
      caption: next.caption,
      isQueryMode: next.is_query_mode,
      msgId: next.msg_id,
    })
    return false
  }

  // Re-baixa imagem (pode estar como URL apenas)
  let imageData: { base64: string; mimeType: string } | null = null
  if (next.image_base64) {
    imageData = { base64: next.image_base64, mimeType: next.mime_type || 'image/jpeg' }
  } else if (next.image_url) {
    imageData = await downloadImage(next.image_url, next.msg_id || undefined)
  }

  const targetPhone = next.phone || fallbackPhone
  if (!imageData) {
    await releaseScanLock(userId)
    await sendText(targetPhone, '⚠️ Não conseguimos re-baixar uma das fotos da fila (link expirou). Manda de novo se quiser registrá-la? 📸').catch(() => {})
    // Tenta a próxima da fila depois de erro nessa
    return dispatchNextQueuedImage(userId, fallbackPhone)
  }

  const remaining = await getQueueLength(userId)
  const queueNote = remaining > 0
    ? ` _(${remaining + 1} fotos restantes na fila)_`
    : ''
  await sendText(targetPhone, `🔍 Analisando próxima foto da fila...${queueNote}`).catch(() => {})

  waitUntil(
    fetch(`${APP_URL}/api/whatsapp/scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': process.env.SUPABASE_SERVICE_ROLE_KEY!,
      },
      body: JSON.stringify({
        base64: imageData.base64,
        mimeType: imageData.mimeType,
        phone: targetPhone,
        userId,
        mode: next.is_query_mode ? 'query' : 'register',
      }),
    }).catch((err) => console.error('[WhatsApp] dispatch next failed:', err)),
  )
  return true
}

// ─── Interactive button definitions ──────────────────────────────────────────
// Each command surfaces both as a button (one-tap) and as a text the user can
// type freely. Button IDs map to canonical command words so the rest of the
// pipeline can treat the click as if the user typed that word.

const BUTTON_ID_TO_TEXT: Record<string, string> = {
  cmd_status: 'status',
  cmd_missing: 'faltando',
  cmd_missing_top50: 'faltando top50',
  cmd_missing_brasil: 'faltando brasil',
  cmd_missing_all: 'faltando todas',
  cmd_duplicates: 'repetidas',
  cmd_owned: 'coladas',
  cmd_trades: 'trocas',
  cmd_ranking: 'ranking',
  cmd_help: 'ajuda',
}

// Common 3-button menu shown in welcome/help/unknown.
const MAIN_MENU_BUTTONS: ButtonOption[] = [
  { id: 'cmd_status', label: '📊 Progresso' },
  { id: 'cmd_missing', label: '🔍 O que falta' },
  { id: 'cmd_duplicates', label: '🔁 Repetidas' },
]

// ─── Dedup: avoid processing same message twice ───
// Pedro 2026-05-06: dedup era só Map em memória (per-Lambda). Quando Z-API
// mandava o mesmo webhook pra Lambdas DIFERENTES (multi-instance), cada um
// via como novo e processava — caso real: foto da Bruna gerou 3x "Analisando".
// Solução: layered. Cache local primeiro (instant) + DB persistente (cross
// instance). DB usa unique constraint em message_id pra rejeitar duplicatas.
const recentMessages = new Map<string, number>()
const DEDUP_TTL_MS = 5 * 60 * 1000 // 5 minutes
const DEDUP_MAX_SIZE = 500

/** Checa cache local (memória do Lambda atual). True se já processou aqui. */
function isDuplicateLocal(messageId: string): boolean {
  if (!messageId) return false
  const now = Date.now()

  // Cleanup periódico
  if (recentMessages.size > DEDUP_MAX_SIZE / 2) {
    const expired: string[] = []
    recentMessages.forEach((timestamp, id) => {
      if (now - timestamp > DEDUP_TTL_MS) expired.push(id)
    })
    expired.forEach((id) => recentMessages.delete(id))
  }

  if (recentMessages.has(messageId)) return true
  recentMessages.set(messageId, now)
  return false
}

/** Checa DB (cross-instance). Insere row e retorna true se já existia.
 *  Usa unique constraint em message_id pra atomicidade. */
async function isDuplicateDB(messageId: string, phone: string): Promise<boolean> {
  if (!messageId) return false
  try {
    const supabase = getAdmin()
    const { error } = await supabase
      .from('webhook_dedup')
      .insert({ message_id: messageId, phone })
    // 23505 = unique_violation — outra instância já registrou
    if (error?.code === '23505') return true
    if (error) {
      // Erro inesperado — log mas NÃO bloqueia (fail-open pra evitar
      // perder mensagens reais por problema de DB)
      console.error('[dedup-db] insert error:', error.message)
      return false
    }
    return false
  } catch (err) {
    console.error('[dedup-db] unexpected:', err)
    return false
  }
}

/** Combina cache local + DB. Local primeiro (rápido), DB pra cross-instance. */
async function isDuplicate(messageId: string, phone: string): Promise<boolean> {
  if (!messageId) return false
  if (isDuplicateLocal(messageId)) return true
  return await isDuplicateDB(messageId, phone)
}

// ─── Main webhook handler ───
export async function POST(req: NextRequest) {
  backgroundHealthPing() // fire-and-forget system monitor

  // Cleanup expired pending scans (fire-and-forget, max once per 10 min)
  cleanupExpiredScans()

  // Rate limit by IP
  const rlResponse = await checkRateLimit(getIp(req), webhookLimiter)
  if (rlResponse) return rlResponse

  try {
    const body = await req.json()

    // Dedup — Z-API can send multiple webhooks for same message
    // Pedro 2026-05-06: agora layered (memória local + DB persistente)
    // pra evitar duplicação cross-Lambda.
    const msgId = body.messageId || body.id?.id || body.ids?.[0] || ''
    const dedupPhone = body.phone || body.from || ''
    if (await isDuplicate(msgId, dedupPhone)) {
      return NextResponse.json({ ok: true })
    }

    // Z-API sends different event types — we care about received messages.
    // Tolerate missing/undefined fields: only skip if isGroup or fromMe are
    // EXPLICITLY true. Some Z-API payload versions omit these flags entirely
    // for inbound messages, which previously caused silent drops (=== false
    // didn't match undefined).
    const isMessage = body.isGroup !== true && body.fromMe !== true

    if (!isMessage) {
      console.log('[WhatsApp webhook] skipped — isGroup:', body.isGroup, 'fromMe:', body.fromMe)
      return NextResponse.json({ ok: true })
    }

    // Pedro 2026-05-03 (caso Samyr): Z-API às vezes entrega phone em formato
    // não-canônico (ex: 12 dig sem o 9 inicial). Normalizar pra 13 dig
    // (55+DDD+9+8) AQUI garante que todo o resto da cadeia (lookup,
    // pending_registrations, sendText) usa o mesmo formato.
    const rawPhone = body.phone || body.chatId || ''
    const phone = normalizePhoneBR(rawPhone) || formatPhone(rawPhone)
    if (!phone) {
      return NextResponse.json({ ok: true })
    }

    // ─── Interactive responses (button click / list pick) ──────────────────
    // Z-API delivers button clicks as `buttonsResponseMessage.buttonId` and
    // list picks as `listResponseMessage.selectedRowId`. Translate either into
    // the equivalent command word and inject as a text message so the rest of
    // the pipeline (intent detection + switch) handles it uniformly.
    const buttonId: string | undefined =
      body.buttonsResponseMessage?.buttonId || body.listResponseMessage?.selectedRowId
    if (buttonId && BUTTON_ID_TO_TEXT[buttonId]) {
      body.text = { message: BUTTON_ID_TO_TEXT[buttonId] }
      console.log(`[WhatsApp] Button ${buttonId} → "${BUTTON_ID_TO_TEXT[buttonId]}"`)
    }

    // Z-API may send type in different formats — detect by content
    const rawType = body.type || ''
    const hasImage = !!(body.image?.imageUrl || body.image?.url || body.imageUrl)
    const hasText = !!(body.text?.message || body.body || body.message || '').toString().trim()
    const hasAudio = !!(body.audio?.audioUrl || body.audio?.url)

    let messageType = hasImage ? 'image'
      : (rawType === 'audio' || rawType === 'ptt' || hasAudio) ? 'audio'
      : hasText ? 'text'
      : rawType

    // TEMP DEBUG (console.error pra aparecer com level=error na Vercel —
    // os logs anteriores como console.log estavam sumindo da view summary).
    // Tudo numa string só pra evitar agrupamento. Remover quando achar bug.
    try {
      const dbg = [
        `phone=${maskPhone(phone)}`,
        `type=${body.type}`,
        `isGroup=${body.isGroup}`,
        `fromMe=${body.fromMe}`,
        `messageType=${messageType}`,
        `hasImage=${hasImage}`,
        `hasText=${hasText}`,
        `text.message=${typeof body.text === 'object' ? body.text?.message?.slice?.(0, 60) : body.text}`,
        `bodyField=${typeof body.body === 'string' ? body.body.slice(0, 60) : body.body}`,
        `msgField=${typeof body.message === 'string' ? body.message.slice(0, 60) : body.message}`,
        `messageId=${body.messageId}`,
        `bodyKeys=[${Object.keys(body).join(',')}]`,
      ].join(' | ')
      console.error('[WA_DEBUG]', dbg)
    } catch (debugErr) {
      console.error('[WA_DEBUG] failed:', debugErr)
    }

    // Find user by phone
    let user = await findUserByPhone(phone)

    // Unknown user → check pending_registration state machine OR send welcome
    if (!user) {
      // Pedro 2026-05-03: log diagnóstico não-mascarado pra investigar
      // casos como Gabriele (Conta Comercial). Pode ser removido depois.
      await logUnrecognizedPhone(phone, body as unknown as Record<string, unknown>)

      // Extract message text early (available for any messageType — text/audio
      // transcription happens later, but for registration we only need text).
      const earlyTextRaw = (body.text?.message || body.body || body.message || '').toString().trim()

      // Pedro 2026-05-04 (caso Enzo): se a mensagem traz `[link:TOKEN]`,
      // significa que o user logado clicou num deep-link wa.me dentro do
      // site. Token mapeia pro user_id → vincula phone direto sem pedir
      // email. Roda ANTES do email-check (mais rápido, mais confiável).
      const tokenLinked = await tryAutoLinkByTokenInMessage(phone, earlyTextRaw)
      if (tokenLinked) {
        user = tokenLinked
        const firstName = (tokenLinked.display_name || '').split(' ')[0]
        await sendText(
          phone,
          `✅ *Pronto${firstName ? `, ${firstName}` : ''}!* Conectei seu WhatsApp à sua conta. 🔓\n\n` +
            `Já pode usar tudo aqui:\n` +
            `📸 *Foto* das figurinhas — eu identifico com IA\n` +
            `🎤 *Áudio* falando os códigos\n` +
            `✏️ *Texto* tipo _"BRA-1 ARG-3"_ ou _"Brasil 1"_\n\n` +
            `Manda *menu* a qualquer hora pra ver tudo. ⚽`,
        )
        // Re-processa a mensagem original (sem o marker [link:TOKEN]) — bot
        // segue o fluxo normal pro intent dela. Ex: "Gostaria de registrar
        // por áudio" cai em sendPostSignupFollowUp pra orientar o user.
        await sendPostSignupFollowUp(phone, stripLinkToken(earlyTextRaw))
        return NextResponse.json({ ok: true })
      }

      const earlyText = stripLinkToken(earlyTextRaw)

      // Pedro 2026-05-03 (Fix H): se a mensagem inicial já tem o email
      // do user (ex: vindo do CTA "Conectar WhatsApp" no site), faz
      // auto-link em 1 round-trip — sem precisar do flow de registration.
      const linked = await tryAutoLinkByEmailInMessage(phone, earlyText)
      if (linked) {
        user = linked
        const firstName = (linked.display_name || '').split(' ')[0]
        await sendText(
          phone,
          `✅ *Pronto${firstName ? `, ${firstName}` : ''}!* Conectei seu WhatsApp à sua conta. 🔓\n\n` +
            `Agora pode usar tudo aqui:\n` +
            `📸 *Foto* das figurinhas — eu identifico com IA\n` +
            `🎤 *Áudio* falando os códigos\n` +
            `✏️ *Texto* tipo _"BRA-1 ARG-3"_\n\n` +
            `Manda *menu* a qualquer hora pra ver tudo. ⚽`,
        )
        return NextResponse.json({ ok: true })
      }

      const handled = await handleRegistrationFlow(phone, earlyText)
      if (handled) {
        return NextResponse.json({ ok: true })
      }

      // Pedro 2026-05-03 (Fix C): se a 1ª mensagem é uma pergunta legítima
      // (ex: "Tem o álbum capa dura?"), reconhecer a pergunta antes do
      // welcome padrão. Detecta por: tem "?" OU >25 chars sem ser saudação.
      const isGreeting = /^(oi+|ol[áa]+|hey|hi|e[ií]+|opa+|bom dia|boa tarde|boa noite|tudo bem|ola+)\s*[!.?]*\s*$/i.test(earlyText)
      const looksLikeQuestion = !!earlyText && !isGreeting && (
        earlyText.includes('?')
        || earlyText.length > 25
      )

      // Pedro 2026-05-09 (caso Bárbara): "Bem-vinda de volta" quando user
      // tinha pending_registration nos últimos 30d (mesmo expirado). Caso
      // real: Bárbara começou cadastro 2026-05-07, voltou 38h depois (após
      // pending expirar 24h), viu welcome cru de novo. Friction ruim.
      // Agora bot reconhece o retorno e dá CTA direto pra retomar.
      const supabaseAdminWelcome = getAdmin()
      const cutoff30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      const { data: priorPending } = await supabaseAdminWelcome
        .from('pending_registrations')
        .select('created_at, state, email')
        .eq('phone', phone)
        .gte('created_at', cutoff30d)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      const isReturningUser = !!priorPending
      const daysSincePrior = isReturningUser
        ? Math.max(1, Math.round((Date.now() - new Date(priorPending.created_at).getTime()) / 86400000))
        : 0

      if (looksLikeQuestion) {
        await sendText(
          phone,
          `📨 *Anotei sua mensagem!* Sou o assistente do *Complete Aí* ⚽\n\n` +
            `Pra te responder direito, preciso te conhecer. *Me passa seu email?* 📧\n\n` +
            `Depois do cadastro eu volto pra sua dúvida. ⚽\n\n` +
            `_Se preferir cadastro completo no site: ${APP_URL}/register?phone=${phone}_`,
        )
      } else if (isReturningUser) {
        // Pedro 2026-05-09 (caso Bárbara): mensagem específica pra quem volta
        const stateHint = priorPending.state === 'awaiting_name' && priorPending.email
          ? `Você já tinha mandado seu email (*${priorPending.email}*) — só falta me dizer *como devo te chamar*. 😊`
          : `Manda seu *email* aí (formato _seunome@gmail.com_) que eu retomo de onde parou. 📧`
        const timeHint = daysSincePrior === 1
          ? 'há 1 dia'
          : daysSincePrior < 7
            ? `há ${daysSincePrior} dias`
            : daysSincePrior < 14
              ? 'há mais de uma semana'
              : 'há um tempinho'
        await sendText(
          phone,
          `Oi de novo! 👋 Vi que você começou seu cadastro ${timeHint} e não terminou. ` +
            `Tudo bem, dá pra continuar daqui mesmo!\n\n` +
            stateHint +
            `\n\n_Se preferir cadastro pelo site: ${APP_URL}/register?phone=${phone}_`,
        )
      } else {
        await sendText(phone, getWelcomeMessage(phone))
      }
      // Create pending_registration in awaiting_email state — email-first flow
      // (next message é o email do user). Idempotent: ON CONFLICT reseta state.
      // Pedro 2026-05-04: ALÉM do upsert, salva pending_message quando a 1ª
      // mensagem foi uma dúvida legítima (looksLikeQuestion) — após signup
      // completar, re-processamos essa mensagem como follow-up.
      // Pedro 2026-05-09 (caso Bárbara): TTL agora é 7 DIAS em vez de 24h.
      // Users frequentemente voltam dias depois — perder estado em 24h era
      // fricção desnecessária. 7d é janela razoável pra retomada.
      const supabaseAdmin = getAdmin()
      await supabaseAdmin
        .from('pending_registrations')
        .upsert(
          {
            phone,
            state: 'awaiting_email',
            expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            pending_message: looksLikeQuestion ? earlyText : null,
          },
          { onConflict: 'phone' },
        )
      return NextResponse.json({ ok: true })
    }

    // ─── Audio ───
    // Download → transcribe via Gemini → re-route as text. Falls back to a
    // helpful menu if transcription fails so the user always has a path forward.
    // `cameFromAudio` flows down to the text handler so the register flow can
    // skip "manda uma foto" suggestions — the user já escolheu áudio, sugerir
    // outra modalidade só polui a resposta.
    let cameFromAudio = false
    if (messageType === 'audio') {
      // ── Limite de áudio (Pedro 2026-05-02) ──
      // free=10, estreante=30, colecionador+copa=ilimitado. Lifetime.
      // Bloqueio ANTES do transcribeAudio — se atingiu, não chama Gemini
      // (economia de custo + UX rápido). Foto = scanLimit; texto = sem limite.
      const userTier = ((user as { tier?: string }).tier || 'free') as Tier
      const audioLimit = getAudioLimit(userTier)
      const limitParam = audioLimit === Infinity ? -1 : audioLimit
      const supabaseAdmin = getAdmin()
      const { data: audioUsage, error: audioUsageErr } = await supabaseAdmin
        .rpc('increment_audio_usage', {
          p_user_id: user.id,
          p_limit: limitParam,
        })
      if (!audioUsageErr && audioUsage && !audioUsage.allowed) {
        const used = audioUsage.current ?? audioLimit
        console.log(`[WhatsApp] Audio limit hit user=${user.id} tier=${userTier} used=${used}/${audioLimit}`)
        trackEvent(user.id, FUNNEL_EVENTS.AUDIO_LIMIT_HIT, { tier: userTier, metadata: { used, limit: audioLimit } })
        // Mensagem em escada: se ainda tem scan, sugere foto. Senão, texto.
        // Sempre mostra TODAS as opções de upgrade.
        const quotas = await getQuotas(user.id, userTier)
        await sendText(phone, buildPaywallMessage(APP_URL, 'audio', quotas))
        return NextResponse.json({ ok: true })
      }
      if (audioUsageErr) {
        console.error('[WhatsApp] Audio usage check error:', audioUsageErr.message)
        // Não bloqueia em caso de erro de tracking — continua processando
      } else if (audioUsage) {
        console.log(`[WhatsApp] Audio usage user=${user.id} tier=${userTier} ${audioUsage.current}/${audioLimit === Infinity ? '∞' : audioLimit}`)
      }

      const audioUrl = body.audio?.audioUrl || body.audio?.url
      const audioBase64Inline = body.audio?.base64 || null

      let audio: { base64: string; mimeType: string } | null = null
      if (audioBase64Inline) {
        audio = { base64: audioBase64Inline, mimeType: body.audio?.mimetype || 'audio/ogg' }
      } else if (audioUrl) {
        audio = await downloadImage(audioUrl, msgId) // same Z-API media flow works for audio
      }

      if (!audio) {
        await sendButtonList(
          phone,
          '🎤 Não consegui baixar seu áudio. Tenta mandar de novo, ou escolhe uma opção:',
          MAIN_MENU_BUTTONS,
        )
        return NextResponse.json({ ok: true })
      }

      const transcribed = await transcribeAudio(audio.base64, audio.mimeType)
      if (!transcribed) {
        await sendButtonList(
          phone,
          '🎤 Não consegui entender o áudio. Tenta de novo (mais claro) ou escolhe uma opção:',
          MAIN_MENU_BUTTONS,
        )
        return NextResponse.json({ ok: true })
      }

      console.log(`[WhatsApp] Audio transcribed (${transcribed.length} chars): "${transcribed.slice(0, 100)}"`)
      // Funnel: registra uso de áudio + first_audio (idempotente).
      // Pedro 2026-05-03: pra rastrear conversão funil de quem usa áudio.
      const userTierAudio = ((user as { tier?: string }).tier || 'free') as Tier
      trackEvent(user.id, FUNNEL_EVENTS.AUDIO_USED, { tier: userTierAudio })
      void trackEventOnce(user.id, FUNNEL_EVENTS.FIRST_AUDIO, { tier: userTierAudio })
      // Inject transcribed text into body, retype as text, and let the text
      // handler below take over naturally.
      body.text = { message: transcribed }
      messageType = 'text'
      cameFromAudio = true
    }

    // ─── Image ───
    if (messageType === 'image') {
      // Pedro 2026-05-10 (Opt 2): captura payload da imagem ANTES de
      // qualquer decisão — pra poder enfileirar caso já tenha scan ou
      // pending em andamento.
      const imageUrl = body.image?.imageUrl || body.image?.url || body.imageUrl
      const imageBase64 = body.image?.base64 || body.base64 || null
      const imageCaptionRaw = (
        body.image?.caption ||
        body.caption ||
        body.image?.message ||
        ''
      ).toString().trim()
      const isQueryCaption = imageCaptionRaw.length > 0 && (
        /\b(tenho|tem|peguei|coloquei)\s*\??$/i.test(imageCaptionRaw) ||
        /\b(alguma|algumas)\s+(dessas|delas|destas)\b/i.test(imageCaptionRaw) ||
        /\bquais\s+(dessas|delas|destas|eu)\b/i.test(imageCaptionRaw) ||
        /\bj[áa]\s+(tenho|peguei|coloquei)\b/i.test(imageCaptionRaw) ||
        /\b(tem|tenho)\s+(alguma|alguma\s+coisa|essa|esse|essas|esses)\b/i.test(imageCaptionRaw)
      )

      if (!imageUrl && !imageBase64) {
        await sendText(phone, 'Não consegui baixar a imagem. Tenta mandar de novo? 📸')
        return NextResponse.json({ ok: true })
      }

      // Serializa: 1 registro por vez. Se já tem pending OU scan em
      // andamento (lock), enfileira a foto pra processar depois.
      const pendingItemsImg = await countPendingScanItems(user.id)
      const lockAcquired = pendingItemsImg === 0
        ? await tryAcquireScanLock(user.id, 5)
        : false

      if (!lockAcquired) {
        // Pedro 2026-05-10 (Opt 2 — caso Anabelle / "7 fotos juntas"):
        // em vez de descartar, enfileira pra processar automaticamente
        // após user confirmar a foto atual. Sem perda — só serializa.
        const enq = await enqueueImage({
          userId: user.id,
          phone,
          imageUrl: imageUrl || null,
          imageBase64: imageBase64 || null,
          mimeType: 'image/jpeg',
          caption: imageCaptionRaw || null,
          isQueryMode: isQueryCaption,
          msgId: msgId || null,
        })

        if (shouldSendWaitPending(user.id)) {
          if (enq) {
            const fila = enq.totalQueued
            const filaTxt = fila === 1
              ? '*1 foto* na fila pra ser processada após você confirmar a anterior.'
              : `*${fila} fotos* na fila pra serem processadas uma por vez após você confirmar a anterior.`
            const head = pendingItemsImg > 0
              ? '📸 *Recebi sua foto!*\n\nVocê ainda tem uma lista aguardando confirmação acima — responda *SIM* / *NÃO* primeiro.'
              : '📸 *Recebi sua foto!*\n\nEstamos analisando a anterior agora — em alguns segundos a lista chega.'
            await sendBotTextFor(
              user.id,
              phone,
              `${head}\n\n📥 ${filaTxt}\n\n_Vamos processar uma de cada vez automaticamente — só responda cada lista que aparecer._`,
            )
          } else if (pendingItemsImg > 0) {
            // Fallback: enqueue falhou. Mantém comportamento antigo (msg de wait)
            await sendBotTextFor(user.id, phone, buildWaitPendingMsg(pendingItemsImg))
          }
        }
        return NextResponse.json({ ok: true })
      }

      // Pedro 2026-05-06 (caso +55 67 98112-1341): caption "Eu tenho
      // alguma dessas?" → scan mode='query'. Captura já feita no topo
      // do handler como imageCaptionRaw / isQueryCaption.

      // Scan credits são checados dentro de /api/whatsapp/scan.
      // Download image
      let imageData: { base64: string; mimeType: string } | null = null
      if (imageBase64) {
        imageData = { base64: imageBase64, mimeType: 'image/jpeg' }
      } else {
        imageData = await downloadImage(imageUrl, msgId)
      }

      if (!imageData) {
        await releaseScanLock(user.id)
        await sendText(phone, 'Não consegui baixar a imagem. Tenta mandar de novo? 📸')
        return NextResponse.json({ ok: true })
      }

      await sendText(phone, '🔍 Analisando sua foto... aguarde!')

      // Run scan in background using waitUntil (continues after response)
      waitUntil(
        fetch(`${APP_URL}/api/whatsapp/scan`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-secret': process.env.SUPABASE_SERVICE_ROLE_KEY!,
          },
          body: JSON.stringify({
            base64: imageData.base64,
            mimeType: imageData.mimeType,
            phone,
            userId: user.id,
            mode: isQueryCaption ? 'query' : 'register',
          }),
        }).catch((err) => console.error('[WhatsApp] Failed to trigger scan:', err))
      )

      return NextResponse.json({ ok: true })
    }

    // ─── Text ───
    if (messageType === 'text') {
      // Pedro 2026-05-05 (caso Enzo "Oi! Vim do meu perfil. [link:TOKEN]"):
      // pra user JÁ conhecido (passou aqui na linha 1488), o auto-link não
      // roda — então o marker `[link:TOKEN]` ficava no texto e poluía o
      // matcher de figurinhas, que interpretava `[link:20...` como
      // pseudo-código `LINK-20` e pedaços do hex como `FC-65`. Strip
      // imediato resolve. Pra user desconhecido, o auto-link já roda
      // antes (linha 1504) e usa o token; depois o stripLinkToken roda
      // também (linha 1524). Aqui é a redundância pra user conhecido.
      let rawText = stripLinkToken(body.text?.message || body.body || body.message || '')

      if (!rawText.trim()) {
        return NextResponse.json({ ok: true })
      }

      // Pedro 2026-05-05 (caso Antonia +55 14 99159-2272): bot oferece
      // opções com emoji nas labels (🔍 O que falta, 🔁 Repetidas, 📊
      // Progresso) mas não reconhecia quando user respondia só com o
      // emoji. Map emoji-only → comando texto. ✅ é tratado em isYesConfirm
      // ANTES (se houver pending). 🔁 ambíguo entre Repetidas/Trocas —
      // padrão é Repetidas (mais comum em contexto de listas).
      // Pedro 2026-05-06 (casos +55 77 99950-8759, +55 16 99210-1400,
      // +55 19 99721-9803): mesmo bug pra LABELS exatas. Bot mostra
      // "👀 Top 50", "🇧🇷 Só Brasil", "📃 Tudo (em partes)" e quando user
      // digita o label exato (com ou sem emoji), bot caía no help. Map
      // estendido pra cobrir labels textuais também.
      const trimmedForEmoji = rawText.trim()
      const trimmedNorm = trimmedForEmoji
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .trim()
      const EMOJI_TO_COMMAND: Record<string, string> = {
        // Emojis solo
        '🔍': 'faltando',
        '📊': 'status',
        '🔁': 'repetidas',
        '👀': 'faltando top50',
        '📃': 'faltando todas',
        '🇧🇷': 'faltando brasil',
        '🏆': 'ranking',
        '⚽': 'menu',
        '🆘': 'ajuda',
        '✅': 'coladas', // só chega aqui se YesConfirm não pegou (sem pending)
      }
      // Labels textuais (normalizadas: lowercase, sem acento) — o bot
      // oferece nos botões e às vezes user copia/digita literalmente.
      const LABEL_TO_COMMAND: Record<string, string> = {
        // Variações de "Tudo (em partes)" / "Tudo em partes" / "Tudo"
        'tudo': 'faltando todas',
        'tudo em partes': 'faltando todas',
        'tudo (em partes)': 'faltando todas',
        '📃 tudo': 'faltando todas',
        '📃 tudo em partes': 'faltando todas',
        '📃 tudo (em partes)': 'faltando todas',
        // Top 50
        'top 50': 'faltando top50',
        'top50': 'faltando top50',
        '👀 top 50': 'faltando top50',
        '👀 top50': 'faltando top50',
        // Só Brasil
        'so brasil': 'faltando brasil',
        'só brasil': 'faltando brasil', // normalize remove o acento mas deixar por seguranca
        '🇧🇷 so brasil': 'faltando brasil',
        '🇧🇷 só brasil': 'faltando brasil',
        // O que falta
        'o que falta': 'faltando',
        '🔍 o que falta': 'faltando',
        // Repetidas
        '🔁 repetidas': 'repetidas',
        '🔁 minhas repetidas': 'repetidas',
        // Coladas
        '✅ coladas': 'coladas',
        // Trocas pendentes
        'trocas pendentes': 'trocas',
        '🔔 trocas pendentes': 'trocas',
        // Progresso
        'progresso': 'status',
        '📊 progresso': 'status',
        // Ajuda
        'ajuda': 'ajuda',
        '? ajuda': 'ajuda',
        '❓ ajuda': 'ajuda',
      }
      // Pedro 2026-05-07 (caso +55 21 98122-0974): user mandou ✅ depois
      // do bot mostrar lista pra registrar. EMOJI_TO_COMMAND traduzia
      // ✅ pra "coladas" ANTES do isYesConfirm rodar — em vez de salvar
      // os 7 itens, bot mostrava lista de coladas.
      // Fix: se ✅ E há pending_scans ativo → NÃO traduzir; deixa cair
      // no isYesConfirm (linha 2527) que vai registrar.
      let skipEmojiCheck = false
      if (trimmedForEmoji === '✅') {
        const adminCheck = getAdmin()
        const { data: hasPending } = await adminCheck
          .from('pending_scans')
          .select('id')
          .eq('user_id', user.id)
          .gt('expires_at', new Date().toISOString())
          .limit(1)
          .maybeSingle()
        if (hasPending) skipEmojiCheck = true
      }

      if (!skipEmojiCheck && EMOJI_TO_COMMAND[trimmedForEmoji]) {
        rawText = EMOJI_TO_COMMAND[trimmedForEmoji]
      } else if (LABEL_TO_COMMAND[trimmedNorm]) {
        rawText = LABEL_TO_COMMAND[trimmedNorm]
      }

      // Pré-processa nomes de países → códigos FIFA: "brasil 1, argentina 3" → "BRA 1, ARG 3".
      // Permite o user escrever do jeito natural sem decorar siglas.
      // Roda ANTES do expand de códigos agrupados pra que combinações tipo
      // "Brasil: 1, 10, 14" virem "BRA: 1, 10, 14" e depois "BRA-1 BRA-10 BRA-14".

      // Pré-processa códigos agrupados: "ARG: 1, 10, 14, 16" → "ARG-1 ARG-10 ARG-14 ARG-16".
      // Pedro pediu (2026-05-01) que o bot entenda esse formato natural.
      // Duas regras conservadoras pra evitar falso positivo em texto qualquer:
      //   A) `PAÍS: nums` (com dois-pontos) — single número também é OK
      //   B) `PAÍS nums` (sem dois-pontos, com espaço) — exige 2+ números, senão "tenho 5 figurinhas" viraria código
      // Separadores aceitos entre números: vírgula, ponto-e-vírgula, barra, espaço, "e".
      const expandWithColon = (txt: string) =>
        txt.replace(
          /([a-z]{2,5})\s*:\s*(\d{1,2}(?:[,;/\s]+(?:e\s+)?\d{1,2})*)/gi,
          (_m, country, nums) => {
            const ns = String(nums).match(/\d{1,2}/g) || []
            return ns.map((n) => `${country}-${n}`).join(' ')
          },
        )
      const expandMultiNoColon = (txt: string) =>
        txt.replace(
          /([a-z]{2,5})\s+(\d{1,2}(?:[,;/\s]+(?:e\s+)?\d{1,2})+)/gi,
          (_m, country, nums) => {
            const ns = String(nums).match(/\d{1,2}/g) || []
            return ns.map((n) => `${country}-${n}`).join(' ')
          },
        )
      // Pedro 2026-05-04 (caso giorgia): álbum Panini imprime "00" no slot
      // da figurinha "We are Panini" (que no DB chamamos FWC-0). User digita
      // "00" achando que é o código. Aceitar standalone "00" / "0" como
      // FWC-0 — só quando NÃO precedido por letras (senão "BRA 00" viraria
      // "BRA-00 FWC-0", o que não queremos).
      const expandStandaloneZero = (txt: string) =>
        txt.replace(/(^|[\s,;.])(00?)([\s,;.]|$)/g, (_m, before, _zeros, after) => `${before}FWC-0${after}`)

      // Pipeline:
      // 0) "C Z E 3"     → "CZE 3"       (collapseSpelledLetters) ← Pedro 2026-05-09 caso Cintia
      // 1) "Espanha três" → "Espanha 3"  (convertSpelledNumbersToDigits)
      // 2) "Espanha 3"   → "ESP 3"        (expandCountryNamesToCodes)
      // 3) "ESP: 1, 2"   → "ESP-1 ESP-2"  (expandWithColon)
      // 4) "ESP 1 2 3"   → "ESP-1 ESP-2 ESP-3" (expandMultiNoColon)
      // 5) " 00 " / " 0 " → " FWC-0 "    (expandStandaloneZero)
      // O passo 1 é crítico pra áudio: Gemini frequentemente transcreve
      // números por extenso quando o user fala o país por nome.
      // O passo 0 é crítico pra texto: user pode soletrar a sigla quando
      // não lembra como escreve (ex: Cintia mandou "C Z E 3 5 7").
      const text = expandStandaloneZero(
        expandMultiNoColon(
          expandWithColon(
            expandCountryNamesToCodes(
              convertSpelledNumbersToDigits(collapseSpelledLetters(rawText)),
            ),
          ),
        ),
      )

      const lower = text.trim().toLowerCase()

      // ─── Reset álbum / zerar progresso (Pedro 2026-05-05, caso Enzo) ───
      // Two-phase: 1) detecta intenção → mostra contagem + pede confirmação
      // explícita "APAGAR TUDO". 2) Próxima mensagem: se for "APAGAR TUDO"
      // executa, qualquer outra coisa cancela. Pending guardado em
      // pending_scans com source='reset_album_confirm'.
      // Cobre typos ("progesso") e variantes ("deletar todas as figurinhas")
      const isResetIntent = /^(zerar|resetar|apagar|limpar|deletar|excluir)\s+(?:o\s+|todas?\s+(?:as\s+)?)?(progress[oa]|progess[oa]|[áa]lbum|tudo|figurinhas|cromos|cole[çc][ãa]o|cadastro)\.?$/i.test(lower) ||
        /^(zerar|reset|apagar tudo|limpar tudo|come[çc]ar do zero|recome[çc]ar)\.?$/i.test(lower)

      // Confirmação: exige exatamente "apagar tudo" (qualquer caixa).
      // Pedro 2026-05-05: case-insensitive ok, mas qualquer outra coisa
      // cancela (evita reset acidental por user que digita "sim" rápido).
      const userTypedApagarTudoCaps = text.trim().toLowerCase() === 'apagar tudo'

      // Verifica se há pending de reset esperando confirmação
      const supabaseResetCheck = getAdmin()
      const { data: resetPending } = await supabaseResetCheck
        .from('pending_scans')
        .select('id')
        .eq('user_id', user.id)
        .eq('source', 'reset_album_confirm')
        .gt('expires_at', new Date().toISOString())
        .maybeSingle()

      if (resetPending) {
        // Tem pending de reset — esta mensagem é a confirmação
        if (userTypedApagarTudoCaps) {
          // Executa reset: apaga TODOS os user_stickers
          const { error: delErr, count } = await supabaseResetCheck
            .from('user_stickers')
            .delete({ count: 'exact' })
            .eq('user_id', user.id)
          if (delErr) {
            console.error('[wa-reset] delete err:', delErr)
            await sendText(phone, '❌ Erro ao zerar o álbum. Tenta de novo daqui a pouco.')
          } else {
            // Limpa o pending
            await supabaseResetCheck.from('pending_scans').delete().eq('id', resetPending.id)
            await sendText(
              phone,
              `🗑️ *Álbum zerado.* Apagamos *${count ?? 0}* figurinha(s) do seu álbum.\n\n` +
                `Pode começar do zero quando quiser. ⚽`,
            )
          }
        } else {
          // Qualquer outra mensagem → cancela o reset
          await supabaseResetCheck.from('pending_scans').delete().eq('id', resetPending.id)
          await sendText(
            phone,
            `✅ *Reset cancelado.* Suas figurinhas estão a salvo.\n\n` +
              `_Se mudar de ideia, manda *zerar progresso* de novo._`,
          )
        }
        return NextResponse.json({ ok: true })
      }

      if (isResetIntent) {
        // Conta as figurinhas atuais e cria pending de confirmação
        const { count: ownedCount } = await supabaseResetCheck
          .from('user_stickers')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)

        if (!ownedCount) {
          await sendText(phone, '🤔 Seu álbum já está vazio — não tem nada pra zerar.')
          return NextResponse.json({ ok: true })
        }

        // Insere pending com TTL curto (10 minutos)
        await supabaseResetCheck.from('pending_scans').insert({
          user_id: user.id,
          phone,
          scan_data: [],
          source: 'reset_album_confirm',
          expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        })

        await sendText(
          phone,
          `⚠️ *Atenção: isto vai APAGAR ${ownedCount} figurinha(s)* marcadas no seu álbum.\n\n` +
            `Essa ação *não pode ser desfeita*.\n\n` +
            `Se tiver certeza, responde exatamente:\n*APAGAR TUDO*\n\n` +
            `Qualquer outra resposta cancela.`,
        )
        return NextResponse.json({ ok: true })
      }

      // ─── Vincular conta / conectar (Pedro 2026-05-05, caso Enzo) ───
      // User pediu pra conectar conta. Se já tá conhecido por phone,
      // explica que já tá conectado + oferece troca via email. Se for
      // unknown, cai no fluxo de cadastro normal (não chega aqui).
      // Cobre: "conectar conta", "quero conectar a conta", "mas eu quero
      // vincular minha conta", "vincular whatsapp", "linkar email", etc.
      const isConnectAccountIntent =
        /^(?:(?:mas|mais|por[ée]m)\s+)?(?:eu\s+)?(?:quero|gostaria(?:\s+de)?|preciso|posso|como)?\s*(?:conectar|vincular|ligar|associar|linkar|registrar)\s+(?:a\s+|minha\s+|meu\s+)?(?:conta|whatsapp|wpp|wassap|email|cadastro)\.?$/i.test(lower)

      if (isConnectAccountIntent) {
        // Aqui o user já é conhecido (passou pela findUserByPhone). Logo,
        // já está conectado. Explica e oferece a troca de email.
        const supabaseAdminCC = getAdmin()
        const { data: profCC } = await supabaseAdminCC
          .from('profiles')
          .select('email, display_name')
          .eq('id', user.id)
          .maybeSingle()
        const firstName = (profCC?.display_name || '').split(' ')[0]
        const emailMasked = profCC?.email ? `${profCC.email.slice(0, 3)}***${profCC.email.slice(profCC.email.indexOf('@'))}` : ''
        await sendText(
          phone,
          `🔗 *${firstName ? firstName + ', s' : 'S'}eu WhatsApp já está conectado* à conta ${emailMasked || 'cadastrada'}. ✅\n\n` +
            `Se quiser trocar pra outra conta, manda o *email da nova conta* aqui que a gente vincula.\n\n` +
            `_Ou se quiser ver tudo que dá pra fazer aqui, manda *menu*._`,
        )
        return NextResponse.json({ ok: true })
      }

      // ─── Comandos de alertas de match (Pedro 2026-05-04) ───
      // "parar alertas", "menos alertas", "mais alertas", "alertas" (sozinho).
      // Atualiza profiles.match_alerts_freq e responde com status.
      const alertasMatch = lower.trim().match(
        /^(?:(parar|desativar|desligar|stop)\s+alertas?|(menos|diminuir)\s+alertas?|(mais|aumentar)\s+alertas?|(alertas?|alertas\s+de\s+match|configurar?\s+alertas?))\s*\.?$/i,
      )
      if (alertasMatch) {
        const supabaseAdmin = getAdmin()
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.completeai.com.br'
        // 1=parar, 2=menos, 3=mais, 4=ver status
        let newFreq: 'off' | 'low' | 'normal' | 'high' | null = null
        if (alertasMatch[1]) newFreq = 'off'
        else if (alertasMatch[2]) newFreq = 'low'
        else if (alertasMatch[3]) newFreq = 'high'
        // alertasMatch[4] = só ver/configurar — não muda

        if (newFreq) {
          await supabaseAdmin.from('profiles').update({ match_alerts_freq: newFreq }).eq('id', user.id)
        }

        const { data: prof } = await supabaseAdmin
          .from('profiles')
          .select('match_alerts_freq')
          .eq('id', user.id)
          .maybeSingle()
        const freq = ((prof as { match_alerts_freq?: string } | null)?.match_alerts_freq || 'normal') as 'off' | 'low' | 'normal' | 'high'

        const freqLabel: Record<typeof freq, string> = {
          off:    '🔕 *Desligado* — nenhum alerta',
          low:    '⬇️ *Pouco* — 1/dia (mín 12h entre)',
          normal: '⚖️ *Normal* — 2/dia (mín 6h entre)',
          high:   '⬆️ *Mais* — 4/dia (mín 3h entre)',
        }

        let reply: string
        if (newFreq) {
          reply = `✅ Alertas atualizados: ${freqLabel[freq]}\n\n` +
            `_Alertas só vão quando há troca real (você ganha + você dá)._`
        } else {
          reply = `📣 *Alertas de match perto de você*\n\n` +
            `Status atual: ${freqLabel[freq]}\n\n` +
            `*Comandos rápidos:*\n` +
            `🔕 *parar alertas* → desliga\n` +
            `⬇️ *menos alertas* → 1/dia\n` +
            `⬆️ *mais alertas* → 4/dia\n\n` +
            `⚙️ Outras configs (raio, figurinhas específicas):\n${appUrl}/trades`
        }
        await sendText(phone, reply)
        return NextResponse.json({ ok: true })
      }

      // ─── Promessa de envio (Pedro 2026-05-04, caso Pedro Arcari) ───
      // User mandou "Vou mandar as q faltam" — claramente promessa de envio
      // futuro, NÃO pedido de listagem. Bot antes interpretava como intent
      // 'missing' e mandava lista das 979 faltantes. Errado.
      // Detecta: verbo no futuro próximo ("vou X" / "tô indo X" / "ja vou X"
      // / "irei X") + algo sobre figurinhas/fotos/áudio/texto/que faltam.
      // Apenas no INÍCIO da mensagem pra evitar falsos positivos.
      const promiseMatch =
        /^(j[áa]\s+)?(vou|tou\s+indo|to\s+indo|t[ôo]\s+indo|t[ôo]\s+pra|ir(ei|ia)\s+|vou\s+ja\s+)\s*(mand|envi|post|tirar|fazer|colocar|botar|jogar|pass|gravar|escrev|registr|tentar)/i.test(lower)
      const aboutStickers =
        /(figurinha|cromo|foto|audio|[áa]udio|texto|que\s+faltam?|repetidas?|coladas?)/i.test(lower)
      if (promiseMatch && aboutStickers) {
        await sendText(
          phone,
          `👍 *Beleza, pode mandar!* Tô esperando aqui.\n\n` +
            `📸 *Foto* das figurinhas — eu identifico com IA\n` +
            `🎤 *Áudio* falando os códigos (ex: _"Brasil 1, Argentina 3"_)\n` +
            `✏️ *Texto* tipo _"BRA-1 ARG-3"_`,
        )
        return NextResponse.json({ ok: true })
      }

      // ─── Deep-link CTAs do site (Pedro 2026-05-04) ───
      // User logado clica num botão WhatsApp dentro do site → abre wa.me
      // com frase contextual ("Quero registrar minhas figurinhas por foto",
      // etc). Bot reconhece e dispara CTA da modalidade — sem precisar passar
      // por intent classifier. Match no INÍCIO da mensagem pra não confundir
      // com queries livres tipo "como faço pra registrar por foto?".
      if (/^(quero|gostaria de|gostaria|quero come[çc]ar a|vou) registrar (minhas )?figurinhas? por foto/i.test(lower)) {
        await sendText(
          phone,
          `📸 *Manda a foto agora!* Eu identifico todas as figurinhas com IA.\n\n` +
            `_Dica: foto bem iluminada, até 10 figurinhas por vez = scan perfeito._`,
        )
        return NextResponse.json({ ok: true })
      }
      if (/^(quero|gostaria de|gostaria|quero come[çc]ar a|vou) registrar (minhas )?figurinhas? por [áa]udio/i.test(lower)) {
        await sendText(
          phone,
          `🎤 *Manda um áudio agora* falando os códigos das figurinhas.\n\n` +
            `Exemplos:\n` +
            `• _"Brasil 1, Argentina 3, Marrocos 5"_\n` +
            `• _"BRA 14, FRA 10, ESP 4"_\n\n` +
            `Nós transcrevemos e registramos tudo. ⚽`,
        )
        return NextResponse.json({ ok: true })
      }
      if (/^(quero|gostaria de|gostaria|quero come[çc]ar a|vou) registrar (minhas )?figurinhas? por texto/i.test(lower)) {
        await sendText(
          phone,
          `✏️ *Manda os códigos por texto!*\n\n` +
            `Exemplos:\n` +
            `• _"BRA-1 ARG-3 FRA-10"_\n` +
            `• _"Brasil 1, Argentina 3"_\n\n` +
            `Eu registro de uma vez só. ⚽`,
        )
        return NextResponse.json({ ok: true })
      }

      // ─── Pending corrections (bug auditoria → SIM/NÃO) ───
      // Quando o admin (ou um script) detecta um cromo registrado errado e
      // enfileira uma `pending_correction`, o user recebe uma mensagem
      // explicando o erro e pedindo autorização. Esta seção captura a
      // resposta SIM/NÃO ANTES do intent detection — senão "sim" cairia
      // no help via Gemini.
      const isYes = /^(sim|s|si|ok|claro|pode|pode sim|aceito|confirmo|👍|✅|isso)\.?$/i.test(lower)
      const isNo = /^(n[aã]o|n|nao|n\.|nope|negativo|prefiro nao|prefiro não|❌|🚫)\.?$/i.test(lower)
      if (isYes || isNo) {
        const supabaseAdmin = getAdmin()
        // Carrega TODAS as corrections pendentes do user (não só 1) — um SIM
        // aprova o bundle inteiro. Isso é importante quando o admin enfileira
        // múltiplas correções de uma vez (ex: 2 cromos Coca-Cola pro mesmo user).
        const { data: pendings } = await supabaseAdmin
          .from('pending_corrections')
          .select('id, wrong_sticker_id, correct_sticker_id, scans_bonus, expires_at, wrong_sticker:stickers!pending_corrections_wrong_sticker_id_fkey(number, player_name), correct_sticker:stickers!pending_corrections_correct_sticker_id_fkey(number, player_name)')
          .eq('user_id', user.id)
          .eq('status', 'pending')
          .gt('expires_at', new Date().toISOString())
          .order('created_at', { ascending: true })

        type Correction = {
          id: number
          wrong_sticker_id: number
          correct_sticker_id: number
          scans_bonus: number
          wrong_sticker: { number: string; player_name: string }
          correct_sticker: { number: string; player_name: string }
        }
        const corrections = (pendings || []) as unknown as Correction[]

        if (corrections.length > 0) {
          if (isNo) {
            // Rejeita TODAS pendentes do user
            await supabaseAdmin
              .from('pending_corrections')
              .update({ status: 'rejected', resolved_at: new Date().toISOString() })
              .eq('user_id', user.id)
              .eq('status', 'pending')
            await sendText(phone, '👍 Tudo bem, mantive como está. Obrigado pelo retorno!')
            return NextResponse.json({ ok: true })
          }

          // SIM — reivindicar TODAS de uma vez (race-safe: WHERE status='pending')
          const { data: claimed } = await supabaseAdmin
            .from('pending_corrections')
            .update({ status: 'approved', resolved_at: new Date().toISOString() })
            .eq('user_id', user.id)
            .eq('status', 'pending')
            .select('id, wrong_sticker_id, correct_sticker_id, scans_bonus')

          if (!claimed || claimed.length === 0) {
            // Race lost — outra request reivindicou primeiro
            return NextResponse.json({ ok: true })
          }
          const claimedIds = new Set((claimed as Array<{ id: number }>).map((c) => c.id))
          const claimedCorrections = corrections.filter((c) => claimedIds.has(c.id))

          // Aplicar cada correção (sequencial, mas atômico por sticker_id)
          const applied: Correction[] = []
          for (const correction of claimedCorrections) {
            // 1. Decrementar/remover cromo errado
            const { data: wrongRow } = await supabaseAdmin
              .from('user_stickers')
              .select('quantity, status')
              .eq('user_id', user.id)
              .eq('sticker_id', correction.wrong_sticker_id)
              .maybeSingle()
            if (wrongRow) {
              const newQty = Math.max(0, (wrongRow.quantity || 1) - 1)
              if (newQty === 0) {
                await supabaseAdmin
                  .from('user_stickers')
                  .delete()
                  .eq('user_id', user.id)
                  .eq('sticker_id', correction.wrong_sticker_id)
              } else {
                const newStatus = newQty > 1 ? 'duplicate' : 'owned'
                await supabaseAdmin
                  .from('user_stickers')
                  .update({ quantity: newQty, status: newStatus })
                  .eq('user_id', user.id)
                  .eq('sticker_id', correction.wrong_sticker_id)
              }
            }

            // 2. Adicionar/incrementar cromo certo
            const { data: correctRow } = await supabaseAdmin
              .from('user_stickers')
              .select('quantity, status')
              .eq('user_id', user.id)
              .eq('sticker_id', correction.correct_sticker_id)
              .maybeSingle()
            if (correctRow) {
              const newQty = (correctRow.quantity || 0) + 1
              const newStatus = newQty > 1 ? 'duplicate' : 'owned'
              await supabaseAdmin
                .from('user_stickers')
                .update({ quantity: newQty, status: newStatus })
                .eq('user_id', user.id)
                .eq('sticker_id', correction.correct_sticker_id)
            } else {
              await supabaseAdmin
                .from('user_stickers')
                .insert({
                  user_id: user.id,
                  sticker_id: correction.correct_sticker_id,
                  quantity: 1,
                  status: 'owned',
                })
            }
            applied.push(correction)
          }

          // 3. Somar TODOS os scans_bonus do bundle e creditar de uma vez
          const totalBonus = applied.reduce((sum, c) => sum + (c.scans_bonus || 0), 0)
          if (totalBonus > 0) {
            const { data: profileRow } = await supabaseAdmin
              .from('profiles')
              .select('scan_credits')
              .eq('id', user.id)
              .single()
            if (profileRow) {
              await supabaseAdmin
                .from('profiles')
                .update({ scan_credits: (profileRow.scan_credits || 0) + totalBonus })
                .eq('id', user.id)
            }
          }

          // 4. Confirmar — lista TODAS as correções do bundle
          const lines = applied.map((c) =>
            `❌ ${c.wrong_sticker.number} ${c.wrong_sticker.player_name}\n   ✅ ${c.correct_sticker.number} ${c.correct_sticker.player_name}`
          )
          const header = applied.length === 1
            ? `✅ *Pronto!* Corrigi pra você:`
            : `✅ *Pronto!* Corrigi *${applied.length}* cromos pra você:`
          const bonusLine = totalBonus > 0
            ? `\n🎁 *+${totalBonus} scans grátis* creditados na sua conta como pedido de desculpas pelo erro.\n`
            : ''
          await sendText(
            phone,
            `${header}\n\n${lines.join('\n\n')}\n${bonusLine}\nObrigado pela paciência! ⚽`,
          )
          return NextResponse.json({ ok: true })
        }
        // Se não tem correction pendente, deixa o sim/não fluir pro flow normal (cancelar pending_scan, etc.)
      }

      // ─── "tirar N" / "remover N,M" / "tirar BRA-1" — drop items from pending list ───
      // The user-facing list is numbered 1..N over the LATEST pending_scan
      // (the one this WhatsApp scan reply just rendered). Comma, space and
      // the connector "e" are all accepted: "tirar 3", "tirar 2,5", "tirar 2 e 5".
      // Pedro 2026-05-04: pendings paralelos. Numeração agora é GLOBAL (1..N
      // ao longo de todos pendings ordenados por created_at). "tirar N"
      // localiza o item global N e remove só do pending dele.
      // Pedro 2026-05-05: caso Rafaella ("Remove item 2 e item 3"). Bot
      // não entendia "item N" como filler. Fix: pre-processa o texto
      // removendo as palavras item/cromo/figurinha antes do match.
      // Pedro 2026-05-05 (PARTE 2): "tirar BRA-1" / "remover URU20" também
      // deve remover do PENDING (não do álbum) quando há pending ativo.
      // Antes ia pro 'remove' intent (album) — UX errada.
      const cleanedForRemove = lower.trim().replace(/\b(item|cromo|figurinha)s?\b/gi, '').replace(/\s+/g, ' ').trim()
      // Captura QUALQUER coisa após o verbo (não só dígitos). Deixa o
      // parsing de índices/códigos pra dentro do bloco — mais flexível.
      const removeMatch = cleanedForRemove.match(/^(?:tirar|tira|remover|remove)\s+(.+)$/i)
      if (removeMatch) {
        const supabaseAdmin = getAdmin()
        const { data: allPendingRows } = await supabaseAdmin
          .from('pending_scans')
          .select('id, scan_data, source, created_at')
          .eq('user_id', user.id)
          .gt('expires_at', new Date().toISOString())
          .order('created_at', { ascending: true })
        const allPendings = (allPendingRows || []) as PendingScanRow[]

        // Pedro 2026-05-05: se NÃO tem pending ativo, NÃO tratar aqui.
        // Deixa cair pro 'remove' intent (linha ~2664) que remove do álbum
        // com confirmação SIM/NÃO. Isso preserva o fluxo "tirar BRA-1"
        // sem pending = remover do álbum.
        if (allPendings.length === 0) {
          // Fall through — não responde nada
        } else {

        // Mapeia índice global → (pending, item_idx_local)
        type FlatItem = { pendingId: number; localIdx: number; item: PendingItem }
        const flat: FlatItem[] = []
        for (const p of allPendings) {
          const items = p.scan_data || []
          for (let i = 0; i < items.length; i++) flat.push({ pendingId: p.id, localIdx: i, item: items[i] })
        }
        const totalItems = flat.length

        const restAfterVerb = removeMatch[1]

        // 1) Extrai códigos de figurinha (BRA-1, BRA1, ARG 10, FWC-0 etc)
        //    e marca quais estão no pending. Caso bata, remove do "rest"
        //    pra não duplicar na extração de índices puros.
        const codeRegex = /\b([a-z]{2,5})[-\s]?(\d{1,2})\b/gi
        const codeMatches = Array.from(restAfterVerb.matchAll(codeRegex))
        let restWithoutCodes = restAfterVerb
        const codeIndices: number[] = []
        for (const cm of codeMatches) {
          const codeStr = `${cm[1].toUpperCase()}-${cm[2]}`
          // Procura no flat pelo número (case-insensitive). Pega TODAS
          // ocorrências caso o user tenha o mesmo código em pendings
          // diferentes (raro mas possível).
          flat.forEach((f, i) => {
            if (f.item.number?.toUpperCase() === codeStr) {
              codeIndices.push(i + 1) // 1-indexed
            }
          })
          // Remove o trecho do código pra evitar contagem dupla
          restWithoutCodes = restWithoutCodes.replace(cm[0], ' ')
        }

        // 2) Extrai índices puros (números que NÃO faziam parte de código)
        const numericParsed: number[] = (restWithoutCodes.match(/\d+/g) || [])
          .map((d: string) => parseInt(d, 10))
          .filter((n: number) => Number.isInteger(n) && n >= 1 && n <= totalItems)

        const indicesGlobal: number[] = Array.from(new Set<number>([...numericParsed, ...codeIndices])).sort((a, b) => a - b)

        if (indicesGlobal.length === 0) {
          // Não bateu com nada do pending — pode ser que user quis remover
          // do álbum (mas tem pending). Mostra a lista atual e oferece duas vias.
          const codesUnmatched = codeMatches.map((cm) => `${cm[1].toUpperCase()}-${cm[2]}`).join(', ')
          let msg = `❓ `
          if (codesUnmatched) {
            msg += `Não achei *${codesUnmatched}* no registro atual aguardando confirmação.\n\n`
          } else {
            msg += `Não entendi o que tirar. A lista tem ${totalItems} item(s).\n\n`
          }
          msg += `Lista atual:\n` + buildAggregatedPendingMsg(allPendings) + `\n\n`
          msg += `Use *tirar 1* (por número) ou *tirar BRA-1* (por código). Pra remover do álbum, manda *cancelar* primeiro pra fechar o registro pendente.`
          await sendText(phone, msg)
          return NextResponse.json({ ok: true })
        }

        // Agrupa removals por pending_id e aplica
        const removalsByPending = new Map<number, Set<number>>()  // pendingId → set de localIdx
        const removedItems: PendingItem[] = []
        for (const g of indicesGlobal) {
          const f = flat[g - 1]
          if (!removalsByPending.has(f.pendingId)) removalsByPending.set(f.pendingId, new Set())
          removalsByPending.get(f.pendingId)!.add(f.localIdx)
          removedItems.push(f.item)
        }

        let totalScanRefund = 0
        for (const p of allPendings) {
          const removeSet = removalsByPending.get(p.id)
          if (!removeSet) continue
          const newItems = (p.scan_data || []).filter((_, i) => !removeSet.has(i))
          if (newItems.length === 0) {
            // Pending inteiro foi esvaziado — deleta + refund
            await supabaseAdmin.from('pending_scans').delete().eq('id', p.id)
            totalScanRefund++
          } else {
            await supabaseAdmin.from('pending_scans').update({ scan_data: newItems }).eq('id', p.id)
          }
        }
        if (totalScanRefund > 0) {
          await supabaseAdmin.rpc('decrement_scan_usage', { p_user_id: user.id, p_count: totalScanRefund })
        }

        // Re-fetch pendings restantes pra rebuild da mensagem agregada
        const { data: remainingRows } = await supabaseAdmin
          .from('pending_scans')
          .select('id, scan_data, source, created_at')
          .eq('user_id', user.id)
          .gt('expires_at', new Date().toISOString())
          .order('created_at', { ascending: true })
        const remaining = (remainingRows || []) as PendingScanRow[]

        const removedSummary = removedItems.map((s) => `${s.number} ${s.player_name}`.trim()).join(', ')

        if (remaining.length === 0) {
          await sendText(
            phone,
            `❌ Removidas todas as ${removedItems.length} figurinha(s) dos registros.${totalScanRefund > 0 ? ` *Não contou ${totalScanRefund} scan(s)* — ` : ' '}manda outra foto, áudio ou texto se quiser!`,
          )
        } else {
          let reply = `🗑️ Removido: *${removedSummary}*\n\n`
          reply += buildAggregatedPendingMsg(remaining)
          await sendBotTextFor(user.id, phone, reply)
        }
        return NextResponse.json({ ok: true })
        } // close: if (allPendings.length > 0) — sem pending cai pra 'remove' intent
      }

      // ─── "Cancelar registro N" / "cancela foto" / "cancela texto" / "cancela áudio" ───
      // Pedro 2026-05-04: deletar pending_scan inteiro especificado pelo
      // número (ordem) ou pela origem (foto/texto/áudio).
      const cancelRegMatch =
        lower.trim().match(/^(?:cancela|cancelar|cancele|excluir|remov[ae]r?)\s+(?:o\s+)?(?:registro\s+)?(\d+|foto|[áa]udio|texto)\.?$/i)
      if (cancelRegMatch) {
        const target = cancelRegMatch[1].toLowerCase()
        const supabaseAdmin = getAdmin()
        const { data: allPendingRows } = await supabaseAdmin
          .from('pending_scans')
          .select('id, scan_data, source, created_at')
          .eq('user_id', user.id)
          .gt('expires_at', new Date().toISOString())
          .order('created_at', { ascending: true })
        const allPendings = (allPendingRows || []) as PendingScanRow[]

        if (allPendings.length === 0) {
          await sendText(phone, '🤔 Não tenho nenhum registro aguardando confirmação.')
          return NextResponse.json({ ok: true })
        }

        let toDelete: PendingScanRow | undefined
        if (/^\d+$/.test(target)) {
          const n = parseInt(target, 10)
          if (n >= 1 && n <= allPendings.length) toDelete = allPendings[n - 1]
        } else if (target === 'foto') {
          toDelete = allPendings.find((p) => p.source === 'photo')
        } else if (target === 'audio' || target === 'áudio') {
          toDelete = allPendings.find((p) => p.source === 'audio')
        } else if (target === 'texto') {
          toDelete = allPendings.find((p) => p.source === 'text')
        }

        if (!toDelete) {
          await sendText(phone, `❓ Não achei esse registro. Você tem ${allPendings.length} pendente(s). Tenta *cancelar registro 1* ou *cancela foto*.`)
          return NextResponse.json({ ok: true })
        }

        const removedCount = toDelete.scan_data?.length || 0
        await supabaseAdmin.from('pending_scans').delete().eq('id', toDelete.id)
        await supabaseAdmin.rpc('decrement_scan_usage', { p_user_id: user.id, p_count: 1 })

        const { data: remainingRows } = await supabaseAdmin
          .from('pending_scans')
          .select('id, scan_data, source, created_at')
          .eq('user_id', user.id)
          .gt('expires_at', new Date().toISOString())
          .order('created_at', { ascending: true })
        const remaining = (remainingRows || []) as PendingScanRow[]

        const { emoji, label } = sourceLabel(toDelete.source)
        let reply = `🗑️ *Cancelado o ${emoji} registro de ${label}* (${removedCount} item${removedCount !== 1 ? 's' : ''}). *Não contou scan.*\n\n`
        if (remaining.length === 0) {
          reply += `Não tem mais nada pendente. Manda outra foto/áudio/texto quando quiser!`
        } else {
          reply += buildAggregatedPendingMsg(remaining)
        }
        await sendBotTextFor(user.id, phone, reply)
        return NextResponse.json({ ok: true })
      }

      // ─── Undo da última ação destrutiva (Pedro 2026-05-09, caso Cintia) ───
      // Caso real: Cintia mandou "Sim" achando que era registro, removeu 9
      // cromos sem querer, depois mandou "Não" tentando reverter mas o bot
      // caiu em fallback. Solução: TTL 10min em profiles.last_reversible_action
      // permite "desfaz" / "desfazer" / "errei" / "volta" pra reverter.
      //
      // Pedro 2026-05-10 (caso Bruna): undo agora cobre TAMBÉM registro
      // errado (scan leu FWC-2 quando era FWC-8). Snapshot é gravado
      // ANTES do batchSave em pending_scans flow. type='register_stickers'.
      const isUndoIntent = /^(desfaz|desfazer|desfa[çc]a|errei(\s+isso|\s+a\s+remo[çc][ãa]o|\s+o\s+registro|\s+ao?\s+registro)?|tava\s+errad[ao]|estava\s+errad[ao]|me\s+arrependi|volta(r)?(\s+(tudo|as\s+figurinhas?|os\s+cromos?))?|n[ãa]o\s+era\s+pra\s+(remover|registrar)|removi\s+errad[ao]|registrei\s+errad[ao]|cancela\s+(a\s+)?(remo[çc][ãa]o|registro))\.?$/i.test(lower.trim())
      if (isUndoIntent) {
        const supabaseAdminUndo = getAdmin()
        const { data: undoProfile } = await supabaseAdminUndo
          .from('profiles')
          .select('last_reversible_action')
          .eq('id', user.id)
          .single()
        const action = undoProfile?.last_reversible_action as
          | { type: string; executed_at: string; stickers: Array<{ sticker_id: number; number: string; status_before: string; quantity_before: number }> }
          | null
        if (
          !action ||
          (action.type !== 'remove_stickers' &&
            action.type !== 'register_stickers' &&
            action.type !== 'clear_duplicates')
        ) {
          await sendText(phone, '🤔 Não temos nenhuma ação recente pra desfazer. Se você precisa registrar uma figurinha, manda o código (ex: *BRA-1*) ou uma foto.')
          return NextResponse.json({ ok: true })
        }
        const elapsedMin = (Date.now() - new Date(action.executed_at).getTime()) / 60000
        if (elapsedMin > 10) {
          const verb = action.type === 'register_stickers'
            ? 'registro'
            : action.type === 'clear_duplicates'
              ? 'limpeza de repetidas'
              : 'remoção'
          await sendText(phone, `⏰ A última ${verb} foi há ${Math.round(elapsedMin)}min — janela de undo é 10min. Se precisar ajustar, manda os códigos (*${action.stickers.slice(0, 3).map(s => s.number).join(', ')}${action.stickers.length > 3 ? '...' : ''}*).`)
          return NextResponse.json({ ok: true })
        }
        // Restaura: upsert volta cada cromo pro estado anterior.
        // Para register_stickers: status_before='missing'/quantity_before=0 ⇒
        // upsert grava missing/0 (equivalente a deletar da perspectiva do user).
        // Para remove_stickers: traz de volta o status/quantidade que tinha.
        const restorePayload = action.stickers.map((s) => ({
          user_id: user.id,
          sticker_id: s.sticker_id,
          status: s.status_before,
          quantity: s.quantity_before,
          updated_at: new Date().toISOString(),
        }))
        const { error: undoErr, data: undoData } = await supabaseAdminUndo
          .from('user_stickers')
          .upsert(restorePayload, { onConflict: 'user_id,sticker_id' })
          .select('sticker_id')
        if (undoErr) {
          console.error(`[wa-undo] FAILED user=${user.id} type=${action.type}:`, undoErr.message)
          await sendText(phone, '⚠️ Não conseguimos desfazer agora. Tenta de novo em alguns minutos? 🙏')
          return NextResponse.json({ ok: true })
        }
        // Limpa a ação reversível (consumida)
        await supabaseAdminUndo
          .from('profiles')
          .update({ last_reversible_action: null })
          .eq('id', user.id)
        const affectedCount = undoData?.length ?? action.stickers.length
        const stats = await safeGetUserStats(user.id, phone)
        if (!stats) return NextResponse.json({ ok: true })
        let reply: string
        if (action.type === 'register_stickers') {
          reply = `↩️ *Desfeito!* Removemos do seu álbum ${affectedCount} figurinha(s) que tinha registrado por engano:\n`
          reply += action.stickers.map((s) => `• ${s.number}`).join('\n')
          reply += `\n\nSe quiser tentar de novo, manda outra foto mais nítida ou o código direto (ex: *BRA-1*).`
          reply += `\n\n📊 Progresso: *${stats.owned}/${stats.total}* (${stats.pct}%)`
        } else if (action.type === 'clear_duplicates') {
          const totalRestored = action.stickers.reduce((sum, s) => sum + Math.max(0, s.quantity_before - 1), 0)
          reply = `↩️ *Desfeito!* Restauramos as quantidades de ${affectedCount} cromo(s) (${totalRestored} unidade(s) extra(s) de volta):\n`
          // mostra só os 5 primeiros pra não floodar
          const sample = action.stickers.slice(0, 5)
          reply += sample.map((s) => `• ${s.number} _(qty ${s.quantity_before})_`).join('\n')
          if (action.stickers.length > 5) {
            reply += `\n• _e mais ${action.stickers.length - 5}..._`
          }
          reply += `\n\n📊 Progresso: *${stats.owned}/${stats.total}* (${stats.pct}%)`
        } else {
          reply = `↩️ *Desfeito!* Re-adicionamos ${affectedCount} figurinha(s):\n`
          reply += action.stickers.map((s) => `• ${s.number}`).join('\n')
          reply += `\n\n📊 Progresso: *${stats.owned}/${stats.total}* (${stats.pct}%)`
        }
        await sendText(phone, reply)
        // Pedro 2026-05-10 (Opt 2): após desfazer, dispara próxima foto
        // da fila se houver — user provavelmente quer continuar registrando
        // depois de corrigir.
        waitUntil(dispatchNextQueuedImage(user.id, phone).catch((err) =>
          console.error('[wa-undo] dispatchNextQueuedImage failed:', err)
        ))
        return NextResponse.json({ ok: true })
      }

      // ─── Check for pending scan confirmation ───
      // Pedro 2026-05-04: além de "sim", aceita variantes naturais como
      // "registra tudo", "salva todas", "confirma tudo" — caso real do
      // Pedro Arcari que mandou "registre todas" e bot não entendeu.
      // Pedro 2026-05-09 (caso Cintia): "REMOVER" também conta como confirm
      // (mas só pra pendings de remove — proteção dentro do handler).
      // Pedro 2026-05-10: "DAR BAIXA" agora também é aceito como
      // confirmação pro fluxo de trocas ("dei BRA-5"). "REMOVER"
      // continua sendo a palavra principal e cobre tudo.
      const isExplicitRemoveWord = /^(remover|remove|deletar|apagar|dar\s+baixa|d[aá]\s+baixa)\.?$/i.test(lower.trim())

      // Pedro 2026-05-10: "LIMPAR" confirma o fluxo de clear_duplicates
      // (zera quantidades das duplicatas). Trata ANTES do isYesConfirm
      // pra não confundir com confirmação de registro/remove.
      const isExplicitClearWord = /^(limpar|limpa)\.?$/i.test(lower.trim())
      if (isExplicitClearWord) {
        const supabaseAdminClear = getAdmin()
        const { data: clearPending } = await supabaseAdminClear
          .from('pending_scans')
          .select('id, scan_data, expires_at')
          .eq('user_id', user.id)
          .eq('source', 'clear_duplicates')
          .gt('expires_at', new Date().toISOString())
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (!clearPending) {
          await sendText(
            phone,
            '🤔 Não temos um pedido recente de "limpar repetidas" aguardando confirmação. Manda *limpar repetidas* primeiro e depois confirma com *LIMPAR*.',
          )
          return NextResponse.json({ ok: true })
        }

        const snapshot = (clearPending.scan_data || []) as Array<{
          sticker_id: number
          number: string
          player_name: string
          quantity: number
          status_before: string
          quantity_before: number
        }>
        if (snapshot.length === 0) {
          await supabaseAdminClear.from('pending_scans').delete().eq('id', clearPending.id)
          await sendText(phone, '🤔 Não temos repetidas pra zerar agora. Cancelado.')
          return NextResponse.json({ ok: true })
        }

        // Buscar players + numbers (pra exibir no undo / mensagem se preciso)
        const stickerIds = snapshot.map((s) => s.sticker_id)
        const { data: stickerInfo } = await supabaseAdminClear
          .from('stickers')
          .select('id, number, player_name')
          .in('id', stickerIds)
        const infoMap = new Map(
          (stickerInfo || []).map((s: { id: number; number: string; player_name: string | null }) => [s.id, s]),
        )

        // UPDATE: status='owned', quantity=1 nos cromos com qty > 1
        const { error: updErr, count } = await supabaseAdminClear
          .from('user_stickers')
          .update({ status: 'owned', quantity: 1, updated_at: new Date().toISOString() }, { count: 'exact' })
          .eq('user_id', user.id)
          .in('sticker_id', stickerIds)
          .gt('quantity', 1)
        if (updErr) {
          console.error('[wa-clear-dup] update failed:', updErr.message)
          await sendText(phone, '⚠️ Não conseguimos zerar as repetidas agora. Tenta de novo em alguns minutos? 🙏')
          return NextResponse.json({ ok: true })
        }

        // Salva snapshot pra UNDO (10min)
        const undoSnapshot = snapshot.map((s) => {
          const info = infoMap.get(s.sticker_id) as { number: string; player_name: string | null } | undefined
          return {
            sticker_id: s.sticker_id,
            number: info?.number || s.number || '',
            status_before: s.status_before,
            quantity_before: s.quantity_before,
          }
        })
        await supabaseAdminClear
          .from('profiles')
          .update({
            last_reversible_action: {
              type: 'clear_duplicates',
              executed_at: new Date().toISOString(),
              stickers: undoSnapshot,
            },
          })
          .eq('id', user.id)

        // Limpa o pending consumido
        await supabaseAdminClear.from('pending_scans').delete().eq('id', clearPending.id)

        const totalExtrasRemoved = snapshot.reduce((sum, s) => sum + Math.max(0, s.quantity_before - 1), 0)
        const cleared = count ?? snapshot.length
        let reply = `✅ *Pronto!* Zeramos as duplicatas de *${cleared} cromo${cleared !== 1 ? 's' : ''}* — você ficou com 1 unidade de cada (${totalExtrasRemoved} unidade${totalExtrasRemoved !== 1 ? 's' : ''} extra${totalExtrasRemoved !== 1 ? 's' : ''} removida${totalExtrasRemoved !== 1 ? 's' : ''}).\n\n`
        reply += `📥 *Próximos passos importantes:*\n\n`
        reply += `1. Se sobrou repetidas depois das trocas, manda uma *foto da pilha* agora — registramos do zero.\n`
        reply += `2. Se você *recebeu novas figurinhas* na troca e ainda não registrou, manda foto/áudio/texto:\n`
        reply += `   • Áudio: _"Recebi argentina 5, marrocos 12"_\n`
        reply += `   • Texto: _"ARG-5, MAR-12"_\n\n`
        reply += `↩️ Errou alguma coisa? Manda *desfaz* nos próximos 10min para restaurar tudo. ⚽`
        await sendText(phone, reply)
        return NextResponse.json({ ok: true })
      }
      const isYesConfirm =
        isExplicitRemoveWord ||
        /^(sim|s|yes|y|confirma|confirmar|ok|okay|🆗|👍|✅|isso|isso ai|isso aí)\.?$/i.test(lower.trim()) ||
        /^(registra|registre|registrar|salva|salve|salvar|confirma|confirme|confirmar|cola|cole|colar)\s+(tud[oa]|tods?|toda?s|os\s+(tr[êe]s|dois|\d+))\.?$/i.test(lower.trim()) ||
        /^(pode|p[oô]e|colocar|registrar|salvar)\s+(tudo|todas|todos)\b/i.test(lower.trim())
      if (isYesConfirm) {
        // Pedro 2026-05-09 (caso Cintia): wrap inteiro em try/catch.
        // Caso real: user confirmou "Sim", silêncio total (sem reply).
        // Causa provável: throw em getUserStats / sendText / save sem
        // captura. Antes: user via WhatsApp ler ✓✓ e bot calado.
        // Agora: throw nunca causa silêncio — sempre responde com aviso
        // e marca o erro nos logs pra investigação.
        try {
        const supabaseAdmin = getAdmin()
        const { data: allPending, error: pendingErr } = await supabaseAdmin
          .from('pending_scans')
          .select('id, user_id, scan_data, source, expires_at, created_at')
          .eq('user_id', user.id)
          .gt('expires_at', new Date().toISOString())
          .order('created_at', { ascending: true })

        // Pedro 2026-05-09 (caso Cintia): instrumentação detalhada pra
        // diagnosticar próximo caso de "Sim" sem registro. Antes era cego.
        if (pendingErr) {
          console.error(`[wa-confirm] pending_scans query error user=${user.id}:`, pendingErr.message)
        }
        const totalItems = (allPending || []).reduce((acc, p) => {
          const sd = p.scan_data as Array<unknown> | null
          return acc + (Array.isArray(sd) ? sd.length : 0)
        }, 0)
        console.log(
          `[wa-confirm] user=${user.id} found ${allPending?.length ?? 0} pending(s), ` +
          `total items=${totalItems}, ` +
          `pending_ids=[${(allPending || []).map(p => p.id).join(',')}]`
        )

        if (allPending && allPending.length > 0) {
          // Pedro 2026-05-05: separa pendings de REGISTRO vs REMOÇÃO
          const removePendings = allPending.filter((p: { source: string | null }) => p.source === 'remove_text')
          const registerPendings = allPending.filter((p: { source: string | null }) => p.source !== 'remove_text')
          console.log(
            `[wa-confirm] user=${user.id} register_pendings=${registerPendings.length} ` +
            `remove_pendings=${removePendings.length} explicit_remove=${isExplicitRemoveWord}`
          )

          // Pedro 2026-05-09 (caso Cintia): proteção contra confirmação
          // acidental de REMOVE. Se há pending de remove e o user mandou
          // "Sim" (ou variante genérica), NÃO REMOVE — re-pergunta exigindo
          // a palavra exata "REMOVER". Caso real: Cintia mandou Sim achando
          // que era registro, removeu 9 cromos sem querer.
          // Se user mandou EXPLICITAMENTE "REMOVER", segue normal.
          if (removePendings.length > 0 && !isExplicitRemoveWord) {
            const removeCount = removePendings.reduce((acc, p) => {
              const sd = p.scan_data as Array<unknown> | null
              return acc + (Array.isArray(sd) ? sd.length : 0)
            }, 0)
            let warnMsg = `⚠️ *${removeCount} figurinha(s) aguardando baixa do álbum.*\n\n`
            warnMsg += `Para evitar enganos, esta ação precisa de confirmação explícita:\n\n`
            warnMsg += `✅ Responde *REMOVER* (ou *DAR BAIXA*) → confirma\n`
            warnMsg += `❌ Responde *cancela* → aborta`
            if (registerPendings.length > 0) {
              warnMsg += `\n\n_(Você também tem ${registerPendings.length} registro(s) aguardando — vamos processar todos juntos depois que decidir sobre a remoção.)_`
            }
            await sendBotTextFor(user.id, phone, warnMsg)
            return NextResponse.json({ ok: true })
          }

          // ── Processa REMOÇÕES ──
          let removedCount = 0
          const removedNumbers: string[] = []
          // Pedro 2026-05-09 (caso Cintia): captura snapshot ANTES de deletar
          // pra suportar undo via "desfaz" nos próximos 10min.
          let undoSnapshot: Array<{ sticker_id: number; number: string; status_before: string; quantity_before: number }> = []
          if (removePendings.length > 0) {
            const stickerIdsToRemove = new Set<number>()
            const numberByStickerId = new Map<number, string>()
            for (const pending of removePendings) {
              const scanData = pending.scan_data as Array<{ sticker_id: number; number: string; player_name: string }>
              for (const s of scanData) {
                stickerIdsToRemove.add(s.sticker_id)
                numberByStickerId.set(s.sticker_id, s.number)
                if (!removedNumbers.includes(s.number)) removedNumbers.push(s.number)
              }
            }
            if (stickerIdsToRemove.size > 0) {
              const idArray = Array.from(stickerIdsToRemove)
              // 1) Captura status ANTES (pra undo)
              const { data: beforeSnap } = await supabaseAdmin
                .from('user_stickers')
                .select('sticker_id, status, quantity')
                .eq('user_id', user.id)
                .in('sticker_id', idArray)
              undoSnapshot = (beforeSnap || []).map((row: { sticker_id: number; status: string; quantity: number }) => ({
                sticker_id: row.sticker_id,
                number: numberByStickerId.get(row.sticker_id) || '',
                status_before: row.status,
                quantity_before: row.quantity,
              }))
              // 2) Deleta
              const { error: delErr, count } = await supabaseAdmin
                .from('user_stickers')
                .delete({ count: 'exact' })
                .eq('user_id', user.id)
                .in('sticker_id', idArray)
              if (delErr) console.error('[wa-confirm-remove] delete err:', delErr)
              removedCount = count ?? stickerIdsToRemove.size
              // 3) Salva snapshot pra undo (TTL 10min — validado em código no handler de desfaz)
              if (removedCount > 0 && undoSnapshot.length > 0) {
                await supabaseAdmin
                  .from('profiles')
                  .update({
                    last_reversible_action: {
                      type: 'remove_stickers',
                      executed_at: new Date().toISOString(),
                      stickers: undoSnapshot,
                    },
                  })
                  .eq('id', user.id)
              }
            }
          }

          // ── Processa REGISTROS ──
          let saved = 0
          const savedNumbers: string[] = []
          let mergedStickers: Array<{ sticker_id: number; number: string; player_name: string; quantity: number }> = []
          // Pedro 2026-05-10 (caso Bruna): undo de registro também. Captura
          // snapshot ANTES de salvar pra reverter via "desfaz" se a leitura
          // do scan saiu errada (ex: Bruna confirmou FWC-2 mas era FWC-8).
          let registerUndoSnapshot: Array<{ sticker_id: number; number: string; status_before: string; quantity_before: number }> = []
          if (registerPendings.length > 0) {
            const allStickers = new Map<number, { sticker_id: number; number: string; player_name: string; quantity: number }>()
            for (const pending of registerPendings) {
              const scanData = pending.scan_data as Array<{ sticker_id: number; number: string; player_name: string; quantity?: number }>
              for (const s of scanData) {
                const existing = allStickers.get(s.sticker_id)
                if (existing) existing.quantity += (s.quantity || 1)
                else allStickers.set(s.sticker_id, { ...s, quantity: s.quantity || 1 })
              }
            }
            mergedStickers = Array.from(allStickers.values())
            console.log(
              `[wa-confirm] user=${user.id} merging ${registerPendings.length} pendings → ` +
              `${mergedStickers.length} unique stickers (numbers: ${mergedStickers.slice(0, 20).map(s => s.number).join(',')})`
            )
            // Captura status ANTES de batchSave (pra undo)
            const idsToSave = mergedStickers.map((s) => s.sticker_id)
            const { data: beforeSnap } = await supabaseAdmin
              .from('user_stickers')
              .select('sticker_id, status, quantity')
              .eq('user_id', user.id)
              .in('sticker_id', idsToSave)
            const beforeMap = new Map(
              (beforeSnap || []).map((row: { sticker_id: number; status: string; quantity: number }) => [row.sticker_id, row]),
            )
            registerUndoSnapshot = mergedStickers.map((s) => {
              const before = beforeMap.get(s.sticker_id) as { status: string; quantity: number } | undefined
              return {
                sticker_id: s.sticker_id,
                number: s.number,
                status_before: before?.status || 'missing',  // 'missing' = não existia row (ou era missing)
                quantity_before: before?.quantity || 0,
              }
            })
            const result = await batchSaveStickers(
              supabaseAdmin,
              user.id,
              mergedStickers.map((s) => ({ sticker_id: s.sticker_id, number: s.number, quantity: s.quantity })),
            )
            saved = result.saved
            savedNumbers.push(...result.numbers)
            console.log(
              `[wa-confirm] user=${user.id} batchSaveStickers attempted=${mergedStickers.length} actual_saved=${saved}` +
              (saved < mergedStickers.length ? ` ⚠️ MISMATCH (${mergedStickers.length - saved} faltaram)` : ' ✅')
            )

            // Enfileira match_candidates (pro cron horário notificar pessoas perto)
            ;(async () => {
              try {
                const { enqueueMatchCandidates } = await import('@/lib/match-enqueue')
                const stickerIds = mergedStickers.map((s) => s.sticker_id)
                const enqueued = await enqueueMatchCandidates(user.id, stickerIds)
                console.log(`[wa-confirm] match_candidates enqueued=${enqueued} for ${stickerIds.length} stickers`)
              } catch (err) {
                console.error('[wa-confirm] enqueueMatchCandidates failed:', err)
              }
            })()
          }

          // Limpa todos os pendings consumidos
          await supabaseAdmin.from('pending_scans').delete().eq('user_id', user.id)

          // Pedro 2026-05-10 (caso Bruna): grava snapshot pra undo de registro.
          // Só sobrescreve last_reversible_action se houve registro real (saved > 0)
          // E não houve REMOVE no mesmo turn (remove tem prioridade — já gravou).
          if (saved > 0 && registerUndoSnapshot.length > 0 && removedCount === 0) {
            await supabaseAdmin
              .from('profiles')
              .update({
                last_reversible_action: {
                  type: 'register_stickers',
                  executed_at: new Date().toISOString(),
                  stickers: registerUndoSnapshot,
                },
              })
              .eq('id', user.id)
          }

          const stats = await getUserStats(user.id)

          // Monta resposta — pode ter registro, remoção, ou ambos.
          // Pedro 2026-05-09 (caso Cintia): se houve MISMATCH (atemptado >
          // actual_saved), avisa o user em vez de mentir. Nunca mais
          // "9 registradas" quando 0 salvou de fato.
          const attempted = mergedStickers.length
          const hadMismatch = attempted > 0 && saved < attempted
          let reply = ''
          if (saved > 0) {
            reply += `✅ *${saved} figurinha(s) registrada(s)!*\n`
            reply += savedNumbers.map((n) => `• ${n}`).join('\n') + '\n\n'
          }
          if (hadMismatch) {
            const missed = attempted - saved
            reply += `⚠️ *${missed} figurinha(s) não foram salvas* por um erro técnico. Já anotamos pro time olhar — pode tentar mandar de novo em alguns minutos. 🙏\n\n`
          }
          if (removedCount > 0) {
            reply += `🗑️ *${removedCount} figurinha(s) removida(s) do álbum:*\n`
            reply += removedNumbers.map((n) => `• ${n}`).join('\n') + '\n\n'
            // Pedro 2026-05-09 (caso Cintia): oferta de undo logo após remoção.
            // Janela de 10min, snapshot já salvo em last_reversible_action.
            reply += `↩️ _Removeu errado? Manda *desfaz* nos próximos 10min pra voltar tudo._\n\n`
          }

          // Pedro 2026-05-09 (caso Victor 5565996616354): após registrar SÓ
          // figurinhas Coca-Cola, mensagem mostrava "Progresso: 0/980" e o
          // user achava que o registro falhou. Coca-Cola e PANINI Extras
          // são seções separadas (counts_for_completion=false). Agora a
          // mensagem de progresso adapta:
          //   - registrou só extras → mostra "Extras: X/92" + nota
          //   - registrou só álbum → mostra "Progresso: X/980" (atual)
          //   - misto → mostra os dois
          let registeredAlbum = 0
          let registeredExtras = 0
          if (saved > 0 && mergedStickers.length > 0) {
            const savedIds = mergedStickers.map((s) => s.sticker_id)
            const { data: savedDetails } = await supabaseAdmin
              .from('stickers')
              .select('id, counts_for_completion')
              .in('id', savedIds)
            for (const sd of (savedDetails || []) as Array<{ id: number; counts_for_completion: boolean }>) {
              if (sd.counts_for_completion) registeredAlbum++
              else registeredExtras++
            }
          }
          if (registeredAlbum > 0 && registeredExtras > 0) {
            // Misto: mostra ambos
            reply += `📊 Álbum: *${stats.owned}/${stats.total}* (${stats.pct}%)\n`
            reply += `🎁 Extras: *${stats.extrasTotal}/${EXTRAS_TOTAL_AVAILABLE}*`
          } else if (registeredExtras > 0 && registeredAlbum === 0) {
            // Só extras (caso Victor): destaca extras + nota explicativa
            reply += `🎁 Extras: *${stats.extrasTotal}/${EXTRAS_TOTAL_AVAILABLE}* — _Coca-Cola e Extras Panini são páginas separadas, não contam nos 980 do álbum._\n\n`
            reply += `📊 Álbum (separado): *${stats.owned}/${stats.total}* (${stats.pct}%)`
          } else {
            // Só álbum (ou só remoção): mensagem padrão
            reply += `📊 Progresso: *${stats.owned}/${stats.total}* (${stats.pct}%)`
          }

          // Pedro 2026-05-08: debounce do nudge de indicação.
          // Em vez de anexar ao reply (= repetitivo se user faz vários blocos
          // seguidos), marca pending_referral_nudge_at = now(). Cron
          // process-referral-nudges checa a cada 2min e envia mensagem
          // SEPARADA quando há > 3min sem novo registro (= bloco terminou).
          // Cada nova confirmação re-seta a coluna pra now(), reiniciando
          // o timer de espera.
          //
          // Critérios de elegibilidade (verificados aqui pra evitar set
          // desnecessário; cron re-verifica antes de enviar):
          //   - tier = free (pagantes não veem)
          //   - saved >= 3 (experiência boa)
          //   - cooldown 72h via referral_nudge_shown_at
          //   - tem referral_code
          try {
            const userTier = ((user as { tier?: string }).tier || 'free') as Tier
            if (userTier === 'free' && saved >= 3) {
              const { data: nudgeProfile } = await supabaseAdmin
                .from('profiles')
                .select('referral_code, referral_nudge_shown_at')
                .eq('id', user.id)
                .single()
              const cooldownH = 72
              const nudgeOk = nudgeProfile?.referral_code && (
                !nudgeProfile.referral_nudge_shown_at ||
                new Date(nudgeProfile.referral_nudge_shown_at).getTime() <
                Date.now() - cooldownH * 3600 * 1000
              )
              if (nudgeOk) {
                await supabaseAdmin
                  .from('profiles')
                  .update({ pending_referral_nudge_at: new Date().toISOString() })
                  .eq('id', user.id)
              }
            }
          } catch (err) {
            console.error('[wa-confirm] referral nudge schedule failed:', err)
            // não bloqueia resposta — nudge é nice-to-have
          }

          await sendText(phone, reply)
          // Pedro 2026-05-10 (Opt 2): após registrar com sucesso, dispara
          // próxima foto da fila se houver. Sem perda de fotos mandadas
          // em rajada — processa uma por vez automaticamente.
          waitUntil(dispatchNextQueuedImage(user.id, phone).catch((err) =>
            console.error('[wa-confirm] dispatchNextQueuedImage failed:', err)
          ))
          return NextResponse.json({ ok: true })
        }
        // No pending scan — fall through to normal intent handling
        } catch (err) {
          // Pedro 2026-05-09 (caso Cintia): nunca mais silêncio total.
          // Loga + tenta avisar user. Se sendText também falhar, ainda
          // retorna ok pra não retentar (idempotente).
          console.error(`[wa-confirm] FATAL throw user=${user.id}:`, err)
          try {
            await sendText(
              phone,
              '⚠️ Tive um problema técnico ao registrar agora. Já anotamos pro time olhar — pode tentar mandar de novo em alguns minutos? 🙏',
            )
          } catch (sendErr) {
            console.error('[wa-confirm] sendText fallback also failed:', sendErr)
          }
          return NextResponse.json({ ok: true })
        }
      }

      // Pedro 2026-05-04 (caso Vinicius): user tentou cancelar 5x com frases
      // diferentes ("deixa quieto", "vou mandar por escrito", "cancela tudo",
      // "cancele os registros anteriores"). Antes só pegava "não" exato.
      // Agora detecta intent de cancelamento de forma muito mais permissiva.
      const trimmedLower = lower.trim()
      // Pedro 2026-05-07: emoji ❌ ou 🚫 sozinho também é cancelar (mesmo
      // padrão do ✅ pro confirmar). Antes caía em handlers errados.
      const isEmojiNoOnly = trimmedForEmoji === '❌' || trimmedForEmoji === '🚫'
      const isCancelIntent =
        isEmojiNoOnly ||
        /^(n[aã]o|n|nao|cancelar|cancel|cancela|cancele)\.?$/i.test(trimmedLower) ||
        /\b(cancel|cancela|cancele|esquece|esquec[íi])\b.*\b(tud[oa]|tod[oa]s?|registro|anterior|anteriores|isso|essa|essas?|figurinhas?|itens?|lista)\b/i.test(trimmedLower) ||
        /^(deixa\s+(quieto|pra\s+l[áa]|pra\s+la|de\s+lado)|esquece(\s+isso)?|para\s+tudo|pare|stop)\b/i.test(trimmedLower) ||
        /\bvou\s+mandar\s+(por\s+)?(outro|escrito|texto|de\s+novo|outra\s+forma)\b/i.test(trimmedLower) ||
        /\b(prefiro|quero)\s+(mandar|enviar)\s+(por\s+)?(escrito|texto|outra)/i.test(trimmedLower) ||
        // Pedro 12/05/2026 (caso Lucas 5535988690572): "quero cancelar todas as figurinhas" não pegava — agora pega
        /\b(quero|gostaria|preciso)\s+cancelar\b/i.test(trimmedLower) ||
        /^(cancele?(\s+os)?(\s+registros?)?(\s+anteriores)?)\.?$/i.test(trimmedLower)
      if (isCancelIntent) {
        const supabaseAdmin = getAdmin()
        const { data: allPending } = await supabaseAdmin
          .from('pending_scans')
          .select('id')
          .eq('user_id', user.id)
          .gt('expires_at', new Date().toISOString())

        if (allPending && allPending.length > 0) {
          // Pedro 2026-05-04: user cancelou tudo → não registrou nada → refunda
          // os scans (1 por pending_scan, já que cada um custou 1 scan).
          const refundCount = allPending.length
          await supabaseAdmin.from('pending_scans').delete().eq('user_id', user.id)
          await supabaseAdmin.rpc('decrement_scan_usage', { p_user_id: user.id, p_count: refundCount })
          const refundNote = refundCount > 1
            ? `*Não contou ${refundCount} scans* — `
            : `*Não contou scan* — `
          await sendText(phone, `❌ Cancelado. Nada foi registrado.\n${refundNote}manda outra foto, áudio ou texto se quiser tentar de novo!`)
          // Pedro 2026-05-10 (Opt 2): user cancelou tudo, mas pode ter
          // fotos da rajada ainda na fila. Limpa fila também — se ele
          // cancelou a primeira, faz sentido limpar as próximas (era
          // a mesma intenção: desistir).
          await clearQueue(user.id).catch((err) =>
            console.error('[wa-cancel] clearQueue failed:', err)
          )
          return NextResponse.json({ ok: true })
        }

        // Pedro 2026-05-09 (caso Cintia): user mandou "Não" sem pending ativo,
        // MAS acabou de fazer uma remoção. Em vez de fallback genérico,
        // propor undo da remoção recente. Isso captura o "arrependimento
        // tardio" — exatamente o que rolou com a Cintia.
        const { data: cancelProfileCheck } = await supabaseAdmin
          .from('profiles')
          .select('last_reversible_action')
          .eq('id', user.id)
          .single()
        const cancelAction = cancelProfileCheck?.last_reversible_action as
          | { type: string; executed_at: string; stickers: Array<{ number: string }> }
          | null
        if (cancelAction && cancelAction.type === 'remove_stickers') {
          const elapsedMin = (Date.now() - new Date(cancelAction.executed_at).getTime()) / 60000
          if (elapsedMin <= 10) {
            const previewNumbers = cancelAction.stickers.slice(0, 5).map((s) => s.number).join(', ')
            const moreCount = cancelAction.stickers.length - 5
            const moreText = moreCount > 0 ? ` _+${moreCount} mais_` : ''
            const reply =
              `🤔 Não tem nada pendente pra cancelar agora — mas vi que há ${Math.round(elapsedMin)}min você *removeu ${cancelAction.stickers.length} figurinha(s)* (${previewNumbers}${moreText}).\n\n` +
              `Quer desfazer essa remoção? Manda *desfaz* nos próximos ${10 - Math.round(elapsedMin)}min e eu re-adiciono tudo.`
            await sendText(phone, reply)
            return NextResponse.json({ ok: true })
          }
        }
      }

      // Detect "query" intent — user asking ABOUT a sticker, not registering it.
      // Pedro pediu (2026-05-02): se o user pergunta "tenho a BRA-2?" ou
      // "preciso da FRA-2?" ou "tenho a X repetida?", responder com status
      // em vez de marcar como colada.
      //
      // Heurísticas pra distinguir query de register:
      //   - Termina com "?"
      //   - Começa com pronome de pergunta + verbo de posse: "tenho a X",
      //     "eu tenho X", "tô com a X"
      //   - Verbo "preciso/falta" + sticker: "preciso da X", "falta a X"
      //   - Pergunta específica de repetida: "X repetida?", "tenho X repetida"
      //
      // Importante: queries devem ter EXATAMENTE 1 código de sticker. Se tem
      // múltiplos, é mais provável que seja registro ("tenho BRA-1, ARG-3").
      const codeMatches = (text.match(/[a-z]{2,5}[\s\-]?\d{1,2}/gi) || [])
      const trimmedText = text.trim()
      // Pedro 2026-05-03 (Bug K): expandido pra cobrir "Eu já tenho",
      // "tô com a", "será que tenho", "tem essa", "será que falta", etc.
      // Caso real: g5k perguntou "Eu já tenho ARG 17?" e bot tratou como
      // register. Agora pega query mesmo com adverbios entre "eu" e "tenho".
      //
      // Pedro 2026-05-06: padrão IMPERATIVO de áudio — "veja se tenho FRA10",
      // "vê se falta BRA1", "olha se tem ARG3", "confere se eu tenho...".
      // Sem isso, áudio "veja se tenho..." caía como register e flushava
      // figurinha errada no álbum.
      const looksLikeQuestion = (
        /[?]\s*$/.test(trimmedText) ||
        // pronomes/expressões de POSSE com possíveis advérbios no meio:
        // "eu já tenho", "eu ainda tenho", "tô com a", "será que tenho",
        // "ser[á] que (eu )?tenho", "tem essa", "tenho essa", "tenho ela"
        /^((eu|tu|n[oó]is)\s+(j[áa]|ainda|ja)?\s*)?(tenho|t[ôo]\s+com|tem|tinha|peguei|colei)\b/i.test(trimmedText) ||
        /^(ser[áa]\s+que\s+(eu\s+)?(tenho|tem|falta|preciso))/i.test(trimmedText) ||
        // imperativo "veja/vê/olha/confere/confira/checa/cheque + se" (típico de áudio)
        /^(veja|v[êe]|olha|olhe|confere|confira|checa|cheque|me\s+(diz|fala|conta))\s+se\s+(eu\s+)?(j[áa]\s+|ainda\s+)?(tenho|tem|falta|faltam|peguei|colei|n[ãa]o\s+tenho|preciso)\b/i.test(trimmedText) ||
        // verbos de FALTA/NECESSIDADE
        /^(preciso|falta|falto|me falta|n[ãa]o tenho|nao tenho|n[ãa]o peguei|n[ãa]o coloquei)\b/i.test(trimmedText) ||
        // pergunta específica de repetida
        /\b(repetida|repetido|dupla|duplicada|sobrando)s?\s*\??\s*$/i.test(trimmedText)
      )
      // Query funciona com 1 ou múltiplos códigos. Ex:
      //   "tenho a BRA-2?" → 1 código
      //   "tenho a BRA-2 e ARG-3?" → 2 códigos
      //   "preciso da FRA-5, GER-2 e ESP-1?" → 3 códigos
      const isQueryStickers = codeMatches.length >= 1 && looksLikeQuestion

      // Pedro 2026-05-09 (caso Cintia 5511999741449): user copiou e colou
      // a mensagem inteira do bot ("Encontrei 9 figurinhas... SIM → registra
      // tudo... TIRAR 3 → remove o item 3...") pra mostrar que algo não
      // funcionou. Bot interpretou os múltiplos códigos + palavra "TIRAR"
      // como intent de remoção e abriu pending de remover 9 figurinhas.
      // Heurística defensiva: se mensagem contém >= 3 frases caractéristicas
      // de mensagem do bot, é uma cópia → ignora classifyStickerCommand
      // pra não disparar comando inadvertido.
      const botMessageMarkers = [
        /encontrei\s+\d+\s+figurinha/i,
        /SIM\s*[→\-]+\s*regist/i,
        /T?IRAR\s+\d+\s*[→\-]+\s*remov/i,
        /N[ÃA]O\s*[→\-]+\s*cancel/i,
        /expira\s+em\s+1h/i,
        /vale\s+tamb[ée]m:\s*tirar/i,
        /Novas?\s*\(\d+\)/i,
        /figurinha\(s\)\s+registrada\(s\)/i,
        /Voc[êe]\s+quer\s+REMOVER\s+\d+/i,
      ]
      const botMarkerCount = botMessageMarkers.filter((r) => r.test(text)).length
      const looksLikeBotPaste = botMarkerCount >= 3

      // Pedro 2026-05-07: classifier robusto que separa COMANDO de LISTA de
      // códigos. Funciona com verbo antes OU depois ("registre BRA1 FRA2"
      // ou "BRA1 FRA2 registra aí"). Quando bate, força o intent direto e
      // pula a cadeia de regex do fluxo legado. Override do isQueryStickers
      // pra repassar a polaridade (owned vs missing) corretamente.
      const stickerCmd = looksLikeBotPaste ? null : classifyStickerCommand(text, codeMatches)
      let forcedIntent: string | null = null
      let forcedQueryMissing = false
      if (stickerCmd === 'register') {
        forcedIntent = 'register'
      } else if (stickerCmd === 'query_owned') {
        forcedIntent = 'query_sticker'
      } else if (stickerCmd === 'query_missing') {
        forcedIntent = 'query_sticker'
        forcedQueryMissing = true
      } else if (stickerCmd === 'remove') {
        forcedIntent = 'remove'
      }
      // Se for paste do bot, força resposta amigável depois (handler do
      // intent help-friendly), em vez de tentar comandar.
      if (looksLikeBotPaste) {
        console.log(`[WhatsApp] User pasted bot message back (markers=${botMarkerCount}). Skipping command classifier.`)
      }

      // Fast keyword matching before calling Gemini
      let intent: string

      // Pedro 2026-05-09 (caso Cintia): se user colou mensagem do bot,
      // responde amigável + perguntando o que ele quis dizer. NÃO comanda.
      if (looksLikeBotPaste) {
        await sendText(
          phone,
          `🤔 Acho que você colou de volta uma mensagem que eu te enviei!\n\n` +
          `Se quiser *registrar* essas figurinhas, manda só os códigos: _BRA-1 ARG-3 FRA-10_ ou em áudio "Brasil 1, Argentina 3".\n\n` +
          `Se algo *não funcionou* como esperava, me conta o que aconteceu (em texto curto) que eu anoto pra equipe olhar. ⚽`
        )
        return NextResponse.json({ ok: true })
      }

      // Pedro 2026-05-03 (Fix F): "Outro" / "outra" como follow-up depois
      // de "faltando X". Sem precisar de contexto, basta dar o caminho:
      // peça pra especificar país. Match ANTES de outras intents pra não
      // ser interpretado como "outro" no meio de saudações ("oi outro").
      if (/^(outr[oa]\b|outra coisa|mostra outr|próximo|proximo|mais um|outro pa[ií]s|outra se[lc])/i.test(lower) && lower.length < 30) {
        await sendButtonList(
          phone,
          `🤔 *Quer ver de outro país?* Me diz qual:\n\n` +
            `Exemplos:\n` +
            `▸ *faltando brasil*\n` +
            `▸ *faltando uruguai*\n` +
            `▸ *faltando coca cola*\n` +
            `▸ *faltando intro*\n\n` +
            `Pode pedir vários juntos: _faltando brasil argentina franca_.`,
          MAIN_MENU_BUTTONS,
        )
        return NextResponse.json({ ok: true })
      }

      // Pedro 2026-05-03 (Bug L): conversa casual / agradecimento. Antes
      // o bot mandava menu rígido — quebra fluxo natural. Agora responde
      // breve e amigável, sem menu, e segue a vida.
      // Match cedo (antes das outras intents).
      const isThanks = /^(obrigad[oa]|valeu|vlw|vlw\!|tks|thx|thanks|brigad[oa]|t[oa] bom|ot[ií]mo|legal|massa|show|dahora|d+a+ +h+o+r+a|👍|👏|🙏|❤️|❤|💚|💙|💛)\s*[!.?]*\s*$/i.test(lower)
      const isCasualChat = /^(ah\s+(legal|bom|ok|ent[ãa]o)|aham|sim|oh|t[áa]\s*bom|t[áa]\s*ok|certo|ok|okay|tudo bem|tudo certo|maravilha|perfeito|beleza|blz|bom dia|boa tarde|boa noite)\s*[!.?]*\s*$/i.test(lower)
      // Mensagem só de emojis (≤8 chars, contém um emoji conhecido).
      // Não usa flag /u pra compat com TS target — fallback simples.
      const isReadOnly = lower.length <= 8 && /(❤️|❤|💚|💙|💛|👍|👏|🙏|🎉|✨|🔥|💪|😊|🙂|😄|😀|😍|🤩|🤝)/.test(lower)
      if ((isThanks || isCasualChat || isReadOnly) && codeMatches.length === 0) {
        const response = isThanks
          ? `🙌 *Disponha!* Quando precisar, é só me chamar. ⚽`
          : isReadOnly
            ? `⚽`
            : `Tô por aqui! Se precisar registrar uma figurinha, ver suas faltantes ou achar trocas, é só falar. Manda *menu* pra ver tudo que sei fazer.`
        await sendText(phone, response)
        return NextResponse.json({ ok: true })
      }

      // Pedro 2026-05-03: tutorial de áudio. Detecta mensagem padrão dos
      // CTAs do site ("Gostaria de registrar minhas figurinhas por áudio.")
      // ou variações similares. Responde com instruções amigáveis +
      // mostra saldo restante baseado no tier.
      // Pedro 2026-05-07: tutorial expandido — áudio não é só pra registrar,
      // também consulta ("veja se tenho X") e lista faltantes ("veja se
      // falta X"). User da imagem 54-99619-7830 perguntou "quais seleções
      // tenho mais figurinhas?" e bot caiu em status genérico — sintoma
      // de que usuários não sabem que dá pra interagir LIVREMENTE por áudio.
      const wantsAudioTutorial = /(?:gostaria|quero|posso|tenho|como)\s+(?:de\s+)?(?:registrar|consultar|usar|interagir).+(?:por\s+)?[áa]udio/i.test(lower)
        || /^(?:registro|consulta)\s+por\s+[áa]udio/i.test(lower)
        || /como\s+(?:funciona|usar|fazer)\s+(?:o\s+)?[áa]udio/i.test(lower)
      if (wantsAudioTutorial && codeMatches.length === 0) {
        const userTier = ((user as { tier?: string }).tier || 'free') as Tier
        const audioLimit = getAudioLimit(userTier)
        const supabase = getAdmin()
        const { data: profileData } = await supabase
          .from('profiles')
          .select('audio_uses_count, audio_credits')
          .eq('id', user.id)
          .maybeSingle()
        const used = profileData?.audio_uses_count || 0
        const credits = profileData?.audio_credits || 0
        const effectiveLimit = audioLimit === Infinity ? Infinity : audioLimit + credits
        const remaining = effectiveLimit === Infinity ? Infinity : Math.max(0, effectiveLimit - used)

        const remainingText = remaining === Infinity
          ? '_ilimitado no seu plano_'
          : `*${remaining} áudio${remaining !== 1 ? 's' : ''} restante${remaining !== 1 ? 's' : ''}* no seu plano${userTier === 'free' ? '' : ` ${TIER_CONFIG[userTier].label}`}`

        const tutorial =
          `🎤 *Áudio entende TUDO aqui no WhatsApp!*\n\n` +
          `_(No site é só foto e texto — áudio só rola por aqui.)_\n\n` +
          `Não precisa digitar — fala que eu resolvo. Funciona pra:\n\n` +
          `📥 *Registrar* figurinhas\n` +
          `   _"Brasil 1, Argentina 3, Espanha 5"_\n` +
          `   _"Brasil 1, 5 e 12"_ (vários do mesmo país)\n\n` +
          `🔎 *Consultar* o que você tem\n` +
          `   _"Veja se tenho França 10"_\n` +
          `   _"Será que peguei Brasil 5?"_\n\n` +
          `❌ *Ver o que falta*\n` +
          `   _"Veja se falta Senegal 10"_\n` +
          `   _"Não tenho Argentina 3"_\n\n` +
          `📊 ${remainingText}\n\n` +
          `💡 *Dica:* fale *devagar e claro*, com pausas entre cada figurinha.\n\n` +
          `Manda o áudio agora! 🎤`
        await sendText(phone, tutorial)
        return NextResponse.json({ ok: true })
      }

      // Pedro 2026-05-03 (caso Gianlucca "as repetidas vem em PDF?"):
      // perguntas naturais com "?" + termo questionador NÃO devem cair em
      // regex de intent (que ia interpretar como pedido de listagem). Manda
      // direto pro agent que entende a nuance ("formato de export" vs "lista").
      // Critério deliberadamente conservador pra não roubar fluxos válidos:
      //   - termina com "?"
      //   - contém termo claramente interrogativo (vocês/como/tem/vem/dá pra/etc)
      //   - NÃO tem códigos de sticker (senão é registro)
      const isNaturalQuestion =
        /\?\s*$/.test(text.trim()) &&
        /\b(voc[êe]s?|como|tem\s|vem\s|d[áa]\s+pra|d[áa]\s+pa|existe|posso|consegue|conseguem|funciona|aceita|tem\s+jeito|tem\s+como|qual\s+a|qual\s+o|onde|quando|porque|por\s+que|cad[êe]|cade|q\s+que|que\s+que)\b/i.test(lower) &&
        codeMatches.length === 0
      if (forcedIntent) {
        // classifier de comando+lista bateu → atalho direto
        intent = forcedIntent
      } else if (isNaturalQuestion) {
        intent = 'unknown' // → cai no fallback do agent
      } else if (isQueryStickers) {
        intent = 'query_sticker'
      } else if (
        // Pedro 2026-05-03 (caso Gianlucca): "Quantos scan?" / "scans restantes" /
        // "quantos áudio" → user quer ver QUOTAS, não estatísticas do álbum.
        // Detectado ANTES de status pra não cair na regra "quanto" genérica.
        /\b(quantos?\s+(scans?|fotos?|[áa]udios?|cr[eé]ditos?|trocas?))\b/i.test(lower) ||
        /\b(scans?|[áa]udios?|trocas?|cr[eé]ditos?)\s+(restantes?|que\s+(me\s+)?sobram?|tenho|posso\s+(usar|fazer)|me\s+sobr[oa])\b/i.test(lower) ||
        /\b(meu\s+saldo|minhas?\s+(quotas?|cotas?)|quanto\s+(de\s+)?(scan|[áa]udio))\b/i.test(lower)
      ) {
        intent = 'quotas'
      } else if (
        // Pedro 2026-05-09: PDF de faltantes ou repetidas. Roda ANTES dos
        // intents 'missing'/'duplicates' (que enviam lista em texto) pra que
        // "pdf das faltantes" / "exporta repetidas em pdf" peguem o PDF.
        // Pedro 12/05/2026 (caso Pedro 5521997838210): "Tabelao completo"
        // como resposta ao menu PDF caia em STATUS. Agora reconhece
        // "tabelão" / "tabelao" / "só faltantes" sozinhos como export_pdf,
        // e roda ANTES de status pra ganhar precedência.
        /\b(pdf|exporta(r|\s+em\s+pdf)?|baixar?\s+(pdf|arquivo|lista)|gerar?\s+(pdf|arquivo)|tabel[ãa]o|s[óo]\s+falt(an|am)t?es?\s+(em\s+lista|enxut))\b/i.test(lower)
      ) {
        intent = 'export_pdf'
      } else if (/(status|progresso|quanto|meu album|meu álbum|meu progresso|ver album|ver álbum)/.test(lower)) {
        intent = 'status'
      } else if (/(falt|missing|necessito|que me falta|o que falta|quais faltam)/.test(lower) && codeMatches.length === 0) {
        // "preciso/falta" sem código de sticker → lista geral. Se tem código,
        // já caiu em query_sticker acima.
        intent = 'missing'
      } else if (/(repet|duplic|sobr|troc?ar|pra troc|minhas repetidas|minhas figurinhas repetidas)/.test(lower) && codeMatches.length === 0) {
        intent = 'duplicates'
      } else if (/(\bcolad[ao]s?\b|j[áa]\s+colei|j[áa]\s+peguei\s+e\s+colei|do\s+[áa]lbum|no\s+[áa]lbum|que\s+est(ão|a)\s+no\s+[áa]lbum)/.test(lower) && codeMatches.length === 0) {
        // Pedro 2026-05-04: "coladas" = lista das que já tem ≥1 cópia (owned ou duplicate)
        intent = 'owned'
      } else if (
        // Pedro 2026-05-04 (caso 19 98338-1116): "quais tenho" foi interpretado
        // como duplicates. Era ambíguo. Quando user pergunta de forma vaga
        // sobre "o que tem" / "minhas figurinhas" SEM dizer repetidas/coladas,
        // a gente pergunta de volta com 2 botões.
        // Pedro 2026-05-04 (caso Vinicius): "aqui estão todas as minhas figurinhas"
        // virou inventory_ambiguous mas era PRESENTAÇÃO de lista. Adicionada
        // negação: se a frase tem "aqui (estão|estao|tá|ta|tem|seguem)" → NÃO
        // é pergunta, é apresentação. Cai no flow normal (com agent).
        codeMatches.length === 0 &&
        !/\baqui\s+(est[ãa]o|s[ãa]o|t[ãa]o|t[áa]|tem|seguem|seg[ue][m]?)\b/i.test(lower) &&
        (/^\s*(quais|que|o\s+que|oque|que\s+que)\s+(eu\s+)?(tenho|tem)\s*\??$/.test(lower) ||
         /^\s*(tenho|tem)\s+(o\s+)?(que|qua[il]s)\s*\??$/.test(lower) ||
         /^\s*minhas?\s*(figurinhas?)?\s*\??$/.test(lower) ||
         /^\s*(lista\s+das\s+minhas|as\s+que\s+tenho)\s*\??$/.test(lower))
      ) {
        intent = 'inventory_ambiguous'
      } else if (
        // Pedro 2026-05-07: "quais seleções eu mais/menos tenho figurinhas?"
        // (caso real 54-99619-7830). Detecta antes de cair em status genérico.
        // Sinais: presença de TERMO_DE_AGRUPAMENTO (seleç/país/paises/times)
        // + verbo/qualificador comparativo (mais|menos|tenho|peguei|completa|
        // atrasad|ranking|top|pior|melhor).
        //
        // Não usa \b ao redor de "ç/ã/í" — regex JS não trata esses como
        // word chars e o boundary falha. Usa lookarounds simples.
        codeMatches.length === 0 &&
        /(sele[çc][aã]o|sele[çc][oõ]es|pa[íi]s|pa[íi]ses|\btimes?\b)/i.test(lower) &&
        /\b(mais|menos|tenho|peguei|complet[oa]s?|completas|incomplet[oa]s?|atrasad[oa]s?|adiantad[oa]s?|ranking|top|melhor(?:es)?|pior(?:es)?|por\s+sele|por\s+pa[íi]s|minhas?)\b/i.test(lower)
      ) {
        intent = 'country_ranking'
      } else if (/(troca|pendente|solicita|aceitar|minhas trocas|ver trocas)/.test(lower)) {
        intent = 'trades'
      } else if (/\b(ranking|posição|posicao|colocação|colocacao|placar)\b/.test(lower)) {
        intent = 'ranking'
      } else if (/\b(hist[oó]rico|hist[oó]ria|meus scans|[uú]ltim[ao]s figurinhas|o que registrei|que salvei|que entrou|salvei|registrei)\b/.test(lower)) {
        intent = 'history'
      } else if (
        // Pedro 2026-05-05 (caso +55 31 99195-7476): "Tirar cc13" virou register
        // (bot achou que era código novo). User queria REMOVER do álbum.
        // Detect: verbo de remoção + código(s) válido(s) → intent='remove'.
        /^\s*(tirar|tira|remover|remove|deletar|delete|apagar|apaga|excluir|exclui)\s+/i.test(lower) &&
        codeMatches.length >= 1
      ) {
        intent = 'remove'
      } else if (/[a-z]{2,5}[\s\-]?\d{1,2}/i.test(text) && codeMatches.length >= 1) {
        // Looks like sticker codes: "BRA-1 ARG-3" or "bra 1, arg 3" or "BRA1"
        intent = 'register'
      } else if (
        // Pedro 2026-05-09 (caso Bruno +55 65 99947-4017): user mandou
        // "Coca Yamal, Coca Davies, Coca Martínez" exatamente como o bot
        // ensinou. Mas como Coca-Cola não tem CÓDIGO NUMÉRICO visível,
        // codeMatches=0 e caía em help/unknown. Agora detectamos o padrão
        // "Coca <nome>" no início da mensagem e roteamos pra register —
        // que já tem fuzzy match por nome (linha ~3744 do case 'register').
        // Pedro 2026-05-09: também aceita inverso "Yamal coca", "Yamal cc".
        /^\s*(?:coca(?:[-\s]?cola)?|cc)[\s:.,]+[a-záéíóúâêôãõàçñ]{2,}/i.test(text) ||
        /^\s*[a-záéíóúâêôãõàçñ]{2,}.*\s+(?:coca(?:[-\s]?cola)?|cc)\s*\.?\s*$/i.test(text)
      ) {
        intent = 'register'
      } else if (/\b(oi|olá|ola|hey|hi|help|ajuda|menu|início|inicio|como|faq|perguntas?|dúvidas?|planos?|preços?|quanto custa|sugest|ideia|feedback|bug|problema|reclam|melhoria)\b/.test(lower)) {
        intent = 'help'
      } else {
        // Fallback to Gemini for ambiguous messages
        const detected = await detectIntent(text)
        intent = detected.intent
      }

      // Pedro 2026-05-10 (caso Danilo 5531989694075): user que pagou
      // boleto fica frustrado porque a compensação Stripe demora 2-3 dias
      // úteis. Antes: caía em fallback "unknown" → menu de help → user
      // achava que pagamento falhou e reclamava. Agora: detecta intent
      // de "paguei boleto" direto (sem custo de LLM), responde com
      // explicação do prazo. Cooldown 6h por user.
      const isBoletoPaidIntent = (
        /\b(paguei|pago|paga|quitei|quitou|fiz\s+(o\s+)?pagamento|pagamento\s+(feito|realizado|efetuado))\b[\s\S]{0,40}\bboleto\b/i.test(lower) ||
        /\bboleto\b[\s\S]{0,40}\b(paguei|pago|paga|quitei|quitou|caiu|compensou|compensad[oa]|comprovante|pagamento\s+(confirmad[oa]?|feito|realizado))\b/i.test(lower) ||
        /\b(comprovante|recibo)\s+(do|de)\s+boleto\b/i.test(lower)
      )
      const isBoletoFutureOrNegative = (
        // "vou pagar boleto", "pretendo emitir boleto"
        /\b(vou|pretendo|quero|planejo|gostaria\s+de)\b[\s\S]{0,30}\b(pagar|emitir|gerar)\b[\s\S]{0,40}\bboleto\b/i.test(lower) ||
        // "boleto não X" (negação após boleto)
        /\bboleto\b[\s\S]{0,30}\b(n[ãa]o\s+(paguei|pago|caiu|chegou|veio|compensou)|ainda\s+n[ãa]o)\b/i.test(lower) ||
        // "ainda não X boleto" / "não consegui pagar boleto" (negação antes)
        /\b(ainda\s+n[ãa]o|n[ãa]o\s+(consegui|consigo|paguei|pago))\b[\s\S]{0,40}\bboleto\b/i.test(lower)
      )

      // Pedro 2026-05-10: comando "limpar repetidas" — para usuários
      // que trocaram muitas figurinhas e perderam controle de quais
      // duplicatas ainda têm. Zera quantity de TUDO que tem qty > 1
      // (status owned/duplicate) — mantém 1 unidade de cada (não perde
      // figurinhas do álbum, só zera as duplicatas extras). Snapshot
      // salvo em last_reversible_action pra suportar "desfaz" 10min.
      // Pedro 12/05/2026 (caso Lucas 5535988690572): "quero zerar o progresso"
      // antes caia em fallback help. User pede ação destrutiva sobre TODO
      // o álbum (não só duplicatas) — não temos essa feature, mas precisamos
      // responder explicando alternativas ao invés de mostrar stats sem comentar.
      const isResetAlbumIntent = (
        /\b(zerar|zera|resetar|reseta|apagar|apaga|deletar|excluir|limpar|limpa)\s+(meu\s+|o\s+|todo\s+|toda\s+)?(album|álbum|progresso|coleção|colecao|tudo)\b/i.test(lower.trim()) ||
        /\bcome[çc]ar\s+(tudo\s+)?(de\s+novo|do\s+zero|do\s+come[çc]o)\b/i.test(lower.trim()) ||
        /\breiniciar\s+(o\s+|meu\s+)?(album|álbum|progresso)\b/i.test(lower.trim())
      )
      if (isResetAlbumIntent) {
        await sendText(
          phone,
          `🤔 *Não dá pra "zerar" o álbum inteiro de uma vez*, mas posso te ajudar caso seja necessário.\n\n` +
          `O que você pode fazer:\n\n` +
          `🗑️ *Remover figurinhas específicas* — manda: _"tirar BRA-5"_ ou _"remover ARG-3"_\n\n` +
          `🧹 *Limpar só as repetidas* — manda: _"limpar repetidas"_ (zera quantidades extras, mantém 1 de cada)\n\n` +
          `🔄 *Reescanear depois de trocas* — manda: _"acabei de trocar"_ pra limpar repetidas e refazer\n\n` +
          `Se você quer apagar a conta toda e recomeçar, fala com o nosso time direto (1ª resposta pode demorar algumas horas). ⚽`,
        )
        return NextResponse.json({ ok: true })
      }

      const isClearDuplicatesIntent = (
        /^(limpar|limpa|zerar|zera)\s+(as?\s+)?(repet|duplic)(ad[ao]s?|i[çc][ãa]o)?\.?$/i.test(lower.trim()) ||
        /^acab(ei|amos)\s+de\s+troc(ar|amos)\.?$/i.test(lower.trim()) ||
        /^(reset|resetar)\s+(as?\s+)?(repet|duplic)/i.test(lower.trim()) ||
        /\b(limpar|limpa|zerar|zera)\s+(minhas?\s+)?(repet|duplic)/i.test(lower.trim())
      )

      if (isClearDuplicatesIntent) {
        const supabaseAdminClear = getAdmin()
        // Conta quantas duplicatas o user tem
        const { data: duplicatesData, error: duplicatesErr } = await supabaseAdminClear
          .from('user_stickers')
          .select('sticker_id, quantity, status')
          .eq('user_id', user.id)
          .gt('quantity', 1)
          .in('status', ['owned', 'duplicate'])
        if (duplicatesErr) {
          console.error('[wa-clear-dup] query failed:', duplicatesErr.message)
          await sendText(phone, '⚠️ Não conseguimos consultar suas repetidas agora. Tenta de novo em alguns minutos? 🙏')
          return NextResponse.json({ ok: true })
        }
        const dupes = (duplicatesData || []) as Array<{ sticker_id: number; quantity: number; status: string }>
        if (dupes.length === 0) {
          await sendText(
            phone,
            `🤔 Você não tem repetidas pra limpar agora — todos os seus cromos estão com quantidade 1 (ou faltando).\n\n` +
            `Se quiser registrar novas figurinhas, manda foto/áudio/texto. ⚽`,
          )
          return NextResponse.json({ ok: true })
        }
        const totalExtras = dupes.reduce((sum, d) => sum + (d.quantity - 1), 0)
        // Cria pending especial pra capturar a confirmação "LIMPAR"
        // (não cobra scan, source único pra esse fluxo)
        await supabaseAdminClear.from('pending_scans').insert({
          user_id: user.id,
          phone,
          scan_data: dupes.map((d) => ({
            sticker_id: d.sticker_id,
            number: '',
            player_name: '',
            quantity: d.quantity,
            status_before: d.status,
            quantity_before: d.quantity,
          })),
          source: 'clear_duplicates',
          expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        })

        let reply = `🧹 *Limpar repetidas — atenção!*\n\n`
        reply += `Esta ação vai *zerar a quantidade* de TODAS as suas figurinhas que estão com mais de 1 unidade. Você fica com *1 unidade* de cada uma — não perde nenhuma figurinha do álbum.\n\n`
        reply += `📊 Você tem hoje:\n`
        reply += `• *${dupes.length} cromo${dupes.length > 1 ? 's' : ''}* com duplicatas\n`
        reply += `• *${totalExtras} unidade${totalExtras > 1 ? 's' : ''} extra${totalExtras > 1 ? 's' : ''}* que vai${totalExtras > 1 ? 'o' : ''} zerar\n\n`
        reply += `_Use isso quando trocou muitas figurinhas e perdeu controle de quais ainda tem. Depois, fotografe a pilha de repetidas que SOBROU — registramos do zero._\n\n`
        reply += `💡 *Quer tirar só algumas?* Em vez de limpar tudo, manda comandos individuais:\n`
        reply += `• _"dei BRA-5"_ → tira 1 unidade da BRA-5\n`
        reply += `• _"saiu ARG-3, MAR-12"_ → tira 1 de cada\n`
        reply += `• _"trocou CC-2"_ → tira 1 do CC-2\n`
        reply += `Você também pode entrar em ${APP_URL}/album → aba *Repetidas* e clicar em *−1* em cada cromo.\n\n`
        reply += `⚠️ *Ação destrutiva.* Para confirmar a limpeza completa, responde a palavra exata:\n\n`
        reply += `✅ Responde *LIMPAR* (essa palavra) → zera TODAS as duplicatas\n`
        reply += `❌ Responde *cancela* → mantém tudo como está`
        await sendBotTextFor(user.id, phone, reply)
        return NextResponse.json({ ok: true })
      }

      if (isBoletoPaidIntent && !isBoletoFutureOrNegative) {
        if (shouldSendBoletoResponse(user.id)) {
          trackEvent(user.id, FUNNEL_EVENTS.BOLETO_PAID_REPORTED, {
            metadata: { textPreview: text.slice(0, 120) },
          })
          await sendText(
            phone,
            `👍 *Recebemos a informação de que você pagou o boleto!*\n\n` +
            `Boletos costumam levar de *2 a 3 dias úteis* para compensar no nosso sistema. Assim que cair, você recebe a confirmação do upgrade automaticamente por aqui.\n\n` +
            `Se passou esse prazo e o upgrade ainda não veio, é só nos avisar novamente que verificamos manualmente.\n\n` +
            `Enquanto isso, continue registrando figurinhas — quando o pagamento confirmar, todos os benefícios já estarão disponíveis. ⚽`,
          )
        } else {
          console.log(`[wa-boleto] cooldown active for user=${user.id}, suppressed`)
        }
        return NextResponse.json({ ok: true })
      }

      switch (intent) {
        case 'export_pdf': {
          // Pedro 2026-05-09: 3 variantes de PDF
          //   1) tabelão completo (visão álbum, com X nas que tem)
          //   2) só faltantes em lista compacta (otimizado pra 1 página)
          //   3) repetidas (tabelão, marca em âmbar)
          // Detecta qual pelo texto do user. Se não der pista, manda menu.
          const wantsDuplicates = /\b(repet|duplic|sobr|tenho\s+repet|minhas?\s+repet)/i.test(lower)
          const wantsCompact = /\b(s[óo]\s+(falt|que\s+falt)|compact|enxuta|menor|simplific|1\s+p[áa]gina|uma\s+p[áa]gina|s[óo]\s+lista|mais\s+enxut)/i.test(lower)
          const wantsFull = /\b(complet|tabel[ãa]o|visao\s+complet|vis[ãa]o\s+complet|álbum\s+inteir|tudo|com\s+as\s+que\s+tenho)/i.test(lower)

          // Sem pista clara entre completo e compact (e não é duplicates) →
          // mostra menu e sai
          if (!wantsDuplicates && !wantsCompact && !wantsFull) {
            await sendText(
              phone,
              `📄 *Qual PDF você quer?*\n\n` +
              `1️⃣ *Tabelão completo* — visão do álbum inteiro, com as que você já tem marcadas em verde (~2-3 páginas)\n\n` +
              `2️⃣ *Só faltantes* — lista enxuta só com o que falta (cabe em menos páginas)\n\n` +
              `3️⃣ *Repetidas* — pra trocas\n\n` +
              `Manda *1*, *2* ou *3* — ou *pdf completo* / *pdf faltantes* / *pdf repetidas*.`,
            )
            // Salva pendência pra próxima resposta? Por enquanto fica simples:
            // user manda comando claro na próxima mensagem.
            break
          }

          const pdfType: 'missing' | 'duplicates' = wantsDuplicates ? 'duplicates' : 'missing'
          const pdfView: 'full' | 'compact' = wantsCompact ? 'compact' : 'full'
          const internalSecret = process.env.CRON_SECRET || process.env.ADMIN_SECRET
          if (!internalSecret) {
            console.error('[wa-export-pdf] no internal secret available')
            await sendText(phone, '⚠️ Não consegui gerar o PDF agora. Tenta de novo em alguns minutos.')
            break
          }
          await sendText(phone, '📄 Gerando seu PDF...')
          try {
            const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.completeai.com.br'
            const res = await fetch(`${baseUrl}/api/export/pdf?type=${pdfType}&view=${pdfView}&user_id=${user.id}`, {
              headers: process.env.CRON_SECRET
                ? { 'Authorization': `Bearer ${internalSecret}` }
                : { 'x-admin-secret': internalSecret },
            })
            if (!res.ok) {
              console.error(`[wa-export-pdf] PDF generation failed: ${res.status}`)
              await sendText(phone, '⚠️ Tive um problema gerando seu PDF. Tenta de novo em alguns minutos. 🙏')
              break
            }
            const arrayBuffer = await res.arrayBuffer()
            const buffer = Buffer.from(arrayBuffer)
            const fileName = pdfType === 'duplicates'
              ? 'complete-ai-repetidas.pdf'
              : pdfView === 'compact'
                ? 'complete-ai-faltantes.pdf'
                : 'complete-ai-album.pdf'
            const caption = pdfType === 'duplicates'
              ? '📄 Suas repetidas — pra trocas. Em âmbar = você tem repetida pra dar. ⚽'
              : pdfView === 'compact'
                ? '📄 Sua lista enxuta de faltantes. Mostra só o que precisa pegar. ⚽'
                : '📄 Visão completa do álbum. Em verde = você já tem · vazio = falta · cinza = não existe (padding). ⚽'
            const { sendDocument } = await import('@/lib/zapi')
            const ok = await sendDocument(
              phone,
              { buffer, fileName },
              { extension: 'pdf', caption },
            )
            if (!ok) {
              console.error('[wa-export-pdf] sendDocument failed')
              await sendText(phone, '⚠️ Gerei o PDF mas não consegui enviar pelo WhatsApp agora. Tenta pelo site: ' + (process.env.NEXT_PUBLIC_APP_URL || 'https://www.completeai.com.br') + '/export')
            }
          } catch (err) {
            console.error('[wa-export-pdf] error:', err)
            await sendText(phone, '⚠️ Erro ao gerar o PDF. Tenta pelo site: ' + (process.env.NEXT_PUBLIC_APP_URL || 'https://www.completeai.com.br') + '/export')
          }
          break
        }

        case 'status': {
          const stats = await safeGetUserStats(user.id, phone)
          if (!stats) return NextResponse.json({ ok: true })
          // Suggest the most useful next action based on collection state.
          const nextButtons: ButtonOption[] =
            stats.duplicates > 0 && stats.missing > 0
              ? [
                  { id: 'cmd_missing', label: '🔍 O que falta' },
                  { id: 'cmd_duplicates', label: '🔁 Minhas repetidas' },
                  { id: 'cmd_trades', label: '🔔 Trocas pendentes' },
                ]
              : stats.missing > 0
                ? [
                    { id: 'cmd_missing', label: '🔍 O que falta' },
                    { id: 'cmd_trades', label: '🔔 Trocas pendentes' },
                    { id: 'cmd_help', label: '❓ Ajuda' },
                  ]
                : MAIN_MENU_BUTTONS
          await sendButtonList(
            phone,
            `📊 *Seu álbum:*\n\n` +
              `✅ Coladas: *${stats.owned}*\n` +
              `❌ Faltam: *${stats.missing}*\n` +
              `🔁 Repetidas: *${stats.duplicates}*\n` +
              `📈 Progresso: *${stats.pct}%* (${stats.owned}/${stats.total})\n\n` +
              `⭐ *Extras: ${stats.extrasTotal}/${EXTRAS_TOTAL_AVAILABLE}*\n` +
              `🥇 ${stats.extrasGold} ouros · 🥈 ${stats.extrasSilver} pratas · 🥉 ${stats.extrasBronze} bronzes\n` +
              `⭐ ${stats.extrasRegular} regulars · 🥤 ${stats.extrasCocacola} Coca-Cola`,
            nextButtons,
          )
          break
        }

        // Pedro 2026-05-03 (caso Gianlucca): "Quantos scan?" → mostra créditos
        // restantes (não stats do álbum). Mensagem inclui scan + áudio juntos
        // pq o user pode ter perguntado sobre qualquer um (e ver os 2 ajuda).
        case 'quotas': {
          const userTierQ = ((user as { tier?: string }).tier || 'free') as Tier
          const quotas = await getQuotas(user.id, userTierQ)
          const tierLabel = TIER_CONFIG[userTierQ]?.label || 'Free'
          const fmt = (rem: number, lim: number) => {
            if (rem === Infinity) return '∞ ilimitado'
            if (lim === Infinity) return '∞ ilimitado'
            return `*${rem}* restante${rem !== 1 ? 's' : ''} (de ${lim})`
          }
          const upgradeHint =
            userTierQ === 'copa_completa'
              ? ''
              : `\n\n💎 Quer mais? ${APP_URL}/planos`
          await sendText(
            phone,
            `📊 *Seu plano: ${tierLabel}*\n\n` +
              `📸 Scans: ${fmt(quotas.scansRemaining, quotas.scansLimit)}\n` +
              `🎤 Áudios: ${fmt(quotas.audiosRemaining, quotas.audiosLimit)}\n\n` +
              `_Pra ver figurinhas do álbum, manda *status* ou *meu álbum*._` +
              upgradeHint,
          )
          break
        }

        case 'missing': {
          // Parse country/section filters from the user's actual text (not
          // just the canonical command word). Handles PT/EN/typos/multi.
          const filters = parseSectionFilters(text)

          // Pedro 2026-05-03 (Bug J): "Quais faltando todas" → mostrar
          // LITERALMENTE TODAS, paginado em múltiplas mensagens. Detecta
          // intenção pelo texto: "todas", "tudo", "completa", "inteira".
          const wantsAll = /\b(todas?|tudo|completa?|inteir[ao]|toda\s+lista)\b/i.test(lower)

          // Pedro 2026-05-09: PDF agora é o DEFAULT pra "o que falta" (sem
          // filtro de país). Se user pediu explicitamente texto/lista/mensagem,
          // mantém comportamento antigo (lista em mensagem). Se tem filtro de
          // país, também mantém texto (PDF não filtra por seção).
          const wantsTextual = /\b(texto|lista|mensagem|por\s+texto|em\s+texto|escrito|por\s+escrito)\b/i.test(lower)
          const shouldSendPdf = filters.length === 0 && !wantsAll && !wantsTextual

          if (shouldSendPdf) {
            const internalSecret = process.env.CRON_SECRET || process.env.ADMIN_SECRET
            if (internalSecret) {
              await sendText(phone, '📄 Gerando seu PDF de faltantes...')
              try {
                const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.completeai.com.br'
                const pdfRes = await fetch(`${baseUrl}/api/export/pdf?type=missing&view=compact&user_id=${user.id}`, {
                  headers: process.env.CRON_SECRET
                    ? { 'Authorization': `Bearer ${internalSecret}` }
                    : { 'x-admin-secret': internalSecret },
                })
                if (pdfRes.ok) {
                  const buf = Buffer.from(await pdfRes.arrayBuffer())
                  const { sendDocument } = await import('@/lib/zapi')
                  const sentOk = await sendDocument(
                    phone,
                    { buffer: buf, fileName: 'complete-ai-faltantes.pdf' },
                    {
                      extension: 'pdf',
                      caption:
                        '📄 Aqui está sua lista de faltantes. Imprime, marca conforme cola, ou compartilha.\n\n' +
                        '_Se preferir a lista em mensagem aqui no chat, manda *faltantes texto* — ou pra ver de algum país específico, manda *faltantes brasil*, *faltantes argentina*..._ ⚽',
                    },
                  )
                  if (sentOk) break
                }
                console.error('[wa-missing-pdf] falhou, fallback pra texto')
              } catch (err) {
                console.error('[wa-missing-pdf] error:', err)
              }
            }
            // Fallback: cai no fluxo de texto se PDF falhar
          }

          const stats = await safeGetUserStats(user.id, phone)
          if (!stats) return NextResponse.json({ ok: true })

          if (stats.missing === 0) {
            await sendButtonList(phone, '🎉 *Você completou o álbum!* Parabéns! 🏆', [
              { id: 'cmd_status', label: '📊 Ver progresso' },
              { id: 'cmd_ranking', label: '🏆 Meu ranking' },
              { id: 'cmd_trades', label: '🔁 Trocas' },
            ])
            break
          }

          // ── Modo "todas" — pagina toda a lista em múltiplas mensagens ──
          if (wantsAll) {
            const allMissing = await getMissingStickers(user.id, 1100, filters)
            const CHUNK_SIZE = 60
            const totalChunks = Math.max(1, Math.ceil(allMissing.length / CHUNK_SIZE))
            const filterLabel = filters.length > 0 ? ` de ${filters.join(' / ')}` : ''
            // Header inicial
            await sendText(
              phone,
              `🔍 *Faltam ${allMissing.length}${filterLabel}* — te mando a lista completa${totalChunks > 1 ? ` em ${totalChunks} mensagens` : ''}:`,
            )
            // waitUntil pra não bloquear o webhook (Z-API tem timeout)
            const sendAllChunks = async () => {
              let lastSection: string | null = null
              for (let i = 0; i < totalChunks; i++) {
                const chunk = allMissing.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE) as Array<{ number: string; player_name: string; section?: string }>
                const lines: string[] = []
                for (const s of chunk) {
                  if (s.section !== lastSection) {
                    if (lastSection !== null) lines.push('')
                    lines.push(`*${s.section || '—'}*`)
                    lastSection = s.section || null
                  }
                  lines.push(`• ${s.number}${s.player_name ? ' — ' + s.player_name : ''}`)
                }
                const isLast = i === totalChunks - 1
                const partLabel = totalChunks > 1 ? `_Parte ${i + 1}/${totalChunks}_\n\n` : ''
                const footer = isLast
                  ? `\n\n✅ _Fim da lista. Manda *faltando brasil* (ou outro país) pra filtrar uma seleção._`
                  : ''
                await sendText(phone, `${partLabel}${lines.join('\n')}${footer}`)
                if (!isLast) await new Promise((r) => setTimeout(r, 600))
              }
            }
            waitUntil(sendAllChunks())
            break
          }

          // ── Pedro 2026-05-04 (caso Pedro Arcari): se SEM filtro E muito
          // a listar (>80), perguntar antes pra evitar bombardear caixa do
          // user com 150+ itens não solicitados. ──
          if (filters.length === 0 && stats.missing > 80) {
            await sendButtonList(
              phone,
              `🔍 *Você tem ${stats.missing} figurinhas faltando!*\n\n` +
                `É bastante coisa pra listar de uma vez. Como prefere ver?`,
              [
                { id: 'cmd_missing_top50', label: '👀 Top 50' },
                { id: 'cmd_missing_brasil', label: '🇧🇷 Só Brasil' },
                { id: 'cmd_missing_all', label: '📃 Tudo (em partes)' },
              ],
            )
            await sendText(
              phone,
              `_Ou pede direto: *faltando brasil*, *faltando argentina*, *faltando coca cola*, *faltando intro*. Pode pedir várias: *faltando brasil argentina franca*._`,
            )
            break
          }

          // ── Modo padrão (não "todas") — mostra primeiras 50 ──
          // Pedro 2026-05-04: reduzido de 150→50 pra não floodar o user
          const MISSING_LIMIT = 50
          const missing = await getMissingStickers(user.id, MISSING_LIMIT, filters)

          // Group consecutive items by section so the listing is scannable.
          const lines: string[] = []
          let lastSection: string | null = null
          for (const s of missing as Array<{ number: string; player_name: string; section?: string }>) {
            const section = s.section || ''
            if (section !== lastSection) {
              if (lastSection !== null) lines.push('')
              lines.push(`*${section || '—'}*`)
              lastSection = section
            }
            const name = s.player_name || ''
            lines.push(`• ${s.number}${name ? ' — ' + name : ''}`)
          }
          const list = lines.join('\n')

          // Header reflects whether we filtered or showed the global top-N.
          let header: string
          if (filters.length > 0) {
            header = `🔍 *Faltam de ${filters.join(' / ')}* (${missing.length} listadas)`
          } else {
            const shown = Math.min(MISSING_LIMIT, stats.missing)
            header = `🔍 *Faltam ${stats.missing}* — primeiras *${shown}* na ordem do álbum`
          }

          // Suggestions: when no filter applied AND there's more than what we
          // showed, prompt user to filter. When filter was applied, suggest
          // returning to the global view.
          const moreHint = filters.length === 0 && stats.missing > MISSING_LIMIT
            ? `\n\n_Pra ver mais, peça por seleção ou seção: *faltando brasil*, *faltando coca cola*, *faltando intro*. Pode pedir várias: *faltando brasil argentina franca*._`
            : filters.length > 0
              ? `\n\n_Quer ver outra? *faltando <pais>* ou *faltando* (geral)._`
              : ''

          // Pedro 2026-05-03 (Bug E): sendButtonList já adiciona "👇
          // Próximo passo:" antes dos botões. Removemos o "👉 Próximo
          // passo: mande uma foto..." daqui pra evitar duplicação.
          // Sugestão da foto vai como "💡 Dica" no final, mas só quando
          // tem capacidade de scan (free tem 5 lifetime — depois só áudio/texto).
          await sendButtonList(
            phone,
            `${header}:\n\n${list}${moreHint}\n\n💡 _Manda uma *foto* das figurinhas que você tem que eu identifico com IA._`,
            [
              { id: 'cmd_duplicates', label: '🔁 Repetidas' },
              { id: 'cmd_trades', label: '🔔 Trocas perto' },
              { id: 'cmd_status', label: '📊 Progresso' },
            ],
          )
          break
        }

        case 'duplicates': {
          const dupes = await getDuplicateStickers(user.id)
          if (dupes.length === 0) {
            await sendButtonList(
              phone,
              'Você ainda não tem repetidas. 📸 Mande uma *foto* do que coletou pra eu detectar.',
              MAIN_MENU_BUTTONS,
            )
          } else {
            // Pedro 2026-05-09: PDF é DEFAULT também pra repetidas (com tabelão
            // âmbar). Texto só se user pedir explicitamente.
            const wantsTextualDup = /\b(texto|lista|mensagem|por\s+texto|em\s+texto|escrito|por\s+escrito)\b/i.test(lower)
            if (!wantsTextualDup) {
              const internalSecret = process.env.CRON_SECRET || process.env.ADMIN_SECRET
              if (internalSecret) {
                await sendText(phone, '📄 Gerando seu PDF de repetidas...')
                try {
                  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.completeai.com.br'
                  const pdfRes = await fetch(`${baseUrl}/api/export/pdf?type=duplicates&view=full&user_id=${user.id}`, {
                    headers: process.env.CRON_SECRET
                      ? { 'Authorization': `Bearer ${internalSecret}` }
                      : { 'x-admin-secret': internalSecret },
                  })
                  if (pdfRes.ok) {
                    const buf = Buffer.from(await pdfRes.arrayBuffer())
                    const { sendDocument } = await import('@/lib/zapi')
                    const sentOk = await sendDocument(
                      phone,
                      { buffer: buf, fileName: 'complete-ai-repetidas.pdf' },
                      {
                        extension: 'pdf',
                        caption:
                          `📄 Suas ${dupes.length} repetidas — em âmbar no tabelão. Mostra pra um amigo ou abre as trocas pra ver quem precisa.\n\n` +
                          '_Se preferir a lista em mensagem aqui no chat, manda *repetidas texto*._ ⚽',
                      },
                    )
                    if (sentOk) break
                  }
                  console.error('[wa-dup-pdf] falhou, fallback pra texto')
                } catch (err) {
                  console.error('[wa-dup-pdf] error:', err)
                }
              }
              // Fallback: continua pro texto se PDF falhar
            }
            const list = dupes
              .map(
                (d) =>
                  `${d.number}${d.player_name ? ' ' + d.player_name : ''} (x${d.quantity})`
              )
              .join('\n')
            await sendButtonList(
              phone,
              `🔁 *Minhas repetidas* (${dupes.length} figurinhas):\n\n${list}\n\n` +
                `📲 Lista pra trocar — gerada pelo *Complete Aí* (www.completeai.com.br)\n\n` +
                `👉 *Próximo passo:* abre as trocas pra ver quem perto de você precisa do que você tem.`,
              [
                { id: 'cmd_trades', label: '🔔 Ver trocas' },
                { id: 'cmd_missing', label: '🔍 O que falta' },
                { id: 'cmd_status', label: '📊 Progresso' },
              ],
            )
          }
          break
        }

        case 'owned': {
          // Pedro 2026-05-04: lista das figurinhas que o user já colou no
          // álbum (status owned ou duplicate, ≥1 cópia). Mostra também x2/x3
          // se for repetida.
          const ownedList = await getOwnedStickers(user.id)
          if (ownedList.length === 0) {
            await sendButtonList(
              phone,
              'Você ainda não tem nenhuma figurinha registrada. 📸 Mande uma *foto* do que coletou pra eu detectar e adicionar.',
              MAIN_MENU_BUTTONS,
            )
          } else {
            const list = ownedList
              .map(
                (s) =>
                  `${s.number}${s.player_name ? ' ' + s.player_name : ''}${s.quantity > 1 ? ` (x${s.quantity})` : ''}`
              )
              .join('\n')
            const moreHint = ownedList.length > 80
              ? `\n\n_Lista completa com ${ownedList.length} figurinhas. Manda \"faltam\" pra ver o que ainda falta._`
              : ''
            await sendButtonList(
              phone,
              `✅ *Minhas coladas* (${ownedList.length} figurinhas):\n\n${list}${moreHint}\n\n` +
                `📲 _Complete Aí_ (www.completeai.com.br)`,
              [
                { id: 'cmd_missing', label: '🔍 O que falta' },
                { id: 'cmd_duplicates', label: '🔁 Repetidas' },
                { id: 'cmd_status', label: '📊 Progresso' },
              ],
            )
          }
          break
        }

        case 'inventory_ambiguous': {
          // Pedro 2026-05-04: usuária mandou "quais tenho" — ambíguo. Bot
          // antes chutava duplicates. Agora pergunta de volta com 2 botões.
          await sendButtonList(
            phone,
            `Posso te mostrar duas listas — qual você quer?\n\n` +
              `🔁 *Repetidas* — as que você tem a mais (pra trocar)\n` +
              `✅ *Coladas* — todas que você já tem no álbum\n` +
              `🔍 *O que falta* — as que ainda precisa pegar`,
            [
              { id: 'cmd_duplicates', label: '🔁 Repetidas' },
              { id: 'cmd_owned', label: '✅ Coladas' },
              { id: 'cmd_missing', label: '🔍 O que falta' },
            ],
          )
          break
        }

        case 'country_ranking': {
          // Pedro 2026-05-07: top/bottom seleções por completude. Detecta
          // polaridade na pergunta (mais=top, menos=bottom). Mostra top 10
          // (cabe num WhatsApp sem rolar muito).
          const breakdown = await getCountryBreakdown(user.id)
          const wantsBottom =
            /\b(menos|atrasad[oa]s?|pior(?:es)?|incomplet[oa]s?|longe)\b/i.test(lower)
          // Filtra "—" (sticker sem section) e secciones especiais quando a
          // pergunta foca em SELEÇÕES (país). Coca-Cola/FIFA não são seleção.
          const isAboutCountries = /\b(sele[çc][ãa]o|pa[íi]s(?:es)?|time(?:s)?)\b/i.test(lower)
          let rows = breakdown
          if (isAboutCountries) {
            rows = rows.filter((r) => r.section && r.section !== 'Coca-Cola' && r.section !== 'FIFA' && r.section !== '—')
          }
          // Ordena: top = mais completo desempate por owned desc; bottom =
          // menos completo desempate por owned asc (pra desempatar entre 0%
          // mostrando o que tem mais cromos absolutos primeiro).
          rows = [...rows].sort((a, b) => {
            if (wantsBottom) {
              if (a.pct !== b.pct) return a.pct - b.pct
              return b.owned - a.owned
            }
            if (a.pct !== b.pct) return b.pct - a.pct
            return b.owned - a.owned
          })
          const top = rows.slice(0, 10)

          if (top.length === 0) {
            await sendText(phone, '🤔 Você ainda não tem nenhuma figurinha registrada. Manda uma foto, áudio ou códigos pra eu começar!')
            break
          }

          const flag = (section: string): string => {
            // Mapeia seleções principais → emoji bandeira (best effort, sem onerar).
            const map: Record<string, string> = {
              'Brazil': '🇧🇷', 'Argentina': '🇦🇷', 'France': '🇫🇷', 'Spain': '🇪🇸',
              'Germany': '🇩🇪', 'England': '🏴󠁧󠁢󠁥󠁮󠁧󠁿', 'Portugal': '🇵🇹', 'Italy': '🇮🇹',
              'Netherlands': '🇳🇱', 'Belgium': '🇧🇪', 'Croatia': '🇭🇷', 'Uruguay': '🇺🇾',
              'Mexico': '🇲🇽', 'USA': '🇺🇸', 'Canada': '🇨🇦', 'Japan': '🇯🇵',
              'Korea Republic': '🇰🇷', 'South Korea': '🇰🇷', 'Australia': '🇦🇺',
              'Senegal': '🇸🇳', 'Morocco': '🇲🇦', 'Coca-Cola': '🥤', 'FIFA': '🏆',
            }
            return map[section] || '🌍'
          }

          const heading = wantsBottom
            ? '📉 *Suas seleções mais atrasadas:*'
            : '📊 *Suas seleções mais completas:*'
          const lines = [heading, '']
          for (let i = 0; i < top.length; i++) {
            const r = top[i]
            const medal = !wantsBottom && i === 0 ? '🥇 ' : !wantsBottom && i === 1 ? '🥈 ' : !wantsBottom && i === 2 ? '🥉 ' : ''
            lines.push(`${medal}${flag(r.section)} *${r.section}* — ${r.owned}/${r.total} (${r.pct}%)`)
          }
          if (rows.length > top.length) {
            lines.push('')
            lines.push(`_(+${rows.length - top.length} seleções)_`)
          }
          lines.push('')
          lines.push(`💡 Manda *faltando ${top[0].section.toLowerCase()}* pra ver o que falta nessa.`)
          await sendButtonList(
            phone,
            lines.join('\n'),
            [
              { id: 'cmd_missing', label: '🔍 O que falta' },
              { id: 'cmd_duplicates', label: '🔁 Repetidas' },
              { id: 'cmd_status', label: '📊 Status geral' },
            ],
          )
          break
        }

        case 'trades': {
          // Show pending trade requests
          const supabaseAdmin = getAdmin()
          const { data: pending } = await supabaseAdmin
            .from('trade_requests')
            .select('id, requester_id, they_have, i_have, distance_km, token, created_at')
            .eq('target_id', user.id)
            .eq('status', 'pending')
            .gt('expires_at', new Date().toISOString())
            .order('created_at', { ascending: false })
            .limit(5)

          if (!pending || pending.length === 0) {
            await sendButtonList(
              phone,
              `📋 *Nenhuma solicitação pendente.*\n\nQuer buscar trocas perto de você? Abra o app:\n${APP_URL}/trades`,
              [
                { id: 'cmd_duplicates', label: '🔁 Minhas repetidas' },
                { id: 'cmd_missing', label: '🔍 O que falta' },
                { id: 'cmd_status', label: '📊 Progresso' },
              ],
            )
          } else {
            // Get requester names
            const requesterIds = pending.map((p) => p.requester_id)
            const { data: profiles } = await supabaseAdmin
              .from('profiles')
              .select('id, display_name')
              .in('id', requesterIds)

            const nameMap = new Map((profiles || []).map((p) => [p.id, p.display_name || 'Usuário']))

            let msg = `🔔 *${pending.length} solicitação(ões) de troca pendente(s):*\n\n`

            for (const req of pending) {
              const name = nameMap.get(req.requester_id) || 'Usuário'
              const distStr = req.distance_km != null ? `${Math.round(req.distance_km)}km` : '?'
              const total = (req.they_have || 0) + (req.i_have || 0)
              const approveUrl = `${APP_URL}/trade-approve?token=${req.token}&action=approve`

              msg += `👤 *${name}* (${distStr})\n`
              msg += `   ${total} figurinhas para trocar\n`
              msg += `   ✅ Aceitar: ${approveUrl}\n\n`
            }

            msg += `Ou abra o app: ${APP_URL}/trades`
            await sendText(phone, msg)
          }
          break
        }

        case 'query_sticker': {
          // User perguntando sobre status de UMA OU MAIS figurinhas
          // (ex: "tenho a BRA-2?", "preciso da FRA-5 e GER-2?",
          //  "tenho FRA-2 e BRA-1 repetidas?").
          // Resposta agrupa por status: tem com repetida / tem sem repetida /
          // ainda não tem.
          const askingAboutDup = /\b(repetida|repetido)s?\b/i.test(trimmedText)
          // Pedro 2026-05-05 (caso Antonia +55 14 99159-2272): user mandou
          // lista de códigos + "quais dessas eu nao tenho?" → bot mostrou
          // a lista das que TEM em vez das que FALTA. Detecta polaridade:
          // "não tenho", "faltam", "que falta", "preciso" → modo missing-only.
          const askingAboutMissing =
            forcedQueryMissing ||
            /\b(n[ãa]o\s+tenho|n[ãa]o\s+tem|faltam?|que\s+falta|preciso|me\s+falta|n[ãa]o\s+peguei|n[ãa]o\s+coloquei)\b/i.test(trimmedText)
          const supabaseAdmin = getAdmin()

          // Normaliza cada código pra formato canônico "PAÍS-NÚMERO"
          // e gera variantes (com/sem hífen) pra resilência.
          const wantedCodes = Array.from(new Set(
            codeMatches.map((m) => {
              const upper = m.toUpperCase().replace(/\s+/g, '-').replace(/-+/g, '-')
              const noSep = upper.replace(/-/g, '')
              const alt = noSep.match(/^([A-Z]{2,5})(\d+)$/)
              return alt ? `${alt[1]}-${alt[2]}` : upper
            })
          ))

          const { data: stickerData } = await supabaseAdmin
            .from('stickers')
            .select('id, number, player_name')
            .in('number', wantedCodes)
          const stickers = stickerData || []

          // Map dos não-encontrados (digitou errado / código fake)
          const foundCodes = new Set(stickers.map((s) => s.number))
          const notFound = wantedCodes.filter((c) => !foundCodes.has(c))

          if (stickers.length === 0) {
            await sendText(phone, `🤔 Não achei nenhum desses no álbum: *${wantedCodes.join(', ')}*\n\nConfere se digitou certo (ex: BRA-2, ARG-3, FWC-5).`)
            break
          }

          // Status de cada um
          const { data: usData } = await supabaseAdmin
            .from('user_stickers')
            .select('sticker_id, status, quantity')
            .eq('user_id', user.id)
            .in('sticker_id', stickers.map((s) => s.id))
          const usMap = new Map((usData || []).map((u) => [u.sticker_id, u]))

          // Agrupa: tem (qty>1) / tem só 1 / não tem
          const haveDup: typeof stickers = []
          const haveSingle: typeof stickers = []
          const missing: typeof stickers = []
          for (const s of stickers) {
            const us = usMap.get(s.id)
            const qty = us?.quantity ?? 0
            if (qty >= 2) haveDup.push(s)
            else if (qty === 1) haveSingle.push(s)
            else missing.push(s)
          }

          const fmt = (s: { number: string; player_name: string | null }, qty?: number) => {
            const name = s.player_name ? ` ${s.player_name}` : ''
            const tail = qty && qty > 1 ? ` _(x${qty})_` : ''
            return `• *${s.number}*${name}${tail}`
          }

          // Modo "perguntou sobre repetidas": resposta foca em qty>1
          if (askingAboutDup) {
            const lines: string[] = []
            if (haveDup.length > 0) {
              lines.push(`🔁 *Repetida(s) que você tem:*`)
              for (const s of haveDup) {
                const q = usMap.get(s.id)?.quantity || 0
                lines.push(fmt(s, q))
              }
            }
            const notDup = [...haveSingle, ...missing]
            if (notDup.length > 0) {
              if (lines.length > 0) lines.push('')
              lines.push(`📋 *Não está repetida:*`)
              for (const s of haveSingle) lines.push(`${fmt(s)} _(tem 1)_`)
              for (const s of missing) lines.push(`${fmt(s)} _(ainda não tem)_`)
            }
            if (haveDup.length > 0) {
              lines.push('')
              lines.push(`💡 Manda *trocas* pra ver oportunidades perto de você.`)
            }
            await sendText(phone, lines.join('\n'))
            break
          }

          // Pedro 2026-05-05: modo "quais NÃO tenho?" — só mostra missing
          if (askingAboutMissing) {
            const lines: string[] = []
            if (missing.length > 0) {
              lines.push(`❌ *Dessas, você NÃO tem ${missing.length}:*`)
              for (const s of missing) lines.push(fmt(s))
            } else {
              lines.push(`✅ *Você já tem TODAS as ${wantedCodes.length} dessa lista!*`)
            }
            const haveCount = haveDup.length + haveSingle.length
            if (haveCount > 0 && missing.length > 0) {
              lines.push('')
              lines.push(`_(${haveCount} já tem — manda *quais tenho dessa lista* se quiser ver._)`)
            }
            if (notFound.length > 0) {
              if (lines.length > 0) lines.push('')
              lines.push(`⚠️ Não encontrei no álbum: ${notFound.join(', ')}`)
            }
            await sendText(phone, lines.join('\n'))
            break
          }

          // Modo "tenho?" — resposta agrupa por status
          const lines: string[] = []
          const haveAll = [...haveDup, ...haveSingle]
          if (haveAll.length > 0) {
            lines.push(`✅ *Você tem:*`)
            for (const s of haveDup) {
              const q = usMap.get(s.id)?.quantity || 0
              lines.push(`${fmt(s)} _(${q - 1} repetida${q - 1 > 1 ? 's' : ''})_`)
            }
            for (const s of haveSingle) lines.push(`${fmt(s)} _(sem repetida)_`)
          }
          if (missing.length > 0) {
            if (lines.length > 0) lines.push('')
            lines.push(`❌ *Ainda falta:*`)
            for (const s of missing) lines.push(fmt(s))
          }
          if (notFound.length > 0) {
            if (lines.length > 0) lines.push('')
            lines.push(`⚠️ Não encontrei no álbum: ${notFound.join(', ')}`)
          }

          await sendText(phone, lines.join('\n'))
          break
        }

        case 'remove': {
          // Pedro 2026-05-05 (caso 31 99195-7476): user mandou "Tirar cc13"
          // querendo REMOVER do álbum, mas bot tratou como registro novo.
          // Agora detecta intent de remoção + cria pending_scan especial
          // (source='remove_text') que pede SIM/NÃO antes de remover.
          const codePattern = /([a-z]{2,5})[\s\-]?(\d{1,2})/gi
          const matches: string[] = []
          let m
          while ((m = codePattern.exec(text)) !== null) {
            matches.push(`${m[1].toUpperCase()}-${m[2]}`)
          }
          if (matches.length === 0) {
            await sendText(phone, '🤔 Não entendi qual figurinha você quer remover. Manda no formato: *remover BRA-1*, *tirar ARG-3*, *deletar FWC-5*.')
            break
          }

          const supabaseAdminRem = getAdmin()
          // Resolve sticker_ids
          const { data: foundStickers } = await supabaseAdminRem
            .from('stickers')
            .select('id, number, player_name')
            .in('number', matches)
          const found = (foundStickers || []) as Array<{ id: number; number: string; player_name: string | null }>
          if (found.length === 0) {
            await sendText(phone, `🤔 Não achei essas figurinhas no álbum: *${matches.join(', ')}*. Confere os códigos.`)
            break
          }

          // Filtra só as que o user TEM no álbum (status owned ou duplicate)
          const { data: userOwns } = await supabaseAdminRem
            .from('user_stickers')
            .select('sticker_id, status, quantity')
            .eq('user_id', user.id)
            .in('sticker_id', found.map((s) => s.id))
            .in('status', ['owned', 'duplicate'])
          const ownsMap = new Map((userOwns || []).map((u: { sticker_id: number; status: string; quantity: number }) => [u.sticker_id, u]))
          const haveItems = found.filter((s) => ownsMap.has(s.id))
          const dontHaveItems = found.filter((s) => !ownsMap.has(s.id))

          if (haveItems.length === 0) {
            await sendText(phone, `🤔 Você não tem essas figurinhas registradas: *${matches.join(', ')}*. Não tem o que remover.`)
            break
          }

          // Cria pending de remoção (não cobra scan)
          const removeData = haveItems.map((s) => {
            const u = ownsMap.get(s.id)
            return { sticker_id: s.id, number: s.number, player_name: s.player_name || '', quantity: 1, current_qty: u?.quantity ?? 1 }
          })
          await supabaseAdminRem.from('pending_scans').insert({
            user_id: user.id,
            phone,
            scan_data: removeData,
            source: 'remove_text',
          })

          // Pedro 2026-05-10: detecta se o verbo usado foi de TROCA
          // ("dei", "saiu", "trocou") pra adaptar o copy — soa mais
          // natural que "remover" quando o usuário deu cromo em troca.
          // Operação no DB é a mesma (decrement quantity).
          const isTradeVerb = /\b(dei|deu|saiu?|sa[ií]ram|saiuram|trocou?|troquei|entreguei|entregou|dou|dar\s+baixa)\b/.test(text.toLowerCase())
          const headEmoji = isTradeVerb ? '🔁' : '🗑️'
          const headVerb = isTradeVerb ? 'dar baixa de' : 'REMOVER'
          let reply = `${headEmoji} *Você quer ${headVerb} ${haveItems.length} figurinha${haveItems.length > 1 ? 's' : ''} do seu álbum?*\n\n`
          reply += haveItems.map((s, i) => {
            const u = ownsMap.get(s.id)
            const qtyTail = (u?.quantity ?? 1) > 1 ? ` _(você tem ${u?.quantity})_` : ''
            return `*${i + 1}.* ${s.number}${s.player_name ? ' — ' + s.player_name : ''}${qtyTail}`
          }).join('\n')
          if (dontHaveItems.length > 0) {
            reply += `\n\n_(${dontHaveItems.map((s) => s.number).join(', ')} não estão no seu álbum — não vamos mexer.)_`
          }
          // Pedro 2026-05-09 (caso Cintia): confirmação de REMOVE não pode
          // ser SIM/NÃO genérico — user pode dizer "Sim" no automático
          // achando que é registro. Exigir palavra explícita garante
          // que o user leu e entendeu a ação destrutiva.
          // Pedro 2026-05-10: aceita "DAR BAIXA" como sinônimo de "REMOVER"
          // pra fluxo de trocas — mas a palavra "REMOVER" também sempre
          // funciona pra qualquer caso (consistência).
          reply += `\n\n⚠️ *Ação destrutiva.* Para evitar enganos, precisamos da confirmação exata:\n\n`
          if (isTradeVerb) {
            reply += `✅ Responde *DAR BAIXA* (ou *REMOVER*) → confirma\n`
          } else {
            reply += `✅ Responde *REMOVER* (essa palavra) → confirma\n`
          }
          reply += `❌ Responde *cancela* → aborta`
          await sendBotTextFor(user.id, phone, reply)
          break
        }

        case 'register': {
          // Parse sticker codes from text (e.g. "BRA-1 BRA-5 ARG-3" or "bra 1, arg 3").
          // Pedro 2026-05-04: pendings agora são PARALELOS (não mergeados).
          // Cada nova mensagem cria seu próprio pending_scan e a confirmação
          // ocorre via mensagem agregada que mostra todos os pendings juntos.
          const codePattern = /([a-z]{2,5})[\s\-]?(\d{1,2})/gi
          const matches: string[] = []
          let match
          while ((match = codePattern.exec(text)) !== null) {
            matches.push(`${match[1].toUpperCase()}-${match[2]}`)
          }

          // Pedro 2026-05-05 (caso Bruno +55 65 99947-4017): Coca-Cola não
          // tem número visível na figurinha, só nome do jogador. User
          // digitou "Coca Yamal, Coca Davies, Coca Martínez, ...". Resolve
          // por nome (com fuzzy match) → adiciona CC-X aos matches.
          // Ambiguidade (ex: "Martínez" pode ser CC-12 Emiliano OU CC-14
          // Lautaro) → pede clarificação.
          // Pedro 2026-05-09 (caso Gvardiol-user): aceitar formato INVERSO
          // também — "Yamal coca", "Lautaro Martínez cc". User pode
          // mandar de qualquer ordem; bot extrai o nome de forma agnóstica.
          const cocaAmbiguous: Array<{ name: string; candidates: string[] }> = []
          const segments = text.split(/[,;]|\s+e\s+|\n/)
          const cocaNames: string[] = []
          for (const seg of segments) {
            const trimmed = seg.trim()
            // Prefix: "Coca Yamal" / "cc Yamal" / "coca-cola Yamal"
            let cocaMatch = trimmed.match(/^(?:coca(?:[-\s]?cola)?|cc)[\s:.,]+(.+)$/i)
            if (!cocaMatch) {
              // Suffix: "Yamal coca" / "Yamal cc" / "Lautaro Martínez coca-cola"
              cocaMatch = trimmed.match(/^(.+?)\s+(?:coca(?:[-\s]?cola)?|cc)\.?$/i)
            }
            if (cocaMatch) {
              const name = cocaMatch[1].trim()
              if (name.length >= 3 && !/\d/.test(name)) {
                cocaNames.push(name)
              }
            }
          }
          if (cocaNames.length > 0) {
            const supabaseCoca = getAdmin()
            const { data: cocaStickers } = await supabaseCoca
              .from('stickers')
              .select('number, player_name')
              .eq('section', 'Coca-Cola')

            const norm = (s: string) => s.toLowerCase().trim()
              .normalize('NFD').replace(/[̀-ͯ]/g, '')
              .replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim()

            for (const targetRaw of cocaNames) {
              const normTarget = norm(targetRaw)
              const targetParts = normTarget.split(' ')
              const targetLast = targetParts[targetParts.length - 1]
              const targetFirst = targetParts[0]

              const candidates: Array<{ number: string; player_name: string }> = []
              for (const s of (cocaStickers || []) as Array<{ number: string; player_name: string }>) {
                const normDb = norm(s.player_name)
                const dbParts = normDb.split(' ')
                const dbLast = dbParts[dbParts.length - 1]
                const dbFirst = dbParts[0]

                // Match: nome inteiro contém ou é contido pelo target,
                // ou último-nome bate, ou primeiro-nome bate
                if (
                  normTarget.includes(normDb) || normDb.includes(normTarget) ||
                  (targetLast.length >= 3 && targetLast === dbLast) ||
                  (targetFirst.length >= 4 && targetFirst === dbFirst)
                ) {
                  candidates.push(s)
                }
              }

              if (candidates.length === 1) {
                matches.push(candidates[0].number)
              } else if (candidates.length > 1) {
                cocaAmbiguous.push({
                  name: targetRaw,
                  candidates: candidates.map((c) => `*${c.number}* ${c.player_name}`),
                })
              }
              // candidates.length === 0 → nome não bateu, ignora silenciosamente
            }
          }

          // Se teve ambiguidade na Coca, avisa antes de continuar
          if (cocaAmbiguous.length > 0) {
            let msg = `🤔 Algumas figurinhas Coca-Cola têm mais de um jogador com nome parecido. Especifica:\n\n`
            for (const amb of cocaAmbiguous) {
              msg += `• "${amb.name}" → ${amb.candidates.join(' OU ')}\n`
            }
            msg += `\n💡 Manda o código (ex: *CC-12*) ou o nome completo (ex: *Coca Emiliano Martinez*).`
            await sendText(phone, msg)
            break
          }

          if (matches.length === 0) {
            const baseMsg = cameFromAudio
              ? '🎤 Não consegui pegar nenhum código no seu áudio. Tenta de novo falando bem claro o país e o número, exemplo:\n\n' +
                '✅ "BRA 1, ARG 3, FRA 10"\n' +
                '✅ "Brasil 1 e Argentina 3"\n' +
                '✅ "Coca Yamal, Coca Davies" _(pra Coca-Cola — só nome)_'
              : '🤔 Não consegui ler códigos de figurinhas aí. O formato é assim:\n\n' +
                '✅ `BRA-1 ARG-3 FRA-10`\n' +
                '✅ `bra 1, arg 3`\n' +
                '✅ `BRA1 BRA5`\n' +
                '✅ `Coca Yamal, Coca Davies` _(Coca-Cola — só o nome do jogador)_'
            await sendText(phone, baseMsg)
            break
          }

          const supabaseAdmin = getAdmin()
          const { data: foundStickers } = await supabaseAdmin
            .from('stickers')
            .select('id, number, player_name, country')
            .in('number', matches)

          if (!foundStickers || foundStickers.length === 0) {
            // Best-guess: pra cada código não achado, sugerir candidatos com
            // mesmo número final e prefixo parecido. Pedro pediu (2026-05-01)
            // que o bot dê o melhor guess + pergunte, em vez de simplesmente
            // dizer "não entendi" e parar.
            const { data: allCodes } = await supabaseAdmin
              .from('stickers')
              .select('number, player_name')
            const codeIndex = (allCodes || []) as Array<{ number: string; player_name: string }>

            // Levenshtein simples (só pra prefixes curtos — máx 5 chars)
            const lev = (a: string, b: string): number => {
              const m = a.length, n = b.length
              if (Math.abs(m - n) > 3) return 99
              const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
              for (let i = 0; i <= m; i++) dp[i][0] = i
              for (let j = 0; j <= n; j++) dp[0][j] = j
              for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
                dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
              }
              return dp[m][n]
            }

            const suggestions: string[] = []
            for (const code of matches) {
              const [pre, num] = code.split('-')
              if (!pre || !num) continue
              const candidates = codeIndex
                .filter((c) => c.number.endsWith(`-${num}`))
                .map((c) => ({ ...c, dist: lev(c.number.split('-')[0].toUpperCase(), pre.toUpperCase()) }))
                .filter((c) => c.dist <= 2)
                .sort((a, b) => a.dist - b.dist)
                .slice(0, 2)
              if (candidates.length > 0) {
                const guess = candidates.map((c) => `*${c.number}* (${c.player_name})`).join(' ou ')
                suggestions.push(`• \`${code}\` → você quis dizer ${guess}?`)
              } else {
                suggestions.push(`• \`${code}\` → não consegui adivinhar`)
              }
            }

            const lead = cameFromAudio
              ? `🤔 Não achei esses no álbum:`
              : `🤔 Esses não existem no álbum:`
            await sendText(
              phone,
              `${lead}\n\n${suggestions.join('\n')}\n\n` +
                `📝 Manda de novo com a forma certa, ou só fala assim: _"Brasil 1, Argentina 3"_ que eu entendo. 👍`,
            )
            break
          }

          // Group by sticker_id (codes repetidos viram quantity > 1) e mantém
          // a ordem em que apareceram no texto, pra preview ficar previsível.
          const stickerByNumber = new Map<string, { id: number; number: string; player_name: string; country: string }>()
          for (const s of foundStickers) {
            stickerByNumber.set(s.number, s as { id: number; number: string; player_name: string; country: string })
          }
          const grouped = new Map<number, { sticker_id: number; number: string; player_name: string; quantity: number }>()
          for (const code of matches) {
            const s = stickerByNumber.get(code)
            if (!s) continue
            const ex = grouped.get(s.id)
            if (ex) ex.quantity += 1
            else grouped.set(s.id, { sticker_id: s.id, number: s.number, player_name: s.player_name || '', quantity: 1 })
          }
          const scanData = Array.from(grouped.values())

          if (scanData.length === 0) {
            const fallback = cameFromAudio
              ? '🤔 Não consegui mapear esses códigos pro álbum. Tenta de novo falando bem claro?'
              : '🤔 Não consegui mapear esses códigos pro álbum. Confere se digitou certo (ex: BRA-1).'
            await sendText(phone, fallback)
            break
          }

          // Existing entries pra render 🆕 / 🔁
          const { data: existing } = await supabaseAdmin
            .from('user_stickers')
            .select('sticker_id, status, quantity')
            .eq('user_id', user.id)
            .in('sticker_id', scanData.map((s) => s.sticker_id))
          const existingMap = new Map((existing || []).map((e: { sticker_id: number; status: string; quantity: number }) => [e.sticker_id, e]))

          // Save pending scan (1h TTL). Pedro 2026-05-04: pendings paralelos
          // — pode haver outros ativos. source identifica origem na msg agg.
          await supabaseAdmin.from('pending_scans').insert({
            user_id: user.id,
            phone,
            scan_data: scanData,
            source: cameFromAudio ? 'audio' : 'text',
          })

          const notFound = matches.filter((m) => !stickerByNumber.has(m))
          const totalFound = scanData.reduce((sum, s) => sum + s.quantity, 0)

          // Header reflete a origem (foto / áudio / texto) — Pedro pediu
          // (2026-05-02) que respostas de áudio não falem "foto".
          const sourceLabel = cameFromAudio ? 'no áudio' : 'no que você digitou'

          // Numbered preview matching the photo flow.
          // Pedro 2026-05-06: SEPARADO em 2 seções (Novas / Já tinha) pra UX.
          // Índices preservam ordem do OCR/áudio/texto pra "tirar N" funcionar.
          const newLines: string[] = []
          const repeatLines: string[] = []
          scanData.forEach((s, idx) => {
            const ex = existingMap.get(s.sticker_id) as { status: string; quantity: number } | undefined
            const label = `${s.number} ${s.player_name || ''}`.trim()
            const qtyLabel = s.quantity > 1 ? ` (x${s.quantity})` : ''
            const n = idx + 1
            const isNew = !ex || ex.status === 'missing' || ex.quantity === 0
            if (isNew) {
              newLines.push(`*${n}.* ${label}${qtyLabel}`)
            } else if (ex.status === 'owned') {
              repeatLines.push(`*${n}.* ${label}${qtyLabel} _(repetida)_`)
            } else {
              repeatLines.push(`*${n}.* ${label}${qtyLabel} _(rep x${ex.quantity + s.quantity})_`)
            }
          })
          const previewLines: string[] = []
          if (newLines.length > 0) {
            previewLines.push(`🆕 *Novas (${newLines.length}):*`)
            previewLines.push(...newLines)
          }
          if (repeatLines.length > 0) {
            if (previewLines.length > 0) previewLines.push('')
            previewLines.push(`🔁 *Já tinha (${repeatLines.length}):*`)
            previewLines.push(...repeatLines)
          }

          let msg = `📋 *Encontrei ${totalFound} figurinha(s) ${sourceLabel}:*\n\n`
          msg += previewLines.join('\n')
          if (notFound.length > 0) {
            msg += `\n\n⚠️ Não encontradas no álbum: ${notFound.join(', ')}`
          }
          msg += scanData.length === 1
            ? '\n\n✅ *SIM* → registra'
            : '\n\n✅ *SIM* → registra tudo'
          if (scanData.length >= 2) {
            const exampleN = Math.min(scanData.length, 3)
            msg += `\n✏️ *TIRAR ${exampleN}* → remove o item ${exampleN} (vale também: _tirar 2,5_)`
          }
          msg += '\n❌ *NÃO* → cancela'
          msg += '\n\n⏰ _Expira em 1h se não responder_'

          // Mensagem interativa — user vai responder SIM/NÃO/TIRAR. Salva
          // contexto pro agent caso resposta seja ambígua ("ok pode mandar").
          await sendBotTextFor(user.id, phone, msg)
          break
        }

        case 'history': {
          // Last 20 stickers the user actually saved (any source: scan, manual,
          // import). updated_at is the source of truth — when the row last
          // moved (created or quantity changed). Lets the user audit what
          // really entered the album, including timing.
          const adminDb = getAdmin()
          const { data: recent } = await adminDb
            .from('user_stickers')
            .select('sticker_id, status, quantity, updated_at, sticker:stickers!inner(number, player_name)')
            .eq('user_id', user.id)
            .gt('quantity', 0)
            .order('updated_at', { ascending: false })
            .limit(20)

          const rows = (recent || []) as unknown as Array<{
            sticker_id: number
            status: string
            quantity: number
            updated_at: string
            sticker: { number: string; player_name: string | null }
          }>

          if (rows.length === 0) {
            await sendText(phone, '📭 Você ainda não tem figurinhas no álbum. Manda uma foto pra escanear!')
            break
          }

          const formatRel = (iso: string): string => {
            const diffMs = Date.now() - new Date(iso).getTime()
            const min = Math.floor(diffMs / 60000)
            if (min < 1) return 'agora'
            if (min < 60) return `há ${min} min`
            const hrs = Math.floor(min / 60)
            if (hrs < 24) return `há ${hrs}h`
            const days = Math.floor(hrs / 24)
            if (days < 7) return `há ${days}d`
            return new Date(iso).toLocaleDateString('pt-BR')
          }

          let reply = `📜 *Últimas ${rows.length} figurinhas registradas:*\n\n`
          reply += rows.map((r, i) => {
            const label = `${r.sticker.number} ${r.sticker.player_name || ''}`.trim()
            const qty = r.quantity > 1 ? ` (x${r.quantity})` : ''
            const tag = r.status === 'duplicate' ? ' 🔁' : ''
            return `*${i + 1}.* ${label}${qty}${tag} _${formatRel(r.updated_at)}_`
          }).join('\n')
          reply += '\n\n💡 Faltou alguma que você tinha mandado? Manda foto de novo ou registra por código (ex: PAR-3).'

          await sendText(phone, reply)
          break
        }

        case 'ranking': {
          try {
            const { data: rankData } = await getAdmin().rpc('get_user_ranking', { p_user_id: user.id })
            const r = rankData?.[0]
            if (r && r.national_rank) {
              const cityLine = r.city ? `📍 *${r.city}:* #${r.city_rank} de ${r.city_total}\n` : ''
              const stateLine = r.state ? `🗺️ *${r.state}:* #${r.state_rank} de ${r.state_total}\n` : ''
              await sendText(
                phone,
                `🏆 *Seu Ranking*\n\n` +
                `🇧🇷 *Nacional:* #${r.national_rank} de ${r.national_total} colecionadores\n` +
                cityLine + stateLine +
                `\n📊 ${r.owned_count} figurinhas coladas\n\n` +
                `Veja detalhes: ${APP_URL}/ranking`
              )
            } else {
              await sendText(phone, `🏆 Ative sua localização no app para ver seu ranking!\n\n${APP_URL}/ranking`)
            }
          } catch {
            await sendText(phone, `🏆 Veja seu ranking no app:\n${APP_URL}/ranking`)
          }
          break
        }

        case 'help':
        default: {
          const helpName = user.display_name?.split(' ')[0] || ''
          const greeting = helpName ? `Oi, *${helpName}*! ` : ''

          // Check if message looks like feedback/suggestion and forward to admin.
          // Pedro 2026-05-09: expandido pra pegar reclamações diretas que users
          // escrevem ("ta errado", "não entrou", "deu erro") — antes caíam em
          // help/unknown e o bot mandava menu padrão, ignorando a reclamação.
          // Casos reais: Cintia "As figurinhas não entraram no app", Lorenzo
          // "Ta errado isso aí".
          const isFeedback =
            /sugest|ideia|bug|problema|reclama|feedback|melhoria/i.test(text) ||
            /\bn[ãa]o\s+(entr(ou|aram)|funcion(ou|a)|consegu(i|e)|foi|deu|pegou|salvou|registr(ou|a))/i.test(text) ||
            /\bdeu\s+(erro|ruim|pau|problema|bug)/i.test(text) ||
            /\b(t[áa]\s+errad[oa]|est[áa]\s+errad[oa]|errad[oa]\s+isso|t[áa]\s+quebrad[oa]|t[áa]\s+bugad[oa]|n[ãa]o\s+t[áa]\s+(funcionando|certo|ok))\b/i.test(text) ||
            /\b(perdi|sumiu|sumiram|desapareceu|desapareceram)\b/i.test(text) ||
            /(^|\s)(cad[êe]|cade)\s+/i.test(text)

          // ── Anti-spam: suprimir help duplicado em rápida sucessão ──
          // Caso clássico: usuário envia "Oi" e logo depois "tudo bem" — ambas
          // caem no help/unknown intent e o bot mandaria 2 menus seguidos.
          // Solução: UPDATE atômico que só passa se a coluna estiver vazia ou
          // mais antiga que HELP_COOLDOWN_SEC. Em race condition, só uma das
          // requests ganha o claim — a(s) outra(s) retorna(m) silenciosamente.
          // Feedback NUNCA é suprimido (sempre forward pro admin).
          if (!isFeedback) {
            const HELP_COOLDOWN_SEC = 60
            const cutoff = new Date(Date.now() - HELP_COOLDOWN_SEC * 1000).toISOString()
            const supabaseAdmin = getAdmin()
            const { data: claimed } = await supabaseAdmin
              .from('profiles')
              .update({ last_help_response_at: new Date().toISOString() })
              .eq('id', user.id)
              .or(`last_help_response_at.is.null,last_help_response_at.lt.${cutoff}`)
              .select('id')

            if (!claimed || claimed.length === 0) {
              console.log(`[WhatsApp] help cooldown active for ${maskPhone(phone)}, suppressing duplicate menu`)
              return NextResponse.json({ ok: true })
            }
          }

          if (isFeedback && text.length > 5) {
            const adminPhone = process.env.ADMIN_PHONE
            if (adminPhone) {
              sendText(adminPhone, `💡 *Feedback de ${helpName || 'Usuário'}*\n📱 ${phone}\n\n"${text}"`).catch(() => {})
            }
            // Pedro 2026-05-09: copy mais empática quando é reclamação real
            // (Cintia "não entraram", Lorenzo "ta errado"). Antes era genérica
            // "obrigado pelo feedback" — virava sensação de ignorada. Agora
            // pede mais contexto pra acelerar investigação.
            const greetingForFeedback = helpName ? `Oi *${helpName}*! ` : ''
            await sendText(
              phone,
              `🙏 ${greetingForFeedback}Obrigado por avisar — anotei aqui e vou subir isso pro nosso time agora.\n\n` +
              `Se puder, me conta com mais detalhes o que você tava tentando fazer (foto, áudio, texto? qual figurinha? em que página do app?) — ajuda muito a investigar mais rápido.\n\n` +
              `Voltamos pra você assim que tivermos novidade. ⚽`
            )
            break
          }

          // intent === 'help' is the friendly menu; intent === 'unknown' falls
          // here too because of the `default:` — distinguish the lead line.
          const isUnknown = intent === 'unknown'

          // Pedro 2026-05-03: Fase 1 spike do agente conversacional.
          // Antes de mostrar menu (que é frustrante quando user fez pergunta
          // natural), tenta o agent com Gemini function calling. Só ativa
          // quando intent é unknown E texto é não-trivial (>= 8 chars) —
          // assim "ok"/"valeu"/etc não disparam LLM.
          if (isUnknown && text.trim().length >= 8) {
            const ctx = await getLastBotContext(user.id)
            const userTierAgent = ((user as { tier?: string }).tier || 'free') as Tier
            const agentResp = await runAgent({
              userId: user.id,
              userMessage: text,
              lastBotMessage: ctx.message,
              lastBotMessageAt: ctx.at,
              userTier: userTierAgent,
            })

            if (agentResp.kind === 'text' || agentResp.kind === 'tool_result') {
              await sendText(phone, agentResp.text)
              await recordBotMessage(user.id, agentResp.text)
              return NextResponse.json({ ok: true })
            }

            if (agentResp.kind === 'escalate') {
              // Pedro 2026-05-03: escala pra time de atendimento humano.
              // Cria entry em support_escalations + notifica Pedro pessoal
              // (com rate-limit 6h por user). Resposta ao user é a mesma
              // independente de notify ter ido ou rate-limited.
              const acknowledge =
                '🙏 Não fui treinado pra responder essa especificamente. Anotei sua mensagem e nosso *time de atendimento* vai te responder em breve aqui no WhatsApp. ✅'
              await sendText(phone, acknowledge)
              await recordBotMessage(user.id, acknowledge)
              const userDisplay = (user as { display_name?: string | null }).display_name ?? null
              await escalateToSupport({
                userId: user.id,
                phone,
                displayName: userDisplay,
                lastMessage: agentResp.userMessage,
                reason: agentResp.reason,
                classifiedIntent: 'unknown',
              })
              return NextResponse.json({ ok: true })
            }
            // agentResp.kind === 'error' → cai no fluxo antigo (menu)
          }

          // Pedro 2026-05-07: quando user manda algo que o bot não entende,
          // copy mais empática + registra como SUGESTÃO no admin (silencioso,
          // sem incomodar Pedro). Pedro revisa depois pra ver casos reais
          // que ainda precisamos treinar.
          if (isUnknown && text.trim().length >= 8) {
            void submitUnknownSuggestion({
              userId: user.id,
              phone,
              displayName: (user as { display_name?: string | null }).display_name ?? null,
              message: text,
            })
          }

          const lead = isUnknown
            ? `${greeting}🤔 *Ainda não fui treinado pra responder isso.*\n\nMas vou subir como sugestão pro time da *Complete Aí* — esses pedidos são o que faz o bot melhorar a cada semana. 🙏\n\nEnquanto isso, olha tudo que eu *já sei fazer hoje*:`
            : `${greeting}👋 Aqui vai tudo que eu sei fazer:`

          const menu =
            `${lead}\n\n` +
            `*📥 Registrar figurinhas — 3 jeitos:*\n\n` +
            `📸 *Por foto* — o mais rápido\n` +
            `Tira foto do álbum aberto OU das figurinhas soltas e me manda. Algumas dicas pra dar certo:\n` +
            `  • *Nitidez é tudo* — código OU nome do jogador legível na foto\n` +
            `  • Boa luz, sem reflexo, foco no centro\n` +
            `  • Pra *muitas figurinhas de uma vez*: vire todas com o *número pra cima* (verso) — assertividade muito maior\n` +
            `  • *Coca-Cola* (sem código): fotografe com o *nome do jogador* visível (frente)\n` +
            `  • Até *10 cromos por foto* (mais que isso, a precisão cai)\n\n` +
            `🎤 *Por áudio (só aqui no WhatsApp)* — funciona pra TUDO\n` +
            `Manda áudio que eu entendo. Não é só pra registrar:\n` +
            `  • _"Brasil 1, Argentina 3, França 10"_ → registra\n` +
            `  • _"Veja se tenho França 10 e Brasil 5"_ → consulta\n` +
            `  • _"Veja se falta Senegal 10"_ → mostra faltantes\n\n` +
            `✏️ *Por texto*\n` +
            `Digita os códigos. Aceita vários formatos: _BRA-1 ARG-3 FRA-10_, _bra 1, arg 3_ ou _BRA1 BRA5_.\n\n` +
            `*📊 Outras coisas:*\n` +
            `• *repetidas* — suas duplicadas\n` +
            `• *faltantes* — o que ainda falta\n` +
            `• *progresso* — quanto do álbum você tem\n` +
            `• *quais seleções tenho mais* — ranking por país\n` +
            `• *ranking* — sua posição entre colecionadores\n` +
            `• *historico* — últimas figurinhas registradas\n` +
            `• *trocas* — solicitações pendentes\n\n` +
            `🌐 *No site* (${APP_URL}) você tem foto, texto, álbum visual, trocas e ranking. *Áudio só funciona aqui no WhatsApp.*\n\n` +
            `🔔 *Trocas perto de você*\n` +
            `Quer ser avisado quando alguém com a sua faltante estiver perto? Autoriza no app:\n` +
            `${APP_URL}/album\n\n` +
            `💡 Manda *sugestões*, *bugs* ou *ideias* a qualquer hora!\n` +
            `❓ FAQ: ${APP_URL}/faq`

          await sendText(phone, menu)
          break
        }
      }

      return NextResponse.json({ ok: true })
    }

    // Pedro 2026-05-08 (incident loop massivo): este fallback estava
    // disparando pra TODO event de Z-API que não fosse text/image/audio —
    // incluindo status updates de delivery/read receipts quando o webhook
    // de message-status apontava pra mesma URL. Resultado: flood pro user.
    //
    // Agora: silencio. Se chegou aqui, é evento que não sabemos tratar
    // (vídeo, documento, status update, presence, etc.) — registra log
    // mas NÃO envia mensagem pro user. Sem flood possível.
    console.warn(
      `[WhatsApp] Unknown event type from ${maskPhone(phone)} — ignoring silently. ` +
      `messageType=${messageType} bodyKeys=[${Object.keys(body).join(',')}]`
    )
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('WhatsApp webhook error:', err)
    return NextResponse.json({ ok: true }) // Always return 200 to Z-API
  }
}

// Z-API may send GET to verify webhook
export async function GET() {
  return NextResponse.json({ status: 'ok' })
}
