import type { Conversation, ConversationMode, ModeChange } from '../domain/conversation.ts';
import type { Customer } from '../domain/customer.ts';
import type { Employee } from '../domain/employee.ts';
import type { Id } from '../domain/ids.ts';
import type { IgAccount } from '../domain/ig-account.ts';
import type { Message } from '../domain/message.ts';
import type { IsoUtc } from '../domain/time.ts';

export interface IgAccountRepository {
  findById(id: Id): Promise<IgAccount | null>;
  findByIgUserId(igUserId: string): Promise<IgAccount | null>;
  insert(account: IgAccount): Promise<void>;
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
}

export type ClaimResult =
  { ok: true; conversation: Conversation } | { ok: false; reason: 'not_found' | 'not_pending' };

export interface ConversationRepository {
  findById(id: Id): Promise<Conversation | null>;
  /** Conversación no cerrada del cliente, si existe (a lo sumo una por cliente). */
  findOpenByCustomer(customerId: Id): Promise<Conversation | null>;
  insert(conversation: Conversation): Promise<void>;
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
}

export interface MessageRepository {
  findById(id: Id): Promise<Message | null>;
  findByExternalId(externalMessageId: string): Promise<Message | null>;
  /** Inserta si `externalMessageId` no existe. Idempotente ante reintentos de Meta. */
  insertIfNew(message: Message): Promise<{ inserted: boolean }>;
  insert(message: Message): Promise<void>;
  listRecent(conversationId: Id, limit: number): Promise<Message[]>;
}
