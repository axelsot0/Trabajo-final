import type { AuditActorType, AuditEvent } from '../../domain/audit.ts';
import type { Id } from '../../domain/ids.ts';
import type { AuditRepository } from '../../ports/repositories.ts';

interface AuditRow {
  id: string;
  actor_type: AuditActorType;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  before_redacted: string | null;
  after_redacted: string | null;
  at_utc: string;
}

export class D1AuditRepository implements AuditRepository {
  constructor(private readonly db: D1Database) {}

  async record(e: AuditEvent): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO audit_events
           (id, actor_type, actor_id, action, entity_type, entity_id, before_redacted,
            after_redacted, at_utc)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
      )
      .bind(
        e.id,
        e.actorType,
        e.actorId,
        e.action,
        e.entityType,
        e.entityId,
        e.beforeRedacted,
        e.afterRedacted,
        e.atUtc,
      )
      .run();
  }

  async listForEntity(entityType: string, entityId: Id, limit: number): Promise<AuditEvent[]> {
    const { results } = await this.db
      .prepare(
        `SELECT * FROM audit_events
         WHERE entity_type = ?1 AND entity_id = ?2
         ORDER BY at_utc DESC
         LIMIT ?3`,
      )
      .bind(entityType, entityId, limit)
      .all<AuditRow>();
    return results.map((row) => ({
      id: row.id,
      actorType: row.actor_type,
      actorId: row.actor_id,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      beforeRedacted: row.before_redacted,
      afterRedacted: row.after_redacted,
      atUtc: row.at_utc,
    }));
  }
}
