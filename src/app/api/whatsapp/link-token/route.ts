import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { randomBytes } from 'crypto'

export const dynamic = 'force-dynamic'

/**
 * GET /api/whatsapp/link-token
 *
 * Gera um token efêmero pro user logado, pra ser embed em deep-links
 * wa.me (ex: "?text=...%20[link:abc123]"). Quando o user mandar essa
 * mensagem pelo WhatsApp, o webhook lê o token, identifica o user_id
 * e vincula o phone à conta.
 *
 * Response: { token: 'xxx' }  (8 chars hex, válido por 24h)
 *
 * Idempotência: se o user já tem token válido (não expirado, não usado),
 * retorna o mesmo. Senão cria novo.
 *
 * Pedro 2026-05-04: criado pra fechar o gap "user logado no site clica
 * Registrar por áudio mas bot não acha o cadastro pelo phone" (caso Enzo).
 */
export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  // Reuse: token vivo do mesmo user
  const { data: existing } = await admin
    .from('wa_link_tokens')
    .select('token, expires_at')
    .eq('user_id', user.id)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing?.token) {
    return NextResponse.json({ token: existing.token })
  }

  // Gera novo: 8 bytes (16 hex chars) → curto o suficiente pra caber na URL
  const token = randomBytes(8).toString('hex')
  const { error } = await admin.from('wa_link_tokens').insert({
    token,
    user_id: user.id,
  })
  if (error) {
    console.error('[wa-link-token] insert error:', error.message)
    return NextResponse.json({ error: 'token_create_failed' }, { status: 500 })
  }

  return NextResponse.json({ token })
}
