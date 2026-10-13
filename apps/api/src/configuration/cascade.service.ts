// Cascade de configuration versionnée (SPECIFICATION §4.1, research R-05, contracts/configuration.md).
// Écriture : chaque modification d'un niveau crée la version n+1, contenu complet du niveau, avec sa ligne d'audit
// (avant = version n, après = version n+1). Le numéro est posé par la base (migration 0007).
// Résolution à une date : pour chaque niveau, dernière version dont la date d'effet ne dépasse pas la date ; la
// valeur du niveau le plus précis qui définit la clé l'emporte ; sinon le défaut du catalogue. Les réglages portés
// par des colonnes de `event` sont lus dans l'instantané de la version `EVENT` en vigueur à la date.
import { Injectable } from '@nestjs/common';
import { AuditService, type AuditContext } from '../audit/audit.service';
import type { TxClient } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';
import { effectiveRefundDeadline } from './provisional-defaults';
import {
  CONFIG_LEVELS,
  eventColumnKeys,
  resolvedKeys,
  type ConfigLevel,
  type ResolvedConfigView,
  type ResolvedValue,
} from './settings-catalog';

/** Niveau visé par une écriture. `operatorId` NULL : niveau plateforme. */
export interface ConfigScope {
  level: ConfigLevel;
  scopeId: string;
  operatorId: string | null;
}

/** Version de configuration (schéma `ConfigVersion` du contrat). */
export interface ConfigVersionDto {
  config_version_id: string;
  operator_id: string | null;
  scope_type: ConfigLevel;
  scope_id: string;
  version: number;
  valid_from: string;
  settings: Record<string, unknown>;
}

interface ConfigVersionRow {
  id: string;
  operator_id: string | null;
  scope_type: ConfigLevel;
  scope_id: string;
  version: number;
  valid_from: Date;
  settings: Record<string, unknown>;
}

/** Chaîne à résoudre : les niveaux absents sont ignorés. */
export interface CascadeTarget {
  operatorId: string;
  organizerId?: string;
  eventId?: string;
  participationId?: string;
}

const dto = (row: ConfigVersionRow): ConfigVersionDto => ({
  config_version_id: row.id,
  operator_id: row.operator_id,
  scope_type: row.scope_type,
  scope_id: row.scope_id,
  version: row.version,
  valid_from: row.valid_from.toISOString(),
  settings: row.settings,
});

/** Valeur d'une colonne sous une forme JSON : bigint → entier (ou texte au-delà de 2^53), date → ISO 8601. */
export function jsonValue(value: unknown): unknown {
  if (typeof value === 'bigint') return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString();
  if (value instanceof Date) return value.toISOString();
  return value ?? null;
}

/** Instantané des réglages portés par les colonnes d'un événement, joint à sa version de configuration `EVENT`. */
export function eventSnapshot(event: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    eventColumnKeys()
      .filter((definition) => definition.resolved)
      .map((definition) => [definition.key, jsonValue(event[definition.key])]),
  );
}

@Injectable()
export class CascadeService {
  constructor(private readonly audit: AuditService) {}

  /** Dernière version d'un niveau (toutes dates d'effet confondues). */
  async latest(client: TxClient, scope: Pick<ConfigScope, 'level' | 'scopeId'>): Promise<ConfigVersionDto | null> {
    const { rows } = await client.query<ConfigVersionRow>(
      `SELECT id, operator_id, scope_type, scope_id, version, valid_from, settings FROM config_version
        WHERE scope_type = $1 AND scope_id = $2 ORDER BY version DESC LIMIT 1`,
      [scope.level, scope.scopeId],
    );
    return rows[0] ? dto(rows[0]) : null;
  }

  /**
   * Écrit la version suivante du niveau. Deux écritures concurrentes partent de la même version : la base donne à
   * la seconde le numéro n+2, ce qui révèle qu'elle n'a pas vu la première — `409 CONFLICT_STATE`, à refaire sur la
   * version courante (le contenu est complet, il écraserait sinon la première).
   */
  async writeVersion(
    client: TxClient,
    scope: ConfigScope,
    settings: Record<string, unknown>,
    actor: AuditContext,
    validFrom?: Date,
  ): Promise<ConfigVersionDto> {
    const previous = await this.latest(client, scope);
    let row: ConfigVersionRow;
    try {
      // Le numéro demandé (0) est remplacé par le déclencheur config_version_assign.
      const { rows } = await client.query<ConfigVersionRow>(
        `INSERT INTO config_version (operator_id, scope_type, scope_id, version, valid_from, settings)
         VALUES ($1, $2, $3, 0,
                 -- Sans date demandée : maintenant, jamais avant la version précédente (une horloge qui recule de
                 -- quelques millisecondes ne doit pas faire refuser l'écriture suivante).
                 coalesce($4::timestamptz, greatest(clock_timestamp(), (SELECT max(c.valid_from) FROM config_version c
                                                                           WHERE c.scope_type = $2 AND c.scope_id = $3))), $5::jsonb)
         RETURNING id, operator_id, scope_type, scope_id, version, valid_from, settings`,
        [scope.operatorId, scope.level, scope.scopeId, validFrom ?? null, JSON.stringify(settings)],
      );
      row = rows[0]!;
    } catch (error) {
      const code = (error as { code?: string }).code;
      // Perdante de deux écritures simultanées : sa date d'effet, prise à l'horloge avant d'attendre le verrou du
      // niveau, peut précéder celle de la gagnante (refus CL001 de la base). C'est un conflit, pas une date invalide.
      if (code === '23505' || (code === 'CL001' && validFrom === undefined)) throw conflict();
      throw error;
    }
    if (row.version !== (previous?.version ?? 0) + 1) throw conflict();
    const created = dto(row);
    await this.audit.record(client, {
      ...actor,
      operatorId: scope.operatorId,
      action: 'CONFIG_VERSION_CREATED',
      objectType: 'config_version',
      objectId: created.config_version_id,
      before: previous,
      after: created,
    });
    return created;
  }

  /** Configuration résolue d'une chaîne de niveaux à une date (défaut : maintenant, à l'horloge de la base). */
  async resolve(client: TxClient, target: CascadeTarget, at?: Date): Promise<ResolvedConfigView> {
    const versions = await this.versionsAt(client, target, at);
    const event = target.eventId ? await this.eventColumns(client, target.eventId) : null;
    const hasEventVersions = target.eventId ? await this.hasVersions(client, 'EVENT', target.eventId) : false;
    const view: ResolvedConfigView = {};

    for (const definition of resolvedKeys()) {
      let resolved: ResolvedValue | undefined;
      // Du niveau le plus précis au plus général.
      for (const level of [...CONFIG_LEVELS].reverse()) {
        if (!definition.levels.includes(level)) continue;
        const version = versions.get(level);
        if (version && version.settings[definition.key] !== undefined) {
          resolved = from(version.settings[definition.key], version);
          break;
        }
        // Événement sans aucune version (créé hors de l'API) : ses colonnes font foi.
        if (level === 'EVENT' && definition.storage.kind === 'EVENT_COLUMN' && event && !hasEventVersions) {
          resolved = { value: jsonValue(event[definition.key]), level: 'EVENT', version: null, config_version_id: null, provisional: false };
          break;
        }
      }
      view[definition.key] = resolved ?? {
        value: definition.default ?? null,
        level: null,
        version: null,
        config_version_id: null,
        provisional: definition.provisional !== undefined && definition.default !== undefined,
      };
    }

    // Date limite de remboursement absente : fin de l'événement + 30 jours, provisoire (§17.2).
    const deadline = view.refund_deadline;
    if (event && deadline && deadline.value === null) {
      const fallback = effectiveRefundDeadline(null, (event.ends_at as Date | null) ?? null);
      if (fallback) {
        view.refund_deadline = { value: fallback.value.toISOString(), level: null, version: null, config_version_id: null, provisional: true };
      }
    }
    return view;
  }

  /** Configuration résolue d'un événement (et d'une de ses participations) ; événement invisible : 404. */
  async resolveForEvent(client: TxClient, eventId: string, at?: Date, participationId?: string): Promise<ResolvedConfigView> {
    const { rows } = await client.query<{ operator_id: string; organizer_id: string }>(
      'SELECT operator_id, organizer_id FROM event WHERE id = $1',
      [eventId],
    );
    const event = rows[0];
    if (!event) throw new ProblemException('NOT_FOUND');
    if (participationId !== undefined) {
      const participation = await client.query('SELECT 1 FROM merchant_participation WHERE id = $1 AND event_id = $2', [
        participationId,
        eventId,
      ]);
      if (participation.rowCount !== 1) throw new ProblemException('NOT_FOUND');
    }
    return this.resolve(client, { operatorId: event.operator_id, organizerId: event.organizer_id, eventId, participationId }, at);
  }

  // ------------------------------------------------------------------ Aides

  /** Par niveau, dernière version dont la date d'effet ne dépasse pas `at`. */
  private async versionsAt(client: TxClient, target: CascadeTarget, at: Date | undefined): Promise<Map<ConfigLevel, ConfigVersionRow>> {
    const { rows } = await client.query<ConfigVersionRow>(
      `SELECT DISTINCT ON (scope_type) id, operator_id, scope_type, scope_id, version, valid_from, settings
         FROM config_version
        WHERE valid_from <= coalesce($1::timestamptz, clock_timestamp())
          AND ((scope_type = 'PLATFORM' AND operator_id IS NULL)
            OR (scope_type = 'OPERATOR' AND scope_id = $2)
            OR (scope_type = 'ORGANIZER' AND scope_id = $3)
            OR (scope_type = 'EVENT' AND scope_id = $4)
            OR (scope_type = 'PARTICIPATION' AND scope_id = $5))
        ORDER BY scope_type, valid_from DESC, version DESC`,
      [at ?? null, target.operatorId, target.organizerId ?? null, target.eventId ?? null, target.participationId ?? null],
    );
    return new Map(rows.map((row) => [row.scope_type, row]));
  }

  private async hasVersions(client: TxClient, level: ConfigLevel, scopeId: string): Promise<boolean> {
    const { rowCount } = await client.query('SELECT 1 FROM config_version WHERE scope_type = $1 AND scope_id = $2 LIMIT 1', [
      level,
      scopeId,
    ]);
    return rowCount === 1;
  }

  private async eventColumns(client: TxClient, eventId: string): Promise<Record<string, unknown> | null> {
    const { rows } = await client.query<Record<string, unknown>>('SELECT * FROM event WHERE id = $1', [eventId]);
    return rows[0] ?? null;
  }
}

function from(value: unknown, version: ConfigVersionRow): ResolvedValue {
  return { value, level: version.scope_type, version: version.version, config_version_id: version.id, provisional: false };
}

function conflict(): ProblemException {
  return new ProblemException('CONFLICT_STATE', {
    status: 409,
    detail: 'La configuration de ce niveau a changé entre-temps : relire la version courante et recommencer.',
  });
}
