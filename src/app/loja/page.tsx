/**
 * /loja — vitrine pública de produtos curados (ML Afiliados).
 * Pedro 2026-05-05.
 *
 * Server component que carrega produtos ativos e renderiza grid com
 * filtro por categoria. Click em produto → abre affiliate URL em nova
 * aba + dispara tracking via /api/store/click.
 *
 * Disclosure obrigatório no footer (CDC + CONAR).
 */
import type { Metadata } from 'next'
import Link from 'next/link'
import { getStoreProducts, CATEGORY_LABELS, CATEGORY_ORDER, type StoreCategory } from '@/lib/store'
import { LogoFull } from '@/components/Logo'
import StoreProductCard from './StoreProductCard'

export const dynamic = 'force-dynamic'
export const revalidate = 60 // 1 minuto

export const metadata: Metadata = {
  title: 'Loja Complete Aí — Produtos pra completar seu álbum Copa 2026',
  description:
    'Selecionamos os melhores produtos pra você completar o álbum da Copa 2026: pacotes Panini, álbum oficial, acessórios e camisas das seleções. Links de afiliado.',
  alternates: { canonical: 'https://www.completeai.com.br/loja' },
}

const VALID_CATEGORIES: StoreCategory[] = [...CATEGORY_ORDER]

export default async function LojaPage({
  searchParams,
}: {
  searchParams: { category?: string }
}) {
  const selectedCategory = VALID_CATEGORIES.includes(
    (searchParams.category || '') as StoreCategory,
  )
    ? (searchParams.category as StoreCategory)
    : null

  const products = await getStoreProducts(
    selectedCategory ? { category: selectedCategory } : undefined,
  )

  // Agrupa por categoria pra renderizar seções (quando não tem filtro)
  const byCategory = new Map<StoreCategory, typeof products>()
  for (const p of products) {
    const list = byCategory.get(p.category) || []
    list.push(p)
    byCategory.set(p.category, list)
  }

  return (
    <div className="min-h-screen bg-white text-navy">
      {/* Header */}
      <header className="px-6 py-5 border-b border-gray-100">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <LogoFull size={32} />
          </Link>
          <Link
            href="/"
            className="text-xs text-gray-500 hover:text-brand transition"
          >
            ← Voltar pro app
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="px-6 py-10 bg-gradient-to-b from-brand-light/30 to-white">
        <div className="max-w-3xl mx-auto text-center">
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-navy">
            A loja do Complete Aí
          </h1>
          <p className="text-sm text-gray-600 mt-3 max-w-md mx-auto leading-relaxed">
            Selecionamos pacotes Panini, álbuns, camisas e acessórios pra
            ajudar você a completar o álbum sem cair em vendedor não
            oficial 🇧🇷⚽
          </p>
        </div>
      </section>

      {/* Filtros */}
      <section className="px-6 pt-6 pb-2">
        <div className="max-w-5xl mx-auto flex flex-wrap gap-2">
          <CategoryPill href="/loja" label="Todos" active={!selectedCategory} />
          {CATEGORY_ORDER.map((cat) => {
            const has = products.some((p) => p.category === cat) || selectedCategory === cat
            if (!has && !selectedCategory) return null
            return (
              <CategoryPill
                key={cat}
                href={`/loja?category=${cat}`}
                label={CATEGORY_LABELS[cat]}
                active={selectedCategory === cat}
              />
            )
          })}
        </div>
      </section>

      {/* Grid de produtos */}
      <section className="px-6 py-6">
        <div className="max-w-5xl mx-auto">
          {products.length === 0 ? (
            <div className="text-center py-16 text-gray-400 text-sm">
              Em breve! Estamos selecionando os melhores produtos pra você. ⚽
            </div>
          ) : selectedCategory ? (
            <ProductGrid products={products} placement={`loja_cat_${selectedCategory}`} />
          ) : (
            <>
              {/* Featured no topo se tiver */}
              {products.some((p) => p.featured) && (
                <div className="mb-8">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-3">
                    ⭐ Destaques
                  </h2>
                  <ProductGrid
                    products={products.filter((p) => p.featured)}
                    placement="loja_featured"
                  />
                </div>
              )}
              {/* Por categoria */}
              {CATEGORY_ORDER.map((cat) => {
                const list = byCategory.get(cat)?.filter((p) => !p.featured) || []
                if (list.length === 0) return null
                return (
                  <div key={cat} className="mb-8">
                    <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-3">
                      {CATEGORY_LABELS[cat]}
                    </h2>
                    <ProductGrid products={list} placement={`loja_cat_${cat}`} />
                  </div>
                )
              })}
            </>
          )}
        </div>
      </section>

      {/* Disclosure (obrigatório CDC + CONAR) */}
      <section className="px-6 py-6 bg-gray-50 border-t border-gray-100">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-[11px] text-gray-500 leading-relaxed">
            ⚠️ <strong>Aviso de afiliado:</strong> Os links acima são de afiliados — quando
            você compra pelo nosso link, ganhamos uma pequena comissão sem custo adicional pra
            você. É assim que mantemos o app evoluindo. Selecionamos só produtos que faz
            sentido recomendar — não é tudo do Mercado Livre, é o que usamos ou validamos.
            Preços, disponibilidade e prazos são gerenciados pelo Mercado Livre, não pelo
            Complete Aí. Por favor, confira sempre antes de finalizar a compra.
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-6 py-6 border-t border-gray-100 text-center space-y-2">
        <p className="text-xs text-gray-500">
          Feito por um pai pra outras famílias. Pagamento único, sem mensalidade.
        </p>
        <div className="flex items-center justify-center gap-3 pt-1">
          <Link href="/" className="text-[11px] text-gray-500 hover:text-brand transition">
            Início
          </Link>
          <span className="text-gray-300">·</span>
          <Link href="/termos" className="text-[11px] text-gray-500 hover:text-brand transition">
            Termos
          </Link>
          <span className="text-gray-300">·</span>
          <Link href="/privacidade" className="text-[11px] text-gray-500 hover:text-brand transition">
            Privacidade
          </Link>
        </div>
      </footer>
    </div>
  )
}

function CategoryPill({
  href,
  label,
  active,
}: {
  href: string
  label: string
  active: boolean
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold transition ${
        active
          ? 'bg-brand text-white'
          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
      }`}
    >
      {label}
    </Link>
  )
}

function ProductGrid({
  products,
  placement,
}: {
  products: { id: number; title: string; description: string | null; image_url: string | null; price_display: string | null; affiliate_url: string }[]
  placement: string
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {products.map((p) => (
        <StoreProductCard key={p.id} product={p} source={placement} />
      ))}
    </div>
  )
}
