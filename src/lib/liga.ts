/**
 * Liga Complete Aí 2026 — biblioteca central de pontuação.
 *
 * Responsabilidades:
 * - Definir tabela de eventos pontuáveis + valores
 * - Função `awardLigaPoints` idempotente (event_key único)
 * - Helper `getTemporadaAtiva()` pra determinar período do evento
 * - Helper `checkUnlocks` que detecta marcos atingidos após pontuação
 *
 * Princípios:
 * 1. **Idempotência**: chamar 100× com mesmo event_key conta 1×
 * 2. **Fail-open**: se DB falhar, não bloqueia o fluxo principal do app
 * 3. **Append-only**: nunca apaga liga_events; auditoria total
 * 4. **Opt-in obrigatório**: nada pontua sem `liga_opt_in_at` (exceto retroativo)
 *
 * Pedro 11/05/2026.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

function getAdmin(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

// ─── Tipos de evento + pontos ───────────────────────────────────────────────

export const LIGA_EVENT_POINTS = {
  // Cadastro & assinatura (todos 1× por user — event_key fixo)
  SIGNUP: 10,
  PROFILE_PLUS_FIRST_STICKER: 30,
  SUBSCRIBE_ESTREANTE: 100,
  SUBSCRIBE_COLECIONADOR: 200,
  SUBSCRIBE_COPA: 300,
  UPGRADE_ONE_LEVEL: 100,
  UPGRADE_ESTREANTE_TO_COPA: 200,

  // Assiduidade
  LOGIN_DAILY: 1,        // 1×/dia (event_key inclui data)
  STREAK_3: 5,           // 1× lifetime
  STREAK_7: 20,
  STREAK_15: 50,

  // Uso (caps diários)
  FIRST_PHOTO_SCAN: 10,
  FIRST_AUDIO_SCAN: 10,
  SCAN: 1,               // cap 30/dia combined
  SECTION_COMPLETED: 20, // 1× por seção

  // Trocas (cap 3/dia cada categoria)
  TRADE_REQUESTED: 10,
  TRADE_ACCEPTED: 20,
  TRADE_REVIEWED: 5,
  GOOD_RATING_RECEIVED: 5,

  // Indicações
  REFERRAL_SIGNUP: 10,                     // 1× por amigo
  REFERRAL_ACTIVATED: 30,                   // 1× por amigo (amigo escaneou 5+)
  REFERRAL_QUALIFIED_ESTREANTE: 100,        // 1× por amigo
  REFERRAL_QUALIFIED_COLECIONADOR: 200,
  REFERRAL_QUALIFIED_COPA: 300,
} as const

export type LigaEventType = keyof typeof LIGA_EVENT_POINTS

// Caps diários (cap = 0 significa sem cap; cap = N significa N pontos/dia)
const DAILY_CAPS: Partial<Record<LigaEventType, number>> = {
  SCAN: 30,                 // 30 scans/dia × 1pt
  TRADE_REQUESTED: 3 * 10,  // 3 trocas/dia × 10pt = 30
  TRADE_ACCEPTED: 3 * 20,   // 3 × 20 = 60
  TRADE_REVIEWED: 3 * 5,    // 3 × 5 = 15
  GOOD_RATING_RECEIVED: 3 * 5,
}

// ─── Marcos das Trilhas Digitais ───────────────────────────────────────────

export const TRILHA_FREE_MARCOS = [100, 300, 700, 1500, 3000] as const
export const TRILHA_COPA_MARCOS = [500, 800, 1000, 1500, 4000] as const

// ─── Helper: determina Temporada ativa pra dado timestamp ──────────────────

export type Temporada = {
  numero: number
  starts_at: string
  ends_at: string
  status: 'pending' | 'active' | 'closed' | 'cancelled'
  gate_min_participants: number | null
  gate_min_points: number | null
  gate_passed: boolean | null
}

let temporadasCache: { data: Temporada[]; at: number } | null = null
const TEMPORADAS_CACHE_TTL_MS = 60 * 1000 // 1min

async function getTemporadas(admin: SupabaseClient): Promise<Temporada[]> {
  const now = Date.now()
  if (temporadasCache && now - temporadasCache.at < TEMPORADAS_CACHE_TTL_MS) {
    return temporadasCache.data
  }
  const { data } = await admin
    .from('liga_temporadas')
    .select('*')
    .order('numero')
  const list = (data || []) as Temporada[]
  temporadasCache = { data: list, at: now }
  return list
}

/**
 * Retorna o número da Temporada cujo período cobre o timestamp dado.
 * Retorna null se está em hiato (entre Temporadas) ou fora da janela total.
 * Considera SÓ Temporadas que não estão 'cancelled'.
 */
export async function getTemporadaForTimestamp(
  ts: Date,
  admin?: SupabaseClient,
): Promise<number | null> {
  const sb = admin || getAdmin()
  const list = await getTemporadas(sb)
  const iso = ts.toISOString()
  for (const t of list) {
    if (t.status === 'cancelled') continue
    if (iso >= t.starts_at && iso <= t.ends_at) return t.numero
  }
  return null
}

// ─── Função principal: awardLigaPoints (idempotente) ───────────────────────

export type AwardParams = {
  userId: string
  eventType: LigaEventType
  /** chave única do evento — garante idempotência. Ex: 'scan:2026-05-15:42' */
  eventKey: string
  /** Quando o evento ocorreu (default: agora) */
  at?: Date
  /** Metadata opcional pra auditoria */
  metadata?: Record<string, unknown>
  /** Override pra pontos (raro — só pra retroativo do opt-in) */
  pointsOverride?: number
  /** Se true, ignora o check de liga_opt_in_at (uso só pra retroativo no opt-in) */
  bypassOptIn?: boolean
}

export type AwardResult = {
  ok: boolean
  awarded: boolean
  points: number
  duplicate?: boolean
  reason?: string
  temporada?: number | null
}

/**
 * Concede pontos da Liga ao user.
 * - Idempotente: mesmo (user_id, event_key) só registra 1×
 * - Respeita cap diário: se já está no cap, retorna awarded=false
 * - Respeita opt-in: bloqueado se user não opted-in (exceto bypassOptIn)
 * - Append-only: nunca atualiza, só insere
 */
export async function awardLigaPoints(params: AwardParams): Promise<AwardResult> {
  const admin = getAdmin()
  const ts = params.at || new Date()
  const points = params.pointsOverride ?? LIGA_EVENT_POINTS[params.eventType]

  try {
    // 1) Verifica opt-in (a menos que seja retroativo)
    if (!params.bypassOptIn) {
      const { data: profile } = await admin
        .from('profiles')
        .select('liga_opt_in_at')
        .eq('id', params.userId)
        .maybeSingle()
      const optInAt = (profile as { liga_opt_in_at: string | null } | null)?.liga_opt_in_at
      if (!optInAt) {
        return { ok: true, awarded: false, points: 0, reason: 'not_opted_in' }
      }
    }

    // 2) Verifica cap diário se aplicável
    const dailyCap = DAILY_CAPS[params.eventType]
    if (dailyCap !== undefined) {
      const dayStart = new Date(ts)
      dayStart.setUTCHours(0, 0, 0, 0)
      const { data: dayEvents } = await admin
        .from('liga_events')
        .select('points')
        .eq('user_id', params.userId)
        .eq('event_type', params.eventType)
        .gte('created_at', dayStart.toISOString())
      const ptsToday = (dayEvents || []).reduce((sum, e) => sum + ((e as { points: number }).points || 0), 0)
      if (ptsToday >= dailyCap) {
        return { ok: true, awarded: false, points: 0, reason: 'daily_cap_reached' }
      }
    }

    // 3) Determina Temporada
    const temporada = await getTemporadaForTimestamp(ts, admin)

    // 4) Insert idempotente
    const { error } = await admin.from('liga_events').insert({
      user_id: params.userId,
      event_type: params.eventType,
      event_key: params.eventKey,
      points,
      temporada,
      metadata: params.metadata || {},
      created_at: ts.toISOString(),
    })

    if (error) {
      // Conflito de unique = evento duplicado, é OK
      if (error.code === '23505') {
        return { ok: true, awarded: false, points: 0, duplicate: true, reason: 'already_awarded' }
      }
      console.error('[liga] award failed:', error.message)
      return { ok: false, awarded: false, points: 0, reason: 'db_error' }
    }

    return { ok: true, awarded: true, points, temporada }
  } catch (err) {
    console.error('[liga] award threw:', err)
    return { ok: false, awarded: false, points: 0, reason: 'exception' }
  }
}

// ─── Helper: get XP total do user (acumulado, Liga inteira) ──────────────

export async function getLigaXpTotal(userId: string, admin?: SupabaseClient): Promise<number> {
  const sb = admin || getAdmin()
  const { data } = await sb
    .from('liga_events')
    .select('points')
    .eq('user_id', userId)
  return (data || []).reduce((sum, e) => sum + ((e as { points: number }).points || 0), 0)
}

// ─── Helper: get XP do período (Temporada específica) ──────────────────

export async function getLigaXpPeriodo(
  userId: string,
  temporada: number,
  admin?: SupabaseClient,
): Promise<number> {
  const sb = admin || getAdmin()
  const { data } = await sb
    .from('liga_events')
    .select('points')
    .eq('user_id', userId)
    .eq('temporada', temporada)
  return (data || []).reduce((sum, e) => sum + ((e as { points: number }).points || 0), 0)
}

/**
 * Pontua user por N scans realizados HOJE.
 * Usa um event_key por dia ('scan:2026-05-15') e calcula automaticamente
 * a contribuição diária respeitando o cap (30 pts/dia).
 *
 * IMPORTANTE: como event_key é único por dia, chamar várias vezes no mesmo
 * dia NÃO cumulativamente — só o primeiro chamado conta. Pra somar scans
 * extras no mesmo dia, NÃO usar este helper — usar awardLigaPoints
 * direto com event_key único por scan.
 *
 * Versão simplificada pra MVP: cada chamada awarda 1 ponto/scan, agrupado
 * por dia. Pra contar corretamente, o caller deve passar `count = quantos
 * scans foram salvos AGORA` e o helper soma com o pré-existente.
 */
export async function awardScanPointsForToday(
  userId: string,
  count: number = 1,
): Promise<void> {
  if (count <= 0) return
  const admin = getAdmin()
  const today = new Date().toISOString().substring(0, 10) // YYYY-MM-DD

  // Quantos scans pts já tem hoje?
  const dayStart = new Date()
  dayStart.setUTCHours(0, 0, 0, 0)
  const { data: dayEvents } = await admin
    .from('liga_events')
    .select('points')
    .eq('user_id', userId)
    .eq('event_type', 'SCAN')
    .gte('created_at', dayStart.toISOString())
  const ptsToday = ((dayEvents || []) as Array<{ points: number }>)
    .reduce((sum, e) => sum + (e.points || 0), 0)

  const cap = 30
  const remaining = Math.max(0, cap - ptsToday)
  if (remaining === 0) return

  const toAward = Math.min(count, remaining)
  // Insere 1 evento com o total (deduzindo via event_key dependente do total atual)
  // Estratégia simples: usa um event_key incrementado por count atual
  const eventKey = `scan:${today}:${Date.now()}:${userId.slice(0, 8)}`
  await awardLigaPoints({
    userId,
    eventType: 'SCAN',
    eventKey,
    pointsOverride: toAward,
    metadata: { day: today, batch_count: count, capped: count > toAward },
  }).catch((err) => console.error('[liga] award scan failed:', err))
}

/**
 * Pontua 1ª foto/áudio (lifetime). Idempotente.
 */
export async function awardFirstScanIfNew(
  userId: string,
  type: 'photo' | 'audio',
): Promise<void> {
  const eventType: LigaEventType = type === 'photo' ? 'FIRST_PHOTO_SCAN' : 'FIRST_AUDIO_SCAN'
  await awardLigaPoints({
    userId,
    eventType,
    eventKey: `first_${type}_scan:${userId}`,
    metadata: { type },
  }).catch((err) => console.error(`[liga] first ${type} scan award failed:`, err))
}

// ─── Helper: detecta marcos atingidos pelo user (Trilha Digital) ────────

export type Cardapio = 'free' | 'copa'

export async function getCardapioForUser(
  userId: string,
  admin?: SupabaseClient,
): Promise<Cardapio> {
  const sb = admin || getAdmin()
  const { data } = await sb
    .from('profiles')
    .select('tier')
    .eq('id', userId)
    .maybeSingle()
  const tier = (data as { tier: string | null } | null)?.tier || 'free'
  return tier === 'copa_completa' ? 'copa' : 'free'
}

/**
 * Verifica quais marcos o user atingiu mas ainda não foram registrados em
 * liga_unlocks. Insere os novos e retorna a lista pra UI mostrar modal de
 * desbloqueio. Idempotente (PK em user_id, milestone, cardapio).
 */
export async function checkAndRegisterUnlocks(userId: string): Promise<number[]> {
  const admin = getAdmin()
  const xpTotal = await getLigaXpTotal(userId, admin)
  const cardapio = await getCardapioForUser(userId, admin)
  const marcos = cardapio === 'copa' ? TRILHA_COPA_MARCOS : TRILHA_FREE_MARCOS

  const atingidos = marcos.filter((m) => xpTotal >= m)
  if (atingidos.length === 0) return []

  // Quais já foram registrados?
  const { data: jaRegistrados } = await admin
    .from('liga_unlocks')
    .select('milestone')
    .eq('user_id', userId)
    .eq('cardapio', cardapio)
  const jaRegSet = new Set(
    ((jaRegistrados || []) as Array<{ milestone: number }>).map((r) => r.milestone),
  )

  const novos = atingidos.filter((m) => !jaRegSet.has(m))
  if (novos.length === 0) return []

  // Insere os novos
  const inserts = novos.map((m) => ({
    user_id: userId,
    milestone: m,
    cardapio,
  }))
  const { error } = await admin.from('liga_unlocks').insert(inserts)
  if (error) {
    console.error('[liga] unlock insert failed:', error.message)
    return []
  }
  return novos
}

// ─── Helper: login diário + streak (3/7/15 dias seguidos) ───────────────

/**
 * Retorna YYYY-MM-DD do "hoje" em horário de Brasília (BRT/UTC-3, sem DST).
 * Usamos BRT pra alinhar a contagem de streak com o calendário do user
 * (não com UTC, que vira "novo dia" às 21:00 BRT).
 */
function todayBRT(): string {
  const now = new Date()
  // BRT = UTC - 3
  const brtMs = now.getTime() - 3 * 60 * 60 * 1000
  return new Date(brtMs).toISOString().substring(0, 10)
}

/**
 * Marca login do dia, awarda LOGIN_DAILY (+1) e verifica se atingiu marcos
 * de streak (3/7/15 dias seguidos). Idempotente — chamar várias vezes no
 * mesmo dia tem custo de 1 round-trip mas não dispara pontuação extra.
 *
 * Streak = quantos dias consecutivos terminando em hoje (inclusive) o user
 * teve registro em daily_logins. Buscamos os últimos 16 dias e contamos
 * pra trás a partir de hoje, parando ao primeiro gap.
 *
 * Fail-open por padrão (catch externo). Chamado em fire-and-forget pelo
 * (protected)/layout.tsx.
 */
export async function awardLoginAndStreak(userId: string): Promise<void> {
  const admin = getAdmin()
  const today = todayBRT()

  // 1. Marca login do dia (idempotente via PK)
  const { error: insErr } = await admin
    .from('daily_logins')
    .upsert({ user_id: userId, login_date: today }, { onConflict: 'user_id,login_date' })
  if (insErr) {
    console.error('[liga] daily_logins upsert failed:', insErr.message)
    // Continua mesmo assim — talvez já existisse e o upsert falhou por outra razão
  }

  // 2. Awarda LOGIN_DAILY (+1) com event_key incluindo data — idempotente.
  //    Se já pontuou hoje, é no-op no awardLigaPoints.
  await awardLigaPoints({
    userId,
    eventType: 'LOGIN_DAILY',
    eventKey: `login_daily:${userId}:${today}`,
    metadata: { date: today },
  }).catch((err) => console.error('[liga] LOGIN_DAILY failed:', err))

  // 3. Conta streak: pega últimos 16 dias de logins desse user, conta
  //    consecutivos terminando em hoje.
  const sixteenDaysAgo = new Date()
  sixteenDaysAgo.setUTCDate(sixteenDaysAgo.getUTCDate() - 16)
  const { data: recentLogins } = await admin
    .from('daily_logins')
    .select('login_date')
    .eq('user_id', userId)
    .gte('login_date', sixteenDaysAgo.toISOString().substring(0, 10))
    .order('login_date', { ascending: false })

  const datesSet = new Set(
    ((recentLogins || []) as Array<{ login_date: string }>).map((r) => r.login_date),
  )

  let streak = 0
  const cursor = new Date(today + 'T00:00:00Z')
  while (datesSet.has(cursor.toISOString().substring(0, 10))) {
    streak++
    cursor.setUTCDate(cursor.getUTCDate() - 1)
    if (streak > 20) break // hard cap defensivo
  }

  // 4. Marcos de streak — cada um é 1× lifetime (event_key fixo por user).
  if (streak >= 3) {
    await awardLigaPoints({
      userId,
      eventType: 'STREAK_3',
      eventKey: `streak_3:${userId}`,
    }).catch((err) => console.error('[liga] STREAK_3 failed:', err))
  }
  if (streak >= 7) {
    await awardLigaPoints({
      userId,
      eventType: 'STREAK_7',
      eventKey: `streak_7:${userId}`,
    }).catch((err) => console.error('[liga] STREAK_7 failed:', err))
  }
  if (streak >= 15) {
    await awardLigaPoints({
      userId,
      eventType: 'STREAK_15',
      eventKey: `streak_15:${userId}`,
    }).catch((err) => console.error('[liga] STREAK_15 failed:', err))
  }

  // 5. Re-check unlocks da Trilha (streak de 15 dá +50 → pode passar marco 100)
  await checkAndRegisterUnlocks(userId).catch(() => {})
}
