import { z } from 'zod';

import { MissingSecretError } from '../config.ts';
import { canAgentSend } from '../domain/conversation.ts';
import { newId } from '../domain/ids.ts';
import { evaluateSendWindow } from '../domain/messaging-window.ts';
import { nextRetryDelayMs, type OutboxItem, type SendTextPayload } from '../domain/outbox.ts';
import { toIsoUtc } from '../domain/time.ts';
import type { Clock } from '../ports/clock.ts';
import type { InstagramGateway } from '../ports/instagram-gateway.ts';
import type {
  AuditRepository,
  ConversationRepository,
  CustomerRepository,
  IgAccountRepository,
  MessageRepository,
  OutboxRepository,
} from '../ports/repositories.ts';

const sendTextPayloadSchema: z.ZodType<SendTextPayload> = z.object({
  text: z.string().min(1),
  senderKind: z.enum(['ai', 'human']),
  senderEmployeeId: z.string().nullable(),
});

export type DispatchItemOutcome = 'sent' | 'retry_scheduled' | 'failed' | 'cancelled' | 'uncertain';

export interface DispatchItemResult {
  outboxId: string;
  conversationId: string;
  messageId: string | null;
  outcome: DispatchItemOutcome;
  code: string | null;
}

export interface DispatchSummary {
  claimed: number;
  results: DispatchItemResult[];
}

export interface DispatchOutboxDeps {
  outbox: OutboxRepository;
  messages: MessageRepository;
  conversations: ConversationRepository;
  customers: CustomerRepository;
  igAccounts: IgAccountRepository;
  audit: AuditRepository;
  gateway: InstagramGateway;
  clock: Clock;
}

/**
 * Despacha el outbox hacia Instagram. Antes de cada envío relee conversación,
 * asignación y ventana; ante resultado incierto no reintenta: deja el elemento en
 * `uncertain` para que la conciliación decida (nunca dos respuestas por un timeout).
 */
export class DispatchOutbox {
  constructor(private readonly deps: DispatchOutboxDeps) {}

  async run(limit = 20): Promise<DispatchSummary> {
    const nowUtc = toIsoUtc(this.deps.clock.now());
    const items = await this.deps.outbox.claimDue(nowUtc, limit);
    const results: DispatchItemResult[] = [];
    for (const item of items) results.push(await this.dispatchOne(item));
    return { claimed: items.length, results };
  }

  private async dispatchOne(item: OutboxItem): Promise<DispatchItemResult> {
    const base = {
      outboxId: item.id,
      conversationId: item.conversationId,
      messageId: item.messageId,
    };
    const done = (outcome: DispatchItemOutcome, code: string | null): DispatchItemResult => ({
      ...base,
      outcome,
      code,
    });
    const now = this.deps.clock.now();
    const nowUtc = toIsoUtc(now);

    try {
      const payload = sendTextPayloadSchema.safeParse(JSON.parse(item.payloadMinimal));
      if (!payload.success)
        return done(await this.fail(item, 'invalid_payload', nowUtc), 'invalid_payload');
      const { text, senderKind, senderEmployeeId } = payload.data;

      const conversation = await this.deps.conversations.findById(item.conversationId);
      if (conversation === null) {
        return done(
          await this.cancel(item, 'conversation_not_found', nowUtc),
          'conversation_not_found',
        );
      }
      if (senderKind === 'ai') {
        // La IA solo envía si la conversación sigue exactamente como cuando redactó.
        if (conversation.mode !== 'BOT' || conversation.version !== item.conversationVersion) {
          return done(await this.cancel(item, 'stale_conversation', nowUtc), 'stale_conversation');
        }
      } else if (senderEmployeeId === null || !canAgentSend(conversation, senderEmployeeId)) {
        return done(await this.cancel(item, 'not_assigned', nowUtc), 'not_assigned');
      }

      const account = await this.deps.igAccounts.findById(conversation.igAccountId);
      if (account?.status !== 'active') {
        return done(await this.fail(item, 'account_unavailable', nowUtc), 'account_unavailable');
      }
      const customer = await this.deps.customers.findById(conversation.customerId);
      if (customer === null)
        return done(await this.fail(item, 'customer_not_found', nowUtc), 'customer_not_found');

      const window = evaluateSendWindow({
        lastCustomerMessageAtUtc: conversation.lastCustomerMessageAtUtc,
        now,
        senderKind,
        humanAgentEnabled: account.humanAgentEnabled,
      });
      if (!window.allowed)
        return done(await this.cancel(item, window.reason, nowUtc), window.reason);

      const result = await this.deps.gateway.sendText({
        igUserId: account.igUserId,
        tokenReference: account.tokenReference,
        recipientId: customer.igScopedId,
        text,
        humanAgentTag: window.tag === 'HUMAN_AGENT',
      });

      if (result.ok) {
        await this.deps.outbox.markSent(item.id, result.messageId, nowUtc);
        if (item.messageId !== null) {
          await this.deps.messages.updateDelivery(item.messageId, 'sent', result.messageId);
        }
        await this.deps.conversations.touchOutbound(conversation.id, nowUtc);
        return done('sent', null);
      }

      if (result.kind === 'uncertain') {
        await this.deps.outbox.markUncertain(item.id, result.errorCode, nowUtc);
        if (item.messageId !== null) {
          await this.deps.messages.updateDelivery(item.messageId, 'uncertain', null);
        }
        return done('uncertain', result.errorCode);
      }

      if (result.tokenInvalid) {
        await this.deps.igAccounts.setStatus(account.id, 'token_invalid', nowUtc);
      }
      if (result.retryable) {
        const delay = nextRetryDelayMs(item.attempts);
        if (delay !== null) {
          const retryAt = toIsoUtc(new Date(now.getTime() + delay));
          await this.deps.outbox.scheduleRetry(item.id, result.errorCode, retryAt, nowUtc);
          return done('retry_scheduled', result.errorCode);
        }
      }
      return done(await this.fail(item, result.errorCode, nowUtc), result.errorCode);
    } catch (err) {
      if (err instanceof MissingSecretError) {
        return done(await this.fail(item, 'not_configured', nowUtc), 'not_configured');
      }
      console.error('outbox_dispatch_error', {
        outboxId: item.id,
        error: err instanceof Error ? err.name : 'unknown',
      });
      const delay = nextRetryDelayMs(item.attempts);
      if (delay === null)
        return done(await this.fail(item, 'dispatch_error', nowUtc), 'dispatch_error');
      await this.deps.outbox.scheduleRetry(
        item.id,
        'dispatch_error',
        toIsoUtc(new Date(now.getTime() + delay)),
        nowUtc,
      );
      return done('retry_scheduled', 'dispatch_error');
    }
  }

  private async fail(item: OutboxItem, code: string, nowUtc: string): Promise<'failed'> {
    await this.deps.outbox.markFailed(item.id, code, nowUtc);
    if (item.messageId !== null)
      await this.deps.messages.updateDelivery(item.messageId, 'failed', null);
    await this.audit('outbox.failed', item, code, nowUtc);
    return 'failed';
  }

  private async cancel(item: OutboxItem, code: string, nowUtc: string): Promise<'cancelled'> {
    await this.deps.outbox.markCancelled(item.id, code, nowUtc);
    if (item.messageId !== null)
      await this.deps.messages.updateDelivery(item.messageId, 'failed', null);
    await this.audit('outbox.cancelled', item, code, nowUtc);
    return 'cancelled';
  }

  private async audit(
    action: string,
    item: OutboxItem,
    code: string,
    nowUtc: string,
  ): Promise<void> {
    await this.deps.audit.record({
      id: newId(),
      actorType: 'system',
      actorId: null,
      action,
      entityType: 'conversation',
      entityId: item.conversationId,
      beforeRedacted: null,
      afterRedacted: JSON.stringify({ outboxId: item.id, code }),
      atUtc: nowUtc,
    });
  }
}
