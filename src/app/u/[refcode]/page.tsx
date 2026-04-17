import { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import Link from 'next/link'
import TradeBadge from '@/components/TradeBadge'
import UserRating from '@/components/UserRating'
import ComparatorClient from './ComparatorClient'

type Props = {
  params: { refcode: string }
}

// --- Admin client (service role, bypasses RLS) ---
function getAdmin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// --- Dynamic metadata ---
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const admin = getAdmin()
  const { data } = await admin.rpc('get_public_profile_stats', {
    p_ref_code: params.refcode,
  })
  const profile = data?.[0]

  if (!profile) {
    return { title: 'Usuário não encontrado' }
  }

  return {
    title: `${profile.display_name || 'Colecionador'} — Complete Aí`,
    description: `${profile.display_name || 'Este colecionador'} já colou ${profile.owned_count} figurinhas e tem ${profile.duplicate_count} repetidas para trocar no Complete Aí.`,
    openGraph: {
      title: `${profile.display_name || 'Colecionador'} — Complete Aí`,
      description: `${profile.owned_count} figurinhas coladas, ${profile.duplicate_count} repetidas para trocar`,
    },
  }
}

// --- Page ---
export default async function PublicProfilePage({ params }: Props) {
  const { refcode } = params
  const admin = getAdmin()

  // 1. Fetch target user profile stats
  const { data: profileRows, error: profileError } = await admin.rpc(
    'get_public_profile_stats',
    { p_ref_code: refcode }
  )

  if (profileError || !profileRows || profileRows.length === 0) {
    return <NotFound refcode={refcode} />
  }

  const target = profileRows[0] as {
    user_id: string
    display_name: string | null
    avatar_url: string | null
    owned_count: number
    duplicate_count: number
    total_stickers: number
  }

  // 2. Fetch trade badge + rating
  const [tradesResult, ratingResult] = await Promise.all([
    admin.rpc('get_completed_trades_count', { p_user_id: target.user_id }),
    admin.rpc('get_user_rating', { p_user_id: target.user_id }),
  ])

  const completedTrades = (tradesResult.data as number) ?? 0
  const ratingRow = (ratingResult.data as { avg_rating: number | null; review_count: number }[] | null)?.[0]
  const avgRating = ratingRow?.avg_rating ?? null
  const reviewCount = ratingRow?.review_count ?? 0

  // 3. Check if visitor is authenticated
  const supabase = createClient()
  const {
    data: { user: viewer },
  } = await supabase.auth.getUser()

  const isOwnProfile = viewer?.id === target.user_id
  const isAuthenticated = !!viewer && !isOwnProfile

  // 4. If authenticated and not own profile, compare stickers
  let iHaveForYou: Sticker[] = []
  let youHaveForMe: Sticker[] = []

  if (isAuthenticated && viewer) {
    const { data: comparison } = await admin.rpc('compare_stickers', {
      p_viewer_id: viewer.id,
      p_target_id: target.user_id,
    })

    if (comparison) {
      for (const row of comparison as CompareRow[]) {
        const sticker = {
          sticker_id: row.sticker_id,
          number: row.number,
          player_name: row.player_name,
          country: row.country,
        }
        if (row.viewer_status === 'duplicate') {
          iHaveForYou.push(sticker)
        }
        if (row.target_status === 'duplicate') {
          youHaveForMe.push(sticker)
        }
      }
    }
  }

  const displayName = target.display_name || 'Colecionador'
  const initial = displayName[0]?.toUpperCase() || '?'
  const progressPct = target.total_stickers > 0
    ? Math.round((target.owned_count / target.total_stickers) * 100)
    : 0

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Header bar */}
      <header className="bg-white border-b border-gray-100 px-4 py-3">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-lg font-bold text-navy">
            Complete<span className="text-brand">Aí</span>
          </span>
        </Link>
      </header>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-5">
        {/* Profile card */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <div className="flex items-center gap-4 mb-4">
            {target.avatar_url ? (
              <img
                src={target.avatar_url}
                alt={displayName}
                className="w-14 h-14 rounded-full object-cover border-2 border-brand/20"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-14 h-14 bg-brand-light rounded-full flex items-center justify-center text-brand text-xl font-bold border-2 border-brand/20">
                {initial}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h1 className="text-lg font-bold text-navy truncate">{displayName}</h1>
              <div className="flex flex-wrap items-center gap-2 mt-1">
                <TradeBadge completedTrades={completedTrades} />
                <UserRating avgRating={avgRating} reviewCount={reviewCount} />
              </div>
            </div>
          </div>

          {/* Progress */}
          <div className="mb-1">
            <div className="flex justify-between text-xs mb-1.5">
              <span className="font-medium text-gray-700">Progresso do álbum</span>
              <span className="font-semibold text-brand">{progressPct}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2.5">
              <div
                className="h-2.5 rounded-full bg-brand transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <p className="text-xs text-gray-500 mt-1.5">
              {target.owned_count}/{target.total_stickers} figurinhas coladas
            </p>
          </div>

          {/* Duplicate count */}
          {target.duplicate_count > 0 && (
            <div className="mt-3 flex items-center gap-2 bg-gold-light/50 rounded-lg px-3 py-2">
              <span className="text-sm">🔁</span>
              <span className="text-xs font-medium text-gold-dark">
                {target.duplicate_count} repetida{target.duplicate_count !== 1 ? 's' : ''} disponíve{target.duplicate_count !== 1 ? 'is' : 'l'} para troca
              </span>
            </div>
          )}
        </div>

        {/* Own profile message */}
        {isOwnProfile && (
          <div className="bg-white rounded-2xl border border-brand/20 p-5 text-center">
            <div className="w-12 h-12 bg-brand-light rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-navy mb-1">Este é seu álbum!</p>
            <p className="text-xs text-gray-500 mb-3">
              Compartilhe este link para que outros colecionadores comparem figurinhas com você.
            </p>
            <Link
              href="/album"
              className="inline-block bg-brand text-white rounded-lg px-5 py-2.5 text-sm font-semibold hover:bg-brand-dark transition"
            >
              Ir para meu álbum
            </Link>
          </div>
        )}

        {/* Comparator for authenticated visitors */}
        {isAuthenticated && viewer && (
          <ComparatorClient
            iHaveForYou={iHaveForYou}
            youHaveForMe={youHaveForMe}
            targetName={displayName}
            targetId={target.user_id}
            refcode={refcode}
          />
        )}

        {/* CTA for unauthenticated visitors */}
        {!viewer && (
          <div className="space-y-3">
            <Link
              href={`/?ref=${refcode}`}
              className="block w-full text-center bg-brand text-white rounded-xl px-4 py-3.5 text-sm font-semibold hover:bg-brand-dark transition shadow-sm"
            >
              Crie sua conta grátis para comparar e trocar
            </Link>
            <p className="text-center">
              <Link
                href="/login"
                className="text-xs text-gray-500 hover:text-brand transition"
              >
                Já tem conta? <span className="font-semibold underline">Entrar</span>
              </Link>
            </p>
          </div>
        )}

        {/* Footer */}
        <p className="text-center text-[10px] text-gray-400 pt-2">
          Complete Aí — Use IA para organizar e completar seu álbum mais fácil.
        </p>
      </div>
    </main>
  )
}

// --- Not found ---
function NotFound({ refcode }: { refcode: string }) {
  return (
    <main className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-100 px-4 py-3">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-lg font-bold text-navy">
            Complete<span className="text-brand">Aí</span>
          </span>
        </Link>
      </header>
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl border border-gray-200 p-8 max-w-sm w-full text-center">
          <div className="w-14 h-14 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
            </svg>
          </div>
          <h1 className="text-lg font-bold text-navy mb-2">Usuário não encontrado</h1>
          <p className="text-sm text-gray-500 mb-1">
            O código <span className="font-mono font-semibold text-navy">{refcode}</span> não corresponde a nenhum usuário.
          </p>
          <p className="text-xs text-gray-400 mb-5">
            Verifique o link e tente novamente.
          </p>
          <Link
            href="/"
            className="inline-block bg-brand text-white rounded-lg px-5 py-2.5 text-sm font-semibold hover:bg-brand-dark transition"
          >
            Ir para o início
          </Link>
        </div>
      </div>
    </main>
  )
}

// --- Types ---
type Sticker = {
  sticker_id: number
  number: string
  player_name: string | null
  country: string
}

type CompareRow = {
  sticker_id: number
  number: string
  player_name: string | null
  country: string
  viewer_status: string | null
  target_status: string | null
}
