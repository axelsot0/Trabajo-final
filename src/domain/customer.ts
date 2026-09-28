import type { Id } from './ids.ts';
import type { IsoUtc } from './time.ts';

export interface Customer {
  id: Id;
  igAccountId: Id;
  /** IGSID: identificador con alcance de Instagram. El username no es estable. */
  igScopedId: string;
  displayName: string | null;
  createdAtUtc: IsoUtc;
}
