// Personnes du personnel et attributions de rôles (FR-006, FR-008, contrat « Personnes »). Les écritures reçoivent
// le client de la transaction métier (IdempotentTx) : travail et audit sont validés ou annulés ensemble. Les
// lectures ouvrent leur transaction cloisonnée par le prestataire du chemin.
import { Injectable } from '@nestjs/common';
import { AuditService, type AuditContext } from '../../audit/audit.service';
import { TenantTx, type TxClient } from '../../db/tenant-tx';
import { ProblemException } from '../../errors/problem';
import { isSqlError } from '../../errors/sqlstate-map';
import type { Principal, Role } from '../principal';
import { resolveChain } from '../scope-resolver';
import { administeredOrganizers, canGrant, GRANTABLE_ROLES, grantTarget, type GrantableRole, type GrantScope } from './role-rules';
import {
  assignmentDto,
  decodeCursor,
  encodeCursor,
  isUuid,
  staffUserDto,
  type AppUserRow,
  type RoleAssignmentDto,
  type RoleAssignmentRow,
  type RoleGrantInput,
  type StaffUserCreate,
  type StaffUserDto,
} from './users.dto';

export interface UserPage {
  data: StaffUserDto[];
  next_cursor: string | null;
  has_more: boolean;
}

/** Qui agit : la personne et le rôle d'administration qu'elle exerce pour cette requête. */
export interface Actor {
  principal: Principal;
  role: Role;
  audit: AuditContext;
}

const conflict = (detail: string): ProblemException => new ProblemException('CONFLICT_STATE', { status: 409, detail });
const forbidden = (detail?: string): ProblemException => new ProblemException('FORBIDDEN', { detail });
const notFound = (): ProblemException => new ProblemException('NOT_FOUND');

/** SQLSTATE d'une erreur `pg`, sinon undefined. */
const sqlstate = (error: unknown): string | undefined => (isSqlError(error) ? error.code : undefined);

/**
 * Visibilité : tout le prestataire si `$1` est NULL ; sinon (ORGANIZER_ADMIN) les personnes qui ont une
 * attribution active sur un des organisateurs `$1` ou sur un de leurs événements, et celles créées par `$2`.
 */
const VISIBLE = `($1::uuid[] IS NULL OR u.created_by = $2::uuid OR EXISTS (
    SELECT 1 FROM role_assignment ra LEFT JOIN event e ON ra.scope_type = 'EVENT' AND e.id = ra.scope_id
     WHERE ra.user_id = u.id AND ra.revoked_at IS NULL
       AND ((ra.scope_type = 'ORGANIZER' AND ra.scope_id = ANY($1::uuid[])) OR e.organizer_id = ANY($1::uuid[]))))`;

@Injectable()
export class UsersService {
  constructor(
    private readonly tx: TenantTx,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ Lectures

  list(operatorId: string, actor: Omit<Actor, 'audit'>, cursor: string | undefined, limit: number): Promise<UserPage> {
    const after = decodeCursor(cursor);
    return this.tx.run(operatorId, async (client) => {
      const { rows } = await client.query<AppUserRow & { position: string }>(
        `SELECT u.*, u.created_at::text AS position FROM app_user u
          WHERE ${VISIBLE}
            AND ($3::timestamptz IS NULL OR (u.created_at, u.id) > ($3::timestamptz, $4::uuid))
          ORDER BY u.created_at, u.id
          LIMIT $5`,
        [...this.visibility(actor), after?.[0] ?? null, after?.[1] ?? null, limit + 1],
      );
      const page = rows.slice(0, limit);
      const assignments = await this.activeAssignments(
        client,
        page.map((u) => u.id),
      );
      const last = page[page.length - 1];
      return {
        data: page.map((u) => staffUserDto(u, assignments.get(u.id) ?? [])),
        next_cursor: rows.length > limit && last ? encodeCursor(last.position, last.id) : null,
        has_more: rows.length > limit,
      };
    });
  }

  get(operatorId: string, actor: Omit<Actor, 'audit'>, userId: string): Promise<StaffUserDto> {
    if (!isUuid(userId)) throw notFound();
    return this.tx.run(operatorId, async (client) => {
      const { rows } = await client.query<AppUserRow>(`SELECT u.* FROM app_user u WHERE ${VISIBLE} AND u.id = $3`, [
        ...this.visibility(actor),
        userId,
      ]);
      const user = rows[0];
      if (!user) throw notFound();
      return staffUserDto(user, (await this.activeAssignments(client, [user.id])).get(user.id) ?? []);
    });
  }

  // ------------------------------------------------------------------ Écritures (transaction métier)

  async create(client: TxClient, operatorId: string, input: StaffUserCreate, actor: Actor): Promise<StaffUserDto> {
    let user: AppUserRow;
    try {
      const { rows } = await client.query<AppUserRow>(
        `INSERT INTO app_user (operator_id, issuer, subject, email, phone, display_name, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [operatorId, input.issuer, input.subject, input.email, input.phone, input.displayName, actor.principal.userId],
      );
      user = rows[0]!;
    } catch (error) {
      if (sqlstate(error) === '23505') throw conflict('Personne déjà connue (émetteur, sujet).');
      throw error;
    }
    const dto = staffUserDto(user, []);
    await this.audit.record(client, {
      ...actor.audit,
      operatorId,
      action: 'USER_CREATED',
      objectType: 'app_user',
      objectId: user.id,
      after: dto,
    });
    return dto;
  }

  async disable(client: TxClient, operatorId: string, userId: string, actor: Actor): Promise<StaffUserDto> {
    const before = await this.lockUser(client, userId);
    if (before.status === 'DISABLED') throw conflict('Personne déjà désactivée.');
    let after: AppUserRow;
    try {
      const { rows } = await client.query<AppUserRow>(
        `UPDATE app_user SET status = 'DISABLED', disabled_at = clock_timestamp() WHERE id = $1 RETURNING *`,
        [userId],
      );
      after = rows[0]!;
    } catch (error) {
      // Garde de la base : dernier administrateur de la plateforme.
      if (sqlstate(error) === 'CL001') throw forbidden('Dernier administrateur de la plateforme : désactivation interdite.');
      throw error;
    }
    const assignments = (await this.activeAssignments(client, [userId])).get(userId) ?? [];
    const dto = staffUserDto(after, assignments);
    await this.audit.record(client, {
      ...actor.audit,
      operatorId,
      action: 'USER_DISABLED',
      objectType: 'app_user',
      objectId: userId,
      before: staffUserDto(before, assignments),
      after: dto,
    });
    return dto;
  }

  async grant(
    client: TxClient,
    operatorId: string,
    userId: string,
    input: RoleGrantInput,
    actor: Omit<Actor, 'role'>,
  ): Promise<RoleAssignmentDto> {
    const target = grantTarget(input.role, input.scopeType, input.scopeId);
    const user = await this.lockUser(client, userId);
    if (user.id === actor.principal.userId) throw forbidden('Attribution d’un rôle à soi-même interdite.');
    const role = canGrant(actor.principal, target.role, await resolveChain(client, target));
    if (!role) throw forbidden();
    if (user.status !== 'ACTIVE') throw conflict('Personne désactivée.');
    let assignment: RoleAssignmentRow;
    try {
      const { rows } = await client.query<RoleAssignmentRow>(
        `INSERT INTO role_assignment (user_id, role, scope_type, scope_id, granted_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [userId, target.role, target.type, target.id, actor.principal.userId],
      );
      assignment = rows[0]!;
    } catch (error) {
      if (sqlstate(error) === '23505') throw conflict('Attribution déjà active.');
      throw error;
    }
    const dto = assignmentDto(assignment);
    await this.audit.record(client, {
      ...actor.audit,
      actorRole: role,
      operatorId,
      action: 'ROLE_GRANTED',
      objectType: 'role_assignment',
      objectId: assignment.id,
      after: dto,
    });
    return dto;
  }

  async revoke(client: TxClient, operatorId: string, assignmentId: string, actor: Omit<Actor, 'role'>): Promise<RoleAssignmentDto> {
    if (!isUuid(assignmentId)) throw notFound();
    const { rows } = await client.query<RoleAssignmentRow>('SELECT * FROM role_assignment WHERE id = $1 FOR UPDATE', [
      assignmentId,
    ]);
    const before = rows[0];
    if (!before) throw notFound();
    if (before.user_id === actor.principal.userId) throw forbidden('Retrait de sa propre attribution interdit.');
    if (!(GRANTABLE_ROLES as readonly string[]).includes(before.role)) throw forbidden();
    const chain = await resolveChain(client, { type: before.scope_type as GrantScope['type'], id: before.scope_id! });
    const role = canGrant(actor.principal, before.role as GrantableRole, chain);
    if (!role) throw forbidden();
    if (before.revoked_at !== null) throw conflict('Attribution déjà retirée.');
    let after: RoleAssignmentRow;
    try {
      const updated = await client.query<RoleAssignmentRow>(
        `UPDATE role_assignment SET revoked_at = clock_timestamp(), revoked_by = $2 WHERE id = $1 RETURNING *`,
        [assignmentId, actor.principal.userId],
      );
      after = updated.rows[0]!;
    } catch (error) {
      if (sqlstate(error) === 'CL001') throw forbidden('Dernier administrateur de la plateforme : retrait interdit.');
      throw error;
    }
    const dto = assignmentDto(after);
    await this.audit.record(client, {
      ...actor.audit,
      actorRole: role,
      operatorId,
      action: 'ROLE_REVOKED',
      objectType: 'role_assignment',
      objectId: assignmentId,
      before: assignmentDto(before),
      after: dto,
    });
    return dto;
  }

  /** Administrateur de la plateforme : créé par `create_platform_admin` (contrôle et audit en base). */
  createPlatformAdmin(input: StaffUserCreate, actor: Omit<Actor, 'role'>): Promise<StaffUserDto> {
    return this.tx.withoutTenant(async (client) => {
      try {
        const { rows } = await client.query<{ admin: StaffUserDto }>(
          'SELECT create_platform_admin($1, $2, $3, $4, $5, $6, $7, $8) AS admin',
          [
            actor.principal.userId,
            input.issuer,
            input.subject,
            input.displayName,
            input.email,
            input.phone,
            actor.audit.origin,
            actor.audit.requestId,
          ],
        );
        return rows[0]!.admin;
      } catch (error) {
        if (sqlstate(error) === 'CL001') throw forbidden();
        if (sqlstate(error) === '23505') throw conflict('Personne déjà connue (émetteur, sujet).');
        throw error;
      }
    });
  }

  // ------------------------------------------------------------------ Aides

  /** Paramètres `$1`, `$2` de VISIBLE : restriction seulement pour un ORGANIZER_ADMIN. */
  private visibility(actor: Omit<Actor, 'audit'>): [string[] | null, string | null] {
    return actor.role === 'ORGANIZER_ADMIN' ? [administeredOrganizers(actor.principal), actor.principal.userId] : [null, null];
  }

  private async lockUser(client: TxClient, userId: string): Promise<AppUserRow> {
    if (!isUuid(userId)) throw notFound();
    const { rows } = await client.query<AppUserRow>('SELECT * FROM app_user WHERE id = $1 FOR UPDATE', [userId]);
    if (!rows[0]) throw notFound();
    return rows[0];
  }

  private async activeAssignments(client: TxClient, userIds: string[]): Promise<Map<string, RoleAssignmentRow[]>> {
    const byUser = new Map<string, RoleAssignmentRow[]>();
    if (userIds.length === 0) return byUser;
    const { rows } = await client.query<RoleAssignmentRow>(
      `SELECT * FROM role_assignment WHERE user_id = ANY($1::uuid[]) AND revoked_at IS NULL ORDER BY granted_at, id`,
      [userIds],
    );
    for (const row of rows) byUser.set(row.user_id, [...(byUser.get(row.user_id) ?? []), row]);
    return byUser;
  }
}
