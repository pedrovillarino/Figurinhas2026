'use client'

import { useEffect, useState } from 'react'

/**
 * Hook que busca um wa_link_token pro user logado e cacheia em memória.
 * Pedro 2026-05-04: usado em deep-links wa.me pra que o bot identifique
 * QUEM clicou no botão e vincule o WhatsApp à conta automaticamente,
 * sem o user precisar passar email manualmente.
 *
 * Retorna null enquanto carrega, depois o token (ou null se falhou).
 */
let cachedToken: string | null = null
let inflightPromise: Promise<string | null> | null = null

async function fetchToken(): Promise<string | null> {
  if (cachedToken) return cachedToken
  if (inflightPromise) return inflightPromise

  inflightPromise = (async () => {
    try {
      const res = await fetch('/api/whatsapp/link-token', { credentials: 'include' })
      if (!res.ok) return null
      const data = (await res.json()) as { token?: string }
      if (data.token) {
        cachedToken = data.token
        return data.token
      }
      return null
    } catch {
      return null
    } finally {
      inflightPromise = null
    }
  })()

  return inflightPromise
}

export function useWaLinkToken(): string | null {
  const [token, setToken] = useState<string | null>(cachedToken)

  useEffect(() => {
    if (token) return
    fetchToken().then((t) => {
      if (t) setToken(t)
    })
  }, [token])

  return token
}

/**
 * Helper: monta deep-link wa.me com a frase pré-definida + token embed
 * (no formato "[link:TOKEN]"). Bot regex extrai e vincula phone ao user.
 *
 * Se token não tiver carregado ainda, devolve URL sem o token (ainda
 * funcional, só perde o auto-link).
 */
export function buildWaDeepLink(phoneNumber: string, message: string, token: string | null): string {
  const text = token ? `${message} [link:${token}]` : message
  return `https://wa.me/${phoneNumber}?text=${encodeURIComponent(text)}`
}
