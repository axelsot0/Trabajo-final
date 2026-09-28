import type { Id } from './ids.ts';
import type { IsoUtc } from './time.ts';

/** Cómo se muestra el cliente a los agentes: nombre, @usuario o referencia corta. */
export function customerLabel(customer: Pick<Customer, 'id' | 'displayName' | 'username'>): string {
  if (customer.displayName !== null && customer.username !== null) {
    return `${customer.displayName} (@${customer.username})`;
  }
  if (customer.displayName !== null) return customer.displayName;
  if (customer.username !== null) return `@${customer.username}`;
  return `Cliente #${customer.id.slice(0, 8)}`;
}

export interface Customer {
  id: Id;
  igAccountId: Id;
  /** IGSID: identificador con alcance de Instagram. El username no es estable. */
  igScopedId: string;
  /** Nombre de perfil de Instagram, si Meta lo entrega. */
  displayName: string | null;
  /** @usuario de Instagram (puede cambiar; nunca se usa como identificador). */
  username: string | null;
  profileCheckedAtUtc: IsoUtc | null;
  createdAtUtc: IsoUtc;
}
