/**
 * Liga Complete Aí — admin section (read-only).
 *
 * Painel de controle da Liga 2026 (T1 = 15/05 → 29/05; T2..T4 + Campeão Geral).
 * Foco em: opt-in, gate da Temporada ativa, top 10 do período, marcos da
 * Trilha Digital batidos, engajamento 7d, distribuição por tier.
 *
 * Tudo via `getAdmin()` (service_role bypassa RLS habilitado em 21/05).
 * Sem ações interativas no MVP — só leitura.
 */
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { TIER_CONFIG, type Tier } from '@/lib/tiers'
import {
  TRILHA_FREE_MARCOS,
  TRILHA_COPA_MARCOS,
} from '@/lib/liga'

const DAY_MS = 24 * 60 * 60 * 1000

function getAdmin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

type Temporada = {
  numero: number
  starts_at: string
  ends_at: string
  status: string
  gate_min_participants: number | null
  gate_min_points: number | null
  gate_passed: boolean | null
  total_participants: number | null
  participants_above_threshold: number | null
}

type LigaEventRow = { user_id: string; points: number; temporada: number | null; created_at: string }

export default async function LigaAdminSection() {
  const admin = getAdmin()
  const now = new Date()
  const nowIso = now.toISOString()
  const sevenDaysAgo = new Date(now.getTime() - 7 * DAY_MS).toISOString()
  const oneDayAgo = new Date(now.getTime() - DAY_MS).toISOString()

  // ── Queries em paralelo (estado global) ──
  const [
    optInRes,
    totalUsersRes,
    temporadasRes,
    eventos24hRes,
    eventos7dRes,
    optIns7dRes,
    logins7dRes,
    unlocksRes,
    optInTiersRes,
  ] = await Promise.all([
    // Total opt-in
    admin.from('profiles')
      .select('*', { count: 'exact', head: true })
      .not('liga_opt_in_at', 'is', null),
    // Total users
    admin.from('profiles').select('*', { count: 'exact', head: true }),
    // Todas as Temporadas (config + status)
    admin.from('liga_temporadas')
      .select('numero, starts_at, ends_at, status, gate_min_participants, gate_min_points, gate_passed, total_participants, participants_above_threshold')
      .order('numero'),
    // Eventos últimas 24h (contagem)
    admin.from('liga_events')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', oneDayAgo),
    // Eventos últimos 7 dias (pra sparkline)
    admin.from('liga_events')
      .select('created_at')
      .gte('created_at', sevenDaysAgo)
      .limit(50000),
    // Novos opt-ins últimos 7d (pra sparkline)
    admin.from('profiles')
      .select('liga_opt_in_at')
      .not('liga_opt_in_at', 'is', null)
      .gte('liga_opt_in_at', sevenDaysAgo),
    // Logins diários últimos 7d
    admin.from('daily_logins')
      .select('login_date, user_id')
      .gte('login_date', sevenDaysAgo.split('T')[0])
      .limit(10000),
    // Marcos batidos (todos)
    admin.from('liga_unlocks').select('milestone, cardapio'),
    // Tier dos opted-in
    admin.from('profiles')
      .select('tier')
      .not('liga_opt_in_at', 'is', null),
  ])

  const optInTotal = optInRes.count ?? 0
  const totalUsers = totalUsersRes.count ?? 0
  const eventos24h = eventos24hRes.count ?? 0
  const temporadas = (temporadasRes.data || []) as Temporada[]

  // ── Temporada ativa ──
  const ativa = temporadas.find(
    (t) => t.status !== 'cancelled' && nowIso >= t.starts_at && nowIso <= t.ends_at,
  ) ?? null
  const proxima = temporadas.find(
    (t) => t.status !== 'cancelled' && nowIso < t.starts_at,
  ) ?? null

  const diasRestantesAtiva = ativa
    ? Math.max(0, Math.ceil((new Date(ativa.ends_at).getTime() - now.getTime()) / DAY_MS))
    : 0

  // ── Top 10 da Temporada ativa (agregação client-side) ──
  // Pra escalar com cresimento da Liga: pode virar RPC no DB depois.
  let xpTotalTemporada = 0
  let topTemporada: Array<{
    rank: number
    user_id: string
    display_name: string | null
    tier: Tier
    xp_periodo: number
    xp_total: number
  }> = []
  let totalParticipantsAtuais = 0
  let participantsAbove100 = 0

  if (ativa) {
    const { data: periodoEvts } = await admin
      .from('liga_events')
      .select('user_id, points')
      .eq('temporada', ativa.numero)
      .limit(50000)

    const byUserPeriodo = new Map<string, number>()
    for (const e of (periodoEvts || []) as Array<{ user_id: string; points: number }>) {
      byUserPeriodo.set(e.user_id, (byUserPeriodo.get(e.user_id) || 0) + (e.points || 0))
      xpTotalTemporada += e.points || 0
    }
    totalParticipantsAtuais = byUserPeriodo.size
    // Threshold do gate (default 100 se config vazia)
    const threshold = ativa.gate_min_points ?? 100
    participantsAbove100 = Array.from(byUserPeriodo.values()).filter((p) => p >= threshold).length

    const sortedTop = Array.from(byUserPeriodo.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)

    if (sortedTop.length > 0) {
      const topIds = sortedTop.map(([uid]) => uid)
      // Lifetime XP de cada um do top 10
      const { data: allEvts } = await admin
        .from('liga_events')
        .select('user_id, points')
        .in('user_id', topIds)
      const lifetimeByUser = new Map<string, number>()
      for (const e of (allEvts || []) as Array<{ user_id: string; points: number }>) {
        lifetimeByUser.set(e.user_id, (lifetimeByUser.get(e.user_id) || 0) + (e.points || 0))
      }
      // Profile (nome + tier)
      const { data: profs } = await admin
        .from('profiles')
        .select('id, display_name, tier')
        .in('id', topIds)
      const profById = new Map(
        (profs || []).map((p) => [
          (p as { id: string }).id,
          p as { id: string; display_name: string | null; tier: string | null },
        ]),
      )
      topTemporada = sortedTop.map(([uid, xp], i) => {
        const prof = profById.get(uid)
        return {
          rank: i + 1,
          user_id: uid,
          display_name: prof?.display_name ?? null,
          tier: ((prof?.tier ?? 'free') as Tier),
          xp_periodo: xp,
          xp_total: lifetimeByUser.get(uid) ?? xp,
        }
      })
    }
  }

  // ── Marcos batidos (count por milestone+cardapio) ──
  const unlocksByKey = new Map<string, number>()
  for (const u of (unlocksRes.data || []) as Array<{ milestone: number; cardapio: string }>) {
    const k = `${u.cardapio}:${u.milestone}`
    unlocksByKey.set(k, (unlocksByKey.get(k) || 0) + 1)
  }

  // ── Sparklines 7d ──
  const labels7d = dateLabels(7)
  const eventosByDay = bucketCreatedAt(
    (eventos7dRes.data || []) as Array<{ created_at: string }>,
    7,
  )
  const optInsByDay = bucketCreatedAt(
    ((optIns7dRes.data || []) as Array<{ liga_opt_in_at: string }>).map((r) => ({ created_at: r.liga_opt_in_at })),
    7,
  )
  // Logins: unique (user_id, login_date) per day
  const loginsByDay = (() => {
    const indexByDate = new Map(labels7d.map((l, i) => [l, i]))
    const buckets = new Array(7).fill(0)
    for (const row of (logins7dRes.data || []) as Array<{ login_date: string }>) {
      const idx = indexByDate.get(row.login_date)
      if (idx !== undefined) buckets[idx]++
    }
    return buckets
  })()

  // ── Tier dos opt-in ──
  const tierCountsOptIn: Record<Tier, number> = { free: 0, estreante: 0, colecionador: 0, copa_completa: 0 }
  for (const row of (optInTiersRes.data || []) as Array<{ tier: string | null }>) {
    const t = ((row.tier || 'free') as Tier)
    if (t in tierCountsOptIn) tierCountsOptIn[t]++
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mt-8 mb-4" style={{ color: '#0A1628' }}>
        🏆 Liga Complete Aí 2026
      </h2>

      {/* ── Bloco 1: Status global ── */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
        <AdminStat
          label="Opt-in"
          value={optInTotal}
          sub={`${pctOf(optInTotal, totalUsers)}% dos ${totalUsers} users`}
        />
        <AdminStat
          label="Temporada ativa"
          value={ativa ? `T${ativa.numero}` : (proxima ? 'em hiato' : '—')}
          sub={ativa
            ? `${formatDayMonth(ativa.starts_at)}–${formatDayMonth(ativa.ends_at)} · ${diasRestantesAtiva}d restantes`
            : (proxima ? `próxima: T${proxima.numero} em ${formatDayMonth(proxima.starts_at)}` : 'nenhuma agendada')}
        />
        <AdminStat
          label="Pontos da Temporada"
          value={xpTotalTemporada}
          sub={ativa ? `entre ${totalParticipantsAtuais} participantes` : '—'}
        />
        <AdminStat label="Eventos 24h" value={eventos24h} sub="liga_events" />
        <AdminStat
          label="Status gate"
          value={
            ativa?.gate_passed === true ? '✅ passou'
            : ativa?.gate_passed === false ? '❌ não passou'
            : '⏳ pendente'
          }
          sub={ativa
            ? `${totalParticipantsAtuais}/${ativa.gate_min_participants ?? '—'} part · ${participantsAbove100}/${ativa.gate_min_participants ?? '—'} ≥${ativa.gate_min_points ?? 100}pts`
            : '—'}
        />
      </div>

      {/* ── Bloco 2: Gate progress visual ── */}
      {ativa && (
        <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
          <p className="text-sm font-semibold text-gray-700 mb-3">
            Gate T{ativa.numero} → T{ativa.numero + 1}
          </p>
          <GateBar
            label="Total de participantes"
            current={totalParticipantsAtuais}
            target={ativa.gate_min_participants ?? 70}
          />
          <div className="h-2" />
          <GateBar
            label={`Participantes com ≥${ativa.gate_min_points ?? 100} pts`}
            current={participantsAbove100}
            target={ativa.gate_min_participants ?? 70}
          />
          {ativa.gate_passed === null && (
            <p className="text-[11px] text-gray-400 mt-3">
              Cron <code>liga-close-temporada-daily</code> avalia o gate quando a Temporada
              fecha em {formatDayMonth(ativa.ends_at)}.
            </p>
          )}
        </div>
      )}

      {/* ── Bloco 3: Top 10 da Temporada ── */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden mb-4">
        <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
          <p className="text-sm font-semibold text-gray-700">
            Top 10 da Temporada {ativa ? `T${ativa.numero}` : 'ativa'}
          </p>
          <p className="text-[10px] text-gray-500">Ranking pelo XP do período (resetará na próxima Temporada)</p>
        </div>
        {topTemporada.length === 0 ? (
          <p className="text-sm text-gray-500 px-4 py-8 text-center">
            {ativa ? 'Nenhum evento registrado ainda nesta Temporada.' : 'Sem Temporada ativa no momento.'}
          </p>
        ) : (
          <div className="divide-y divide-gray-100">
            {topTemporada.map((r) => (
              <div key={r.user_id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="w-8 text-center font-bold text-gray-500 shrink-0">
                  {r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : `#${r.rank}`}
                </span>
                <span className="flex-1 min-w-0 truncate text-gray-800">
                  {r.display_name || <span className="text-gray-400">(sem nome)</span>}
                </span>
                <TierBadge tier={r.tier} />
                <span className="text-xs text-gray-500 w-24 text-right tabular-nums" title="XP lifetime (todas Temporadas)">
                  lifetime {r.xp_total}
                </span>
                <span className="font-black text-brand w-16 text-right tabular-nums">{r.xp_periodo} pts</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Bloco 4: Marcos batidos (Trilha Digital) ── */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden mb-4">
        <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
          <p className="text-sm font-semibold text-gray-700">Marcos da Trilha Digital batidos</p>
          <p className="text-[10px] text-gray-500">Cardápio depende do tier (Copa Completa = trilha 'copa', resto = 'free')</p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] text-gray-500 bg-gray-50/40">
              <th className="px-4 py-2 font-medium">Marco (pts)</th>
              <th className="px-4 py-2 font-medium text-right">Trilha Free</th>
              <th className="px-4 py-2 font-medium text-right">Trilha Copa</th>
            </tr>
          </thead>
          <tbody>
            {Array.from(new Set([...TRILHA_FREE_MARCOS, ...TRILHA_COPA_MARCOS]))
              .sort((a, b) => a - b)
              .map((m) => {
                const freeCount = TRILHA_FREE_MARCOS.includes(m as 100 | 300 | 700 | 1500 | 3000)
                  ? (unlocksByKey.get(`free:${m}`) || 0)
                  : null
                const copaCount = TRILHA_COPA_MARCOS.includes(m as 500 | 800 | 1000 | 1500 | 4000)
                  ? (unlocksByKey.get(`copa:${m}`) || 0)
                  : null
                return (
                  <tr key={m} className="border-t border-gray-100">
                    <td className="px-4 py-2 font-mono text-gray-700">{m.toLocaleString('pt-BR')}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {freeCount === null ? <span className="text-gray-300">—</span> : freeCount}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {copaCount === null ? <span className="text-gray-300">—</span> : copaCount}
                    </td>
                  </tr>
                )
              })}
          </tbody>
        </table>
      </div>

      {/* ── Bloco 5: Engajamento 7d (sparklines) ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <SparkCard label="Eventos / dia" buckets={eventosByDay} color="#00C896" />
        <SparkCard label="Novos opt-ins / dia" buckets={optInsByDay} color="#FFB800" />
        <SparkCard label="Logins / dia" buckets={loginsByDay} color="#0A1628" />
      </div>

      {/* ── Bloco 6: Distribuição por tier dos opt-in ── */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
        <p className="text-sm font-semibold text-gray-700 mb-3">Tier dos participantes (opt-in)</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {(['free', 'estreante', 'colecionador', 'copa_completa'] as const).map((t) => (
            <div key={t} className="flex items-center justify-between border border-gray-100 rounded px-3 py-2">
              <TierBadge tier={t} />
              <span className="text-xl font-black text-gray-800 tabular-nums">
                {tierCountsOptIn[t]}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Helpers ───

function pctOf(part: number, total: number): string {
  if (total === 0) return '0'
  return ((part / total) * 100).toFixed(1)
}

function formatDayMonth(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function dateLabels(days: number): string[] {
  const now = new Date()
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(now)
    d.setUTCHours(0, 0, 0, 0)
    d.setUTCDate(d.getUTCDate() - (days - 1 - i))
    return d.toISOString().split('T')[0]
  })
}

function bucketCreatedAt(items: { created_at: string }[], days: number): number[] {
  const labels = dateLabels(days)
  const indexByDate = new Map(labels.map((label, i) => [label, i]))
  const buckets = new Array(days).fill(0)
  for (const item of items) {
    const dayKey = item.created_at.slice(0, 10)
    const idx = indexByDate.get(dayKey)
    if (idx !== undefined) buckets[idx]++
  }
  return buckets
}

function AdminStat({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  const display = typeof value === 'number' ? value.toLocaleString('pt-BR') : value
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3">
      <p className="text-2xl font-black text-gray-800 truncate">{display}</p>
      <p className="text-[10px] text-gray-500 leading-tight mt-1">{label}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

function TierBadge({ tier }: { tier: Tier }) {
  const styles: Record<Tier, string> = {
    free: 'bg-gray-100 text-gray-600 border-gray-200',
    estreante: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    colecionador: 'bg-amber-50 text-amber-700 border-amber-200',
    copa_completa: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded border w-24 justify-center ${styles[tier]}`}>
      {TIER_CONFIG[tier].label}
    </span>
  )
}

function GateBar({ label, current, target }: { label: string; current: number; target: number }) {
  const pct = target > 0 ? Math.min(100, (current / target) * 100) : 0
  const done = current >= target
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs text-gray-600 mb-1">
        <span>{label}</span>
        <span className="tabular-nums">
          <span className={done ? 'text-emerald-600 font-bold' : 'font-bold text-gray-800'}>{current}</span>
          <span className="text-gray-400"> / {target}</span>
          <span className="text-gray-400"> ({pct.toFixed(0)}%)</span>
        </span>
      </div>
      <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
        <div
          className={`h-full rounded-full ${done ? 'bg-emerald-500' : 'bg-amber-400'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

function SparkCard({ label, buckets, color }: { label: string; buckets: number[]; color: string }) {
  const total = buckets.reduce((s, v) => s + v, 0)
  const max = Math.max(...buckets, 1)
  const width = 240
  const height = 40
  const barW = width / buckets.length
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3">
      <div className="flex items-baseline justify-between mb-1">
        <p className="text-[10px] uppercase tracking-wide text-gray-500">{label}</p>
        <p className="text-xs font-bold text-gray-800 tabular-nums">{total}</p>
      </div>
      <svg viewBox={`0 0 ${width} ${height + 12}`} preserveAspectRatio="none" className="w-full h-12">
        {buckets.map((v, i) => {
          const h = (v / max) * height
          const x = i * barW
          const y = height - h
          return (
            <rect
              key={i}
              x={x + 0.5}
              y={y}
              width={Math.max(barW - 1, 1)}
              height={h}
              fill={color}
              opacity={v === 0 ? 0.15 : 0.95}
              rx={1}
            >
              <title>{`${v}`}</title>
            </rect>
          )
        })}
        <text x={0} y={height + 10} fontSize={8} fill="#9CA3AF">
          7d atrás
        </text>
        <text x={width} y={height + 10} fontSize={8} fill="#9CA3AF" textAnchor="end">
          hoje
        </text>
      </svg>
    </div>
  )
}
