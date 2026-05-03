import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { createClient } from '@supabase/supabase-js'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { sendText, sendButtonList, formatPhone, maskPhone, type ButtonOption } from '@/lib/zapi'
import { normalizePhoneBR } from '@/lib/phone'
import { trackEvent, trackEventOnce, FUNNEL_EVENTS } from '@/lib/funnel'
import { runAgent, recordBotMessage, getLastBotContext } from '@/lib/whatsapp-agent'
import { escalateToSupport } from '@/lib/support'
import { expandCountryNamesToCodes, convertSpelledNumbersToDigits } from '@/lib/country-codes'
import { createUserViaWhatsApp, isValidEmail, normalizeEmail } from '@/lib/whatsapp-register'
import { checkRateLimit, getIp, webhookLimiter } from '@/lib/ratelimit'
import { backgroundHealthPing } from '@/lib/health-ping'
import { getAudioLimit, TIER_CONFIG, type Tier } from '@/lib/tiers'
import { getQuotas, buildPaywallMessage } from '@/lib/whatsapp-quotas'

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
  "intent": "status|missing|duplicates|trades|ranking|register|help|unknown",
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
- duplicates: user wants list of sticker duplicates. Examples:
  "repetidas", "minhas repe", "minhas dupes", "duplicatas", "que sobrou",
  "pra trocar", "o que tenho a mais", "as repetidinhas", "tenho repetida"
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

REGRAS:
- CRÍTICO: Leia o nome EXATO. "MARQUINHOS" ≠ "NEYMAR JR" ≠ "CASEMIRO".
- CRÍTICO: Se há DUAS cópias da mesma figurinha, liste CADA uma separadamente.
- O NOME é o identificador principal.
- Emblemas/escudos (CBF, AFA, FFF) → player_name "Emblem"
- Fotos de time → player_name "Team Photo"
- Países em Português.

Retorne APENAS JSON:
{
  "pages_detected": 1,
  "scan_confidence": 0.9,
  "stickers": [
    {"number": "", "player_name": "Neymar Jr", "country": "Brasil", "status": "filled", "confidence": 0.95}
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
async function handleRegistrationFlow(phone: string, text: string): Promise<boolean> {
  if (!text) return false
  const supabase = getAdmin()

  const { data: pending } = await supabase
    .from('pending_registrations')
    .select('id, state, name, email')
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
        await supabase.from('pending_registrations').delete().eq('id', pending.id)
        const firstName = (existing.display_name || '').split(' ')[0]
        await sendText(
          phone,
          `✅ *Achei seu cadastro${firstName ? `, ${firstName}` : ''}!* Conectei seu WhatsApp à conta. 🔓\n\n` +
            `Já pode usar tudo aqui:\n` +
            `📸 *Foto* das figurinhas — eu identifico com IA\n` +
            `🎤 *Áudio* falando os códigos\n` +
            `✏️ *Texto* tipo _"BRA-1 ARG-3"_ ou _"Brasil 1"_\n\n` +
            `Manda *menu* a qualquer hora pra ver tudo. 💚`,
        )
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
          `Bom proveito! 💚\n\n` +
          `_Ao usar o serviço você aceita os Termos (${APP_URL}/termos) e a Privacidade (${APP_URL}/privacidade)._`,
      )
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
        `Lá já vai aparecer seu email e nome preenchidos. Depois de cadastrar, manda *oi* aqui de novo que eu reconheço seu WhatsApp. 💚`,
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

  const { count: totalStickers } = await supabase
    .from('stickers')
    .select('*', { count: 'exact', head: true })
    .eq('counts_for_completion', true)

  // Pull every user_sticker once, joined with the sticker so we can count
  // both album progress and per-variant extras in the same pass.
  const { data: rows } = await supabase
    .from('user_stickers')
    .select('status, stickers!inner(counts_for_completion, variant, section)')
    .eq('user_id', userId)
    .in('status', ['owned', 'duplicate'])

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

const EXTRAS_TOTAL_AVAILABLE = 92  // 12 Coca-Cola + 80 PANINI Extras (20 × 4 cores)

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
        'You receive a Portuguese audio message from a Panini sticker album user listing sticker codes. ' +
        'Transcribe verbatim in plain Portuguese, no punctuation cleanup, no prefix, no quotes. ' +
        'IMPORTANT: Convert ALL spelled-out numbers to digits — "três" → "3", "treze" → "13", ' +
        '"vinte e cinco" → "25", "número quinze" → "15". Country names stay as spoken: ' +
        '"Espanha 3", "Cabo Verde 7", "Brasil 12". ' +
        'If the audio is silent, unintelligible, or not Portuguese, respond with the literal token UNINTELLIGIBLE.',
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
    } else if (ex.status === 'owned') {
      toUpdate.push({ sticker_id: sticker.sticker_id, status: 'duplicate', quantity: ex.quantity + qty })
      savedNumbers.push(`${sticker.number} (rep${qty > 1 ? ` x${ex.quantity + qty}` : ''})`)
    } else if (ex.status === 'duplicate') {
      toUpdate.push({ sticker_id: sticker.sticker_id, status: 'duplicate', quantity: ex.quantity + qty })
      savedNumbers.push(`${sticker.number} (rep x${ex.quantity + qty})`)
    }
  }

  // 3. Batch insert new stickers (single query)
  if (toInsert.length > 0) {
    await supabase.from('user_stickers').insert(toInsert)
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
    await supabase.from('user_stickers').upsert(upsertData, { onConflict: 'user_id,sticker_id' })
  }

  return { saved: toInsert.length + toUpdate.length, numbers: savedNumbers }
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

// ─── Interactive button definitions ──────────────────────────────────────────
// Each command surfaces both as a button (one-tap) and as a text the user can
// type freely. Button IDs map to canonical command words so the rest of the
// pipeline can treat the click as if the user typed that word.

const BUTTON_ID_TO_TEXT: Record<string, string> = {
  cmd_status: 'status',
  cmd_missing: 'faltando',
  cmd_duplicates: 'repetidas',
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

// ─── Dedup: avoid processing same message twice (Map with TTL) ───
const recentMessages = new Map<string, number>()
const DEDUP_TTL_MS = 5 * 60 * 1000 // 5 minutes
const DEDUP_MAX_SIZE = 500

function isDuplicate(messageId: string): boolean {
  if (!messageId) return false
  const now = Date.now()

  // Periodically clean expired entries (every check, but it's cheap for <500 items)
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
    const msgId = body.messageId || body.id?.id || body.ids?.[0] || ''
    if (isDuplicate(msgId)) {
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
      const earlyText = (body.text?.message || body.body || body.message || '').toString().trim()

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
            `Manda *menu* a qualquer hora pra ver tudo. 💚`,
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
      if (looksLikeQuestion) {
        await sendText(
          phone,
          `📨 *Anotei sua mensagem!* Sou o assistente do *Complete Aí* ⚽\n\n` +
            `Pra te responder direito, preciso te conhecer. *Me passa seu email?* 📧\n\n` +
            `Depois do cadastro eu volto pra sua dúvida. 💚\n\n` +
            `_Se preferir cadastro completo no site: ${APP_URL}/register?phone=${phone}_`,
        )
      } else {
        await sendText(phone, getWelcomeMessage(phone))
      }
      // Create pending_registration in awaiting_email state — email-first flow
      // (next message é o email do user). Idempotent: ON CONFLICT reseta state.
      const supabaseAdmin = getAdmin()
      await supabaseAdmin
        .from('pending_registrations')
        .upsert({ phone, state: 'awaiting_email', expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() }, { onConflict: 'phone' })
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
      // Serializa: 1 registro por vez. Se já tem pending, segura essa foto.
      const pendingItemsImg = await countPendingScanItems(user.id)
      if (pendingItemsImg > 0) {
        await sendText(phone, buildWaitPendingMsg(pendingItemsImg))
        return NextResponse.json({ ok: true })
      }

      const imageUrl = body.image?.imageUrl || body.image?.url || body.imageUrl
      const imageBase64 = body.image?.base64 || body.base64 || null

      if (!imageUrl && !imageBase64) {
        await sendText(phone, 'Não consegui baixar a imagem. Tenta mandar de novo? 📸')
        return NextResponse.json({ ok: true })
      }

      // Scan credits are checked inside the /api/whatsapp/scan route
      // All tiers have scan credits (free=5, estreante=50, etc.)

      // Download image
      let imageData: { base64: string; mimeType: string } | null = null
      if (imageBase64) {
        imageData = { base64: imageBase64, mimeType: 'image/jpeg' }
      } else {
        imageData = await downloadImage(imageUrl, msgId)
      }

      if (!imageData) {
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
          }),
        }).catch((err) => console.error('[WhatsApp] Failed to trigger scan:', err))
      )

      return NextResponse.json({ ok: true })
    }

    // ─── Text ───
    if (messageType === 'text') {
      const rawText = body.text?.message || body.body || body.message || ''

      if (!rawText.trim()) {
        return NextResponse.json({ ok: true })
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
      // Pipeline:
      // 1) "Espanha três" → "Espanha 3"  (convertSpelledNumbersToDigits)
      // 2) "Espanha 3"   → "ESP 3"        (expandCountryNamesToCodes)
      // 3) "ESP: 1, 2"   → "ESP-1 ESP-2"  (expandWithColon)
      // 4) "ESP 1 2 3"   → "ESP-1 ESP-2 ESP-3" (expandMultiNoColon)
      // O passo 1 é crítico pra áudio: Gemini frequentemente transcreve
      // números por extenso quando o user fala o país por nome.
      const text = expandMultiNoColon(
        expandWithColon(
          expandCountryNamesToCodes(convertSpelledNumbersToDigits(rawText)),
        ),
      )

      const lower = text.trim().toLowerCase()

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
            `${header}\n\n${lines.join('\n\n')}\n${bonusLine}\nObrigado pela paciência! 💚`,
          )
          return NextResponse.json({ ok: true })
        }
        // Se não tem correction pendente, deixa o sim/não fluir pro flow normal (cancelar pending_scan, etc.)
      }

      // ─── "tirar N" / "remover N,M" — drop specific items from the latest pending scan ───
      // The user-facing list is numbered 1..N over the LATEST pending_scan
      // (the one this WhatsApp scan reply just rendered). Comma, space and
      // the connector "e" are all accepted: "tirar 3", "tirar 2,5", "tirar 2 e 5".
      const removeMatch = lower.trim().match(/^(?:tirar|tira|remover|remove)\s+([\d,\s]+(?:\s+e\s+\d+)*)/i)
      if (removeMatch) {
        const supabaseAdmin = getAdmin()
        const { data: latestPending } = await supabaseAdmin
          .from('pending_scans')
          .select('id, scan_data')
          .eq('user_id', user.id)
          .gt('expires_at', new Date().toISOString())
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (!latestPending) {
          await sendText(phone, '🤔 Não tenho nenhum registro aguardando confirmação. Manda uma foto, áudio ou texto pra começar!')
          return NextResponse.json({ ok: true })
        }

        const stickers = (latestPending.scan_data as Array<{ sticker_id: number; number: string; player_name: string; quantity: number }>) || []
        // Parse indices 1..N from "3", "2,5", "2 e 5", "2, 5 e 7"
        const parsed: number[] = (removeMatch[1].match(/\d+/g) || [])
          .map((d: string) => parseInt(d, 10))
          .filter((n: number) => Number.isInteger(n) && n >= 1 && n <= stickers.length)
        const indices: number[] = Array.from(new Set<number>(parsed)).sort((a, b) => a - b)

        if (indices.length === 0) {
          await sendText(phone, `❓ Não entendi o número. A lista tem ${stickers.length} item(s) — tenta: *tirar 1* ou *tirar 1,3*.`)
          return NextResponse.json({ ok: true })
        }

        const removed = indices.map((n) => stickers[n - 1])
        const kept = stickers.filter((_, i) => !indices.includes(i + 1))

        if (kept.length === 0) {
          await supabaseAdmin.from('pending_scans').delete().eq('id', latestPending.id)
          await sendText(phone, `❌ Removidas todas as ${removed.length} figurinha(s) do registro. Manda outra foto, áudio ou texto se quiser!`)
        } else {
          await supabaseAdmin.from('pending_scans').update({ scan_data: kept }).eq('id', latestPending.id)
          const removedSummary = removed.map((s) => `${s.number} ${s.player_name}`.trim()).join(', ')
          let reply = `🗑️ Removido: *${removedSummary}*\n\n`
          reply += `📋 *Restou ${kept.length} figurinha(s) no registro:*\n`
          reply += kept.map((s, i) => {
            const label = `${s.number} ${s.player_name || ''}`.trim()
            const qtyLabel = s.quantity > 1 ? ` (x${s.quantity})` : ''
            return `*${i + 1}.* ${label}${qtyLabel}`
          }).join('\n')
          reply += '\n\n✅ *SIM* → registra'
          if (kept.length >= 2) {
            const exampleN = Math.min(kept.length, 2)
            reply += `\n✏️ *TIRAR ${exampleN}* → remove o item ${exampleN} (troque pelo número que quer remover)`
          }
          reply += '\n❌ *NÃO* → cancela tudo'
          await sendText(phone, reply)
        }
        return NextResponse.json({ ok: true })
      }

      // ─── Check for pending scan confirmation ───
      if (/^(sim|s|yes|y|confirma|ok)$/i.test(lower.trim())) {
        const supabaseAdmin = getAdmin()
        const { data: allPending } = await supabaseAdmin
          .from('pending_scans')
          .select('id, user_id, scan_data, expires_at, created_at')
          .eq('user_id', user.id)
          .gt('expires_at', new Date().toISOString())
          .order('created_at', { ascending: true })

        if (allPending && allPending.length > 0) {
          // Merge all pending scans into one list, summing quantities for same sticker
          const allStickers = new Map<number, { sticker_id: number; number: string; player_name: string; quantity: number }>()
          for (const pending of allPending) {
            const scanData = pending.scan_data as Array<{ sticker_id: number; number: string; player_name: string; quantity?: number }>
            for (const s of scanData) {
              const existing = allStickers.get(s.sticker_id)
              if (existing) {
                existing.quantity += (s.quantity || 1)
              } else {
                allStickers.set(s.sticker_id, { ...s, quantity: s.quantity || 1 })
              }
            }
          }
          const mergedStickers = Array.from(allStickers.values())

          // Batch save using shared helper (single insert + single upsert instead of N queries)
          const { saved, numbers: savedNumbers } = await batchSaveStickers(
            supabaseAdmin,
            user.id,
            mergedStickers.map((s) => ({ sticker_id: s.sticker_id, number: s.number, quantity: s.quantity }))
          )
          const savedLines = savedNumbers.map((n) => `• ${n}`)

          // Delete all pending scans
          await supabaseAdmin.from('pending_scans').delete().eq('user_id', user.id)

          // Get updated stats
          const stats = await getUserStats(user.id)

          // Com a serialização (1 pending por vez), allPending sempre tem
          // length 1. Mantemos a defesa pra legacy data, mas a copy fica
          // genérica (sem citar "fotos").
          let reply = `✅ *${saved} figurinha(s) registrada(s)!*\n\n`
          reply += savedLines.join('\n') + '\n\n'
          reply += `📊 Progresso: *${stats.owned}/${stats.total}* (${stats.pct}%)`

          await sendText(phone, reply)
          return NextResponse.json({ ok: true })
        }
        // No pending scan — fall through to normal intent handling
      }

      if (/^(n[aã]o|n|cancelar|cancel)$/i.test(lower.trim())) {
        const supabaseAdmin = getAdmin()
        const { data: allPending } = await supabaseAdmin
          .from('pending_scans')
          .select('id')
          .eq('user_id', user.id)
          .gt('expires_at', new Date().toISOString())

        if (allPending && allPending.length > 0) {
          await supabaseAdmin.from('pending_scans').delete().eq('user_id', user.id)
          await sendText(phone, `❌ Cancelado. Nada foi registrado.\nManda outra foto, áudio ou texto se quiser tentar de novo!`)
          return NextResponse.json({ ok: true })
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
      const looksLikeQuestion = (
        /[?]\s*$/.test(trimmedText) ||
        // pronomes/expressões de POSSE com possíveis advérbios no meio:
        // "eu já tenho", "eu ainda tenho", "tô com a", "será que tenho",
        // "ser[á] que (eu )?tenho", "tem essa", "tenho essa", "tenho ela"
        /^((eu|tu|n[oó]is)\s+(j[áa]|ainda|ja)?\s*)?(tenho|t[ôo]\s+com|tem|tinha|peguei|colei)\b/i.test(trimmedText) ||
        /^(ser[áa]\s+que\s+(eu\s+)?(tenho|tem|falta|preciso))/i.test(trimmedText) ||
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

      // Fast keyword matching before calling Gemini
      let intent: string

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
          ? `🙌 *Disponha!* Quando precisar, é só me chamar. 💚`
          : isReadOnly
            ? `💚`
            : `Tô por aqui! Se precisar registrar uma figurinha, ver suas faltantes ou achar trocas, é só falar. Manda *menu* pra ver tudo que sei fazer.`
        await sendText(phone, response)
        return NextResponse.json({ ok: true })
      }

      // Pedro 2026-05-03: tutorial de áudio. Detecta mensagem padrão dos
      // CTAs do site ("Gostaria de registrar minhas figurinhas por áudio.")
      // ou variações similares. Responde com instruções amigáveis +
      // mostra saldo restante baseado no tier.
      const wantsAudioTutorial = /(?:gostaria|quero|posso|tenho|como)\s+(?:de\s+)?registrar.+(?:por\s+)?[áa]udio/i.test(lower)
        || /^registro\s+por\s+[áa]udio/i.test(lower)
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
          `🎤 *Registrar por áudio é simples!*\n\n` +
          `1️⃣ Aperte o ícone de microfone aqui no WhatsApp e segura\n` +
          `2️⃣ *Fale os códigos* das figurinhas:\n` +
          `   • _"Brasil 1, Argentina 3, Espanha 5"_\n` +
          `   • _"Brasil 1, 5, 12"_ (vários do mesmo país)\n` +
          `   • _"Espanha três, Argentina sete"_ (números por extenso também)\n` +
          `3️⃣ Solta o microfone — eu identifico tudo e te confirmo. ✅\n\n` +
          `📊 ${remainingText}\n\n` +
          `💡 *Dica:* fale *devagar e claro*, com pausas entre cada figurinha.\n\n` +
          `Quando estiver pronto, *manda o áudio*! 🎤`
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
      if (isNaturalQuestion) {
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
      } else if (/(status|progresso|quanto|meu album|meu álbum|meu progresso|ver album|ver álbum)/.test(lower)) {
        intent = 'status'
      } else if (/(falt|missing|necessito|que me falta|o que falta|quais faltam)/.test(lower) && codeMatches.length === 0) {
        // "preciso/falta" sem código de sticker → lista geral. Se tem código,
        // já caiu em query_sticker acima.
        intent = 'missing'
      } else if (/(repet|duplic|sobr|troc?ar|pra troc|minhas repetidas|minhas figurinhas repetidas)/.test(lower) && codeMatches.length === 0) {
        intent = 'duplicates'
      } else if (/(troca|pendente|solicita|aceitar|minhas trocas|ver trocas)/.test(lower)) {
        intent = 'trades'
      } else if (/\b(ranking|posição|posicao|colocação|colocacao|placar)\b/.test(lower)) {
        intent = 'ranking'
      } else if (/\b(hist[oó]rico|hist[oó]ria|meus scans|[uú]ltim[ao]s figurinhas|o que registrei|que salvei|que entrou|salvei|registrei)\b/.test(lower)) {
        intent = 'history'
      } else if (/[a-z]{2,5}[\s\-]?\d{1,2}/i.test(text) && codeMatches.length >= 1) {
        // Looks like sticker codes: "BRA-1 ARG-3" or "bra 1, arg 3" or "BRA1"
        intent = 'register'
      } else if (/\b(oi|olá|ola|hey|hi|help|ajuda|menu|início|inicio|como|faq|perguntas?|dúvidas?|planos?|preços?|quanto custa|sugest|ideia|feedback|bug|problema|reclam|melhoria)\b/.test(lower)) {
        intent = 'help'
      } else {
        // Fallback to Gemini for ambiguous messages
        const detected = await detectIntent(text)
        intent = detected.intent
      }

      switch (intent) {
        case 'status': {
          const stats = await getUserStats(user.id)
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

          const stats = await getUserStats(user.id)

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

          // ── Modo padrão (não "todas") — mostra primeiras 150 ──
          const MISSING_LIMIT = 150
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

        case 'register': {
          // Serializa: 1 registro por vez. Se já tem pending, segura a mensagem.
          const pendingItemsReg = await countPendingScanItems(user.id)
          if (pendingItemsReg > 0) {
            await sendText(phone, buildWaitPendingMsg(pendingItemsReg))
            break
          }

          // Parse sticker codes from text (e.g. "BRA-1 BRA-5 ARG-3" or "bra 1, arg 3").
          // Mesmo flow que foto: cria pending_scan e pede confirmação (sim/tirar N/não)
          // em vez de salvar direto. Pedro pediu (2026-05-01) consistência entre
          // os caminhos de entrada — código digitado, áudio transcrito e foto
          // todos passam pela mesma etapa de revisão.
          const codePattern = /([a-z]{2,5})[\s\-]?(\d{1,2})/gi
          const matches: string[] = []
          let match
          while ((match = codePattern.exec(text)) !== null) {
            matches.push(`${match[1].toUpperCase()}-${match[2]}`)
          }

          if (matches.length === 0) {
            const baseMsg = cameFromAudio
              ? '🎤 Não consegui pegar nenhum código no seu áudio. Tenta de novo falando bem claro o país e o número, exemplo:\n\n' +
                '✅ "BRA 1, ARG 3, FRA 10"\n' +
                '✅ "Brasil 1 e Argentina 3"'
              : '🤔 Não consegui ler códigos de figurinhas aí. O formato é assim:\n\n' +
                '✅ `BRA-1 ARG-3 FRA-10`\n' +
                '✅ `bra 1, arg 3`\n' +
                '✅ `BRA1 BRA5`'
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

          // Save pending scan (1h TTL). Como agora o flow é serializado
          // (1 registro por vez), sempre que chegamos aqui o user não tinha
          // pending ativo — então este será o único.
          await supabaseAdmin.from('pending_scans').insert({
            user_id: user.id,
            phone,
            scan_data: scanData,
          })

          const notFound = matches.filter((m) => !stickerByNumber.has(m))
          const totalFound = scanData.reduce((sum, s) => sum + s.quantity, 0)

          // Header reflete a origem (foto / áudio / texto) — Pedro pediu
          // (2026-05-02) que respostas de áudio não falem "foto".
          const sourceLabel = cameFromAudio ? 'no áudio' : 'no que você digitou'

          // Numbered preview matching the photo flow
          const previewLines = scanData.map((s, idx) => {
            const ex = existingMap.get(s.sticker_id) as { status: string; quantity: number } | undefined
            const label = `${s.number} ${s.player_name || ''}`.trim()
            const qtyLabel = s.quantity > 1 ? ` (x${s.quantity})` : ''
            const n = idx + 1
            if (!ex) return `*${n}.* 🆕 ${label}${qtyLabel}`
            if (ex.status === 'owned') return `*${n}.* 🔁 ${label}${qtyLabel} _(repetida)_`
            return `*${n}.* 🔁 ${label}${qtyLabel} _(rep x${ex.quantity + s.quantity})_`
          })

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

          await sendText(phone, msg)
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

          // Check if message looks like feedback/suggestion and forward to admin
          const isFeedback = /sugest|ideia|bug|problema|reclama|feedback|melhoria/i.test(text)

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
            await sendText(
              phone,
              `💡 Obrigado pelo feedback!\n\nSua mensagem foi encaminhada para nossa equipe. 🙏\n\nDúvidas: contato@completeai.com.br`
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

          const lead = isUnknown
            ? `${greeting}🤔 Hmm, não peguei essa. Olha o que eu sei fazer:`
            : `${greeting}👋 Aqui vai tudo que eu sei fazer:`

          const menu =
            `${lead}\n\n` +
            `*📥 Registrar figurinhas — 3 jeitos:*\n\n` +
            `📸 *Por foto* — o mais rápido\n` +
            `Tira foto do álbum aberto OU das figurinhas soltas e me manda. Algumas dicas pra dar certo:\n` +
            `  • Até *10 cromos por foto* (mais que isso, a precisão cai)\n` +
            `  • *Nitidez é tudo* — nomes e números têm que estar legíveis na foto\n` +
            `  • Boa luz, sem reflexo, foco no centro\n` +
            `  • Com 5+ cromos, prefira todos virados *de frente* (lado do nome)\n\n` +
            `🎤 *Por áudio*\n` +
            `Manda um áudio falando os códigos. Ex.: _"BRA 1, ARG 3, FRA 10"_ ou _"Brasil 1 e Argentina 3"_. Eu transcrevo e te mostro pra confirmar antes de salvar.\n\n` +
            `✏️ *Por texto*\n` +
            `Digita os códigos. Aceita vários formatos: _BRA-1 ARG-3 FRA-10_, _bra 1, arg 3_ ou _BRA1 BRA5_.\n\n` +
            `*📊 Outras coisas:*\n` +
            `• *repetidas* — suas duplicadas\n` +
            `• *faltantes* — o que ainda falta\n` +
            `• *progresso* — quanto do álbum você tem\n` +
            `• *ranking* — sua posição entre colecionadores\n` +
            `• *historico* — últimas figurinhas registradas\n` +
            `• *trocas* — solicitações pendentes\n\n` +
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

    // Other message types (video, document, etc.)
    await sendText(phone, 'Eu entendo texto e fotos! 📸 Manda uma foto do álbum ou digite *status*.')
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
