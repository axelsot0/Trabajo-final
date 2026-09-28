import { DomainError } from './errors.ts';
import type { Id } from './ids.ts';
import type { IsoUtc } from './time.ts';

export type ConversationMode = 'BOT' | 'PENDING_HUMAN' | 'HUMAN' | 'CLOSED';

/** Motivo separado del estado; explica por qué la conversación está donde está. */
export type ModeReason =
  | 'new_conversation'
  | 'requested_human'
  | 'low_confidence'
  | 'complaint'
  | 'sensitive_topic'
  | 'attachment'
  | 'unknown_content'
  | 'ai_unavailable'
  | 'ai_budget_exhausted'
  | 'ai_mode_off'
  | 'ai_review_required'
  | 'window_expired'
  | 'price_negotiation'
  | 'bulk_purchase'
  | 'ready_to_buy'
  | 'out_of_scope'
  | 'agent_claim'
  | 'agent_transfer'
  | 'agent_release'
  | 'agent_close'
  | 'agent_return_to_ai'
  | 'customer_reopen';

export type Priority = 'alta' | 'media' | 'baja';

export type Intent =
  'precio' | 'disponibilidad' | 'pedido' | 'envio' | 'postventa' | 'reclamo' | 'saludo' | 'otro';

export type Stage = 'nuevo' | 'interesado' | 'objecion' | 'listo_para_comprar' | 'posventa';

export interface Conversation {
  id: Id;
  igAccountId: Id;
  customerId: Id;
  mode: ConversationMode;
  modeReason: ModeReason | null;
  assignedEmployeeId: Id | null;
  priority: Priority;
  intent: Intent | null;
  stage: Stage | null;
  version: number;
  lastCustomerMessageAtUtc: IsoUtc | null;
  lastMessageAtUtc: IsoUtc | null;
  openedAtUtc: IsoUtc;
  closedAtUtc: IsoUtc | null;
}

export type ConversationEvent =
  | { type: 'escalate'; reason: EscalationReason }
  | { type: 'claim'; employeeId: Id }
  | { type: 'transfer'; fromEmployeeId: Id; toEmployeeId: Id }
  | { type: 'release'; employeeId: Id }
  | { type: 'close'; employeeId: Id | null }
  /** Un agente devuelve la conversación a la IA sin cerrarla; el historial se conserva. */
  | { type: 'return_to_ai'; employeeId: Id; isOwner: boolean }
  | { type: 'customer_message'; reopenMode: 'BOT' | 'PENDING_HUMAN' };

export type EscalationReason = Extract<
  ModeReason,
  | 'requested_human'
  | 'low_confidence'
  | 'complaint'
  | 'sensitive_topic'
  | 'attachment'
  | 'unknown_content'
  | 'ai_unavailable'
  | 'ai_budget_exhausted'
  | 'ai_mode_off'
  | 'ai_review_required'
  | 'window_expired'
  | 'price_negotiation'
  | 'bulk_purchase'
  | 'ready_to_buy'
  | 'out_of_scope'
>;

export interface ModeChange {
  mode: ConversationMode;
  modeReason: ModeReason;
  assignedEmployeeId: Id | null;
  closed: boolean;
}

/**
 * Máquina de estados pura. Devuelve el cambio a aplicar o lanza `DomainError`.
 * La persistencia (versión, toma atómica) es responsabilidad del repositorio.
 */
export function transition(
  current: Pick<Conversation, 'mode' | 'assignedEmployeeId'>,
  event: ConversationEvent,
): ModeChange {
  switch (event.type) {
    case 'escalate': {
      if (current.mode === 'CLOSED') {
        throw new DomainError('conversation_closed', 'La conversación está cerrada');
      }
      if (current.mode === 'HUMAN') {
        // Ya la atiende una persona; no hay nada que escalar.
        throw new DomainError('invalid_transition', 'La conversación ya está en atención humana');
      }
      return {
        mode: 'PENDING_HUMAN',
        modeReason: event.reason,
        assignedEmployeeId: null,
        closed: false,
      };
    }
    case 'claim': {
      if (current.mode !== 'PENDING_HUMAN') {
        throw new DomainError(
          current.mode === 'HUMAN' ? 'already_assigned' : 'invalid_transition',
          'Solo se puede tomar una conversación pendiente de humano',
        );
      }
      return {
        mode: 'HUMAN',
        modeReason: 'agent_claim',
        assignedEmployeeId: event.employeeId,
        closed: false,
      };
    }
    case 'transfer': {
      assertAssignedTo(current, event.fromEmployeeId);
      if (event.fromEmployeeId === event.toEmployeeId) {
        throw new DomainError('invalid_transition', 'No se puede transferir al mismo agente');
      }
      return {
        mode: 'HUMAN',
        modeReason: 'agent_transfer',
        assignedEmployeeId: event.toEmployeeId,
        closed: false,
      };
    }
    case 'release': {
      assertAssignedTo(current, event.employeeId);
      return {
        mode: 'PENDING_HUMAN',
        modeReason: 'agent_release',
        assignedEmployeeId: null,
        closed: false,
      };
    }
    case 'close': {
      if (current.mode === 'CLOSED') {
        throw new DomainError('conversation_closed', 'La conversación ya está cerrada');
      }
      if (current.mode === 'HUMAN' && event.employeeId !== null) {
        assertAssignedTo(current, event.employeeId);
      }
      return { mode: 'CLOSED', modeReason: 'agent_close', assignedEmployeeId: null, closed: true };
    }
    case 'return_to_ai': {
      if (current.mode === 'PENDING_HUMAN') {
        return {
          mode: 'BOT',
          modeReason: 'agent_return_to_ai',
          assignedEmployeeId: null,
          closed: false,
        };
      }
      if (current.mode !== 'HUMAN') {
        throw new DomainError(
          current.mode === 'CLOSED' ? 'conversation_closed' : 'invalid_transition',
          'Solo una conversación en atención humana puede devolverse a la IA',
        );
      }
      // Un owner puede devolver cualquier conversación; un agente solo la suya.
      if (!event.isOwner) assertAssignedTo(current, event.employeeId);
      return {
        mode: 'BOT',
        modeReason: 'agent_return_to_ai',
        assignedEmployeeId: null,
        closed: false,
      };
    }
    case 'customer_message': {
      if (current.mode !== 'CLOSED') {
        throw new DomainError(
          'invalid_transition',
          'Un mensaje del cliente solo cambia el modo si la conversación estaba cerrada',
        );
      }
      return {
        mode: event.reopenMode,
        modeReason: 'customer_reopen',
        assignedEmployeeId: null,
        closed: false,
      };
    }
  }
}

function assertAssignedTo(
  current: Pick<Conversation, 'mode' | 'assignedEmployeeId'>,
  employeeId: Id,
): void {
  if (current.mode !== 'HUMAN' || current.assignedEmployeeId === null) {
    throw new DomainError('not_assigned', 'La conversación no tiene agente asignado');
  }
  if (current.assignedEmployeeId !== employeeId) {
    throw new DomainError('forbidden', 'La conversación está asignada a otro agente');
  }
}

/** Solo el agente asignado puede enviar, y solo en modo HUMAN. */
export function canAgentSend(
  conversation: Pick<Conversation, 'mode' | 'assignedEmployeeId'>,
  employeeId: Id,
): boolean {
  return conversation.mode === 'HUMAN' && conversation.assignedEmployeeId === employeeId;
}

/** La IA solo redacta y envía en modo BOT; en cualquier otro modo se suspende. */
export function aiMayReply(conversation: Pick<Conversation, 'mode'>): boolean {
  return conversation.mode === 'BOT';
}
