import type { Id } from '../../domain/ids.ts';
import type { Outcome, OutcomeKind } from '../../domain/outcome.ts';
import type { OutcomeRepository } from '../../ports/repositories.ts';

interface OutcomeRow {
  id: string;
  conversation_id: string;
  kind: OutcomeKind;
  amount_minor: number | null;
  currency: string | null;
  evidence_note: string | null;
  recorded_by: string;
  recorded_at_utc: string;
}

function toOutcome(row: OutcomeRow): Outcome {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    kind: row.kind,
    amountMinor: row.amount_minor,
    currency: row.currency,
    evidenceNote: row.evidence_note,
    recordedBy: row.recorded_by,
    recordedAtUtc: row.recorded_at_utc,
  };
}

export class D1OutcomeRepository implements OutcomeRepository {
  constructor(private readonly db: D1Database) {}

  async insert(o: Outcome): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO outcomes
           (id, conversation_id, kind, amount_minor, currency, evidence_note, recorded_by, recorded_at_utc)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      )
      .bind(
        o.id,
        o.conversationId,
        o.kind,
        o.amountMinor,
        o.currency,
        o.evidenceNote,
        o.recordedBy,
        o.recordedAtUtc,
      )
      .run();
  }

  async findLatestForConversation(conversationId: Id): Promise<Outcome | null> {
    const row = await this.db
      .prepare(
        `SELECT * FROM outcomes WHERE conversation_id = ?1 ORDER BY recorded_at_utc DESC LIMIT 1`,
      )
      .bind(conversationId)
      .first<OutcomeRow>();
    return row ? toOutcome(row) : null;
  }

  async updateAmount(
    id: Id,
    amountMinor: number | null,
    currency: string | null,
    evidenceNote: string | null,
  ): Promise<void> {
    await this.db
      .prepare(
        `UPDATE outcomes
         SET amount_minor = ?2, currency = ?3, evidence_note = COALESCE(?4, evidence_note)
         WHERE id = ?1`,
      )
      .bind(id, amountMinor, currency, evidenceNote)
      .run();
  }
}
