import type { Id } from '../../domain/ids.ts';
import type { OutboxItem, OutboxOperation, OutboxStatus } from '../../domain/outbox.ts';
import type { IsoUtc } from '../../domain/time.ts';
import type { OutboxRepository } from '../../ports/repositories.ts';

interface OutboxRow {
  id: string;
  conversation_id: string;
  message_id: string | null;
  operation: OutboxOperation;
  payload_minimal: string;
  status: OutboxStatus;
  retry_at_utc: string | null;
  attempts: number;
  last_error_code: string | null;
  remote_message_id: string | null;
  conversation_version: number;
  created_at_utc: string;
  updated_at_utc: string;
}

function toOutboxItem(row: OutboxRow): OutboxItem {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    operation: row.operation,
    payloadMinimal: row.payload_minimal,
    status: row.status,
    retryAtUtc: row.retry_at_utc,
    attempts: row.attempts,
    lastErrorCode: row.last_error_code,
    remoteMessageId: row.remote_message_id,
    conversationVersion: row.conversation_version,
    createdAtUtc: row.created_at_utc,
    updatedAtUtc: row.updated_at_utc,
  };
}

export class D1OutboxRepository implements OutboxRepository {
  constructor(private readonly db: D1Database) {}

  async enqueue(item: OutboxItem): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO outbox
           (id, conversation_id, message_id, operation, payload_minimal, status, retry_at_utc,
            attempts, last_error_code, remote_message_id, conversation_version, created_at_utc,
            updated_at_utc)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
      )
      .bind(
        item.id,
        item.conversationId,
        item.messageId,
        item.operation,
        item.payloadMinimal,
        item.status,
        item.retryAtUtc,
        item.attempts,
        item.lastErrorCode,
        item.remoteMessageId,
        item.conversationVersion,
        item.createdAtUtc,
        item.updatedAtUtc,
      )
      .run();
  }

  async findById(id: Id): Promise<OutboxItem | null> {
    const row = await this.db
      .prepare('SELECT * FROM outbox WHERE id = ?1')
      .bind(id)
      .first<OutboxRow>();
    return row ? toOutboxItem(row) : null;
  }

  async findByMessageId(messageId: Id): Promise<OutboxItem | null> {
    const row = await this.db
      .prepare('SELECT * FROM outbox WHERE message_id = ?1 ORDER BY created_at_utc DESC LIMIT 1')
      .bind(messageId)
      .first<OutboxRow>();
    return row ? toOutboxItem(row) : null;
  }

  async claimDue(nowUtc: IsoUtc, limit: number): Promise<OutboxItem[]> {
    const { results } = await this.db
      .prepare(
        `UPDATE outbox
         SET status = 'in_flight', attempts = attempts + 1, updated_at_utc = ?1
         WHERE id IN (
           SELECT id FROM outbox
           WHERE status = 'pending' AND (retry_at_utc IS NULL OR retry_at_utc <= ?1)
           ORDER BY created_at_utc ASC
           LIMIT ?2
         )
         RETURNING *`,
      )
      .bind(nowUtc, limit)
      .all<OutboxRow>();
    return results.map(toOutboxItem);
  }

  async markSent(id: Id, remoteMessageId: string, nowUtc: IsoUtc): Promise<void> {
    await this.setStatus(id, 'sent', null, nowUtc, remoteMessageId);
  }

  async markFailed(id: Id, errorCode: string, nowUtc: IsoUtc): Promise<void> {
    await this.setStatus(id, 'failed', errorCode, nowUtc);
  }

  async markCancelled(id: Id, errorCode: string, nowUtc: IsoUtc): Promise<void> {
    await this.setStatus(id, 'cancelled', errorCode, nowUtc);
  }

  async markUncertain(id: Id, errorCode: string, nowUtc: IsoUtc): Promise<void> {
    await this.setStatus(id, 'uncertain', errorCode, nowUtc);
  }

  async scheduleRetry(
    id: Id,
    errorCode: string,
    retryAtUtc: IsoUtc,
    nowUtc: IsoUtc,
  ): Promise<void> {
    await this.db
      .prepare(
        `UPDATE outbox
         SET status = 'pending', last_error_code = ?2, retry_at_utc = ?3, updated_at_utc = ?4
         WHERE id = ?1`,
      )
      .bind(id, errorCode, retryAtUtc, nowUtc)
      .run();
  }

  async listUncertain(olderThanUtc: IsoUtc, limit: number): Promise<OutboxItem[]> {
    const { results } = await this.db
      .prepare(
        `SELECT * FROM outbox
         WHERE status = 'uncertain' AND updated_at_utc <= ?1
         ORDER BY updated_at_utc ASC
         LIMIT ?2`,
      )
      .bind(olderThanUtc, limit)
      .all<OutboxRow>();
    return results.map(toOutboxItem);
  }

  async listByConversation(conversationId: Id, limit: number): Promise<OutboxItem[]> {
    const { results } = await this.db
      .prepare(
        `SELECT * FROM outbox WHERE conversation_id = ?1 ORDER BY created_at_utc DESC LIMIT ?2`,
      )
      .bind(conversationId, limit)
      .all<OutboxRow>();
    return results.map(toOutboxItem);
  }

  async countByStatus(): Promise<Record<OutboxStatus, number>> {
    const { results } = await this.db
      .prepare('SELECT status, COUNT(*) AS n FROM outbox GROUP BY status')
      .all<{ status: OutboxStatus; n: number }>();
    const counts: Record<OutboxStatus, number> = {
      pending: 0,
      in_flight: 0,
      sent: 0,
      failed: 0,
      uncertain: 0,
      cancelled: 0,
    };
    for (const row of results) counts[row.status] = row.n;
    return counts;
  }

  private async setStatus(
    id: Id,
    status: OutboxStatus,
    errorCode: string | null,
    nowUtc: IsoUtc,
    remoteMessageId: string | null = null,
  ): Promise<void> {
    await this.db
      .prepare(
        `UPDATE outbox
         SET status = ?2,
             last_error_code = ?3,
             remote_message_id = COALESCE(?4, remote_message_id),
             updated_at_utc = ?5
         WHERE id = ?1`,
      )
      .bind(id, status, errorCode, remoteMessageId, nowUtc)
      .run();
  }
}
