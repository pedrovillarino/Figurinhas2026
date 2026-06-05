# Runbook — WhatsApp parou de responder (inbound silencioso)

Sintoma: usuários mandam mensagem e o bot não responde. O **envio** do
sistema (alertas/crons) pode continuar funcionando — isso mascara o problema.

## 1. Confirmar (é inbound ou geral?)

No banco (Supabase, projeto Complete AI):

```sql
-- entrada vs saída por dia: inbound morto + outbound vivo = webhook caído
select date_trunc('day', created_at) dia, direction, count(*)
from wa_messages where created_at > now() - interval '5 days'
group by 1,2 order by 1 desc;

-- última mensagem recebida de fato
select max(created_at) from webhook_dedup;
```

Se a última recebida for de horas/dias atrás enquanto o envio segue: a Z-API
parou de entregar as mensagens recebidas no nosso webhook.

## 2. Recuperar (mais rápido primeiro)

**a) Endpoint admin (1 clique):**
```bash
curl -X POST https://www.completeai.com.br/api/admin/whatsapp/reset-webhook \
  -H "x-admin-secret: $ADMIN_SECRET" -H "Content-Type: application/json" \
  -d '{"restart": true}'
```

**b) Direto na Z-API** (se não tiver o app no ar):
```bash
curl -X PUT "https://api.z-api.io/instances/$ZAPI_INSTANCE_ID/token/$ZAPI_TOKEN/update-webhook-received" \
  -H "Client-Token: $ZAPI_CLIENT_TOKEN" -H "Content-Type: application/json" \
  -d '{"value":"https://www.completeai.com.br/api/whatsapp/webhook"}'
# se não voltar em ~2min, reinicia a instância:
curl "https://api.z-api.io/instances/$ZAPI_INSTANCE_ID/token/$ZAPI_TOKEN/restart" -H "Client-Token: $ZAPI_CLIENT_TOKEN"
```

**c) Automático:** o watchdog em `/api/whatsapp/health` re-seta o webhook
sozinho quando detecta silêncio em horário ativo (roda via cron */15 e
UptimeRobot). Veja os gates no log: `[Health] watchdog gates {...}`.

## 3. Confirmar que voltou

```sql
select max(created_at), count(*) filter (where created_at > now() - interval '10 min')
from webhook_dedup;
```

## Por quê acontece

A URL de "ao receber" da Z-API cai/é limpa silenciosamente, ou a entrega é
desabilitada. O status da instância continua `connected` porque o envio usa
outro caminho. Detalhes e lições: `docs/postmortem-2026-06-02-whatsapp-inbound-silent.md`.
