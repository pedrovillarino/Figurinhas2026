const INSTANCE_ID = process.env.ZAPI_INSTANCE_ID!
const TOKEN = process.env.ZAPI_TOKEN!
const BASE_URL = `https://api.z-api.io/instances/${INSTANCE_ID}/token/${TOKEN}`

export async function sendText(phone: string, message: string) {
  const res = await fetch(`${BASE_URL}/send-text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
