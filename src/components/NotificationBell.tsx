'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

type NotifyChannel = 'whatsapp' | 'email' | 'both' | 'none'

export default function NotificationBell() {
  const [channel, setChannel] = useState<NotifyChannel | null>(null)
  const [showPopover, setShowPopover] = useState(false)
  const [saving, setSaving] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)
  const supabase = createClient()

  const isEnabled = channel !== null && channel !== 'none'

  useEffect(() => {
    async function loadPrefs() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase
        .from('profiles')
        .select('notify_channel')
        .eq('id', user.id)
        .single()
      if (data?.notify_channel) {
        setChannel(data.notify_channel as NotifyChannel)
      } else {
        setChannel('none')
      }
    }
    loadPrefs()
  }, [])

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowPopover(false)
      }
    }
    if (showPopover) {
      document.addEventListener('mousedown', handleClick)
      return () => document.removeEventListener('mousedown', handleClick)
    }
  }, [showPopover])

  async function quickToggle(newChannel: NotifyChannel) {
    setSaving(true)
    setChannel(newChannel)
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      await supabase
        .from('profiles')
        .update({ notify_channel: newChannel })
        .eq('id', user.id)
    }
    // Also save to localStorage for TradesHub consistency
    localStorage.setItem('completeai_notify_channel', newChannel)
    setSaving(false)
  }

  return (
    <div className="relative" ref={popoverRef}>
      <button
        onClick={() => setShowPopover(!showPopover)}
        aria-label={isEnabled ? 'Notificações ativas' : 'Ativar notificações'}
        className="relative w-9 h-9 rounded-xl flex items-center justify-center transition hover:bg-gray-100 active:scale-95"
      >
        <svg className={`w-5 h-5 ${isEnabled ? 'text-brand' : 'text-gray-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
        </svg>
        {isEnabled && (
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-brand ring-2 ring-white" />
        )}
      </button>

      {showPopover && (
        <div className="absolute right-0 top-full mt-2 w-64 bg-white rounded-2xl border border-gray-100 shadow-xl p-4 z-50 animate-fade-up">
          <p className="text-xs font-bold text-gray-800 mb-1">Alertas de Trocas</p>
          <p className="text-[10px] text-gray-500 mb-3 leading-relaxed">
            Receba alertas quando alguém perto tiver figurinhas que você precisa.
          </p>

          {/* Quick channel toggle */}
          <div className="grid grid-cols-2 gap-1.5 mb-3">
            {([
              { key: 'whatsapp' as NotifyChannel, label: 'WhatsApp', icon: '💬' },
              { key: 'email' as NotifyChannel, label: 'E-mail', icon: '📧' },
              { key: 'both' as NotifyChannel, label: 'Ambos', icon: '📲' },
              { key: 'none' as NotifyChannel, label: 'Desligado', icon: '🔕' },
            ]).map((opt) => (
              <button
                key={opt.key}
                onClick={() => quickToggle(opt.key)}
                disabled={saving}
                className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-[10px] font-semibold transition-all ${
                  channel === opt.key
                    ? 'bg-brand text-white shadow-sm'
                    : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
                }`}
              >
                <span>{opt.icon}</span> {opt.label}
              </button>
            ))}
          </div>

          {/* Link to full config */}
          <Link
            href="/trades#alertas"
            onClick={() => setShowPopover(false)}
            className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg bg-gray-50 hover:bg-gray-100 transition text-[10px] font-medium text-gray-600"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Configurações avançadas
          </Link>
        </div>
      )}
    </div>
  )
}
