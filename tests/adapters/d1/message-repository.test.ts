import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { createRepositories } from '../../../src/adapters/d1/index.ts';
import { makeInboundMessage, seedConversation } from '../../support/fixtures.ts';

describe('D1MessageRepository', () => {
  it('insertIfNew deduplica por external_message_id', async () => {
    const repos = createRepositories(env.DB);
    const { conversation } = await seedConversation(repos, 'BOT');
    const first = makeInboundMessage(conversation.id, 'mid.ABC');
    const duplicate = makeInboundMessage(conversation.id, 'mid.ABC', { body: 'reintento de Meta' });

    await expect(repos.messages.insertIfNew(first)).resolves.toEqual({ inserted: true });
    await expect(repos.messages.insertIfNew(duplicate)).resolves.toEqual({ inserted: false });

    const stored = await repos.messages.findByExternalId('mid.ABC');
    expect(stored?.id).toBe(first.id);
    expect(stored?.body).toBe(first.body);
  });

  it('listRecent devuelve en orden cronológico ascendente y respeta el límite', async () => {
    const repos = createRepositories(env.DB);
    const { conversation } = await seedConversation(repos, 'BOT');
    for (let i = 0; i < 5; i += 1) {
      await repos.messages.insert(
        makeInboundMessage(conversation.id, `mid.${i}`, {
          body: `m${i}`,
          providerTimestampUtc: `2026-09-27T14:0${i}:00.000Z`,
        }),
      );
    }
    const recent = await repos.messages.listRecent(conversation.id, 3);
    expect(recent.map((m) => m.body)).toEqual(['m2', 'm3', 'm4']);
  });
});
