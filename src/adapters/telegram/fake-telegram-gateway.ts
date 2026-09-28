import type {
  InlineButton,
  SendMessageInput,
  TelegramGateway,
  TelegramResult,
} from '../../ports/telegram-gateway.ts';

export interface FakeSentMessage extends SendMessageInput {
  messageId: number;
}

export interface FakeEditedMessage {
  chatId: number;
  messageId: number;
  text: string;
  inlineKeyboard: InlineButton[][] | undefined;
}

/** Gateway en memoria: registra todo lo que el bot envía y responde con IDs crecientes. */
export class FakeTelegramGateway implements TelegramGateway {
  readonly sent: FakeSentMessage[] = [];
  readonly edited: FakeEditedMessage[] = [];
  readonly answered: { callbackQueryId: string; text?: string; showAlert?: boolean }[] = [];
  private nextMessageId = 1000;
  failNextSend: TelegramResult<never> | null = null;

  sendMessage(input: SendMessageInput): Promise<TelegramResult<{ messageId: number }>> {
    if (this.failNextSend) {
      const failure = this.failNextSend;
      this.failNextSend = null;
      return Promise.resolve(failure);
    }
    this.nextMessageId += 1;
    this.sent.push({ ...input, messageId: this.nextMessageId });
    return Promise.resolve({ ok: true, value: { messageId: this.nextMessageId } });
  }

  editMessageText(input: {
    chatId: number;
    messageId: number;
    text: string;
    inlineKeyboard?: InlineButton[][];
  }): Promise<TelegramResult<null>> {
    this.edited.push({ ...input, inlineKeyboard: input.inlineKeyboard });
    return Promise.resolve({ ok: true, value: null });
  }

  answerCallbackQuery(input: {
    callbackQueryId: string;
    text?: string;
    showAlert?: boolean;
  }): Promise<TelegramResult<null>> {
    this.answered.push(input);
    return Promise.resolve({ ok: true, value: null });
  }

  /** Último mensaje enviado a un chat, para aserciones legibles. */
  lastTo(chatId: number): FakeSentMessage | undefined {
    return [...this.sent].reverse().find((m) => m.chatId === chatId);
  }
}
