'use client'

import { useEffect, useState } from 'react'

// Contextual push-permission ask, rendered INLINE in the /scan success state.
//
// Replaces the old layout-level PushPermission that asked 10s after every
// page mount. By tying the ask to "you just successfully scanned", the
// permission acceptance rate goes up significantly (people say yes when
// they understand WHY they'd want notifications).
//
// Two phases:
//   1. Soft prompt — friendly banner with "Sim, ativar" / "Agora não"
//   2. On "Sim" → call native Notification.requestPermission() (browser dialog)
//   3. If granted → subscribe to push and POST to /api/push-subscribe
//
// Self-hides if:
//   • Browser doesn't support push
//   • Permission already granted (registers silently)
//   • Permission already denied (no point asking again)
//   • User already saw the soft prompt this week (DISMISS_COOLDOWN_DAYS)

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || ''
const DISMISSED_AT_KEY = 'post_scan_push_dismissed_at'
const DISMISS_COOLDOWN_DAYS = 7

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

async function registerPush() {
  try {
    const reg = await navigator.serviceWorker.ready
    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      })
    }
    await fetch('/api/push-subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON() }),
    })
  } catch (err) {
    console.error('Push registration error:', err)
  }
}

export default function PostScanPushAsk() {
  const [show, setShow] = useState(false)
  const [requesting, setRequesting] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!VAPID_PUBLIC_KEY) return
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return

    const perm = Notification.permission
    if (perm === 'denied') return

    if (perm === 'granted') {
      // Already granted — just make sure we're subscribed in the backend
      registerPush()
      return
    }

    // Permission === 'default'. Honor a 7-day cooldown so we don't nag the
    // user who said "agora não" last week.
    const dismissedAt = parseInt(localStorage.getItem(DISMISSED_AT_KEY) || '0', 10)
    if (dismissedAt && Date.now() - dismissedAt < DISMISS_COOLDOWN_DAYS * 24 * 3600 * 1000) {
      return
    }

    setShow(true)
  }, [])

  function dismiss() {
    localStorage.setItem(DISMISSED_AT_KEY, String(Date.now()))
    setShow(false)
  }

  async function accept() {
    setRequesting(true)
    try {
      const perm = await Notification.requestPermission()
      if (perm === 'granted') {
        await registerPush()
      } else {
        // Treated as a soft no — respect the cooldown
        localStorage.setItem(DISMISSED_AT_KEY, String(Date.now()))
      }
    } finally {
      setRequesting(false)
      setShow(false)
    }
  }

  if (!show) return null

  return (
    <div className="my-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 relative">
      <button
        onClick={dismiss}
        aria-label="Fechar"
        className="absolute top-2 right-2 w-6 h-6 rounded-full text-amber-300 hover:text-amber-700 hover:bg-amber-100 flex items-center justify-center transition"
      >
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      <p className="text-xs font-bold text-amber-800 mb-1.5 pr-6">
        🔔 Receber alertas de figurinhas?
      </p>
      <p className="text-[11px] text-amber-700 leading-relaxed mb-3">
        Avisamos quando alguém perto de você tem as figurinhas que você precisa.
      </p>
      <div className="flex gap-2">
        <button
          onClick={accept}
          disabled={requesting}
          className="flex-1 py-2 rounded-xl bg-amber-500 text-white text-xs font-bold hover:bg-amber-600 transition active:scale-95 disabled:opacity-50"
        >
          {requesting ? 'Aguardando…' : 'Sim, ativar'}
        </button>
        <button
          onClick={dismiss}
          disabled={requesting}
          className="px-4 py-2 rounded-xl bg-white border border-amber-200 text-amber-700 text-xs font-semibold hover:bg-amber-100 transition disabled:opacity-50"
        >
          Agora não
        </button>
      </div>
    </div>
  )
}
