import type { MetaAttachmentRef } from '../adapters/meta/webhook-schema.ts';
import { transition, type Conversation, type EscalationReason } from '../domain/conversation.ts';
import { newId } from '../domain/ids.ts';
import type { ContentType, Message } from '../domain/message.ts';
import type { Customer } from '../domain/customer.ts';
import type { IgAccount } from '../domain/ig-account.ts';
import { fromIsoUtc, fromUnixMillis, MS_PER_DAY, toIsoUtc } from '../domain/time.ts';
import type { Clock } from '../ports/clock.ts';
import type { InstagramGateway } from '../ports/instagram-gateway.ts';
import type {
  AuditRepository,
  ConversationRepository,
  CustomerRepository,
  IgAccountRepository,
  MessageRepository,
} from '../ports/repositories.ts';

export interface InboundCustomerMessage {
  igAccountUserId: string;
  senderScopedId: string;
  externalMessageId: string;
  providerTimestampMs: number;
  text: string | null;
  attachments: MetaAttachmentRef[];
  isUnsupported: boolean;
  isDeleted: boolean;
}

export interface ReceivePolicy {
  /** `false` cuando AI_MODE=off o AI_PROVIDER=disabled: todo nuevo mensaje va a humanos. */
  aiEnabled: boolean;
}

export type ReceiveOutcome =
  | {
      outcome: 'stored';
      conversationId: string;
      messageId: string;
      escalated: EscalationReason | null;
    }
  | { outcome: 'duplicate'; conversationId: string | null }
  | { outcome: 'unknown_account' }
  | { outcome: 'account_disabled' }
  | { outcome: 'deleted_message' };

export interface ReceiveDeps {
  igAccounts: IgAccountRepository;
  customers: CustomerRepository;
  conversations: ConversationRepository;
  messages: MessageRepository;
  audit: AuditRepository;
  clock: Clock;
  /** Para pedir nombre y usuario del cliente a Instagram; opcional en pruebas. */
  profiles?: Pick<InstagramGateway, 'getUserProfile'>;
}

const knownContentTypes: Record<string, ContentType> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  file: 'file',
  share: 'share',
  story_mention: 'story_mention',
  reel: 'reel',
  ig_reel: 'reel',
};

function classifyContent(input: InboundCustomerMessage): ContentType {
  if (input.attachments.length > 0) {
    const first = input.attachments[0];
    if (first === undefined) return 'unknown';
    return knownContentTypes[first.type] ?? 'unknown';
  }
  if (input.isUnsupported) return 'unknown';
  return input.text !== null ? 'text' : 'unknown';
}

/**
 * Caso de uso: registrar un DM entrante. Idempotente por `externalMessageId`.
 * Abre o reutiliza la conversación del cliente, actualiza la ventana de 24 h y,
 * si la conversación está en BOT, decide si escala a humano de inmediato
 * (adjuntos, contenido desconocido o IA apagada). La IA generativa se engancha en
 * una fase posterior sobre las conversaciones que permanezcan en BOT.
 */
export class ReceiveCustomerMessage {
  constructor(
    private readonly deps: ReceiveDeps,
    private readonly policy: ReceivePolicy,
  ) {}

  async execute(input: InboundCustomerMessage): Promise<ReceiveOutcome> {
    const { igAccounts, customers, conversations, messages, audit, clock } = this.deps;

    const account = await igAccounts.findByIgUserId(input.igAccountUserId);
    if (account === null) return { outcome: 'unknown_account' };
    if (account.status === 'disabled') return { outcome: 'account_disabled' };

    const existing = await messages.findByExternalId(input.externalMessageId);
    if (existing !== null) return { outcome: 'duplicate', conversationId: existing.conversationId };

    if (input.isDeleted) return { outcome: 'deleted_message' };

    const nowUtc = toIsoUtc(clock.now());
    const providerUtc = toIsoUtc(fromUnixMillis(input.providerTimestampMs));

    const customer = await customers.findOrCreate({
      id: newId(),
      igAccountId: account.id,
      igScopedId: input.senderScopedId,
      displayName: null,
      username: null,
      profileCheckedAtUtc: null,
      createdAtUtc: nowUtc,
    });
    await this.refreshProfile(account, customer, nowUtc);

    // Política del MVP: una conversación cerrada no se reabre; un nuevo DM inicia un
    // nuevo ciclo de atención. La reapertura queda disponible en el dominio si el
    // negocio la prefiere más adelante.
    const conversation = await conversations.insertIfNoneOpen({
      id: newId(),
      igAccountId: account.id,
      customerId: customer.id,
      mode: 'BOT',
      modeReason: 'new_conversation',
      assignedEmployeeId: null,
      priority: 'media',
      intent: null,
      stage: null,
      version: 1,
      lastCustomerMessageAtUtc: providerUtc,
      lastMessageAtUtc: providerUtc,
      openedAtUtc: nowUtc,
      closedAtUtc: null,
    });

    const contentType = classifyContent(input);
    const message: Message = {
      id: newId(),
      conversationId: conversation.id,
      externalMessageId: input.externalMessageId,
      direction: 'inbound',
      origin: 'instagram',
      senderEmployeeId: null,
      body: input.text,
      contentType,
      attachmentRef: input.attachments.length > 0 ? JSON.stringify(input.attachments) : null,
      providerTimestampUtc: providerUtc,
      ingestedAtUtc: nowUtc,
      deliveryStatus: 'received',
      replyToMessageId: null,
    };
    const { inserted } = await messages.insertIfNew(message);
    if (!inserted) return { outcome: 'duplicate', conversationId: conversation.id };

    await conversations.touchCustomerMessage(conversation.id, providerUtc);

    const escalated = await this.maybeEscalate(conversation, contentType, nowUtc, audit);
    return { outcome: 'stored', conversationId: conversation.id, messageId: message.id, escalated };
  }

  /**
   * Nombre y usuario para las tarjetas de los agentes. Nunca bloquea la recepción:
   * si Meta falla, se reintenta como mucho una vez al día.
   */
  private async refreshProfile(
    account: IgAccount,
    customer: Customer,
    nowUtc: string,
  ): Promise<void> {
    const profiles = this.deps.profiles;
    if (profiles === undefined) return;
    if (customer.displayName !== null || customer.username !== null) return;
    if (
      customer.profileCheckedAtUtc !== null &&
      fromIsoUtc(nowUtc).getTime() - fromIsoUtc(customer.profileCheckedAtUtc).getTime() < MS_PER_DAY
    ) {
      return;
    }
    try {
      const result = await profiles.getUserProfile({
        tokenReference: account.tokenReference,
        scopedId: customer.igScopedId,
      });
      if (!result.ok) console.warn('ig_profile_unavailable', { code: result.errorCode });
      await this.deps.customers.updateProfile(
        customer.id,
        result.ok
          ? { displayName: result.name, username: result.username }
          : { displayName: null, username: null },
        nowUtc,
      );
    } catch (err) {
      console.warn('ig_profile_failed', { error: err instanceof Error ? err.name : 'unknown' });
    }
  }

  private async maybeEscalate(
    conversation: Conversation,
    contentType: ContentType,
    nowUtc: string,
    audit: AuditRepository,
  ): Promise<EscalationReason | null> {
    if (conversation.mode !== 'BOT') return null;

    let reason: EscalationReason | null = null;
    if (contentType === 'unknown') reason = 'unknown_content';
    else if (contentType !== 'text') reason = 'attachment';
    else if (!this.policy.aiEnabled) reason = 'ai_mode_off';
    if (reason === null) return null;

    const change = transition(conversation, { type: 'escalate', reason });
    const applied = await this.deps.conversations.applyModeChange(
      conversation.id,
      conversation.version,
      change,
      nowUtc,
    );
    if (!applied) return null; // Otra operación cambió la conversación; no forzamos nada.

    await audit.record({
      id: newId(),
      actorType: 'system',
      actorId: null,
      action: 'conversation.escalated',
      entityType: 'conversation',
      entityId: conversation.id,
      beforeRedacted: JSON.stringify({ mode: conversation.mode }),
      afterRedacted: JSON.stringify({ mode: change.mode, reason }),
      atUtc: nowUtc,
    });
    return reason;
  }
}
