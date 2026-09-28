import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { createRepositories } from '../../../src/adapters/d1/index.ts';
import { newId } from '../../../src/domain/ids.ts';
import type { OutboxItem } from '../../../src/domain/outbox.ts';
import { seedConversation, T0 } from '../../support/fixtures.ts';

function item(conversationId: string, overrides: Partial<OutboxItem> = {}): OutboxItem {
  return {
    id: newId(),
    conversationId,
    messageId: null,
    operation: 'instagram.send_text',
    payloadMinimal: '{}',
    status: 'pending',
    retryAtUtc: null,
    attempts: 0,
    lastErrorCode: null,
    remoteMessageId: null,
    conversationVersion: 1,
    createdAtUtc: T0,
    updatedAtUtc: T0,
    ...overrides,
  };
}

describe('D1OutboxRepository.claimDue', () => {
  it('dos despachos concurrentes no reclaman el mismo elemento', async () => {
    const repos = createRepositories(env.DB);
    const { conversation } = await seedConversation(repos, 'HUMAN');
    for (let i = 0; i < 5; i += 1) await repos.outbox.enqueue(item(conversation.id));

    const [a, b] = await Promise.all([repos.outbox.claimDue(T0, 3), repos.outbox.claimDue(T0, 3)]);
    const ids = [...a, ...b].map((i) => i.id);
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
    expect([...a, ...b].every((i) => i.status === 'in_flight' && i.attempts === 1)).toBe(true);
    expect(await repos.outbox.countByStatus()).toMatchObject({ pending: 0, in_flight: 5 });
  });

  it('respeta retry_at_utc: solo reclama lo vencido', async () => {
    const repos = createRepositories(env.DB);
    const { conversation } = await seedConversation(repos, 'HUMAN');
    const due = item(conversation.id, { retryAtUtc: '2026-09-27T13:00:00.000Z' });
    const future = item(conversation.id, { retryAtUtc: '2026-09-27T15:00:00.000Z' });
    await repos.outbox.enqueue(due);
    await repos.outbox.enqueue(future);

    const claimed = await repos.outbox.claimDue(T0, 10);
    expect(claimed.map((i) => i.id)).toEqual([due.id]);
    const later = await repos.outbox.claimDue('2026-09-27T15:00:00.000Z', 10);
    expect(later.map((i) => i.id)).toEqual([future.id]);
  });

  it('listUncertain solo devuelve elementos inciertos con antigüedad suficiente', async () => {
    const repos = createRepositories(env.DB);
    const { conversation } = await seedConversation(repos, 'HUMAN');
    const old = item(conversation.id, {
      status: 'uncertain',
      updatedAtUtc: '2026-09-27T13:00:00.000Z',
    });
    const fresh = item(conversation.id, {
      status: 'uncertain',
      updatedAtUtc: '2026-09-27T14:59:00.000Z',
    });
    const sent = item(conversation.id, {
      status: 'sent',
      updatedAtUtc: '2026-09-27T13:00:00.000Z',
    });
    for (const i of [old, fresh, sent]) await repos.outbox.enqueue(i);
    const found = await repos.outbox.listUncertain('2026-09-27T14:00:00.000Z', 10);
    expect(found.map((i) => i.id)).toEqual([old.id]);
  });
});
