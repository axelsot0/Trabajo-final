import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

describe('migraciones D1', () => {
  it('crea las tablas base con sus índices', async () => {
    const { results } = await env.DB.prepare(
      `SELECT name, type FROM sqlite_master WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    ).all<{ name: string; type: string }>();
    const tables = results.filter((r) => r.type === 'table').map((r) => r.name);
    expect(tables).toEqual(
      expect.arrayContaining([
        'ig_accounts',
        'employees',
        'customers',
        'conversations',
        'messages',
        'webhook_events',
        'outbox',
        'business_settings',
        'audit_events',
      ]),
    );
    const indexes = results.filter((r) => r.type === 'index').map((r) => r.name);
    expect(indexes).toEqual(
      expect.arrayContaining([
        'idx_conversations_mode_priority',
        'idx_conversations_last_message',
        'idx_conversations_customer_account',
        'idx_messages_provider_time',
        'idx_webhook_events_status_time',
        'idx_outbox_status_retry',
      ]),
    );
  });

  it('rechaza modos y prioridades fuera del dominio', async () => {
    await env.DB.prepare(
      `INSERT INTO ig_accounts (id, ig_user_id, created_at_utc) VALUES ('a', '1', '2026-01-01T00:00:00.000Z')`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO customers (id, ig_account_id, ig_scoped_id, created_at_utc) VALUES ('c', 'a', 'x', '2026-01-01T00:00:00.000Z')`,
    ).run();
    await expect(
      env.DB.prepare(
        `INSERT INTO conversations (id, ig_account_id, customer_id, mode, opened_at_utc)
         VALUES ('conv', 'a', 'c', 'INVENTADO', '2026-01-01T00:00:00.000Z')`,
      ).run(),
    ).rejects.toThrow(/CHECK/);
  });
});
