import type { AuditEvent } from '../domain/audit.ts';
import type { CatalogItem } from '../domain/catalog.ts';
import type {
  Conversation,
  ConversationMode,
  Intent,
  ModeChange,
  Priority,
  Stage,
} from '../domain/conversation.ts';
import type { Customer } from '../domain/customer.ts';
import type { Employee } from '../domain/employee.ts';
import type { Id } from '../domain/ids.ts';
import type { IgAccount, IgAccountStatus } from '../domain/ig-account.ts';
import type { DeliveryStatus, Message } from '../domain/message.ts';
import type { OutboxItem, OutboxStatus } from '../domain/outbox.ts';
import type { Outcome } from '../domain/outcome.ts';
import type { CallbackToken, TelegramMessageLink } from '../domain/telegram.ts';
import type { IsoUtc } from '../domain/time.ts';
import type { AiReplyRecord, AiReplyUpdate, TriageEvent } from '../domain/triage.ts';
import type { WebhookEvent, WebhookProcessStatus } from '../domain/webhook-event.ts';

export interface IgAccountRepository {
  findById(id: Id): Promise<IgAccount | null>;
  findByIgUserId(igUserId: string): Promise<IgAccount | null>;
  insert(account: IgAccount): Promise<void>;
  setStatus(id: Id, status: IgAccountStatus, checkedAtUtc: IsoUtc): Promise<void>;
}

export interface EmployeeRepository {
  findById(id: Id): Promise<Employee | null>;
  findByTelegramUserId(telegramUserId: number): Promise<Employee | null>;
  /** Empleados activos con rol que atiende (`owner` o `agent`). */
  listActiveHandlers(): Promise<Employee[]>;
  insert(employee: Employee): Promise<void>;
  setTelegramChatId(id: Id, telegramChatId: number): Promise<void>;
}

export interface CustomerRepository {
  findById(id: Id): Promise<Customer | null>;
  findByScopedId(igAccountId: Id, igScopedId: string): Promise<Customer | null>;
  insert(customer: Customer): Promise<void>;
  /**
   * Inserta si no existe `(ig_account_id, ig_scoped_id)` y devuelve la fila vigente.
   * Seguro ante dos eventos del mismo cliente procesados en paralelo.
   */
  findOrCreate(customer: Customer): Promise<Customer>;
}

export type ClaimResult =
  { ok: true; conversation: Conversation } | { ok: false; reason: 'not_found' | 'not_pending' };

export interface ConversationRepository {
  findById(id: Id): Promise<Conversation | null>;
  /** Conversación no cerrada del cliente, si existe (a lo sumo una por cliente). */
  findOpenByCustomer(customerId: Id): Promise<Conversation | null>;
  insert(conversation: Conversation): Promise<void>;
  /**
   * Inserta la conversación salvo que el cliente ya tenga una abierta (índice parcial
   * único) y devuelve la conversación abierta vigente.
   */
  insertIfNoneOpen(conversation: Conversation): Promise<Conversation>;
  /**
   * Aplica un cambio de modo solo si la versión coincide (control optimista).
   * Devuelve `false` si otra operación cambió la conversación antes.
   */
  applyModeChange(
    conversationId: Id,
    expectedVersion: number,
    change: ModeChange,
    now: IsoUtc,
  ): Promise<boolean>;
  /**
   * Toma atómica: `UPDATE ... WHERE mode='PENDING_HUMAN' AND assigned_employee_id IS NULL`.
   * Exactamente un agente gana aunque compitan a la vez.
   */
  claim(conversationId: Id, employeeId: Id, now: IsoUtc): Promise<ClaimResult>;
  /** Registra un mensaje del cliente: abre/reabre la ventana de 24 h. */
  touchCustomerMessage(conversationId: Id, atUtc: IsoUtc): Promise<void>;
  /** Registra actividad saliente sin tocar la ventana del cliente. */
  touchOutbound(conversationId: Id, atUtc: IsoUtc): Promise<void>;
  listByMode(mode: ConversationMode, limit: number, offset: number): Promise<Conversation[]>;
  listAssignedTo(employeeId: Id, limit: number, offset: number): Promise<Conversation[]>;
  /** Actualiza intención, etapa y prioridad sin tocar modo ni versión. */
  updateTriage(
    conversationId: Id,
    triage: { intent: Intent | null; stage: Stage | null; priority: Priority },
  ): Promise<void>;
  /**
   * Conversaciones en BOT cuyo último mensaje es del cliente, anterior a `olderThanUtc`,
   * y sin intento de IA registrado para ese mensaje: la red de seguridad del cron.
   */
  listBotAwaitingReply(olderThanUtc: IsoUtc, limit: number): Promise<Conversation[]>;
}

export interface MessageRepository {
  findById(id: Id): Promise<Message | null>;
  findByExternalId(externalMessageId: string): Promise<Message | null>;
  /** Inserta si `externalMessageId` no existe. Idempotente ante reintentos de Meta. */
  insertIfNew(message: Message): Promise<{ inserted: boolean }>;
  insert(message: Message): Promise<void>;
  listRecent(conversationId: Id, limit: number): Promise<Message[]>;
  /** Actualiza el estado de entrega y, si Meta lo confirmó, el `mid` externo. */
  updateDelivery(
    id: Id,
    deliveryStatus: DeliveryStatus,
    externalMessageId: string | null,
  ): Promise<void>;
  /** Mensajes salientes de la conversación con entrega `uncertain` o `queued`, más recientes primero. */
  listUnconfirmedOutbound(conversationId: Id): Promise<Message[]>;
  /** Último mensaje entrante del cliente en la conversación. */
  findLatestInbound(conversationId: Id): Promise<Message | null>;
  /** Número de mensajes salientes con el origen indicado (p. ej. para el aviso de IA). */
  countOutboundByOrigin(conversationId: Id, origin: Message['origin']): Promise<number>;
}

export interface CatalogRepository {
  listActive(): Promise<CatalogItem[]>;
  upsert(item: CatalogItem): Promise<void>;
}

export interface TriageRepository {
  insert(event: TriageEvent): Promise<void>;
  listForConversation(conversationId: Id, limit: number): Promise<TriageEvent[]>;
}

export interface AiReplyRepository {
  /**
   * Inserta el intento si no existe otro para el mismo mensaje disparador. Devuelve
   * `false` si otro proceso ya lo reclamó: así nunca hay dos respuestas al mismo mensaje.
   */
  claim(record: AiReplyRecord): Promise<boolean>;
  update(id: Id, update: AiReplyUpdate): Promise<void>;
  findByTrigger(triggerMessageId: Id): Promise<AiReplyRecord | null>;
  /** Llamadas al proveedor desde `sinceUtc` (cupo diario). */
  countProviderCallsSince(sinceUtc: IsoUtc): Promise<number>;
  /** Intentos que quedaron en `pending` (proceso interrumpido) antes de `olderThanUtc`. */
  listStalePending(olderThanUtc: IsoUtc, limit: number): Promise<AiReplyRecord[]>;
}

export interface WebhookEventRepository {
  /** Inserta si la clave externa no existe. Devuelve `false` en entregas repetidas. */
  insertIfNew(event: WebhookEvent): Promise<boolean>;
  findByKey(externalEventKey: string): Promise<WebhookEvent | null>;
  /**
   * Marca hasta `limit` eventos pendientes como `processing` (attempts + 1) de forma
   * atómica y los devuelve. Dos barridos simultáneos nunca reciben el mismo evento.
   */
  claimPending(limit: number): Promise<WebhookEvent[]>;
  markDone(id: Id, processedAtUtc: IsoUtc): Promise<void>;
  markIgnored(id: Id, code: string, processedAtUtc: IsoUtc): Promise<void>;
  /** Vuelve a `pending` si quedan intentos; si no, `failed`. */
  markFailed(id: Id, code: string, maxAttempts: number): Promise<void>;
  /** Devuelve a `pending` los eventos atascados en `processing` desde antes de `olderThanUtc`. */
  releaseStuck(olderThanUtc: IsoUtc): Promise<number>;
  countByStatus(): Promise<Record<WebhookProcessStatus, number>>;
}

export interface AuditRepository {
  record(event: AuditEvent): Promise<void>;
  listForEntity(entityType: string, entityId: Id, limit: number): Promise<AuditEvent[]>;
}

export interface OutboxRepository {
  enqueue(item: OutboxItem): Promise<void>;
  findById(id: Id): Promise<OutboxItem | null>;
  findByMessageId(messageId: Id): Promise<OutboxItem | null>;
  /** Marca `in_flight` hasta `limit` elementos pendientes cuyo `retry_at_utc` ya venció y los devuelve. */
  claimDue(nowUtc: IsoUtc, limit: number): Promise<OutboxItem[]>;
  markSent(id: Id, remoteMessageId: string, nowUtc: IsoUtc): Promise<void>;
  markFailed(id: Id, errorCode: string, nowUtc: IsoUtc): Promise<void>;
  markCancelled(id: Id, errorCode: string, nowUtc: IsoUtc): Promise<void>;
  markUncertain(id: Id, errorCode: string, nowUtc: IsoUtc): Promise<void>;
  scheduleRetry(id: Id, errorCode: string, retryAtUtc: IsoUtc, nowUtc: IsoUtc): Promise<void>;
  /** Elementos `uncertain` actualizados antes de `olderThanUtc`, listos para conciliar. */
  listUncertain(olderThanUtc: IsoUtc, limit: number): Promise<OutboxItem[]>;
  listByConversation(conversationId: Id, limit: number): Promise<OutboxItem[]>;
  countByStatus(): Promise<Record<OutboxStatus, number>>;
}

export interface TelegramLinkRepository {
  insert(link: TelegramMessageLink): Promise<void>;
  find(telegramChatId: number, telegramMessageId: number): Promise<TelegramMessageLink | null>;
}

export interface CallbackTokenRepository {
  insert(token: CallbackToken): Promise<void>;
  find(token: string): Promise<CallbackToken | null>;
  /**
   * Marca el token como usado solo si sigue disponible (no usado, no caducado).
   * Devuelve `false` si otro callback lo consumió antes.
   */
  consume(token: string, nowUtc: IsoUtc): Promise<boolean>;
  deleteExpired(nowUtc: IsoUtc): Promise<number>;
}

export interface OutcomeRepository {
  insert(outcome: Outcome): Promise<void>;
  findLatestForConversation(conversationId: Id): Promise<Outcome | null>;
  updateAmount(
    id: Id,
    amountMinor: number | null,
    currency: string | null,
    evidenceNote: string | null,
  ): Promise<void>;
}
