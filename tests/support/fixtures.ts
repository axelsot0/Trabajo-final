import type { Conversation, ConversationMode } from '../../src/domain/conversation.ts';
import type { Customer } from '../../src/domain/customer.ts';
import type { Employee, EmployeeRole } from '../../src/domain/employee.ts';
import { newId } from '../../src/domain/ids.ts';
import type { IgAccount } from '../../src/domain/ig-account.ts';
import type { Message } from '../../src/domain/message.ts';
import type { Repositories } from '../../src/adapters/d1/index.ts';

export const T0 = '2026-09-27T14:00:00.000Z';

export function makeAccount(overrides: Partial<IgAccount> = {}): IgAccount {
  return {
    id: newId(),
    igUserId: `1789${Math.floor(Math.random() * 1e9)}`,
    displayName: 'Tienda de prueba',
    status: 'active',
    tokenReference: 'META_ACCESS_TOKEN',
    humanAgentEnabled: false,
    lastTokenCheckAtUtc: null,
    createdAtUtc: T0,
    ...overrides,
  };
}

export function makeEmployee(
  telegramUserId: number,
  role: EmployeeRole = 'agent',
  overrides: Partial<Employee> = {},
): Employee {
  return {
    id: newId(),
    telegramUserId,
    displayName: `Agente ${telegramUserId}`,
    role,
    active: true,
    telegramChatId: telegramUserId,
    createdAtUtc: T0,
    ...overrides,
  };
}

export function makeCustomer(igAccountId: string, overrides: Partial<Customer> = {}): Customer {
  return {
    id: newId(),
    igAccountId,
    igScopedId: `igsid-${newId()}`,
    displayName: null,
    username: null,
    profileCheckedAtUtc: null,
    createdAtUtc: T0,
    ...overrides,
  };
}

export function makeConversation(
  account: IgAccount,
  customer: Customer,
  mode: ConversationMode,
  overrides: Partial<Conversation> = {},
): Conversation {
  return {
    id: newId(),
    igAccountId: account.id,
    customerId: customer.id,
    mode,
    modeReason: mode === 'PENDING_HUMAN' ? 'requested_human' : 'new_conversation',
    assignedEmployeeId: null,
    priority: 'media',
    intent: null,
    stage: null,
    version: 1,
    lastCustomerMessageAtUtc: T0,
    lastMessageAtUtc: T0,
    openedAtUtc: T0,
    closedAtUtc: null,
    ...overrides,
  };
}

export function makeInboundMessage(
  conversationId: string,
  externalMessageId: string,
  overrides: Partial<Message> = {},
): Message {
  return {
    id: newId(),
    conversationId,
    externalMessageId,
    direction: 'inbound',
    origin: 'instagram',
    senderEmployeeId: null,
    body: 'Hola, ¿tienen disponible?',
    contentType: 'text',
    attachmentRef: null,
    providerTimestampUtc: T0,
    ingestedAtUtc: T0,
    deliveryStatus: 'received',
    replyToMessageId: null,
    ...overrides,
  };
}

/** Siembra cuenta + cliente + conversación en el modo indicado y devuelve las tres. */
export async function seedConversation(
  repos: Repositories,
  mode: ConversationMode,
  overrides: Partial<Conversation> = {},
): Promise<{ account: IgAccount; customer: Customer; conversation: Conversation }> {
  const account = makeAccount();
  await repos.igAccounts.insert(account);
  const customer = makeCustomer(account.id);
  await repos.customers.insert(customer);
  const conversation = makeConversation(account, customer, mode, overrides);
  await repos.conversations.insert(conversation);
  return { account, customer, conversation };
}
