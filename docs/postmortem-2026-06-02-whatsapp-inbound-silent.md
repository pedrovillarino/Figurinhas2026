# Postmortem — Bot do WhatsApp parou de responder (inbound silencioso)

**Data do incident:** 2026-06-02 23:55 UTC → 2026-06-04 (detectado/corrigido)
**Duração:** ~36h sem receber nenhuma mensagem
**Impacto:** o bot do WhatsApp parou de responder a TODOS os usuários. Nenhuma
mensagem recebida foi processada. Envios do sistema (crons, alertas) seguiram
funcionando — o que mascarou o problema.

---

## Resumo

A Z-API continuou **conectada e enviando** mensagens normalmente, mas **parou
de entregar as mensagens recebidas** no nosso webhook (`/api/whatsapp/webhook`).
Como o envio funcionava, nenhum check de "está conectado?" acusava problema. O
watchdog que existia justamente pra detectar/recuperar esse cenário estava
**cego** e nunca disparou.

## Linha do tempo

- **02/jun 23:55 UTC** — última mensagem recebida (`webhook_dedup` /
  `wa_messages` param no mesmo segundo). A partir daí, **zero** POSTs em
  `/api/whatsapp/webhook` nos logs da Vercel.
- **03–04/jun** — entrada = 0/dia (vinha de 12–14 mil/dia). Saída seguiu
  (8–11/dia: só crons/alertas do sistema). Último deploy tinha sido **24/mai**,
  9 dias antes — não foi regressão de código.
- **04/jun** — diagnóstico: inbound morto, outbound vivo → webhook de recebidas
  da Z-API caiu. Watchdog não auto-curou. Reescrito + recovery manual + cron.

## Como foi diagnosticado (replicável)

A chave foi separar **inbound** de **outbound** olhando os dados, em vez de
confiar no "connected":

```sql
-- entrada vs saída por dia: revela inbound morto com outbound vivo
select date_trunc('day', created_at) dia, direction, count(*)
from wa_messages where created_at > now() - interval '8 days'
group by 1,2 order by 1 desc;

-- última mensagem recebida de fato
select max(created_at) from webhook_dedup;
```

E confirmar nos logs da plataforma que **não há POSTs chegando** no endpoint do
webhook (só os GETs de healthcheck) — prova de que o gateway parou de chamar a
gente, não que o nosso handler está quebrado.

## Causa raiz

Duas falhas em série:

1. **Externa (gatilho):** a Z-API deixou de entregar mensagens recebidas no
   webhook (URL de "ao receber" caída/limpa, ou entrega desabilitada do lado
   deles). Isso é silencioso: o status da instância continua `connected` porque
   o **envio** usa outro caminho.

2. **Interna (por que ficou 36h sem recuperar):** o watchdog em
   `/api/whatsapp/health` só re-setava o webhook se passasse numa condição
   composta (`current=0 E baseline_mediana≥15 E ratio<0.2 E horário ativo E
   zapi conectado`). Esse `if` **nunca entrou** durante o incident, e era
   **impossível saber por quê pelos logs** porque o watchdog não logava os
   gates individuais. Além disso, o cron que deveria rodar o watchdog estava
   agendado **1x/dia às 07:00 UTC = 04:00 BR** — exatamente dentro da janela de
   "sleep" (01:00–06:00 BR) em que o próprio watchdog não dispara. Sobrava só o
   UptimeRobot (5 em 5 min) batendo no endpoint público — e mesmo assim o
   recovery não disparava por causa da condição frágil.

## Correção

- **Trigger simples e observável:** dispara por "há quanto tempo não recebemos
  nada" lido direto de `webhook_dedup`, sem RPC/mediana/ratio.
- **Loga TODOS os gates sempre** (`[Health] watchdog gates {...}`) — nunca mais
  ficar cego.
- **Recovery em 2 níveis:** (a) re-set do webhook (idempotente, toda vez que
  silencioso); (b) restart da instância se o silêncio persistir >30min (claim
  atômico com cooldown).
- **Alerta por WhatsApp E email** — email é independente do canal que pode estar
  quebrado.
- **Endpoint manual** `POST /api/admin/whatsapp/reset-webhook` (header
  `x-admin-secret`) pra recovery de 1 clique, sem depender de gate nenhum.
- **Cron** do health de `0 7 * * *` → `*/15 * * * *` (não depende mais só do
  UptimeRobot e não cai na janela de sleep).
- Migration `031` adiciona `watchdog_state.last_restart_at` e garante a linha
  `webhook_recovery`.

## Lições (reaproveitáveis em outros projetos)

1. **Monitore o INBOUND separado do "connected".** Em qualquer integração com
   gateway (WhatsApp, SMS, e-mail, webhooks de pagamento), o caminho de
   **recebimento** pode morrer sozinho enquanto o de **envio** segue vivo. Um
   ping de "está conectado?" não cobre isso. Meça **"quando foi o último evento
   recebido?"** e alarme em cima disso.

2. **Watchdog que não loga seus gates é inútil quando mais precisa.** Se a
   recuperação automática tem condição composta, **logue cada termo da condição
   em toda execução**. "Não disparou e não sei por quê" é o pior estado.

3. **Recuperação preferir simples e idempotente a esperta.** Uma ação barata e
   sem efeito colateral (re-setar a URL do webhook) pode rodar a cada ciclo sem
   gate frágil. Guarde gates/cooldown só pra ações caras (restart, reconexão).

4. **Cuidado com cron + janela de silêncio.** Um watchdog que "dorme" de
   madrugada agendado pra rodar de madrugada nunca trabalha. Confira se a
   frequência e o horário do agendamento batem com quando ele deve agir.

5. **Tenha um botão de pânico manual** independente da automação (endpoint
   admin) — e que **não dependa do canal quebrado**.

6. **Alerta por canal independente.** Se o bot avisa problemas pelo próprio
   WhatsApp e o WhatsApp é o que quebrou, o aviso pode não sair (aqui o envio
   ainda funcionava, mas não dá pra contar com isso). Tenha email/segundo canal.

7. **"Outbound funcionando" mascara incidents de inbound.** Dá falsa sensação de
   saúde. Trate os dois caminhos como serviços distintos no monitoramento.
