-- Migración 0003: enlaces de mensajes de Telegram y tokens opacos de botones.

-- Cada tarjeta o aviso que el bot envía queda enlazado a su conversación. El agente
-- responde con Reply a ese mensaje y el destino se resuelve aquí, nunca por "chat activo".
CREATE TABLE telegram_message_links (
  telegram_chat_id INTEGER NOT NULL,
  telegram_message_id INTEGER NOT NULL,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  kind TEXT NOT NULL CHECK (kind IN ('card', 'notification', 'list')),
  created_at_utc TEXT NOT NULL,
  PRIMARY KEY (telegram_chat_id, telegram_message_id)
);
CREATE INDEX idx_telegram_links_conversation ON telegram_message_links(conversation_id);

-- Los botones inline llevan un token corto y opaco (callback_data ≤ 64 bytes). El
-- Worker valida agente, caducidad y uso antes de actuar.
CREATE TABLE callback_tokens (
  token TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  conversation_id TEXT REFERENCES conversations(id),
  action TEXT NOT NULL,
  params TEXT,
  single_use INTEGER NOT NULL DEFAULT 1 CHECK (single_use IN (0, 1)),
  expires_at_utc TEXT NOT NULL,
  used_at_utc TEXT,
  created_at_utc TEXT NOT NULL
);
CREATE INDEX idx_callback_tokens_expires ON callback_tokens(expires_at_utc);
