import type { Id } from './ids.ts';
import type { IsoUtc } from './time.ts';

export type EmployeeRole = 'owner' | 'agent' | 'viewer';

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
