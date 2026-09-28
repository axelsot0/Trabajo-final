export const TEST_TELEGRAM_WEBHOOK_SECRET = 'test-telegram-webhook-secret';

let updateCounter = 100;

export function textUpdate(input: {
  fromId: number;
  chatId?: number;
  text: string;
  replyToMessageId?: number;
  chatType?: 'private' | 'group';
  isBot?: boolean;
}): Record<string, unknown> {
  updateCounter += 1;
  const message: Record<string, unknown> = {
    message_id: updateCounter,
    from: { id: input.fromId, is_bot: input.isBot ?? false, first_name: 'Agente' },
    chat: { id: input.chatId ?? input.fromId, type: input.chatType ?? 'private' },
    date: 1_790_560_000,
    text: input.text,
  };
  if (input.replyToMessageId !== undefined) {
    message['reply_to_message'] = {
      message_id: input.replyToMessageId,
      from: { id: 999, is_bot: true },
    };
  }
  return { update_id: updateCounter, message };
}

export function callbackUpdate(input: {
  fromId: number;
  chatId?: number;
  messageId: number;
  data: string;
}): Record<string, unknown> {
  updateCounter += 1;
  return {
    update_id: updateCounter,
    callback_query: {
      id: `cb-${updateCounter}`,
      from: { id: input.fromId, is_bot: false, first_name: 'Agente' },
      message: {
        message_id: input.messageId,
        chat: { id: input.chatId ?? input.fromId, type: 'private' },
      },
      data: input.data,
    },
  };
}

export function telegramRequest(update: unknown, secret = TEST_TELEGRAM_WEBHOOK_SECRET): Request {
  return new Request('https://example.com/webhooks/telegram', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': secret,
    },
    body: JSON.stringify(update),
  });
}
