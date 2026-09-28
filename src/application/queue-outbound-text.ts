import { aiMayReply, canAgentSend } from '../domain/conversation.ts';
import { newId, type Id } from '../domain/ids.ts';
import type { Message, MessageOrigin } from '../domain/message.ts';
import { evaluateSendWindow } from '../domain/messaging-window.ts';
import type { OutboxItem, SendTextPayload } from '../domain/outbox.ts';
import { toIsoUtc } from '../domain/time.ts';
import type { Clock } from '../ports/clock.ts';
import type {
  ConversationRepository,
  IgAccountRepository,
  MessageRepository,
  OutboxRepository,
} from '../ports/repositories.ts';

/** Límite de la Messaging API de Instagram para texto. */
export const INSTAGRAM_TEXT_MAX_CHARS = 1000;

export interface QueueOutboundTextInput {
  conversationId: Id;
  text: string;
  senderKind: 'ai' | 'human';
  senderEmployeeId: Id | null;
  origin: Extract<MessageOrigin, 'ai' | 'telegram' | 'system'>;
  replyToMessageId?: Id | null;
}

export type QueueOutboundTextResult =
  | { ok: true; messageId: Id; outboxId: Id }
  | {
      ok: false;
      reason:
        | 'conversation_not_found'
        | 'conversation_closed'
        | 'not_allowed'
        | 'window_expired'
        | 'no_customer_message'
        | 'empty_text'
        | 'text_too_long'
        | 'account_unavailable';
    };

export interface QueueOutboundTextDeps {
  conversations: ConversationRepository;
  igAccounts: IgAccountRepository;
  messages: MessageRepository;
  outbox: OutboxRepository;
  clock: Clock;
}

/**
 * Registra un mensaje saliente en estado `queued` y lo pone en el outbox. Comprueba
 * modo, asignación y ventana como filtro temprano; el despacho vuelve a comprobarlo
 * todo justo antes de llamar a Meta.
 */
export class QueueOutboundText {
  constructor(private readonly deps: QueueOutboundTextDeps) {}

  async execute(input: QueueOutboundTextInput): Promise<QueueOutboundTextResult> {
    const text = input.text.trim();
    if (text.length === 0) return { ok: false, reason: 'empty_text' };
    if (text.length > INSTAGRAM_TEXT_MAX_CHARS) return { ok: false, reason: 'text_too_long' };

    const conversation = await this.deps.conversations.findById(input.conversationId);
    if (conversation === null) return { ok: false, reason: 'conversation_not_found' };
    if (conversation.mode === 'CLOSED') return { ok: false, reason: 'conversation_closed' };

    const allowed =
      input.senderKind === 'ai'
        ? aiMayReply(conversation)
        : input.senderEmployeeId !== null && canAgentSend(conversation, input.senderEmployeeId);
    if (!allowed) return { ok: false, reason: 'not_allowed' };

    const account = await this.deps.igAccounts.findById(conversation.igAccountId);
    if (account?.status !== 'active') {
      return { ok: false, reason: 'account_unavailable' };
    }

    const now = this.deps.clock.now();
    const window = evaluateSendWindow({
      lastCustomerMessageAtUtc: conversation.lastCustomerMessageAtUtc,
      now,
      senderKind: input.senderKind,
      humanAgentEnabled: account.humanAgentEnabled,
    });
    if (!window.allowed) return { ok: false, reason: window.reason };

    const nowUtc = toIsoUtc(now);
    const message: Message = {
      id: newId(),
      conversationId: conversation.id,
      externalMessageId: null,
      direction: 'outbound',
      origin: input.origin,
      senderEmployeeId: input.senderEmployeeId,
      body: text,
      contentType: 'text',
      attachmentRef: null,
      providerTimestampUtc: null,
      ingestedAtUtc: nowUtc,
      deliveryStatus: 'queued',
      replyToMessageId: input.replyToMessageId ?? null,
    };
    const payload: SendTextPayload = {
      text,
      senderKind: input.senderKind,
      senderEmployeeId: input.senderEmployeeId,
    };
    const item: OutboxItem = {
      id: newId(),
      conversationId: conversation.id,
      messageId: message.id,
      operation: 'instagram.send_text',
      payloadMinimal: JSON.stringify(payload),
      status: 'pending',
      retryAtUtc: null,
      attempts: 0,
      lastErrorCode: null,
      remoteMessageId: null,
      conversationVersion: conversation.version,
      createdAtUtc: nowUtc,
      updatedAtUtc: nowUtc,
    };

    await this.deps.messages.insert(message);
    await this.deps.outbox.enqueue(item);
    return { ok: true, messageId: message.id, outboxId: item.id };
  }
}
