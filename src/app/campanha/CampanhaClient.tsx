'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { RankingRow, ActiveCoupon } from './page'

type Stats = {
  confirmed: number
  paidUpgrade: number
  pending: number
  totalRewardsGranted: number
  points: number
  pendingCouponCount: number
}

type Constants = {
  couponPercentOff: number
  couponValidityHours: number
  friendsForCoupon: number
  pointsConfirmed: number
  pointsPaidUpgrade: number
  pointsSelfUpgrade: number
  optinLookbackDays: number
  minParticipants: number
  minParticipantsForDisplay: number
}

type Totals = {
  confirmed: number
  paidUpgrades: number
  ambassadors: number
}

export default function CampanhaClient({
  isLoggedIn,
  displayName,
  referralCode,
  stats,
  activeCoupons,
  ranking,
  totals,
  campaignActive,
  campaignEndIso,
  userExcluded,
  optedAt,
  userSelfUpgradedAt,
  participantCount,
  constants,
}: {
  isLoggedIn: boolean
  userId: string | null
  displayName: string | null
  referralCode: string | null
  stats: Stats | null
  activeCoupons: ActiveCoupon[]
  ranking: RankingRow[]
  totals: Totals
  campaignActive: boolean
  campaignEndIso: string
  userExcluded: boolean
  optedAt: string | null
  userSelfUpgradedAt: string | null
  participantCount: number
  constants: Constants
}) {
  const router = useRouter()
  const [optingIn, setOptingIn] = useState(false)
  const [optInError, setOptInError] = useState<string | null>(null)
  const isParticipating = !!optedAt
  const showOptInCard = isLoggedIn && !userExcluded && !isParticipating && campaignActive
  const minParticipantsMet = participantCount >= constants.minParticipants
  // Public ranking + numeric counters only render once we cross the display
  // threshold. Below that, "warming up" placeholders avoid making the page
  // feel deserted in the first hours.
  const canShowPublicNumbers = participantCount >= constants.minParticipantsForDisplay

  async function handleOptIn() {
    setOptingIn(true)
    setOptInError(null)
    try {
      const res = await fetch('/api/campanha/opt-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      const data = await res.json()
      if (!res.ok) {
        setOptInError(data.error || 'Erro ao participar')
        setOptingIn(false)
        return
      }
      // Reload to fetch fresh state (referral code, stats, possible coupon)
      router.refresh()
    } catch {
      setOptInError('Erro de conexão')
      setOptingIn(false)
    }
  }
  const campaignEndDateLabel = new Date(campaignEndIso).toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric',
  })
  const campaignEndTimeLabel = new Date(campaignEndIso).toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit',
  })
  const [copied, setCopied] = useState<'link' | 'text' | null>(null)
  const appUrl =
    typeof window !== 'undefined'
      ? `${window.location.protocol}//${window.location.host}`
      : 'https://www.completeai.com.br'
  const referralUrl = referralCode ? `${appUrl}/register?ref=${referralCode}` : ''

  const shareText = useMemo(() => {
    const firstName = displayName?.split(' ')[0] || 'Eu'
    return (
      `${firstName} te chamou pra completar o álbum da Copa 2026 com Complete Aí! 🎉\n\n` +
      `📸 Escaneia suas figurinhas com IA, mostra repetidas/faltantes, e encontra trocas perto de você.\n\n` +
      `Use meu link e ganhe *+1 troca extra* no cadastro:\n${referralUrl}`
    )
  }, [displayName, referralUrl])

  async function copy(text: string, kind: 'link' | 'text') {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(kind)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      // ignore
    }
  }

  async function nativeShare() {
    if (typeof navigator !== 'undefined' && 'share' in navigator) {
      try {
        await (navigator as Navigator & { share: (data: ShareData) => Promise<void> }).share({
          title: 'Complete Aí',
          text: shareText,
          url: referralUrl,
        })
      } catch {
        // user cancelled
      }
    } else {
      copy(shareText, 'text')
    }
  }

  // Show the actual ranking only once we've crossed the public display
  // threshold (avoids "1 participant ranking" weirdness in the first hours).
  // Logged-in user always sees their OWN row even before the threshold.
  const showRanking = canShowPublicNumbers && ranking.length >= 1

  return (
    <main className="min-h-screen bg-gradient-to-b from-emerald-50 via-white to-amber-50 pb-32">
      {/* ── Hero ── */}
      <section className="px-5 pt-10 pb-8 text-center max-w-2xl mx-auto">
        <span className={`inline-block text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full mb-3 ${
          campaignActive
            ? 'bg-amber-400/20 text-amber-700'
            : 'bg-gray-200 text-gray-600'
        }`}>
          {campaignActive ? '🏆 Campanha de Lançamento' : '🏁 Campanha encerrada'}
        </span>
        <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-navy mb-3">
          Embaixadores Complete Aí
        </h1>
        <p className="text-base text-gray-600 leading-relaxed">
          {campaignActive ? (
            <>Indique amigos, ganhe figurinhas e cupons. <strong>Top 3 da campanha</strong> recebe pacotes Panini e porta-figurinha em casa.</>
          ) : (
            <>A campanha de lançamento foi encerrada em <strong>{campaignEndDateLabel} às {campaignEndTimeLabel}</strong>. Obrigado por participar!</>
          )}
        </p>
      </section>

      {/* ── Active campaign deadline banner ── */}
      {campaignActive && (
        <section className="px-4 max-w-2xl mx-auto mb-6">
          <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-3 flex items-center gap-3">
            <span className="text-2xl">⏰</span>
            <div className="flex-1">
              <p className="text-xs font-bold text-amber-800">
                Campanha vai até {campaignEndDateLabel} às {campaignEndTimeLabel}
              </p>
              <p className="text-[11px] text-amber-700">Após esse prazo, prêmios e cupons param de ser concedidos.</p>
            </div>
          </div>
        </section>
      )}

      {/* ── Excluded user (owner/team) banner ── */}
      {isLoggedIn && userExcluded && (
        <section className="px-4 max-w-2xl mx-auto mb-6">
          <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4 text-center">
            <p className="text-sm font-bold text-gray-700">⚙️ Modo administrador</p>
            <p className="text-xs text-gray-500 mt-1">
              Você é dono/equipe do Complete Aí — não pode participar do ranking nem ganhar prêmios.
              <br />Use o admin para acompanhar a campanha.
            </p>
          </div>
        </section>
      )}

      {/* ── Opt-in card (logged in, NOT excluded, NOT yet opted in) ── */}
      {showOptInCard && (
        <section className="px-4 max-w-2xl mx-auto mb-8">
          <div className="bg-white rounded-2xl border-2 border-brand shadow-lg p-6 text-center">
            <div className="text-5xl mb-3">🎯</div>
            <h2 className="text-xl font-black text-navy mb-2">Pronto pra participar?</h2>
            <p className="text-sm text-gray-600 mb-5 leading-relaxed">
              Clique abaixo pra entrar oficialmente na campanha.
              <br />
              Você vai receber seu link único, aparecer no ranking e poder ganhar cupons + prêmios.
            </p>
            <button
              onClick={handleOptIn}
              disabled={optingIn}
              className="w-full max-w-xs mx-auto bg-brand text-white font-bold py-3.5 rounded-xl hover:bg-brand-dark active:scale-95 transition disabled:opacity-50"
            >
              {optingIn ? 'Entrando…' : '🚀 Começar a participar'}
            </button>
            {optInError && (
              <p className="mt-3 text-xs text-red-500">{optInError}</p>
            )}
            <p className="text-[11px] text-gray-400 mt-3">
              Indicações + upgrade que você fez nos últimos {constants.optinLookbackDays} dias entram retroativamente.
            </p>
          </div>
        </section>
      )}

      {/* ── Member area (logged in, NOT excluded, opted in) ── */}
      {isLoggedIn && !userExcluded && isParticipating && referralCode && stats && (
        <section className="px-4 max-w-2xl mx-auto mb-10">
          <div className="bg-white rounded-2xl border-2 border-brand/20 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-brand font-bold">Sua área</p>
                <h2 className="text-lg font-bold text-navy">Olá, {displayName?.split(' ')[0] || 'Embaixador'} 👋</h2>
              </div>
              {stats.points > 0 && (
                <span className="text-2xl font-black text-brand">{stats.points} pts</span>
              )}
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-3 gap-2 mb-3">
              <StatBox label="Confirmados" value={stats.confirmed} color="text-emerald-600" />
              <StatBox label="Pagantes" value={stats.paidUpgrade} color="text-amber-600" sub="vale 5 pts cada" />
              <StatBox label="Pendentes" value={stats.pending} color="text-gray-500" />
            </div>

            {/* Self-upgrade bonus indicator */}
            {userSelfUpgradedAt && (
              <div className="mb-5 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-xl text-center">
                <p className="text-xs text-emerald-700">
                  💎 <strong>+{constants.pointsSelfUpgrade} pts</strong> por ter assinado um plano pago
                </p>
              </div>
            )}
            {!userSelfUpgradedAt && (
              <div className="mb-5 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl text-center">
                <Link href="/upgrade" className="text-xs text-amber-700 font-medium hover:underline">
                  💡 Assine qualquer plano e ganhe <strong>+{constants.pointsSelfUpgrade} pts</strong> bônus
                </Link>
              </div>
            )}

            {/* Referral link */}
            <div className="mb-4">
              <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1.5 block">
                Seu link de indicação
              </label>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={referralUrl}
                  onFocus={(e) => e.target.select()}
                  className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs text-gray-700 font-mono"
                />
                <button
                  onClick={() => copy(referralUrl, 'link')}
                  className="px-4 py-2.5 bg-gray-900 text-white text-xs font-semibold rounded-xl hover:bg-gray-800 active:scale-95 transition"
                >
                  {copied === 'link' ? '✓ Copiado' : 'Copiar'}
                </button>
              </div>
              <p className="text-[10px] text-gray-400 mt-1.5">Código: <span className="font-mono font-bold">{referralCode}</span></p>
            </div>

            {/* Share buttons */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              <button
                onClick={nativeShare}
                className="flex items-center justify-center gap-2 bg-emerald-500 text-white py-3 rounded-xl text-sm font-bold hover:bg-emerald-600 active:scale-95 transition"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
                  <path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.955 9.955 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18a8 8 0 01-4.243-1.214l-.257-.154-2.87.853.853-2.87-.154-.257A8 8 0 1112 20z" />
                </svg>
                Compartilhar
              </button>
              <button
                onClick={() => copy(shareText, 'text')}
                className="flex items-center justify-center gap-2 bg-gray-100 text-gray-700 py-3 rounded-xl text-sm font-semibold hover:bg-gray-200 active:scale-95 transition"
              >
                {copied === 'text' ? '✓ Texto copiado' : 'Copiar texto pronto'}
              </button>
            </div>

            {/* Active coupons */}
            {activeCoupons.length > 0 && (
              <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                <p className="text-xs font-bold text-amber-800 mb-2">🎫 Seus cupons ativos</p>
                {activeCoupons.map((c) => {
                  const expiry = new Date(c.valid_until)
                  const hoursLeft = Math.max(0, Math.round((expiry.getTime() - Date.now()) / 3600000))
                  return (
                    <div key={c.code} className="flex items-center justify-between bg-white rounded-lg p-2.5 mb-1.5 last:mb-0">
                      <div>
                        <p className="font-mono font-bold text-amber-700">{c.code}</p>
                        <p className="text-[10px] text-gray-500">{c.percent_off}% off · expira em {hoursLeft}h</p>
                      </div>
                      <Link
                        href="/upgrade"
                        className="text-xs font-semibold text-amber-700 hover:underline"
                      >
                        Usar →
                      </Link>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── CTA pra não-logado ── */}
      {!isLoggedIn && (
        <section className="px-4 max-w-2xl mx-auto mb-10">
          <div className="bg-white rounded-2xl border-2 border-brand/20 shadow-sm p-6 text-center">
            <p className="text-base font-bold text-navy mb-2">Quer participar?</p>
            <p className="text-sm text-gray-600 mb-4">
              Crie sua conta grátis pra ganhar seu link de indicação.
            </p>
            <Link
              href="/register"
              className="inline-block bg-brand text-white font-bold px-8 py-3 rounded-xl hover:bg-brand-dark transition active:scale-95"
            >
              Cadastrar e participar
            </Link>
          </div>
        </section>
      )}

      {/* ── Como funciona (regras claras) ── */}
      <section className="px-4 max-w-2xl mx-auto mb-10">
        <h2 className="text-xl font-black text-navy mb-4">📖 Como funciona</h2>

        <ol className="space-y-3">
          <RuleStep number={1} title='Clique em "Começar a participar"'>
            Pra entrar no ranking e ganhar cupons, você precisa fazer opt-in clicando no botão acima. <strong>Indicações + upgrade que você fez nos últimos {constants.optinLookbackDays} dias antes do clique entram retroativamente.</strong>
          </RuleStep>

          <RuleStep number={2} title="Compartilhe seu link de indicação">
            Cada amigo que se cadastrar pelo seu link entra no sistema. Funciona pra qualquer canal: WhatsApp, Instagram, e-mail, link direto.
          </RuleStep>

          <RuleStep number={3} title={`Amigo confirma cadastro = +${constants.pointsConfirmed} ponto pra você`}>
            Você ganha <strong>{constants.pointsConfirmed} ponto no ranking</strong> e <strong>+1 scan grátis</strong> (~20 figurinhas reconhecidas) imediatamente. O amigo ganha <strong>+1 troca extra</strong>.
          </RuleStep>

          <RuleStep number={4} title={`Amigo assina plano pago = +${constants.pointsPaidUpgrade} pontos pra você`}>
            Quando o amigo faz upgrade pra qualquer plano pago (Estreante, Colecionador ou Copa Completa), seus pontos sobem de {constants.pointsConfirmed} → <strong>{constants.pointsPaidUpgrade}</strong> nessa indicação. Substitui, não soma.
          </RuleStep>

          <RuleStep number={5} title={`Você assinar um plano = +${constants.pointsSelfUpgrade} pontos pra você`}>
            Se você mesmo assinar qualquer plano pago durante a campanha, ganha <strong>+{constants.pointsSelfUpgrade} pontos bônus</strong> no seu ranking. Vale uma vez por usuário (a primeira assinatura conta).
          </RuleStep>

          <RuleStep number={6} title={`A cada ${constants.friendsForCoupon} amigos confirmados = cupom ${constants.couponPercentOff}% off`}>
            Você recebe um cupom <strong>{constants.couponPercentOff}% off</strong> pessoal e válido por <strong>{constants.couponValidityHours} horas</strong>. Não-transferível. Use no upgrade do seu plano.
            <br />
            <span className="text-[11px] text-gray-500">Cupons não acumulam — usar/expirar libera o próximo.</span>
          </RuleStep>

          <RuleStep number={7} title="Top 3 da campanha ganha kit físico">
            <ul className="text-sm text-gray-700 space-y-1 mt-1">
              <li>🥇 <strong>1º:</strong> Porta-figurinha + 10 pacotes + 5 trocas extras (70 figs)</li>
              <li>🥈 <strong>2º:</strong> Porta-figurinha + 8 pacotes + 5 trocas extras (56 figs)</li>
              <li>🥉 <strong>3º:</strong> 5 pacotes + 5 trocas extras (35 figs)</li>
            </ul>
            <p className="text-[11px] text-gray-500 mt-2">Pontuação acumula durante todo o período da campanha — ranking final fecha em {campaignEndDateLabel} às {campaignEndTimeLabel}.</p>
          </RuleStep>

          <RuleStep number={8} title={`Mínimo de ${constants.minParticipants} participantes`}>
            Se a campanha não atingir <strong>{constants.minParticipants} participantes</strong> que fizeram opt-in, a Complete Aí pode <strong>prorrogar a data final</strong> a seu critério. Avisaremos por aqui caso isso aconteça.
          </RuleStep>

          <RuleStep number={9} title={`Campanha vai até ${campaignEndDateLabel} às ${campaignEndTimeLabel}`}>
            Após esse prazo: <strong>cupons param de ser concedidos</strong>, prêmios físicos do top 3 são enviados pelos Correios, e a página de campanha sai do app. Cupons já emitidos seguem suas próprias datas de validade (48h cada).
          </RuleStep>
        </ol>

        {/* Anti-fraud rule — mandatory */}
        <div className="mt-6 bg-red-50 border border-red-200 rounded-2xl p-4">
          <p className="text-xs font-bold text-red-800 mb-1">⚠️ Indicações precisam ser de pessoas reais</p>
          <p className="text-xs text-red-700 leading-relaxed">
            Cadastros automatizados (bots), múltiplas contas do mesmo usuário ou outras práticas suspeitas levam à <strong>desclassificação imediata do ranking</strong> — você perde posição e prêmios. Reservamo-nos o direito de revisar e invalidar indicações suspeitas a qualquer momento, sem aviso prévio.
          </p>
        </div>
      </section>

      {/* ── Prêmios visualmente ── */}
      <section className="px-4 max-w-2xl mx-auto mb-10">
        <h2 className="text-xl font-black text-navy mb-4">🏆 Prêmios do Top 3</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <PrizeCard
            place="🥇"
            position="1º lugar"
            highlights={['Porta-figurinha', '10 pacotes Panini', '5 trocas extras']}
            total="70 figurinhas"
            bg="bg-gradient-to-br from-amber-100 to-yellow-50"
            border="border-amber-300"
          />
          <PrizeCard
            place="🥈"
            position="2º lugar"
            highlights={['Porta-figurinha', '8 pacotes Panini', '5 trocas extras']}
            total="56 figurinhas"
            bg="bg-gradient-to-br from-gray-100 to-slate-50"
            border="border-gray-300"
          />
          <PrizeCard
            place="🥉"
            position="3º lugar"
            highlights={['5 pacotes Panini', '5 trocas extras']}
            total="35 figurinhas"
            bg="bg-gradient-to-br from-orange-100 to-amber-50"
            border="border-orange-300"
          />
        </div>
        <p className="text-[11px] text-gray-500 text-center mt-3">
          Além do top 3, <strong>todo mundo que indicar ganha</strong> scans, trocas e cupons.
        </p>
      </section>

      {/* ── Ranking público ── */}
      <section className="px-4 max-w-2xl mx-auto mb-10">
        <h2 className="text-xl font-black text-navy mb-4">📊 Ranking ao vivo</h2>
        {!showRanking ? (
          <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center">
            <p className="text-sm text-gray-500">
              Ranking aparece quando <strong>{constants.minParticipantsForDisplay} embaixadores</strong> entrarem na disputa.
            </p>
            <p className="text-xs text-gray-400 mt-2">
              {participantCount === 0
                ? 'Seja o primeiro!'
                : `Já temos ${participantCount} — faltam ${Math.max(0, constants.minParticipantsForDisplay - participantCount)}.`}
            </p>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
            {ranking.slice(0, 50).map((r) => (
              <RankingRowItem key={r.user_id} row={r} />
            ))}
            {ranking.length > 50 && ranking[50] && (
              <>
                <div className="text-center py-2 text-[10px] text-gray-400 bg-gray-50">···</div>
                <RankingRowItem row={ranking[50]} />
              </>
            )}
          </div>
        )}
      </section>

      {/* ── Live community counters ── */}
      <section className="px-4 max-w-2xl mx-auto mb-10">
        <h2 className="text-xl font-black text-navy mb-4">🌍 Comunidade ao vivo</h2>

        {/* Participant progress (min 50 rule) — always visible */}
        <div className={`mb-3 rounded-2xl border p-4 ${
          minParticipantsMet ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'
        }`}>
          <div className="flex items-center justify-between mb-2">
            <p className={`text-xs font-bold ${minParticipantsMet ? 'text-emerald-700' : 'text-amber-700'}`}>
              👥 Participantes confirmados
            </p>
            <p className={`text-sm font-black ${minParticipantsMet ? 'text-emerald-700' : 'text-amber-700'}`}>
              {participantCount} / {constants.minParticipants}
            </p>
          </div>
          <div className="h-2 bg-white rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-700 ${minParticipantsMet ? 'bg-emerald-500' : 'bg-amber-500'}`}
              style={{ width: `${Math.min(100, (participantCount / constants.minParticipants) * 100)}%` }}
            />
          </div>
          <p className="text-[10px] text-gray-600 mt-2 leading-tight">
            {minParticipantsMet
              ? '✅ Mínimo atingido — campanha rola na data prevista.'
              : `Faltam ${Math.max(0, constants.minParticipants - participantCount)} pra atingir o mínimo. Se não chegar lá, a Complete Aí pode prorrogar a data final.`}
          </p>
        </div>

        {/* Numeric counters — only after we cross the display threshold */}
        {canShowPublicNumbers ? (
          <div className="grid grid-cols-3 gap-2">
            <CounterCard label="Embaixadores" value={totals.ambassadors} icon="🚀" />
            <CounterCard label="Cadastros via indicação" value={totals.confirmed} icon="✅" />
            <CounterCard label="Já fizeram upgrade" value={totals.paidUpgrades} icon="💎" />
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-2xl p-5 text-center">
            <p className="text-xs text-gray-500">
              Números aparecem quando <strong>{constants.minParticipantsForDisplay} participantes</strong> entrarem.
            </p>
          </div>
        )}
      </section>

      {/* ── Footer note: separate Instagram concurso ── */}
      <section className="px-4 max-w-2xl mx-auto mb-10">
        <p className="text-[11px] text-gray-400 text-center">
          Tem também o <Link href="/regulamentosorteio" className="text-brand underline hover:text-brand-dark">Concurso de Engajamento no Instagram</Link>{' '}
          (29/04 a 02/05) — sorteio de álbum + porta-figurinhas.
        </p>
      </section>

      {/* ── CTA fixo no rodapé ── */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-3 z-50 sm:hidden">
        {isLoggedIn && !userExcluded && referralCode ? (
          <button
            onClick={nativeShare}
            className="w-full bg-brand text-white font-bold py-3 rounded-xl active:scale-95 transition"
          >
            Compartilhar meu link
          </button>
        ) : (
          <Link
            href="/register"
            className="block w-full bg-brand text-white text-center font-bold py-3 rounded-xl active:scale-95 transition"
          >
            Cadastrar e participar
          </Link>
        )}
      </div>
    </main>
  )
}

// ─────────────────────── Sub-components ───────────────────────

function StatBox({ label, value, color, sub }: { label: string; value: number; color: string; sub?: string }) {
  return (
    <div className="bg-gray-50 rounded-xl p-3 text-center">
      <p className={`text-2xl font-black ${color}`}>{value}</p>
      <p className="text-[10px] text-gray-500 mt-0.5 font-medium">{label}</p>
      {sub && <p className="text-[9px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

function RuleStep({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return (
    <li className="bg-white border border-gray-200 rounded-xl p-4 flex gap-3">
      <span className="flex-shrink-0 w-7 h-7 rounded-full bg-brand text-white text-sm font-bold flex items-center justify-center">
        {number}
      </span>
      <div className="flex-1">
        <p className="font-bold text-navy text-sm mb-1">{title}</p>
        <div className="text-sm text-gray-600 leading-relaxed">{children}</div>
      </div>
    </li>
  )
}

function PrizeCard({
  place, position, highlights, total, bg, border,
}: { place: string; position: string; highlights: string[]; total: string; bg: string; border: string }) {
  return (
    <div className={`${bg} border-2 ${border} rounded-2xl p-4`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-2xl">{place}</span>
        <span className="text-sm font-bold text-navy">{position}</span>
      </div>
      <ul className="space-y-1 mb-3">
        {highlights.map((h) => (
          <li key={h} className="text-xs text-gray-700 flex items-start gap-1.5">
            <span className="text-brand mt-0.5">•</span>
            <span>{h}</span>
          </li>
        ))}
      </ul>
      <p className="text-[11px] font-bold text-navy bg-white/60 rounded-lg px-2 py-1 text-center">
        {total}
      </p>
    </div>
  )
}

function RankingRowItem({ row }: { row: RankingRow }) {
  const medal = row.rank === 1 ? '🥇' : row.rank === 2 ? '🥈' : row.rank === 3 ? '🥉' : null
  const name = row.display_name
    ? row.display_name.split(' ').slice(0, 2).map((n, i) => i === 1 ? `${n.charAt(0)}.` : n).join(' ')
    : 'Embaixador'

  return (
    <div className={`flex items-center gap-3 px-4 py-3 border-b border-gray-100 last:border-0 ${row.is_self ? 'bg-brand/5' : ''}`}>
      <span className="w-7 text-center text-sm font-bold text-gray-500">
        {medal || `#${row.rank}`}
      </span>
      <span className="flex-1 text-sm font-medium text-gray-800 truncate">
        {row.is_self && <span className="text-brand">VOCÊ · </span>}
        {name}
        {row.self_upgraded && <span className="ml-1" title="Assinou plano pago — +5 pts bônus">⭐</span>}
      </span>
      <div className="text-right">
        <p className="text-sm font-black text-brand">{row.total_points} pts</p>
        <p className="text-[10px] text-gray-400">
          {row.confirmed_count} cadastro{row.confirmed_count !== 1 ? 's' : ''}
          {row.paid_upgrade_count > 0 && ` · ${row.paid_upgrade_count} 💎`}
        </p>
      </div>
    </div>
  )
}

function CounterCard({ label, value, icon }: { label: string; value: number; icon: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3 text-center">
      <p className="text-xl mb-1">{icon}</p>
      <p className="text-xl font-black text-navy">{value.toLocaleString('pt-BR')}</p>
      <p className="text-[10px] text-gray-500 mt-0.5 leading-tight">{label}</p>
    </div>
  )
}
