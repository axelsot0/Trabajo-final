-- Catálogo aprobado, triaje y registro de decisiones de IA (pasos 7 y 8 del plan).

-- Única fuente de verdad para precios y existencias que la IA puede afirmar.
CREATE TABLE catalog_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  currency TEXT NOT NULL,
  -- Precio unitario de lista (compra de 1). Unidades menores: RD$21,000 = 2100000.
  list_unit_price_minor INTEGER NOT NULL CHECK (list_unit_price_minor > 0),
  -- Tramos por volumen aprobados: [{"minQty":3,"unitPriceMinor":1800000}, ...].
  volume_tiers_json TEXT NOT NULL DEFAULT '[]',
  -- Piso para negociación humana. Nunca se envía a la IA.
  min_unit_price_minor INTEGER,
  quantity_available INTEGER NOT NULL CHECK (quantity_available >= 0),
  -- Desde esta cantidad la compra se deriva a un humano (la IA solo informa la oferta).
  handoff_min_qty INTEGER NOT NULL DEFAULT 3,
  -- Hechos aprobados adicionales que la IA puede afirmar: ["2 meses de nacidos", ...].
  facts_json TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1,
  updated_at_utc TEXT NOT NULL
);

CREATE TABLE triage_events (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  message_id TEXT REFERENCES messages(id),
  intent TEXT,
  stage TEXT,
  priority TEXT NOT NULL CHECK (priority IN ('alta', 'media', 'baja')),
  needs_human INTEGER NOT NULL CHECK (needs_human IN (0, 1)),
  reason_code TEXT,
  source TEXT NOT NULL CHECK (source IN ('ai', 'rule', 'human')),
  confidence REAL,
  model_version TEXT,
  created_at_utc TEXT NOT NULL
);
CREATE INDEX idx_triage_conversation ON triage_events(conversation_id, created_at_utc);

-- Una fila por mensaje disparador: la inserción actúa como reclamo idempotente para
-- que `waitUntil` y el cron nunca generen dos respuestas al mismo mensaje.
CREATE TABLE ai_replies (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  trigger_message_id TEXT NOT NULL UNIQUE REFERENCES messages(id),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'escalated', 'skipped', 'error')),
  decision_code TEXT,
  provider TEXT,
  model TEXT,
  prompt_version TEXT,
  catalog_version INTEGER,
  proposed_text TEXT,
  reply_message_id TEXT REFERENCES messages(id),
  confidence REAL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  latency_ms INTEGER,
  -- Cuenta para el cupo diario solo si se llamó al proveedor.
  provider_called INTEGER NOT NULL DEFAULT 0 CHECK (provider_called IN (0, 1)),
  created_at_utc TEXT NOT NULL,
  finished_at_utc TEXT
);
CREATE INDEX idx_ai_replies_created ON ai_replies(created_at_utc);
CREATE INDEX idx_ai_replies_status ON ai_replies(status, created_at_utc);
