-- Migración 0004: resultado comercial declarado al cerrar una conversación.
-- Es dato declarado por el agente, no prueba de pago (plan, sección 7).
CREATE TABLE outcomes (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  kind TEXT NOT NULL
    CHECK (kind IN ('venta_confirmada', 'sin_venta', 'seguimiento', 'no_determinado')),
  amount_minor INTEGER,
  currency TEXT CHECK (currency IS NULL OR length(currency) = 3),
  evidence_note TEXT,
  recorded_by TEXT NOT NULL REFERENCES employees(id),
  recorded_at_utc TEXT NOT NULL
);
CREATE INDEX idx_outcomes_conversation ON outcomes(conversation_id, recorded_at_utc);
CREATE INDEX idx_outcomes_kind_time ON outcomes(kind, recorded_at_utc);
