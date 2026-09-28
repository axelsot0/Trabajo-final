import { describe, expect, it } from 'vitest';

import {
  evaluateSendWindow,
  HUMAN_AGENT_WINDOW_MS,
  STANDARD_WINDOW_MS,
} from '../../src/domain/messaging-window.ts';

const last = '2026-09-27T14:00:00.000Z';
const at = (offsetMs: number): Date => new Date(new Date(last).getTime() + offsetMs);

describe('evaluateSendWindow', () => {
  it('sin mensaje del cliente no hay ventana', () => {
    expect(
      evaluateSendWindow({
        lastCustomerMessageAtUtc: null,
        now: at(0),
        senderKind: 'human',
        humanAgentEnabled: true,
      }),
    ).toEqual({ allowed: false, reason: 'no_customer_message' });
  });

  it('permite dentro de 24 h y cierra en el borde exacto', () => {
    const justBefore = evaluateSendWindow({
      lastCustomerMessageAtUtc: last,
      now: at(STANDARD_WINDOW_MS - 1),
      senderKind: 'ai',
      humanAgentEnabled: false,
    });
    expect(justBefore).toEqual({ allowed: true, tag: null, remainingMs: 1 });

    const exactly = evaluateSendWindow({
      lastCustomerMessageAtUtc: last,
      now: at(STANDARD_WINDOW_MS),
      senderKind: 'ai',
      humanAgentEnabled: false,
    });
    expect(exactly).toEqual({ allowed: false, reason: 'window_expired' });
  });

  it('la IA nunca usa la etiqueta Human Agent, aunque esté habilitada', () => {
    expect(
      evaluateSendWindow({
        lastCustomerMessageAtUtc: last,
        now: at(STANDARD_WINDOW_MS + 1),
        senderKind: 'ai',
        humanAgentEnabled: true,
      }),
    ).toEqual({ allowed: false, reason: 'window_expired' });
  });

  it('un humano puede usar Human Agent hasta 7 días solo si está habilitada', () => {
    expect(
      evaluateSendWindow({
        lastCustomerMessageAtUtc: last,
        now: at(STANDARD_WINDOW_MS + 1),
        senderKind: 'human',
        humanAgentEnabled: true,
      }),
    ).toMatchObject({ allowed: true, tag: 'HUMAN_AGENT' });

    expect(
      evaluateSendWindow({
        lastCustomerMessageAtUtc: last,
        now: at(STANDARD_WINDOW_MS + 1),
        senderKind: 'human',
        humanAgentEnabled: false,
      }),
    ).toEqual({ allowed: false, reason: 'window_expired' });

    expect(
      evaluateSendWindow({
        lastCustomerMessageAtUtc: last,
        now: at(HUMAN_AGENT_WINDOW_MS),
        senderKind: 'human',
        humanAgentEnabled: true,
      }),
    ).toEqual({ allowed: false, reason: 'window_expired' });
  });

  it('tolera un reloj del proveedor ligeramente adelantado', () => {
    expect(
      evaluateSendWindow({
        lastCustomerMessageAtUtc: last,
        now: at(-5_000),
        senderKind: 'ai',
        humanAgentEnabled: false,
      }),
    ).toMatchObject({ allowed: true, tag: null });
  });
});
