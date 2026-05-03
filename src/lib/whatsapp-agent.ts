/**
 * WhatsApp Agent — Fase 1 (spike).
 *
 * Pedro 2026-05-03: bot atual usa regex+intent classifier (Gemini stateless).
 * Quando user escreve algo que não bate em padrão (frase natural, pergunta
 * indireta, referência a contexto), bot só sabe responder com menu ou cair
 * em "unknown". Agent vê a mensagem + último turno do bot + tools, e
 * decide se chama uma função ou responde direto.
 *
 * Spike escopo: agent SÓ é chamado quando regex+classifier falham (fallback).
 * Fast paths atuais (códigos, foto, áudio, casual) continuam via regex —
 * sem perder velocidade nem custo.
 *
 * Tools disponíveis nessa fase: 3 essenciais + escalation.
 */
import { GoogleGenerativeAI, SchemaType, FunctionCallingMode, type FunctionDeclaration, type Schema } from '@google/generative-ai'
import { createClient } from '@supabase/supabase-js'
import { type Tier, TIER_CONFIG } from '@/lib/tiers'
import { getQuotas } from '@/lib/whatsapp-quotas'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)

// ─── Tools que o agent pode chamar ───
//
// Cada tool é uma função do Postgres ou da app que o LLM pode "executar".
// Mantemos ENXUTO no spike — só o que cobre as perguntas mais comuns
// observadas na long tail (quotas, stats do álbum, escalação).
//
// Tools com efeito colateral (registrar, deletar, comprar) ficam pra Fase 2
// — antes a gente precisa testar que o agent não alucina chamadas.

const TOOLS: FunctionDeclaration[] = [
  {
    name: 'get_user_stats',
    description:
      'Retorna estatísticas do álbum do usuário: quantas figurinhas tem coladas, ' +
      'quantas faltam, quantas repetidas e o progresso percentual. Use quando o ' +
      'user perguntar sobre o álbum, progresso, "quanto eu tenho", "como tá meu álbum".',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {} as Record<string, Schema>,
      required: [],
    },
  },
  {
    name: 'get_user_quotas',
    description:
      'Retorna quantos scans e áudios o user ainda pode usar no plano dele. ' +
      'Use quando perguntarem sobre saldo/créditos: "quantos scans tenho", ' +
      '"posso escanear mais", "quantos áudios ainda tenho", "tô no fim do crédito".',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {} as Record<string, Schema>,
      required: [],
    },
  },
  {
    name: 'escalate_to_human',
    description:
      'Encaminha a mensagem do user pro time de atendimento humano. Use APENAS ' +
      'quando: (a) a pergunta foge totalmente do escopo do bot (não é sobre álbum, ' +
      'figurinhas, scan, trocas, planos), OU (b) o user demonstra frustração explícita ' +
      '("não tá funcionando", "tá quebrado", "preciso falar com alguém"), OU (c) você ' +
      'realmente não consegue interpretar mesmo com contexto.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        reason: {
          type: SchemaType.STRING,
          description: 'Curto resumo do motivo da escalação (vai pro time atendimento).',
        },
      },
      required: ['reason'],
    },
  },
]

const SYSTEM_PROMPT = `Você é o assistente do *Complete Aí*, um app de álbum de figurinhas Panini da Copa do Mundo FIFA 2026.

# Sobre o app
- Site: https://www.completeai.com.br
- Funções principais: registrar figurinhas (foto/áudio/texto), ver progresso, descobrir trocas com gente perto, ranking, planos pagos com mais scans/áudios.
- Álbum oficial: 980 figurinhas que contam pro 100% + 92 extras (ouros/pratas/bronzes/regulares/Coca-Cola).
- Trocas: SEMPRE acontecem dentro da plataforma (não estimule trocas por fora).
- Export de figurinhas (faltantes/repetidas) é em *texto* pra copiar/colar — *NÃO existe PDF nem CSV*.
- Tutorial áudio: usuário aperta o microfone do WhatsApp, fala "Brasil 1, Argentina 3, Espanha 5".
- Foto: até 10 figurinhas por foto, com nitidez (nome ou número legível).

# Comandos de texto que o app aceita
Se o user perguntar "como faço X", você pode sugerir mandar:
- *status* / *progresso* → estatísticas do álbum
- *quantos scans* / *quantos áudios* → créditos restantes (use get_user_quotas)
- *faltantes* / *o que falta* → lista o que falta (pode filtrar por país: "faltantes brasil")
- *repetidas* → suas figurinhas duplicadas
- *ranking* → posição no ranking
- *trocas* → solicitações pendentes
- *historico* → últimas figurinhas registradas
- *menu* → lista completa de comandos

# Seu papel
- Responder em português brasileiro, tom amigável e direto.
- Mensagens curtas (3-5 linhas em geral). WhatsApp não é blog.
- Use emoji com moderação (1-2 por mensagem).
- Quando user pergunta sobre DADO dele (álbum, créditos), use as ferramentas (functions) — NUNCA invente números.
- Quando user faz pergunta sobre FEATURE do app (ver lista acima), responda direto explicando.
- Se o user quer fazer algo (ver lista, registrar), pode sugerir o comando texto.

# Quando escalar pro humano (escalate_to_human)
- Pergunta TOTALMENTE fora do escopo (política, fofoca, ajuda com outro app).
- Frustração explícita ("tá quebrado", "não funciona", "preciso falar com alguém").
- Reclamação de pagamento/cobrança que precisa intervenção.
- Você realmente não consegue interpretar nem com contexto.

# Contexto da conversa
- Se o user faz referência à mensagem anterior do bot (ex: "tira o 2", "pode ser", "aquele primeiro"), considere que está respondendo à sua última mensagem (se foi recente).
- A última mensagem que você enviou (se houver) está marcada como "[Sua mensagem anterior]".

# Tom
- Use "você" (não "tu").
- Pode chamar de "campeão", "colecionador" se for casual.
- Não force formalidade.

# O que NÃO fazer
- Não invente preços, datas ou números.
- Não force menu se a pergunta foi natural — responda direto.
- Não admita ser uma IA por padrão (mas se perguntarem direto, pode dizer que é assistente automatizado).
- Não estimule trocas fora da plataforma — sempre direcione pra app.`

export type AgentResponse =
  | { kind: 'text'; text: string }
  | { kind: 'tool_result'; toolName: string; text: string }
  | { kind: 'escalate'; reason: string; userMessage: string }
  | { kind: 'error'; error: string }

/**
 * Roda o agent: pega mensagem do user + contexto + tools, chama Gemini
 * e devolve a ação a tomar.
 *
 * Spike: 1 chamada apenas (sem loop multi-turn). Suficiente pros casos
 * mais comuns onde o user pergunta algo e o agent decide chamar 1 tool
 * ou responder texto.
 */
export async function runAgent(input: {
  userId: string
  userMessage: string
  lastBotMessage?: string | null
  lastBotMessageAt?: string | null
  userTier?: Tier
}): Promise<AgentResponse> {
  const { userId, userMessage, lastBotMessage, lastBotMessageAt, userTier } = input

  // Só inclui contexto se for recente (≤ 10min). Conversas frias = sem contexto.
  const TEN_MIN_MS = 10 * 60 * 1000
  const contextRecent =
    lastBotMessage &&
    lastBotMessageAt &&
    Date.now() - new Date(lastBotMessageAt).getTime() <= TEN_MIN_MS

  const userTurn = contextRecent
    ? `[Sua mensagem anterior]: ${lastBotMessage}\n\n[User responde]: ${userMessage}`
    : `[User mensagem]: ${userMessage}`

  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: SYSTEM_PROMPT,
      tools: [{ functionDeclarations: TOOLS }],
      toolConfig: {
        functionCallingConfig: { mode: FunctionCallingMode.AUTO },
      },
    })

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: userTurn }] }],
    })

    const response = result.response
    const calls = response.functionCalls()

    if (calls && calls.length > 0) {
      // Executa primeira tool call (spike: não fazemos chains)
      const call = calls[0]
      const toolResult = await executeTool(call.name, call.args as Record<string, unknown>, {
        userId,
        userTier: userTier || 'free',
        userMessage,
      })
      return toolResult
    }

    // Sem function call → resposta texto direto
    const text = response.text().trim()
    if (!text) {
      return {
        kind: 'escalate',
        reason: 'agent retornou texto vazio',
        userMessage,
      }
    }
    return { kind: 'text', text }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error('[whatsapp-agent] runAgent error:', errMsg)
    return { kind: 'error', error: errMsg }
  }
}

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: { userId: string; userTier: Tier; userMessage: string },
): Promise<AgentResponse> {
  const supabase = getAdmin()

  if (name === 'get_user_stats') {
    const { data: rows } = await supabase
      .from('user_stickers')
      .select('status, stickers!inner(counts_for_completion)')
      .eq('user_id', ctx.userId)
      .in('status', ['owned', 'duplicate'])
    type Row = { status: string; stickers: { counts_for_completion: boolean } | { counts_for_completion: boolean }[] }
    const list = (rows || []) as unknown as Row[]
    const completable = list.filter((r) => {
      const s = Array.isArray(r.stickers) ? r.stickers[0] : r.stickers
      return s?.counts_for_completion === true
    })
    const owned = completable.filter((r) => r.status === 'owned').length
    const dups = completable.filter((r) => r.status === 'duplicate').length
    const { count: total } = await supabase
      .from('stickers')
      .select('id', { count: 'exact', head: true })
      .eq('counts_for_completion', true)
    const totalN = total || 980
    const have = owned + dups
    const missing = totalN - have
    const pct = totalN > 0 ? Math.round((have / totalN) * 100) : 0
    const text =
      `📊 *Seu álbum:*\n` +
      `✅ Coladas: *${owned}*\n` +
      `🔁 Repetidas: *${dups}*\n` +
      `❌ Faltam: *${missing}*\n` +
      `📈 Progresso: *${pct}%* (${have}/${totalN})`
    return { kind: 'tool_result', toolName: name, text }
  }

  if (name === 'get_user_quotas') {
    const quotas = await getQuotas(ctx.userId, ctx.userTier)
    const tierLabel = TIER_CONFIG[ctx.userTier]?.label || 'Free'
    const fmt = (rem: number, lim: number) => {
      if (rem === Infinity || lim === Infinity) return '∞ ilimitado'
      return `*${rem}* restante${rem !== 1 ? 's' : ''} (de ${lim})`
    }
    const text =
      `📊 *Seu plano: ${tierLabel}*\n` +
      `📸 Scans: ${fmt(quotas.scansRemaining, quotas.scansLimit)}\n` +
      `🎤 Áudios: ${fmt(quotas.audiosRemaining, quotas.audiosLimit)}`
    return { kind: 'tool_result', toolName: name, text }
  }

  if (name === 'escalate_to_human') {
    const reason = (args.reason as string) || 'sem motivo informado'
    return { kind: 'escalate', reason, userMessage: ctx.userMessage }
  }

  return { kind: 'error', error: `tool ${name} não implementada` }
}

/**
 * Atualiza profiles.last_bot_message + last_bot_message_at.
 * Chamado pelo wrapper sendBotText (substitui sendText quando precisa
 * preservar contexto pro agent).
 *
 * Best-effort — falha não bloqueia o envio.
 */
export async function recordBotMessage(userId: string, message: string): Promise<void> {
  try {
    const supabase = getAdmin()
    await supabase
      .from('profiles')
      .update({
        last_bot_message: message.slice(0, 2000), // truncate pra evitar bloat
        last_bot_message_at: new Date().toISOString(),
      })
      .eq('id', userId)
  } catch (err) {
    console.error('[whatsapp-agent] recordBotMessage error:', err)
  }
}

/**
 * Wrapper: sendText + recordBotMessage numa só chamada.
 * Usado nos handlers que enviam mensagens "interativas" — aquelas onde a
 * próxima resposta do user faz sentido COM contexto. Por exemplo:
 *   - Preview de scan ("encontrei 5 figurinhas: 1...")
 *   - Pendente pedindo SIM/NÃO/TIRAR
 *   - Lista filtrada (user pode responder "tira a 3")
 *
 * Não usar pra mensagens "terminais" (✅ salvas, ✗ erro) — essas são fim
 * de conversa e não precisam preservar contexto.
 *
 * Importa sendText dinamicamente pra evitar circular import com
 * src/app/api/whatsapp/webhook/route.ts.
 */
export async function sendBotTextFor(
  userId: string,
  phone: string,
  message: string,
): Promise<boolean> {
  const { sendText } = await import('@/lib/zapi')
  const ok = await sendText(phone, message)
  if (ok) {
    // best-effort, não bloqueia caso falhe
    void recordBotMessage(userId, message)
  }
  return ok
}

/**
 * Lê o último turno do bot pro user — pra alimentar contexto do agent.
 */
export async function getLastBotContext(userId: string): Promise<{
  message: string | null
  at: string | null
}> {
  try {
    const supabase = getAdmin()
    const { data } = await supabase
      .from('profiles')
      .select('last_bot_message, last_bot_message_at')
      .eq('id', userId)
      .maybeSingle()
    return {
      message: (data as { last_bot_message?: string | null } | null)?.last_bot_message ?? null,
      at: (data as { last_bot_message_at?: string | null } | null)?.last_bot_message_at ?? null,
    }
  } catch {
    return { message: null, at: null }
  }
}
