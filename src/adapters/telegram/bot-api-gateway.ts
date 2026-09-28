import { z } from 'zod';

import type {
  InlineButton,
  SendMessageInput,
  TelegramGateway,
  TelegramResult,
} from '../../ports/telegram-gateway.ts';

export interface TelegramBotApiGatewayOptions {
  resolveToken: () => string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
}

const apiResponseSchema = z
  .object({
    ok: z.boolean(),
    result: z.unknown().optional(),
    description: z.string().optional(),
    error_code: z.number().optional(),
    parameters: z.object({ retry_after: z.number().optional() }).loose().optional(),
  })
  .loose();

const sentMessageSchema = z.object({ message_id: z.number().int() }).loose();

function toReplyMarkup(
  keyboard: InlineButton[][] | undefined,
): Record<string, unknown> | undefined {
  if (keyboard === undefined || keyboard.length === 0) return undefined;
  return {
    inline_keyboard: keyboard.map((row) =>
      row.map((b) => ({ text: b.text, callback_data: b.callbackData })),
    ),
  };
}

/**
 * Adaptador de la Bot API. Se envía texto plano (sin `parse_mode`) para que el
 * contenido de clientes nunca se interprete como formato.
 */
export class TelegramBotApiGateway implements TelegramGateway {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: TelegramBotApiGatewayOptions) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.baseUrl = options.baseUrl ?? 'https://api.telegram.org';
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async sendMessage(input: SendMessageInput): Promise<TelegramResult<{ messageId: number }>> {
    const result = await this.call('sendMessage', {
      chat_id: input.chatId,
      text: input.text,
      reply_markup: toReplyMarkup(input.inlineKeyboard),
    });
    if (!result.ok) return result;
    const parsed = sentMessageSchema.safeParse(result.value);
    if (!parsed.success) return { ok: false, errorCode: 'unexpected_body', description: null };
    return { ok: true, value: { messageId: parsed.data.message_id } };
  }

  async editMessageText(input: {
    chatId: number;
    messageId: number;
    text: string;
    inlineKeyboard?: InlineButton[][];
  }): Promise<TelegramResult<null>> {
    const result = await this.call('editMessageText', {
      chat_id: input.chatId,
      message_id: input.messageId,
      text: input.text,
      reply_markup: toReplyMarkup(input.inlineKeyboard),
    });
    return result.ok ? { ok: true, value: null } : result;
  }

  async answerCallbackQuery(input: {
    callbackQueryId: string;
    text?: string;
    showAlert?: boolean;
  }): Promise<TelegramResult<null>> {
    const result = await this.call('answerCallbackQuery', {
      callback_query_id: input.callbackQueryId,
      text: input.text,
      show_alert: input.showAlert,
    });
    return result.ok ? { ok: true, value: null } : result;
  }

  async getMe(): Promise<TelegramResult<{ username: string }>> {
    const result = await this.call('getMe', {});
    if (!result.ok) return result;
    const parsed = z.object({ username: z.string() }).loose().safeParse(result.value);
    if (!parsed.success) return { ok: false, errorCode: 'unexpected_body', description: null };
    return { ok: true, value: { username: parsed.data.username } };
  }

  private async call(
    method: string,
    body: Record<string, unknown>,
  ): Promise<TelegramResult<unknown>> {
    const token = this.options.resolveToken();
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === 'TimeoutError';
      return { ok: false, errorCode: isTimeout ? 'timeout' : 'network_error', description: null };
    }
    const parsed = apiResponseSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      return { ok: false, errorCode: `http_${response.status}`, description: null };
    }
    if (!parsed.data.ok) {
      const code = parsed.data.error_code ?? response.status;
      const result: TelegramResult<unknown> = {
        ok: false,
        errorCode: `telegram_${code}`,
        description: parsed.data.description ?? null,
      };
      const retryAfter = parsed.data.parameters?.retry_after;
      return retryAfter === undefined ? result : { ...result, retryAfterSeconds: retryAfter };
    }
    return { ok: true, value: parsed.data.result };
  }
}
