import { env, exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';

import { createRepositories, type Repositories } from '../../src/adapters/d1/index.ts';
import { makeEmployee } from '../support/fixtures.ts';
import { telegramRequest, textUpdate } from '../support/telegram-updates.ts';

let repos: Repositories;

beforeEach(async () => {
  repos = createRepositories(env.DB);
  await repos.employees.insert(makeEmployee(7001));
});

describe('POST /webhooks/telegram', () => {
  it('rechaza sin el secreto de cabecera correcto', async () => {
    const wrong = await exports.default.fetch(
      telegramRequest(textUpdate({ fromId: 7001, text: '/start' }), 'otro'),
    );
    expect(wrong.status).toBe(401);
    const missing = new Request('https://example.com/webhooks/telegram', {
      method: 'POST',
      body: JSON.stringify(textUpdate({ fromId: 7001, text: '/start' })),
    });
    expect((await exports.default.fetch(missing)).status).toBe(401);
    expect(await repos.webhookEvents.countByStatus()).toMatchObject({ pending: 0, done: 0 });
  });

  it('persiste el update con clave idempotente y lo procesa antes de responder', async () => {
    // Un update de otro bot no dispara llamadas a la Bot API real (no hay red en pruebas)
    // pero recorre todo el camino: firma, persistencia, procesamiento y resultado.
    const update = textUpdate({ fromId: 7001, text: '/start', isBot: true });
    const res = await exports.default.fetch(telegramRequest(update));
    expect(res.status).toBe(200);
    const key = `telegram:${String(update['update_id'])}`;
    const event = await repos.webhookEvents.findByKey(key);
    expect(event).toMatchObject({
      provider: 'telegram',
      processStatus: 'ignored',
      errorCode: 'ignored_bot',
    });

    // Reentrega del mismo update_id: no crea otro evento.
    expect((await exports.default.fetch(telegramRequest(update))).status).toBe(200);
    const { results } = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM webhook_events WHERE external_event_key = ?1',
    )
      .bind(key)
      .all<{ n: number }>();
    expect(results[0]?.n).toBe(1);
  });

  it('rechaza JSON inválido y updates sin forma reconocible', async () => {
    const bad = new Request('https://example.com/webhooks/telegram', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': 'test-telegram-webhook-secret' },
      body: '{nope',
    });
    expect((await exports.default.fetch(bad)).status).toBe(400);
    expect((await exports.default.fetch(telegramRequest({ hello: 1 }))).status).toBe(400);
  });
});
