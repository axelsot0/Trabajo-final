import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Repositories } from '../../src/adapters/d1/index.ts';
import { FakeTelegramGateway } from '../../src/adapters/telegram/fake-telegram-gateway.ts';
import { renderConversationCard } from '../../src/application/telegram-cards.ts';
import { createContainer, type Container } from '../../src/container.ts';
import { newId } from '../../src/domain/ids.ts';
import { makeAccount, makeEmployee, T0 } from '../support/fixtures.ts';

const IG_USER_ID = '17841400000000000';
let telegram: FakeTelegramGateway;
let container: Container;
let repos: Repositories;

beforeEach(async () => {
  telegram = new FakeTelegramGateway();
  container = createContainer(env, { telegramGateway: telegram });
  repos = container.repos;
  await repos.igAccounts.insert(makeAccount({ igUserId: IG_USER_ID }));
});

function inboundEvent(mid: string, senderScopedId: string, text: string) {
  return {
    id: newId(),
    provider: 'meta' as const,
    externalEventKey: `meta:${mid}`,
    receivedAtUtc: T0,
    processStatus: 'pending' as const,
    attempts: 0,
    errorCode: null,
    payloadMinimal: JSON.stringify({
      kind: 'message',
      igAccountUserId: IG_USER_ID,
      senderScopedId,
      mid,
      timestampMs: 1_790_560_000_000,
      text,
      attachments: [],
      isUnsupported: false,
      isDeleted: false,
      replyToMid: null,
    }),
    processedAtUtc: null,
  };
}

describe('avisos a agentes', () => {
  it('al escalar a humano avisa a todos los agentes con chat iniciado, no a viewers ni a quien no hizo /start', async () => {
    await repos.employees.insert(makeEmployee(8001, 'agent', { telegramChatId: 8001 }));
    await repos.employees.insert(makeEmployee(8002, 'owner', { telegramChatId: 8002 }));
    await repos.employees.insert(makeEmployee(8003, 'agent', { telegramChatId: null }));
    await repos.employees.insert(makeEmployee(8004, 'viewer', { telegramChatId: 8004 }));

    await repos.webhookEvents.insertIfNew(inboundEvent('mid.1', 'cliente-1', 'Quiero comprar'));
    await container.processPendingWebhookEvents.run();

    expect(telegram.sent.map((m) => m.chatId).sort()).toEqual([8001, 8002]);
    for (const m of telegram.sent) {
      expect(m.text).toContain('Pendiente de humano');
      expect(m.text).toContain('Cliente: Quiero comprar');
      expect(m.inlineKeyboard?.[0]?.[0]?.text).toBe('Tomar');
      const link = await repos.telegramLinks.find(m.chatId, m.messageId);
      expect(link?.kind).toBe('notification');
    }
  });

  it('un segundo mensaje en PENDING_HUMAN no vuelve a avisar; en HUMAN avisa solo al asignado', async () => {
    const a = makeEmployee(8001, 'agent', { telegramChatId: 8001 });
    const b = makeEmployee(8002, 'agent', { telegramChatId: 8002 });
    await repos.employees.insert(a);
    await repos.employees.insert(b);

    await repos.webhookEvents.insertIfNew(inboundEvent('mid.1', 'cliente-1', 'Hola'));
    await container.processPendingWebhookEvents.run();
    expect(telegram.sent).toHaveLength(2);

    await repos.webhookEvents.insertIfNew(inboundEvent('mid.2', 'cliente-1', 'Sigo aquí'));
    await container.processPendingWebhookEvents.run();
    expect(telegram.sent).toHaveLength(2);

    const message = await repos.messages.findByExternalId('mid.1');
    const conversationId = message?.conversationId ?? '';
    const claimed = await repos.conversations.claim(conversationId, b.id, T0);
    expect(claimed.ok).toBe(true);

    await repos.webhookEvents.insertIfNew(inboundEvent('mid.3', 'cliente-1', '¿Y el precio?'));
    await container.processPendingWebhookEvents.run();
    expect(telegram.sent).toHaveLength(3);
    const last = telegram.sent.at(-1);
    expect(last?.chatId).toBe(8002);
    expect(last?.text).toContain('¿Y el precio?');
    expect(last?.inlineKeyboard?.[0]?.map((btn) => btn.text)).toEqual(['Transferir', 'Cerrar']);
  });

  it('si Telegram falla, el mensaje entrante queda guardado y el evento en done', async () => {
    await repos.employees.insert(makeEmployee(8001, 'agent', { telegramChatId: 8001 }));
    telegram.failNextSend = { ok: false, errorCode: 'telegram_403', description: 'blocked' };
    await repos.webhookEvents.insertIfNew(inboundEvent('mid.1', 'cliente-1', 'Hola'));
    const summary = await container.processPendingWebhookEvents.run();
    expect(summary).toMatchObject({ done: 1 });
    await expect(repos.messages.findByExternalId('mid.1')).resolves.not.toBeNull();
  });
});

describe('tarjeta con el perfil del cliente', () => {
  it('muestra nombre, @usuario, etapa y quién atiende', () => {
    const text = renderConversationCard({
      conversation: {
        id: 'conv-0000-1111',
        igAccountId: 'acc',
        customerId: 'cus',
        mode: 'BOT',
        modeReason: 'new_conversation',
        assignedEmployeeId: null,
        priority: 'media',
        intent: 'precio',
        stage: 'interesado',
        version: 1,
        lastCustomerMessageAtUtc: null,
        lastMessageAtUtc: null,
        openedAtUtc: '2026-09-28T00:00:00.000Z',
        closedAtUtc: null,
      },
      customer: {
        id: 'cus',
        igAccountId: 'acc',
        igScopedId: '1651561651',
        displayName: 'Orison Soto',
        username: 'orisonsoto',
        profileCheckedAtUtc: null,
        createdAtUtc: '2026-09-28T00:00:00.000Z',
      },
      messages: [],
      assignedName: null,
      timeZone: 'America/Santo_Domingo',
    });
    expect(text.split('\n').slice(0, 3)).toEqual([
      'Conversación: Orison Soto (@orisonsoto)',
      'Estado: Interesado · Atiende: IA',
      'Prioridad: media · Consulta: precio',
    ]);
    expect(text).not.toContain('1651561651');
  });
});
