import { describe, expect, it } from 'vitest';

import {
  aiMayReply,
  canAgentSend,
  transition,
  type Conversation,
} from '../../src/domain/conversation.ts';
import { DomainError } from '../../src/domain/errors.ts';

type State = Pick<Conversation, 'mode' | 'assignedEmployeeId'>;
const bot: State = { mode: 'BOT', assignedEmployeeId: null };
const pending: State = { mode: 'PENDING_HUMAN', assignedEmployeeId: null };
const human: State = { mode: 'HUMAN', assignedEmployeeId: 'emp-1' };
const closed: State = { mode: 'CLOSED', assignedEmployeeId: null };

function expectDomainError(fn: () => unknown, code: DomainError['code']): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe(code);
    return;
  }
  throw new Error(`Se esperaba DomainError ${code}`);
}

describe('transition', () => {
  it('BOT → PENDING_HUMAN al escalar, conservando el motivo', () => {
    const change = transition(bot, { type: 'escalate', reason: 'low_confidence' });
    expect(change).toEqual({
      mode: 'PENDING_HUMAN',
      modeReason: 'low_confidence',
      assignedEmployeeId: null,
      closed: false,
    });
  });

  it('no escala una conversación ya en HUMAN ni una cerrada', () => {
    expectDomainError(
      () => transition(human, { type: 'escalate', reason: 'complaint' }),
      'invalid_transition',
    );
    expectDomainError(
      () => transition(closed, { type: 'escalate', reason: 'complaint' }),
      'conversation_closed',
    );
  });

  it('PENDING_HUMAN → HUMAN al tomar; tomar en otro modo falla', () => {
    expect(transition(pending, { type: 'claim', employeeId: 'emp-1' })).toMatchObject({
      mode: 'HUMAN',
      assignedEmployeeId: 'emp-1',
      modeReason: 'agent_claim',
    });
    expectDomainError(
      () => transition(human, { type: 'claim', employeeId: 'emp-2' }),
      'already_assigned',
    );
    expectDomainError(
      () => transition(bot, { type: 'claim', employeeId: 'emp-2' }),
      'invalid_transition',
    );
  });

  it('solo el agente asignado transfiere o libera', () => {
    expect(
      transition(human, { type: 'transfer', fromEmployeeId: 'emp-1', toEmployeeId: 'emp-2' }),
    ).toMatchObject({ mode: 'HUMAN', assignedEmployeeId: 'emp-2', modeReason: 'agent_transfer' });
    expectDomainError(
      () => transition(human, { type: 'transfer', fromEmployeeId: 'emp-9', toEmployeeId: 'emp-2' }),
      'forbidden',
    );
    expectDomainError(
      () => transition(human, { type: 'transfer', fromEmployeeId: 'emp-1', toEmployeeId: 'emp-1' }),
      'invalid_transition',
    );
    expect(transition(human, { type: 'release', employeeId: 'emp-1' })).toMatchObject({
      mode: 'PENDING_HUMAN',
      assignedEmployeeId: null,
    });
    expectDomainError(
      () => transition(pending, { type: 'release', employeeId: 'emp-1' }),
      'not_assigned',
    );
  });

  it('cerrar libera la asignación y marca cierre; cerrar dos veces falla', () => {
    expect(transition(human, { type: 'close', employeeId: 'emp-1' })).toEqual({
      mode: 'CLOSED',
      modeReason: 'agent_close',
      assignedEmployeeId: null,
      closed: true,
    });
    expect(transition(bot, { type: 'close', employeeId: null })).toMatchObject({ closed: true });
    expectDomainError(() => transition(human, { type: 'close', employeeId: 'emp-2' }), 'forbidden');
    expectDomainError(
      () => transition(closed, { type: 'close', employeeId: null }),
      'conversation_closed',
    );
  });

  it('un mensaje del cliente reabre una conversación cerrada según la política', () => {
    expect(transition(closed, { type: 'customer_message', reopenMode: 'BOT' })).toMatchObject({
      mode: 'BOT',
      modeReason: 'customer_reopen',
    });
    expectDomainError(
      () => transition(human, { type: 'customer_message', reopenMode: 'BOT' }),
      'invalid_transition',
    );
  });
});

describe('reglas de envío', () => {
  it('solo el asignado envía en HUMAN', () => {
    expect(canAgentSend(human, 'emp-1')).toBe(true);
    expect(canAgentSend(human, 'emp-2')).toBe(false);
    expect(canAgentSend(pending, 'emp-1')).toBe(false);
  });

  it('la IA solo responde en BOT', () => {
    expect(aiMayReply(bot)).toBe(true);
    expect(aiMayReply(pending)).toBe(false);
    expect(aiMayReply(human)).toBe(false);
    expect(aiMayReply(closed)).toBe(false);
  });
});
