const INSTANCE_ID = process.env.ZAPI_INSTANCE_ID!
const TOKEN = process.env.ZAPI_TOKEN!
const CLIENT_TOKEN = process.env.ZAPI_CLIENT_TOKEN!
const BASE_URL = `https://api.z-api.io/instances/${INSTANCE_ID}/token/${TOKEN}`

const headers = {
  'Content-Type': 'application/json',
  'Client-Token': CLIENT_TOKEN,
}

export async function sendText(phone: string, message: string) {
  const res = await fetch(`${BASE_URL}/send-text`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ phone, message }),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error('Z-API send error:', err)
  }

  return res.ok
}

export function formatPhone(raw: string): string {
  // Remove everything except digits
  return raw.replace(/\D/g, '')
}

/**
 * Mask a phone for logs: keep DDI + DDD + last 4 digits, redact the middle.
 * "5521997838210" → "552199****8210". Returns "" for empty/short inputs.
 * Use anywhere a phone might end up in Vercel logs / Sentry to align with LGPD.
 */
export function maskPhone(raw: string | null | undefined): string {
  if (!raw) return ''
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 9) return digits.replace(/.(?=.{2})/g, '*')
  return digits.slice(0, 4) + '****' + digits.slice(-4)
}

// ─── Interactive messages (buttons / option list) ─────────────────────────────
//
// WhatsApp interactive messages are documented as unstable across WhatsApp
// updates (Z-API "Button status" page) and we confirmed empirically (2026-04-28)
// that Z-API accepts a send-button-list request and returns a messageId, but
// the WhatsApp client silently drops the message — so the user receives
// nothing. Because we never see an error, our error fallback never fires.
//
// To avoid that silent-drop trap, the helpers below default to PLAIN-TEXT
// numbered lists. The interactive payload path stays implemented but is
// gated behind WHATSAPP_INTERACTIVE_ENABLED=true so we can flip it on later
// without a code change once Z-API/WhatsApp stabilize.
//
// Either way, the message body always contains the same numbered options so
// the user can reply with the number or with the keyword. The bot accepts
// both (see /api/whatsapp/webhook).

export type ButtonOption = { id: string; label: string }
export type ListOption = { id: string; title: string; description?: string }

function interactiveEnabled(): boolean {
  return process.env.WHATSAPP_INTERACTIVE_ENABLED === 'true'
}

function inlineOptionsText(options: { id: string; label?: string; title?: string }[]): string {
  // Render as visible "tap targets" — emoji + bold label. No numbering, since
  // we can't reliably map "1"/"2"/"3" back to the right command without
  // per-user state. The user reads the labels and types the keyword (or any
  // natural variation — Gemini handles typos and slang).
  return options
    .map((o) => {
      const label = o.label ?? o.title ?? o.id
      return `▸ *${label}*`
    })
    .join('\n')
}

function plainTextWithOptions(message: string, options: { id: string; label?: string; title?: string }[]): string {
  if (options.length === 0) return message
  return `${message}\n\n👇 *Próximo passo:*\n${inlineOptionsText(options)}`
}

/**
 * Send a message with up to 3 quick-reply options.
 *
 * Default path: plain numbered text (reliable on every WhatsApp client).
 * Interactive path (env WHATSAPP_INTERACTIVE_ENABLED=true): tries the Z-API
 * interactive payload first, falls back to plain text on any error.
 */
export async function sendButtonList(
  phone: string,
  message: string,
  buttons: ButtonOption[],
): Promise<boolean> {
  if (buttons.length === 0) return sendText(phone, message)
  const limited = buttons.slice(0, 3) // WhatsApp hard limit for buttons
  const enrichedMessage = plainTextWithOptions(message, limited)

  if (!interactiveEnabled()) {
    console.log(`[zapi] sendButtonList: interactive DISABLED (env WHATSAPP_INTERACTIVE_ENABLED=${process.env.WHATSAPP_INTERACTIVE_ENABLED ?? 'unset'}) — falling back to plain text`)
    return sendText(phone, enrichedMessage)
  }

  console.log(`[zapi] sendButtonList: interactive ENABLED — trying Z-API send-button-list with ${limited.length} buttons`)
  try {
    const res = await fetch(`${BASE_URL}/send-button-list`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        phone,
        message: enrichedMessage,
        buttonList: { buttons: limited },
      }),
    })
    const responseText = await res.text()
    if (res.ok) {
      console.log(`[zapi] sendButtonList: Z-API responded ${res.status} — body: ${responseText.substring(0, 300)}`)
      return true
    }
    console.error(`[zapi] sendButtonList: Z-API error ${res.status} — body: ${responseText.substring(0, 500)}`)
  } catch (err) {
    console.error('[zapi] sendButtonList exception:', err instanceof Error ? err.message : err)
  }
  console.log('[zapi] sendButtonList: falling back to plain text')
  return sendText(phone, enrichedMessage)
}

/**
 * Send a message with up to 10 selectable options (interactive list).
 * Same env-gated semantics as sendButtonList.
 */
export async function sendOptionList(
  phone: string,
  message: string,
  buttonLabel: string,
  options: ListOption[],
  listTitle = 'Escolha uma opção',
): Promise<boolean> {
  if (options.length === 0) return sendText(phone, message)
  const limited = options.slice(0, 10)
  const enrichedMessage = plainTextWithOptions(message, limited)

  if (!interactiveEnabled()) {
    return sendText(phone, enrichedMessage)
  }

  try {
    const res = await fetch(`${BASE_URL}/send-option-list`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        phone,
        message: enrichedMessage,
        optionList: {
          title: listTitle,
          buttonLabel,
          options: limited,
        },
      }),
    })
    if (res.ok) return true
    console.error('Z-API send-option-list error:', await res.text())
  } catch (err) {
    console.error('Z-API send-option-list exception:', err)
  }
  return sendText(phone, enrichedMessage)
}

// ─── Connection Health ───

export type ZApiStatus = {
  connected: boolean
  smartphoneConnected: boolean
  session: string
  error?: string
}

/** Check if the Z-API instance is connected to WhatsApp */
export async function getInstanceStatus(): Promise<ZApiStatus> {
  try {
    const res = await fetch(`${BASE_URL}/status`, {
      method: 'GET',
      headers,
    })
    if (!res.ok) {
      return { connected: false, smartphoneConnected: false, session: '', error: `HTTP ${res.status}` }
    }
    const data = await res.json()
    return {
      connected: data.connected === true,
      smartphoneConnected: data.smartphoneConnected !== false,
      session: data.session || '',
      error: data.error || undefined,
    }
  } catch (err) {
    return { connected: false, smartphoneConnected: false, session: '', error: String(err) }
  }
}

/** Restart the Z-API instance (reconnects without needing QR code) */
export async function restartInstance(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/restart`, {
      method: 'GET',
      headers,
    })
    if (!res.ok) {
      console.error('Z-API restart error:', await res.text())
      return false
    }
    const data = await res.json()
    return data.value === true
  } catch (err) {
    console.error('Z-API restart exception:', err)
    return false
  }
}
