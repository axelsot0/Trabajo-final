import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Repositories } from '../../src/adapters/d1/index.ts';
import { FakeTelegramGateway } from '../../src/adapters/telegram/fake-telegram-gateway.ts';
import {
  telegramUpdateSchema,
  toMinimalUpdate,
} from '../../src/adapters/telegram/update-schema.ts';
import { INVITE_TTL_MS } from '../../src/application/manage-team.ts';
import { createContainer, type Container } from '../../src/container.ts';
import type { Clock } from '../../src/ports/clock.ts';
import { makeEmployee, T0 } from '../support/fixtures.ts';
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

const OWNER_TG = 6001;
const AGENT_TG = 6002;
const NEW_TG = 6100;

let telegram: FakeTelegramGateway;
let clock: FixedClock;
let container: Container;
let repos: Repositories;

beforeEach(async () => {
  telegram = new FakeTelegramGateway();
  clock = new FixedClock(new Date(T0));
  container = createContainer(env, { telegramGateway: telegram, clock });
  repos = container.repos;
  await repos.employees.insert(
    makeEmployee(OWNER_TG, 'owner', { displayName: 'Axel', telegramChatId: OWNER_TG }),
  );
  await repos.employees.insert(
    makeEmployee(AGENT_TG, 'agent', { displayName: 'Ana', telegramChatId: AGENT_TG }),
  );
});

async function send(update: Record<string, unknown>) {
  return container.handleTelegramUpdate.execute(
    toMinimalUpdate(telegramUpdateSchema.parse(update)),
  );
}

/** El owner pide una invitación y devuelve el código del enlace. */
async function inviteCode(text = '/invitar'): Promise<string> {
  await send(textUpdate({ fromId: OWNER_TG, text }));
  const reply = telegram.lastTo(OWNER_TG)?.text ?? '';
  const code = /start=([A-Za-z0-9_-]+)/.exec(reply)?.[1];
  if (code === undefined) throw new Error(`sin enlace: ${reply}`);
  return code;
}

function startWith(code: string, fromId = NEW_TG) {
  const update = textUpdate({ fromId, text: `/start ${code}` });
  const message = update['message'] as Record<string, unknown>;
  message['from'] = { id: fromId, is_bot: false, first_name: 'María', last_name: 'Pérez' };
  return update;
}

describe('invitaciones', () => {
  it('el owner genera un enlace t.me y la persona queda registrada al abrirlo', async () => {
    const code = await inviteCode();
    expect(telegram.lastTo(OWNER_TG)?.text).toContain(`https://t.me/yorki_test_bot?start=${code}`);

    expect(await send(startWith(code))).toBe('handled');
    const maria = await repos.employees.findByTelegramUserId(NEW_TG);
    expect(maria).toMatchObject({
      displayName: 'María Pérez',
      role: 'agent',
      active: true,
      telegramChatId: NEW_TG,
    });
    expect(telegram.lastTo(NEW_TG)?.text).toContain('Bienvenido/a, María Pérez');
    expect(telegram.lastTo(OWNER_TG)?.text).toBe('María Pérez se unió al bot como agente.');

    // Ya puede trabajar: /chats responde.
    expect(await send(textUpdate({ fromId: NEW_TG, text: '/chats' }))).toBe('handled');
  });

  it('un enlace sirve una sola vez y vence a las 48 h', async () => {
    const code = await inviteCode();
    await send(startWith(code));
    expect(await send(startWith(code, NEW_TG + 1))).toBe('unauthorized');
    expect(await repos.employees.findByTelegramUserId(NEW_TG + 1)).toBeNull();

    const late = await inviteCode();
    clock.advance(INVITE_TTL_MS + 1);
    expect(await send(startWith(late, NEW_TG + 2))).toBe('unauthorized');
    expect(telegram.lastTo(NEW_TG + 2)?.text).toContain('no es válida');
  });

  it('se puede invitar con otro rol', async () => {
    const code = await inviteCode('/invitar lectura');
    await send(startWith(code));
    expect((await repos.employees.findByTelegramUserId(NEW_TG))?.role).toBe('viewer');
  });

  it('un agente no puede invitar ni ver el equipo', async () => {
    await send(textUpdate({ fromId: AGENT_TG, text: '/invitar' }));
    expect(telegram.lastTo(AGENT_TG)?.text).toBe('Solo un owner puede invitar personas al bot.');
    await send(textUpdate({ fromId: AGENT_TG, text: '/agentes' }));
    expect(telegram.lastTo(AGENT_TG)?.text).toBe('Solo un owner puede gestionar el equipo.');
  });

  it('un código inventado no da acceso', async () => {
    expect(await send(startWith('codigo-inventado-123'))).toBe('unauthorized');
  });
});

describe('/agentes', () => {
  it('lista el equipo y permite quitar el acceso a otro', async () => {
    await send(textUpdate({ fromId: OWNER_TG, text: '/agentes' }));
    const list = telegram.lastTo(OWNER_TG);
    expect(list?.text).toContain('• Axel — owner · activo');
    expect(list?.text).toContain('• Ana — agente · activo');
    const buttons = list?.inlineKeyboard?.flat() ?? [];
    expect(buttons.map((b) => b.text)).toEqual(['Quitar a Ana']);

    await send(
      callbackUpdate({
        fromId: OWNER_TG,
        messageId: list?.messageId ?? 0,
        data: buttons[0]?.callbackData ?? '',
      }),
    );
    expect((await repos.employees.findByTelegramUserId(AGENT_TG))?.active).toBe(false);
    expect(telegram.lastTo(AGENT_TG)?.text).toBe('Tu acceso al bot de atención fue retirado.');
    expect(await send(textUpdate({ fromId: AGENT_TG, text: '/chats' }))).toBe('unauthorized');
  });

  it('una persona dada de baja puede volver con una invitación nueva', async () => {
    const ana = await repos.employees.findByTelegramUserId(AGENT_TG);
    await repos.employees.updateAccess(ana?.id ?? '', { role: 'agent', active: false });
    const code = await inviteCode();
    expect(await send(startWith(code, AGENT_TG))).toBe('handled');
    expect(await repos.employees.findByTelegramUserId(AGENT_TG)).toMatchObject({
      id: ana?.id,
      active: true,
    });
  });
});
