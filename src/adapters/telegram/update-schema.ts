import { z } from 'zod';

const user = z
  .object({
    id: z.number().int(),
    is_bot: z.boolean().optional(),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    username: z.string().optional(),
  })
  .loose();

const chat = z
  .object({
    id: z.number().int(),
    type: z.enum(['private', 'group', 'supergroup', 'channel']),
  })
  .loose();

const message = z
  .object({
    message_id: z.number().int(),
    from: user.optional(),
    chat,
    date: z.number().int(),
    text: z.string().optional(),
    reply_to_message: z
      .object({ message_id: z.number().int(), from: user.optional() })
      .loose()
      .optional(),
  })
  .loose();

const callbackQuery = z
  .object({
    id: z.string(),
    from: user,
    message: z.object({ message_id: z.number().int(), chat }).loose().optional(),
    data: z.string().optional(),
  })
  .loose();

/** Update de la Bot API. Solo se modelan los campos que el bot usa. */
export const telegramUpdateSchema = z
  .object({
    update_id: z.number().int(),
    message: message.optional(),
    callback_query: callbackQuery.optional(),
  })
  .loose();

export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;

/** Forma mínima que se persiste en `webhook_events.payload_minimal`. */
export interface TelegramMinimalUpdate {
  updateId: number;
  message: {
    messageId: number;
    fromId: number;
    isBot: boolean;
    chatId: number;
    chatType: 'private' | 'group' | 'supergroup' | 'channel';
    date: number;
    text: string | null;
    replyToMessageId: number | null;
    /** Nombre visible en Telegram; solo se usa al registrarse con una invitación. */
    fromName?: string | null | undefined;
  } | null;
  callback: {
    id: string;
    fromId: number;
    chatId: number | null;
    messageId: number | null;
    data: string | null;
  } | null;
}

export const telegramMinimalUpdateSchema: z.ZodType<TelegramMinimalUpdate> = z.object({
  updateId: z.number(),
  message: z
    .object({
      messageId: z.number(),
      fromId: z.number(),
      isBot: z.boolean(),
      chatId: z.number(),
      chatType: z.enum(['private', 'group', 'supergroup', 'channel']),
      date: z.number(),
      text: z.string().nullable(),
      replyToMessageId: z.number().nullable(),
      fromName: z.string().nullable().optional(),
    })
    .nullable(),
  callback: z
    .object({
      id: z.string(),
      fromId: z.number(),
      chatId: z.number().nullable(),
      messageId: z.number().nullable(),
      data: z.string().nullable(),
    })
    .nullable(),
});

export function toMinimalUpdate(update: TelegramUpdate): TelegramMinimalUpdate {
  const m = update.message;
  const c = update.callback_query;
  return {
    updateId: update.update_id,
    message:
      m?.from === undefined
        ? null
        : {
            messageId: m.message_id,
            fromId: m.from.id,
            isBot: m.from.is_bot === true,
            chatId: m.chat.id,
            chatType: m.chat.type,
            date: m.date,
            text: m.text ?? null,
            replyToMessageId: m.reply_to_message?.message_id ?? null,
            fromName:
              [m.from.first_name, m.from.last_name].filter((p) => p !== undefined).join(' ') ||
              (m.from.username === undefined ? null : `@${m.from.username}`),
          },
    callback:
      c === undefined
        ? null
        : {
            id: c.id,
            fromId: c.from.id,
            chatId: c.message?.chat.id ?? null,
            messageId: c.message?.message_id ?? null,
            data: c.data ?? null,
          },
  };
}
