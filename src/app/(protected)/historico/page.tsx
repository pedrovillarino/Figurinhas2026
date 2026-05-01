import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Histórico',
  description: 'Veja quais figurinhas você registrou recentemente, com horário.',
}

type HistoryRow = {
  sticker_id: number
  status: string
  quantity: number
  updated_at: string
  sticker: { number: string; player_name: string | null; country: string | null }
}

const HISTORY_LIMIT = 50

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diffMs / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const hrs = Math.floor(min / 60)
  if (hrs < 24) return `há ${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `há ${days}d`
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

function bucketLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const isSameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  if (isSameDay) return 'Hoje'
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate()
  if (isYesterday) return 'Ontem'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
}

export default async function HistoricoPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data, error } = await supabase
    .from('user_stickers')
    .select('sticker_id, status, quantity, updated_at, sticker:stickers!inner(number, player_name, country)')
    .eq('user_id', user.id)
    .gt('quantity', 0)
    .order('updated_at', { ascending: false })
    .limit(HISTORY_LIMIT)

  const rows = ((data || []) as unknown as HistoryRow[])

  // Group by day for visual sectioning
  const groups = new Map<string, HistoryRow[]>()
  for (const r of rows) {
    const key = bucketLabel(r.updated_at)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(r)
  }

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-5 max-w-2xl mx-auto pb-24">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-black text-navy">📜 Histórico</h1>
          <p className="text-[11px] text-gray-500 mt-0.5">Últimas {HISTORY_LIMIT} figurinhas que entraram no seu álbum.</p>
        </div>
        <Link
          href="/album"
          className="text-xs font-semibold text-brand hover:text-brand-dark transition"
        >
          Voltar
        </Link>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700 mb-3">
          Não consegui carregar o histórico agora. Tenta de novo em alguns segundos.
        </div>
      )}

      {!error && rows.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <p className="text-3xl mb-2">📭</p>
          <p className="text-sm text-gray-700 font-semibold mb-1">Sem histórico ainda</p>
          <p className="text-xs text-gray-500 mb-4">Suas próximas figurinhas registradas vão aparecer aqui.</p>
          <Link
            href="/scan"
            className="inline-block bg-brand hover:bg-brand-dark text-white text-xs font-bold px-4 py-2 rounded-full transition"
          >
            📸 Escanear primeira figurinha
          </Link>
        </div>
      )}

      {!error && rows.length > 0 && (
        <div className="space-y-5">
          {Array.from(groups.entries()).map(([dayLabel, dayRows]) => (
            <section key={dayLabel}>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 px-1">{dayLabel}</p>
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden divide-y divide-gray-100">
                {dayRows.map((r) => {
                  const label = `${r.sticker.number} ${r.sticker.player_name || ''}`.trim()
                  const qty = r.quantity > 1 ? ` (x${r.quantity})` : ''
                  const isDup = r.status === 'duplicate'
                  return (
                    <div key={r.sticker_id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                      <span className="text-base">{isDup ? '🔁' : '🆕'}</span>
                      <span className="flex-1 text-gray-800 truncate">
                        <span className="font-semibold text-navy">{r.sticker.number}</span>
                        <span className="text-gray-500"> — {r.sticker.player_name || '—'}{qty}</span>
                      </span>
                      <span className="text-[10px] text-gray-400 font-mono shrink-0 tabular-nums">
                        {formatRelative(r.updated_at)}
                      </span>
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <div className="mt-6 text-center">
        <p className="text-[10px] text-gray-400 leading-relaxed">
          Faltou alguma que você mandou? Pode acontecer de o scan pular um cromo silenciosamente.<br />
          Tenta foto isolada da figurinha ou registra pelo código (ex: PAR-3) no <Link href="/scan" className="underline">scan</Link>.
        </p>
      </div>
    </main>
  )
}
