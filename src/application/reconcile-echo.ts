import { newId } from '../domain/ids.ts';
import { fromUnixMillis, toIsoUtc } from '../domain/time.ts';
import type { Clock } from '../ports/clock.ts';
import type {
  ConversationRepository,
  CustomerRepository,
  IgAccountRepository,
  MessageRepository,
  OutboxRepository,
} from '../ports/repositories.ts';

export interface EchoInput {
  igAccountUserId: string;
  recipientScopedId: string;
  mid: string;
  timestampMs: number;
  text: string | null;
}

export type EchoOutcome =
  | 'already_known'
  | 'confirmed_outbox'
  | 'recorded_external_reply'
  | 'unknown_account'
  | 'no_conversation';

export interface ReconcileEchoDeps {
  igAccounts: IgAccountRepository;
  customers: CustomerRepository;
  conversations: ConversationRepository;
  messages: MessageRepository;
  outbox: OutboxRepository;
  clock: Clock;
}

/**
 * Un eco es la copia de un mensaje enviado desde la cuenta del negocio. Sirve para
 * confirmar envíos propios con acuse incierto y para registrar respuestas hechas
 * desde la app de Instagram u otras herramientas, de modo que el historial local no
 * quede incompleto ni el estado se rompa (hipótesis H9 de meta-validation).
 */
export class ReconcileEcho {
  constructor(private readonly deps: ReconcileEchoDeps) {}

  async execute(input: EchoInput): Promise<EchoOutcome> {
    const { igAccounts, customers, conversations, messages, outbox, clock } = this.deps;

    if ((await messages.findByExternalId(input.mid)) !== null) return 'already_known';

    const account = await igAccounts.findByIgUserId(input.igAccountUserId);
    if (account === null) return 'unknown_account';
    const customer = await customers.findByScopedId(account.id, input.recipientScopedId);
    const conversation =
      customer === null ? null : await conversations.findOpenByCustomer(customer.id);
    if (customer === null || conversation === null) return 'no_conversation';

    const nowUtc = toIsoUtc(clock.now());
    const providerUtc = toIsoUtc(fromUnixMillis(input.timestampMs));

    // ¿Corresponde a un envío nuestro sin confirmar? Emparejamos por texto exacto.
    const pending = await messages.listUnconfirmedOutbound(conversation.id);
    const match = pending.find((m) => m.body === input.text);
    if (match) {
      await messages.updateDelivery(match.id, 'sent', input.mid);
      const item = await outbox.findByMessageId(match.id);
      if (item !== null && item.status !== 'sent')
        await outbox.markSent(item.id, input.mid, nowUtc);
      await conversations.touchOutbound(conversation.id, providerUtc);
      return 'confirmed_outbox';
    }

    // Respuesta enviada fuera del sistema (app nativa u otra herramienta).
    await messages.insertIfNew({
      id: newId(),
      conversationId: conversation.id,
      externalMessageId: input.mid,
      direction: 'outbound',
      origin: 'instagram',
      senderEmployeeId: null,
      body: input.text,
      contentType: input.text === null ? 'unknown' : 'text',
      attachmentRef: null,
      providerTimestampUtc: providerUtc,
      ingestedAtUtc: nowUtc,
      deliveryStatus: 'sent',
      replyToMessageId: null,
    });
    await conversations.touchOutbound(conversation.id, providerUtc);
    return 'recorded_external_reply';
  }
}
