import type { Employee } from '../../domain/employee.ts';
import type { Id } from '../../domain/ids.ts';
import type { EmployeeRepository } from '../../ports/repositories.ts';
import { bool, toEmployee, type EmployeeRow } from './rows.ts';

export class D1EmployeeRepository implements EmployeeRepository {
  constructor(private readonly db: D1Database) {}

  async findById(id: Id): Promise<Employee | null> {
    const row = await this.db
      .prepare('SELECT * FROM employees WHERE id = ?1')
      .bind(id)
      .first<EmployeeRow>();
    return row ? toEmployee(row) : null;
  }

  async findByTelegramUserId(telegramUserId: number): Promise<Employee | null> {
    const row = await this.db
      .prepare('SELECT * FROM employees WHERE telegram_user_id = ?1')
      .bind(telegramUserId)
      .first<EmployeeRow>();
    return row ? toEmployee(row) : null;
  }

  async listActiveHandlers(): Promise<Employee[]> {
    const { results } = await this.db
      .prepare(
        `SELECT * FROM employees
         WHERE active = 1 AND role IN ('owner', 'agent')
         ORDER BY display_name`,
      )
      .all<EmployeeRow>();
    return results.map(toEmployee);
  }

  async insert(employee: Employee): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO employees
           (id, telegram_user_id, display_name, role, active, telegram_chat_id, created_at_utc)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      )
      .bind(
        employee.id,
        employee.telegramUserId,
        employee.displayName,
        employee.role,
        bool(employee.active),
        employee.telegramChatId,
        employee.createdAtUtc,
      )
      .run();
  }

  async setTelegramChatId(id: Id, telegramChatId: number): Promise<void> {
    await this.db
      .prepare('UPDATE employees SET telegram_chat_id = ?2 WHERE id = ?1')
      .bind(id, telegramChatId)
      .run();
  }
}
