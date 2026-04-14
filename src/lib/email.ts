const RESEND_API_KEY = process.env.RESEND_API_KEY
const FROM_EMAIL = process.env.FROM_EMAIL || 'Complete Aí <noreply@completeai.com.br>'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.completeai.com.br'

export async function sendEmail(to: string, subject: string, html: string) {
  if (!RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not configured, skipping email')
    return false
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to,
        subject,
        html,
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error('Resend error:', err)
      return false
    }

    return true
  } catch (err) {
    console.error('Email send error:', err)
    return false
  }
}

export function tradeRequestEmailHtml(
  requesterName: string,
  distance: string,
  totalTrade: number,
  theyHave: number,
  iHave: number,
  approveUrl: string,
  rejectUrl: string,
  appUrl: string
): string {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <h1 style="color: #0A1628; font-size: 20px; margin: 0;">🔔 Solicitação de Troca</h1>
      </div>
      <div style="background: #f8fafc; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
        <p style="color: #374151; font-size: 15px; margin: 0 0 8px;">
          <strong>${requesterName}</strong> (a ${distance} de você) quer trocar figurinhas!
        </p>
        <div style="display: flex; gap: 8px; margin: 16px 0;">
          <div style="flex: 1; background: #ecfdf5; border-radius: 8px; padding: 12px; text-align: center;">
            <div style="font-size: 20px; font-weight: bold; color: #059669;">${theyHave}</div>
            <div style="font-size: 11px; color: #059669;">tem pra você</div>
          </div>
          <div style="flex: 1; background: #eff6ff; border-radius: 8px; padding: 12px; text-align: center;">
            <div style="font-size: 20px; font-weight: bold; color: #2563eb;">${iHave}</div>
            <div style="font-size: 11px; color: #2563eb;">quer de você</div>
          </div>
          <div style="flex: 1; background: #E6FAF4; border-radius: 8px; padding: 12px; text-align: center;">
            <div style="font-size: 20px; font-weight: bold; color: #00A67D;">${totalTrade}</div>
            <div style="font-size: 11px; color: #00A67D;">total</div>
          </div>
        </div>
      </div>
      <div style="text-align: center;">
        <a href="${approveUrl}" style="display: inline-block; background: #10B981; color: white; padding: 12px 32px; border-radius: 10px; font-weight: bold; font-size: 14px; text-decoration: none; margin-right: 8px;">
          ✅ Aceitar troca
        </a>
        <a href="${rejectUrl}" style="display: inline-block; background: #f3f4f6; color: #6b7280; padding: 12px 24px; border-radius: 10px; font-weight: 600; font-size: 14px; text-decoration: none;">
          Recusar
        </a>
      </div>
      <p style="text-align: center; margin-top: 20px;">
        <a href="${appUrl}/trades" style="color: #00C896; font-size: 13px; text-decoration: underline;">
          Abrir no app
        </a>
      </p>
      <p style="text-align: center; color: #9ca3af; font-size: 11px; margin-top: 24px;">
        Complete Aí — Álbum da Copa 2026
      </p>
    </div>
  `
}

export function tradeApprovedEmailHtml(
  otherName: string,
  contact: string,
  totalTrade: number,
  appUrl: string
): string {
  const isWhatsApp = contact.startsWith('wa.me/')
  const contactUrl = isWhatsApp ? `https://${contact}` : `mailto:${contact}`
  const contactLabel = isWhatsApp ? 'Abrir WhatsApp' : 'Enviar email'

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <h1 style="color: #0A1628; font-size: 20px; margin: 0;">🎉 Troca Aprovada!</h1>
      </div>
      <div style="background: #ecfdf5; border-radius: 12px; padding: 20px; margin-bottom: 20px; text-align: center;">
        <p style="color: #059669; font-size: 15px; margin: 0 0 4px;">
          <strong>${otherName}</strong> aceitou sua troca!
        </p>
        <p style="color: #6b7280; font-size: 13px; margin: 0;">
          Potencial: ${totalTrade} figurinhas
        </p>
      </div>
      <div style="text-align: center;">
        <a href="${contactUrl}" style="display: inline-block; background: #00C896; color: white; padding: 14px 40px; border-radius: 10px; font-weight: bold; font-size: 15px; text-decoration: none;">
          📱 ${contactLabel}
        </a>
      </div>
      <p style="text-align: center; margin-top: 20px;">
        <a href="${appUrl}/trades" style="color: #00C896; font-size: 13px; text-decoration: underline;">
          Abrir no app
        </a>
      </p>
      <p style="text-align: center; color: #9ca3af; font-size: 11px; margin-top: 24px;">
        Complete Aí — Álbum da Copa 2026
      </p>
    </div>
  `
}

export function matchAlertEmailHtml(
  senderName: string,
  distance: string,
  stickerCount: number,
  stickerList: string,
  hasPriority: boolean
): string {
  const priorityBadge = hasPriority
    ? `<div style="background: #FEF3C7; border-radius: 8px; padding: 8px 12px; margin-bottom: 12px; text-align: center;">
         <span style="color: #92400E; font-size: 13px; font-weight: 600;">⭐ Inclui figurinhas prioritárias!</span>
       </div>`
    : ''

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <h1 style="color: #0A1628; font-size: 20px; margin: 0;">🔔 Alerta de figurinhas!</h1>
      </div>
      <div style="background: #f8fafc; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
        <p style="color: #374151; font-size: 15px; margin: 0 0 12px;">
          <strong>${senderName}</strong> (a ${distance} de você) tem <strong>${stickerCount} figurinha${stickerCount > 1 ? 's' : ''}</strong> que você precisa!
        </p>
        ${priorityBadge}
        <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; margin-top: 8px;">
          <p style="color: #6b7280; font-size: 11px; margin: 0 0 4px; font-weight: 600;">Figurinhas disponíveis:</p>
          <p style="color: #374151; font-size: 13px; margin: 0; line-height: 1.6;">${stickerList}</p>
        </div>
      </div>
      <div style="text-align: center;">
        <a href="${APP_URL}/trades" style="display: inline-block; background: #00C896; color: white; padding: 14px 40px; border-radius: 10px; font-weight: bold; font-size: 15px; text-decoration: none;">
          🔄 Solicitar troca
        </a>
      </div>
      <p style="text-align: center; color: #9ca3af; font-size: 11px; margin-top: 24px;">
        Complete Aí — Álbum da Copa 2026
      </p>
    </div>
  `
}

export function tradeRejectedEmailHtml(
  targetName: string
): string {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <h1 style="color: #0A1628; font-size: 20px; margin: 0;">😕 Troca recusada</h1>
      </div>
      <div style="background: #f8fafc; border-radius: 12px; padding: 20px; margin-bottom: 20px; text-align: center;">
        <p style="color: #374151; font-size: 15px; margin: 0;">
          <strong>${targetName}</strong> preferiu não trocar dessa vez.
        </p>
        <p style="color: #6b7280; font-size: 13px; margin: 8px 0 0;">
          Não desanime! Tente outros colecionadores.
        </p>
      </div>
      <div style="text-align: center;">
        <a href="${APP_URL}/trades" style="display: inline-block; background: #00C896; color: white; padding: 14px 40px; border-radius: 10px; font-weight: bold; font-size: 15px; text-decoration: none;">
          🔄 Ver mais trocas
        </a>
      </div>
      <p style="text-align: center; color: #9ca3af; font-size: 11px; margin-top: 24px;">
        Complete Aí — Álbum da Copa 2026
      </p>
    </div>
  `
}
