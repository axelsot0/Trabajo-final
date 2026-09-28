import type { Id } from '../../domain/ids.ts';
import type { IsoUtc } from '../../domain/time.ts';
import type {
  WebhookEvent,
  WebhookProcessStatus,
  WebhookProvider,
} from '../../domain/webhook-event.ts';
import type { WebhookEventRepository } from '../../ports/repositories.ts';

interface WebhookEventRow {
  id: string;
  provider: WebhookProvider;
  external_event_key: string;
  received_at_utc: string;
  process_status: WebhookProcessStatus;
  attempts: number;
  error_code: string | null;
  payload_minimal: string;
  processed_at_utc: string | null;
}

function toWebhookEvent(row: WebhookEventRow): WebhookEvent {
  return {
    id: row.id,
    provider: row.provider,
    externalEventKey: row.external_event_key,
    receivedAtUtc: row.received_at_utc,
    processStatus: row.process_status,
    attempts: row.attempts,
    errorCode: row.error_code,
    payloadMinimal: row.payload_minimal,
    processedAtUtc: row.processed_at_utc,
  };
}

export class D1WebhookEventRepository implements WebhookEventRepository {
  constructor(private readonly db: D1Database) {}

  async insertIfNew(event: WebhookEvent): Promise<boolean> {
    const result = await this.db
      .prepare(
        `INSERT OR IGNORE INTO webhook_events
           (id, provider, external_event_key, received_at_utc, process_status, attempts,
            error_code, payload_minimal, processed_at_utc)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
      )
      .bind(
        event.id,
        event.provider,
        event.externalEventKey,
        event.receivedAtUtc,
        event.processStatus,
        event.attempts,
        event.errorCode,
        event.payloadMinimal,
        event.processedAtUtc,
      )
      .run();
    return result.meta.changes === 1;
  }

  async findByKey(externalEventKey: string): Promise<WebhookEvent | null> {
    const row = await this.db
      .prepare('SELECT * FROM webhook_events WHERE external_event_key = ?1')
      .bind(externalEventKey)
      .first<WebhookEventRow>();
    return row ? toWebhookEvent(row) : null;
  }

  async claimPending(limit: number): Promise<WebhookEvent[]> {
    const { results } = await this.db
      .prepare(
        `UPDATE webhook_events
         SET process_status = 'processing', attempts = attempts + 1
         WHERE id IN (
           SELECT id FROM webhook_events
           WHERE process_status = 'pending'
           ORDER BY received_at_utc ASC
           LIMIT ?1
         )
         RETURNING *`,
      )
      .bind(limit)
      .all<WebhookEventRow>();
    return results.map(toWebhookEvent);
  }

  async markDone(id: Id, processedAtUtc: IsoUtc): Promise<void> {
    await this.db
      .prepare(
        `UPDATE webhook_events
         SET process_status = 'done', error_code = NULL, processed_at_utc = ?2
         WHERE id = ?1`,
      )
      .bind(id, processedAtUtc)
      .run();
  }

  async markIgnored(id: Id, code: string, processedAtUtc: IsoUtc): Promise<void> {
    await this.db
      .prepare(
        `UPDATE webhook_events
         SET process_status = 'ignored', error_code = ?2, processed_at_utc = ?3
         WHERE id = ?1`,
      )
      .bind(id, code, processedAtUtc)
      .run();
  }

  async markFailed(id: Id, code: string, maxAttempts: number): Promise<void> {
    await this.db
      .prepare(
        `UPDATE webhook_events
         SET process_status = CASE WHEN attempts >= ?3 THEN 'failed' ELSE 'pending' END,
             error_code = ?2
         WHERE id = ?1`,
      )
      .bind(id, code, maxAttempts)
      .run();
  }

  async releaseStuck(olderThanUtc: IsoUtc): Promise<number> {
    // `received_at_utc` es la mejor aproximación disponible al inicio del procesamiento
    // sin añadir una columna; un evento en `processing` con recepción antigua está atascado.
    const result = await this.db
      .prepare(
        `UPDATE webhook_events
         SET process_status = 'pending'
         WHERE process_status = 'processing' AND received_at_utc < ?1`,
      )
      .bind(olderThanUtc)
      .run();
    return result.meta.changes;
  }

  async countByStatus(): Promise<Record<WebhookProcessStatus, number>> {
    const { results } = await this.db
      .prepare('SELECT process_status, COUNT(*) AS n FROM webhook_events GROUP BY process_status')
      .all<{ process_status: WebhookProcessStatus; n: number }>();
    const counts: Record<WebhookProcessStatus, number> = {
      pending: 0,
      processing: 0,
      done: 0,
      failed: 0,
      ignored: 0,
    };
    for (const row of results) counts[row.process_status] = row.n;
    return counts;
  }
}
