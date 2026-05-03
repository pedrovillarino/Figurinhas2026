/**
 * Audio Engagement — espelho do ScanEngagement, mas pra áudio.
 * Pedro 2026-05-03: monitorar quem usa áudio, retenção, conversão pra pago.
 *
 * Fontes de dado:
 *   - profiles.audio_uses_count: total lifetime (incrementado por
 *     increment_audio_usage no webhook do WhatsApp)
 *   - funnel_events: eventos audio_used / first_audio / audio_limit_hit
 *     (instrumentação adicionada 2026-05-03 — antes disso não há histórico)
 *
 * Por isso "voltaram em outro dia" só conta a partir de 2026-05-03.
 */
import { createClient as createAdminClient } from '@supabase/supabase-js'

function getAdmin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export default async function AudioEngagementAdminSection() {
  const admin = getAdmin()

  const [profilesRes, audioEventsRes] = await Promise.all([
    admin
      .from('profiles')
      .select('id, tier, created_at, last_active, audio_uses_count, excluded_from_campaign'),
    admin
      .from('funnel_events')
      .select('user_id, event_name, created_at')
      .in('event_name', ['audio_used', 'audio_limit_hit']),
  ])

  type Profile = {
    id: string
    tier: string | null
    created_at: string | null
    last_active: string | null
    audio_uses_count: number | null
    excluded_from_campaign: boolean | null
  }
  type Evt = { user_id: string; event_name: string; created_at: string }

  const profiles = ((profilesRes.data || []) as Profile[]).filter((p) => !p.excluded_from_campaign)
  const events = (audioEventsRes.data || []) as Evt[]

  // Granularidade temporal vem de funnel_events.audio_used (a partir do
  // dia que instrumentamos). Pra "totais lifetime" usamos audio_uses_count.
  const audioByUser = new Map<string, { evtCount: number; distinctDays: Set<string> }>()
  events.forEach((e) => {
    if (e.event_name !== 'audio_used') return
    const entry = audioByUser.get(e.user_id) || { evtCount: 0, distinctDays: new Set<string>() }
    entry.evtCount += 1
    entry.distinctDays.add((e.created_at || '').slice(0, 10))
    audioByUser.set(e.user_id, entry)
  })

  const limitHits = events.filter((e) => e.event_name === 'audio_limit_hit').length

  // Coorte: quem JÁ USOU áudio (lifetime) — usa audio_uses_count
  const audioUsers = profiles.filter((p) => (p.audio_uses_count ?? 0) > 0)
  const nonAudioUsers = profiles.filter((p) => (p.audio_uses_count ?? 0) === 0)

  const now = Date.now()
  const HOUR = 3600 * 1000
  const DAY = 24 * HOUR

  function activePct(group: Profile[], windowMs: number) {
    if (group.length === 0) return 0
    const active = group.filter(
      (p) => p.last_active && new Date(p.last_active).getTime() >= now - windowMs,
    ).length
    return (active / group.length) * 100
  }

  function paidPct(group: Profile[]) {
    if (group.length === 0) return 0
    const paid = group.filter((p) => p.tier && p.tier !== 'free').length
    return (paid / group.length) * 100
  }

  // Distribuição lifetime (audio_uses_count): 1, 2-4, 5-9, 10+
  const dist = { one: 0, two_to_four: 0, five_to_nine: 0, ten_plus: 0 }
  audioUsers.forEach((p) => {
    const c = p.audio_uses_count ?? 0
    if (c === 1) dist.one++
    else if (c <= 4) dist.two_to_four++
    else if (c <= 9) dist.five_to_nine++
    else dist.ten_plus++
  })

  // Multi-day só conta a partir de quando instrumentamos (post-funnel-event).
  const multiDayAudio = Array.from(audioByUser.values()).filter((v) => v.distinctDays.size >= 2).length
  const multiDayPct = audioByUser.size > 0 ? (multiDayAudio / audioByUser.size) * 100 : 0

  // Funil: signups → testaram áudio → voltaram → pagaram
  const totalSignups = profiles.length
  const testedAudio = audioUsers.length
  const returnedToAudio = multiDayAudio
  const paidFromAudio = audioUsers.filter((p) => p.tier && p.tier !== 'free').length
  const paidFromNonAudio = nonAudioUsers.filter((p) => p.tier && p.tier !== 'free').length

  return (
    <div>
      <h2 className="text-lg font-semibold mt-8 mb-4" style={{ color: '#0A1628' }}>
        🎤 Engajamento do Áudio
      </h2>

      {/* Headline metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <AdminStat
          label="Testaram o áudio"
          value={`${testedAudio}/${totalSignups}`}
          sub={`${pct(testedAudio, totalSignups)}% dos cadastros`}
        />
        <AdminStat
          label="Voltaram em outro dia"
          value={`${returnedToAudio}/${audioByUser.size || 0}`}
          sub={audioByUser.size === 0 ? 'aguardando dados' : `${multiDayPct.toFixed(1)}% dos áudio-users`}
        />
        <AdminStat
          label="Conv. áudio-users → pago"
          value={`${paidPct(audioUsers).toFixed(1)}%`}
          sub={`${paidFromAudio} pagantes de ${audioUsers.length}`}
        />
        <AdminStat
          label="Limite de áudio batido"
          value={limitHits}
          sub="paywall encounters (lifetime)"
        />
      </div>

      {/* Funil */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
        <p className="text-sm font-semibold text-gray-700 mb-3">Funil de descoberta do áudio</p>
        <FunnelBar label="🆕 Cadastros" count={totalSignups} max={totalSignups} color="bg-gray-400" />
        <FunnelBar label="🎤 Testaram o áudio" count={testedAudio} max={totalSignups}
          conv={pct(testedAudio, totalSignups)} color="bg-violet-500" warn={testedAudio / totalSignups < 0.15} />
        <FunnelBar label="🔁 Voltaram em outro dia" count={returnedToAudio} max={totalSignups}
          conv={audioByUser.size > 0 ? pct(returnedToAudio, audioByUser.size) : '—'} color="bg-fuchsia-500" />
        <FunnelBar label="💎 Pagaram (vindos do áudio)" count={paidFromAudio} max={totalSignups}
          conv={pct(paidFromAudio, returnedToAudio)} color="bg-emerald-500" />
      </div>

      {/* Coorte: áudio vs não-áudio */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden mb-4">
        <p className="text-sm font-semibold text-gray-700 px-4 py-3 border-b border-gray-200 bg-gray-50">
          Retenção: áudio-users vs não-áudio-users
        </p>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Coorte</th>
              <th className="px-4 py-2 text-right font-medium text-gray-500">Total</th>
              <th className="px-4 py-2 text-right font-medium text-gray-500">Ativos 24h</th>
              <th className="px-4 py-2 text-right font-medium text-gray-500">Ativos 7d</th>
              <th className="px-4 py-2 text-right font-medium text-gray-500">% Pagantes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            <tr>
              <td className="px-4 py-2 font-medium">🎤 Usou áudio ≥1x</td>
              <td className="px-4 py-2 text-right font-mono">{audioUsers.length}</td>
              <td className="px-4 py-2 text-right">{activePct(audioUsers, DAY).toFixed(1)}%</td>
              <td className="px-4 py-2 text-right">{activePct(audioUsers, 7 * DAY).toFixed(1)}%</td>
              <td className="px-4 py-2 text-right font-bold text-emerald-600">
                {paidPct(audioUsers).toFixed(1)}%
              </td>
            </tr>
            <tr>
              <td className="px-4 py-2 font-medium">🚫 Nunca usou áudio</td>
              <td className="px-4 py-2 text-right font-mono">{nonAudioUsers.length}</td>
              <td className="px-4 py-2 text-right">{activePct(nonAudioUsers, DAY).toFixed(1)}%</td>
              <td className="px-4 py-2 text-right">{activePct(nonAudioUsers, 7 * DAY).toFixed(1)}%</td>
              <td className="px-4 py-2 text-right">{paidPct(nonAudioUsers).toFixed(1)}%</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Distribuição lifetime */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <p className="text-sm font-semibold text-gray-700 mb-3">Distribuição: quantos áudios por usuário (lifetime)</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
          <DistTile label="1 áudio apenas" value={dist.one} total={audioUsers.length} color="text-red-600" />
          <DistTile label="2 a 4 áudios" value={dist.two_to_four} total={audioUsers.length} color="text-amber-600" />
          <DistTile label="5 a 9 áudios" value={dist.five_to_nine} total={audioUsers.length} color="text-emerald-600" />
          <DistTile label="10+ áudios" value={dist.ten_plus} total={audioUsers.length} color="text-emerald-700" />
        </div>
      </div>
    </div>
  )
}

function AdminStat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3">
      <p className="text-2xl font-black text-gray-800">{value}</p>
      <p className="text-[10px] text-gray-500 leading-tight mt-1">{label}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

function FunnelBar({
  label, count, max, conv, color, warn,
}: { label: string; count: number; max: number; conv?: string; color: string; warn?: boolean }) {
  const widthPct = max > 0 ? (count / max) * 100 : 0
  return (
    <div className="mb-2 last:mb-0">
      <div className="flex items-baseline justify-between text-xs mb-0.5">
        <span className="text-gray-700">{label}</span>
        <span className="font-mono">
          <strong>{count}</strong>
          {conv !== undefined && (
            <span className={`ml-2 ${warn ? 'text-red-500' : 'text-gray-400'}`}>
              ({conv}%)
            </span>
          )}
        </span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full transition-all duration-500 ${color}`} style={{ width: `${widthPct}%` }} />
      </div>
    </div>
  )
}

function DistTile({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  return (
    <div className="bg-gray-50 rounded-lg p-3">
      <p className={`text-xl font-black ${color}`}>{value}</p>
      <p className="text-[10px] text-gray-500 mt-0.5">{label}</p>
      <p className="text-[9px] text-gray-400">{pct(value, total)}%</p>
    </div>
  )
}

function pct(part: number, total: number): string {
  if (total === 0) return '0'
  return ((part / total) * 100).toFixed(1)
}
