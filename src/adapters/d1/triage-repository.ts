import type { Intent, Priority, Stage } from '../../domain/conversation.ts';
import type { Id } from '../../domain/ids.ts';
import type {
  AiReplyRecord,
  AiReplyStatus,
  AiReplyUpdate,
  TriageEvent,
  TriageSource,
} from '../../domain/triage.ts';
import type { IsoUtc } from '../../domain/time.ts';
import type { AiReplyRepository, TriageRepository } from '../../ports/repositories.ts';

interface TriageRow {
  id: string;
  conversation_id: string;
  message_id: string | null;
  intent: Intent | null;
  stage: Stage | null;
  priority: Priority;
  needs_human: number;
  reason_code: string | null;
  source: TriageSource;
  confidence: number | null;
  model_version: string | null;
  created_at_utc: string;
}

function toTriage(row: TriageRow): TriageEvent {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    intent: row.intent,
    stage: row.stage,
    priority: row.priority,
    needsHuman: row.needs_human === 1,
    reasonCode: row.reason_code,
    source: row.source,
    confidence: row.confidence,
    modelVersion: row.model_version,
    createdAtUtc: row.created_at_utc,
  };
}

export class D1TriageRepository implements TriageRepository {
  constructor(private readonly db: D1Database) {}

  async insert(e: TriageEvent): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO triage_events
           (id, conversation_id, message_id, intent, stage, priority, needs_human, reason_code,
            source, confidence, model_version, created_at_utc)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
      )
      .bind(
        e.id,
        e.conversationId,
        e.messageId,
        e.intent,
        e.stage,
        e.priority,
        e.needsHuman ? 1 : 0,
        e.reasonCode,
        e.source,
        e.confidence,
        e.modelVersion,
        e.createdAtUtc,
      )
      .run();
  }

  async listForConversation(conversationId: Id, limit: number): Promise<TriageEvent[]> {
    const { results } = await this.db
      .prepare(
        `SELECT * FROM triage_events WHERE conversation_id = ?1
         ORDER BY created_at_utc DESC LIMIT ?2`,
      )
      .bind(conversationId, limit)
      .all<TriageRow>();
    return results.map(toTriage);
  }
}

interface AiReplyRow {
  id: string;
  conversation_id: string;
  trigger_message_id: string;
  status: AiReplyStatus;
  decision_code: string | null;
  provider: string | null;
  model: string | null;
  prompt_version: string | null;
  catalog_version: number | null;
  proposed_text: string | null;
  reply_message_id: string | null;
  confidence: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number | null;
  provider_called: number;
  created_at_utc: string;
  finished_at_utc: string | null;
}

function toAiReply(row: AiReplyRow): AiReplyRecord {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    triggerMessageId: row.trigger_message_id,
    status: row.status,
    decisionCode: row.decision_code,
    provider: row.provider,
    model: row.model,
    promptVersion: row.prompt_version,
    catalogVersion: row.catalog_version,
    proposedText: row.proposed_text,
    replyMessageId: row.reply_message_id,
    confidence: row.confidence,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    latencyMs: row.latency_ms,
    providerCalled: row.provider_called === 1,
    createdAtUtc: row.created_at_utc,
    finishedAtUtc: row.finished_at_utc,
  };
}

/** Columnas actualizables: camelCase del dominio → snake_case de D1. */
const updateColumns: Record<keyof AiReplyUpdate, string> = {
  status: 'status',
  decisionCode: 'decision_code',
  provider: 'provider',
  model: 'model',
  promptVersion: 'prompt_version',
  catalogVersion: 'catalog_version',
  proposedText: 'proposed_text',
  replyMessageId: 'reply_message_id',
  confidence: 'confidence',
  inputTokens: 'input_tokens',
  outputTokens: 'output_tokens',
  latencyMs: 'latency_ms',
  providerCalled: 'provider_called',
  finishedAtUtc: 'finished_at_utc',
};

export class D1AiReplyRepository implements AiReplyRepository {
  constructor(private readonly db: D1Database) {}

  async claim(r: AiReplyRecord): Promise<boolean> {
    const result = await this.db
      .prepare(
        `INSERT OR IGNORE INTO ai_replies
           (id, conversation_id, trigger_message_id, status, provider_called, created_at_utc)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      )
      .bind(
        r.id,
        r.conversationId,
        r.triggerMessageId,
        r.status,
        r.providerCalled ? 1 : 0,
        r.createdAtUtc,
      )
      .run();
    return result.meta.changes === 1;
  }

  async update(id: Id, update: AiReplyUpdate): Promise<void> {
    const entries = Object.entries(update) as [keyof AiReplyUpdate, unknown][];
    if (entries.length === 0) return;
    const sets = entries.map(([key], i) => `${updateColumns[key]} = ?${i + 2}`).join(', ');
    const values = entries.map(([, v]) => (typeof v === 'boolean' ? (v ? 1 : 0) : v));
    await this.db
      .prepare(`UPDATE ai_replies SET ${sets} WHERE id = ?1`)
      .bind(id, ...values)
      .run();
  }

  async findByTrigger(triggerMessageId: Id): Promise<AiReplyRecord | null> {
    const row = await this.db
      .prepare('SELECT * FROM ai_replies WHERE trigger_message_id = ?1')
      .bind(triggerMessageId)
      .first<AiReplyRow>();
    return row ? toAiReply(row) : null;
  }

  async countProviderCallsSince(sinceUtc: IsoUtc): Promise<number> {
    const row = await this.db
      .prepare(
        'SELECT COUNT(*) AS n FROM ai_replies WHERE provider_called = 1 AND created_at_utc >= ?1',
      )
      .bind(sinceUtc)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }

  async listStalePending(olderThanUtc: IsoUtc, limit: number): Promise<AiReplyRecord[]> {
    const { results } = await this.db
      .prepare(
        `SELECT * FROM ai_replies WHERE status = 'pending' AND created_at_utc < ?1
         ORDER BY created_at_utc ASC LIMIT ?2`,
      )
      .bind(olderThanUtc, limit)
      .all<AiReplyRow>();
    return results.map(toAiReply);
  }
}
