/**
 * Normaliza telefones BR pro formato canônico de 13 dígitos: 55+DDD+9+8.
 *
 * Espelha 1:1 a função SQL `public.normalize_phone_br()` aplicada via
 * trigger BEFORE INSERT/UPDATE em `profiles.phone`. O trigger é a defesa
 * final; esta função existe pra:
 *   1. Validar no client antes de submit (UX: feedback imediato)
 *   2. Usar nos endpoints que gravam phone, alinhando com o que o DB faria
 *   3. Comparar phones em memória sem ida ao banco
 *
 * Ver memory/feedback_phone_matching_old_format.md (caso Lorenzo, 2026-05-03).
 */
export function normalizePhoneBR(input: string | null | undefined): string | null {
  if (input == null) return null
  const trimmed = input.trimStart()
  const digits = String(input).replace(/\D/g, '')
  if (digits.length === 0) return null

  // Phone explicitamente internacional ('+' no início) e DDI != 55:
  // respeita, não força DDI 55.
  const isExplicitIntl = trimmed.startsWith('+') && digits.slice(0, 2) !== '55'
  if (isExplicitIntl) return digits

  // 10 dígitos: DDD + 8 antigo (sem DDI, sem 9 inicial)
  if (digits.length === 10) {
    return '55' + digits.slice(0, 2) + '9' + digits.slice(2)
  }

  // 11 dígitos: DDD + 9 + 8 (sem DDI). Não tem ambiguidade vs 12 sem 9.
  if (digits.length === 11) {
    return '55' + digits
  }

  // 12 dígitos começando com 55: DDI + DDD + 8 antigo (precisa injetar 9)
  if (digits.length === 12 && digits.startsWith('55')) {
    return '55' + digits.slice(2, 4) + '9' + digits.slice(4)
  }

  // 13 dígitos começando com 55: canônico
  if (digits.length === 13 && digits.startsWith('55')) {
    return digits
  }

  // Fora dos padrões: limpa máscara mas não corrompe (mantém só dígitos).
  return digits
}

/**
 * `true` se o phone é um BR canônico (13 dig, 55+DDD+9+...). Útil pra UI:
 * "número válido?".
 */
export function isCanonicalPhoneBR(phone: string | null | undefined): boolean {
  if (!phone) return false
  return /^55\d{2}9\d{8}$/.test(phone)
}
