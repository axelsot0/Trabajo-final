import type { Id } from './ids.ts';
import type { IsoUtc } from './time.ts';

export type AuditActorType = 'employee' | 'system' | 'ai' | 'customer';

export interface AuditEvent {
  id: Id;
  actorType: AuditActorType;
  actorId: Id | null;
  action: string;
  entityType: string;
  entityId: Id;
  /** Estados antes/después ya redactados: nunca texto de clientes ni tokens. */
  beforeRedacted: string | null;
  afterRedacted: string | null;
  atUtc: IsoUtc;
}
