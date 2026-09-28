-- Migración 0002: a lo sumo una conversación abierta por cliente.
-- Dos eventos del mismo cliente procesados en paralelo no deben abrir dos ciclos de
-- atención; el índice parcial convierte la carrera en un `INSERT OR IGNORE` seguro.
CREATE UNIQUE INDEX idx_conversations_one_open_per_customer
  ON conversations(customer_id)
  WHERE mode != 'CLOSED';
