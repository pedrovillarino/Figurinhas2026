'use client'

/**
 * Loja admin client — formulário pra adicionar/editar produtos +
 * vinculação produto ↔ placement. Pedro 2026-05-05.
 */
import { useState } from 'react'
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  PLACEMENT_LABELS,
  type StoreProduct,
  type AdWithProduct,
  type StoreCategory,
} from '@/lib/store'

type FormState = {
  id?: number
  title: string
  description: string
  image_url: string
  price_display: string
  affiliate_url: string
  category: StoreCategory
  featured: boolean
  sort_order: number
  active: boolean
}

const EMPTY_FORM: FormState = {
  title: '',
  description: '',
  image_url: '',
  price_display: '',
  affiliate_url: '',
  category: 'outros',
  featured: false,
  sort_order: 0,
  active: true,
}

export default function StoreAdminClient({
  initialProducts,
  initialPlacements,
  adminSecret,
}: {
  initialProducts: StoreProduct[]
  initialPlacements: AdWithProduct[]
  adminSecret: string
}) {
  const [products, setProducts] = useState<StoreProduct[]>(initialProducts)
  const [placements, setPlacements] = useState<AdWithProduct[]>(initialPlacements)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const totalActive = products.filter((p) => p.active).length
  const placementsWithAd = placements.filter((p) => p.product_id != null && p.active).length

  function resetForm() {
    setForm(EMPTY_FORM)
  }

  function loadProductIntoForm(p: StoreProduct) {
    setForm({
      id: p.id,
      title: p.title,
      description: p.description || '',
      image_url: p.image_url || '',
      price_display: p.price_display || '',
      affiliate_url: p.affiliate_url,
      category: p.category,
      featured: p.featured,
      sort_order: p.sort_order,
      active: p.active,
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function saveProduct() {
    setMsg(null)
    setErr(null)
    if (!form.title.trim() || !form.affiliate_url.trim()) {
      setErr('Título e affiliate_url são obrigatórios')
      return
    }
    setSaving(true)
    try {
      const url = form.id ? `/api/admin/store/products/${form.id}` : '/api/admin/store/products'
      const method = form.id ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'x-admin-secret': adminSecret,
        },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) {
        setErr(data.error || 'Erro ao salvar')
        return
      }
      const product = data.product as StoreProduct
      setProducts((prev) => {
        const filtered = prev.filter((p) => p.id !== product.id)
        return [product, ...filtered].sort((a, b) => {
          if (a.active !== b.active) return a.active ? -1 : 1
          if (a.featured !== b.featured) return a.featured ? -1 : 1
          return a.sort_order - b.sort_order
        })
      })
      setMsg(form.id ? 'Produto atualizado!' : 'Produto criado!')
      resetForm()
    } catch (e) {
      setErr(String(e))
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(p: StoreProduct) {
    const res = await fetch(`/api/admin/store/products/${p.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-secret': adminSecret,
      },
      body: JSON.stringify({ active: !p.active }),
    })
    if (!res.ok) {
      setErr('Erro ao alternar ativo/inativo')
      return
    }
    setProducts((prev) =>
      prev.map((x) => (x.id === p.id ? { ...x, active: !p.active } : x)),
    )
  }

  async function deleteProduct(p: StoreProduct) {
    if (!confirm(`Tem certeza que quer DESATIVAR "${p.title}"? Isso esconde da loja mas mantém histórico.`)) return
    const res = await fetch(`/api/admin/store/products/${p.id}`, {
      method: 'DELETE',
      headers: { 'x-admin-secret': adminSecret },
    })
    if (!res.ok) {
      setErr('Erro ao desativar')
      return
    }
    setProducts((prev) =>
      prev.map((x) => (x.id === p.id ? { ...x, active: false } : x)),
    )
  }

  async function updatePlacement(placementId: string, productId: number | null) {
    const res = await fetch(`/api/admin/store/placements/${placementId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-secret': adminSecret,
      },
      body: JSON.stringify({ product_id: productId }),
    })
    if (!res.ok) {
      setErr('Erro ao atualizar placement')
      return
    }
    const product = productId ? products.find((p) => p.id === productId) || null : null
    setPlacements((prev) =>
      prev.map((p) =>
        p.placement_id === placementId
          ? { ...p, product_id: productId, product: product as StoreProduct | null }
          : p,
      ),
    )
  }

  async function togglePlacementActive(placementId: string, currentActive: boolean) {
    const res = await fetch(`/api/admin/store/placements/${placementId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-secret': adminSecret,
      },
      body: JSON.stringify({ active: !currentActive }),
    })
    if (!res.ok) {
      setErr('Erro ao alternar placement')
      return
    }
    setPlacements((prev) =>
      prev.map((p) =>
        p.placement_id === placementId ? { ...p, active: !currentActive } : p,
      ),
    )
  }

  return (
    <div className="mt-12">
      <h2 className="text-base font-bold mb-1" style={{ color: '#0A1628' }}>
        Loja Afiliados ML
      </h2>
      <p className="text-xs text-gray-500 mb-3">
        {totalActive} produto(s) ativo(s) · {placementsWithAd}/{placements.length} placements com ad ativo
      </p>

      {/* Form */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6">
        <h3 className="text-sm font-semibold text-gray-800 mb-3">
          {form.id ? `Editando produto #${form.id}` : 'Adicionar produto'}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Título *"
            value={form.title}
            onChange={(v) => setForm({ ...form, title: v })}
            placeholder="Álbum Panini Copa 2026 Capa Dura"
          />
          <Input
            label="Categoria"
            value={form.category}
            onChange={(v) => setForm({ ...form, category: v as StoreCategory })}
            type="select"
            options={CATEGORY_ORDER.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))}
          />
          <Input
            label="Affiliate URL *"
            value={form.affiliate_url}
            onChange={(v) => setForm({ ...form, affiliate_url: v })}
            placeholder="https://produto.mercadolivre.com.br/MLB-XXXX?source=affiliate..."
            full
          />
          <Input
            label="Image URL"
            value={form.image_url}
            onChange={(v) => setForm({ ...form, image_url: v })}
            placeholder="https://http2.mlstatic.com/D_NQ_NP_..."
            full
          />
          <Input
            label="Preço (display)"
            value={form.price_display}
            onChange={(v) => setForm({ ...form, price_display: v })}
            placeholder="R$ 12,90"
          />
          <Input
            label="Sort order (menor = primeiro)"
            value={String(form.sort_order)}
            onChange={(v) => setForm({ ...form, sort_order: parseInt(v, 10) || 0 })}
            type="number"
          />
          <Input
            label="Descrição"
            value={form.description}
            onChange={(v) => setForm({ ...form, description: v })}
            placeholder="Acabou de comprar e tá com poucas? Esse é o pacote oficial Panini."
            type="textarea"
            full
          />
        </div>
        <div className="flex flex-wrap items-center gap-4 mt-3">
          <label className="flex items-center gap-2 text-xs text-gray-700">
            <input
              type="checkbox"
              checked={form.featured}
              onChange={(e) => setForm({ ...form, featured: e.target.checked })}
            />
            Featured (destaque no topo)
          </label>
          <label className="flex items-center gap-2 text-xs text-gray-700">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
            />
            Ativo
          </label>
        </div>
        {err && <p className="text-xs text-red-600 mt-2">{err}</p>}
        {msg && <p className="text-xs text-emerald-600 mt-2">{msg}</p>}
        <div className="flex gap-2 mt-3">
          <button
            onClick={saveProduct}
            disabled={saving}
            className="bg-gray-900 text-white text-xs font-semibold rounded-lg px-4 py-2 hover:bg-gray-800 disabled:opacity-50"
          >
            {saving ? 'Salvando...' : form.id ? 'Atualizar' : 'Criar produto'}
          </button>
          {form.id && (
            <button
              onClick={() => {
                resetForm()
                setMsg(null)
                setErr(null)
              }}
              className="text-xs text-gray-600 hover:text-gray-900"
            >
              Cancelar edição
            </button>
          )}
        </div>
      </div>

      {/* Lista de produtos */}
      <div className="overflow-x-auto bg-white border border-gray-200 rounded-lg mb-6">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Título</th>
              <th className="px-3 py-2 text-left font-semibold">Categoria</th>
              <th className="px-3 py-2 text-left font-semibold">Preço</th>
              <th className="px-3 py-2 text-left font-semibold">Featured</th>
              <th className="px-3 py-2 text-left font-semibold">Ordem</th>
              <th className="px-3 py-2 text-left font-semibold">Ativo</th>
              <th className="px-3 py-2 text-right font-semibold">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {products.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-center text-gray-400">
                  Nenhum produto ainda. Use o formulário acima.
                </td>
              </tr>
            )}
            {products.map((p) => (
              <tr key={p.id} className={p.active ? '' : 'opacity-50'}>
                <td className="px-3 py-2 max-w-xs truncate">{p.title}</td>
                <td className="px-3 py-2">{CATEGORY_LABELS[p.category]}</td>
                <td className="px-3 py-2">{p.price_display || '—'}</td>
                <td className="px-3 py-2">{p.featured ? '⭐' : ''}</td>
                <td className="px-3 py-2">{p.sort_order}</td>
                <td className="px-3 py-2">
                  <button
                    onClick={() => toggleActive(p)}
                    className={p.active ? 'text-emerald-600' : 'text-gray-400'}
                  >
                    {p.active ? '✅' : '❌'}
                  </button>
                </td>
                <td className="px-3 py-2 text-right space-x-3">
                  <button
                    onClick={() => loadProductIntoForm(p)}
                    className="text-blue-600 hover:underline"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => deleteProduct(p)}
                    className="text-red-600 hover:underline"
                  >
                    Desativar
                  </button>
                  <a
                    href={p.affiliate_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-500 hover:underline"
                  >
                    Abrir →
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Placements */}
      <h3 className="text-sm font-semibold mb-2" style={{ color: '#0A1628' }}>
        Placements (ads contextuais pra free users)
      </h3>
      <p className="text-xs text-gray-500 mb-3">
        Vincula 1 produto a cada spot da UI. Aparece SÓ pra users free (TIER_CONFIG.hasAds=true).
      </p>
      <div className="overflow-x-auto bg-white border border-gray-200 rounded-lg">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Spot</th>
              <th className="px-3 py-2 text-left font-semibold">Produto vinculado</th>
              <th className="px-3 py-2 text-left font-semibold">Ativo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {placements.map((p) => {
              const labelMeta = PLACEMENT_LABELS[p.placement_id] || {
                label: p.placement_id,
                description: '',
              }
              return (
                <tr key={p.placement_id}>
                  <td className="px-3 py-2 max-w-xs">
                    <div className="font-semibold">{labelMeta.label}</div>
                    <div className="text-[10px] text-gray-500">{labelMeta.description}</div>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={p.product_id || ''}
                      onChange={(e) =>
                        updatePlacement(p.placement_id, e.target.value ? parseInt(e.target.value, 10) : null)
                      }
                      className="text-xs border border-gray-300 rounded px-2 py-1 max-w-[260px] truncate"
                    >
                      <option value="">— sem ad —</option>
                      {products
                        .filter((prod) => prod.active)
                        .map((prod) => (
                          <option key={prod.id} value={prod.id}>
                            {prod.title.slice(0, 50)}
                          </option>
                        ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => togglePlacementActive(p.placement_id, p.active)}
                      className={p.active ? 'text-emerald-600' : 'text-gray-400'}
                    >
                      {p.active ? '✅' : '❌'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── helpers ──

type Option = { value: string; label: string }

function Input({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  options,
  full,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: 'text' | 'number' | 'textarea' | 'select'
  options?: Option[]
  full?: boolean
}) {
  return (
    <label className={`block text-xs ${full ? 'sm:col-span-2' : ''}`}>
      <span className="text-gray-700 font-medium">{label}</span>
      {type === 'textarea' ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={2}
          className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
      ) : type === 'select' ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
        >
          {options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
      )}
    </label>
  )
}
