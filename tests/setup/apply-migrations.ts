import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach } from 'vitest';

// Cada archivo de prueba arranca con el esquema completo aplicado.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

// Esta versión del pool no aísla el almacenamiento por prueba, así que vaciamos las
// tablas antes de cada una: ninguna prueba depende del orden ni de restos de otra.
// El orden respeta las claves foráneas (hijas antes que padres); las tablas nuevas
// que no aparezcan aquí se vacían después, por lo que deben añadirse si tienen FK.
const deleteOrder = [
  'outcomes',
  'callback_tokens',
  'telegram_message_links',
  'outbox',
  'messages',
  'webhook_events',
  'audit_events',
  'conversations',
  'customers',
  'employees',
  'ig_accounts',
  'business_settings',
];

beforeEach(async () => {
  const { results } = await env.DB.prepare(
    `SELECT name FROM sqlite_master
     WHERE type = 'table'
       AND name NOT LIKE 'sqlite_%'
       AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\'
       AND name != 'd1_migrations'`,
  ).all<{ name: string }>();
  const existing = new Set(results.map((r) => r.name));
  const ordered = [
    ...deleteOrder.filter((name) => existing.has(name)),
    ...results.map((r) => r.name).filter((name) => !deleteOrder.includes(name)),
  ];
  if (ordered.length === 0) return;
  await env.DB.batch(ordered.map((name) => env.DB.prepare(`DELETE FROM "${name}"`)));
});
