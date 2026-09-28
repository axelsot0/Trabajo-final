export interface InlineButton {
  text: string;
  /** Token opaco almacenado en `callback_tokens`; nunca IDs internos en claro. */
  callbackData: string;
}

export interface SendMessageInput {
  chatId: number;
  text: string;
  inlineKeyboard?: InlineButton[][];
}

export type TelegramResult<T> =
  | { ok: true; value: T }
  | { ok: false; errorCode: string; description: string | null; retryAfterSeconds?: number };

export interface TelegramGateway {
  sendMessage(input: SendMessageInput): Promise<TelegramResult<{ messageId: number }>>;
  editMessageText(input: {
    chatId: number;
    messageId: number;
    text: string;
    inlineKeyboard?: InlineButton[][];
  }): Promise<TelegramResult<null>>;
  answerCallbackQuery(input: {
    callbackQueryId: string;
    text?: string;
    showAlert?: boolean;
  }): Promise<TelegramResult<null>>;
  /** Datos del propio bot; su @usuario sirve para armar enlaces de invitación. */
  getMe(): Promise<TelegramResult<{ username: string }>>;
}
