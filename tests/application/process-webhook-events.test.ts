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
