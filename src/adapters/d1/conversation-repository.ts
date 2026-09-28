import type { Conversation, ConversationMode, ModeChange } from '../../domain/conversation.ts';
import type { Id } from '../../domain/ids.ts';
import type { IsoUtc } from '../../domain/time.ts';
import type { ClaimResult, ConversationRepository } from '../../ports/repositories.ts';
import { toConversation, type ConversationRow } from './rows.ts';

export class D1ConversationRepository implements ConversationRepository {
  constructor(private readonly db: D1Database) {}

  async findById(id: Id): Promise<Conversation | null> {
    const row = await this.db
      .prepare('SELECT * FROM conversations WHERE id = ?1')
      .bind(id)
      .first<ConversationRow>();
    return row ? toConversation(row) : null;
  }

  async findOpenByCustomer(customerId: Id): Promise<Conversation | null> {
    const row = await this.db
      .prepare(
        `SELECT * FROM conversations
         WHERE customer_id = ?1 AND mode != 'CLOSED'
         ORDER BY opened_at_utc DESC
         LIMIT 1`,
      )
      .bind(customerId)
      .first<ConversationRow>();
    return row ? toConversation(row) : null;
  }

  async insert(c: Conversation): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO conversations
           (id, ig_account_id, customer_id, mode, mode_reason, assigned_employee_id, priority,
            intent, stage, version, last_customer_message_at_utc, last_message_at_utc,
            opened_at_utc, closed_at_utc)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
      )
      .bind(
        c.id,
        c.igAccountId,
        c.customerId,
        c.mode,
        c.modeReason,
        c.assignedEmployeeId,
        c.priority,
        c.intent,
        c.stage,
        c.version,
        c.lastCustomerMessageAtUtc,
        c.lastMessageAtUtc,
        c.openedAtUtc,
        c.closedAtUtc,
      )
      .run();
  }

  async applyModeChange(
    conversationId: Id,
    expectedVersion: number,
    change: ModeChange,
    now: IsoUtc,
  ): Promise<boolean> {
    const result = await this.db
      .prepare(
        `UPDATE conversations
         SET mode = ?3,
             mode_reason = ?4,
             assigned_employee_id = ?5,
             closed_at_utc = CASE WHEN ?6 = 1 THEN ?7 ELSE NULL END,
             version = version + 1
         WHERE id = ?1 AND version = ?2`,
      )
      .bind(
        conversationId,
        expectedVersion,
        change.mode,
        change.modeReason,
        change.assignedEmployeeId,
        change.closed ? 1 : 0,
        now,
      )
      .run();
    return result.meta.changes === 1;
  }

  async claim(conversationId: Id, employeeId: Id, now: IsoUtc): Promise<ClaimResult> {
    // Una sola sentencia condicional: D1 la ejecuta de forma atómica, así que de dos
    // agentes que compiten exactamente uno ve `changes === 1`.
    const result = await this.db
      .prepare(
        `UPDATE conversations
         SET mode = 'HUMAN',
             mode_reason = 'agent_claim',
             assigned_employee_id = ?2,
             version = version + 1,
             last_message_at_utc = COALESCE(last_message_at_utc, ?3)
         WHERE id = ?1 AND mode = 'PENDING_HUMAN' AND assigned_employee_id IS NULL`,
      )
      .bind(conversationId, employeeId, now)
      .run();

    if (result.meta.changes !== 1) {
      const exists = await this.findById(conversationId);
      return { ok: false, reason: exists ? 'not_pending' : 'not_found' };
    }
    const conversation = await this.findById(conversationId);
    if (!conversation) return { ok: false, reason: 'not_found' };
    return { ok: true, conversation };
  }

  async touchCustomerMessage(conversationId: Id, atUtc: IsoUtc): Promise<void> {
    await this.db
      .prepare(
        `UPDATE conversations
         SET last_customer_message_at_utc = MAX(COALESCE(last_customer_message_at_utc, ''), ?2),
             last_message_at_utc = MAX(COALESCE(last_message_at_utc, ''), ?2)
         WHERE id = ?1`,
      )
      .bind(conversationId, atUtc)
      .run();
  }

  async touchOutbound(conversationId: Id, atUtc: IsoUtc): Promise<void> {
    await this.db
      .prepare(
        `UPDATE conversations
         SET last_message_at_utc = MAX(COALESCE(last_message_at_utc, ''), ?2)
         WHERE id = ?1`,
      )
      .bind(conversationId, atUtc)
      .run();
  }

  async listByMode(mode: ConversationMode, limit: number, offset: number): Promise<Conversation[]> {
    const { results } = await this.db
      .prepare(
        `SELECT * FROM conversations
         WHERE mode = ?1
         ORDER BY CASE priority WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END,
                  last_customer_message_at_utc ASC
         LIMIT ?2 OFFSET ?3`,
      )
      .bind(mode, limit, offset)
      .all<ConversationRow>();
    return results.map(toConversation);
  }

  async listAssignedTo(employeeId: Id, limit: number, offset: number): Promise<Conversation[]> {
    const { results } = await this.db
      .prepare(
        `SELECT * FROM conversations
         WHERE assigned_employee_id = ?1 AND mode = 'HUMAN'
         ORDER BY last_message_at_utc DESC
         LIMIT ?2 OFFSET ?3`,
      )
      .bind(employeeId, limit, offset)
      .all<ConversationRow>();
    return results.map(toConversation);
  }
}
