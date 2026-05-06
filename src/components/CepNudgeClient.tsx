'use client'

// Pedro 2026-05-06: wrapper client-side do CepNudge pra usar dentro de
// client components (ex: ScanHub estado 'success'). Faz fetch da decisão
// via /api/profile/cep-nudge-data e renderiza o nudge se aplicável.

import { useEffect, useState } from 'react'
import CepNudge from './CepNudge'

export default function CepNudgeClient() {
  const [data, setData] = useState<{ show: boolean; stickersOwned: number } | null>(null)

  useEffect(() => {
    let active = true
    fetch('/api/profile/cep-nudge-data')
      .then((r) => r.json())
      .then((d) => {
        if (active) setData(d)
      })
      .catch(() => {
        if (active) setData({ show: false, stickersOwned: 0 })
      })
    return () => {
      active = false
    }
  }, [])

  if (!data || !data.show) return null
  return <CepNudge show={data.show} stickersOwned={data.stickersOwned} />
}
