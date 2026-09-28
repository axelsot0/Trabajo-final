import type { EmployeeInvite, EmployeeRole } from '../../domain/employee.ts';
import type { Id } from '../../domain/ids.ts';
import type { IsoUtc } from '../../domain/time.ts';
import type { EmployeeInviteRepository } from '../../ports/repositories.ts';

interface EmployeeInviteRow {
  code: string;
  role: EmployeeRole;
  created_by_employee_id: string;
  created_at_utc: string;
  expires_at_utc: string;
  used_at_utc: string | null;
  used_by_employee_id: string | null;
}

export class D1EmployeeInviteRepository implements EmployeeInviteRepository {
  constructor(private readonly db: D1Database) {}

  async insert(i: EmployeeInvite): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO employee_invites
           (code, role, created_by_employee_id, created_at_utc, expires_at_utc, used_at_utc,
            used_by_employee_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      )
      .bind(
        i.code,
        i.role,
        i.createdByEmployeeId,
        i.createdAtUtc,
        i.expiresAtUtc,
        i.usedAtUtc,
        i.usedByEmployeeId,
      )
      .run();
  }

  async find(code: string): Promise<EmployeeInvite | null> {
    const row = await this.db
      .prepare('SELECT * FROM employee_invites WHERE code = ?1')
      .bind(code)
      .first<EmployeeInviteRow>();
    if (row === null) return null;
    return {
      code: row.code,
      role: row.role,
      createdByEmployeeId: row.created_by_employee_id,
      createdAtUtc: row.created_at_utc,
      expiresAtUtc: row.expires_at_utc,
      usedAtUtc: row.used_at_utc,
      usedByEmployeeId: row.used_by_employee_id,
    };
  }

  async consume(code: string, nowUtc: IsoUtc): Promise<boolean> {
    const result = await this.db
      .prepare(
        `UPDATE employee_invites SET used_at_utc = ?2
         WHERE code = ?1 AND used_at_utc IS NULL AND expires_at_utc > ?2`,
      )
      .bind(code, nowUtc)
      .run();
    return result.meta.changes === 1;
  }

  async setUsedBy(code: string, employeeId: Id): Promise<void> {
    await this.db
      .prepare('UPDATE employee_invites SET used_by_employee_id = ?2 WHERE code = ?1')
      .bind(code, employeeId)
      .run();
  }
}
