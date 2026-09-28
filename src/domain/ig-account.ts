import type { Id } from './ids.ts';
import type { IsoUtc } from './time.ts';

export type IgAccountStatus = 'active' | 'disabled' | 'token_invalid';

export interface IgAccount {
  id: Id;
  igUserId: string;
  displayName: string | null;
  status: IgAccountStatus;
  /** Nombre del secreto del Worker con el token; nunca el token en sí. */
  tokenReference: string;
  humanAgentEnabled: boolean;
  lastTokenCheckAtUtc: IsoUtc | null;
  createdAtUtc: IsoUtc;
}
