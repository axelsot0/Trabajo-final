import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';

import { createRepositories, type Repositories } from '../../src/adapters/d1/index.ts';
import worker from '../../src/index.ts';
import { makeAccount } from '../support/fixtures.ts';
import {
  instagramPayload,
  messagingItem,
  signedMetaRequest,
  TEST_META_VERIFY_TOKEN,
} from '../support/meta-payloads.ts';

const IG_USER_ID = '17841400000000000';
const TS = 1_790_560_000_000;
const iso = (ms: number): string => new Date(ms).toISOString();
let repos: Repositories;

beforeEach(async () => {
  repos = createRepositories(env.DB);
  await repos.igAccounts.insert(makeAccount({ igUserId: IG_USER_ID }));
});

/** Ejecuta el handler directamente para poder esperar el trabajo de `waitUntil`. */
async function deliver(request: Request): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe('GET /webhooks/meta (verificación)', () => {
  it('devuelve el challenge con el token correcto', async () => {
    const url = new URL('https://example.com/webhooks/meta');
    url.searchParams.set('hub.mode', 'subscribe');
    url.searchParams.set('hub.verify_token', TEST_META_VERIFY_TOKEN);
    url.searchParams.set('hub.challenge', '123456');
    const res = await exports.default.fetch(url.toString());
    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toBe('123456');
  });

  it('rechaza token incorrecto y parámetros incompletos', async () => {
    const bad = new URL('https://example.com/webhooks/meta');
    bad.searchParams.set('hub.mode', 'subscribe');
    bad.searchParams.set('hub.verify_token', 'otro');
    bad.searchParams.set('hub.challenge', '1');
    expect((await exports.default.fetch(bad.toString())).status).toBe(403);

    const incomplete = new URL('https://example.com/webhooks/meta');
    incomplete.searchParams.set('hub.mode', 'subscribe');
    expect((await exports.default.fetch(incomplete.toString())).status).toBe(400);
  });
});

describe('POST /webhooks/meta (recepción)', () => {
  const item = (mid: string, text: string, timestamp = TS) =>
    messagingItem({ senderId: 'cliente-1', recipientId: IG_USER_ID, timestamp, mid, text });

  it('rechaza firma inválida o ausente sin persistir nada', async () => {
    const tampered = await signedMetaRequest(
      instagramPayload(IG_USER_ID, [item('mid.1', 'Hola')]),
      {
        tamperSignature: true,
      },
    );
    expect((await deliver(tampered)).status).toBe(401);

    const unsigned = new Request('https://example.com/webhooks/meta', {
      method: 'POST',
      body: JSON.stringify(instagramPayload(IG_USER_ID, [item('mid.1', 'Hola')])),
    });
    expect((await deliver(unsigned)).status).toBe(401);

    const wrongSecret = await signedMetaRequest(
      instagramPayload(IG_USER_ID, [item('mid.1', 'Hola')]),
      { secret: 'otro-secreto' },
    );
    expect((await deliver(wrongSecret)).status).toBe(401);

    expect(await repos.webhookEvents.countByStatus()).toMatchObject({ pending: 0, done: 0 });
  });

  it('con firma válida persiste el evento, crea cliente, conversación y mensaje', async () => {
    const res = await deliver(
      await signedMetaRequest(instagramPayload(IG_USER_ID, [item('mid.1', '¿Tienen stock?')])),
    );
    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toBe('EVENT_RECEIVED');

    const event = await repos.webhookEvents.findByKey('meta:mid.1');
    expect(event).toMatchObject({ provider: 'meta', processStatus: 'done', attempts: 1 });

    const message = await repos.messages.findByExternalId('mid.1');
    expect(message).toMatchObject({
      direction: 'inbound',
      origin: 'instagram',
      body: '¿Tienen stock?',
      contentType: 'text',
      providerTimestampUtc: iso(TS),
    });
    const conversation = await repos.conversations.findById(message?.conversationId ?? '');
    // AI_MODE=off en pruebas: la conversación pasa a humanos con el motivo correcto.
    expect(conversation).toMatchObject({
      mode: 'PENDING_HUMAN',
      modeReason: 'ai_mode_off',
      lastCustomerMessageAtUtc: iso(TS),
      version: 2,
    });
    const audit = await repos.audit.listForEntity('conversation', conversation?.id ?? '', 10);
    expect(audit.map((a) => a.action)).toEqual(['conversation.escalated']);
  });

  it('una entrega repetida de Meta no duplica eventos ni mensajes', async () => {
    const payload = instagramPayload(IG_USER_ID, [item('mid.dup', 'Hola')]);
    expect((await deliver(await signedMetaRequest(payload))).status).toBe(200);
    expect((await deliver(await signedMetaRequest(payload))).status).toBe(200);

    const { results } = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM messages WHERE external_message_id = 'mid.dup'`,
    ).all<{ n: number }>();
    expect(results[0]?.n).toBe(1);
    expect(await repos.webhookEvents.countByStatus()).toMatchObject({ done: 1, pending: 0 });
    const { results: convs } = await env.DB.prepare('SELECT COUNT(*) AS n FROM conversations').all<{
      n: number;
    }>();
    expect(convs[0]?.n).toBe(1);
  });

  it('descarta ecos propios y registra lecturas como ignoradas', async () => {
    const payload = instagramPayload(IG_USER_ID, [
      messagingItem({
        senderId: IG_USER_ID,
        recipientId: 'cliente-1',
        timestamp: 1_790_560_000_000,
        mid: 'mid.echo',
        text: 'Gracias por escribir',
        isEcho: true,
      }),
      {
        sender: { id: 'cliente-1' },
        recipient: { id: IG_USER_ID },
        timestamp: 1_790_560_001_000,
        read: { mid: 'mid.echo' },
      },
    ]);
    expect((await deliver(await signedMetaRequest(payload))).status).toBe(200);
    expect(await repos.webhookEvents.countByStatus()).toMatchObject({
      ignored: 2,
      pending: 0,
      done: 0,
    });
    await expect(repos.messages.findByExternalId('mid.echo')).resolves.toBeNull();
    expect((await repos.webhookEvents.findByKey('meta:mid.echo'))?.errorCode).toBe('echo');
  });

  it('procesa varios eventos de un mismo lote en una sola conversación por cliente', async () => {
    const payload = instagramPayload(IG_USER_ID, [
      item('mid.a', 'Hola', TS),
      item('mid.b', '¿Precio?', TS + 1000),
      messagingItem({
        senderId: 'cliente-2',
        recipientId: IG_USER_ID,
        timestamp: 1_790_560_002_000,
        mid: 'mid.c',
        text: 'Buenas',
      }),
    ]);
    expect((await deliver(await signedMetaRequest(payload))).status).toBe(200);
    expect(await repos.webhookEvents.countByStatus()).toMatchObject({ done: 3, pending: 0 });

    const a = await repos.messages.findByExternalId('mid.a');
    const b = await repos.messages.findByExternalId('mid.b');
    const c = await repos.messages.findByExternalId('mid.c');
    expect(a?.conversationId).toBe(b?.conversationId);
    expect(c?.conversationId).not.toBe(a?.conversationId);
    const conv = await repos.conversations.findById(a?.conversationId ?? '');
    expect(conv?.lastCustomerMessageAtUtc).toBe(iso(TS + 1000));
  });

  it('los adjuntos se registran con tipo y referencia y escalan a humano', async () => {
    const payload = instagramPayload(IG_USER_ID, [
      messagingItem({
        senderId: 'cliente-1',
        recipientId: IG_USER_ID,
        timestamp: 1_790_560_000_000,
        mid: 'mid.img',
        attachments: [{ type: 'image', url: 'https://cdn.example/x.jpg' }],
      }),
    ]);
    expect((await deliver(await signedMetaRequest(payload))).status).toBe(200);
    const message = await repos.messages.findByExternalId('mid.img');
    expect(message).toMatchObject({ contentType: 'image', body: null });
    expect(JSON.parse(message?.attachmentRef ?? '[]')).toEqual([
      { type: 'image', url: 'https://cdn.example/x.jpg' },
    ]);
    const conv = await repos.conversations.findById(message?.conversationId ?? '');
    expect(conv).toMatchObject({ mode: 'PENDING_HUMAN', modeReason: 'attachment' });
  });

  it('mensajes para una cuenta desconocida se ignoran sin crear datos', async () => {
    const payload = instagramPayload('999', [
      messagingItem({
        senderId: 'x',
        recipientId: '999',
        timestamp: 1,
        mid: 'mid.unk',
        text: 'hola',
      }),
    ]);
    expect((await deliver(await signedMetaRequest(payload))).status).toBe(200);
    expect((await repos.webhookEvents.findByKey('meta:mid.unk'))?.processStatus).toBe('ignored');
    expect((await repos.webhookEvents.findByKey('meta:mid.unk'))?.errorCode).toBe(
      'unknown_account',
    );
    await expect(repos.messages.findByExternalId('mid.unk')).resolves.toBeNull();
  });

  it('rechaza cuerpos demasiado grandes y JSON inválido', async () => {
    const huge = 'x'.repeat(256 * 1024 + 1);
    const tooLarge = await signedMetaRequest(null, { rawBody: huge });
    expect((await deliver(tooLarge)).status).toBe(413);

    const invalid = await signedMetaRequest(null, { rawBody: '{not json' });
    expect((await deliver(invalid)).status).toBe(400);
  });

  it('acepta payloads firmados con forma inesperada sin procesarlos', async () => {
    const res = await deliver(await signedMetaRequest({ object: 'page', entry: [] }));
    expect(res.status).toBe(200);
    expect(await repos.webhookEvents.countByStatus()).toMatchObject({
      pending: 0,
      done: 0,
      ignored: 0,
    });
  });
});
