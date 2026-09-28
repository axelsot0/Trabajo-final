import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';

import { createRepositories, type Repositories } from '../../../src/adapters/d1/index.ts';
import { transition } from '../../../src/domain/conversation.ts';
import { makeEmployee, seedConversation, T0 } from '../../support/fixtures.ts';

let repos: Repositories;

beforeEach(() => {
  repos = createRepositories(env.DB);
});

describe('D1ConversationRepository.claim', () => {
  it('de dos agentes que toman a la vez, exactamente uno gana', async () => {
    const { conversation } = await seedConversation(repos, 'PENDING_HUMAN');
    const a = makeEmployee(1001);
    const b = makeEmployee(1002);
    await repos.employees.insert(a);
    await repos.employees.insert(b);

    const [ra, rb] = await Promise.all([
      repos.conversations.claim(conversation.id, a.id, T0),
      repos.conversations.claim(conversation.id, b.id, T0),
    ]);

    const winners = [ra, rb].filter((r) => r.ok);
    const losers = [ra, rb].filter((r) => !r.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0]).toEqual({ ok: false, reason: 'not_pending' });

    const stored = await repos.conversations.findById(conversation.id);
    expect(stored?.mode).toBe('HUMAN');
    expect([a.id, b.id]).toContain(stored?.assignedEmployeeId);
    expect(stored?.version).toBe(conversation.version + 1);
  });

  it('no toma conversaciones que no están pendientes', async () => {
    const { conversation } = await seedConversation(repos, 'BOT');
    const agent = makeEmployee(1003);
    await repos.employees.insert(agent);
    await expect(repos.conversations.claim(conversation.id, agent.id, T0)).resolves.toEqual({
      ok: false,
      reason: 'not_pending',
    });
    await expect(repos.conversations.claim('no-existe', agent.id, T0)).resolves.toEqual({
      ok: false,
      reason: 'not_found',
    });
  });
});

describe('D1ConversationRepository.applyModeChange', () => {
  it('aplica el cambio solo con la versión esperada e incrementa la versión', async () => {
    const { conversation } = await seedConversation(repos, 'BOT');
    const change = transition(conversation, { type: 'escalate', reason: 'requested_human' });

    await expect(
      repos.conversations.applyModeChange(conversation.id, conversation.version, change, T0),
    ).resolves.toBe(true);
    // Un trabajo atrasado con la versión vieja se descarta.
    await expect(
      repos.conversations.applyModeChange(conversation.id, conversation.version, change, T0),
    ).resolves.toBe(false);

    const stored = await repos.conversations.findById(conversation.id);
    expect(stored).toMatchObject({
      mode: 'PENDING_HUMAN',
      modeReason: 'requested_human',
      version: 2,
      closedAtUtc: null,
    });
  });

  it('cerrar registra closed_at_utc y libera la asignación', async () => {
    const { conversation } = await seedConversation(repos, 'PENDING_HUMAN');
    const agent = makeEmployee(1004);
    await repos.employees.insert(agent);
    const claimed = await repos.conversations.claim(conversation.id, agent.id, T0);
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;

    const change = transition(claimed.conversation, { type: 'close', employeeId: agent.id });
    const closedAt = '2026-09-27T15:00:00.000Z';
    await expect(
      repos.conversations.applyModeChange(
        conversation.id,
        claimed.conversation.version,
        change,
        closedAt,
      ),
    ).resolves.toBe(true);
    const stored = await repos.conversations.findById(conversation.id);
    expect(stored).toMatchObject({
      mode: 'CLOSED',
      assignedEmployeeId: null,
      closedAtUtc: closedAt,
    });
    await expect(
      repos.conversations.findOpenByCustomer(conversation.customerId),
    ).resolves.toBeNull();
  });
});

describe('ventana y orden de cola', () => {
  it('touchCustomerMessage solo avanza, nunca retrocede la ventana', async () => {
    const { conversation } = await seedConversation(repos, 'BOT', {
      lastCustomerMessageAtUtc: T0,
      lastMessageAtUtc: T0,
    });
    const later = '2026-09-27T16:00:00.000Z';
    const earlier = '2026-09-27T13:00:00.000Z';
    await repos.conversations.touchCustomerMessage(conversation.id, later);
    await repos.conversations.touchCustomerMessage(conversation.id, earlier);
    const stored = await repos.conversations.findById(conversation.id);
    expect(stored?.lastCustomerMessageAtUtc).toBe(later);
    expect(stored?.lastMessageAtUtc).toBe(later);

    await repos.conversations.touchOutbound(conversation.id, '2026-09-27T17:00:00.000Z');
    const afterOutbound = await repos.conversations.findById(conversation.id);
    expect(afterOutbound?.lastCustomerMessageAtUtc).toBe(later);
    expect(afterOutbound?.lastMessageAtUtc).toBe('2026-09-27T17:00:00.000Z');
  });

  it('listByMode ordena por prioridad y antigüedad', async () => {
    const low = await seedConversation(repos, 'PENDING_HUMAN', {
      priority: 'baja',
      lastCustomerMessageAtUtc: '2026-09-27T10:00:00.000Z',
    });
    const highNew = await seedConversation(repos, 'PENDING_HUMAN', {
      priority: 'alta',
      lastCustomerMessageAtUtc: '2026-09-27T12:00:00.000Z',
    });
    const highOld = await seedConversation(repos, 'PENDING_HUMAN', {
      priority: 'alta',
      lastCustomerMessageAtUtc: '2026-09-27T11:00:00.000Z',
    });
    await seedConversation(repos, 'BOT');

    const queue = await repos.conversations.listByMode('PENDING_HUMAN', 10, 0);
    expect(queue.map((c) => c.id)).toEqual([
      highOld.conversation.id,
      highNew.conversation.id,
      low.conversation.id,
    ]);
    const page2 = await repos.conversations.listByMode('PENDING_HUMAN', 2, 2);
    expect(page2.map((c) => c.id)).toEqual([low.conversation.id]);
  });
});
