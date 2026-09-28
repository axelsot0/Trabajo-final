import { transition, type Conversation } from '../domain/conversation.ts';
import { DomainError } from '../domain/errors.ts';
import type { Employee } from '../domain/employee.ts';
import { newId, type Id } from '../domain/ids.ts';
import type { OutcomeKind } from '../domain/outcome.ts';
import { toIsoUtc } from '../domain/time.ts';
import type { Clock } from '../ports/clock.ts';
import type {
  AuditRepository,
  ConversationRepository,
  EmployeeRepository,
  OutcomeRepository,
} from '../ports/repositories.ts';

export interface AgentActionDeps {
  conversations: ConversationRepository;
  employees: EmployeeRepository;
  outcomes: OutcomeRepository;
  audit: AuditRepository;
  clock: Clock;
}

export type ClaimOutcome =
  { ok: true; conversation: Conversation } | { ok: false; reason: 'not_found' | 'not_pending' };

export type ActionFailure =
  | 'not_found'
  | 'forbidden'
  | 'not_assigned'
  | 'already_assigned'
  | 'invalid_transition'
  | 'conversation_closed'
  | 'stale_version'
  | 'target_unavailable';

export type ActionResult =
  { ok: true; conversation: Conversation } | { ok: false; reason: ActionFailure };

/**
 * Acciones de gestión que ejecutan los agentes. Cada una revalida el estado en el
 * momento de actuar, aplica la máquina de estados del dominio y deja auditoría.
 */
export class AgentActions {
  constructor(private readonly deps: AgentActionDeps) {}

  /** Toma atómica: de dos agentes concurrentes gana exactamente uno. */
  async claim(employee: Employee, conversationId: Id): Promise<ClaimOutcome> {
    const nowUtc = toIsoUtc(this.deps.clock.now());
    const result = await this.deps.conversations.claim(conversationId, employee.id, nowUtc);
    if (!result.ok) return result;
    await this.audit(
      employee,
      'conversation.claimed',
      conversationId,
      { mode: 'PENDING_HUMAN' },
      { mode: 'HUMAN' },
      nowUtc,
    );
    return result;
  }

  async transfer(employee: Employee, conversationId: Id, toEmployeeId: Id): Promise<ActionResult> {
    const conversation = await this.deps.conversations.findById(conversationId);
    if (conversation === null) return { ok: false, reason: 'not_found' };
    const target = await this.deps.employees.findById(toEmployeeId);
    if (target === null || !target.active || target.role === 'viewer') {
      return { ok: false, reason: 'target_unavailable' };
    }
    return this.apply(employee, conversation, {
      type: 'transfer',
      fromEmployeeId: employee.id,
      toEmployeeId,
    });
  }

  async release(employee: Employee, conversationId: Id): Promise<ActionResult> {
    const conversation = await this.deps.conversations.findById(conversationId);
    if (conversation === null) return { ok: false, reason: 'not_found' };
    return this.apply(employee, conversation, { type: 'release', employeeId: employee.id });
  }

  /** Devuelve la conversación a la IA sin cerrarla (owner: cualquiera; agente: la suya). */
  async returnToAi(employee: Employee, conversationId: Id): Promise<ActionResult> {
    const conversation = await this.deps.conversations.findById(conversationId);
    if (conversation === null) return { ok: false, reason: 'not_found' };
    return this.apply(employee, conversation, {
      type: 'return_to_ai',
      employeeId: employee.id,
      isOwner: employee.role === 'owner',
    });
  }

  /**
   * Cierra y registra el resultado declarado. Un `owner` puede cerrar cualquier
   * conversación; un agente solo la suya.
   */
  async close(employee: Employee, conversationId: Id, kind: OutcomeKind): Promise<ActionResult> {
    const conversation = await this.deps.conversations.findById(conversationId);
    if (conversation === null) return { ok: false, reason: 'not_found' };
    const actingAs = employee.role === 'owner' ? null : employee.id;
    const result = await this.apply(employee, conversation, {
      type: 'close',
      employeeId: actingAs,
    });
    if (!result.ok) return result;
    const nowUtc = toIsoUtc(this.deps.clock.now());
    await this.deps.outcomes.insert({
      id: newId(),
      conversationId,
      kind,
      amountMinor: null,
      currency: null,
      evidenceNote: null,
      recordedBy: employee.id,
      recordedAtUtc: nowUtc,
    });
    await this.audit(employee, 'outcome.recorded', conversationId, null, { kind }, nowUtc);
    return result;
  }

  /** Añade importe/nota al último resultado de la conversación (solo quien lo registró o un owner). */
  async recordSaleAmount(
    employee: Employee,
    conversationId: Id,
    amountMinor: number,
    currency: string,
    note: string | null,
  ): Promise<'ok' | 'no_outcome' | 'forbidden' | 'not_a_sale'> {
    const outcome = await this.deps.outcomes.findLatestForConversation(conversationId);
    if (outcome === null) return 'no_outcome';
    if (outcome.recordedBy !== employee.id && employee.role !== 'owner') return 'forbidden';
    if (outcome.kind !== 'venta_confirmada') return 'not_a_sale';
    await this.deps.outcomes.updateAmount(outcome.id, amountMinor, currency, note);
    await this.audit(
      employee,
      'outcome.amount_recorded',
      conversationId,
      { amountMinor: outcome.amountMinor, currency: outcome.currency },
      { amountMinor, currency },
      toIsoUtc(this.deps.clock.now()),
    );
    return 'ok';
  }

  private async apply(
    employee: Employee,
    conversation: Conversation,
    event: Parameters<typeof transition>[1],
  ): Promise<ActionResult> {
    let change;
    try {
      change = transition(conversation, event);
    } catch (err) {
      if (err instanceof DomainError) {
        const reason: ActionFailure =
          err.code === 'forbidden' ||
          err.code === 'not_assigned' ||
          err.code === 'already_assigned' ||
          err.code === 'invalid_transition' ||
          err.code === 'conversation_closed'
            ? err.code
            : 'invalid_transition';
        return { ok: false, reason };
      }
      throw err;
    }
    const nowUtc = toIsoUtc(this.deps.clock.now());
    const applied = await this.deps.conversations.applyModeChange(
      conversation.id,
      conversation.version,
      change,
      nowUtc,
    );
    if (!applied) return { ok: false, reason: 'stale_version' };
    await this.audit(
      employee,
      `conversation.${event.type}`,
      conversation.id,
      { mode: conversation.mode, assigned: conversation.assignedEmployeeId },
      { mode: change.mode, assigned: change.assignedEmployeeId, reason: change.modeReason },
      nowUtc,
    );
    const updated = await this.deps.conversations.findById(conversation.id);
    if (updated === null) return { ok: false, reason: 'not_found' };
    return { ok: true, conversation: updated };
  }

  private async audit(
    employee: Employee,
    action: string,
    conversationId: Id,
    before: unknown,
    after: unknown,
    atUtc: string,
  ): Promise<void> {
    await this.deps.audit.record({
      id: newId(),
      actorType: 'employee',
      actorId: employee.id,
      action,
      entityType: 'conversation',
      entityId: conversationId,
      beforeRedacted: before === null ? null : JSON.stringify(before),
      afterRedacted: after === null ? null : JSON.stringify(after),
      atUtc,
    });
  }
}
