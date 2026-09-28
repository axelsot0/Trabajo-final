import type { Id } from '../../domain/ids.ts';
import type { Message } from '../../domain/message.ts';
import type { MessageRepository } from '../../ports/repositories.ts';
import { toMessage, type MessageRow } from './rows.ts';

export class D1MessageRepository implements MessageRepository {
  constructor(private readonly db: D1Database) {}

  async findById(id: Id): Promise<Message | null> {
    const row = await this.db
      .prepare('SELECT * FROM messages WHERE id = ?1')
      .bind(id)
      .first<MessageRow>();
    return row ? toMessage(row) : null;
  }

  async findByExternalId(externalMessageId: string): Promise<Message | null> {
    const row = await this.db
      .prepare('SELECT * FROM messages WHERE external_message_id = ?1')
      .bind(externalMessageId)
      .first<MessageRow>();
    return row ? toMessage(row) : null;
  }

  async insertIfNew(message: Message): Promise<{ inserted: boolean }> {
    const result = await this.insertStatement(message, 'INSERT OR IGNORE').run();
    return { inserted: result.meta.changes === 1 };
  }

  async insert(message: Message): Promise<void> {
    await this.insertStatement(message, 'INSERT').run();
  }

  async listRecent(conversationId: Id, limit: number): Promise<Message[]> {
    const { results } = await this.db
      .prepare(
        `SELECT * FROM messages
         WHERE conversation_id = ?1
         ORDER BY COALESCE(provider_timestamp_utc, ingested_at_utc) DESC
         LIMIT ?2`,
      )
      .bind(conversationId, limit)
      .all<MessageRow>();
    return results.map(toMessage).reverse();
  }

  private insertStatement(m: Message, verb: 'INSERT' | 'INSERT OR IGNORE'): D1PreparedStatement {
    return this.db
      .prepare(
        `${verb} INTO messages
           (id, conversation_id, external_message_id, direction, origin, sender_employee_id,
            body, content_type, attachment_ref, provider_timestamp_utc, ingested_at_utc,
            delivery_status, reply_to_message_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
      )
      .bind(
        m.id,
        m.conversationId,
        m.externalMessageId,
        m.direction,
        m.origin,
        m.senderEmployeeId,
        m.body,
        m.contentType,
        m.attachmentRef,
        m.providerTimestampUtc,
        m.ingestedAtUtc,
        m.deliveryStatus,
        m.replyToMessageId,
      );
  }
}
