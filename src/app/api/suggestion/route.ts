import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendText } from '@/lib/zapi'
import { sendEmail } from '@/lib/email'

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }

    const { message } = await req.json()
    if (!message || typeof message !== 'string' || message.trim().length < 3) {
      return NextResponse.json({ error: 'Mensagem muito curta' }, { status: 400 })
    }

    const text = message.trim().slice(0, 1000)

    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name, email, phone')
      .eq('id', user.id)
      .single()

    const name = profile?.display_name || 'Usuário'
    const contact = profile?.email || profile?.phone || user.email || 'sem contato'

    // Send to admin WhatsApp
    const adminPhone = process.env.ADMIN_PHONE
    if (adminPhone) {
      const whatsappMsg =
        `💡 *Sugestão via App*\n` +
        `👤 ${name}\n` +
        `📧 ${contact}\n\n` +
        `"${text}"`
      sendText(adminPhone, whatsappMsg).catch((err) => console.error('[SUGGESTION] WhatsApp forward failed:', err))
    }

    // Send to admin email
    sendEmail(
      'contato@completeai.com.br',
      `Sugestão de ${name}`,
      `<p><strong>${escapeHtml(name)}</strong> (${escapeHtml(contact)}) enviou:</p><blockquote>${escapeHtml(text)}</blockquote>`
    ).catch((err) => console.error('[SUGGESTION] Email forward failed:', err))

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Erro ao enviar' }, { status: 500 })
  }
}
