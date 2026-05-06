// Pedro 2026-05-06: render tardio de campanhas (embaixadores + 0-figurinhas).
//
// Toda lógica de render fica aqui pra dois usos:
//   1) /api/admin/campaign-preview — Pedro vê amostras com dados de AGORA
//   2) /api/cron/send-campaign-batch — cron renderiza com dados LIVE no horário do disparo
//
// Princípio: nada é congelado. Listas e ranking sempre re-puxados na hora.

import type { SupabaseClient } from '@supabase/supabase-js'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.completeai.com.br'
const CAMPAIGN_END_DATE = new Date('2026-05-13T02:59:59.000Z')

// Capitalize primeira letra (display_name pode vir 'antonio' ou 'ANTONIO').
function capitalize(s: string | null | undefined): string {
  if (!s) return ''
  const trim = s.trim()
  if (!trim) return ''
  return trim.charAt(0).toUpperCase() + trim.slice(1).toLowerCase()
}

// ─── Helpers de ranking ──────────────────────────────────────────────────

export type RankingRow = {
  user_id: string
  rank: number
  confirmed_count: number
  paid_upgrade_count: number
  total_points: number
}

export type Top3Entry = {
  firstName: string
  points: number
}

export type UserPosition = {
  rank: number
  points: number
  totalRanked: number
  isTied: boolean // true se há outro user no mesmo rank
}

// ─── Ranking via SQL inline (não usa RPC pra evitar filtros de SECURITY DEFINER) ──

type FullRanking = Array<{ user_id: string; display_name: string | null; total_points: number; rank: number }>

async function loadFullRanking(admin: SupabaseClient): Promise<FullRanking> {
  // Embaixadores opted-in não excluídos
  const { data: parts } = await admin
    .from('profiles')
    .select('id, display_name, self_upgrade_at, opted_into_campaign_at')
    .not('opted_into_campaign_at', 'is', null)
    .eq('excluded_from_campaign', false)

  if (!parts || parts.length === 0) return []

  const rows = parts as Array<{
    id: string
    display_name: string | null
    self_upgrade_at: string | null
    opted_into_campaign_at: string
  }>

  // Pontos por referral (só status confirmed/paid_upgrade)
  const ids = rows.map((r) => r.id)
  const { data: rewards } = await admin
    .from('referral_rewards')
    .select('referrer_id, status, points')
    .in('referrer_id', ids)
    .in('status', ['confirmed', 'paid_upgrade'])

  const refRows = (rewards || []) as Array<{ referrer_id: string; status: string; points: number | null }>
  const refMap = new Map<string, number>()
  for (const r of refRows) {
    refMap.set(r.referrer_id, (refMap.get(r.referrer_id) || 0) + (r.points || 0))
  }

  // Score = referral_points + 5 (se self_upgrade durante campanha)
  const CAMP_START = new Date('2026-04-29T03:00:00.000Z').getTime()
  const CAMP_END = new Date('2026-05-13T02:59:59.000Z').getTime()
  const scored = rows.map((r) => {
    const refPts = refMap.get(r.id) || 0
    const suTime = r.self_upgrade_at ? new Date(r.self_upgrade_at).getTime() : 0
    const selfBonus = suTime >= CAMP_START && suTime < CAMP_END ? 5 : 0
    return {
      user_id: r.id,
      display_name: r.display_name,
      total_points: refPts + selfBonus,
    }
  })

  // Ordena (desc por pontos, tie-break por id) e atribui ranks (1-based, com empate)
  scored.sort((a, b) => {
    if (b.total_points !== a.total_points) return b.total_points - a.total_points
    return a.user_id.localeCompare(b.user_id)
  })

  // Filtra só com pontos > 0 (alinhado com RPC)
  const withPts = scored.filter((s) => s.total_points > 0)

  // Atribui rank com empate verdadeiro (mesma pontuação = mesmo rank)
  const ranked: FullRanking = []
  let currentRank = 0
  let prevPoints = -1
  withPts.forEach((s, idx) => {
    if (s.total_points !== prevPoints) {
      currentRank = idx + 1
      prevPoints = s.total_points
    }
    ranked.push({ ...s, rank: currentRank })
  })

  return ranked
}

/**
 * Top 3 distinto por rank (em caso de empate no rank N, pega só 1 por rank).
 */
export async function getTop3WithNames(admin: SupabaseClient): Promise<Top3Entry[]> {
  const ranking = await loadFullRanking(admin)
  if (ranking.length === 0) return []

  const top3: Top3Entry[] = []
  const seenRanks = new Set<number>()
  for (const r of ranking) {
    if (top3.length >= 3) break
    if (seenRanks.has(r.rank)) continue
    seenRanks.add(r.rank)
    const raw = (r.display_name || 'Anônimo').split(' ')[0]
    const firstName = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase()
    top3.push({ firstName, points: r.total_points })
  }
  return top3
}

/**
 * Posição do user no ranking. null se sem pontos.
 */
export async function getUserPosition(
  admin: SupabaseClient,
  userId: string,
): Promise<UserPosition | null> {
  const ranking = await loadFullRanking(admin)
  const me = ranking.find((r) => r.user_id === userId)
  if (!me) return null
  const sameRankCount = ranking.filter((r) => r.rank === me.rank).length
  return {
    rank: me.rank,
    points: me.total_points,
    totalRanked: ranking.length,
    isTied: sameRankCount > 1,
  }
}

// ─── Templates ───────────────────────────────────────────────────────────

function pluralPoints(n: number): string {
  return n === 1 ? '1 ponto' : `${n} pontos`
}

function ordinal(n: number): string {
  // 1º, 2º, 3º, ...
  return `${n}º`
}

export function renderTop3Lines(top3: Top3Entry[]): string {
  if (top3.length === 0) return '_(ainda sem ranking — bora ser o primeiro?)_'
  const medals = ['🥇', '🥈', '🥉']
  return top3
    .map((e, i) => `${medals[i]} ${e.firstName} — ${pluralPoints(e.points)}`)
    .join('\n')
}

export function renderPositionLine(pos: UserPosition | null): string {
  if (!pos) return 'Você ainda não pontuou — bora começar?'
  const tied = pos.isTied ? 'empatado em ' : ''
  const medal = pos.rank === 1 ? ' 🥇' : pos.rank === 2 ? ' 🥈' : pos.rank === 3 ? ' 🥉' : ''
  return `Você está ${tied}${ordinal(pos.rank)} lugar com ${pluralPoints(pos.points)}${medal}`
}

function daysUntilCampaignEnd(now: Date = new Date()): number {
  // Conta dias-de-calendário restantes em America/Sao_Paulo.
  // Hoje 06/05 → fim 12/05 → 6 dias (não 7).
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const todayStr = fmt.format(now) // YYYY-MM-DD
  const endStr = '2026-05-12'
  const todayDate = new Date(todayStr + 'T00:00:00Z').getTime()
  const endDate = new Date(endStr + 'T00:00:00Z').getTime()
  const diffDays = Math.round((endDate - todayDate) / (1000 * 60 * 60 * 24))
  return Math.max(0, diffDays)
}

// ─── Embaixador WhatsApp ─────────────────────────────────────────────────

export function renderEmbaixadorWhatsApp(
  firstName: string,
  pos: UserPosition | null,
  top3: Top3Entry[],
): string {
  const days = daysUntilCampaignEnd()
  return (
    `Oi ${firstName}! 👋\n\n` +
    `Você se inscreveu como embaixador no Complete Aí — atualização rápida do ranking.\n\n` +
    `Faltam ${days} dias até o fim da campanha (12/05). O top 3 leva kit figurinhas em casa pelos Correios:\n\n` +
    `🥇 1º — Porta-figurinha + 10 pacotes + 5 trocas extras\n` +
    `🥈 2º — Porta-figurinha + 8 pacotes + 5 trocas extras\n` +
    `🥉 3º — 5 pacotes + 5 trocas extras\n\n` +
    `*Top 3 agora:*\n${renderTop3Lines(top3)}\n\n` +
    `${renderPositionLine(pos)}\n\n` +
    `*Como subir no ranking:*\n` +
    `• 1 ponto por amigo que se cadastra pelo seu link (+ 1 scan grátis pra você)\n` +
    `• 5 pontos quando esse amigo assina qualquer plano pago\n` +
    `• 5 pontos se VOCÊ assinar ou fizer upgrade em qualquer plano\n\n` +
    `Seu link único e ranking ao vivo:\n${APP_URL}/campanha\n\n` +
    `Bora? 🚀`
  )
}

// ─── Embaixador Email ────────────────────────────────────────────────────

export function renderEmbaixadorEmail(
  firstName: string,
  pos: UserPosition | null,
  top3: Top3Entry[],
): { subject: string; html: string } {
  const days = daysUntilCampaignEnd()
  const subject = `${firstName}, faltam ${days} dias na campanha de embaixadores`

  // Versão HTML legível
  const top3Html = top3.length === 0
    ? '<p style="color:#6B7280;font-style:italic;margin:0">(ainda sem ranking — bora ser o primeiro?)</p>'
    : top3
        .map((e, i) => {
          const medal = ['🥇', '🥈', '🥉'][i]
          return `<p style="margin:0 0 4px;color:#374151">${medal} <strong>${e.firstName}</strong> — ${pluralPoints(e.points)}</p>`
        })
        .join('')

  const positionHtml = pos
    ? `<p style="margin:16px 0;font-size:16px;color:#0A1628"><strong>${renderPositionLine(pos)}</strong></p>`
    : `<p style="margin:16px 0;font-size:16px;color:#0A1628"><strong>Você ainda não pontuou — bora começar?</strong></p>`

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0A1628">
      <h1 style="color:#0A1628;font-size:22px;margin:0 0 16px">Oi ${firstName} 👋</h1>
      <p style="margin:0 0 16px;color:#374151;line-height:1.6">
        Você se inscreveu como embaixador no Complete Aí — segue uma atualização do ranking.
      </p>
      <p style="margin:0 0 16px;color:#374151;line-height:1.6">
        A campanha termina dia <strong>12/05</strong> (${days} dias). O top 3 leva kit figurinhas em casa pelos Correios:
      </p>
      <div style="background:#FFF8E6;border-radius:12px;padding:16px;margin:16px 0">
        <p style="margin:0 0 4px;color:#374151">🥇 <strong>1º</strong> — Porta-figurinha + 10 pacotes + 5 trocas extras</p>
        <p style="margin:0 0 4px;color:#374151">🥈 <strong>2º</strong> — Porta-figurinha + 8 pacotes + 5 trocas extras</p>
        <p style="margin:0 0 0;color:#374151">🥉 <strong>3º</strong> — 5 pacotes + 5 trocas extras</p>
      </div>
      <h2 style="color:#0A1628;font-size:16px;margin:20px 0 8px">Top 3 agora:</h2>
      <div style="background:#F3F4F6;border-radius:8px;padding:12px">
        ${top3Html}
      </div>
      ${positionHtml}
      <h2 style="color:#0A1628;font-size:16px;margin:20px 0 8px">Como pontuar:</h2>
      <ul style="margin:0 0 16px;padding-left:20px;color:#374151;line-height:1.8">
        <li>1 ponto por amigo que se cadastra pelo seu link (+ 1 scan grátis pra você)</li>
        <li>5 pontos quando esse amigo assina qualquer plano pago (Estreante, Colecionador ou Copa Completa)</li>
        <li>5 pontos se você mesmo assinar ou fizer upgrade em qualquer plano</li>
      </ul>
      <div style="text-align:center;margin:24px 0">
        <a href="${APP_URL}/campanha" style="display:inline-block;background:#00C896;color:white;padding:12px 28px;border-radius:10px;font-weight:bold;text-decoration:none">Ver meu ranking</a>
      </div>
      <p style="color:#6B7280;font-size:12px;margin:24px 0 0;text-align:center">
        Equipe Complete Aí · ${APP_URL}
      </p>
    </div>`

  return { subject, html }
}

// ─── Zero figurinhas Email ───────────────────────────────────────────────

export function renderZeroFigEmail(firstName: string): { subject: string; html: string } {
  const subject = `${firstName}, seu álbum ainda está vazio por aqui`
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0A1628">
      <h1 style="color:#0A1628;font-size:22px;margin:0 0 16px">Oi ${firstName},</h1>
      <p style="margin:0 0 16px;color:#0A1628;font-size:16px;font-style:italic">
        A comunidade está sentindo falta das suas figurinhas...
      </p>
      <p style="margin:0 0 16px;color:#374151;line-height:1.6">
        Você se cadastrou no Complete Aí mas ainda não registrou nenhuma. Que tal mudar isso agora?
      </p>
      <p style="margin:0 0 12px;color:#374151;line-height:1.6">
        Registrar é mais simples do que parece — você escolhe como prefere:
      </p>
      <div style="background:#F3F4F6;border-radius:12px;padding:16px;margin:16px 0">
        <p style="margin:0 0 8px;color:#374151">📸 <strong>Foto da página do álbum</strong> (a IA reconhece todas de uma vez)</p>
        <p style="margin:0 0 8px;color:#374151">🃏 <strong>Foto das figurinhas soltas</strong> (mesmo se forem várias)</p>
        <p style="margin:0 0 8px;color:#374151">🎙️ <strong>Áudio ditando os códigos</strong> (ex: "BRA 1, BRA 5, ARG 3...")</p>
        <p style="margin:0 0 0;color:#374151">✍️ <strong>Mensagem de texto</strong> com os códigos</p>
      </div>
      <p style="margin:16px 0;color:#374151;line-height:1.6">
        Tudo pelo WhatsApp — ou, se preferir, pelo site.
      </p>
      <p style="margin:16px 0;color:#0A1628;line-height:1.6;font-weight:600">
        Esteja a uma mensagem (ou um clique) das suas repetidas e faltantes. Tenha o álbum organizado, complete mais rápido e gastando menos.
      </p>
      <div style="text-align:center;margin:28px 0">
        <a href="${APP_URL}" style="display:inline-block;background:#00C896;color:white;padding:14px 32px;border-radius:10px;font-weight:bold;text-decoration:none;font-size:16px">Começar agora</a>
      </div>
      <p style="margin:16px 0 0;color:#6B7280;font-size:13px;line-height:1.6;text-align:center">
        Qualquer dúvida, é só responder este email.
      </p>
      <p style="color:#6B7280;font-size:12px;margin:24px 0 0;text-align:center">
        Equipe Complete Aí · ${APP_URL}
      </p>
    </div>`

  return { subject, html }
}

// ─── Targets resolvers (LIVE — sempre re-puxa) ──────────────────────────

export type TargetEmbaixador = {
  user_id: string
  first_name: string
  phone: string | null
  email: string | null
}

export type TargetZeroFig = {
  user_id: string
  first_name: string
  email: string
}

/**
 * Embaixadores opt-in válidos. Filtra com_phone vs sem_phone segundo o tipo.
 */
export async function getEmbaixadorTargets(
  admin: SupabaseClient,
  channel: 'wa' | 'email',
): Promise<TargetEmbaixador[]> {
  const { data } = await admin
    .from('profiles')
    .select('id, display_name, phone, email')
    .not('opted_into_campaign_at', 'is', null)
    .eq('excluded_from_campaign', false)

  if (!data) return []

  const rows = data as Array<{
    id: string
    display_name: string | null
    phone: string | null
    email: string | null
  }>

  return rows
    .filter((r) => {
      const hasPhone = r.phone && r.phone.length >= 12
      return channel === 'wa' ? hasPhone : !hasPhone
    })
    .map((r) => ({
      user_id: r.id,
      first_name: capitalize(r.display_name?.split(' ')[0]) || 'Embaixador',
      phone: r.phone,
      email: r.email,
    }))
}

/**
 * Users com 0 figurinhas e cadastro >= 3 dias atrás. LIVE — se alguém registrou
 * fig nas últimas horas, sai automaticamente da lista.
 */
export async function getZeroFigTargets(
  admin: SupabaseClient,
): Promise<TargetZeroFig[]> {
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()

  // Primeiro pega candidatos por idade do cadastro
  const { data: candidates } = await admin
    .from('profiles')
    .select('id, display_name, email')
    .lte('created_at', threeDaysAgo)
    .eq('excluded_from_campaign', false)
    .not('email', 'is', null)

  if (!candidates) return []

  const rows = candidates as Array<{
    id: string
    display_name: string | null
    email: string | null
  }>

  // Filtra os que NÃO têm sticker registrado
  const result: TargetZeroFig[] = []
  for (const r of rows) {
    if (!r.email) continue
    const { count } = await admin
      .from('user_stickers')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', r.id)
      .gt('quantity', 0)

    if ((count ?? 0) === 0) {
      result.push({
        user_id: r.id,
        first_name: capitalize(r.display_name?.split(' ')[0]) || 'Olá',
        email: r.email,
      })
    }
  }

  return result
}
