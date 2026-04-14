import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getCachedStickers } from '@/lib/stickers-cache'
import TradesHub from './TradesHub'
import { type Tier } from '@/lib/tiers'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Trocas',
  description: 'Encontre colecionadores perto de você e troque figurinhas repetidas da Copa 2026.',
}

export const dynamic = 'force-dynamic'

export default async function TradesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const [{ data: profile }, stickers, { data: userStickers }] = await Promise.all([
    supabase.from('profiles').select('tier, location_lat, location_lng, display_name, is_minor').eq('id', user.id).single(),
    getCachedStickers(),
    supabase.from('user_stickers').select('sticker_id, status, quantity').eq('user_id', user.id),
  ])

  const tier = (profile?.tier || 'free') as Tier
  const hasLocation = !!(profile?.location_lat && profile?.location_lng)
  const isMinor = profile?.is_minor === true

  // Build user stickers map
  const userStickersMap: Record<number, { status: string; quantity: number }> = {}
  userStickers?.forEach((us) => {
    userStickersMap[us.sticker_id] = { status: us.status, quantity: us.quantity }
  })

  // Run all trade-related queries in parallel
  type NearbyMatch = {
    user_id: string
    display_name: string | null
    distance_km: number
    they_have: number
    i_have: number
    match_score: number
  }
  type PendingRequest = {
    id: string
    requester_id: string
    requester_name: string | null
    requester_avatar: string | null
    they_have: number
    i_have: number
    match_score: number
    distance_km: number | null
    message: string | null
    created_at: string
  }

  const safe = <T,>(p: PromiseLike<{ data: T }>) =>
    Promise.resolve(p).catch(() => ({ data: null as T }))

  const [matchesResult, pendingResult, sentResult, approvedResult] = await Promise.all([
    // Nearby matches (only if has location)
    hasLocation
      ? safe(supabase.rpc('get_trade_matches', { p_user_id: user.id, p_radius_km: 50 }))
      : Promise.resolve({ data: null }),
    // Pending trade requests
    safe(supabase.rpc('get_pending_trade_requests', { p_user_id: user.id })),
    // Sent requests (still pending)
    safe(supabase.from('trade_requests').select('target_id').eq('requester_id', user.id).eq('status', 'pending')),
    // Recently approved trades
    safe(supabase.from('trade_requests').select('id, requester_id, responded_at').eq('target_id', user.id).eq('status', 'approved').order('responded_at', { ascending: false }).limit(5)),
  ])

  const nearbyMatches = ((matchesResult.data || []) as NearbyMatch[]).slice(0, 5)
  const nearbyCount = (matchesResult.data || []).length
  const pendingRequests = (pendingResult.data || []) as PendingRequest[]
  const sentRequestUserIds = (sentResult.data || []).map((r: { target_id: string }) => r.target_id)

  // Build approved trades with requester profiles
  let approvedTrades: Array<{ requestId: string; requesterName: string; contact: string | null }> = []
  const approved = approvedResult.data as Array<{ id: string; requester_id: string; responded_at: string }> | null
  if (approved && approved.length > 0) {
    const requesterIds = approved.map(a => a.requester_id)
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, display_name, phone, email')
      .in('id', requesterIds)

    const profileMap = new Map(profiles?.map(p => [p.id, p]) || [])

    approvedTrades = approved.map(a => {
      const p = profileMap.get(a.requester_id)
      const phone = p?.phone?.replace(/\D/g, '')
      return {
        requestId: a.id,
        requesterName: p?.display_name || 'Usuário',
        contact: phone ? `wa.me/${phone}` : p?.email || null,
      }
    })
  }

  // Menores de 18 não têm acesso a trocas
  if (isMinor) {
    return (
      <main className="min-h-screen bg-gray-50 px-5 py-8 max-w-md mx-auto">
        <div className="bg-white rounded-2xl border border-gray-100 p-6 text-center shadow-sm">
          <div className="w-16 h-16 rounded-full bg-amber-50 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          </div>
          <h1 className="text-lg font-bold text-gray-800 mb-2">Trocas indisponíveis</h1>
          <p className="text-sm text-gray-500 leading-relaxed mb-4">
            Para sua segurança, o recurso de trocas não está disponível para menores de 18 anos.
            Isso inclui encontrar colecionadores, solicitar e receber trocas.
          </p>
          <div className="bg-brand-light/50 rounded-xl p-4 text-left mb-4">
            <p className="text-xs font-semibold text-gray-700 mb-2">💡 Dica</p>
            <p className="text-xs text-gray-600 leading-relaxed">
              Um responsável legal (pai, mãe ou tutor) pode criar uma conta própria no Complete Aí
              e utilizar o recurso de trocas por você. Assim vocês podem completar o álbum juntos
              com total segurança!
            </p>
          </div>
          <p className="text-xs text-gray-400 leading-relaxed mb-5">
            Você continua podendo usar o scanner com IA, registrar figurinhas manualmente,
            exportar listas e acompanhar o progresso do seu álbum normalmente.
          </p>
          <a
            href="/album"
            className="inline-block bg-brand text-white text-sm font-semibold rounded-full px-6 py-2.5 hover:bg-brand-dark transition active:scale-[0.98]"
          >
            Voltar ao meu álbum
          </a>
        </div>
      </main>
    )
  }

  return (
    <TradesHub
      userId={user.id}
      tier={tier}
      stickers={stickers}
      userStickersMap={userStickersMap}
      hasLocation={hasLocation}
      nearbyCount={nearbyCount}
      nearbyMatches={nearbyMatches}
      pendingRequests={pendingRequests}
      sentRequestUserIds={sentRequestUserIds}
      approvedTrades={approvedTrades}
    />
  )
}
