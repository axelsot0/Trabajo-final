import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Repositories } from '../../src/adapters/d1/index.ts';
import { FakeInstagramGateway } from '../../src/adapters/meta/fake-instagram-gateway.ts';
import { createContainer, type Container } from '../../src/container.ts';
import { STANDARD_WINDOW_MS } from '../../src/domain/messaging-window.ts';
import type { Clock } from '../../src/ports/clock.ts';
import { makeEmployee, seedConversation, T0 } from '../support/fixtures.ts';

class FixedClock implements Clock {
  constructor(public current: Date) {}
  now(): Date {
    return this.current;
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

let gateway: FakeInstagramGateway;
let clock: FixedClock;
let container: Container;
let repos: Repositories;

beforeEach(() => {
  gateway = new FakeInstagramGateway();
  clock = new FixedClock(new Date(T0));
  container = createContainer(env, { instagramGateway: gateway, clock });
  repos = container.repos;
});

async function seedHumanConversation() {
  const agent = makeEmployee(5001);
  await repos.employees.insert(agent);
  const seeded = await seedConversation(repos, 'HUMAN', { assignedEmployeeId: agent.id });
  return { ...seeded, agent };
}

describe('QueueOutboundText', () => {
  it('encola un mensaje del agente asignado en estado queued', async () => {
    const { conversation, agent } = await seedHumanConversation();
    const result = await container.queueOutboundText.execute({
      conversationId: conversation.id,
      text: '  Sí, tenemos disponible.  ',
      senderKind: 'human',
      senderEmployeeId: agent.id,
      origin: 'telegram',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const message = await repos.messages.findById(result.messageId);
    expect(message).toMatchObject({
      direction: 'outbound',
      origin: 'telegram',
      body: 'Sí, tenemos disponible.',
      deliveryStatus: 'queued',
      senderEmployeeId: agent.id,
    });
    const item = await repos.outbox.findById(result.outboxId);
    expect(item).toMatchObject({ status: 'pending', conversationVersion: conversation.version });
  });

  it('rechaza a quien no está asignado, a la IA fuera de BOT, textos vacíos y ventana vencida', async () => {
    const { conversation, agent } = await seedHumanConversation();
    const other = makeEmployee(5002);
    await repos.employees.insert(other);

    await expect(
      container.queueOutboundText.execute({
        conversationId: conversation.id,
        text: 'hola',
        senderKind: 'human',
        senderEmployeeId: other.id,
        origin: 'telegram',
      }),
    ).resolves.toEqual({ ok: false, reason: 'not_allowed' });

    await expect(
      container.queueOutboundText.execute({
        conversationId: conversation.id,
        text: 'hola',
        senderKind: 'ai',
        senderEmployeeId: null,
        origin: 'ai',
      }),
    ).resolves.toEqual({ ok: false, reason: 'not_allowed' });

    await expect(
      container.queueOutboundText.execute({
        conversationId: conversation.id,
        text: '   ',
        senderKind: 'human',
        senderEmployeeId: agent.id,
        origin: 'telegram',
      }),
    ).resolves.toEqual({ ok: false, reason: 'empty_text' });

    clock.advance(STANDARD_WINDOW_MS);
    await expect(
      container.queueOutboundText.execute({
        conversationId: conversation.id,
        text: 'hola',
        senderKind: 'human',
        senderEmployeeId: agent.id,
        origin: 'telegram',
      }),
    ).resolves.toEqual({ ok: false, reason: 'window_expired' });
    expect(await repos.outbox.countByStatus()).toMatchObject({ pending: 0 });
  });
});

describe('DispatchOutbox', () => {
  it('envía por el gateway y confirma mensaje, outbox y actividad de la conversación', async () => {
    const { conversation, customer, account, agent } = await seedHumanConversation();
    const queued = await container.queueOutboundText.execute({
      conversationId: conversation.id,
      text: 'Claro, te confirmo.',
      senderKind: 'human',
      senderEmployeeId: agent.id,
      origin: 'telegram',
    });
    if (!queued.ok) throw new Error('no se encoló');

    clock.advance(1000);
    const summary = await container.dispatchOutbox.run();
    expect(summary.results.map((r) => r.outcome)).toEqual(['sent']);

    expect(gateway.sent).toEqual([
      {
        igUserId: account.igUserId,
        tokenReference: 'META_ACCESS_TOKEN',
        recipientId: customer.igScopedId,
        text: 'Claro, te confirmo.',
        humanAgentTag: false,
      },
    ]);
    expect(await repos.messages.findById(queued.messageId)).toMatchObject({
      deliveryStatus: 'sent',
      externalMessageId: 'mid.fake.1',
    });
    expect(await repos.outbox.findById(queued.outboxId)).toMatchObject({
      status: 'sent',
      remoteMessageId: 'mid.fake.1',
      attempts: 1,
    });
    const stored = await repos.conversations.findById(conversation.id);
    expect(stored?.lastMessageAtUtc).toBe(clock.now().toISOString());
    expect(stored?.lastCustomerMessageAtUtc).toBe(T0); // la ventana no se toca al enviar
  });

  it('cancela si la ventana venció entre encolar y despachar, sin llamar a Meta', async () => {
    const { conversation, agent } = await seedHumanConversation();
    const queued = await container.queueOutboundText.execute({
      conversationId: conversation.id,
      text: 'Tarde',
      senderKind: 'human',
      senderEmployeeId: agent.id,
      origin: 'telegram',
    });
    if (!queued.ok) throw new Error('no se encoló');
    clock.advance(STANDARD_WINDOW_MS + 1);

    const summary = await container.dispatchOutbox.run();
    expect(summary.results[0]).toMatchObject({ outcome: 'cancelled', code: 'window_expired' });
    expect(gateway.sent).toHaveLength(0);
    expect(await repos.messages.findById(queued.messageId)).toMatchObject({
      deliveryStatus: 'failed',
    });
    const audit = await repos.audit.listForEntity('conversation', conversation.id, 5);
    expect(audit[0]?.action).toBe('outbox.cancelled');
  });

  it('usa HUMAN_AGENT pasadas 24 h solo si la cuenta lo tiene habilitado', async () => {
    const agent = makeEmployee(5003);
    await repos.employees.insert(agent);
    const { conversation, account } = await seedConversation(repos, 'HUMAN', {
      assignedEmployeeId: agent.id,
    });
    await env.DB.prepare('UPDATE ig_accounts SET human_agent_enabled = 1 WHERE id = ?1')
      .bind(account.id)
      .run();
    clock.advance(STANDARD_WINDOW_MS + 60_000);

    const queued = await container.queueOutboundText.execute({
      conversationId: conversation.id,
      text: 'Seguimiento humano',
      senderKind: 'human',
      senderEmployeeId: agent.id,
      origin: 'telegram',
    });
    expect(queued.ok).toBe(true);
    await container.dispatchOutbox.run();
    expect(gateway.sent[0]?.humanAgentTag).toBe(true);
  });

  it('descarta un envío de IA si la conversación cambió de versión o de modo', async () => {
    const { conversation } = await seedConversation(repos, 'BOT');
    const queued = await container.queueOutboundText.execute({
      conversationId: conversation.id,
      text: 'Respuesta automática',
      senderKind: 'ai',
      senderEmployeeId: null,
      origin: 'ai',
    });
    if (!queued.ok) throw new Error('no se encoló');
    // El cliente pidió humano antes del despacho: la conversación cambia de versión.
    await env.DB.prepare(
      `UPDATE conversations SET mode = 'PENDING_HUMAN', version = version + 1 WHERE id = ?1`,
    )
      .bind(conversation.id)
      .run();

    const summary = await container.dispatchOutbox.run();
    expect(summary.results[0]).toMatchObject({ outcome: 'cancelled', code: 'stale_conversation' });
    expect(gateway.sent).toHaveLength(0);
  });

  it('reintenta con backoff ante límite de tasa y falla tras agotar intentos', async () => {
    const { conversation, agent } = await seedHumanConversation();
    const queued = await container.queueOutboundText.execute({
      conversationId: conversation.id,
      text: 'Reintento',
      senderKind: 'human',
      senderEmployeeId: agent.id,
      origin: 'telegram',
    });
    if (!queued.ok) throw new Error('no se encoló');
    const rateLimited = {
      ok: false as const,
      kind: 'rejected' as const,
      httpStatus: 429,
      errorCode: 'rate_limited',
      retryable: true,
      tokenInvalid: false,
    };
    gateway.queueSendResults(rateLimited, rateLimited, rateLimited, rateLimited, rateLimited);

    const first = await container.dispatchOutbox.run();
    expect(first.results[0]).toMatchObject({ outcome: 'retry_scheduled', code: 'rate_limited' });
    const afterFirst = await repos.outbox.findById(queued.outboxId);
    expect(afterFirst).toMatchObject({ status: 'pending', attempts: 1 });
    expect(afterFirst?.retryAtUtc).toBe(new Date(clock.now().getTime() + 30_000).toISOString());

    // Antes del retry_at no se reclama.
    expect((await container.dispatchOutbox.run()).claimed).toBe(0);

    let outcome = 'retry_scheduled';
    for (let i = 0; i < 6 && outcome === 'retry_scheduled'; i += 1) {
      clock.advance(3 * 60 * 60_000);
      const summary = await container.dispatchOutbox.run();
      outcome = summary.results[0]?.outcome ?? 'none';
    }
    expect(outcome).toBe('failed');
    expect(await repos.outbox.findById(queued.outboxId)).toMatchObject({
      status: 'failed',
      attempts: 5,
    });
    expect(await repos.messages.findById(queued.messageId)).toMatchObject({
      deliveryStatus: 'failed',
    });
  });

  it('un rechazo definitivo no se reintenta y un token inválido marca la cuenta', async () => {
    const { conversation, account, agent } = await seedHumanConversation();
    const queued = await container.queueOutboundText.execute({
      conversationId: conversation.id,
      text: 'x',
      senderKind: 'human',
      senderEmployeeId: agent.id,
      origin: 'telegram',
    });
    if (!queued.ok) throw new Error('no se encoló');
    gateway.queueSendResults({
      ok: false,
      kind: 'rejected',
      httpStatus: 401,
      errorCode: 'token_invalid',
      retryable: false,
      tokenInvalid: true,
    });
    const summary = await container.dispatchOutbox.run();
    expect(summary.results[0]).toMatchObject({ outcome: 'failed', code: 'token_invalid' });
    expect((await repos.igAccounts.findById(account.id))?.status).toBe('token_invalid');
  });
});

describe('acuse incierto y conciliación', () => {
  async function queueAndSendUncertain() {
    const seeded = await seedHumanConversation();
    const queued = await container.queueOutboundText.execute({
      conversationId: seeded.conversation.id,
      text: 'Incierto',
      senderKind: 'human',
      senderEmployeeId: seeded.agent.id,
      origin: 'telegram',
    });
    if (!queued.ok) throw new Error('no se encoló');
    gateway.queueSendResults({ ok: false, kind: 'uncertain', errorCode: 'timeout' });
    const summary = await container.dispatchOutbox.run();
    expect(summary.results[0]).toMatchObject({ outcome: 'uncertain', code: 'timeout' });
    return { ...seeded, queued };
  }

  it('un timeout deja el envío en uncertain y el despacho no lo reintenta', async () => {
    const { queued } = await queueAndSendUncertain();
    expect(await repos.outbox.findById(queued.outboxId)).toMatchObject({ status: 'uncertain' });
    expect(await repos.messages.findById(queued.messageId)).toMatchObject({
      deliveryStatus: 'uncertain',
    });
    clock.advance(60 * 60_000);
    expect((await container.dispatchOutbox.run()).claimed).toBe(0);
    expect(gateway.sent).toHaveLength(1);
  });

  it('si Meta muestra el texto como enviado, se confirma sin reenviar', async () => {
    const { queued, account } = await queueAndSendUncertain();
    clock.advance(2 * 60_000);
    gateway.queueListResults({
      ok: true,
      messages: [
        {
          mid: 'mid.remote',
          fromId: account.igUserId,
          text: 'Incierto',
          createdTimeUtc: clock.now().toISOString(),
        },
      ],
    });
    const summary = await container.reconcileUncertainOutbox.run();
    expect(summary).toMatchObject({ checked: 1, confirmed: 1 });
    expect(await repos.outbox.findById(queued.outboxId)).toMatchObject({
      status: 'sent',
      remoteMessageId: 'mid.remote',
    });
    expect(await repos.messages.findById(queued.messageId)).toMatchObject({
      deliveryStatus: 'sent',
      externalMessageId: 'mid.remote',
    });
    expect((await container.dispatchOutbox.run()).claimed).toBe(0);
  });

  it('si Meta no lo tiene, se vuelve a encolar y se envía una sola vez más', async () => {
    const { queued } = await queueAndSendUncertain();
    clock.advance(2 * 60_000);
    gateway.queueListResults({ ok: true, messages: [] });
    expect(await container.reconcileUncertainOutbox.run()).toMatchObject({ requeued: 1 });
    const summary = await container.dispatchOutbox.run();
    expect(summary.results[0]).toMatchObject({ outcome: 'sent' });
    expect(gateway.sent).toHaveLength(2);
    expect(await repos.outbox.findById(queued.outboxId)).toMatchObject({
      status: 'sent',
      attempts: 2,
    });
  });

  it('no consulta a Meta antes de la espera mínima y mantiene uncertain si Meta no responde', async () => {
    await queueAndSendUncertain();
    expect(await container.reconcileUncertainOutbox.run()).toMatchObject({ checked: 0 });
    clock.advance(2 * 60_000);
    gateway.queueListResults({ ok: false, errorCode: 'http_500' });
    expect(await container.reconcileUncertainOutbox.run()).toMatchObject({
      checked: 1,
      stillUncertain: 1,
    });
  });
});
