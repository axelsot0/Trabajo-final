import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Repositories } from '../../src/adapters/d1/index.ts';
import { FakeTelegramGateway } from '../../src/adapters/telegram/fake-telegram-gateway.ts';
import {
  telegramUpdateSchema,
  toMinimalUpdate,
} from '../../src/adapters/telegram/update-schema.ts';
import { createContainer, type Container } from '../../src/container.ts';
import { CHATS_PAGE_SIZE } from '../../src/application/handle-telegram-update.ts';
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

let telegram: FakeTelegramGateway;
let clock: FixedClock;
let container: Container;
let repos: Repositories;

const AGENT_TG = 7001;
const OTHER_TG = 7002;

beforeEach(async () => {
  telegram = new FakeTelegramGateway();
  clock = new FixedClock(new Date(T0));
  container = createContainer(env, { telegramGateway: telegram, clock });
  repos = container.repos;
  await repos.employees.insert(makeEmployee(AGENT_TG, 'agent', { telegramChatId: null }));
});

async function send(update: Record<string, unknown>) {
  return container.handleTelegramUpdate.execute(
    toMinimalUpdate(telegramUpdateSchema.parse(update)),
  );
}

describe('autorización', () => {
  it('rechaza a quien no está en la allowlist y a empleados inactivos', async () => {
    expect(await send(textUpdate({ fromId: 9999, text: '/start' }))).toBe('unauthorized');
    expect(telegram.lastTo(9999)?.text).toContain('No estás autorizado');

    await repos.employees.insert(makeEmployee(OTHER_TG, 'agent', { active: false }));
    expect(await send(textUpdate({ fromId: OTHER_TG, text: '/chats' }))).toBe('unauthorized');
  });

  it('ignora grupos y bots sin responder', async () => {
    expect(
      await send(textUpdate({ fromId: AGENT_TG, chatId: -100, text: '/chats', chatType: 'group' })),
    ).toBe('ignored_non_private');
    expect(await send(textUpdate({ fromId: AGENT_TG, text: 'hola', isBot: true }))).toBe(
      'ignored_bot',
    );
    expect(telegram.sent).toHaveLength(0);
  });

  it('/start registra el chat privado del empleado para poder avisarle', async () => {
    expect(await send(textUpdate({ fromId: AGENT_TG, text: '/start' }))).toBe('handled');
    const employee = await repos.employees.findByTelegramUserId(AGENT_TG);
    expect(employee?.telegramChatId).toBe(AGENT_TG);
    expect(telegram.lastTo(AGENT_TG)?.text).toContain('/chats');
  });

  it('un viewer no puede listar ni tomar conversaciones', async () => {
    await repos.employees.insert(makeEmployee(7003, 'viewer'));
    expect(await send(textUpdate({ fromId: 7003, text: '/chats' }))).toBe('handled');
    expect(telegram.lastTo(7003)?.text).toContain('solo permite consultar');
  });
});

describe('/chats y /mischats', () => {
  it('lista pendientes primero, pagina y ofrece botones Ver con tokens opacos', async () => {
    await send(textUpdate({ fromId: AGENT_TG, text: '/start' }));
    const pending = await seedConversation(repos, 'PENDING_HUMAN', { priority: 'alta' });
    await repos.messages.insert(
      makeInboundMessage(pending.conversation.id, 'mid.p', { body: '¿Hacen envíos a Santiago?' }),
    );
    for (let i = 0; i < CHATS_PAGE_SIZE; i += 1) await seedConversation(repos, 'BOT');

    expect(await send(textUpdate({ fromId: AGENT_TG, text: '/chats' }))).toBe('handled');
    const list = telegram.lastTo(AGENT_TG);
    expect(list?.text).toContain('página 1/2');
    expect(list?.text.split('\n')[2]).toContain('Pendiente de humano');
    expect(list?.text).toContain('¿Hacen envíos a Santiago?');
    const keyboard = list?.inlineKeyboard ?? [];
    expect(keyboard[0]?.map((b) => b.text)).toEqual(['Ver 1', 'Ver 2', 'Ver 3', 'Ver 4', 'Ver 5']);
    expect(keyboard[1]?.map((b) => b.text)).toEqual(['Siguiente ▶']);
    for (const b of keyboard.flat()) {
      expect(b.callbackData).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(b.callbackData).not.toContain(pending.conversation.id);
    }

    // Siguiente página: edita el mensaje existente.
    const next = keyboard[1]?.[0]?.callbackData ?? '';
    expect(
      await send(callbackUpdate({ fromId: AGENT_TG, messageId: list?.messageId ?? 0, data: next })),
    ).toBe('handled');
    expect(telegram.edited[0]?.text).toContain('página 2/2');
    expect(telegram.edited[0]?.inlineKeyboard?.[1]?.map((b) => b.text)).toEqual(['◀ Anterior']);
  });

  it('Ver envía la tarjeta enlazada a la conversación', async () => {
    await send(textUpdate({ fromId: AGENT_TG, text: '/start' }));
    const { conversation } = await seedConversation(repos, 'PENDING_HUMAN');
    await repos.messages.insert(
      makeInboundMessage(conversation.id, 'mid.1', { body: 'Hola, ¿precio del combo?' }),
    );
    await send(textUpdate({ fromId: AGENT_TG, text: '/chats' }));
    const list = telegram.lastTo(AGENT_TG);
    const view = list?.inlineKeyboard?.[0]?.[0]?.callbackData ?? '';

    expect(
      await send(callbackUpdate({ fromId: AGENT_TG, messageId: list?.messageId ?? 0, data: view })),
    ).toBe('handled');
    const card = telegram.lastTo(AGENT_TG);
    expect(card?.text).toContain(`Conversación #${conversation.id.slice(0, 8)}`);
    expect(card?.text).toContain('Cliente: Hola, ¿precio del combo?');
    expect(card?.text).toContain('Responde con Reply');
    expect(card?.inlineKeyboard?.[0]?.map((b) => b.text)).toEqual(['Tomar']);

    const link = await repos.telegramLinks.find(AGENT_TG, card?.messageId ?? 0);
    expect(link).toMatchObject({ conversationId: conversation.id, kind: 'card' });
    expect(telegram.answered.at(-1)?.text).toBe('Tarjeta enviada.');
  });

  it('/mischats solo muestra lo asignado al agente', async () => {
    await send(textUpdate({ fromId: AGENT_TG, text: '/start' }));
    const me = await repos.employees.findByTelegramUserId(AGENT_TG);
    const other = makeEmployee(OTHER_TG);
    await repos.employees.insert(other);
    const mine = await seedConversation(repos, 'HUMAN', { assignedEmployeeId: me?.id ?? null });
    await seedConversation(repos, 'HUMAN', { assignedEmployeeId: other.id });

    await send(textUpdate({ fromId: AGENT_TG, text: '/mischats' }));
    const list = telegram.lastTo(AGENT_TG);
    expect(list?.text).toContain(`#${mine.conversation.id.slice(0, 8)}`);
    expect(list?.inlineKeyboard?.[0]).toHaveLength(1);
  });
});

describe('callbacks', () => {
  it('rechaza tokens desconocidos, de otro agente y caducados', async () => {
    await send(textUpdate({ fromId: AGENT_TG, text: '/start' }));
    await repos.employees.insert(makeEmployee(OTHER_TG, 'agent', { telegramChatId: OTHER_TG }));
    await seedConversation(repos, 'PENDING_HUMAN');
    await send(textUpdate({ fromId: AGENT_TG, text: '/chats' }));
    const list = telegram.lastTo(AGENT_TG);
    const view = list?.inlineKeyboard?.[0]?.[0]?.callbackData ?? '';

    expect(await send(callbackUpdate({ fromId: AGENT_TG, messageId: 1, data: 'no-existe' }))).toBe(
      'callback_invalid',
    );
    expect(await send(callbackUpdate({ fromId: OTHER_TG, messageId: 1, data: view }))).toBe(
      'callback_invalid',
    );
    expect(telegram.answered.at(-1)?.text).toContain('ya no es válido');

    clock.advance(7 * 60 * 60_000);
    expect(await send(callbackUpdate({ fromId: AGENT_TG, messageId: 1, data: view }))).toBe(
      'callback_invalid',
    );
    expect(telegram.sent.filter((m) => m.text.startsWith('Conversación #'))).toHaveLength(0);
  });

  it('Tomar reclama la conversación y el token no se puede reutilizar', async () => {
    await send(textUpdate({ fromId: AGENT_TG, text: '/start' }));
    const { conversation } = await seedConversation(repos, 'PENDING_HUMAN');
    const me = await repos.employees.findByTelegramUserId(AGENT_TG);
    const ok = await container.notifier.sendCard(me?.id ?? '', conversation.id, 'card');
    expect(ok).toBe(true);
    const claim = telegram.lastTo(AGENT_TG)?.inlineKeyboard?.[0]?.[0]?.callbackData ?? '';
    expect(await send(callbackUpdate({ fromId: AGENT_TG, messageId: 1, data: claim }))).toBe(
      'handled',
    );
    expect(telegram.answered.at(-1)?.text).toContain('Conversación tomada');
    expect((await repos.conversations.findById(conversation.id))?.mode).toBe('HUMAN');
    // Un token de un solo uso no se puede repetir.
    expect(await send(callbackUpdate({ fromId: AGENT_TG, messageId: 1, data: claim }))).toBe(
      'callback_invalid',
    );
  });
});

describe('texto libre', () => {
  it('sin Reply a una tarjeta, explica cómo responder', async () => {
    await send(textUpdate({ fromId: AGENT_TG, text: '/start' }));
    expect(await send(textUpdate({ fromId: AGENT_TG, text: 'hola cliente' }))).toBe('handled');
    expect(telegram.lastTo(AGENT_TG)?.text).toContain('haz Reply');
  });
});
