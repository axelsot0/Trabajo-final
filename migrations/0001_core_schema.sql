-- Migración 0001: esquema base de atención.
-- Convenciones: IDs TEXT (UUID), marcas de tiempo TEXT ISO 8601 en UTC con sufijo
-- `_utc`, booleanos INTEGER 0/1. Sin tokens ni PII innecesaria.

PRAGMA foreign_keys = ON;

CREATE TABLE ig_accounts (
  id TEXT PRIMARY KEY,
  ig_user_id TEXT NOT NULL UNIQUE,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled', 'token_invalid')),
  -- Nombre del secreto del Worker que contiene el token; nunca el token.
  token_reference TEXT NOT NULL DEFAULT 'META_ACCESS_TOKEN',
  -- Solo si Meta habilitó la etiqueta HUMAN_AGENT para esta app (ADR 0002).
  human_agent_enabled INTEGER NOT NULL DEFAULT 0 CHECK (human_agent_enabled IN (0, 1)),
  last_token_check_at_utc TEXT,
  created_at_utc TEXT NOT NULL
);

CREATE TABLE employees (
  id TEXT PRIMARY KEY,
  telegram_user_id INTEGER NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'agent', 'viewer')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  -- Chat privado con el bot; se rellena cuando el empleado envía /start.
  telegram_chat_id INTEGER,
  created_at_utc TEXT NOT NULL
);

CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  ig_account_id TEXT NOT NULL REFERENCES ig_accounts(id),
  -- Identificador con alcance de Instagram (IGSID). El username no es estable.
  ig_scoped_id TEXT NOT NULL,
  display_name TEXT,
  created_at_utc TEXT NOT NULL,
  UNIQUE (ig_account_id, ig_scoped_id)
);

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  ig_account_id TEXT NOT NULL REFERENCES ig_accounts(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  mode TEXT NOT NULL CHECK (mode IN ('BOT', 'PENDING_HUMAN', 'HUMAN', 'CLOSED')),
  mode_reason TEXT,
  assigned_employee_id TEXT REFERENCES employees(id),
  priority TEXT NOT NULL DEFAULT 'media' CHECK (priority IN ('alta', 'media', 'baja')),
  intent TEXT,
  stage TEXT,
  -- Se incrementa en cada cambio de modo/asignación; los trabajos diferidos la
  -- comparan para descartarse si la conversación cambió (ADR 0006).
  version INTEGER NOT NULL DEFAULT 1,
  last_customer_message_at_utc TEXT,
  last_message_at_utc TEXT,
  opened_at_utc TEXT NOT NULL,
  closed_at_utc TEXT
);
CREATE INDEX idx_conversations_mode_priority ON conversations(mode, priority);
CREATE INDEX idx_conversations_last_message ON conversations(last_message_at_utc);
CREATE INDEX idx_conversations_customer_account ON conversations(customer_id, ig_account_id);
CREATE INDEX idx_conversations_assigned ON conversations(assigned_employee_id);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  -- `mid` de Meta para entrantes y salientes confirmados; único para deduplicar.
  external_message_id TEXT UNIQUE,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  origin TEXT NOT NULL CHECK (origin IN ('instagram', 'telegram', 'ai', 'system')),
  sender_employee_id TEXT REFERENCES employees(id),
  body TEXT,
  content_type TEXT NOT NULL DEFAULT 'text',
  -- Referencia opaca al adjunto (tipo/URL temporal). Nunca se descarga el medio.
  attachment_ref TEXT,
  provider_timestamp_utc TEXT,
  ingested_at_utc TEXT NOT NULL,
  delivery_status TEXT NOT NULL DEFAULT 'received'
    CHECK (delivery_status IN ('received', 'queued', 'sent', 'failed', 'uncertain')),
  reply_to_message_id TEXT REFERENCES messages(id)
);
CREATE INDEX idx_messages_conversation_time ON messages(conversation_id, provider_timestamp_utc);
CREATE INDEX idx_messages_provider_time ON messages(provider_timestamp_utc);

CREATE TABLE webhook_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('meta', 'telegram')),
  external_event_key TEXT NOT NULL UNIQUE,
  received_at_utc TEXT NOT NULL,
  process_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (process_status IN ('pending', 'processing', 'done', 'failed', 'ignored')),
  attempts INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  -- Payload mínimo necesario para reprocesar; retención corta (data-policy).
  payload_minimal TEXT NOT NULL,
  processed_at_utc TEXT
);
CREATE INDEX idx_webhook_events_status_time ON webhook_events(process_status, received_at_utc);

CREATE TABLE outbox (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  message_id TEXT REFERENCES messages(id),
  operation TEXT NOT NULL,
  payload_minimal TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_flight', 'sent', 'failed', 'uncertain', 'cancelled')),
  retry_at_utc TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  remote_message_id TEXT,
  -- Versión de la conversación al encolar; si cambió, el trabajo se descarta.
  conversation_version INTEGER NOT NULL,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL
);
CREATE INDEX idx_outbox_status_retry ON outbox(status, retry_at_utc);

CREATE TABLE business_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('employee', 'system', 'ai', 'customer')),
  actor_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_redacted TEXT,
  after_redacted TEXT,
  at_utc TEXT NOT NULL
);
CREATE INDEX idx_audit_entity ON audit_events(entity_type, entity_id, at_utc);
