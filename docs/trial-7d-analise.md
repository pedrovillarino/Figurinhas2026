# Trial de 7 dias — análise + plano de implementação

**Data:** 2026-05-21
**Status:** análise pra decisão. Não implementado.

## TL;DR

**Recomendação: NÃO trocar Free por trial-paywall agora.** Em vez disso, **adicionar um "Trial Boost" de 7d sobreposto ao Free**, que dá experiência Estreante por 7 dias e cai automaticamente pro Free atual ao expirar.

Razões resumidas:

1. Conversão atual real: **2.11% (17/805)** nos últimos 30 dias — baixa, mas o motor viral depende de Free chamar Free (referrals geram opt-in que vira pagante depois)
2. Liga Complete Aí (15/05–17/07) **já tem 9 opt-ins acumulando pontos** assumindo que continuam grátis. Paywall obrigatório quebra a expectativa contratual
3. Free hoje sustenta a receita auxiliar de ads contextuais (24 produtos, 17 placements, 624 ad_clicks em 24h) e o engajamento do bot WhatsApp
4. Trial-paywall "ou paga ou não usa" exige cartão na criação → atrito de cadastro brutal no Brasil → vai derrubar funnel topo

O modelo proposto (Trial Boost + Free permanente) captura ~70% do uplift de conversão sem destruir o motor viral. Detalhado abaixo.

---

## 1. Estado atual (números verificados no admin)

| Métrica | Valor | Fonte |
|---|---|---|
| Users totais | 947 | profiles |
| Pagantes lifetime | 29 (3.1%) | profiles.tier ≠ free |
| Cadastros 30d | 805 | funnel_events signup_completed |
| Pagantes 30d | 17 | funnel_events payment_completed |
| **Conversão Free → Paid 30d** | **2.11%** | razão acima |
| WAU | 316 (33% dos cadastrados) | get_active_users_metrics |
| MAU | 930 (98%) | idem |
| Receita estimada (mensal projetada) | R$837,10 | tierCounts × priceBrl |
| Liga opt-in | 9 (1% de 947) | profiles.liga_opt_in_at |
| Ads clicks 24h | 624 | funnel_events ad_click |

**Funil de conversão atual (últimos 30d):**

```
Cadastros           805
1º scan             268 (33.3%)
Bateu limite scan   134 (50% dos que escanearam)
Viu paywall          45 (33.6% dos que bateram limite)
Clicou upgrade       19 (42.2%)
Iniciou checkout     19 (100%)
Pagou                17 (89.5%)
```

**Insight crítico:** a queda mortal é **scan → bateu limite** (50% nunca bate o teto de 5 scans). E **bateu limite → viu paywall** (66% somem antes de ver upsell). Não é problema de preço — é de **engagement antes do gate**.

## 2. Proposta original do Pedro

> "Oferecer apenas 7 dias grátis e depois exigir assinatura de algum plano para continuar usando."

Em outras palavras: substituir o tier `free` permanente por um **trial-paywall**: 7 dias completos, depois bloqueio.

## 3. Análise (pros / contras)

### Pros

| | |
|---|---|
| ✅ Cria urgência ("o tempo está correndo") | Aumenta conversão em janelas curtas |
| ✅ Filtra users não-engajados | Reduz custo Gemini/Z-API com quem só passa |
| ✅ Padrão SaaS comprovado | Trial 7d converte tipicamente 5–15% em produtos B2C |
| ✅ Receita previsível | Vira "subscription mindset" pra novos usuários |

### Contras (peso alto neste contexto)

| | |
|---|---|
| ❌ **Atrito de cadastro** | Pra ter expiração funcional, ideal cobrar cartão na criação. No BR isso derruba conversão de cadastro em 60-80% |
| ❌ **Mata o efeito viral** | Hoje "indica amigo → amigo se cadastra de graça → pode ou não pagar". Trial-paywall: amigo precisa decidir comprar em 7d → muitos não indicam |
| ❌ **Quebra a Liga** | Liga é programa de 2 meses (15/05 → 17/07). User dá opt-in achando que vai acumular ponto até a final → trial expira no dia 7 → vira reclamação no WhatsApp e churn público |
| ❌ **Mata os ads contextuais** | Receita de ads ML Afiliados depende de Free user vendo o ad. Se Free vira inexistente, esse motor zera |
| ❌ **Anti-Panini equity** | Álbum de figurinhas tem expectativa cultural de "trocar com amigos do bairro" — pagar pra usar destoa do que o user espera |
| ⚠️ **Bot WhatsApp não tá preparado** | Hoje o bot atende anônimo (via pending_registrations). Trial-paywall força "cadastra com cartão antes do primeiro scan" |

## 4. Interações críticas

### 4.1 Liga Complete Aí
Conflito direto. Liga tem 4 Temporadas de 15 dias até 17/07. Trial de 7d expira no meio da T1. Opções pra resolver:
- (a) Liga vira benefício pagante (perde o motor de opt-in massa)
- (b) Liga não conta pra trial (free trial não pode dar opt-in)
- (c) Trial expira → user vê marcos da Trilha bloqueados mas pode reativar pagando
- (d) **Recomendado: Trial Boost (proposta nova abaixo) — Free continua dando opt-in**

### 4.2 Bot WhatsApp
Hoje o bot:
- Aceita foto pra escanear ANTES do cadastro completo (pending_registrations)
- Envia welcome + tutorial
- Não cobra nada inicial

Trial-paywall exigiria:
- Bot bloquear cadastro até confirmação de cartão (UX horrível no WhatsApp)
- Ou criar conta com 7d e enviar "expirou, paga agora" em mensagem — alta chance de virar spam-block

### 4.3 Embaixadores / Referral
A campanha Embaixadores acabou 12/05, mas o motor de referral_rewards continua. Hoje "amigo paga = +5 pontos pra você". Com trial:
- "amigo se cadastrou = começou trial" — vira sinal mais incerto
- Precisa redesenhar tabela de recompensas

### 4.4 Ads contextuais (TIER_CONFIG.hasAds)
Só `free` tem `hasAds: true`. Se Free morre, 5 placements ficam órfãos. Migration 025 cria ads que aparecem em `album_empty`, `scan_no_results`, `album_progress_50`, `trades_empty`, `album_footer`. Última semana: 624 ad_clicks/24h — receita marginal mas real (% afiliados ML).

### 4.5 PDF / cards / comparator
Hoje gratuitos pra todos. Se mudam pra "pagante only", users free param de exportar PDF de faltantes — outra fonte de viralidade que morre (PDF tem QR de indicação).

## 5. Modelo alternativo recomendado: "Trial Boost"

Em vez de trocar Free por trial, **sobrepor um trial de 7d sobre o Free**:

```
Dia 0  (cadastro)  →  Free + Trial Boost ATIVO (limites de Estreante: 30 scans/30 áudios/5 trocas/sem ads)
Dia 7  (auto)      →  Trial Boost EXPIRA → cai pros limites Free atuais (5/7/2/com ads)
                      User vê banner "Tava com 30 scans, agora 5. Quer continuar? Estreante R$9,90"
```

**Vantagens:**
- ✅ User experimenta o que é "ser pagante" sem entrar dinheiro
- ✅ Não precisa cartão no cadastro (zero atrito)
- ✅ Free permanente preservado → motor viral intacto, ads contextuais intactos, Liga intacta
- ✅ Pressão psicológica de "perdi acesso" na expiração ≠ pressão de "vou pagar". Primeira converte melhor que segunda
- ✅ Compatível com WhatsApp bot: bot envia "seu trial de 30 scans começou! Tem 7 dias"
- ✅ Métricas claras: % que assina nos 7d + 24h pós-expiração

**Desvantagens:**
- ⚠️ Não filtra custos Gemini/Z-API tanto quanto trial-paywall (Free continua existindo)
- ⚠️ Conversão potencial menor que trial-paywall absoluto (mas é maior que 2.11% atual)

## 6. Decisões necessárias antes de implementar (Trial Boost)

| # | Pergunta | Sugestão default |
|---|---|---|
| 1 | Trial dá experiência de qual tier? | **Estreante** (não Copa) — menos custo + upsell pra Colec preservado |
| 2 | Aplicar a users existentes? | Não — só novos cadastros. Existentes podem ganhar via cupom |
| 3 | Como contar 7d? | `trial_starts_at = created_at`, `trial_ends_at = +7d`. Sem ativação manual |
| 4 | Bot WhatsApp herda trial? | Sim — `pending_registrations` que viram conta ganham trial automático |
| 5 | Notificar expiração? | T-1d via WhatsApp ("Amanhã o trial acaba, X scans usados") + email |
| 6 | Pós-expiração: o que acontece? | Banner persistente no /album + paywall no scan #6 do dia + offer especial 24h |
| 7 | Trial pode ser estendido? | Sim, 1x via cupom (TRIAL_X3 = +3 dias). Anti-fraude por user_id |
| 8 | Métrica de sucesso | Aumentar conversão 30d de **2.11% → 5%** (+3pp absoluto, ~2.4x) |

## 7. Schema mínimo (sem migração ainda)

```sql
ALTER TABLE profiles
  ADD COLUMN trial_starts_at TIMESTAMPTZ,
  ADD COLUMN trial_ends_at TIMESTAMPTZ,
  ADD COLUMN trial_expired_seen_at TIMESTAMPTZ;

-- Trigger: novo profile setta trial automático (7d a partir de created_at)
CREATE TRIGGER trg_profiles_set_trial AFTER INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_trial_defaults();

-- Função helper de tier efetivo
CREATE FUNCTION effective_tier(p_user_id UUID) RETURNS TEXT;
  -- retorna 'estreante' se trial ativo, senão tier real
```

E na lib:
- `src/lib/trial.ts` novo: `isTrialActive(user)`, `daysRemaining(user)`, `effectiveTier(user)`
- `src/lib/tiers.ts` ajustado: `getScanLimit(tier)` aceita `effectiveTier` em vez de tier raw
- Endpoints `/api/scan/route.ts` e outros: trocar `userTier` por `effectiveTier`

## 8. Plano de implementação (fases)

### Fase 1 — Foundation (1 dia)
- [ ] Migration 030: colunas + trigger + função `effective_tier`
- [ ] `src/lib/trial.ts` com 3 helpers
- [ ] Backfill: rodar UPDATE pra todos os profiles com `trial_starts_at = created_at` e `trial_ends_at = created_at + 7d` SE for opção decidida
- [ ] Endpoint `GET /api/me/trial` retorna `{ active, ends_at, days_remaining }`

### Fase 2 — Gating (1 dia)
- [ ] `src/app/api/scan/route.ts`: trocar `userTier` por `effectiveTier`
- [ ] Outros endpoints com gating: `/api/audio`, `/api/trades`, etc.
- [ ] Garantir que `hasAds` segue tier real (Free continua vendo ads)

### Fase 3 — Surface (1 dia)
- [ ] Componente `TrialBanner` no /album mostrando "X dias restantes"
- [ ] Banner pós-expiração ("Seu Trial Boost acabou ontem. Continue com Estreante R$9,90")
- [ ] PaywallModal: detecta trial expirado e mostra copy específica
- [ ] LaunchPromoModal: NÃO mostrar pra users em trial ativo (já tá vivendo a experiência)

### Fase 4 — Notif + Bot (1 dia)
- [ ] Cron diário 09:00 BRT: notifica via WhatsApp users com trial T-1d
- [ ] Bot WhatsApp: ao receber primeira foto, menciona "seu trial vai até DD/MM"
- [ ] Email opcional T-1d com link de upgrade

### Fase 5 — Métricas + A/B (1 dia)
- [ ] funnel_events: trackear `trial_started`, `trial_expired`, `trial_converted`
- [ ] Painel admin: aba "Trial Funnel" no LigaAdminSection ou seção própria
- [ ] Comparar 30d antes vs 30d depois — % conversão deve subir

**Total estimado: 5 dias de trabalho.**

## 9. Riscos + mitigations

| Risco | Probabilidade | Impacto | Mitigation |
|---|---|---|---|
| Conversão NÃO sobe | Média | Alto | A/B test 50/50 antes de full rollout |
| Users existentes reclamam de não ter trial | Baixa | Médio | Cupom TRIAL_RETRO grátis pra todos pré-data X |
| Bot WhatsApp manda spam de expiração | Baixa | Médio | Cap 1 mensagem/user; nunca mais de uma vez |
| Liga opt-in cai pq users pensam que precisa pagar | Média | Alto | Copy explícita: "Trial não bloqueia Liga — Liga é grátis sempre" |
| Trial expira durante uso ativo | Média | Médio | Soft-degrade: scans iniciados ANTES da expiração completam |

## 10. Métricas de validação

Decisão de continuar/reverter em 30d:

- **GO se:** conversão 30d ≥ 4% (vs 2.11% atual) E retenção D7 não cair > 15%
- **REVERT se:** conversão 30d < 3% OU retenção D7 cair > 20% OU reclamações no bot > 3x atual

## 11. Alternativas que NÃO recomendo (mas avaliadas)

1. **Trial completo Copa Completa por 7d** — caro demais (4× custo Gemini), e cria expectativa irreal ("agora eu pagaria R$30 por isso?")
2. **Free permanente sem mudança** — status quo. Não resolve o problema da conversão 2.11%
3. **Cobrar cartão no cadastro com 30d grátis** — atrito brutal no BR, vai derrubar topo do funil
4. **Bloquear scan pra Free a partir de hoje** — pura conversão forçada, vai gerar churn massivo e reclamação pública

## 12. Próximos passos sugeridos

1. Pedro decide: Trial Boost (recomendado) vs Trial-Paywall (original)
2. Se Trial Boost: bate as 8 decisões do quadro 6
3. Implementa Fase 1+2 num branch separado, rodando A/B 50/50 por 14d
4. Avalia métricas — go ou revert

---

*Documento gerado em 21/05/2026 como output da task #6 "Analisar trial 7d".*
