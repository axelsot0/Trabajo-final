import { customerLabel } from '../domain/customer.ts';
import type { Id } from '../domain/ids.ts';
import { newCallbackToken, type CallbackAction } from '../domain/telegram.ts';
import { MS_PER_DAY, MS_PER_HOUR, toIsoUtc } from '../domain/time.ts';
import type { Clock } from '../ports/clock.ts';
import type {
  CallbackTokenRepository,
  ConversationRepository,
  CustomerRepository,
  EmployeeRepository,
  MessageRepository,
  TelegramLinkRepository,
} from '../ports/repositories.ts';
import type { InlineButton, TelegramGateway } from '../ports/telegram-gateway.ts';
import { CARD_HISTORY_LIMIT, renderConversationCard } from './telegram-cards.ts';

export interface TelegramNotifierDeps {
  gateway: TelegramGateway;
  employees: EmployeeRepository;
  conversations: ConversationRepository;
  customers: CustomerRepository;
  messages: MessageRepository;
  links: TelegramLinkRepository;
  tokens: CallbackTokenRepository;
  clock: Clock;
  timeZone: string;
  /** Con la IA activa, las tarjetas ofrecen devolver la conversación a la IA. */
  aiEnabled?: boolean;
}

export interface ButtonSpec {
  text: string;
  action: CallbackAction;
  conversationId: Id | null;
  params?: string;
  singleUse?: boolean;
  ttlMs?: number;
}

/**
 * Envía tarjetas de conversación a agentes por Telegram y deja cada mensaje
 * enlazado a su conversación para que el Reply del agente tenga destino.
 */
export class TelegramNotifier {
  constructor(private readonly deps: TelegramNotifierDeps) {}

  /** Crea un token opaco para un botón y devuelve el botón listo. */
  async button(employeeId: Id, spec: ButtonSpec): Promise<InlineButton> {
    const now = this.deps.clock.now();
    const token = newCallbackToken();
    await this.deps.tokens.insert({
      token,
      employeeId,
      conversationId: spec.conversationId,
      action: spec.action,
      params: spec.params ?? null,
      singleUse: spec.singleUse ?? true,
      expiresAtUtc: toIsoUtc(new Date(now.getTime() + (spec.ttlMs ?? MS_PER_DAY))),
      usedAtUtc: null,
      createdAtUtc: toIsoUtc(now),
    });
    return { text: spec.text, callbackData: token };
  }

  /** Botones de acción coherentes con el estado y el agente que mira la tarjeta. */
  async actionButtons(employeeId: Id, conversationId: Id): Promise<InlineButton[][]> {
    const conversation = await this.deps.conversations.findById(conversationId);
    if (conversation === null) return [];
    const rows: InlineButton[][] = [];
    const returnToAi = async (): Promise<InlineButton[]> =>
      this.deps.aiEnabled === true
        ? [
            await this.button(employeeId, {
              text: '🤖 Devolver a IA',
              action: 'return_to_ai',
              conversationId,
            }),
          ]
        : [];
    if (conversation.mode === 'PENDING_HUMAN') {
      rows.push([
        await this.button(employeeId, {
          text: 'Tomar',
          action: 'claim',
          conversationId,
          ttlMs: MS_PER_DAY,
        }),
        ...(await returnToAi()),
      ]);
    } else if (conversation.mode === 'HUMAN' && conversation.assignedEmployeeId === employeeId) {
      rows.push([
        await this.button(employeeId, { text: 'Transferir', action: 'transfer', conversationId }),
        await this.button(employeeId, { text: 'Cerrar', action: 'close', conversationId }),
      ]);
      const back = await returnToAi();
      if (back.length > 0) rows.push(back);
    }
    return rows;
  }

  /** Envía la tarjeta a un agente y registra el enlace. Devuelve `false` si Telegram falló. */
  async sendCard(
    employeeId: Id,
    conversationId: Id,
    kind: 'card' | 'notification',
  ): Promise<boolean> {
    const { employees, conversations, customers, messages, gateway, links, clock, timeZone } =
      this.deps;
    const employee = await employees.findById(employeeId);
    if (employee?.telegramChatId === null || employee?.telegramChatId === undefined) return false;
    const conversation = await conversations.findById(conversationId);
    if (conversation === null) return false;
    const customer = await customers.findById(conversation.customerId);
    if (customer === null) return false;
    const history = await messages.listRecent(conversationId, CARD_HISTORY_LIMIT);
    const assigned =
      conversation.assignedEmployeeId === null
        ? null
        : await employees.findById(conversation.assignedEmployeeId);

    const text = renderConversationCard({
      conversation,
      customer,
      messages: history,
      assignedName: assigned?.displayName ?? null,
      timeZone,
    });
    const keyboard = await this.actionButtons(employeeId, conversationId);
    const result = await gateway.sendMessage({
      chatId: employee.telegramChatId,
      text,
      inlineKeyboard: keyboard,
    });
    if (!result.ok) {
      console.warn('telegram_send_failed', { employeeId, code: result.errorCode });
      return false;
    }
    await links.insert({
      telegramChatId: employee.telegramChatId,
      telegramMessageId: result.value.messageId,
      employeeId,
      conversationId,
      kind,
      createdAtUtc: toIsoUtc(clock.now()),
    });
    return true;
  }

  /** Aviso a todos los agentes activos con chat iniciado: hay una conversación pendiente. */
  async notifyPending(conversationId: Id): Promise<number> {
    const handlers = await this.deps.employees.listActiveHandlers();
    let delivered = 0;
    for (const employee of handlers) {
      if (employee.telegramChatId === null) continue;
      if (await this.sendCard(employee.id, conversationId, 'notification')) delivered += 1;
    }
    return delivered;
  }

  /** Nombre legible del cliente de una conversación para avisos cortos. */
  async conversationLabel(conversationId: Id): Promise<string> {
    const conversation = await this.deps.conversations.findById(conversationId);
    const customer =
      conversation === null ? null : await this.deps.customers.findById(conversation.customerId);
    return customer === null ? `#${conversationId.slice(0, 8)}` : customerLabel(customer);
  }

  /** Texto corto a todos los agentes activos con chat iniciado (alertas de venta o fallo). */
  async broadcast(text: string): Promise<number> {
    const handlers = await this.deps.employees.listActiveHandlers();
    let delivered = 0;
    for (const employee of handlers) {
      if (employee.telegramChatId === null) continue;
      if ((await this.tell(employee.telegramChatId, text)) !== null) delivered += 1;
    }
    return delivered;
  }

  /** Aviso al agente asignado: el cliente escribió de nuevo. */
  async notifyAssigned(conversationId: Id, employeeId: Id): Promise<boolean> {
    return this.sendCard(employeeId, conversationId, 'notification');
  }

  /** Mensaje corto sin tarjeta (confirmaciones, errores, ayuda). */
  async tell(chatId: number, text: string, keyboard?: InlineButton[][]): Promise<number | null> {
    const result = await this.deps.gateway.sendMessage({
      chatId,
      text,
      ...(keyboard === undefined ? {} : { inlineKeyboard: keyboard }),
    });
    return result.ok ? result.value.messageId : null;
  }
}

export const LIST_TOKEN_TTL_MS = 6 * MS_PER_HOUR;
