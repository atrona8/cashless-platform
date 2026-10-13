// Règles de frais d'un prestataire (SPECIFICATION §5.6 ; FR-008). Une règle ne se modifie jamais : elle se ferme
// (`valid_to`) et une nouvelle version la remplace, dans la même transaction. Portées servies ici : `OPERATOR_CONTRACT`
// (flux prestataire → organisateur, réglé par l'OPERATOR_ADMIN). Les portées `EVENT` et `PARTICIPATION` s'ajoutent en
// déclarant leur résolveur (`registerScope`) : objet visé, rôle qui règle, pays du profil de législation.
// `PLATFORM_CONTRACT` n'est jamais écrite par le rôle applicatif (403 ; politique restrictive en base).
import { Injectable } from '@nestjs/common';
import { AuditService, type AuditContext } from '../../audit/audit.service';
import type { TxClient } from '../../db/tenant-tx';
import { ProblemException } from '../../errors/problem';
import { assertTaxCode } from '../platform/operators.service';
import { conflict, feeRuleDto, notFound, unprocessable, type FeeRuleDto, type FeeRuleInput, type FeeRuleRow } from '../platform/platform.dto';
import { scopesHeld, type TenantActor } from './tenant-access';

/** Ce qu'une portée dit de l'objet visé par une règle. */
export interface FeeScopeInfo {
  /** Rôle qui règle les règles de cette portée. */
  role: 'OPERATOR_ADMIN' | 'ORGANIZER_ADMIN';
  /** Organisateur concerné (restriction de l'ORGANIZER_ADMIN). */
  organizerId: string;
  /** Pays dont le profil de législation porte les taxes. */
  countryCode: string | null;
  /** Profil de législation de l'événement visé : ses taxes font foi (sinon le dernier profil du pays). */
  jurisdictionId?: string;
  /** Événement visé et son statut : `LIVE` ⇒ l'écriture passe par une demande d'approbation ; au-delà, refus. */
  eventId?: string;
  eventStatus?: string;
}

export type FeeScopeResolver = (client: TxClient, scopeId: string) => Promise<FeeScopeInfo | null>;

const IDENTITY = 'scope_type = $1 AND scope_id = $2 AND payer_purpose = $3 AND beneficiary_purpose = $4 AND basis = $5';

@Injectable()
export class FeeRulesService {
  private readonly scopes = new Map<string, FeeScopeResolver>();

  constructor(private readonly audit: AuditService) {
    this.registerScope('OPERATOR_CONTRACT', async (client, scopeId) => {
      const { rows } = await client.query<{ organizer_id: string; country_code: string | null }>(
        `SELECT c.counterparty_id AS organizer_id, o.country_code FROM contract c JOIN party o ON o.id = c.operator_id
          WHERE c.id = $1 AND c.kind = 'OPERATOR_ORGANIZER'`,
        [scopeId],
      );
      return rows[0] ? { role: 'OPERATOR_ADMIN', organizerId: rows[0].organizer_id, countryCode: rows[0].country_code } : null;
    });
  }

  registerScope(scopeType: string, resolver: FeeScopeResolver): void {
    if (this.scopes.has(scopeType)) throw new Error(`Portée de règle de frais déjà déclarée : ${scopeType}`);
    this.scopes.set(scopeType, resolver);
  }

  /** Objet visé par une portée, sans contrôle de droit (exécution d'une demande déjà autorisée) ; inconnu : `null`. */
  async resolve(client: TxClient, scopeType: string, scopeId: string): Promise<FeeScopeInfo | null> {
    return (await this.scopes.get(scopeType)?.(client, scopeId)) ?? null;
  }

  /** Objet visé et droit de la personne sur cette portée ; portée de plateforme : 403 ; objet invisible : 422. */
  async scope(client: TxClient, actor: TenantActor, scopeType: string, scopeId: string): Promise<FeeScopeInfo> {
    if (scopeType === 'PLATFORM_CONTRACT') throw new ProblemException('FORBIDDEN');
    const info = await this.scopes.get(scopeType)?.(client, scopeId);
    if (!info) throw unprocessable(`scope_id : objet de la portée ${scopeType} introuvable pour ce prestataire.`);
    const holds =
      info.role === 'OPERATOR_ADMIN'
        ? actor.principal.assignments.some((a) => a.role === 'OPERATOR_ADMIN')
        : scopesHeld(actor.principal, 'ORGANIZER_ADMIN', 'ORGANIZER').includes(info.organizerId);
    if (!holds) throw new ProblemException('FORBIDDEN');
    return info;
  }

  /** Règles hors plateforme ; `organizers` : restriction d'un ORGANIZER_ADMIN aux portées de ses organisateurs. */
  async list(
    client: TxClient,
    filter: { scopeType?: string; scopeId?: string; organizers: string[] | null },
    offset: number,
    limit: number,
  ): Promise<FeeRuleRow[]> {
    const { rows } = await client.query<FeeRuleRow>(
      `SELECT f.* FROM fee_rule f
        WHERE f.scope_type <> 'PLATFORM_CONTRACT'
          AND ($1::text IS NULL OR f.scope_type = $1) AND ($2::uuid IS NULL OR f.scope_id = $2)
          AND ($3::uuid[] IS NULL
               OR EXISTS (SELECT 1 FROM contract c WHERE f.scope_type = 'OPERATOR_CONTRACT' AND c.id = f.scope_id AND c.counterparty_id = ANY($3))
               OR EXISTS (SELECT 1 FROM event e WHERE f.scope_type = 'EVENT' AND e.id = f.scope_id AND e.organizer_id = ANY($3))
               OR EXISTS (SELECT 1 FROM merchant_participation mp JOIN event e ON e.id = mp.event_id
                           WHERE f.scope_type = 'PARTICIPATION' AND mp.id = f.scope_id AND e.organizer_id = ANY($3)))
        ORDER BY f.valid_from DESC, f.id LIMIT $4 OFFSET $5`,
      [filter.scopeType ?? null, filter.scopeId ?? null, filter.organizers, limit, offset],
    );
    return rows;
  }

  async row(client: TxClient, feeRuleId: string): Promise<FeeRuleRow> {
    const { rows } = await client.query<FeeRuleRow>('SELECT * FROM fee_rule WHERE id = $1', [feeRuleId]);
    if (!rows[0]) throw notFound();
    return rows[0];
  }

  /** Crée une règle ; une règle en vigueur de même portée, payeur, bénéficiaire et assiette existe : 409. */
  async create(client: TxClient, operatorId: string, input: FeeRuleInput, info: FeeScopeInfo, actor: AuditContext, approverId?: string): Promise<FeeRuleDto> {
    if (input.tax_code !== null) await this.assertTax(client, info, input.tax_code);
    const open = await client.query(`SELECT 1 FROM fee_rule WHERE ${IDENTITY} AND valid_to IS NULL`, identity(input));
    if (open.rowCount !== 0) throw conflict('Une règle en vigueur existe déjà pour cette portée, ce payeur, ce bénéficiaire et cette assiette : la remplacer.');
    const created = feeRuleDto(await this.insert(client, operatorId, input));
    await this.audit.record(client, { ...actor, operatorId, action: 'FEE_RULE_CREATED', objectType: 'fee_rule', objectId: created.fee_rule_id, after: created, approverId: approverId ?? null });
    return created;
  }

  /**
   * Remplace une règle : l'ancienne est fermée à la date d'effet de la nouvelle, la nouvelle prend la version
   * suivante. Portée, payeur, bénéficiaire et assiette restent ceux de la règle remplacée (422 sinon).
   */
  async replace(
    client: TxClient,
    operatorId: string,
    previous: FeeRuleRow,
    input: FeeRuleInput,
    info: FeeScopeInfo,
    actor: AuditContext,
    approverId?: string,
    /** Chaîne d'audit : celle du prestataire, ou `null` (plateforme) pour une redevance de plateforme. */
    auditOperatorId: string | null = operatorId,
  ): Promise<FeeRuleDto> {
    if (identity(input).some((value, index) => value !== identity(previous)[index])) {
      throw unprocessable('Portée, payeur, bénéficiaire et assiette doivent être ceux de la règle remplacée.');
    }
    if (previous.valid_to !== null) throw conflict('Cette règle est déjà fermée : remplacer la règle en vigueur.');
    if (input.tax_code !== null) await this.assertTax(client, info, input.tax_code);
    // Sans date demandée : maintenant, jamais avant la règle remplacée (horloge qui recule de quelques millisecondes).
    const { rows } = await client.query<{ effective: Date }>(
      'SELECT coalesce($1::timestamptz, greatest(clock_timestamp(), $2::timestamptz)) AS effective',
      [input.valid_from, previous.valid_from],
    );
    const effective = rows[0]!.effective;
    if (effective < previous.valid_from) throw unprocessable('La date d\'effet ne peut pas précéder celle de la règle remplacée.');
    await client.query('UPDATE fee_rule SET valid_to = $2 WHERE id = $1', [previous.id, effective]);
    const created = feeRuleDto(await this.insert(client, operatorId, { ...input, valid_from: effective.toISOString() }));
    await this.audit.record(client, {
      ...actor,
      operatorId: auditOperatorId,
      action: 'FEE_RULE_REPLACED',
      objectType: 'fee_rule',
      objectId: created.fee_rule_id,
      before: feeRuleDto({ ...previous, valid_to: effective }),
      after: created,
      approverId: approverId ?? null,
    });
    return created;
  }

  /** `tax_code` : taxe du profil de l'événement visé, sinon du dernier profil du pays. */
  private async assertTax(client: TxClient, info: FeeScopeInfo, taxCode: string): Promise<void> {
    if (info.jurisdictionId === undefined) return assertTaxCode(client, info.countryCode, taxCode);
    const { rows } = await client.query<{ known: boolean }>(
      `SELECT coalesce(rules->'taxes', '{}'::jsonb) ? $2 AS known FROM jurisdiction_profile WHERE id = $1`,
      [info.jurisdictionId, taxCode],
    );
    if (!rows[0]?.known) throw unprocessable(`tax_code : ${taxCode} n'est pas une taxe du profil de législation de l'événement.`);
  }

  private async insert(client: TxClient, operatorId: string, input: FeeRuleInput): Promise<FeeRuleRow> {
    const { rows } = await client.query<FeeRuleRow>(
      `INSERT INTO fee_rule (operator_id, scope_type, scope_id, payer_purpose, beneficiary_purpose, basis, rate_bps, fixed_amount,
                             min_amount, max_amount, tax_code, tax_inclusive, trigger, valid_from, version)
       VALUES ($6, $1, $2, $3, $4, $5, $7, $8, $9, $10, $11, $12, $13, coalesce($14::timestamptz, clock_timestamp()),
               1 + (SELECT coalesce(max(version), 0) FROM fee_rule WHERE ${IDENTITY}))
       RETURNING *`,
      [
        ...identity(input), operatorId, input.rate_bps, input.fixed_amount, input.min_amount, input.max_amount, input.tax_code,
        input.tax_inclusive, input.trigger, input.valid_from,
      ],
    );
    return rows[0]!;
  }
}

function identity(rule: Pick<FeeRuleInput, 'scope_type' | 'scope_id' | 'payer_purpose' | 'beneficiary_purpose' | 'basis'> | FeeRuleRow): string[] {
  return [rule.scope_type, rule.scope_id, rule.payer_purpose, rule.beneficiary_purpose, rule.basis];
}
