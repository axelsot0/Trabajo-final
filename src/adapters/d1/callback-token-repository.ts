import type { CallbackAction, CallbackToken } from '../../domain/telegram.ts';
import type { IsoUtc } from '../../domain/time.ts';
import type { CallbackTokenRepository } from '../../ports/repositories.ts';

interface TokenRow {
  token: string;
  employee_id: string;
  conversation_id: string | null;
  action: CallbackAction;
  params: string | null;
  single_use: number;
  expires_at_utc: string;
  used_at_utc: string | null;
  created_at_utc: string;
}

export class D1CallbackTokenRepository implements CallbackTokenRepository {
  constructor(private readonly db: D1Database) {}

  async insert(t: CallbackToken): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO callback_tokens
           (token, employee_id, conversation_id, action, params, single_use, expires_at_utc,
            used_at_utc, created_at_utc)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
      )
      .bind(
        t.token,
        t.employeeId,
        t.conversationId,
        t.action,
        t.params,
        t.singleUse ? 1 : 0,
        t.expiresAtUtc,
        t.usedAtUtc,
        t.createdAtUtc,
      )
      .run();
  }

  async find(token: string): Promise<CallbackToken | null> {
    const row = await this.db
      .prepare('SELECT * FROM callback_tokens WHERE token = ?1')
      .bind(token)
      .first<TokenRow>();
    if (!row) return null;
    return {
      token: row.token,
      employeeId: row.employee_id,
      conversationId: row.conversation_id,
      action: row.action,
      params: row.params,
      singleUse: row.single_use === 1,
      expiresAtUtc: row.expires_at_utc,
      usedAtUtc: row.used_at_utc,
      createdAtUtc: row.created_at_utc,
    };
  }

  async consume(token: string, nowUtc: IsoUtc): Promise<boolean> {
    const result = await this.db
      .prepare(
        `UPDATE callback_tokens
         SET used_at_utc = ?2
         WHERE token = ?1 AND used_at_utc IS NULL AND expires_at_utc > ?2`,
      )
      .bind(token, nowUtc)
      .run();
    return result.meta.changes === 1;
  }

  async deleteExpired(nowUtc: IsoUtc): Promise<number> {
    const result = await this.db
      .prepare('DELETE FROM callback_tokens WHERE expires_at_utc <= ?1')
      .bind(nowUtc)
      .run();
    return result.meta.changes;
  }
}
