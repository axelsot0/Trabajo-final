import type { Id } from '../../domain/ids.ts';
import type { IgAccount, IgAccountStatus } from '../../domain/ig-account.ts';
import type { IsoUtc } from '../../domain/time.ts';
import type { IgAccountRepository } from '../../ports/repositories.ts';
import { bool, toIgAccount, type IgAccountRow } from './rows.ts';

export class D1IgAccountRepository implements IgAccountRepository {
  constructor(private readonly db: D1Database) {}

  async findById(id: Id): Promise<IgAccount | null> {
    const row = await this.db
      .prepare('SELECT * FROM ig_accounts WHERE id = ?1')
      .bind(id)
      .first<IgAccountRow>();
    return row ? toIgAccount(row) : null;
  }

  async findByIgUserId(igUserId: string): Promise<IgAccount | null> {
    const row = await this.db
      .prepare('SELECT * FROM ig_accounts WHERE ig_user_id = ?1')
      .bind(igUserId)
      .first<IgAccountRow>();
    return row ? toIgAccount(row) : null;
  }

  async insert(account: IgAccount): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO ig_accounts
           (id, ig_user_id, display_name, status, token_reference, human_agent_enabled,
            last_token_check_at_utc, created_at_utc)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      )
      .bind(
        account.id,
        account.igUserId,
        account.displayName,
        account.status,
        account.tokenReference,
        bool(account.humanAgentEnabled),
        account.lastTokenCheckAtUtc,
        account.createdAtUtc,
      )
      .run();
  }

  async setStatus(id: Id, status: IgAccountStatus, checkedAtUtc: IsoUtc): Promise<void> {
    await this.db
      .prepare('UPDATE ig_accounts SET status = ?2, last_token_check_at_utc = ?3 WHERE id = ?1')
      .bind(id, status, checkedAtUtc)
      .run();
  }
}
