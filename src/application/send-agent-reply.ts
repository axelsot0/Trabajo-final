import type { Employee } from '../domain/employee.ts';
import type { Id } from '../domain/ids.ts';
import type { DispatchItemResult } from './dispatch-outbox.ts';
import type { DispatchOutbox } from './dispatch-outbox.ts';
import type { QueueOutboundText, QueueOutboundTextResult } from './queue-outbound-text.ts';

export type SendAgentReplyResult =
  | { ok: true; outcome: DispatchItemResult['outcome']; code: string | null; messageId: Id }
  | { ok: false; reason: Extract<QueueOutboundTextResult, { ok: false }>['reason'] };

/**
 * Respuesta de un agente a un cliente: se encola con las revalidaciones de
 * QueueOutboundText y se despacha en el acto para devolverle al agente un resultado
 * concreto (enviado, ventana vencida, reintento programado, incierto...).
 */
export class SendAgentReply {
  constructor(
    private readonly queue: QueueOutboundText,
    private readonly dispatch: DispatchOutbox,
  ) {}

  async execute(
    employee: Employee,
    conversationId: Id,
    text: string,
  ): Promise<SendAgentReplyResult> {
    const queued = await this.queue.execute({
      conversationId,
      text,
      senderKind: 'human',
      senderEmployeeId: employee.id,
      origin: 'telegram',
    });
    if (!queued.ok) return queued;

    const summary = await this.dispatch.run(20);
    const mine = summary.results.find((r) => r.outboxId === queued.outboxId);
    if (mine === undefined) {
      // Otro despacho (cron) lo reclamó antes; el estado real está en el outbox.
      return {
        ok: true,
        outcome: 'retry_scheduled',
        code: 'claimed_elsewhere',
        messageId: queued.messageId,
      };
    }
    return { ok: true, outcome: mine.outcome, code: mine.code, messageId: queued.messageId };
  }
}
