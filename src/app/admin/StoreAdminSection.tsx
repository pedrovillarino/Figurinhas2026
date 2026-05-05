/**
 * Loja afiliados ML + Ads contextuais — admin section.
 * Pedro 2026-05-05.
 *
 * Server component que carrega produtos + placements e passa pro client
 * component pra interatividade (criar, editar, atribuir placement).
 */
import { getAdminStoreProducts, getAdminAdPlacements } from '@/lib/store'
import StoreAdminClient from './StoreAdminClient'

export default async function StoreAdminSection({ adminSecret }: { adminSecret: string }) {
  const [products, placements] = await Promise.all([
    getAdminStoreProducts(),
    getAdminAdPlacements(),
  ])

  return <StoreAdminClient initialProducts={products} initialPlacements={placements} adminSecret={adminSecret} />
}
