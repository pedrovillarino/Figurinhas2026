'use client'

import { useState } from 'react'

type ProfileQRCodeProps = {
  referralCode: string
}

export default function ProfileQRCode({ referralCode }: ProfileQRCodeProps) {
  const [copied, setCopied] = useState(false)

  const url = `https://completeai.com.br/u/${referralCode}`
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(url)}&size=200x200&color=0A1628&bgcolor=FFFFFF`

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea')
      textarea.value = url
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6 flex flex-col items-center">
      <img
        src={qrSrc}
        alt={`QR Code para ${url}`}
        width={200}
        height={200}
        className="rounded-lg"
        loading="lazy"
      />

      <p className="mt-3 text-xs text-gray-500 text-center break-all font-mono">
        {url}
      </p>

      <button
        onClick={handleCopy}
        className={`mt-3 rounded-lg px-4 py-2 text-sm font-semibold transition ${
          copied
            ? 'bg-brand-light text-brand'
            : 'bg-brand text-white hover:bg-brand-dark'
        }`}
      >
        {copied ? 'Copiado!' : 'Copiar link'}
      </button>
    </div>
  )
}
