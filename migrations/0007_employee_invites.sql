-- Invitaciones de un solo uso para dar de alta agentes desde Telegram (/invitar).
CREATE TABLE employee_invites (
  code TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('owner', 'agent', 'viewer')),
  created_by_employee_id TEXT NOT NULL REFERENCES employees(id),
  created_at_utc TEXT NOT NULL,
  expires_at_utc TEXT NOT NULL,
  used_at_utc TEXT,
  used_by_employee_id TEXT REFERENCES employees(id)
);
CREATE INDEX idx_employee_invites_expires ON employee_invites(expires_at_utc);
