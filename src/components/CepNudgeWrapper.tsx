// Server Component wrapper que decide e renderiza o CepNudge.
// Usado em /album, /trades, /dashboard pra mostrar o banner contextual
// sem duplicar a lógica de "should show" em cada página.

import { getCepNudgeData } from '@/lib/cep-nudge'
import CepNudge from './CepNudge'

export default async function CepNudgeWrapper({ userId }: { userId: string }) {
  const data = await getCepNudgeData(userId)
  if (!data.show) return null
  return <CepNudge show={data.show} stickersOwned={data.stickersOwned} />
}
