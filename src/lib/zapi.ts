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
