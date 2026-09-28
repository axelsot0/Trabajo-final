import type { Id } from './ids.ts';
import type { IsoUtc } from './time.ts';

export type EmployeeRole = 'owner' | 'agent' | 'viewer';

export function isEmployeeRole(value: string): value is EmployeeRole {
  return value === 'owner' || value === 'agent' || value === 'viewer';
}

export const roleLabel: Record<EmployeeRole, string> = {
  owner: 'owner',
  agent: 'agente',
  viewer: 'solo lectura',
};

/** Invitación de un solo uso para registrarse como empleado desde Telegram. */
export interface EmployeeInvite {
  code: string;
  role: EmployeeRole;
  createdByEmployeeId: Id;
  createdAtUtc: IsoUtc;
  expiresAtUtc: IsoUtc;
  usedAtUtc: IsoUtc | null;
  usedByEmployeeId: Id | null;
}

export interface Employee {
  id: Id;
  telegramUserId: number;
  displayName: string;
  role: EmployeeRole;
  active: boolean;
  telegramChatId: number | null;
  createdAtUtc: IsoUtc;
}

/** Solo `owner` y `agent` atienden conversaciones; `viewer` únicamente consulta. */
export function canHandleConversations(employee: Employee): boolean {
  return employee.active && (employee.role === 'owner' || employee.role === 'agent');
}
