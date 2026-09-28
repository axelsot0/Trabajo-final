import { z } from 'zod';

import type { OutboxItem } from '../domain/outbox.ts';
import { MS_PER_DAY, toIsoUtc } from '../domain/time.ts';
import type { Clock } from '../ports/clock.ts';
import type { InstagramGateway } from '../ports/instagram-gateway.ts';
import type {
  ConversationRepository,
  CustomerRepository,
  IgAccountRepository,
  MessageRepository,
  OutboxRepository,
} from '../ports/repositories.ts';

const payloadSchema = z.object({ text: z.string() }).loose();

/** Un envío incierto que no se resuelve en un día se da por fallido y se avisa. */
const GIVE_UP_AFTER_MS = MS_PER_DAY;
/** Margen para comparar `created_time` de Meta con la hora local del intento. */
const CREATED_TIME_TOLERANCE_MS = 5 * 60_000;

export interface ReconcileSummary {
  checked: number;
  confirmed: number;
  requeued: number;
  stillUncertain: number;
  failed: number;
}

export interface ReconcileDeps {
  outbox: OutboxRepository;
  messages: MessageRepository;
  conversations: ConversationRepository;
  customers: CustomerRepository;
  igAccounts: IgAccountRepository;
  gateway: InstagramGateway;
  clock: Clock;
  /** Espera mínima desde el intento incierto antes de consultar a Meta. */
  minAgeMs?: number;
}

/**
 * Resuelve envíos con acuse incierto (timeout/red). Primero mira si un eco del
 * webhook ya confirmó el mensaje; si no, consulta los mensajes recientes de la
 * conversación en Meta. Solo si Meta no muestra el texto se vuelve a encolar.
 */
export class ReconcileUncertainOutbox {
  private readonly minAgeMs: number;

  constructor(private readonly deps: ReconcileDeps) {
    this.minAgeMs = deps.minAgeMs ?? 60_000;
  }

  async run(limit = 20): Promise<ReconcileSummary> {
    const now = this.deps.clock.now();
    const cutoff = toIsoUtc(new Date(now.getTime() - this.minAgeMs));
    const items = await this.deps.outbox.listUncertain(cutoff, limit);
    const summary: ReconcileSummary = {
      checked: items.length,
      confirmed: 0,
      requeued: 0,
      stillUncertain: 0,
      failed: 0,
    };
    for (const item of items) {
      const outcome = await this.reconcileOne(item, now);
      summary[outcome] += 1;
    }
    return summary;
  }

  private async reconcileOne(
    item: OutboxItem,
    now: Date,
  ): Promise<'confirmed' | 'requeued' | 'stillUncertain' | 'failed'> {
    const nowUtc = toIsoUtc(now);

    // 1) Un eco ya pudo confirmar el mensaje (ver ProcessPendingWebhookEvents).
    const message =
      item.messageId === null ? null : await this.deps.messages.findById(item.messageId);
    if (message?.deliveryStatus === 'sent' && message.externalMessageId !== null) {
      await this.deps.outbox.markSent(item.id, message.externalMessageId, nowUtc);
      return 'confirmed';
    }

    const payload = payloadSchema.safeParse(JSON.parse(item.payloadMinimal));
    const conversation = await this.deps.conversations.findById(item.conversationId);
    const account =
      conversation === null ? null : await this.deps.igAccounts.findById(conversation.igAccountId);
    const customer =
      conversation === null ? null : await this.deps.customers.findById(conversation.customerId);
    if (!payload.success || conversation === null || account === null || customer === null) {
      await this.giveUp(item, 'unreconcilable', nowUtc);
      return 'failed';
    }

    // 2) Preguntar a Meta por los mensajes recientes de la conversación.
    const remote = await this.deps.gateway.listRecentMessages({
      igUserId: account.igUserId,
      tokenReference: account.tokenReference,
      recipientId: customer.igScopedId,
    });
    if (!remote.ok) {
      if (now.getTime() - new Date(item.createdAtUtc).getTime() > GIVE_UP_AFTER_MS) {
        await this.giveUp(item, 'unreconciled_timeout', nowUtc);
        return 'failed';
      }
      return 'stillUncertain';
    }

    const attemptedAt = new Date(item.updatedAtUtc).getTime() - CREATED_TIME_TOLERANCE_MS;
    const match = remote.messages.find(
      (m) =>
        m.fromId === account.igUserId &&
        m.text === payload.data.text &&
        (m.createdTimeUtc === null || new Date(m.createdTimeUtc).getTime() >= attemptedAt),
    );
    if (match) {
      await this.deps.outbox.markSent(item.id, match.mid, nowUtc);
      if (message !== null) await this.deps.messages.updateDelivery(message.id, 'sent', match.mid);
      await this.deps.conversations.touchOutbound(conversation.id, nowUtc);
      return 'confirmed';
    }

    // 3) Meta no lo tiene: es seguro reintentar una vez más.
    await this.deps.outbox.scheduleRetry(item.id, 'reconciled_not_found', nowUtc, nowUtc);
    if (message !== null) await this.deps.messages.updateDelivery(message.id, 'queued', null);
    return 'requeued';
  }

  private async giveUp(item: OutboxItem, code: string, nowUtc: string): Promise<void> {
    await this.deps.outbox.markFailed(item.id, code, nowUtc);
    if (item.messageId !== null)
      await this.deps.messages.updateDelivery(item.messageId, 'failed', null);
  }
}
