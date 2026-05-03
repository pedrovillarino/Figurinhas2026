// WhatsApp inline registration: cria auth.users + profiles a partir de
// nome+email coletados conversacionalmente no WhatsApp. Equivalente a
// cadastrar pelo site (Google/email), exceto que o email fica não-verificado
// até o user usar magic link no site ou clicar no Stripe checkout.
//
// Por que cadastrar via Supabase Auth admin (e não só profiles): o resto do
// app depende de `auth.users` pra session/RLS. Pra user logar no site
// depois, manda magic link pro email — Supabase Auth faz tudo.

import { createClient } from '@supabase/supabase-js'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

/**
 * Validate email format with a permissive but reasonable regex.
 * Accepts most real emails; rejects obvious typos like "joaogmail.com".
 */
export function isValidEmail(s: string): boolean {
  if (!s) return false
  const trimmed = s.trim().toLowerCase()
  // Basic structure: x@y.z where each part is non-empty and z has at least 2 chars
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed)
}

/** Strip whitespace, lowercase. Email comparison is case-insensitive. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export type WhatsAppRegistrationResult =
  | { ok: true; user_id: string; status: 'created' }
  | { ok: false; error: 'email_already_registered'; existing_user_id?: string }
  | { ok: false; error: 'phone_already_registered'; existing_user_id?: string }
  | { ok: false; error: 'auth_create_failed'; message: string }
  | { ok: false; error: 'profile_create_failed'; message: string }

/**
 * Create a Supabase auth user + profile from WhatsApp-collected data.
 * - Email goes in unconfirmed (user can claim it later via magic link)
 * - No password (passwordless — magic link is the auth)
 * - Profile gets registration_source='whatsapp' and terms_accepted_at=now
 *
 * Returns detailed error codes so the caller can craft the right user-facing
 * message (e.g. "esse email já está cadastrado, faz login no site").
 */
export async function createUserViaWhatsApp(input: {
  phone: string
  name: string
  email: string
}): Promise<WhatsAppRegistrationResult> {
  const supabase = getAdmin()
  const email = normalizeEmail(input.email)
  const phone = input.phone.replace(/\D/g, '')

  // Pre-check: phone already in use? (across all phone format variants)
  const { data: byPhone } = await supabase
    .from('profiles')
    .select('id')
    .or(`phone.eq.${phone},phone.eq.+${phone},phone.eq.${phone.replace(/^55/, '')}`)
    .maybeSingle()
  if (byPhone) {
    return { ok: false, error: 'phone_already_registered', existing_user_id: byPhone.id }
  }

  // Pre-check: email already in auth.users?
  const { data: existingUsers } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1 })
  // listUsers doesn't filter by email, so use rpc-friendly approach:
  // try to check via profiles.email column if exists, otherwise rely on createUser to fail.
  const { data: byEmail } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle()
  if (byEmail) {
    return { ok: false, error: 'email_already_registered', existing_user_id: byEmail.id }
  }
  // Suppress unused warning
  void existingUsers

  // Create auth user. Pedro 2026-05-03: caso real do "Junior" (Bug G)
  // mostrou que createUser falhava sem mais informação. Agora:
  //  1. Geramos password aleatória (Supabase Auth na versão dahlia parece
  //     exigir, ou pelo menos é mais robusto). User nunca usa essa senha —
  //     login é via magic link.
  //  2. email_confirm:true pra pular a etapa de email confirmação (user já
  //     se identificou pelo phone do WhatsApp, equivalente a verificação).
  //  3. Log detalhado do erro pra poder diagnosticar próximas falhas.
  const randomPassword = `wa_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`
  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
    password: randomPassword,
    user_metadata: { display_name: input.name, registration_source: 'whatsapp' },
  })

  if (createErr || !created?.user) {
    // Log estruturado pra debug — antes era só "unknown"
    console.error('[whatsapp-register] auth.admin.createUser failed:', {
      email,
      phone,
      name: input.name,
      error_message: createErr?.message,
      error_code: (createErr as { code?: string } | null)?.code,
      error_status: (createErr as { status?: number } | null)?.status,
      full_error: createErr ? JSON.stringify(createErr) : null,
    })
    return {
      ok: false,
      error: 'auth_create_failed',
      message: createErr?.message || 'unknown',
    }
  }

  const userId = created.user.id

  // Create profile linked to auth user
  const { error: profileErr } = await supabase
    .from('profiles')
    .insert({
      id: userId,
      email,
      phone,
      display_name: input.name,
      tier: 'free',
      registration_source: 'whatsapp',
      terms_accepted_at: new Date().toISOString(),
    })

  if (profileErr) {
    // Roll back: delete the auth user we just created (so the inconsistent
    // state doesn't haunt us). Best-effort — if it fails, log and move on.
    await supabase.auth.admin.deleteUser(userId).catch(() => {})
    return {
      ok: false,
      error: 'profile_create_failed',
      message: profileErr.message,
    }
  }

  return { ok: true, user_id: userId, status: 'created' }
}
