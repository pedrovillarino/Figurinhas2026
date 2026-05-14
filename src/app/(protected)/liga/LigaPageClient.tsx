'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { Cardapio } from '@/lib/liga'

// Marcos: nomes/descrições que aparecem APENAS após desbloqueio (fog of war).
// Antes de desbloquear, mostramos só o cadeado (sem texto).
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

// Tabela de pontuação — agrupada por seção com linguagem clara.
type PontoRow = { label: string; pontos: string; nota?: string }
type PontoSecao = { titulo: string; emoji: string; rows: PontoRow[] }

const TABELA_PONTUACAO: PontoSecao[] = [
  {
    titulo: 'Cadastro e assinatura',
    emoji: '🎟️',
    rows: [
      { label: 'Criar conta no Complete Aí', pontos: '+10' },
      { label: 'Completar perfil + escanear 1ª figurinha', pontos: '+30' },
      { label: 'Assinar o plano Estreante', pontos: '+100' },
      { label: 'Assinar o plano Colecionador', pontos: '+200' },
      { label: 'Assinar o plano Copa Completa', pontos: '+300' },
      {
        label: 'Bônus por subir de plano',
        pontos: '+100',
        nota: 'Se pular direto pra Copa Completa (de Estreante), o bônus é +200.',
      },
    ],
  },
  {
    titulo: 'Indicar amigos',
    emoji: '🤝',
    rows: [
      { label: 'Amigo se cadastra usando seu link', pontos: '+10' },
      { label: 'Amigo escaneia 5 figurinhas (vira ativo)', pontos: '+30' },
      { label: 'Amigo assina Estreante', pontos: '+100' },
      { label: 'Amigo assina Colecionador', pontos: '+200' },
      { label: 'Amigo assina Copa Completa', pontos: '+300' },
    ],
  },
  {
    titulo: 'Trocar figurinhas',
    emoji: '🔄',
    rows: [
      {
        label: 'Pedir uma troca que foi confirmada',
        pontos: '+10',
        nota: 'Valem as 3 primeiras por dia.',
      },
      {
        label: 'Aceitar uma troca confirmada',
        pontos: '+20',
        nota: 'Valem as 3 primeiras por dia.',
      },
      { label: 'Avaliar uma troca que você fez', pontos: '+5' },
      { label: 'Receber uma avaliação boa (4★ ou 5★)', pontos: '+5' },
    ],
  },
  {
    titulo: 'Usar o app',
    emoji: '📷',
    rows: [
      { label: 'Sua 1ª figurinha escaneada por foto', pontos: '+10', nota: 'Só na 1ª vez.' },
      { label: 'Sua 1ª figurinha escaneada por áudio', pontos: '+10', nota: 'Só na 1ª vez.' },
      {
        label: 'Cada figurinha escaneada (foto ou áudio)',
        pontos: '+1',
        nota: 'Até 30 por dia.',
      },
      {
        label: 'Completar uma seleção (todos os 20 cromos do mesmo país)',
        pontos: '+20',
      },
    ],
  },
  {
    titulo: 'Aparecer todo dia',
    emoji: '🔥',
    rows: [
      { label: 'Abrir o app uma vez no dia', pontos: '+1' },
      {
        label: 'Sequência de 3 dias seguidos abrindo o app',
        pontos: '+5',
        nota: 'Só ganha 1 vez. Se quebrar a sequência, começa do zero.',
      },
      { label: 'Sequência de 7 dias seguidos', pontos: '+20', nota: 'Só ganha 1 vez.' },
      { label: 'Sequência de 15 dias seguidos', pontos: '+50', nota: 'Só ganha 1 vez.' },
    ],
  },
]

type RankRow = { rank: number; firstName: string; points: number; isMe: boolean }

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
  proximosBloqueados: number[]
  unlocks: number[]
  top10Periodo: RankRow[]
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
    proximosBloqueados,
    unlocks,
    top10Periodo,
  } = props
  const [optingIn, setOptingIn] = useState(false)
  const [optInDone, setOptInDone] = useState(false)
  const nomesMarcos = cardapio === 'copa' ? NOMES_MARCOS_COPA : NOMES_MARCOS_FREE
  const ultimoMarcoDesbloqueado = unlocks.length > 0 ? Math.max(...unlocks) : null

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

        {/* Trilha Digital — só último desbloqueado + próximo */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-1">
            🎁 Sua Trilha Digital
          </h2>
          <p className="text-[11px] text-gray-500 mb-3">
            Cardápio {cardapio === 'copa' ? 'Copa Completa' : 'Grátis / Estreante / Colecionador'} ·
            {' '}{unlocks.length}/{marcos.length} conquistados
          </p>

          <div className="space-y-2">
            {/* Último desbloqueado */}
            {ultimoMarcoDesbloqueado !== null && (
              <div className="flex items-start gap-2.5 p-3 rounded-lg border bg-emerald-50 border-emerald-200">
                <span className="text-lg shrink-0">✅</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] font-bold text-emerald-700 uppercase tracking-wide">
                    Última conquista
                  </div>
                  <div className="text-xs font-bold text-gray-900 mt-0.5">
                    {ultimoMarcoDesbloqueado} XP
                  </div>
                  <div className="text-[11px] text-gray-700 leading-snug">
                    {nomesMarcos[ultimoMarcoDesbloqueado]}
                  </div>
                </div>
              </div>
            )}

            {/* Próximo marco */}
            {proximoMarco !== null ? (
              <div className="flex items-start gap-2.5 p-3 rounded-lg border bg-amber-50 border-amber-300 ring-2 ring-amber-200">
                <span className="text-lg shrink-0">🎁</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] font-bold text-amber-800 uppercase tracking-wide">
                    Próxima conquista
                  </div>
                  <div className="text-xs font-bold text-gray-900 mt-0.5">
                    {proximoMarco} XP
                  </div>
                  <div className="text-[11px] text-gray-700 leading-snug">
                    {nomesMarcos[proximoMarco]}
                  </div>
                  <div className="text-[10px] text-amber-800 mt-1 font-semibold">
                    Faltam {faltaProximo} XP
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2.5 p-3 rounded-lg border bg-amber-50 border-amber-300">
                <span className="text-lg shrink-0">🏆</span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-amber-900">
                    Trilha completa!
                  </div>
                  <div className="text-[11px] text-amber-800 leading-snug">
                    Você destravou todos os marcos. Continue acumulando XP pra disputar o Campeão Geral.
                  </div>
                </div>
              </div>
            )}

            {/* Próximos marcos bloqueados — mostra XP, esconde nome */}
            {proximosBloqueados.length > 0 && (
              <div className="pt-1 space-y-1.5">
                {proximosBloqueados.map((m) => (
                  <div
                    key={m}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg border bg-gray-50 border-gray-200"
                  >
                    <span className="text-base shrink-0">🔒</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold text-gray-700">{m} XP</div>
                      <div className="text-[10px] text-gray-400">Surpresa</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Ranking da Temporada — top 10 + sua posição */}
        {temporadaAtual !== null && top10Periodo.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <h2 className="text-sm font-bold text-gray-900 mb-1">
              🏅 Top 10 da Temporada {temporadaAtual}
            </h2>
            <p className="text-[11px] text-gray-500 mb-3">
              Top 3 ao final do período leva prêmio físico (pacotes + porta-figurinha).
            </p>
            <ol className="space-y-1">
              {top10Periodo.map((row) => (
                <li
                  key={row.rank}
                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg ${
                    row.isMe
                      ? 'bg-amber-50 border border-amber-300 ring-1 ring-amber-200'
                      : ''
                  }`}
                >
                  <span
                    className={`text-xs font-bold w-6 text-center tabular-nums ${
                      row.rank === 1
                        ? 'text-amber-600'
                        : row.rank === 2
                          ? 'text-gray-500'
                          : row.rank === 3
                            ? 'text-orange-700'
                            : 'text-gray-400'
                    }`}
                  >
                    {row.rank === 1 ? '🥇' : row.rank === 2 ? '🥈' : row.rank === 3 ? '🥉' : `#${row.rank}`}
                  </span>
                  <span className="flex-1 text-xs text-gray-800 truncate">
                    {row.firstName}
                    {row.isMe && <span className="ml-1 text-amber-700 font-semibold">(você)</span>}
                  </span>
                  <span className="text-xs font-bold text-gray-900 tabular-nums">
                    {row.points} XP
                  </span>
                </li>
              ))}
            </ol>
            {/* Linha extra com sua posição se estiver fora do top 10 */}
            {positionPeriodo !== null && positionPeriodo > 10 && (
              <div className="mt-2 pt-2 border-t border-dashed border-gray-200">
                <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-amber-50 border border-amber-300">
                  <span className="text-xs font-bold w-6 text-center text-gray-600 tabular-nums">
                    #{positionPeriodo}
                  </span>
                  <span className="flex-1 text-xs text-gray-800">
                    Você <span className="text-amber-700">— sua posição atual</span>
                  </span>
                  <span className="text-xs font-bold text-gray-900 tabular-nums">
                    {xpPeriodo} XP
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tabela de pontuação — por seção */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-1">⭐ Como ganhar XP</h2>
          <p className="text-[11px] text-gray-500 mb-4">
            Toda ação no app vira pontos. Os caps diários evitam farm.
          </p>

          <div className="space-y-5">
            {TABELA_PONTUACAO.map((secao) => (
              <div key={secao.titulo}>
                <div className="flex items-center gap-1.5 mb-2 pb-1.5 border-b border-gray-100">
                  <span className="text-base">{secao.emoji}</span>
                  <h3 className="text-xs font-bold text-gray-900 uppercase tracking-wide">
                    {secao.titulo}
                  </h3>
                </div>
                <ul className="space-y-2">
                  {secao.rows.map((row) => (
                    <li key={row.label} className="flex items-start gap-2.5">
                      <span className="text-emerald-600 font-bold text-xs shrink-0 w-12 text-right tabular-nums pt-0.5">
                        {row.pontos}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-gray-800 leading-snug">{row.label}</div>
                        {row.nota && (
                          <div className="text-[10px] text-gray-500 italic mt-0.5 leading-snug">
                            {row.nota}
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="mt-5 flex gap-2">
            <Link
              href="/scan"
              className="flex-1 text-center px-3 py-2 bg-brand text-white text-xs font-bold rounded-lg hover:bg-brand-dark active:scale-95 transition"
            >
              📷 Escanear
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
