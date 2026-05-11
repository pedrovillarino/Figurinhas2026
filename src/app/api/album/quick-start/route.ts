/**
 * POST /api/album/quick-start
 *
 * Pedro 2026-05-11 (feedback Bruno H.): modo onboarding em 3 passos pra
 * quem já tem >50% do álbum físico colado. Em vez de marcar cromo por
 * cromo, user lista as poucas FALTANTES — sistema marca todo o resto.
 *
 * Ações suportadas (body.action):
 *  - 'start'             → entra no modo (step='missing')
 *  - 'register_missing'  → recebe texto/lista das faltantes, marca tudo
 *                          o resto como owned/1, avança step='extras'
 *  - 'register_duplicates' → recebe texto das repetidas, incrementa qty,
 *                          avança step='done'
 *  - 'advance'           → pula passo atual (missing → extras → duplicates → done)
 *  - 'complete'          → força step='done'
 *  - 'exit'              → desiste do modo (step → NULL)
 *
 * O snapshot pra undo é salvo em profiles.last_reversible_action (TTL 10min)
 * só pro 'register_missing' (única ação destrutiva em larga escala).
 *
 * Auth: cookie de sessão.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import { checkRateLimit, getIp, notifyLimiter } from '@/lib/ratelimit'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

type Action =
  | 'start'
  | 'register_missing'
  | 'register_duplicates'
  | 'advance'
  | 'complete'
  | 'exit'

const VALID_STEPS = ['missing', 'extras', 'duplicates', 'done'] as const
type Step = (typeof VALID_STEPS)[number]

const NEXT_STEP: Record<Step, Step | null> = {
  missing: 'extras',
  extras: 'duplicates',
  duplicates: 'done',
  done: null,
}

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

/** Reaproveita lógica de import-list (parsing tolerante a "Brasil: 1, 5"
 *  e "BRA-1, BRA-2"). Mantida inline pra evitar import cruzado. */
function parseTextList(text: string): string[] {
  const cleaned = text
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/;/g, ',')
    .replace(/\|/g, ',')

  const numbers: string[] = []
  const lines = cleaned.split('\n')
  const countryPrefixRegex = /^([A-Za-zÀ-ú\s]+)[:–\-]\s*(.+)$/

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const countryMatch = trimmed.match(countryPrefixRegex)
    if (countryMatch) {
      const prefix = countryMatch[1].trim()
      const rest = countryMatch[2]
      const codes = rest.split(/[,\s]+/).filter(Boolean)
      for (const code of codes) {
        const c = code.trim().replace(/[()]/g, '')
        if (!c) continue
        if (c.includes('-')) {
          numbers.push(c)
        } else {
          const upperPrefix = prefix.toUpperCase().replace(/\s+/g, '')
          if (upperPrefix.length <= 4) numbers.push(`${upperPrefix}-${c}`)
          else numbers.push(c)
        }
      }
    } else {
      const codes = trimmed.split(/[,\s]+/).filter(Boolean)
      for (const code of codes) {
        const c = code.trim().replace(/[()]/g, '')
        if (c && /[A-Za-z0-9]/.test(c)) numbers.push(c)
      }
    }
  }
  return numbers
}

type AdminClient = ReturnType<typeof getAdmin>

async function resolveStickerIds(
  admin: AdminClient,
  codes: string[],
): Promise<{ ids: number[]; unmatched: string[] }> {
  if (codes.length === 0) return { ids: [], unmatched: [] }
  const normalized = codes.map((c) => c.toUpperCase().trim()).filter(Boolean)
  const { data } = await admin
    .from('stickers')
    .select('id, number')
    .in('number', normalized)
  const found = new Map<string, number>()
  for (const row of (data || []) as Array<{ id: number; number: string }>) {
    found.set(row.number.toUpperCase(), row.id)
  }
  const ids: number[] = []
  const unmatched: string[] = []
  for (const code of normalized) {
    const id = found.get(code)
    if (id != null) ids.push(id)
    else unmatched.push(code)
  }
  return { ids, unmatched }
}

/**
 * GET /api/album/quick-start
 * Retorna o step atual do usuário autenticado. Usado pelo
 * QuickStartModeBarWrapper pra decidir se mostra a faixa amarela.
 * Resposta: { step: 'missing'|'extras'|'duplicates'|'done'|null }
 */
export async function GET() {
  try {
    const supabaseUser = await createServerClient()
    const { data: { user } } = await supabaseUser.auth.getUser()
    if (!user) return NextResponse.json({ step: null })
    const admin = getAdmin()
    // maybeSingle + select isolado: se a coluna ainda não existe
    // (migration 026 pendente), retorna step=null em vez de 500. Isso
    // mantém o site funcionando normalmente até a migration rodar.
    const { data, error } = await admin
      .from('profiles')
      .select('quick_start_step')
      .eq('id', user.id)
      .maybeSingle()
    if (error) return NextResponse.json({ step: null })
    const raw = (data as { quick_start_step?: string | null } | null)?.quick_start_step ?? null
    return NextResponse.json({ step: raw })
  } catch {
    return NextResponse.json({ step: null })
  }
}

export async function POST(req: NextRequest) {
  const rlResponse = await checkRateLimit(getIp(req), notifyLimiter)
  if (rlResponse) return rlResponse

  try {
    const supabaseUser = await createServerClient()
    const { data: { user } } = await supabaseUser.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }

    const body = (await req.json()) as { action?: Action; text?: string }
    const action = body.action
    if (!action) {
      return NextResponse.json({ error: 'action_required' }, { status: 400 })
    }

    const admin = getAdmin()

    // Lê o step atual do usuário
    const { data: profile } = await admin
      .from('profiles')
      .select('quick_start_step')
      .eq('id', user.id)
      .single()
    const currentStep = (profile?.quick_start_step ?? null) as Step | null

    if (action === 'start') {
      await admin.from('profiles').update({ quick_start_step: 'missing' }).eq('id', user.id)
      return NextResponse.json({ ok: true, step: 'missing' })
    }

    if (action === 'exit') {
      await admin.from('profiles').update({ quick_start_step: null }).eq('id', user.id)
      return NextResponse.json({ ok: true, step: null })
    }

    if (action === 'complete') {
      await admin.from('profiles').update({ quick_start_step: 'done' }).eq('id', user.id)
      return NextResponse.json({ ok: true, step: 'done' })
    }

    if (action === 'advance') {
      if (!currentStep) {
        return NextResponse.json({ error: 'not_in_quick_start' }, { status: 400 })
      }
      const next = NEXT_STEP[currentStep]
      await admin.from('profiles').update({ quick_start_step: next }).eq('id', user.id)
      return NextResponse.json({ ok: true, step: next })
    }

    if (action === 'register_missing') {
      if (currentStep !== 'missing') {
        return NextResponse.json({ error: 'wrong_step', currentStep }, { status: 400 })
      }
      const text = (body.text || '').trim()
      // text pode ser vazio — significa "não tenho nada faltando, marca TUDO"
      const codes = text ? parseTextList(text) : []
      const { ids: missingIds, unmatched } = await resolveStickerIds(admin, codes)
      const missingSet = new Set(missingIds)

      // Pega todos os completable
      const { data: completable, error: stickersErr } = await admin
        .from('stickers')
        .select('id, number')
        .eq('counts_for_completion', true)
      if (stickersErr) {
        console.error('[quick-start] stickers query failed:', stickersErr.message)
        return NextResponse.json({ error: 'db_query_failed' }, { status: 500 })
      }
      const allCompletable = (completable || []) as Array<{ id: number; number: string }>

      // Cromos que devem ficar como owned/1: TODOS os completable que NÃO
      // estão na lista de faltantes.
      const toOwn = allCompletable.filter((s) => !missingSet.has(s.id))

      // Estado atual pra snapshot do undo
      const { data: currentRows } = await admin
        .from('user_stickers')
        .select('sticker_id, status, quantity')
        .eq('user_id', user.id)
      const currentMap = new Map<number, { status: string; quantity: number }>()
      for (const r of (currentRows || []) as Array<{ sticker_id: number; status: string; quantity: number }>) {
        currentMap.set(r.sticker_id, { status: r.status, quantity: r.quantity })
      }

      // Só toca cromos que ainda não estão owned/duplicate (preserva qty > 1)
      const now = new Date().toISOString()
      const upsertPayload: Array<{ user_id: string; sticker_id: number; status: string; quantity: number; updated_at: string }> = []
      const snapshot: Array<{ sticker_id: number; number: string; status_before: string; quantity_before: number }> = []
      const numberById = new Map(allCompletable.map((s) => [s.id, s.number] as const))

      for (const s of toOwn) {
        const cur = currentMap.get(s.id)
        const isMissing = !cur || cur.status === 'missing'
        if (!isMissing) continue
        upsertPayload.push({
          user_id: user.id,
          sticker_id: s.id,
          status: 'owned',
          quantity: 1,
          updated_at: now,
        })
        snapshot.push({
          sticker_id: s.id,
          number: s.number,
          status_before: cur?.status ?? 'missing',
          quantity_before: cur?.quantity ?? 0,
        })
      }

      // Os cromos da lista de "faltantes" devem ficar marcados como missing,
      // mesmo que antes estivessem owned (caso user tenha começado o fluxo
      // normal antes). Só atualizamos se mudar — não sobrescreve qty > 1.
      const missingPayload: Array<{ user_id: string; sticker_id: number; status: string; quantity: number; updated_at: string }> = []
      for (const id of missingIds) {
        const cur = currentMap.get(id)
        if (cur && cur.quantity > 1) continue // não derruba duplicate
        if (cur && cur.status === 'missing') continue // já está
        missingPayload.push({
          user_id: user.id,
          sticker_id: id,
          status: 'missing',
          quantity: 0,
          updated_at: now,
        })
        snapshot.push({
          sticker_id: id,
          number: numberById.get(id) || '',
          status_before: cur?.status ?? 'missing',
          quantity_before: cur?.quantity ?? 0,
        })
      }

      const allUpserts = [...upsertPayload, ...missingPayload]
      if (allUpserts.length > 0) {
        const { error: upErr } = await admin
          .from('user_stickers')
          .upsert(allUpserts, { onConflict: 'user_id,sticker_id' })
        if (upErr) {
          console.error('[quick-start] upsert failed:', upErr.message)
          return NextResponse.json({ error: 'db_upsert_failed' }, { status: 500 })
        }
      }

      // Snapshot pra undo (somente se houve mudança)
      if (snapshot.length > 0) {
        await admin
          .from('profiles')
          .update({
            last_reversible_action: {
              type: 'quick_start_register_missing',
              executed_at: now,
              stickers: snapshot,
            },
            quick_start_step: 'extras',
          })
          .eq('id', user.id)
      } else {
        await admin.from('profiles').update({ quick_start_step: 'extras' }).eq('id', user.id)
      }

      return NextResponse.json({
        ok: true,
        step: 'extras',
        markedOwned: upsertPayload.length,
        markedMissing: missingPayload.length,
        unmatched,
        totalCompletable: allCompletable.length,
      })
    }

    if (action === 'register_duplicates') {
      if (currentStep !== 'duplicates') {
        return NextResponse.json({ error: 'wrong_step', currentStep }, { status: 400 })
      }
      const text = (body.text || '').trim()
      if (!text) {
        // Sem repetidas — só avança
        await admin.from('profiles').update({ quick_start_step: 'done' }).eq('id', user.id)
        return NextResponse.json({ ok: true, step: 'done', incremented: 0, unmatched: [] })
      }
      const codes = parseTextList(text)
      const { ids: dupeIds, unmatched } = await resolveStickerIds(admin, codes)

      // Conta ocorrências (user pode listar o mesmo código 2x = qty=3)
      const counts = new Map<number, number>()
      for (const id of dupeIds) counts.set(id, (counts.get(id) ?? 0) + 1)

      // Pega estado atual
      const { data: currentRows } = await admin
        .from('user_stickers')
        .select('sticker_id, status, quantity')
        .eq('user_id', user.id)
        .in('sticker_id', Array.from(counts.keys()))
      const curMap = new Map<number, { status: string; quantity: number }>()
      for (const r of (currentRows || []) as Array<{ sticker_id: number; status: string; quantity: number }>) {
        curMap.set(r.sticker_id, { status: r.status, quantity: r.quantity })
      }

      const now = new Date().toISOString()
      const upsertPayload: Array<{ user_id: string; sticker_id: number; status: string; quantity: number; updated_at: string }> = []
      for (const [id, occ] of Array.from(counts.entries())) {
        const cur = curMap.get(id)
        const baseQty = cur && cur.status !== 'missing' ? cur.quantity : 1
        // Se já é owned/1, +1 por ocorrência. Se duplicate/3, +1 por ocorrência. Etc.
        const newQty = baseQty + occ
        const newStatus = newQty >= 2 ? 'duplicate' : 'owned'
        upsertPayload.push({
          user_id: user.id,
          sticker_id: id,
          status: newStatus,
          quantity: newQty,
          updated_at: now,
        })
      }

      if (upsertPayload.length > 0) {
        const { error: upErr } = await admin
          .from('user_stickers')
          .upsert(upsertPayload, { onConflict: 'user_id,sticker_id' })
        if (upErr) {
          console.error('[quick-start] dupe upsert failed:', upErr.message)
          return NextResponse.json({ error: 'db_upsert_failed' }, { status: 500 })
        }
      }

      await admin.from('profiles').update({ quick_start_step: 'done' }).eq('id', user.id)

      return NextResponse.json({
        ok: true,
        step: 'done',
        incremented: upsertPayload.length,
        unmatched,
      })
    }

    return NextResponse.json({ error: 'unknown_action' }, { status: 400 })
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error('[quick-start] error:', errMsg)
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
}
