/**
 * Privacidade: quando OUTROS usuários veem um perfil, mostrar só o primeiro
 * nome. Pedro 2026-05-03 — duas razões:
 *   (a) preservar identidade (não expor sobrenome publicamente)
 *   (b) reduzir incentivo a trocas FORA da plataforma (com nome completo,
 *       fica fácil procurar no Instagram/Facebook e fechar troca por fora)
 *
 * Onde aplicar:
 *   - /ranking (lista pública)
 *   - /trades (cards de match e pedidos)
 *   - /campanha (ranking de embaixadores)
 *   - /u/[refcode] (perfil de embaixador linkado externamente)
 *   - notificações WhatsApp do tipo "{nome} tem sua faltante"
 *
 * Onde NÃO aplicar (mostrar nome completo OK):
 *   - /profile (o próprio user vendo a si mesmo)
 *   - /admin (Pedro vê tudo pra suporte)
 *   - bot WhatsApp falando com o próprio user ("Oi Fernando Almeida")
 */

/**
 * Pega só o primeiro token do nome (separado por espaço). Capitaliza.
 * Fallback "Colecionador" se vazio/null/só whitespace.
 *
 * Exemplos:
 *   "Fernando almeida"       → "Fernando"
 *   "Maria de Fátima Costa"  → "Maria"
 *   "skyy"                   → "Skyy"
 *   "" / null                → "Colecionador"
 *   "  Pedro  "              → "Pedro"
 */
export function displayPublicName(name: string | null | undefined): string {
  if (!name || typeof name !== 'string') return 'Colecionador'
  const trimmed = name.trim()
  if (!trimmed) return 'Colecionador'
  const first = trimmed.split(/\s+/)[0]
  if (!first) return 'Colecionador'
  // Capitaliza primeira letra, mantém o resto como está (preserva
  // capitalizações intencionais tipo "MC", "JP", "Skyy"). Mas se vier
  // 100% lowercase (como "fernando"), capitaliza pra ficar "Fernando".
  if (first === first.toLowerCase()) {
    return first.charAt(0).toUpperCase() + first.slice(1)
  }
  return first
}

/**
 * Como `displayPublicName` mas pra usar em frases naturais ("Maria tem...").
 * Idêntico hoje — separamos por nome semântico pra futura customização
 * (ex: pluralização, tratamento "Sr./Sra.", etc).
 */
export function displayNameInSentence(name: string | null | undefined): string {
  return displayPublicName(name)
}
