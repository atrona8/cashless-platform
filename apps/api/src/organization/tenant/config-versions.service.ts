// Versions de configuration des niveaux d'un prestataire (SPECIFICATION §4.1, §4.2 ; FR-010, FR-014, FR-015) :
// prestataire et organisateur ici ; l'événement et la participation réutilisent ce service. Chaque écriture est le
// contenu complet du niveau. Contrôles, dans l'ordre : qui règle les clés modifiées (403, ou 422 si elles relèvent de
// deux rôles), puis bornes (422 avec `violations`), puis écriture de la version n+1 et de sa ligne d'audit.
import { Injectable } from '@nestjs/common';
import type { AuditContext } from '../../audit/audit.service';
import { assertSettableBy, assertWithinBounds } from '../../configuration/bounds-validator';
import {
  CascadeService,
  type CascadeTarget,
  type ConfigScope,
  type ConfigVersionDto,
} from '../../configuration/cascade.service';
import type { SettingRole } from '../../configuration/settings-catalog';
import type { TxClient } from '../../db/tenant-tx';
import type { Language } from '../../http/language';
import { invalid, objectBody } from '../platform/platform.dto';

interface VersionRow {
  id: string;
  operator_id: string | null;
  scope_type: ConfigVersionDto['scope_type'];
  scope_id: string;
  version: number;
  valid_from: Date;
  settings: Record<string, unknown>;
}

export function parseSettings(raw: unknown): Record<string, unknown> {
  const settings = objectBody(raw).settings;
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings))
    throw invalid('Champ obligatoire : settings (objet).');
  return settings as Record<string, unknown>;
}

/** Clés dont la valeur diffère entre deux contenus complets (ajoutées, modifiées ou retirées). */
export function changedKeys(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
): string[] {
  return [...new Set([...Object.keys(previous), ...Object.keys(next)])].filter(
    (key) => JSON.stringify(previous[key]) !== JSON.stringify(next[key]),
  );
}

@Injectable()
export class ConfigVersionsService {
  constructor(private readonly cascade: CascadeService) {}

  async list(
    client: TxClient,
    scope: Pick<ConfigScope, 'level' | 'scopeId'>,
    offset: number,
    limit: number,
  ): Promise<ConfigVersionDto[]> {
    const { rows } = await client.query<VersionRow>(
      `SELECT id, operator_id, scope_type, scope_id, version, valid_from, settings FROM config_version
        WHERE scope_type = $1 AND scope_id = $2 ORDER BY version DESC LIMIT $3 OFFSET $4`,
      [scope.level, scope.scopeId, limit, offset],
    );
    return rows.map((row) => ({
      config_version_id: row.id,
      operator_id: row.operator_id,
      scope_type: row.scope_type,
      scope_id: row.scope_id,
      version: row.version,
      valid_from: row.valid_from.toISOString(),
      settings: row.settings,
    }));
  }

  /** `parents` : chaîne des niveaux supérieurs, dont la configuration résolue porte les maximums. */
  async write(
    client: TxClient,
    scope: ConfigScope,
    parents: CascadeTarget,
    settings: Record<string, unknown>,
    heldRoles: readonly SettingRole[],
    actor: AuditContext,
    language: Language,
  ): Promise<ConfigVersionDto> {
    const previous = await this.cascade.latest(client, scope);
    assertSettableBy(
      changedKeys(previous?.settings ?? {}, settings),
      scope.level,
      heldRoles,
      language,
    );
    assertWithinBounds(
      settings,
      { level: scope.level, resolved: await this.cascade.resolve(client, parents) },
      language,
    );
    return this.cascade.writeVersion(client, scope, settings, actor);
  }
}
