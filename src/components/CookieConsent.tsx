'use client'

import { useEffect, useState } from 'react'

export default function CookieConsent() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!localStorage.getItem('cookie-consent')) {
      setVisible(true)
    }
  }, [])

  if (!visible) return null

  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:max-w-sm bg-[#0A1628] text-white p-4 rounded-2xl shadow-xl z-50 text-sm animate-in slide-in-from-bottom-4">
      <p className="mb-3 leading-relaxed">
        Usamos apenas cookies essenciais para autenticação e funcionamento do app.
        Ao continuar navegando, você concorda com nossa{' '}
        <a href="/privacidade" className="underline text-[#00C896] hover:text-[#00A67D]">
          Política de Privacidade
        </a>.
      </p>
      <button
        onClick={() => {
          localStorage.setItem('cookie-consent', 'essential')
          setVisible(false)
        }}
        className="bg-[#00C896] text-white font-semibold px-4 py-2 rounded-full text-sm w-full hover:bg-[#00A67D] transition active:scale-[0.98]"
      >
        Entendi
      </button>
    </div>
  )
}
