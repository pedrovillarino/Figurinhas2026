/**
 * Suporte / escalations — admin section.
 *
 * Pedro 2026-05-03: lista escalações criadas quando o agent não dá conta
 * ou user pediu ajuda explícita. Filtros: pendentes (default) / resolvidas
 * / todas. Cada item tem link wa.me direto pra abrir conversa.
 *
 * Server component puro. Pra "marcar como resolvido" usa form action.
 */
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'

function getAdmin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

type Escalation = {
  id: number
  user_id: string | null
  phone: string
  display_name: string | null
  last_message: string
  reason: string | null
  classified_intent: string | null
  created_at: string
  notified_pedro_at: string | null
  resolved_at: string | null
  resolved_by: string | null
}

async function resolveEscalation(formData: FormData) {
  'use server'
  const id = Number(formData.get('id'))
  if (!Number.isFinite(id) || id <= 0) return
  const supabase = getAdmin()
  await supabase
    .from('support_escalations')
    .update({
      resolved_at: new Date().toISOString(),
      resolved_by: 'admin',
    })
    .eq('id', id)
  revalidatePath('/admin')
}

export default async function SupportAdminSection() {
  const admin = getAdmin()
  const { data: rows } = await admin
    .from('support_escalations')
    .select('*')
    .is('resolved_at', null)
    .order('created_at', { ascending: false })
    .limit(30)
  const pending = (rows || []) as Escalation[]

  const { count: totalUnresolved } = await admin
    .from('support_escalations')
    .select('*', { count: 'exact', head: true })
    .is('resolved_at', null)

  const { count: total24h } = await admin
    .from('support_escalations')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString())

  return (
    <div>
      <h2 className="text-lg font-semibold mt-8 mb-4 flex items-center gap-2" style={{ color: '#0A1628' }}>
        🆘 Suporte (escalations)
        {totalUnresolved !== null && totalUnresolved > 0 && (
          <span className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
            {totalUnresolved}
          </span>
        )}
      </h2>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
        <Stat label="Pendentes" value={totalUnresolved ?? 0} highlight={!!(totalUnresolved && totalUnresolved > 0)} />
        <Stat label="Últimas 24h" value={total24h ?? 0} />
      </div>

      {pending.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-6 text-center">
          <p className="text-sm text-gray-500">Nenhum caso aberto. ✅</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pending.map((e) => (
            <EscalationCard key={e.id} esc={e} />
          ))}
        </div>
      )}
    </div>
  )
}

function EscalationCard({ esc }: { esc: Escalation }) {
  const ageMs = Date.now() - new Date(esc.created_at).getTime()
  const ageMin = Math.round(ageMs / (60 * 1000))
  const ageDisplay =
    ageMin < 60 ? `${ageMin} min atrás` : ageMin < 1440 ? `${Math.round(ageMin / 60)} h atrás` : `${Math.round(ageMin / 1440)} d atrás`

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4">
      <div className="flex flex-col sm:flex-row sm:items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 mb-1">
            <span className="font-bold text-gray-900">
              {esc.display_name || 'Usuário'}
            </span>
            <span className="text-[11px] text-gray-400">{ageDisplay}</span>
          </div>
          <p className="text-xs text-gray-500 font-mono mb-2">{esc.phone}</p>
          <blockquote className="text-sm text-gray-700 bg-gray-50 border-l-2 border-gray-300 pl-3 py-1.5 italic">
            {esc.last_message}
          </blockquote>
          {esc.reason && (
            <p className="text-[11px] text-gray-500 mt-1.5">
              <span className="font-medium">Razão:</span> {esc.reason}
            </p>
          )}
          {esc.notified_pedro_at && (
            <p className="text-[11px] text-emerald-600 mt-1">✓ Pedro notificado</p>
          )}
        </div>
        <div className="flex flex-col gap-2 shrink-0">
          <a
            href={`https://wa.me/${esc.phone}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-center bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition"
          >
            💬 Abrir WhatsApp
          </a>
          <form action={resolveEscalation}>
            <input type="hidden" name="id" value={esc.id} />
            <button
              type="submit"
              className="w-full text-center bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium px-3 py-1.5 rounded-lg transition"
            >
              ✓ Resolvido
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${highlight ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'}`}>
      <p className={`text-2xl font-black ${highlight ? 'text-red-600' : 'text-gray-800'}`}>{value}</p>
      <p className="text-[10px] text-gray-500 mt-1">{label}</p>
    </div>
  )
}
