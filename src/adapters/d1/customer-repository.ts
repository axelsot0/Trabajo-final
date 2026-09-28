import type { Customer } from '../../domain/customer.ts';
import type { Id } from '../../domain/ids.ts';
import type { CustomerRepository } from '../../ports/repositories.ts';
import { toCustomer, type CustomerRow } from './rows.ts';

export class D1CustomerRepository implements CustomerRepository {
  constructor(private readonly db: D1Database) {}

  async findById(id: Id): Promise<Customer | null> {
    const row = await this.db
      .prepare('SELECT * FROM customers WHERE id = ?1')
      .bind(id)
      .first<CustomerRow>();
    return row ? toCustomer(row) : null;
  }

  async findByScopedId(igAccountId: Id, igScopedId: string): Promise<Customer | null> {
    const row = await this.db
      .prepare('SELECT * FROM customers WHERE ig_account_id = ?1 AND ig_scoped_id = ?2')
      .bind(igAccountId, igScopedId)
      .first<CustomerRow>();
    return row ? toCustomer(row) : null;
  }

  async insert(customer: Customer): Promise<void> {
    await this.insertStatement(customer, 'INSERT').run();
  }

  async findOrCreate(customer: Customer): Promise<Customer> {
    await this.insertStatement(customer, 'INSERT OR IGNORE').run();
    const stored = await this.findByScopedId(customer.igAccountId, customer.igScopedId);
    if (stored === null) {
      throw new Error('customers.findOrCreate: la fila no existe tras insertar');
    }
    return stored;
  }

  private insertStatement(
    customer: Customer,
    verb: 'INSERT' | 'INSERT OR IGNORE',
  ): D1PreparedStatement {
    return this.db
      .prepare(
        `${verb} INTO customers (id, ig_account_id, ig_scoped_id, display_name, created_at_utc)
         VALUES (?1, ?2, ?3, ?4, ?5)`,
      )
      .bind(
        customer.id,
        customer.igAccountId,
        customer.igScopedId,
        customer.displayName,
        customer.createdAtUtc,
      );
  }
}
