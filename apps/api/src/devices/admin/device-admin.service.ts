// Back-office des terminaux (mission 5a, lot WP16 ; FR-015 à FR-017, FR-025 ; contracts/
// device-lifecycle.md ; hypothèse A2 : une personne suffit). Lectures et transitions dans la
// transaction cloisonnée du prestataire (RLS) ET avec le prestataire nommé dans chaque requête.
//
// Portée : `OPERATOR_ADMIN` voit tout le prestataire ; `ORGANIZER_ADMIN` les seuls terminaux
// affectés à un événement de ses organisateurs (un terminal sans événement lui est invisible).
// Hors portée ou autre prestataire : 404, réponse neutre.
//
// Transitions : `set_device_status` (SECURITY DEFINER, migration 0022) est la seule écriture du
// statut. Elle prend le terminal FOR UPDATE, revérifie en base le droit de l'auteur
// (`device_admin_allowed`), refuse une transition interdite (CL029 → 409 CONFLICT_STATE) et, vers
// REVOKED, révoque toutes les familles de jetons dans la même transaction. Aucun statut n'est gardé
// en cache : la garde des terminaux et chaque écriture faite pour un terminal relisent le statut
// en base (`assert_device_active`, R-14), l'effet est donc immédiat (NFR-003).
import { Injectable } from '@nestjs/common';
import { AuditService, type AuditAction } from '../../audit/audit.service';
import type { TxClient } from '../../db/tenant-tx';
import { ProblemException } from '../../errors/problem';
import type { PageRequest } from '../../organization/platform/platform.dto';
import { scopesHeld, type TenantActor } from '../../organization/tenant/tenant-access';
import {
  DEVICE_ADMIN_COLUMNS,
  deviceAdminDto,
  historyDto,
  type DeviceAdminDetail,
  type DeviceAdminRow,
  type DeviceHistoryRow,
  type DeviceListFilter,
  type DeviceStatus,
} from './device-admin.dto';

/** Transition demandée par une route : statut visé et action d'audit. */
export interface DeviceTransition {
  to: DeviceStatus;
  action: Extract<AuditAction, 'DEVICE_SUSPENDED' | 'DEVICE_REACTIVATED' | 'DEVICE_REVOKED'>;
}

/**
 * Organisateurs de la portée ; `null` : tout le prestataire. Défense en profondeur (relecture de
 * WP16) : seule une attribution OPERATOR_ADMIN de portée OPERATOR sur CE prestataire donne tout le
 * prestataire (la base l'impose déjà : role_assignment_guard) ; toute autre forme retombe sur les
 * organisateurs administrés.
 */
export function deviceScope(actor: Pick<TenantActor, 'principal' | 'operatorId'>): string[] | null {
  if (
    actor.principal.assignments.some(
      (a) =>
        a.role === 'OPERATOR_ADMIN' && a.scopeType === 'OPERATOR' && a.scopeId === actor.operatorId,
    )
  )
    return null;
  return scopesHeld(actor.principal, 'ORGANIZER_ADMIN', 'ORGANIZER');
}

/** Portée sur `d` : prestataire en $1, organisateurs en `$n` (NULL : tout le prestataire). */
const scopeClause = (n: number) =>
  `($${n}::uuid[] IS NULL OR d.event_id IN (
     SELECT e.id FROM event e WHERE e.operator_id = $1 AND e.organizer_id = ANY($${n}::uuid[])))`;

@Injectable()
export class DeviceAdminService {
  constructor(private readonly audit: AuditService) {}

  /** `limit` lignes à partir de `offset` (l'appelant demande `limit + 1` pour `has_more`). */
  async list(
    client: TxClient,
    actor: TenantActor,
    filter: DeviceListFilter,
    page: PageRequest,
  ): Promise<DeviceAdminRow[]> {
    const { rows } = await client.query<DeviceAdminRow>(
      `SELECT ${DEVICE_ADMIN_COLUMNS}
         FROM device d
        WHERE d.operator_id = $1 AND ${scopeClause(2)}
          AND ($3::uuid IS NULL OR d.event_id = $3)
          AND ($4::uuid IS NULL OR d.pos_id = $4)
          AND ($5::text IS NULL OR d.status = $5)
          AND ($6::text IS NULL OR d.app_mode = $6)
        ORDER BY d.serial, d.id
        OFFSET $7 LIMIT $8`,
      [
        actor.operatorId,
        deviceScope(actor),
        filter.eventId ?? null,
        filter.posId ?? null,
        filter.status ?? null,
        filter.appMode ?? null,
        page.offset,
        page.limit + 1,
      ],
    );
    return rows;
  }

  /** Terminal de la portée et historique de ses statuts (plus récent d'abord) ; 404 sinon. */
  async detail(client: TxClient, actor: TenantActor, deviceId: string): Promise<DeviceAdminDetail> {
    const { rows } = await client.query<DeviceAdminRow>(
      `SELECT ${DEVICE_ADMIN_COLUMNS}
         FROM device d
        WHERE d.operator_id = $1 AND ${scopeClause(2)} AND d.id = $3`,
      [actor.operatorId, deviceScope(actor), deviceId],
    );
    const row = rows[0];
    if (!row) throw new ProblemException('NOT_FOUND');
    const history = await client.query<DeviceHistoryRow>(
      `SELECT from_status, to_status, reason, actor_id, at
         FROM device_status_history
        WHERE operator_id = $1 AND device_id = $2
        ORDER BY at DESC, id DESC`,
      [actor.operatorId, deviceId],
    );
    return { ...deviceAdminDto(row), status_history: history.rows.map(historyDto) };
  }

  /**
   * Suspension, réactivation ou révocation, dans la transaction de la requête idempotente : le
   * terminal doit être dans la portée (404), puis `set_device_status` fait la transition et son
   * historique ; l'audit (acteur, rôle, motif, avant, après) est écrit dans la même transaction,
   * avant et après lus sur la ligne d'historique que la fonction vient d'écrire.
   */
  async transition(
    client: TxClient,
    actor: TenantActor,
    deviceId: string,
    transition: DeviceTransition,
    reason: string,
  ): Promise<DeviceAdminDetail> {
    await this.detail(client, actor, deviceId);
    await client.query('SELECT set_device_status($1, $2, $3, $4)', [
      deviceId,
      transition.to,
      reason,
      actor.principal.userId,
    ]);
    const { rows } = await client.query<Pick<DeviceHistoryRow, 'from_status' | 'to_status'>>(
      `SELECT from_status, to_status FROM device_status_history
        WHERE operator_id = $1 AND device_id = $2
        ORDER BY id DESC LIMIT 1`,
      [actor.operatorId, deviceId],
    );
    const written = rows[0]!;
    await this.audit.record(client, {
      ...actor.audit,
      operatorId: actor.operatorId,
      action: transition.action,
      objectType: 'device',
      objectId: deviceId,
      before: { status: written.from_status },
      after: { status: written.to_status, reason },
    });
    return this.detail(client, actor, deviceId);
  }
}
