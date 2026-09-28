import {
  createScheduledController,
  waitOnExecutionContext,
  createExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';

import { createRepositories, type Repositories } from '../../src/adapters/d1/index.ts';
import { createContainer } from '../../src/container.ts';
import { newId } from '../../src/domain/ids.ts';
import worker from '../../src/index.ts';
import { makeAccount, T0 } from '../support/fixtures.ts';

const IG_USER_ID = '17841400000000000';
let repos: Repositories;

beforeEach(async () => {
  repos = createRepositories(env.DB);
  await repos.igAccounts.insert(makeAccount({ igUserId: IG_USER_ID }));
});

function pendingMessageEvent(mid: string, receivedAtUtc = T0) {
  return {
    id: newId(),
    provider: 'meta' as const,
    externalEventKey: `meta:${mid}`,
    receivedAtUtc,
    processStatus: 'pending' as const,
    attempts: 0,
    errorCode: null,
    payloadMinimal: JSON.stringify({
      kind: 'message',
      igAccountUserId: IG_USER_ID,
      senderScopedId: 'cliente-1',
      mid,
      timestampMs: 1_790_560_000_000,
      text: 'Hola',
      attachments: [],
      isUnsupported: false,
      isDeleted: false,
      replyToMid: null,
    }),
    processedAtUtc: null,
  };
}

describe('ProcessPendingWebhookEvents', () => {
  it('dos barridos concurrentes no procesan el mismo evento dos veces', async () => {
    for (let i = 0; i < 6; i += 1)
      await repos.webhookEvents.insertIfNew(pendingMessageEvent(`mid.${i}`));
    const container = createContainer(env);
    const [a, b] = await Promise.all([
      container.processPendingWebhookEvents.run(4),
      container.processPendingWebhookEvents.run(4),
    ]);
    expect(a.claimed + b.claimed).toBe(6);
    expect(a.done + b.done).toBe(6);
    expect(await repos.webhookEvents.countByStatus()).toMatchObject({
      done: 6,
      pending: 0,
      processing: 0,
    });
    const { results } = await env.DB.prepare('SELECT COUNT(*) AS n FROM messages').all<{
      n: number;
    }>();
    expect(results[0]?.n).toBe(6);
  });

  it('un payload corrupto se marca failed sin reintentos infinitos', async () => {
    await repos.webhookEvents.insertIfNew({
      ...pendingMessageEvent('mid.bad'),
      payloadMinimal: '{"kind":"message"}',
    });
    const summary = await createContainer(env).processPendingWebhookEvents.run();
    expect(summary).toMatchObject({ claimed: 1, failed: 1 });
    expect((await repos.webhookEvents.findByKey('meta:mid.bad'))?.processStatus).toBe('failed');
  });

  it('el cron libera eventos atascados en processing y los procesa', async () => {
    const stale = {
      ...pendingMessageEvent('mid.stuck', '2026-09-20T00:00:00.000Z'),
      processStatus: 'processing' as const,
      attempts: 1,
    };
    await repos.webhookEvents.insertIfNew(stale);
    const ctx = createExecutionContext();
    worker.scheduled(createScheduledController({ cron: '*/5 * * * *' }), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(await repos.webhookEvents.findByKey('meta:mid.stuck')).toMatchObject({
      processStatus: 'done',
      attempts: 2,
    });
    await expect(repos.messages.findByExternalId('mid.stuck')).resolves.not.toBeNull();
  });
});

describe('ecos', () => {
  function echoEvent(mid: string, recipientScopedId: string, text: string) {
    return {
      id: newId(),
      provider: 'meta' as const,
      externalEventKey: `meta:${mid}`,
      receivedAtUtc: T0,
      processStatus: 'pending' as const,
      attempts: 0,
      errorCode: null,
      payloadMinimal: JSON.stringify({
        kind: 'echo',
        igAccountUserId: IG_USER_ID,
        recipientScopedId,
        mid,
        timestampMs: 1_790_560_005_000,
        text,
      }),
      processedAtUtc: null,
    };
  }

  it('un eco confirma un envío propio con acuse incierto', async () => {
    const container = createContainer(env);
    await repos.webhookEvents.insertIfNew(pendingMessageEvent('mid.in'));
    await container.processPendingWebhookEvents.run();
    const inbound = await repos.messages.findByExternalId('mid.in');
    const conversationId = inbound?.conversationId ?? '';
    await env.DB.prepare(
      `INSERT INTO messages (id, conversation_id, direction, origin, body, content_type, ingested_at_utc, delivery_status)
       VALUES ('m-out', ?1, 'outbound', 'telegram', 'Respuesta', 'text', ?2, 'uncertain')`,
    )
      .bind(conversationId, T0)
      .run();
    await env.DB.prepare(
      `INSERT INTO outbox (id, conversation_id, message_id, operation, payload_minimal, status, attempts, conversation_version, created_at_utc, updated_at_utc)
       VALUES ('o-1', ?1, 'm-out', 'instagram.send_text', '{}', 'uncertain', 1, 1, ?2, ?2)`,
    )
      .bind(conversationId, T0)
      .run();

    await repos.webhookEvents.insertIfNew(echoEvent('mid.echo', 'cliente-1', 'Respuesta'));
    const summary = await container.processPendingWebhookEvents.run();
    expect(summary).toMatchObject({ done: 1 });
    expect(await repos.messages.findById('m-out')).toMatchObject({
      deliveryStatus: 'sent',
      externalMessageId: 'mid.echo',
    });
    expect(await repos.outbox.findById('o-1')).toMatchObject({
      status: 'sent',
      remoteMessageId: 'mid.echo',
    });
  });

  it('un eco sin envío propio registra la respuesta hecha desde la app de Instagram', async () => {
    const container = createContainer(env);
    await repos.webhookEvents.insertIfNew(pendingMessageEvent('mid.in2'));
    await container.processPendingWebhookEvents.run();
    await repos.webhookEvents.insertIfNew(
      echoEvent('mid.app', 'cliente-1', 'Respondido desde el móvil'),
    );
    await container.processPendingWebhookEvents.run();
    const recorded = await repos.messages.findByExternalId('mid.app');
    expect(recorded).toMatchObject({
      direction: 'outbound',
      origin: 'instagram',
      deliveryStatus: 'sent',
      body: 'Respondido desde el móvil',
    });
    const conversation = await repos.conversations.findById(recorded?.conversationId ?? '');
    expect(conversation?.lastMessageAtUtc).toBe(new Date(1_790_560_005_000).toISOString());
    expect(conversation?.lastCustomerMessageAtUtc).toBe(new Date(1_790_560_000_000).toISOString());
  });

  it('un eco para un cliente sin conversación se ignora con motivo', async () => {
    const container = createContainer(env);
    await repos.webhookEvents.insertIfNew(echoEvent('mid.orphan', 'desconocido', 'x'));
    expect(await container.processPendingWebhookEvents.run()).toMatchObject({ ignored: 1 });
    expect((await repos.webhookEvents.findByKey('meta:mid.orphan'))?.errorCode).toBe(
      'echo_no_conversation',
    );
  });
});
