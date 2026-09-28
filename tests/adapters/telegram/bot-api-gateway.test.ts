import { describe, expect, it } from 'vitest';

import { TelegramBotApiGateway } from '../../../src/adapters/telegram/bot-api-gateway.ts';

function gatewayWith(respond: (url: string, init: RequestInit | undefined) => Response) {
  const calls: { url: string; body: unknown }[] = [];
  const gateway = new TelegramBotApiGateway({
    resolveToken: () => 'BOT-TOKEN',
    fetchImpl: (input, init) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({ url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null });
      return Promise.resolve(respond(url, init));
    },
  });
  return { gateway, calls };
}

describe('TelegramBotApiGateway', () => {
  it('sendMessage envía texto plano y teclado inline con callback_data', async () => {
    const { gateway, calls } = gatewayWith(() =>
      Response.json({ ok: true, result: { message_id: 55 } }),
    );
    const result = await gateway.sendMessage({
      chatId: 7,
      text: 'Hola <b>sin</b> formato',
      inlineKeyboard: [[{ text: 'Ver', callbackData: 'tok1' }]],
    });
    expect(result).toEqual({ ok: true, value: { messageId: 55 } });
    expect(calls[0]?.url).toBe('https://api.telegram.org/botBOT-TOKEN/sendMessage');
    expect(calls[0]?.body).toEqual({
      chat_id: 7,
      text: 'Hola <b>sin</b> formato',
      reply_markup: { inline_keyboard: [[{ text: 'Ver', callback_data: 'tok1' }]] },
    });
  });

  it('propaga errores de la API con código estable y retry_after', async () => {
    const { gateway } = gatewayWith(() =>
      Response.json(
        {
          ok: false,
          error_code: 429,
          description: 'Too Many Requests',
          parameters: { retry_after: 3 },
        },
        { status: 429 },
      ),
    );
    expect(await gateway.answerCallbackQuery({ callbackQueryId: 'x' })).toEqual({
      ok: false,
      errorCode: 'telegram_429',
      description: 'Too Many Requests',
      retryAfterSeconds: 3,
    });
  });

  it('un fallo de red no lanza', async () => {
    const { gateway } = gatewayWith(() => {
      throw new TypeError('fetch failed');
    });
    expect(await gateway.editMessageText({ chatId: 1, messageId: 2, text: 'x' })).toMatchObject({
      ok: false,
      errorCode: 'network_error',
    });
  });
});
