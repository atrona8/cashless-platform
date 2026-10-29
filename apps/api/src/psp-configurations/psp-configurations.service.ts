// Lecture et création des configurations PSP (mission 6, lot WP10, T049). La base est l'arbitre (titulaire,
// défaut unique, version) ; ce service ne recopie aucune de ses règles.
//
// A RELIRE PAR UNE PERSONNE : `toDto` (dto) et ce fichier décident qui voit `secret_ref`. Jamais par `SELECT *`
// ni par colonne : seule `psp_configuration_secret_ref(id)` le lit (WP05), et seulement pour l'OPERATOR_ADMIN.
import { Injectable } from '@nestjs/common';
import { AuditService, type AuditContext } from '../audit/audit.service';
import type { TxClient } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';
import type { Role } from '../identity/principal';
import { notFound } from '../organization/platform/platform.dto';
import { scopesHeld, type TenantActor } from '../organization/tenant/tenant-access';
import {
  CONFIG_COLUMNS,
  toDto,
  type PspConfigurationCreate,
  type PspConfigurationDto,
  type PspConfigurationRow,
} from './psp-configurations.dto';

/** Un ORGANIZER_ADMIN ne voit que ses organisateurs : tout autre est `404`, jamais `403`. */
export function assertOrganizerVisible(actor: TenantActor, organizerId: string): void {
  if (
    actor.role === 'ORGANIZER_ADMIN' &&
    !scopesHeld(actor.principal, 'ORGANIZER_ADMIN', 'ORGANIZER').includes(organizerId)
  )
    throw new ProblemException('NOT_FOUND');
}

@Injectable()
export class PspConfigurationsService {
  constructor(private readonly audit: AuditService) {}

  /** Organisateur du prestataire de la transaction (RLS) ; autre prestataire ou inconnu : `404`. */
  async assertOrganizer(client: TxClient, actor: TenantActor, organizerId: string): Promise<void> {
    const { rows } = await client.query(
      `SELECT 1 FROM party WHERE id = $1 AND kind = 'ORGANIZER'`,
      [organizerId],
    );
    if (!rows[0]) throw notFound();
    assertOrganizerVisible(actor, organizerId);
  }

  /** Brouillon `DRAFT` (version 1) ; la réponse porte `secret_ref` (l'appelant est l'OPERATOR_ADMIN). */
  async create(
    client: TxClient,
    actor: TenantActor,
    organizerId: string,
    input: PspConfigurationCreate,
  ): Promise<PspConfigurationDto> {
    await this.assertOrganizer(client, actor, organizerId);
    const validFrom =
      input.valid_from ??
      (await client.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0]!.now;
    const { rows: created } = await client.query<{ id: string }>(
      'SELECT create_psp_configuration($1, $2, $3, $4, $5, $6, $7, $8, $9) AS id',
      [
        organizerId,
        input.method,
        input.provider,
        input.holder_party_id,
        input.secret_ref,
        input.is_default,
        validFrom,
        input.valid_until,
        actor.principal.userId,
      ],
    );
    const row = await this.row(client, created[0]!.id);
    const dto = toDto(row, actor.role, input.secret_ref);
    await this.audit.record(client, {
      ...actor.audit,
      operatorId: actor.operatorId,
      action: 'PSP_CONFIGURATION_CREATED',
      objectType: 'psp_configuration',
      objectId: row.psp_configuration_id,
      // Jamais `secret_ref` dans l'audit.
      after: toDto(row, 'ORGANIZER_ADMIN'),
    });
    return dto;
  }

  async list(
    client: TxClient,
    actor: TenantActor,
    organizerId: string,
    status: string | undefined,
    offset: number,
    limit: number,
  ): Promise<PspConfigurationDto[]> {
    await this.assertOrganizer(client, actor, organizerId);
    const { rows } = await client.query<PspConfigurationRow>(
      `SELECT ${CONFIG_COLUMNS} FROM psp_configuration
        WHERE organizer_id = $1 AND ($2::text IS NULL OR status = $2)
        ORDER BY created_at DESC, psp_configuration_id LIMIT $3 OFFSET $4`,
      [organizerId, status ?? null, limit, offset],
    );
    const out: PspConfigurationDto[] = [];
    for (const row of rows) out.push(await this.render(client, row, actor.role));
    return out;
  }

  async get(client: TxClient, actor: TenantActor, id: string): Promise<PspConfigurationDto> {
    const row = await this.row(client, id);
    assertOrganizerVisible(actor, row.organizer_id);
    return this.render(client, row, actor.role);
  }

  async row(client: TxClient, id: string): Promise<PspConfigurationRow> {
    const { rows } = await client.query<PspConfigurationRow>(
      `SELECT ${CONFIG_COLUMNS} FROM psp_configuration WHERE psp_configuration_id = $1`,
      [id],
    );
    if (!rows[0]) throw notFound();
    return rows[0];
  }

  /**
   * `secret_ref` lu par la seule fonction, pour l'OPERATOR_ADMIN seulement. Un brouillon n'a pas encore de
   * porte du coffre (la fonction ne sert que `ACTIVE` et `SUSPENDED`) : la référence est alors `null`.
   */
  private async render(
    client: TxClient,
    row: PspConfigurationRow,
    role: Role,
  ): Promise<PspConfigurationDto> {
    if (role !== 'OPERATOR_ADMIN' || row.status === 'DRAFT') return toDto(row, role);
    const { rows } = await client.query<{ ref: string }>(
      'SELECT psp_configuration_secret_ref($1) AS ref',
      [row.psp_configuration_id],
    );
    return toDto(row, role, rows[0]?.ref ?? null);
  }
}

export type { AuditContext };
