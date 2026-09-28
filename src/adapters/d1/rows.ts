import type {
  Conversation,
  ConversationMode,
  Intent,
  ModeReason,
  Priority,
  Stage,
} from '../../domain/conversation.ts';
import type { Customer } from '../../domain/customer.ts';
import type { Employee, EmployeeRole } from '../../domain/employee.ts';
import type { IgAccount, IgAccountStatus } from '../../domain/ig-account.ts';
import type {
  ContentType,
  DeliveryStatus,
  Message,
  MessageDirection,
  MessageOrigin,
} from '../../domain/message.ts';

/** Filas tal como las devuelve D1 (snake_case, enteros para booleanos). */

export interface IgAccountRow {
  id: string;
  ig_user_id: string;
  display_name: string | null;
  status: IgAccountStatus;
  token_reference: string;
  human_agent_enabled: number;
  last_token_check_at_utc: string | null;
  created_at_utc: string;
}

export function toIgAccount(row: IgAccountRow): IgAccount {
  return {
    id: row.id,
    igUserId: row.ig_user_id,
    displayName: row.display_name,
    status: row.status,
    tokenReference: row.token_reference,
    humanAgentEnabled: row.human_agent_enabled === 1,
    lastTokenCheckAtUtc: row.last_token_check_at_utc,
    createdAtUtc: row.created_at_utc,
  };
}

export interface EmployeeRow {
  id: string;
  telegram_user_id: number;
  display_name: string;
  role: EmployeeRole;
  active: number;
  telegram_chat_id: number | null;
  created_at_utc: string;
}

export function toEmployee(row: EmployeeRow): Employee {
  return {
    id: row.id,
    telegramUserId: row.telegram_user_id,
    displayName: row.display_name,
    role: row.role,
    active: row.active === 1,
    telegramChatId: row.telegram_chat_id,
    createdAtUtc: row.created_at_utc,
  };
}

export interface CustomerRow {
  id: string;
  ig_account_id: string;
  ig_scoped_id: string;
  display_name: string | null;
  username: string | null;
  profile_checked_at_utc: string | null;
  created_at_utc: string;
}

export function toCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    igAccountId: row.ig_account_id,
    igScopedId: row.ig_scoped_id,
    displayName: row.display_name,
    username: row.username,
    profileCheckedAtUtc: row.profile_checked_at_utc,
    createdAtUtc: row.created_at_utc,
  };
}

export interface ConversationRow {
  id: string;
  ig_account_id: string;
  customer_id: string;
  mode: ConversationMode;
  mode_reason: ModeReason | null;
  assigned_employee_id: string | null;
  priority: Priority;
  intent: Intent | null;
  stage: Stage | null;
  version: number;
  last_customer_message_at_utc: string | null;
  last_message_at_utc: string | null;
  opened_at_utc: string;
  closed_at_utc: string | null;
}

export function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    igAccountId: row.ig_account_id,
    customerId: row.customer_id,
    mode: row.mode,
    modeReason: row.mode_reason,
    assignedEmployeeId: row.assigned_employee_id,
    priority: row.priority,
    intent: row.intent,
    stage: row.stage,
    version: row.version,
    lastCustomerMessageAtUtc: row.last_customer_message_at_utc,
    lastMessageAtUtc: row.last_message_at_utc,
    openedAtUtc: row.opened_at_utc,
    closedAtUtc: row.closed_at_utc,
  };
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  external_message_id: string | null;
  direction: MessageDirection;
  origin: MessageOrigin;
  sender_employee_id: string | null;
  body: string | null;
  content_type: ContentType;
  attachment_ref: string | null;
  provider_timestamp_utc: string | null;
  ingested_at_utc: string;
  delivery_status: DeliveryStatus;
  reply_to_message_id: string | null;
}

export function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    externalMessageId: row.external_message_id,
    direction: row.direction,
    origin: row.origin,
    senderEmployeeId: row.sender_employee_id,
    body: row.body,
    contentType: row.content_type,
    attachmentRef: row.attachment_ref,
    providerTimestampUtc: row.provider_timestamp_utc,
    ingestedAtUtc: row.ingested_at_utc,
    deliveryStatus: row.delivery_status,
    replyToMessageId: row.reply_to_message_id,
  };
}

export const bool = (value: boolean): number => (value ? 1 : 0);
