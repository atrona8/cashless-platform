// Profils de législation (SPECIFICATION §4.1, §6.3, §17.2 ; FR-002, FR-003). Un profil ne se modifie jamais : chaque
// changement est une nouvelle version du même pays. Un champ omis prend son défaut provisoire, consigné dans
// `rules.provisional` et rendu dans `provisional_fields`. Une version qui change un plafond réglementaire est une
// opération à deux personnes (`JURISDICTION_LIMITS_CHANGE`). Écritures : rôle de la plateforme seulement.
import { Injectable } from '@nestjs/common';
import { AuditService, type AuditContext } from '../audit/audit.service';
import type { TxClient } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';
import { jsonValue } from './cascade.service';
import {
  completeJurisdictionProfile,
  provisionalFields,
  type CompletedJurisdictionProfile,
  type JurisdictionProfileInput,
  type ProvisionalField,
} from './provisional-defaults';

/** Plafonds réglementaires (§6.3) : les changer exige deux personnes. */
export const REGULATORY_LIMITS = [
  'max_wallet_balance',
  'kyc_threshold',
  'unidentified_max_balance',
  'unidentified_monthly_limit',
  'identified_monthly_limit',
] as const;

interface ProfileRow {
  id: string;
  country_code: string;
  version: number;
  valid_from: Date | string;
  min_refund_window_days: number | null;
  breakage_destination: string;
  max_wallet_balance: bigint | null;
  kyc_threshold: bigint | null;
  unidentified_max_balance: bigint | null;
  unidentified_monthly_limit: bigint | null;
  identified_monthly_limit: bigint | null;
  late_claim_years: number;
  rules: Record<string, unknown>;
}

export interface JurisdictionProfileDto {
  profile_id: string;
  country_code: string;
  version: number;
  valid_from: string;
  min_refund_window_days: number | null;
  breakage_destination: string;
  max_wallet_balance: unknown;
  kyc_threshold: unknown;
  unidentified_max_balance: unknown;
  unidentified_monthly_limit: unknown;
  identified_monthly_limit: unknown;
  late_claim_years: number;
  rules: Record<string, unknown>;
  provisional_fields: ProvisionalField[];
}

const COLUMNS = `id, country_code, version, to_char(valid_from, 'YYYY-MM-DD') AS valid_from, min_refund_window_days,
  breakage_destination, max_wallet_balance, kyc_threshold, unidentified_max_balance, unidentified_monthly_limit,
  identified_monthly_limit, late_claim_years, rules`;

function dto(row: ProfileRow): JurisdictionProfileDto {
  const { provisional: _list, ...rules } = row.rules ?? {};
  return {
    profile_id: row.id,
    country_code: row.country_code,
    version: row.version,
    valid_from: String(row.valid_from),
    min_refund_window_days: row.min_refund_window_days,
    breakage_destination: row.breakage_destination,
    max_wallet_balance: jsonValue(row.max_wallet_balance),
    kyc_threshold: jsonValue(row.kyc_threshold),
    unidentified_max_balance: jsonValue(row.unidentified_max_balance),
    unidentified_monthly_limit: jsonValue(row.unidentified_monthly_limit),
    identified_monthly_limit: jsonValue(row.identified_monthly_limit),
    late_claim_years: row.late_claim_years,
    rules,
    provisional_fields: provisionalFields(row.rules),
  };
}

const conflict = (detail: string): ProblemException => new ProblemException('CONFLICT_STATE', { status: 409, detail });
const same = (a: unknown, b: unknown): boolean => (a === null || a === undefined ? b === null || b === undefined : b !== null && b !== undefined && String(a) === String(b));

@Injectable()
export class JurisdictionService {
  constructor(private readonly audit: AuditService) {}

  async list(client: TxClient, countryCode: string | undefined, offset: number, limit: number): Promise<JurisdictionProfileDto[]> {
    const { rows } = await client.query<ProfileRow>(
      `SELECT ${COLUMNS} FROM jurisdiction_profile WHERE ($1::text IS NULL OR country_code = $1)
        ORDER BY country_code, version LIMIT $2 OFFSET $3`,
      [countryCode ?? null, limit, offset],
    );
    return rows.map(dto);
  }

  async get(client: TxClient, profileId: string): Promise<JurisdictionProfileDto> {
    const { rows } = await client.query<ProfileRow>(`SELECT ${COLUMNS} FROM jurisdiction_profile WHERE id = $1`, [profileId]);
    if (!rows[0]) throw new ProblemException('NOT_FOUND');
    return dto(rows[0]);
  }

  /** Crée la version 1 du profil d'un pays ; un profil existe déjà : 409. */
  async create(client: TxClient, input: JurisdictionProfileInput, actor: AuditContext): Promise<JurisdictionProfileDto> {
    const existing = await client.query('SELECT 1 FROM jurisdiction_profile WHERE country_code = $1 LIMIT 1', [input.country_code]);
    if (existing.rowCount !== 0) throw conflict(`Un profil de législation existe déjà pour ${input.country_code} : publier une nouvelle version.`);
    return this.insert(client, completeJurisdictionProfile(input), 1, null, actor);
  }

  /**
   * Version suivante du profil du pays de `profileId`, qui doit être la dernière (sinon 409). Rend la version
   * complétée et dit si un plafond réglementaire change : l'appelant crée alors une demande d'approbation au lieu
   * d'écrire.
   */
  async prepareVersion(
    client: TxClient,
    profileId: string,
    input: Omit<JurisdictionProfileInput, 'country_code'>,
  ): Promise<{ previous: JurisdictionProfileDto; completed: CompletedJurisdictionProfile; limitsChange: boolean }> {
    const previous = await this.latestOf(client, profileId);
    const completed = completeJurisdictionProfile({ ...input, country_code: previous.country_code });
    if (completed.valid_from < previous.valid_from) {
      throw new ProblemException('VALIDATION_FAILED', { status: 422, detail: 'La date d\'effet ne peut pas précéder celle de la version en vigueur.' });
    }
    const before = previous as unknown as Record<string, unknown>;
    const after = completed as unknown as Record<string, unknown>;
    return { previous, completed, limitsChange: REGULATORY_LIMITS.some((field) => !same(before[field], after[field])) };
  }

  /** Écrit la version suivante ; `profileId` doit toujours être la dernière version (revérifié ici). */
  async writeVersion(
    client: TxClient,
    profileId: string,
    completed: CompletedJurisdictionProfile,
    actor: AuditContext,
    approverId?: string,
  ): Promise<JurisdictionProfileDto> {
    const previous = await this.latestOf(client, profileId);
    return this.insert(client, { ...completed, country_code: previous.country_code }, previous.version + 1, previous, actor, approverId);
  }

  private async latestOf(client: TxClient, profileId: string): Promise<JurisdictionProfileDto> {
    const profile = await this.get(client, profileId);
    const { rows } = await client.query<{ id: string }>(
      'SELECT id FROM jurisdiction_profile WHERE country_code = $1 ORDER BY version DESC LIMIT 1',
      [profile.country_code],
    );
    if (rows[0]?.id !== profileId) throw conflict('Ce profil n\'est plus la dernière version de son pays : repartir de la version courante.');
    return profile;
  }

  private async insert(
    client: TxClient,
    profile: CompletedJurisdictionProfile,
    version: number,
    previous: JurisdictionProfileDto | null,
    actor: AuditContext,
    approverId?: string,
  ): Promise<JurisdictionProfileDto> {
    let row: ProfileRow;
    try {
      const { rows } = await client.query<ProfileRow>(
        `INSERT INTO jurisdiction_profile (country_code, version, valid_from, min_refund_window_days, breakage_destination,
           max_wallet_balance, kyc_threshold, unidentified_max_balance, unidentified_monthly_limit, identified_monthly_limit,
           late_claim_years, rules)
         VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
         RETURNING ${COLUMNS}`,
        [
          profile.country_code, version, profile.valid_from, profile.min_refund_window_days, profile.breakage_destination,
          profile.max_wallet_balance, profile.kyc_threshold, profile.unidentified_max_balance, profile.unidentified_monthly_limit,
          profile.identified_monthly_limit, profile.late_claim_years, JSON.stringify(profile.rules),
        ],
      );
      row = rows[0]!;
    } catch (error) {
      // Deux écritures concurrentes de la même version : unicité (pays, version).
      if ((error as { code?: string }).code === '23505') throw conflict('Une autre version de ce profil vient d\'être publiée.');
      throw error;
    }
    const created = dto(row);
    await this.audit.record(client, {
      ...actor,
      operatorId: null,
      action: 'JURISDICTION_PROFILE_CREATED',
      objectType: 'jurisdiction_profile',
      objectId: created.profile_id,
      before: previous,
      after: created,
      approverId: approverId ?? null,
    });
    return created;
  }
}
