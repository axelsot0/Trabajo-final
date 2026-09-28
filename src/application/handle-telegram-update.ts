import type { TelegramMinimalUpdate } from '../adapters/telegram/update-schema.ts';
import {
  canHandleConversations,
  isEmployeeRole,
  roleLabel,
  type Employee,
  type EmployeeRole,
} from '../domain/employee.ts';
import { customerLabel } from '../domain/customer.ts';
import type { Conversation, ConversationMode } from '../domain/conversation.ts';
import type { CallbackToken } from '../domain/telegram.ts';
import { toIsoUtc } from '../domain/time.ts';
import type { Clock } from '../ports/clock.ts';
import type {
  CustomerRepository,
  CallbackTokenRepository,
  ConversationRepository,
  EmployeeRepository,
  MessageRepository,
  TelegramLinkRepository,
} from '../ports/repositories.ts';
import type { InlineButton, TelegramGateway } from '../ports/telegram-gateway.ts';
import type { ManageTeam } from './manage-team.ts';
import { renderConversationList, type ListEntry } from './telegram-cards.ts';
import { LIST_TOKEN_TTL_MS, type TelegramNotifier } from './telegram-notifier.ts';

export const CHATS_PAGE_SIZE = 5;

export type TelegramUpdateOutcome =
  | 'ignored_non_private'
  | 'ignored_bot'
  | 'ignored_no_content'
  | 'unauthorized'
  | 'handled'
  | 'callback_invalid';

/** Punto de extensión para el texto libre del agente (Reply a una tarjeta); llega en la fase 6. */
export interface AgentTextHandler {
  handle(input: {
    employee: Employee;
    chatId: number;
    text: string;
    replyToMessageId: number | null;
  }): Promise<'handled' | 'not_a_reply'>;
}

/** Punto de extensión para acciones de gestión (tomar, cerrar, transferir); llegan en la fase 6. */
export interface ActionHandler {
  handle(input: {
    employee: Employee;
    chatId: number;
    token: CallbackToken;
  }): Promise<{ notice: string; showAlert?: boolean }>;
}

export interface HandleTelegramUpdateDeps {
  gateway: TelegramGateway;
  notifier: TelegramNotifier;
  employees: EmployeeRepository;
  conversations: ConversationRepository;
  messages: MessageRepository;
  customers: CustomerRepository;
  links: TelegramLinkRepository;
  tokens: CallbackTokenRepository;
  clock: Clock;
  timeZone: string;
  agentText: AgentTextHandler;
  actions: ActionHandler;
  team: ManageTeam;
}

const OWNER_HELP = [
  '',
  'Equipo (solo owner):',
  '/invitar [agente|owner|lectura] — enlace para sumar a alguien al bot',
  '/agentes — ver el equipo y quitar accesos',
].join('\n');

/** Palabras aceptadas para el rol en `/invitar`. */
const ROLE_WORDS: Record<string, EmployeeRole> = {
  agente: 'agent',
  agent: 'agent',
  owner: 'owner',
  dueño: 'owner',
  admin: 'owner',
  lectura: 'viewer',
  viewer: 'viewer',
};

function helpFor(employee: Employee): string {
  return employee.role === 'owner' ? `${HELP_TEXT}\n${OWNER_HELP}` : HELP_TEXT;
}

const HELP_TEXT = [
  'Comandos disponibles:',
  '/chats — cola pendiente y conversaciones activas',
  '/mischats — conversaciones asignadas a ti',
  '/cerrar — (como Reply a una tarjeta) cerrar con resultado',
  '/venta <importe> [moneda] [nota] — (como Reply) registrar el importe de una venta',
  '/ayuda — esta ayuda',
  '',
  'Para escribir al cliente, haz Reply sobre la tarjeta de su conversación.',
].join('\n');

/**
 * Enruta cada update de Telegram: solo chats privados, solo empleados activos de la
 * allowlist, comandos y botones con token opaco. Nunca resuelve destinos por "chat activo".
 */
export class HandleTelegramUpdate {
  constructor(private readonly deps: HandleTelegramUpdateDeps) {}

  async execute(update: TelegramMinimalUpdate): Promise<TelegramUpdateOutcome> {
    if (update.callback !== null) return this.handleCallback(update.callback);
    if (update.message !== null) return this.handleMessage(update.message);
    return 'ignored_no_content';
  }

  private async handleMessage(
    m: NonNullable<TelegramMinimalUpdate['message']>,
  ): Promise<TelegramUpdateOutcome> {
    if (m.chatType !== 'private') return 'ignored_non_private';
    if (m.isBot) return 'ignored_bot';

    const employee = await this.deps.employees.findByTelegramUserId(m.fromId);
    const text = (m.text ?? '').trim();
    const command = text.split(/\s+/)[0]?.toLowerCase() ?? '';

    if (!employee?.active) {
      // Enlace de invitación: t.me/<bot>?start=<código> llega como "/start <código>".
      const code = /^\/start\s+([A-Za-z0-9_-]{8,64})$/.exec(text)?.[1];
      if (code !== undefined) return this.redeemInvite(m, code);
      await this.deps.notifier.tell(m.chatId, 'No estás autorizado para usar este bot.');
      return 'unauthorized';
    }

    if (command === '/start') {
      if (employee.telegramChatId !== m.chatId) {
        await this.deps.employees.setTelegramChatId(employee.id, m.chatId);
      }
      await this.deps.notifier.tell(
        m.chatId,
        `Hola, ${employee.displayName}. Ya puedes recibir avisos de conversaciones.\n\n${helpFor(employee)}`,
      );
      return 'handled';
    }
    if (command === '/ayuda' || command === '/help') {
      await this.deps.notifier.tell(m.chatId, helpFor(employee));
      return 'handled';
    }
    if (command === '/invitar') {
      await this.invite(employee, m.chatId, text.split(/\s+/)[1]);
      return 'handled';
    }
    if (command === '/agentes') {
      await this.showTeam(employee, m.chatId);
      return 'handled';
    }
    if (!canHandleConversations(employee)) {
      await this.deps.notifier.tell(m.chatId, 'Tu rol solo permite consultar el panel.');
      return 'handled';
    }
    if (command === '/chats') {
      await this.sendList(employee, m.chatId, 'chats_page', 0, null);
      return 'handled';
    }
    if (command === '/mischats') {
      await this.sendList(employee, m.chatId, 'mychats_page', 0, null);
      return 'handled';
    }
    if (text.length > 0) {
      // Texto libre y comandos contextuales (/cerrar, /venta) exigen Reply a una tarjeta.
      const result = await this.deps.agentText.handle({
        employee,
        chatId: m.chatId,
        text,
        replyToMessageId: m.replyToMessageId,
      });
      if (result === 'not_a_reply') {
        await this.deps.notifier.tell(
          m.chatId,
          text.startsWith('/')
            ? `${HELP_TEXT}\n\n/cerrar y /venta se usan como Reply a la tarjeta de la conversación.`
            : 'Para escribir al cliente, haz Reply sobre la tarjeta de su conversación. Usa /chats para verlas.',
        );
      }
      return 'handled';
    }
    await this.deps.notifier.tell(m.chatId, HELP_TEXT);
    return 'handled';
  }

  private async handleCallback(
    c: NonNullable<TelegramMinimalUpdate['callback']>,
  ): Promise<TelegramUpdateOutcome> {
    const answer = (text: string, showAlert = false): Promise<unknown> =>
      this.deps.gateway.answerCallbackQuery({ callbackQueryId: c.id, text, showAlert });

    const employee = await this.deps.employees.findByTelegramUserId(c.fromId);
    if (employee === null || !employee.active || !canHandleConversations(employee)) {
      await answer('No autorizado.', true);
      return 'unauthorized';
    }
    if (c.data === null || c.chatId === null) {
      await answer('Botón inválido.');
      return 'callback_invalid';
    }
    const token = await this.deps.tokens.find(c.data);
    const nowUtc = toIsoUtc(this.deps.clock.now());
    if (token?.employeeId !== employee.id || token.expiresAtUtc <= nowUtc) {
      await answer('Este botón ya no es válido. Usa /chats para actualizar.', true);
      return 'callback_invalid';
    }
    if (token.singleUse) {
      const consumed = await this.deps.tokens.consume(token.token, nowUtc);
      if (!consumed) {
        await answer('Esta acción ya se ejecutó.', true);
        return 'callback_invalid';
      }
    }

    switch (token.action) {
      case 'deactivate': {
        const result = await this.deps.team.deactivate(employee, token.params ?? '');
        if (!result.ok) {
          await answer(
            result.reason === 'self'
              ? 'No puedes quitarte a ti mismo.'
              : result.reason === 'forbidden'
                ? 'Solo un owner puede quitar accesos.'
                : 'Esa persona ya no existe.',
            true,
          );
          return 'handled';
        }
        await this.deps.notifier.tell(
          c.chatId,
          `${result.employee.displayName} ya no tiene acceso al bot.`,
        );
        if (result.employee.telegramChatId !== null) {
          await this.deps.notifier.tell(
            result.employee.telegramChatId,
            'Tu acceso al bot de atención fue retirado.',
          );
        }
        await answer('Acceso retirado.');
        return 'handled';
      }
      case 'view': {
        if (token.conversationId === null) break;
        const sent = await this.deps.notifier.sendCard(employee.id, token.conversationId, 'card');
        await answer(sent ? 'Tarjeta enviada.' : 'No se pudo mostrar la conversación.');
        return 'handled';
      }
      case 'chats_page':
      case 'mychats_page': {
        const page = Number(token.params ?? '0');
        await this.sendList(
          employee,
          c.chatId,
          token.action,
          Number.isFinite(page) ? page : 0,
          c.messageId,
        );
        await answer('');
        return 'handled';
      }
      case 'claim':
      case 'close':
      case 'transfer':
      case 'outcome':
      case 'return_to_ai': {
        const result = await this.deps.actions.handle({ employee, chatId: c.chatId, token });
        await answer(result.notice, result.showAlert ?? false);
        return 'handled';
      }
    }
    await answer('Botón inválido.');
    return 'callback_invalid';
  }

  private async redeemInvite(
    m: NonNullable<TelegramMinimalUpdate['message']>,
    code: string,
  ): Promise<TelegramUpdateOutcome> {
    const result = await this.deps.team.redeem({
      code,
      telegramUserId: m.fromId,
      chatId: m.chatId,
      displayName: m.fromName ?? `Agente ${m.fromId}`,
    });
    if (!result.ok) {
      await this.deps.notifier.tell(
        m.chatId,
        'Esta invitación no es válida, ya se usó o venció. Pide un enlace nuevo a quien te invitó.',
      );
      return 'unauthorized';
    }
    const { employee } = result;
    await this.deps.notifier.tell(
      m.chatId,
      `¡Bienvenido/a, ${employee.displayName}! Ya tienes acceso como ${roleLabel[employee.role]}. Aquí recibirás los avisos de conversaciones.\n\n${helpFor(employee)}`,
    );
    const inviter = await this.deps.employees.findById(result.invitedBy);
    if (inviter?.telegramChatId !== null && inviter?.telegramChatId !== undefined) {
      await this.deps.notifier.tell(
        inviter.telegramChatId,
        `${employee.displayName} se unió al bot como ${roleLabel[employee.role]}.`,
      );
    }
    return 'handled';
  }

  private async invite(
    owner: Employee,
    chatId: number,
    roleWord: string | undefined,
  ): Promise<void> {
    if (owner.role !== 'owner') {
      await this.deps.notifier.tell(chatId, 'Solo un owner puede invitar personas al bot.');
      return;
    }
    const role = roleWord === undefined ? 'agent' : ROLE_WORDS[roleWord.toLowerCase()];
    if (role === undefined || !isEmployeeRole(role)) {
      await this.deps.notifier.tell(chatId, 'Uso: /invitar [agente|owner|lectura]');
      return;
    }
    const invite = await this.deps.team.createInvite(owner, role);
    if (invite === null) return;
    const me = await this.deps.gateway.getMe();
    const how = me.ok
      ? `https://t.me/${me.value.username}?start=${invite.code}`
      : `Pídele que abra el bot y envíe:\n/start ${invite.code}`;
    await this.deps.notifier.tell(
      chatId,
      `Invitación para ${roleLabel[role]} (un solo uso, vence en 48 h):\n${how}\n\nEnvíasela a la persona: al abrirla y pulsar Iniciar quedará registrada y te aviso.`,
    );
  }

  private async showTeam(owner: Employee, chatId: number): Promise<void> {
    if (owner.role !== 'owner') {
      await this.deps.notifier.tell(chatId, 'Solo un owner puede gestionar el equipo.');
      return;
    }
    const team = await this.deps.team.listTeam();
    const lines = ['Equipo del bot:', ''];
    const keyboard: InlineButton[][] = [];
    for (const person of team) {
      const status = person.active
        ? person.telegramChatId === null
          ? 'activo · aún no abrió el bot'
          : 'activo'
        : 'sin acceso';
      lines.push(`• ${person.displayName} — ${roleLabel[person.role]} · ${status}`);
      if (person.active && person.id !== owner.id) {
        keyboard.push([
          await this.deps.notifier.button(owner.id, {
            text: `Quitar a ${person.displayName}`,
            action: 'deactivate',
            conversationId: null,
            params: person.id,
          }),
        ]);
      }
    }
    lines.push('', 'Para sumar a alguien: /invitar');
    await this.deps.notifier.tell(chatId, lines.join('\n'), keyboard);
  }

  /** Lista paginada; si `editMessageId` viene, edita el mensaje en vez de enviar otro. */
  private async sendList(
    employee: Employee,
    chatId: number,
    kind: 'chats_page' | 'mychats_page',
    page: number,
    editMessageId: number | null,
  ): Promise<void> {
    const { conversations, messages, employees, customers, notifier, gateway, timeZone } =
      this.deps;
    const safePage = Math.max(0, page);

    let items: Conversation[];
    let total: number;
    let title: string;
    if (kind === 'mychats_page') {
      title = 'Mis conversaciones';
      const all = await conversations.listAssignedTo(employee.id, 200, 0);
      total = all.length;
      items = all.slice(safePage * CHATS_PAGE_SIZE, (safePage + 1) * CHATS_PAGE_SIZE);
    } else {
      title = 'Conversaciones';
      const order: ConversationMode[] = ['PENDING_HUMAN', 'BOT', 'HUMAN'];
      const all: Conversation[] = [];
      for (const mode of order) all.push(...(await conversations.listByMode(mode, 200, 0)));
      total = all.length;
      items = all.slice(safePage * CHATS_PAGE_SIZE, (safePage + 1) * CHATS_PAGE_SIZE);
    }
    const totalPages = Math.ceil(total / CHATS_PAGE_SIZE);

    const entries: ListEntry[] = [];
    for (const conversation of items) {
      const recent = await messages.listRecent(conversation.id, 1);
      const assigned =
        conversation.assignedEmployeeId === null
          ? null
          : await employees.findById(conversation.assignedEmployeeId);
      const customer = await customers.findById(conversation.customerId);
      entries.push({
        conversation,
        customerName:
          customer === null
            ? `Cliente #${conversation.customerId.slice(0, 8)}`
            : customerLabel(customer),
        lastText: recent[recent.length - 1]?.body ?? null,
        assignedName: assigned?.displayName ?? null,
      });
    }

    const text = renderConversationList(title, entries, safePage, totalPages, timeZone);
    const keyboard: InlineButton[][] = [];
    const viewRow: InlineButton[] = [];
    for (const [i, entry] of entries.entries()) {
      viewRow.push(
        await notifier.button(employee.id, {
          text: `Ver ${i + 1}`,
          action: 'view',
          conversationId: entry.conversation.id,
          singleUse: false,
          ttlMs: LIST_TOKEN_TTL_MS,
        }),
      );
    }
    if (viewRow.length > 0) keyboard.push(viewRow);
    const nav: InlineButton[] = [];
    if (safePage > 0) {
      nav.push(
        await notifier.button(employee.id, {
          text: '◀ Anterior',
          action: kind,
          conversationId: null,
          params: String(safePage - 1),
          singleUse: false,
          ttlMs: LIST_TOKEN_TTL_MS,
        }),
      );
    }
    if (safePage + 1 < totalPages) {
      nav.push(
        await notifier.button(employee.id, {
          text: 'Siguiente ▶',
          action: kind,
          conversationId: null,
          params: String(safePage + 1),
          singleUse: false,
          ttlMs: LIST_TOKEN_TTL_MS,
        }),
      );
    }
    if (nav.length > 0) keyboard.push(nav);

    if (editMessageId !== null) {
      const edited = await gateway.editMessageText({
        chatId,
        messageId: editMessageId,
        text,
        inlineKeyboard: keyboard,
      });
      if (edited.ok) return;
    }
    await notifier.tell(chatId, text, keyboard);
  }
}
