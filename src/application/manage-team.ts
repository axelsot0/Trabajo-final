import type { Employee, EmployeeInvite, EmployeeRole } from '../domain/employee.ts';
import { newId, type Id } from '../domain/ids.ts';
import { newCallbackToken } from '../domain/telegram.ts';
import { MS_PER_HOUR, toIsoUtc } from '../domain/time.ts';
import type { Clock } from '../ports/clock.ts';
import type {
  AuditRepository,
  EmployeeInviteRepository,
  EmployeeRepository,
} from '../ports/repositories.ts';

/** Vigencia de un enlace de invitación. */
export const INVITE_TTL_MS = 48 * MS_PER_HOUR;

export interface ManageTeamDeps {
  employees: EmployeeRepository;
  invites: EmployeeInviteRepository;
  audit: AuditRepository;
  clock: Clock;
}

export type RedeemResult =
  | { ok: true; employee: Employee; invitedBy: Id; reactivated: boolean }
  | { ok: false; reason: 'invalid' | 'expired' | 'used' };

/**
 * Alta y baja de agentes desde Telegram. Solo un `owner` invita o da de baja; el
 * invitado se registra al abrir el enlace, con su identidad verificada por Telegram.
 */
export class ManageTeam {
  constructor(private readonly deps: ManageTeamDeps) {}

  async createInvite(owner: Employee, role: EmployeeRole): Promise<EmployeeInvite | null> {
    if (owner.role !== 'owner' || !owner.active) return null;
    const now = this.deps.clock.now();
    const invite: EmployeeInvite = {
      code: newCallbackToken(),
      role,
      createdByEmployeeId: owner.id,
      createdAtUtc: toIsoUtc(now),
      expiresAtUtc: toIsoUtc(new Date(now.getTime() + INVITE_TTL_MS)),
      usedAtUtc: null,
      usedByEmployeeId: null,
    };
    await this.deps.invites.insert(invite);
    await this.audit(owner.id, 'team.invite_created', invite.code.slice(0, 6), { role });
    return invite;
  }

  /** Canjea el código de un `/start <código>`: crea o reactiva al empleado. */
  async redeem(input: {
    code: string;
    telegramUserId: number;
    chatId: number;
    displayName: string;
  }): Promise<RedeemResult> {
    const { employees, invites, clock } = this.deps;
    const invite = await invites.find(input.code);
    if (invite === null) return { ok: false, reason: 'invalid' };
    const nowUtc = toIsoUtc(clock.now());
    if (invite.usedAtUtc !== null) return { ok: false, reason: 'used' };
    if (invite.expiresAtUtc <= nowUtc) return { ok: false, reason: 'expired' };

    // Consumo atómico: si dos personas abren el mismo enlace, solo una entra.
    if (!(await invites.consume(input.code, nowUtc))) return { ok: false, reason: 'used' };

    const existing = await employees.findByTelegramUserId(input.telegramUserId);
    const employeeId = existing?.id ?? newId();

    let employee: Employee;
    if (existing === null) {
      employee = {
        id: employeeId,
        telegramUserId: input.telegramUserId,
        displayName: input.displayName,
        role: invite.role,
        active: true,
        telegramChatId: input.chatId,
        createdAtUtc: nowUtc,
      };
      await employees.insert(employee);
    } else {
      await employees.updateAccess(existing.id, { role: invite.role, active: true });
      await employees.setTelegramChatId(existing.id, input.chatId);
      employee = { ...existing, role: invite.role, active: true, telegramChatId: input.chatId };
    }
    await invites.setUsedBy(input.code, employee.id);
    await this.audit(employee.id, 'team.invite_redeemed', employee.id, { role: invite.role });
    return {
      ok: true,
      employee,
      invitedBy: invite.createdByEmployeeId,
      reactivated: existing !== null,
    };
  }

  async listTeam(): Promise<Employee[]> {
    return this.deps.employees.listAll();
  }

  async deactivate(
    owner: Employee,
    employeeId: Id,
  ): Promise<
    { ok: true; employee: Employee } | { ok: false; reason: 'forbidden' | 'self' | 'not_found' }
  > {
    if (owner.role !== 'owner' || !owner.active) return { ok: false, reason: 'forbidden' };
    if (owner.id === employeeId) return { ok: false, reason: 'self' };
    const target = await this.deps.employees.findById(employeeId);
    if (target === null) return { ok: false, reason: 'not_found' };
    await this.deps.employees.updateAccess(employeeId, { role: target.role, active: false });
    await this.audit(owner.id, 'team.deactivated', employeeId, { role: target.role });
    return { ok: true, employee: { ...target, active: false } };
  }

  private async audit(
    actorId: Id,
    action: string,
    entityId: string,
    after: unknown,
  ): Promise<void> {
    await this.deps.audit.record({
      id: newId(),
      actorType: 'employee',
      actorId,
      action,
      entityType: 'employee',
      entityId,
      beforeRedacted: null,
      afterRedacted: JSON.stringify(after),
      atUtc: toIsoUtc(this.deps.clock.now()),
    });
  }
}
