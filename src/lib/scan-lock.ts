/**
 * Pedro 2026-05-10 (caso Anabelle 5541988337264 e screenshot original
 * "7 fotos juntas"): lock atômico por usuário pra evitar race condition
 * quando user manda várias fotos numa rajada (< 1s entre elas).
 *
 * PROBLEMA antes desse fix:
 * - Webhook usa countPendingScanItems pra detectar "tem registro pendente"
 *   e bloqueia novas fotos.
 * - Mas isso lê pending_scans, que só é INSERIDO quando o scan async
 *   termina (Gemini → DB, ~10-30s).
 * - Se foto 2 chega ANTES do scan da foto 1 terminar, countPending=0
 *   → bot dispara scan paralelo. 7 fotos → 7 scans simultâneos →
 *   7 listas separadas → spam.
 *
 * SOLUÇÃO:
 * - profiles.scan_in_progress_at timestamptz preenchido no webhook
 *   ANTES do scan async ser disparado.
 * - Liberado no scan/route.ts (finally — cobre sucesso + erro + timeout).
 * - Função RPC try_acquire_scan_lock é atômica (UPDATE com WHERE
 *   IS NULL OR < NOW() - 5min, RETURNS row_count > 0).
 * - Timeout 5min é safety net pra caso scan trave (ex: Gemini hang).
 *
 * COMBINAÇÃO com countPendingScanItems:
 * - countPendingScanItems > 0 → "Você tem registro aguardando confirmação"
 *   (já existia)
 * - lock ativo + countPendingScanItems == 0 → "Recebi, mas estamos
 *   processando a anterior — manda de novo após confirmar" (novo)
 */
import { createClient } from '@supabase/supabase-js'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

/**
 * Tenta adquirir o lock de scan pra esse user. Retorna true se conseguiu
 * (foto pode prosseguir), false se outro scan já está rodando.
 *
 * Em caso de erro de DB, retorna true (não bloqueia o user — preferimos
 * permitir scan duplicado a travar o app).
 */
export async function tryAcquireScanLock(
  userId: string,
  timeoutMinutes = 5,
): Promise<boolean> {
  try {
    const sb = getAdmin()
    const { data, error } = await sb.rpc('try_acquire_scan_lock', {
      p_user_id: userId,
      p_timeout_minutes: timeoutMinutes,
    })
    if (error) {
      console.error('[scan-lock] acquire failed:', error.message)
      return true // fail-open — não bloqueia user
    }
    return data === true
  } catch (err) {
    console.error('[scan-lock] acquire threw:', err)
    return true
  }
}

/**
 * Libera o lock de scan. Idempotente — chamar múltiplas vezes é safe.
 */
export async function releaseScanLock(userId: string): Promise<void> {
  try {
    const sb = getAdmin()
    const { error } = await sb.rpc('release_scan_lock', { p_user_id: userId })
    if (error) {
      console.error('[scan-lock] release failed:', error.message)
    }
  } catch (err) {
    console.error('[scan-lock] release threw:', err)
  }
}
