import type { Employee } from '../domain/employee.ts';
import type { Id } from '../domain/ids.ts';
import { isOutcomeKind, OUTCOME_KINDS, outcomeLabel, parseAmount } from '../domain/outcome.ts';
import type { CallbackToken } from '../domain/telegram.ts';
import { toIsoUtc } from '../domain/time.ts';
import type { Clock } from '../ports/clock.ts';
import type { EmployeeRepository, TelegramLinkRepository } from '../ports/repositories.ts';
import type { InlineButton } from '../ports/telegram-gateway.ts';
import type { ActionFailure, AgentActions } from './agent-actions.ts';
import type { GenerateAiReply } from './generate-ai-reply.ts';
import type { ActionHandler, AgentTextHandler } from './handle-telegram-update.ts';
import type { SendAgentReply } from './send-agent-reply.ts';
import type { TelegramNotifier } from './telegram-notifier.ts';

export interface TelegramAgentHandlerDeps {
  actions: AgentActions;
  sendAgentReply: SendAgentReply;
  notifier: TelegramNotifier;
  links: TelegramLinkRepository;
  employees: EmployeeRepository;
  clock: Clock;
  defaultCurrency: string;
  /** Para responder en el acto si el cliente quedó esperando al devolver el chat a la IA. */
  generateAiReply?: GenerateAiReply | null;
}

const replyOutcomeText: Record<string, string> = {
  sent: 'Enviado al cliente por Instagram.',
  retry_scheduled: 'Instagram no respondió; se reintentará automáticamente.',
  uncertain: 'Instagram no confirmó la entrega; se comprobará antes de reintentar.',
};

const queueFailureText: Record<string, string> = {
  conversation_not_found: 'La conversación ya no existe.',
  conversation_closed: 'La conversación está cerrada. Espera un nuevo mensaje del cliente.',
  not_allowed: 'Solo el agente asignado puede responder. Usa Tomar primero.',
  window_expired:
    'La ventana de respuesta de Instagram venció. Hay que esperar a que el cliente escriba de nuevo.',
  no_customer_message: 'El cliente aún no ha escrito; no se puede iniciar la conversación.',
  empty_text: 'El mensaje está vacío.',
  text_too_long: 'El mensaje supera los 1000 caracteres permitidos por Instagram.',
  account_unavailable:
    'La cuenta de Instagram no está disponible (token o estado). Avisa al responsable.',
};

const cancelText: Record<string, string> = {
  window_expired: 'No se envió: la ventana de Instagram venció justo antes del envío.',
  not_assigned: 'No se envió: la conversación ya no está asignada a ti.',
  stale_conversation: 'No se envió: la conversación cambió antes del envío.',
  conversation_not_found: 'No se envió: la conversación no existe.',
};

/**
 * Respuestas y comandos de texto del agente. El destino se resuelve SIEMPRE por el
 * Reply a un mensaje del bot enlazado en `telegram_message_links`.
 */
export class TelegramAgentTextHandler implements AgentTextHandler {
  constructor(private readonly deps: TelegramAgentHandlerDeps) {}

  async handle(input: {
    employee: Employee;
    chatId: number;
    text: string;
    replyToMessageId: number | null;
  }): Promise<'handled' | 'not_a_reply'> {
    const { employee, chatId, text, replyToMessageId } = input;
    const command = text.split(/\s+/)[0]?.toLowerCase() ?? '';

    if (replyToMessageId === null) return 'not_a_reply';
    const link = await this.deps.links.find(chatId, replyToMessageId);
    if (link?.employeeId !== employee.id) {
      await this.deps.notifier.tell(
        chatId,
        'Ese mensaje no corresponde a una tarjeta de conversación tuya. Usa /chats y responde a la tarjeta.',
      );
      return 'handled';
    }

    if (command === '/cerrar') {
      await this.askOutcome(employee, chatId, link.conversationId);
      return 'handled';
    }
    if (command === '/venta') {
      await this.recordSale(employee, chatId, link.conversationId, text.slice(command.length));
      return 'handled';
    }
    if (text.startsWith('/')) {
      await this.deps.notifier.tell(chatId, 'Comando no reconocido. Usa /ayuda.');
      return 'handled';
    }

    const result = await this.deps.sendAgentReply.execute(employee, link.conversationId, text);
    if (!result.ok) {
      await this.deps.notifier.tell(
        chatId,
        queueFailureText[result.reason] ?? 'No se pudo enviar.',
      );
      return 'handled';
    }
    const notice =
      result.outcome === 'cancelled' || result.outcome === 'failed'
        ? (cancelText[result.code ?? ''] ?? `No se pudo enviar (${result.code ?? 'error'}).`)
        : (replyOutcomeText[result.outcome] ?? 'Procesado.');
    await this.deps.notifier.tell(
      chatId,
      `${await this.deps.notifier.conversationLabel(link.conversationId)} · ${notice}`,
    );
    return 'handled';
  }

  async askOutcome(employee: Employee, chatId: number, conversationId: Id): Promise<void> {
    const buttons: InlineButton[] = [];
    for (const kind of OUTCOME_KINDS) {
      buttons.push(
        await this.deps.notifier.button(employee.id, {
          text: outcomeLabel[kind],
          action: 'outcome',
          conversationId,
          params: kind,
        }),
      );
    }
    const messageId = await this.deps.notifier.tell(
      chatId,
      `¿Con qué resultado cierras la conversación ${await this.deps.notifier.conversationLabel(conversationId)}?`,
      [buttons.slice(0, 2), buttons.slice(2)],
    );
    if (messageId !== null) await this.link(employee, chatId, messageId, conversationId);
  }

  private async recordSale(
    employee: Employee,
    chatId: number,
    conversationId: Id,
    rest: string,
  ): Promise<void> {
    const parsed = parseAmount(rest, this.deps.defaultCurrency);
    if (parsed === null) {
      await this.deps.notifier.tell(
        chatId,
        'Formato: /venta <importe> [moneda] [nota]. Ejemplo: /venta 1500 DOP entregado en tienda',
      );
      return;
    }
    const result = await this.deps.actions.recordSaleAmount(
      employee,
      conversationId,
      parsed.amountMinor,
      parsed.currency,
      parsed.note,
    );
    const text: Record<typeof result, string> = {
      ok: `Importe registrado: ${(parsed.amountMinor / 100).toFixed(2)} ${parsed.currency}.`,
      no_outcome: 'La conversación aún no está cerrada con resultado. Usa /cerrar primero.',
      forbidden: 'Solo quien registró el resultado (o un owner) puede añadir el importe.',
      not_a_sale: 'El resultado registrado no es una venta confirmada.',
    };
    await this.deps.notifier.tell(chatId, text[result]);
  }

  async link(
    employee: Employee,
    chatId: number,
    messageId: number,
    conversationId: Id,
  ): Promise<void> {
    await this.deps.links.insert({
      telegramChatId: chatId,
      telegramMessageId: messageId,
      employeeId: employee.id,
      conversationId,
      kind: 'card',
      createdAtUtc: toIsoUtc(this.deps.clock.now()),
    });
  }
}

/** Botones de gestión: Tomar, Cerrar (pregunta el resultado), Transferir (elige agente). */
export class TelegramActionHandler implements ActionHandler {
  constructor(
    private readonly deps: TelegramAgentHandlerDeps,
    private readonly textHandler: TelegramAgentTextHandler,
  ) {}

  async handle(input: {
    employee: Employee;
    chatId: number;
    token: CallbackToken;
  }): Promise<{ notice: string; showAlert?: boolean }> {
    const { employee, chatId, token } = input;
    const conversationId = token.conversationId;
    if (conversationId === null) return { notice: 'Botón inválido.', showAlert: true };

    switch (token.action) {
      case 'claim': {
        const result = await this.deps.actions.claim(employee, conversationId);
        if (!result.ok) {
          if (result.reason === 'not_pending') {
            await this.deps.notifier.sendCard(employee.id, conversationId, 'card');
            return {
              notice: 'Otro agente ya tomó esta conversación o cambió de estado.',
              showAlert: true,
            };
          }
          return { notice: 'La conversación no existe.', showAlert: true };
        }
        await this.deps.notifier.sendCard(employee.id, conversationId, 'card');
        return { notice: 'Conversación tomada. Responde con Reply a la tarjeta.' };
      }
      case 'close': {
        await this.textHandler.askOutcome(employee, chatId, conversationId);
        return { notice: 'Elige el resultado.' };
      }
      case 'outcome': {
        const kind = token.params ?? '';
        if (!isOutcomeKind(kind)) return { notice: 'Resultado inválido.', showAlert: true };
        const result = await this.deps.actions.close(employee, conversationId, kind);
        if (!result.ok) return { notice: closeFailureText[result.reason], showAlert: true };
        const closingId = await this.deps.notifier.tell(
          chatId,
          kind === 'venta_confirmada'
            ? `${await this.deps.notifier.conversationLabel(conversationId)} cerrada como venta confirmada. Opcional: responde a este mensaje con /venta <importe> [moneda] [nota].`
            : `${await this.deps.notifier.conversationLabel(conversationId)} cerrada: ${outcomeLabel[kind]}.`,
        );
        if (closingId !== null)
          await this.textHandler.link(employee, chatId, closingId, conversationId);
        return { notice: 'Conversación cerrada.' };
      }
      case 'transfer': {
        if (token.params === null) {
          const handlers = (await this.deps.employees.listActiveHandlers()).filter(
            (e) => e.id !== employee.id,
          );
          if (handlers.length === 0)
            return { notice: 'No hay otros agentes activos.', showAlert: true };
          const buttons: InlineButton[][] = [];
          for (const target of handlers) {
            buttons.push([
              await this.deps.notifier.button(employee.id, {
                text: target.displayName,
                action: 'transfer',
                conversationId,
                params: target.id,
              }),
            ]);
          }
          await this.deps.notifier.tell(
            chatId,
            `¿A quién transfieres la conversación ${await this.deps.notifier.conversationLabel(conversationId)}?`,
            buttons,
          );
          return { notice: 'Elige el agente.' };
        }
        const result = await this.deps.actions.transfer(employee, conversationId, token.params);
        if (!result.ok) return { notice: closeFailureText[result.reason], showAlert: true };
        const delivered = await this.deps.notifier.notifyAssigned(conversationId, token.params);
        return {
          notice: delivered
            ? 'Transferida. El agente recibió la tarjeta.'
            : 'Transferida. El agente aún no inició el bot; la verá en /mischats.',
        };
      }
      case 'return_to_ai': {
        const generate = this.deps.generateAiReply;
        if (generate === undefined || generate === null) {
          return { notice: 'La IA está apagada (AI_MODE=off).', showAlert: true };
        }
        const result = await this.deps.actions.returnToAi(employee, conversationId);
        if (!result.ok) return { notice: closeFailureText[result.reason], showAlert: true };
        // Si el cliente espera respuesta, la IA contesta ya con todo el historial; si no,
        // responde a su próximo mensaje.
        const outcome = await generate.execute(conversationId);
        const detail =
          outcome === 'sent'
            ? 'La IA respondió al último mensaje del cliente.'
            : outcome === 'escalated'
              ? 'La IA volvió a pasar el chat a humano (revisa la alerta).'
              : 'La IA responderá al próximo mensaje del cliente.';
        await this.deps.notifier.tell(
          chatId,
          `${await this.deps.notifier.conversationLabel(conversationId)} devuelta a la IA. ${detail}`,
        );
        return { notice: 'Devuelta a la IA.' };
      }
      case 'view':
      case 'chats_page':
      case 'mychats_page':
      case 'deactivate':
        return { notice: 'Botón inválido.', showAlert: true };
    }
  }
}

const closeFailureText: Record<ActionFailure, string> = {
  not_found: 'La conversación no existe.',
  forbidden: 'La conversación está asignada a otro agente.',
  not_assigned: 'La conversación no tiene agente asignado. Tómala primero.',
  already_assigned: 'La conversación ya está asignada.',
  invalid_transition: 'La acción no es válida en el estado actual.',
  conversation_closed: 'La conversación ya está cerrada.',
  stale_version: 'La conversación cambió justo ahora. Vuelve a intentarlo.',
  target_unavailable: 'Ese agente no está disponible.',
};
