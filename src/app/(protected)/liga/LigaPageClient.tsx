'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { Cardapio } from '@/lib/liga'

// Marcos: nomes/descrições que aparecem APENAS após desbloqueio (fog of war).
// Antes de desbloquear, mostramos "???" — só Copa Completa vê o último (4.000).
const NOMES_MARCOS_FREE: Record<number, string> = {
  100: '5 scans foto + 5 scans áudio extras',
  300: 'Cupom 30% off em qualquer plano (válido 3 dias)',
  700: '+5 trocas extras no mês',
  1500: 'Cupom 50% off em qualquer plano (válido 3 dias)',
  3000: '15 dias de Copa Completa GRÁTIS',
}

const NOMES_MARCOS_COPA: Record<number, string> = {
  500: 'Avatar holográfico animado + 1 cupom 20% pra amigo',
  800: '2 cupons 30% pra amigos',
  1000: 'Avatar dourado + selo "Craque" + 1 cupom 40% pra amigo',
  1500: '2 cupons 60% off Copa Completa pra amigos',
  4000: '4 pacotinhos físicos (cap 15 ganhadores)',
}

type Props = {
  optedIn: boolean
  displayName: string | null
  tier: string
  cardapio: Cardapio
  xpTotal: number
  xpPeriodo: number
  temporadaAtual: number | null
  positionPeriodo: number | null
  marcos: readonly number[]
  proximoMarco: number | null
  faltaProximo: number
  unlocks: number[]
  pontosEvento: Record<string, number>
}

export default function LigaPageClient(props: Props) {
  const {
    optedIn,
    cardapio,
    xpTotal,
    xpPeriodo,
    temporadaAtual,
    positionPeriodo,
    marcos,
    proximoMarco,
    faltaProximo,
    unlocks,
  } = props
  const [optingIn, setOptingIn] = useState(false)
  const [optInDone, setOptInDone] = useState(false)
  const nomesMarcos = cardapio === 'copa' ? NOMES_MARCOS_COPA : NOMES_MARCOS_FREE
  const ultimoMarco = marcos[marcos.length - 1]

  async function handleOptIn() {
    setOptingIn(true)
    try {
      const res = await fetch('/api/liga/opt-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.ok) throw new Error('Falha no opt-in')
      setOptInDone(true)
      // Reload pra atualizar dados server-side
      setTimeout(() => {
        window.location.reload()
      }, 1200)
    } catch (err) {
      console.error(err)
      alert('Não conseguimos ativar agora. Tenta de novo em alguns minutos.')
    } finally {
      setOptingIn(false)
    }
  }

  if (!optedIn) {
    return (
      <main className="min-h-screen bg-gray-50 pb-20">
        <div className="max-w-lg mx-auto px-4 py-6">
          <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center">
            <div className="text-5xl mb-3">🏆</div>
            <h1 className="text-2xl font-bold text-navy mb-2">Liga Complete Aí 2026</h1>
            <p className="text-sm text-gray-600 mb-5 leading-relaxed">
              Acumule pontos, desbloqueie conquistas e dispute prêmios físicos a cada
              Temporada de 15 dias. O Campeão Geral leva mini bola Trionda + protetor de álbum.
            </p>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-5 text-left">
              <p className="text-sm font-semibold text-amber-900 mb-2">📌 Como funciona</p>
              <ul className="text-xs text-amber-900 space-y-1 leading-relaxed">
                <li>• Cada ação no app vira XP (scan, troca, indicação, login, etc).</li>
                <li>• Trilha Digital: desbloqueie 5 marcos de recompensa. Você nunca gasta XP.</li>
                <li>• Top 3 do Ranking de cada Temporada (15 dias) leva físico.</li>
                <li>• Maior XP total ao final = Campeão Geral.</li>
              </ul>
            </div>
            <button
              type="button"
              onClick={handleOptIn}
              disabled={optingIn || optInDone}
              className="w-full px-6 py-3 bg-brand text-white font-bold rounded-xl hover:bg-brand-dark active:scale-95 transition disabled:opacity-50"
            >
              {optInDone ? '✅ Ativado!' : optingIn ? 'Ativando...' : '🏆 Participar da Liga'}
            </button>
            <p className="text-[10px] text-gray-400 mt-3 leading-snug">
              Ao participar, você concorda com o regulamento da Liga (disponível em /termos).
            </p>
          </div>
        </div>
      </main>
    )
  }

  // Opted-in: dashboard principal
  const pctPeriodo = temporadaAtual !== null
    ? Math.min(100, Math.round((xpPeriodo / 300) * 100)) // placeholder normalização
    : 0

  return (
    <main className="min-h-screen bg-gray-50 pb-20">
      <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
        {/* Header */}
        <div className="bg-gradient-to-br from-amber-50 to-amber-100 rounded-2xl border border-amber-200 p-5">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-2xl">🏆</span>
            <h1 className="text-lg font-bold text-amber-900">Liga Complete Aí 2026</h1>
          </div>
          <div className="text-3xl font-extrabold text-amber-900 mb-1">⭐ {xpTotal} XP</div>
          {temporadaAtual !== null ? (
            <div className="text-sm text-amber-800">
              <span className="font-semibold">Temporada {temporadaAtual}</span> em curso · {xpPeriodo} pts no período
              {positionPeriodo !== null && (
                <span className="ml-2 text-amber-700">· #{positionPeriodo} no ranking</span>
              )}
            </div>
          ) : (
            <div className="text-sm text-amber-700">Aguardando próxima Temporada</div>
          )}
        </div>

        {/* Trilha Digital — fog of war */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">
            🎁 Sua Trilha Digital — {cardapio === 'copa' ? 'Copa Completa' : 'Grátis/Estreante/Colecionador'}
          </h2>
          <div className="space-y-2">
            {marcos.map((m, idx) => {
              const unlocked = unlocks.includes(m)
              const isNext = !unlocked && m === proximoMarco
              const isLastCopaMarker = cardapio === 'copa' && m === ultimoMarco
              const showName = unlocked || isNext || isLastCopaMarker

              return (
                <div
                  key={m}
                  className={`flex items-start gap-2.5 p-2.5 rounded-lg border ${
                    unlocked
                      ? 'bg-emerald-50 border-emerald-200'
                      : isNext
                        ? 'bg-amber-50 border-amber-300 ring-2 ring-amber-200'
                        : 'bg-gray-50 border-gray-200'
                  }`}
                >
                  <span className="text-lg shrink-0">
                    {unlocked ? '✅' : isNext ? '🎁' : isLastCopaMarker ? '🏆' : '🔒'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-gray-900">
                      {m} XP {isNext && <span className="text-amber-700">— PRÓXIMO</span>}
                      {isLastCopaMarker && !unlocked && (
                        <span className="text-amber-700"> — FINAL</span>
                      )}
                    </div>
                    <div className="text-[11px] text-gray-700 leading-snug">
                      {showName ? nomesMarcos[m] : '???'}
                    </div>
                    {isNext && (
                      <div className="text-[10px] text-amber-700 mt-1 font-semibold">
                        Faltam {faltaProximo} XP
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Ações que mais rendem */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">⚡ Ações que mais rendem</h2>
          <ul className="text-xs text-gray-700 space-y-1.5">
            <li className="flex items-center gap-2">
              <span className="text-emerald-600 font-bold w-12">+340</span>
              <span>Indicar amigo que vire <strong>Copa Completa</strong></span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-emerald-600 font-bold w-12">+50</span>
              <span>Atingir streak de <strong>15 dias</strong> consecutivos</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-emerald-600 font-bold w-12">+30</span>
              <span><strong>Aceitar troca</strong> confirmada (top 3/dia)</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-emerald-600 font-bold w-12">+20</span>
              <span><strong>Completar 1 seleção</strong> (20 cromos do mesmo país)</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-emerald-600 font-bold w-12">+10</span>
              <span><strong>Pedir troca</strong> confirmada (top 3/dia)</span>
            </li>
          </ul>

          <div className="mt-4 flex gap-2">
            <Link
              href="/scan"
              className="flex-1 text-center px-3 py-2 bg-brand text-white text-xs font-bold rounded-lg hover:bg-brand-dark active:scale-95 transition"
            >
              📷 Scanear
            </Link>
            <Link
              href="/trades"
              className="flex-1 text-center px-3 py-2 bg-blue-600 text-white text-xs font-bold rounded-lg hover:bg-blue-700 active:scale-95 transition"
            >
              🤝 Trocar
            </Link>
          </div>
        </div>

        <div className="text-center text-[10px] text-gray-400 leading-snug pb-2">
          Liga Complete Aí 2026 · 15/05 → 16/07 · regulamento em /termos
        </div>
      </div>
    </main>
  )
}
