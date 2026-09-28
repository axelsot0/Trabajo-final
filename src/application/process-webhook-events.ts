import { metaInboundEventSchema } from '../adapters/meta/webhook-schema.ts';
import { telegramMinimalUpdateSchema } from '../adapters/telegram/update-schema.ts';
import { toIsoUtc } from '../domain/time.ts';
import type { WebhookEvent } from '../domain/webhook-event.ts';
import type { Clock } from '../ports/clock.ts';
import type { ConversationRepository, WebhookEventRepository } from '../ports/repositories.ts';
import type { HandleTelegramUpdate } from './handle-telegram-update.ts';
import type { ReceiveCustomerMessage } from './receive-customer-message.ts';
import type { ReconcileEcho } from './reconcile-echo.ts';
import type { TelegramNotifier } from './telegram-notifier.ts';

export interface ProcessSummary {
  claimed: number;
  done: number;
  ignored: number;
  failed: number;
}

export interface ProcessDeps {
  webhookEvents: WebhookEventRepository;
  conversations: ConversationRepository;
  receiveCustomerMessage: ReceiveCustomerMessage;
  reconcileEcho: ReconcileEcho;
  handleTelegramUpdate: HandleTelegramUpdate;
  notifier: TelegramNotifier;
  clock: Clock;
  maxAttempts?: number;
}

/**
 * Procesa eventos pendientes reclamándolos de forma atómica. Se invoca desde
 * `ctx.waitUntil` tras cada webhook y desde el Cron Trigger como barrido de
 * seguridad; ambos pueden coincidir sin duplicar trabajo.
 */
export class ProcessPendingWebhookEvents {
  private readonly maxAttempts: number;

  constructor(private readonly deps: ProcessDeps) {
    this.maxAttempts = deps.maxAttempts ?? 5;
  }

  async run(limit = 25): Promise<ProcessSummary> {
    const events = await this.deps.webhookEvents.claimPending(limit);
    const summary: ProcessSummary = { claimed: events.length, done: 0, ignored: 0, failed: 0 };
    for (const event of events) {
      const status = await this.processOne(event);
      summary[status] += 1;
    }
    return summary;
  }

  /**
   * Avisa por Telegram sin bloquear el procesamiento: si Telegram falla, el evento
   * sigue `done` (el mensaje ya está guardado) y `/chats` muestra la cola.
   */
  private async notifyAgents(conversationId: string, justEscalated: boolean): Promise<void> {
    try {
      const conversation = await this.deps.conversations.findById(conversationId);
      if (conversation === null) return;
      if (conversation.mode === 'PENDING_HUMAN' && justEscalated) {
        await this.deps.notifier.notifyPending(conversationId);
      } else if (conversation.mode === 'HUMAN' && conversation.assignedEmployeeId !== null) {
        await this.deps.notifier.notifyAssigned(conversationId, conversation.assignedEmployeeId);
      }
    } catch (err) {
      console.warn('notify_agents_failed', {
        conversationId,
        error: err instanceof Error ? err.name : 'unknown',
      });
    }
  }

  private async processOne(event: WebhookEvent): Promise<'done' | 'ignored' | 'failed'> {
    const { webhookEvents, clock } = this.deps;
    const nowUtc = toIsoUtc(clock.now());
    try {
      if (event.provider === 'telegram') {
        const update = telegramMinimalUpdateSchema.safeParse(JSON.parse(event.payloadMinimal));
        if (!update.success) {
          await webhookEvents.markFailed(event.id, 'invalid_payload', 0);
          return 'failed';
        }
        const outcome = await this.deps.handleTelegramUpdate.execute(update.data);
        if (outcome === 'handled') {
          await webhookEvents.markDone(event.id, nowUtc);
          return 'done';
        }
        await webhookEvents.markIgnored(event.id, outcome, nowUtc);
        return 'ignored';
      }
      const parsed = metaInboundEventSchema.safeParse(JSON.parse(event.payloadMinimal));
      if (!parsed.success) {
        await webhookEvents.markFailed(event.id, 'invalid_payload', 0);
        return 'failed';
      }
      const inbound = parsed.data;
      switch (inbound.kind) {
        case 'message': {
          const result = await this.deps.receiveCustomerMessage.execute({
            igAccountUserId: inbound.igAccountUserId,
            senderScopedId: inbound.senderScopedId,
            externalMessageId: inbound.mid,
            providerTimestampMs: inbound.timestampMs,
            text: inbound.text,
            attachments: inbound.attachments,
            isUnsupported: inbound.isUnsupported,
            isDeleted: inbound.isDeleted,
          });
          if (result.outcome === 'stored') {
            await this.notifyAgents(result.conversationId, result.escalated !== null);
          }
          if (result.outcome === 'stored' || result.outcome === 'duplicate') {
            await webhookEvents.markDone(event.id, nowUtc);
            return 'done';
          }
          await webhookEvents.markIgnored(event.id, result.outcome, nowUtc);
          return 'ignored';
        }
        case 'postback':
          // Los botones de Instagram no forman parte del MVP; se conserva el evento.
          await webhookEvents.markIgnored(event.id, 'postback_not_supported', nowUtc);
          return 'ignored';
        case 'echo': {
          const outcome = await this.deps.reconcileEcho.execute({
            igAccountUserId: inbound.igAccountUserId,
            recipientScopedId: inbound.recipientScopedId,
            mid: inbound.mid,
            timestampMs: inbound.timestampMs,
            text: inbound.text,
          });
          if (outcome === 'unknown_account' || outcome === 'no_conversation') {
            await webhookEvents.markIgnored(event.id, `echo_${outcome}`, nowUtc);
            return 'ignored';
          }
          await webhookEvents.markDone(event.id, nowUtc);
          return 'done';
        }
        case 'read':
        case 'reaction':
        case 'unknown':
          await webhookEvents.markIgnored(event.id, inbound.kind, nowUtc);
          return 'ignored';
      }
    } catch (err) {
      console.error('webhook_event_failed', {
        eventId: event.id,
        attempts: event.attempts,
        error: err instanceof Error ? err.name : 'unknown',
      });
      await webhookEvents.markFailed(event.id, 'processing_error', this.maxAttempts);
      return 'failed';
    }
  }
}
