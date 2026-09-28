import type { TelegramLinkKind, TelegramMessageLink } from '../../domain/telegram.ts';
import type { TelegramLinkRepository } from '../../ports/repositories.ts';

interface LinkRow {
  telegram_chat_id: number;
  telegram_message_id: number;
  employee_id: string;
  conversation_id: string;
  kind: TelegramLinkKind;
  created_at_utc: string;
}

export class D1TelegramLinkRepository implements TelegramLinkRepository {
  constructor(private readonly db: D1Database) {}

  async insert(link: TelegramMessageLink): Promise<void> {
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO telegram_message_links
           (telegram_chat_id, telegram_message_id, employee_id, conversation_id, kind, created_at_utc)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      )
      .bind(
        link.telegramChatId,
        link.telegramMessageId,
        link.employeeId,
        link.conversationId,
        link.kind,
        link.createdAtUtc,
      )
      .run();
  }

  async find(
    telegramChatId: number,
    telegramMessageId: number,
  ): Promise<TelegramMessageLink | null> {
    const row = await this.db
      .prepare(
        'SELECT * FROM telegram_message_links WHERE telegram_chat_id = ?1 AND telegram_message_id = ?2',
      )
      .bind(telegramChatId, telegramMessageId)
      .first<LinkRow>();
    if (!row) return null;
    return {
      telegramChatId: row.telegram_chat_id,
      telegramMessageId: row.telegram_message_id,
      employeeId: row.employee_id,
      conversationId: row.conversation_id,
      kind: row.kind,
      createdAtUtc: row.created_at_utc,
    };
  }
}
