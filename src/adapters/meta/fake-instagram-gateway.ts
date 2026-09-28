import type {
  InstagramGateway,
  ListRecentMessagesInput,
  ListRecentMessagesResult,
  SendTextInput,
  SendTextResult,
} from '../../ports/instagram-gateway.ts';

/** Gateway en memoria para pruebas: registra llamadas y devuelve respuestas programadas. */
export class FakeInstagramGateway implements InstagramGateway {
  readonly sent: SendTextInput[] = [];
  readonly listed: ListRecentMessagesInput[] = [];
  private sendQueue: SendTextResult[] = [];
  private listQueue: ListRecentMessagesResult[] = [];
  private counter = 0;

  /** Respuestas para los próximos `sendText`; agotadas, responde éxito con un mid generado. */
  queueSendResults(...results: SendTextResult[]): void {
    this.sendQueue.push(...results);
  }

  queueListResults(...results: ListRecentMessagesResult[]): void {
    this.listQueue.push(...results);
  }

  sendText(input: SendTextInput): Promise<SendTextResult> {
    this.sent.push(input);
    const next = this.sendQueue.shift();
    if (next) return Promise.resolve(next);
    this.counter += 1;
    return Promise.resolve({
      ok: true,
      messageId: `mid.fake.${this.counter}`,
      recipientId: input.recipientId,
    });
  }

  listRecentMessages(input: ListRecentMessagesInput): Promise<ListRecentMessagesResult> {
    this.listed.push(input);
    return Promise.resolve(this.listQueue.shift() ?? { ok: true, messages: [] });
  }
}
