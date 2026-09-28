import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Repositories } from '../../src/adapters/d1/index.ts';
import { FakeInstagramGateway } from '../../src/adapters/meta/fake-instagram-gateway.ts';
import { FakeTelegramGateway } from '../../src/adapters/telegram/fake-telegram-gateway.ts';
import {
  telegramUpdateSchema,
  toMinimalUpdate,
} from '../../src/adapters/telegram/update-schema.ts';
import { createContainer, type Container } from '../../src/container.ts';
import type { Employee } from '../../src/domain/employee.ts';
import { STANDARD_WINDOW_MS } from '../../src/domain/messaging-window.ts';
import type { Clock } from '../../src/ports/clock.ts';
import { makeEmployee, makeInboundMessage, seedConversation, T0 } from '../support/fixtures.ts';
import { callbackUpdate, textUpdate } from '../support/telegram-updates.ts';

class FixedClock implements Clock {
  constructor(public current: Date) {}
  now(): Date {
    return this.current;
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

const ANA_TG = 9001;
const LUIS_TG = 9002;

let instagram: FakeInstagramGateway;
let telegram: FakeTelegramGateway;
let clock: FixedClock;
let container: Container;
let repos: Repositories;
let ana: Employee;
let luis: Employee;

beforeEach(async () => {
  instagram = new FakeInstagramGateway();
  telegram = new FakeTelegramGateway();
  clock = new FixedClock(new Date(T0));
  container = createContainer(env, {
    instagramGateway: instagram,
    telegramGateway: telegram,
    clock,
  });
  repos = container.repos;
  ana = makeEmployee(ANA_TG, 'agent', { displayName: 'Ana', telegramChatId: ANA_TG });
  luis = makeEmployee(LUIS_TG, 'agent', { displayName: 'Luis', telegramChatId: LUIS_TG });
  await repos.employees.insert(ana);
  await repos.employees.insert(luis);
});

async function send(update: Record<string, unknown>) {
  return container.handleTelegramUpdate.execute(
    toMinimalUpdate(telegramUpdateSchema.parse(update)),
  );
}

/** Envía la tarjeta de aviso a un agente y devuelve el id del mensaje y el token de "Tomar". */
async function notifyCard(employee: Employee, conversationId: string) {
  await container.notifier.sendCard(employee.id, conversationId, 'notification');
  const card = telegram.lastTo(employee.telegramChatId ?? 0);
  return {
    messageId: card?.messageId ?? 0,
    claim: card?.inlineKeyboard?.[0]?.[0]?.callbackData ?? '',
    card,
  };
}

async function seedPending() {
  const seeded = await seedConversation(repos, 'PENDING_HUMAN');
  await repos.messages.insert(
    makeInboundMessage(seeded.conversation.id, 'mid.in', { body: '¿Tienen talla M?' }),
  );
  return seeded;
}

/** Ana toma la conversación y recibe su tarjeta; devuelve el id de esa tarjeta. */
async function anaClaims(conversationId: string) {
  const { claim, messageId } = await notifyCard(ana, conversationId);
  await send(callbackUpdate({ fromId: ANA_TG, messageId, data: claim }));
  const card = telegram.lastTo(ANA_TG);
  expect(card?.text).toContain('En atención humana');
  return card?.messageId ?? 0;
}

describe('toma atómica desde Telegram', () => {
  it('dos agentes pulsan Tomar a la vez: uno gana, el otro recibe aviso y la tarjeta actualizada', async () => {
    const { conversation } = await seedPending();
    const a = await notifyCard(ana, conversation.id);
    const l = await notifyCard(luis, conversation.id);

    await Promise.all([
      send(callbackUpdate({ fromId: ANA_TG, messageId: a.messageId, data: a.claim })),
      send(callbackUpdate({ fromId: LUIS_TG, messageId: l.messageId, data: l.claim })),
    ]);

    const stored = await repos.conversations.findById(conversation.id);
    expect(stored?.mode).toBe('HUMAN');
    expect([ana.id, luis.id]).toContain(stored?.assignedEmployeeId);
    const notices = telegram.answered.map((x) => x.text ?? '');
    expect(notices.filter((t) => t.includes('Conversación tomada'))).toHaveLength(1);
    expect(notices.filter((t) => t.includes('Otro agente ya tomó'))).toHaveLength(1);
    const audit = await repos.audit.listForEntity('conversation', conversation.id, 10);
    expect(audit.filter((e) => e.action === 'conversation.claimed')).toHaveLength(1);
  });
});

describe('Reply enruta al destinatario correcto', () => {
  it('el Reply a la tarjeta envía al IGSID del cliente y confirma al agente', async () => {
    const { conversation, customer } = await seedPending();
    const cardId = await anaClaims(conversation.id);

    expect(
      await send(
        textUpdate({
          fromId: ANA_TG,
          text: 'Sí, tenemos talla M en azul.',
          replyToMessageId: cardId,
        }),
      ),
    ).toBe('handled');

    expect(instagram.sent).toHaveLength(1);
    expect(instagram.sent[0]).toMatchObject({
      recipientId: customer.igScopedId,
      text: 'Sí, tenemos talla M en azul.',
    });
    expect(telegram.lastTo(ANA_TG)?.text).toContain('Enviado al cliente por Instagram');
    const history = await repos.messages.listRecent(conversation.id, 5);
    expect(history.at(-1)).toMatchObject({
      direction: 'outbound',
      origin: 'telegram',
      senderEmployeeId: ana.id,
      deliveryStatus: 'sent',
      externalMessageId: 'mid.fake.1',
    });
  });

  it('un Reply a una tarjeta ajena o a un mensaje cualquiera no envía nada', async () => {
    const { conversation } = await seedPending();
    await anaClaims(conversation.id);
    const luisCard = await notifyCard(luis, conversation.id);

    // Luis responde a su propia tarjeta de aviso, pero la conversación es de Ana.
    await send(textUpdate({ fromId: LUIS_TG, text: 'Hola', replyToMessageId: luisCard.messageId }));
    expect(telegram.lastTo(LUIS_TG)?.text).toContain('Solo el agente asignado');

    // Ana responde a un mensaje que no es una tarjeta.
    await send(textUpdate({ fromId: ANA_TG, text: 'Hola', replyToMessageId: 424242 }));
    expect(telegram.lastTo(ANA_TG)?.text).toContain('no corresponde a una tarjeta');

    // Luis intenta usar el id de la tarjeta de Ana desde su propio chat.
    await send(
      textUpdate({ fromId: LUIS_TG, text: 'Hola', replyToMessageId: luisCard.messageId + 1 }),
    );
    expect(instagram.sent).toHaveLength(0);
  });

  it('con la ventana vencida, el agente recibe el motivo y no se llama a Meta', async () => {
    const { conversation } = await seedPending();
    const cardId = await anaClaims(conversation.id);
    clock.advance(STANDARD_WINDOW_MS + 1);
    await send(textUpdate({ fromId: ANA_TG, text: 'Tarde', replyToMessageId: cardId }));
    expect(instagram.sent).toHaveLength(0);
    expect(telegram.lastTo(ANA_TG)?.text).toContain('ventana de respuesta de Instagram venció');
  });

  it('Telegram informa cuando Meta rechaza o no confirma', async () => {
    const { conversation } = await seedPending();
    const cardId = await anaClaims(conversation.id);
    instagram.queueSendResults({ ok: false, kind: 'uncertain', errorCode: 'timeout' });
    await send(textUpdate({ fromId: ANA_TG, text: 'Hola', replyToMessageId: cardId }));
    expect(telegram.lastTo(ANA_TG)?.text).toContain('no confirmó la entrega');

    instagram.queueSendResults({
      ok: false,
      kind: 'rejected',
      httpStatus: 429,
      errorCode: 'rate_limited',
      retryable: true,
      tokenInvalid: false,
    });
    await send(textUpdate({ fromId: ANA_TG, text: 'Otra', replyToMessageId: cardId }));
    expect(telegram.lastTo(ANA_TG)?.text).toContain('se reintentará');
  });
});

describe('la IA no responde en HUMAN', () => {
  it('un borrador de IA encolado antes de la toma se descarta al despachar', async () => {
    const { conversation } = await seedConversation(repos, 'BOT');
    const queued = await container.queueOutboundText.execute({
      conversationId: conversation.id,
      text: 'Respuesta automática',
      senderKind: 'ai',
      senderEmployeeId: null,
      origin: 'ai',
    });
    expect(queued.ok).toBe(true);
    // El cliente pide humano y Ana toma la conversación antes del despacho.
    await env.DB.prepare(
      `UPDATE conversations SET mode = 'PENDING_HUMAN', version = version + 1 WHERE id = ?1`,
    )
      .bind(conversation.id)
      .run();
    const claim = await container.agentActions.claim(ana, conversation.id);
    expect(claim.ok).toBe(true);

    const summary = await container.dispatchOutbox.run();
    expect(summary.results[0]).toMatchObject({ outcome: 'cancelled', code: 'stale_conversation' });
    expect(instagram.sent).toHaveLength(0);
    await expect(
      container.queueOutboundText.execute({
        conversationId: conversation.id,
        text: 'Otra automática',
        senderKind: 'ai',
        senderEmployeeId: null,
        origin: 'ai',
      }),
    ).resolves.toEqual({ ok: false, reason: 'not_allowed' });
  });
});

describe('cerrar, resultado y venta', () => {
  it('Cerrar pide el resultado, lo registra, libera la asignación y permite anotar el importe', async () => {
    const { conversation } = await seedPending();
    const cardId = await anaClaims(conversation.id);
    const card = telegram.lastTo(ANA_TG);
    const closeToken =
      card?.inlineKeyboard?.[0]?.find((b) => b.text === 'Cerrar')?.callbackData ?? '';

    await send(callbackUpdate({ fromId: ANA_TG, messageId: cardId, data: closeToken }));
    const ask = telegram.lastTo(ANA_TG);
    expect(ask?.text).toContain('¿Con qué resultado');
    const sale =
      ask?.inlineKeyboard?.flat().find((b) => b.text === 'Venta confirmada')?.callbackData ?? '';

    await send(callbackUpdate({ fromId: ANA_TG, messageId: ask?.messageId ?? 0, data: sale }));
    const stored = await repos.conversations.findById(conversation.id);
    expect(stored).toMatchObject({ mode: 'CLOSED', assignedEmployeeId: null });
    expect(stored?.closedAtUtc).toBe(T0);
    const outcome = await repos.outcomes.findLatestForConversation(conversation.id);
    expect(outcome).toMatchObject({
      kind: 'venta_confirmada',
      recordedBy: ana.id,
      amountMinor: null,
    });

    const closing = telegram.lastTo(ANA_TG);
    expect(closing?.text).toContain('venta confirmada');
    await send(
      textUpdate({
        fromId: ANA_TG,
        text: '/venta 1,250.00 DOP pago en efectivo',
        replyToMessageId: closing?.messageId ?? 0,
      }),
    );
    expect(telegram.lastTo(ANA_TG)?.text).toContain('Importe registrado: 1250.00 DOP');
    expect(await repos.outcomes.findLatestForConversation(conversation.id)).toMatchObject({
      amountMinor: 125_000,
      currency: 'DOP',
      evidenceNote: 'pago en efectivo',
    });

    // Tras cerrar, responder al cliente ya no es posible desde la tarjeta.
    await send(textUpdate({ fromId: ANA_TG, text: 'Gracias', replyToMessageId: cardId }));
    expect(telegram.lastTo(ANA_TG)?.text).toContain('está cerrada');
    expect(instagram.sent).toHaveLength(0);
  });

  it('/cerrar como Reply a la tarjeta también abre la elección de resultado', async () => {
    const { conversation } = await seedPending();
    const cardId = await anaClaims(conversation.id);
    await send(textUpdate({ fromId: ANA_TG, text: '/cerrar', replyToMessageId: cardId }));
    expect(telegram.lastTo(ANA_TG)?.text).toContain('¿Con qué resultado');
    // Sin Reply, el comando explica cómo usarse.
    await send(textUpdate({ fromId: ANA_TG, text: '/cerrar' }));
    expect(telegram.lastTo(ANA_TG)?.text).toContain('/cerrar y /venta se usan como Reply');
  });

  it('solo el asignado (o un owner) puede cerrar', async () => {
    const { conversation } = await seedPending();
    await anaClaims(conversation.id);
    const forbidden = await container.agentActions.close(luis, conversation.id, 'sin_venta');
    expect(forbidden).toEqual({ ok: false, reason: 'forbidden' });
    const owner = makeEmployee(9003, 'owner', { telegramChatId: 9003 });
    await repos.employees.insert(owner);
    const closed = await container.agentActions.close(owner, conversation.id, 'seguimiento');
    expect(closed.ok).toBe(true);
  });
});

describe('transferir', () => {
  it('Transferir lista a los demás agentes, reasigna y avisa al nuevo', async () => {
    const { conversation, customer } = await seedPending();
    const cardId = await anaClaims(conversation.id);
    const transferToken =
      telegram.lastTo(ANA_TG)?.inlineKeyboard?.[0]?.find((b) => b.text === 'Transferir')
        ?.callbackData ?? '';

    await send(callbackUpdate({ fromId: ANA_TG, messageId: cardId, data: transferToken }));
    const pick = telegram.lastTo(ANA_TG);
    expect(pick?.text).toContain('¿A quién transfieres');
    expect(pick?.inlineKeyboard?.flat().map((b) => b.text)).toEqual(['Luis']);
    const toLuis = pick?.inlineKeyboard?.[0]?.[0]?.callbackData ?? '';

    await send(callbackUpdate({ fromId: ANA_TG, messageId: pick?.messageId ?? 0, data: toLuis }));
    expect(await repos.conversations.findById(conversation.id)).toMatchObject({
      mode: 'HUMAN',
      assignedEmployeeId: luis.id,
    });
    const luisCard = telegram.lastTo(LUIS_TG);
    expect(luisCard?.text).toContain('Agente: Luis');

    // Luis responde desde su tarjeta; Ana ya no puede.
    await send(
      textUpdate({
        fromId: LUIS_TG,
        text: 'Hola, soy Luis',
        replyToMessageId: luisCard?.messageId ?? 0,
      }),
    );
    expect(instagram.sent).toHaveLength(1);
    expect(instagram.sent[0]).toMatchObject({
      recipientId: customer.igScopedId,
      text: 'Hola, soy Luis',
    });
    await send(textUpdate({ fromId: ANA_TG, text: 'Sigo yo', replyToMessageId: cardId }));
    expect(instagram.sent).toHaveLength(1);
    expect(telegram.lastTo(ANA_TG)?.text).toContain('Solo el agente asignado');
  });
});
