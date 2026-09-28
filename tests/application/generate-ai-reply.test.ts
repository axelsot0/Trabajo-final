import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';

import { FakeAiProvider } from '../../src/adapters/ai/fake.ts';
import type { Repositories } from '../../src/adapters/d1/index.ts';
import { FakeInstagramGateway } from '../../src/adapters/meta/fake-instagram-gateway.ts';
import { FakeTelegramGateway } from '../../src/adapters/telegram/fake-telegram-gateway.ts';
import { createContainer, type Container } from '../../src/container.ts';
import { HOLDING_TEXT } from '../../src/domain/ai-policy.ts';
import { newId } from '../../src/domain/ids.ts';
import { runSweep } from '../../src/jobs/sweep.ts';
import type { Clock } from '../../src/ports/clock.ts';
import { YORKIES } from '../support/catalog.ts';
import { makeAccount, makeEmployee, T0 } from '../support/fixtures.ts';

const IG_USER_ID = '17841400000000099';
const OWNER_TG = 7001;

class FixedClock implements Clock {
  constructor(public current: Date) {}
  now(): Date {
    return this.current;
  }
}

let ai: FakeAiProvider;
let instagram: FakeInstagramGateway;
let telegram: FakeTelegramGateway;
let clock: FixedClock;
let container: Container;
let repos: Repositories;

function build(overrides: { aiMode?: 'auto' | 'review' } = {}): Container {
  return createContainer(env, {
    aiProvider: ai,
    aiMode: overrides.aiMode ?? 'auto',
    aiDebounceMs: 0,
    instagramGateway: instagram,
    telegramGateway: telegram,
    clock,
  });
}

beforeEach(async () => {
  ai = new FakeAiProvider();
  instagram = new FakeInstagramGateway();
  telegram = new FakeTelegramGateway();
  clock = new FixedClock(new Date(T0));
  container = build();
  repos = container.repos;
  await repos.igAccounts.insert(makeAccount({ igUserId: IG_USER_ID }));
  await repos.employees.insert(
    makeEmployee(OWNER_TG, 'owner', { displayName: 'Axel', telegramChatId: OWNER_TG }),
  );
  await repos.catalog.upsert(YORKIES);
});

let seq = 0;
async function customerSays(text: string, sender = 'cliente-ai'): Promise<void> {
  seq += 1;
  const mid = `mid.ai.${seq}.${newId()}`;
  await repos.webhookEvents.insertIfNew({
    id: newId(),
    provider: 'meta',
    externalEventKey: `meta:${mid}`,
    receivedAtUtc: T0,
    processStatus: 'pending',
    attempts: 0,
    errorCode: null,
    payloadMinimal: JSON.stringify({
      kind: 'message',
      igAccountUserId: IG_USER_ID,
      senderScopedId: sender,
      mid,
      timestampMs: Date.parse(T0) - 60_000 + seq,
      text,
      attachments: [],
      isUnsupported: false,
      isDeleted: false,
      replyToMid: null,
    }),
    processedAtUtc: null,
  });
}

function aiSays(overrides: Record<string, unknown> = {}): void {
  ai.respondWith({
    intent: 'precio',
    stage: 'interesado',
    priority: 'media',
    handoff_reason: 'none',
    quantity_requested: null,
    reply: 'Tenemos yorkies de 2 meses, listos para su nuevo hogar, a RD$21,000 cada uno. 🐶',
    confidence: 0.9,
    ...overrides,
  });
}

async function onlyConversation() {
  const { results } = await env.DB.prepare('SELECT id FROM conversations').all<{ id: string }>();
  expect(results).toHaveLength(1);
  const conversation = await repos.conversations.findById(results[0]?.id ?? '');
  if (conversation === null) throw new Error('sin conversación');
  return conversation;
}

const ownerTexts = () => telegram.sent.filter((m) => m.chatId === OWNER_TG).map((m) => m.text);

describe('GenerateAiReply', () => {
  it('responde sola con el precio aprobado, se presenta y registra triaje', async () => {
    await customerSays('Hola, ¿cuánto cuesta un yorkie?');
    aiSays();
    await container.processPendingWebhookEvents.run();

    expect(instagram.sent).toHaveLength(1);
    expect(instagram.sent[0]?.text).toContain('RD$21,000');
    expect(instagram.sent[0]?.text).toMatch(/asistente virtual de Yorki Cuties/);

    const conversation = await onlyConversation();
    expect(conversation).toMatchObject({ mode: 'BOT', intent: 'precio', stage: 'interesado' });
    const triage = await repos.triage.listForConversation(conversation.id, 5);
    expect(triage[0]).toMatchObject({ source: 'ai', needsHuman: false, intent: 'precio' });

    // El prompt incluye el catálogo aprobado pero nunca el piso de negociación como tal.
    const system = ai.requests[0]?.messages[0]?.content ?? '';
    expect(system).toContain('RD$21,000');
    expect(system).not.toMatch(/piso/i);
    expect(ownerTexts()).toHaveLength(0);
  });

  it('la segunda respuesta no repite la presentación', async () => {
    await customerSays('Hola');
    aiSays({ intent: 'saludo', reply: '¡Hola! Tenemos yorkies de 2 meses. 🐶' });
    await container.processPendingWebhookEvents.run();
    await customerSays('¿Y cuánto cuestan?');
    aiSays({ reply: 'Cuestan RD$21,000 cada uno.' });
    await container.processPendingWebhookEvents.run();
    expect(instagram.sent.map((s) => s.text)).toEqual([
      'Hola, soy el asistente virtual de Yorki Cuties. ¡Hola! Tenemos yorkies de 2 meses. 🐶',
      'Cuestan RD$21,000 cada uno.',
    ]);
  });

  it('ante un regateo responde con texto fijo, pasa a humano y avisa con la guía de precios', async () => {
    await customerSays('¿Me lo dejas en 17 mil?');
    // Aunque el modelo intente conceder, la regla determinista gana.
    aiSays({ reply: 'Te lo dejo en RD$19,000', stage: 'objecion' });
    await container.processPendingWebhookEvents.run();

    expect(instagram.sent.map((s) => s.text)).toEqual([
      `Hola, soy el asistente virtual de Yorki Cuties. ${HOLDING_TEXT.sales}`,
    ]);
    const conversation = await onlyConversation();
    expect(conversation).toMatchObject({
      mode: 'PENDING_HUMAN',
      modeReason: 'price_negotiation',
      priority: 'alta',
    });
    const alerts = ownerTexts().join('\n');
    expect(alerts).toContain('Negociación de precio');
    expect(alerts).toContain('piso autorizado: RD$18,000');
    // Tras la alerta llega la tarjeta con el botón Tomar.
    expect(telegram.lastTo(OWNER_TG)?.inlineKeyboard?.[0]?.[0]?.text).toBe('Tomar');
  });

  it('compra de 3 o más: informa la oferta aprobada y traspasa', async () => {
    await customerSays('Quiero los 5 perritos');
    aiSays({
      handoff_reason: 'bulk_purchase',
      quantity_requested: 5,
      stage: 'listo_para_comprar',
      reply: 'Si te llevas los 5 quedan en RD$16,000 c/u, total RD$80,000.',
    });
    await container.processPendingWebhookEvents.run();

    expect(instagram.sent[0]?.text).toContain('RD$80,000');
    expect(instagram.sent[0]?.text).toContain('encargado');
    expect(await onlyConversation()).toMatchObject({
      mode: 'PENDING_HUMAN',
      modeReason: 'bulk_purchase',
    });
    expect(ownerTexts().join('\n')).toContain('Cantidad mencionada: 5');
  });

  it('si el proveedor falla, avisa al cliente con texto fijo y pasa a humano', async () => {
    await customerSays('Hola, ¿tienen yorkies?');
    ai.respondWith(new Error('upstream 503'));
    await container.processPendingWebhookEvents.run();

    expect(instagram.sent.map((s) => s.text)).toEqual([
      `Hola, soy el asistente virtual de Yorki Cuties. ${HOLDING_TEXT.generic}`,
    ]);
    expect(await onlyConversation()).toMatchObject({
      mode: 'PENDING_HUMAN',
      modeReason: 'ai_unavailable',
    });
    expect(ownerTexts().join('\n')).toContain('IA no disponible');
  });

  it('una salida que no cumple el esquema nunca se envía', async () => {
    await customerSays('Hola');
    ai.respondWith('Claro que sí, te los regalo');
    await container.processPendingWebhookEvents.run();
    expect(instagram.sent.map((s) => s.text)).toEqual([
      `Hola, soy el asistente virtual de Yorki Cuties. ${HOLDING_TEXT.generic}`,
    ]);
    expect((await onlyConversation()).mode).toBe('PENDING_HUMAN');
  });

  it('una ráfaga se responde una sola vez, con el contexto completo', async () => {
    await customerSays('Hola');
    await customerSays('quería saber el precio');
    await customerSays('de los yorkies');
    aiSays();
    await container.processPendingWebhookEvents.run();
    expect(ai.requests).toHaveLength(1);
    expect(instagram.sent).toHaveLength(1);
    const userTurns = ai.requests[0]?.messages.filter((m) => m.role === 'user') ?? [];
    expect(userTurns.map((m) => m.content)).toEqual([
      'Hola',
      'quería saber el precio',
      'de los yorkies',
    ]);
  });

  it('el mismo mensaje nunca genera dos respuestas', async () => {
    await customerSays('¿Precio?');
    aiSays();
    await container.processPendingWebhookEvents.run();
    const conversation = await onlyConversation();
    expect(await container.generateAiReply?.execute(conversation.id)).toBe('skipped_claimed');
    expect(instagram.sent).toHaveLength(1);
  });

  it('con el cupo diario agotado no llama al proveedor', async () => {
    const small = createContainer(
      { ...env, AI_DAILY_LIMIT: '0' },
      {
        aiProvider: ai,
        aiMode: 'auto',
        aiDebounceMs: 0,
        instagramGateway: instagram,
        telegramGateway: telegram,
        clock,
      },
    );
    await customerSays('Hola');
    await small.processPendingWebhookEvents.run();
    expect(ai.requests).toHaveLength(0);
    expect(await onlyConversation()).toMatchObject({
      mode: 'PENDING_HUMAN',
      modeReason: 'ai_budget_exhausted',
    });
  });

  it('en modo revisión manda el borrador al agente y nada al cliente', async () => {
    const review = build({ aiMode: 'review' });
    await customerSays('¿Cuánto cuesta?');
    aiSays();
    await review.processPendingWebhookEvents.run();
    expect(instagram.sent).toHaveLength(0);
    expect(ownerTexts().join('\n')).toContain('Borrador IA');
    expect((await onlyConversation()).modeReason).toBe('ai_review_required');
  });

  it('el cron atiende conversaciones en BOT que quedaron sin respuesta', async () => {
    // Sin IA en el contenedor que procesa: el mensaje queda guardado en BOT.
    const noAi = createContainer(env, {
      instagramGateway: instagram,
      telegramGateway: telegram,
      clock,
    });
    await repos.webhookEvents.insertIfNew({
      id: newId(),
      provider: 'meta',
      externalEventKey: 'meta:mid.orphan',
      receivedAtUtc: T0,
      processStatus: 'pending',
      attempts: 0,
      errorCode: null,
      payloadMinimal: JSON.stringify({
        kind: 'message',
        igAccountUserId: IG_USER_ID,
        senderScopedId: 'cliente-huerfano',
        mid: 'mid.orphan',
        timestampMs: Date.parse(T0) - 120_000,
        text: '¿Precio?',
        attachments: [],
        isUnsupported: false,
        isDeleted: false,
        replyToMid: null,
      }),
      processedAtUtc: null,
    });
    // `noAi` usa AI_MODE=off de las pruebas: escala al recibir. Forzamos BOT para
    // simular un `waitUntil` interrumpido tras guardar el mensaje.
    await noAi.processPendingWebhookEvents.run();
    const conversation = await onlyConversation();
    await env.DB.prepare("UPDATE conversations SET mode = 'BOT', mode_reason = NULL WHERE id = ?1")
      .bind(conversation.id)
      .run();

    aiSays();
    const summary = await runSweep(env, container);
    expect(summary.aiAttempted).toBe(1);
    expect(instagram.sent).toHaveLength(1);
  });
});
