import { createClient } from '@supabase/supabase-js'

const BODY_LIMIT = 4000

type Direction = 'in' | 'out'

export type WaLogParams = {
  phone: string
  direction: Direction
  messageType?: string | null
  body?: string | null
  messageId?: string | null
  userId?: string | null
  meta?: Record<string, unknown> | null
}

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function logWaMessage(params: WaLogParams): Promise<void> {
  try {
    const supabase = getAdmin()
    const body = params.body == null ? null : params.body.slice(0, BODY_LIMIT)
    await supabase.from('wa_messages').insert({
      phone: params.phone,
      direction: params.direction,
      message_type: params.messageType ?? null,
      body,
      message_id: params.messageId ?? null,
      user_id: params.userId ?? null,
      meta: params.meta ?? null,
    })
  } catch (err) {
    console.error('[wa-log] insert failed:', err instanceof Error ? err.message : err)
  }
}
