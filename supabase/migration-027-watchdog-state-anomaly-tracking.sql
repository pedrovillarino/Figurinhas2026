-- Migration 027: extend watchdog_state to track consecutive anomalies + last state
--
-- Goal: tornar o watchdog do silêncio do webhook mais conservador.
-- Hoje ele notifica a cada janela de cooldown (2h) enquanto o silêncio
-- persiste, e dispara em UMA única janela quieta — falsos positivos em
-- horários naturalmente vazios floodam o admin WhatsApp.
--
-- Novas colunas:
--   consecutive_anomaly_count — incrementa a cada tick com silêncio detectado.
--     Só agimos com count >= 2 (evita reação a janela quieta isolada).
--   last_state — 'ok' | 'recovered' | 'failed'. Notificação dispara só em
--     TRANSIÇÃO. 'recovered' repetido é suprimido. 'failed' repetido ainda
--     respeita cooldown de 2h (ação humana necessária).

CREATE TABLE IF NOT EXISTS watchdog_state (
  id text PRIMARY KEY,
  last_alert_at timestamptz
);

ALTER TABLE watchdog_state
  ADD COLUMN IF NOT EXISTS consecutive_anomaly_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_state text NOT NULL DEFAULT 'ok'
    CHECK (last_state IN ('ok','recovered','failed'));

-- Garante que a row de webhook_recovery existe (o código usa .update + .eq,
-- que silenciosamente no-opa quando a row não existe).
INSERT INTO watchdog_state (id, consecutive_anomaly_count, last_state)
VALUES ('webhook_recovery', 0, 'ok')
ON CONFLICT (id) DO NOTHING;
