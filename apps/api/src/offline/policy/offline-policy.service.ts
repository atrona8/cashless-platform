// Politique hors ligne (mission hors-ligne-snapshots-lots, lot WP14 ; FR-001 à FR-003, FR-043).
// L'API ne calcule rien de métier : elle appelle `set_offline_policy`, `clear_offline_policy`,
// `offline_policy_level`, `offline_max_exposure` et `effective_offline_policy` (WP02), contrôle la
// portée de la personne, traduit les SQLSTATE (errors/sqlstate-map.ts) et audite. Aucune écriture
// SQL directe sur `offline_policy` ni sur son historique (écrit par le déclencheur de la base,
// OP-N58).
import { Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import type { TxClient } from '../../db/tenant-tx';
import { ProblemException } from '../../errors/problem';
import { hasRole, type Principal, type Role } from '../../identity/principal';
import { conflict, notFound } from '../../organization/platform/platform.dto';
import { scopesHeld, type TenantActor } from '../../organization/tenant/tenant-access';
import type {
  EffectivePolicy,
  LevelPolicy,
  LevelView,
  OfflineRisk,
  PolicyScope,
  PolicyUpdate,
  PolicyValues,
} from './offline-policy.dto';

interface LevelRow {
  id: string | null;
  version: number | null;
  updated_at: Date | null;
  updated_by: string | null;
  offline_enabled: boolean | null;
  max_per_sale: bigint | null;
  max_per_media_per_device: bigint | null;
  max_total_per_device: bigint | null;
  age: number | null;
}

interface Stored {
  policy: LevelPolicy;
  version: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

type Write = 'FULL' | 'CUT' | null;

/**
 * Un entier de la base rendu en nombre JSON : jamais arrondi (hors de la plage sûre : erreur
 * interne).
 */
export function safeNumber(value: bigint | string | number | null, what: string): number | null {
  if (value === null) return null;
  const big = BigInt(value);
  if (big > BigInt(Number.MAX_SAFE_INTEGER) || big < 0n) {
    new Logger('OfflinePolicy').error(`${what} hors de la plage sûre : ${big.toString()}`);
    throw new ProblemException('INTERNAL_ERROR');
  }
  return Number(big);
}

@Injectable()
export class OfflinePolicyService {
  constructor(private readonly audit: AuditService) {}

  /**
   * Droits de la personne sur une portée ; `organizerId` = organisateur de l'objet (NULL : aucun).
   */
  private rights(
    principal: Principal,
    type: PolicyScope,
    organizerId: string | null,
  ): { read: boolean; write: Write; role: Role } {
    const operatorAdmin = hasRole(principal, 'OPERATOR_ADMIN');
    if (type === 'OPERATOR_CEILING') {
      const read = operatorAdmin || hasRole(principal, 'ORGANIZER_ADMIN');
      return {
        read,
        write: operatorAdmin ? 'FULL' : null,
        role: operatorAdmin ? 'OPERATOR_ADMIN' : 'ORGANIZER_ADMIN',
      };
    }
    const organizerAdmin =
      organizerId !== null &&
      scopesHeld(principal, 'ORGANIZER_ADMIN', 'ORGANIZER').includes(organizerId);
    const write: Write = organizerAdmin
      ? 'FULL'
      : operatorAdmin && type === 'DEVICE'
        ? 'CUT'
        : null;
    return {
      read: organizerAdmin || operatorAdmin,
      write,
      role: organizerAdmin ? 'ORGANIZER_ADMIN' : 'OPERATOR_ADMIN',
    };
  }

  /**
   * Organisateur de l'objet, lu sous la RLS du prestataire ; objet inconnu ou d'un autre
   * prestataire : 404.
   */
  private async organizerOf(
    client: TxClient,
    type: PolicyScope,
    id: string,
    operatorId: string,
  ): Promise<string | null> {
    if (type === 'OPERATOR_CEILING') {
      if (id !== operatorId) throw notFound();
      return null;
    }
    const sql = {
      ORGANIZER: `SELECT id AS organizer_id FROM party WHERE id = $1 AND kind = 'ORGANIZER' AND operator_id = $2`,
      EVENT: 'SELECT organizer_id FROM event WHERE id = $1 AND operator_id = $2',
      DEVICE: `SELECT e.organizer_id FROM device d LEFT JOIN event e ON e.id = d.event_id
                WHERE d.id = $1 AND d.operator_id = $2`,
    }[type];
    const { rows } = await client.query<{ organizer_id: string | null }>(sql, [id, operatorId]);
    if (rows.length === 0) throw notFound();
    return rows[0]!.organizer_id;
  }

  private async stored(client: TxClient, type: PolicyScope, id: string): Promise<Stored | null> {
    const { rows } = await client.query<LevelRow>(
      `SELECT id, version, updated_at, updated_by, offline_enabled, max_per_sale,
              max_per_media_per_device, max_total_per_device,
              extract(epoch FROM max_snapshot_age)::int AS age
         FROM offline_policy_level($1, $2)`,
      [type, id],
    );
    const r = rows[0];
    if (!r || r.id === null) return null;
    return {
      policy: {
        offline_enabled: r.offline_enabled,
        max_per_sale: safeNumber(r.max_per_sale, 'max_per_sale'),
        max_per_media_per_device: safeNumber(
          r.max_per_media_per_device,
          'max_per_media_per_device',
        ),
        max_total_per_device: safeNumber(r.max_total_per_device, 'max_total_per_device'),
        max_snapshot_age_seconds: r.age,
        cash_topup_offline: false,
      },
      version: r.version!,
      updatedAt: r.updated_at ? r.updated_at.toISOString() : null,
      updatedBy: r.updated_by,
    };
  }

  private async effective(
    client: TxClient,
    deviceId: string,
  ): Promise<EffectivePolicy | undefined> {
    const { rows } = await client.query<{
      offline_enabled: boolean;
      max_per_sale: bigint;
      max_per_media_per_device: bigint;
      max_total_per_device: bigint;
      age: number;
      capped: boolean;
    }>(
      `SELECT offline_enabled, max_per_sale, max_per_media_per_device, max_total_per_device,
              extract(epoch FROM max_snapshot_age)::int AS age, capped
         FROM effective_offline_policy($1)`,
      [deviceId],
    );
    const r = rows[0];
    if (!r) return undefined;
    return {
      offline_enabled: r.offline_enabled,
      max_per_sale: safeNumber(r.max_per_sale, 'max_per_sale')!,
      max_per_media_per_device: safeNumber(r.max_per_media_per_device, 'max_per_media_per_device')!,
      max_total_per_device: safeNumber(r.max_total_per_device, 'max_total_per_device')!,
      max_snapshot_age_seconds: r.age,
      cash_topup_offline: false,
      capped: r.capped,
    };
  }

  /**
   * Risque maximal d'un événement : somme en bigint, conversion finale contrôlée, heure de la base.
   */
  async riskOf(client: TxClient, eventId: string): Promise<OfflineRisk> {
    const event = await client.query<{ currency: string; now: Date }>(
      'SELECT currency, clock_timestamp() AS now FROM event WHERE id = $1',
      [eventId],
    );
    if (event.rows.length === 0) throw notFound();
    const { rows } = await client.query<{
      device_id: string;
      serial: string;
      max_total_per_device: bigint;
      capped: boolean;
    }>('SELECT device_id, serial, max_total_per_device, capped FROM offline_max_exposure($1)', [
      eventId,
    ]);
    let total = 0n;
    const devices = rows.map((r) => {
      total += BigInt(r.max_total_per_device);
      return {
        device_id: r.device_id,
        serial: r.serial,
        max_total_per_device: safeNumber(r.max_total_per_device, 'max_total_per_device')!,
        capped: r.capped,
      };
    });
    return {
      event_id: eventId,
      currency: event.rows[0]!.currency,
      max_total_risk: safeNumber(total, 'max_total_risk')!,
      offline_devices: rows.length,
      devices,
      computed_at: event.rows[0]!.now.toISOString(),
    };
  }

  private async build(client: TxClient, type: PolicyScope, id: string): Promise<LevelView> {
    const s = await this.stored(client, type, id);
    const view: LevelView = {
      level: type,
      scope_id: id,
      policy: s?.policy ?? {
        offline_enabled: null,
        max_per_sale: null,
        max_per_media_per_device: null,
        max_total_per_device: null,
        max_snapshot_age_seconds: null,
        cash_topup_offline: false,
      },
      version: s?.version ?? 0,
      updated_at: s?.updatedAt ?? null,
      updated_by: s?.updatedBy ?? null,
    };
    if (type === 'DEVICE') {
      const effective = await this.effective(client, id);
      if (effective) view.effective = effective;
    }
    if (type === 'EVENT') view.risk = await this.riskOf(client, id);
    return view;
  }

  /** `GET` d'un niveau. */
  async get(
    client: TxClient,
    actor: TenantActor,
    type: PolicyScope,
    id: string,
  ): Promise<LevelView> {
    const organizerId = await this.organizerOf(client, type, id, actor.operatorId);
    if (!this.rights(actor.principal, type, organizerId).read) throw notFound();
    return this.build(client, type, id);
  }

  /** `GET /events/{id}/offline-risk`. */
  async getRisk(client: TxClient, actor: TenantActor, eventId: string): Promise<OfflineRisk> {
    const organizerId = await this.organizerOf(client, 'EVENT', eventId, actor.operatorId);
    if (!this.rights(actor.principal, 'EVENT', organizerId).read) throw notFound();
    return this.riskOf(client, eventId);
  }

  /**
   * `PUT` d'un niveau : remplacement complet (clé absente = hérite) ; corps sans champ de politique
   * : effacement.
   */
  async put(
    client: TxClient,
    actor: TenantActor,
    type: PolicyScope,
    id: string,
    update: PolicyUpdate,
  ): Promise<{ view: LevelView; role: Role }> {
    const organizerId = await this.organizerOf(client, type, id, actor.operatorId);
    const rights = this.rights(actor.principal, type, organizerId);
    if (!rights.read) throw notFound();
    if (rights.write === null) throw new ProblemException('FORBIDDEN');
    const before = await this.stored(client, type, id);
    let values: PolicyValues = update.values;
    const keys = Object.keys(values);
    if (rights.write === 'CUT') {
      // Couper un terminal : `offline_enabled: false` seul ; les autres valeurs du niveau sont
      // conservées.
      if (keys.length !== 1 || values.offline_enabled !== false) {
        throw new ProblemException('FORBIDDEN');
      }
      if (before && update.version !== before.version)
        throw conflict('Version de politique différente.');
      values = { ...(before ? storedValues(before.policy) : {}), offline_enabled: false };
    }
    const beforeAudit = before ? auditState(type, id, before.policy, before.version) : null;
    const cleared = keys.length === 0;
    if (cleared) {
      await client.query('SELECT clear_offline_policy($1, $2, $3, $4)', [
        type,
        id,
        update.version,
        actor.principal.userId,
      ]);
    } else {
      await client.query('SELECT set_offline_policy($1, $2, $3::jsonb, $4, $5)', [
        type,
        id,
        JSON.stringify(values),
        update.version,
        actor.principal.userId,
      ]);
    }
    const view = await this.build(client, type, id);
    const ctx = { ...actor.audit, actorRole: rights.role };
    if (cleared) {
      if (before) {
        await this.audit.record(client, {
          ...ctx,
          operatorId: actor.operatorId,
          action: 'OFFLINE_POLICY_CLEARED',
          objectType: 'offline_policy',
          objectId: id,
          before: beforeAudit,
          after: null,
        });
      }
    } else {
      await this.audit.record(client, {
        ...ctx,
        operatorId: actor.operatorId,
        action: 'OFFLINE_POLICY_SET',
        objectType: 'offline_policy',
        objectId: id,
        before: beforeAudit,
        after: auditState(type, id, view.policy, view.version),
      });
    }
    return { view, role: rights.role };
  }
}

function storedValues(policy: LevelPolicy): PolicyValues {
  const { cash_topup_offline: _cash, ...rest } = policy;
  return rest;
}

function auditState(type: PolicyScope, id: string, policy: LevelPolicy, version: number) {
  return { level: type, scope_id: id, policy, version };
}
