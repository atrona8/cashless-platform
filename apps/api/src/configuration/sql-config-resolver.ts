// Résolveur de configuration réel (port `ConfigResolver` du moteur d'écritures ; research R-10, FR-016, SC-004).
// Pour l'événement du grand livre, à la date de l'opération : configuration résolue de la cascade, contrat rattaché à
// l'événement, profil de législation, règles de frais en vigueur (`valid_from ≤ t < valid_to`). Chaque règle rendue
// porte son identifiant, que les constructeurs reportent sur les lignes qu'elle produit (`posting.fee_rule_id`) ;
// `configVersionId` est la version de configuration de l'événement en vigueur à cette date.
// Lit avec le client de la transaction de l'écriture : même prestataire (RLS), mêmes données.
//
// Correspondance règle de frais → configuration du moteur (portée, payeur → bénéficiaire, assiette) :
//   commission d'un commerçant    PARTICIPATION       MERCHANT   → ORG_COM      SALE_AMOUNT
//   frais d'activation            EVENT               *          → ORG_FFEST    PER_MEDIA
//   frais de remboursement        EVENT               *          → ORG_FFEST    PER_REFUND
//   frais du prestataire          OPERATOR_CONTRACT   ORG_FPREST → OPE_FRAIS    TOPUP_AMOUNT, PER_MEDIA
//   redevance de la plateforme    PLATFORM_CONTRACT   OPE_REDEV  → PLT_REDEV    FEE_AMOUNT
//   frais d'un canal de paiement  PSP_CONFIGURATION   *          → (canal)     TOPUP_AMOUNT
// Mission 6 (WP10) : la règle de frais PSP est celle de la CONFIGURATION figée par la recharge
// (`query.pspConfigurationId`), rangée sous le canal de son moyen. La convention `EVENT` + `PSP:<canal>` (ADR-82 §3)
// est retirée : aucune règle de ce type n'est plus lue.
import { Injectable } from '@nestjs/common';
import { ProblemException } from '../errors/problem';
import type { FeeRule } from '../ledger/money';
import type { Queryable } from '../ledger/ports/account-resolver';
import type { ConfigQuery, ConfigResolver } from '../ledger/ports/config-resolver';
import type {
  BreakageDestination,
  LossBearer,
  OperatorFeeBasis,
  PspFeeBearer,
  ResolvedConfig,
} from '../ledger/types';
import type { TxClient } from '../db/tenant-tx';
import { FEE_CHANNEL, type PspMethod } from '../psp-configurations/psp-configurations.dto';
import { CascadeService } from './cascade.service';

interface EventRow {
  id: string;
  operator_id: string;
  organizer_id: string;
  contract_id: string | null;
  jurisdiction_id: string;
}

interface RuleRow {
  id: string;
  scope_type: string;
  scope_id: string;
  payer_purpose: string;
  beneficiary_purpose: string;
  basis: string;
  rate_bps: number;
  fixed_amount: bigint;
  min_amount: bigint | null;
  max_amount: bigint | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Ordre des règles du prestataire dans l'écriture OPERATOR_FEE (une ligne par règle, dans cet ordre). */
const OPERATOR_BASES: readonly OperatorFeeBasis[] = ['TOPUP_AMOUNT', 'PER_MEDIA'];

const missing = (what: string): ProblemException =>
  new ProblemException('VALIDATION_FAILED', {
    status: 422,
    detail: `Règle de frais manquante : ${what}.`,
  });

function feeRule(row: RuleRow): FeeRule {
  return {
    id: row.id,
    rateBps: BigInt(row.rate_bps),
    fixed: row.fixed_amount,
    min: row.min_amount,
    max: row.max_amount,
  };
}

@Injectable()
export class SqlConfigResolver implements ConfigResolver {
  constructor(private readonly cascade: CascadeService) {}

  async resolve(query: ConfigQuery): Promise<ResolvedConfig> {
    const client = query.client as (Queryable & TxClient) | undefined;
    if (!client) throw new Error('SqlConfigResolver : client de la transaction requis');
    const at = query.occurredAt;
    const event = await this.event(client, query);
    // Requêtes l'une après l'autre : le client `pg` de la transaction n'en exécute qu'une à la fois (lancées
    // ensemble, elles déclenchent `DeprecationWarning`, retiré dans pg@9).
    const platformId = await this.platformParty(client, query.ledgerId);
    const contract = await this.contract(client, event);
    const jurisdiction = await this.jurisdiction(client, event.jurisdiction_id);
    const rules = await this.rules(client, event, at);
    const pitchFees = await this.pitchFees(client, event.id);
    const configVersionId = await this.configVersion(client, event.id, at);
    const cascade = await this.cascade.resolveForEvent(client, event.id, at);

    const of = (scope: string, beneficiary: string, basis: string) =>
      rules.filter(
        (rule) =>
          rule.scope_type === scope &&
          rule.beneficiary_purpose === beneficiary &&
          rule.basis === basis,
      );
    const single = (scope: string, beneficiary: string, basis: string): FeeRule | undefined => {
      const [rule] = of(scope, beneficiary, basis);
      return rule ? feeRule(rule) : undefined;
    };
    const commissions: Record<string, FeeRule> = {};
    for (const rule of of('PARTICIPATION', 'ORG_COM', 'SALE_AMOUNT'))
      commissions[rule.scope_id] = feeRule(rule);
    const pspFees = await this.pspFees(client, event, at, query.pspConfigurationId);
    const operatorFees = OPERATOR_BASES.flatMap((basis) =>
      of('OPERATOR_CONTRACT', 'OPE_FRAIS', basis).map((rule) => ({ basis, rule: feeRule(rule) })),
    );

    const config = {
      parties: { platformId, operatorId: event.operator_id, organizerId: event.organizer_id },
      ...(configVersionId ? { configVersionId } : {}),
      taxBps: jurisdiction.taxBps,
      commissions,
      pspFees,
      pspFeeBearer: cascade.psp_fee_bearer!.value as PspFeeBearer,
      operatorFees,
      breakageOrganizerBps: BigInt(contract.breakage_organizer_bps),
      pitchFees,
      spendOrder: cascade.spend_order!.value as ResolvedConfig['spendOrder'],
      chargebackBearer: contract.chargeback_bearer,
      cashDiffBearer: contract.cash_diff_bearer,
      offlineLossBearer: contract.offline_loss_bearer,
      breakageDestination: jurisdiction.breakageDestination,
    } as ResolvedConfig;
    // Une règle qu'un constructeur lit alors qu'elle n'existe pas : erreur explicite, jamais un frais nul silencieux.
    lazyRule(
      config,
      'activationFee',
      single('EVENT', 'ORG_FFEST', 'PER_MEDIA'),
      "frais d'activation (EVENT, ORG_FFEST, PER_MEDIA)",
    );
    lazyRule(
      config,
      'refundFee',
      single('EVENT', 'ORG_FFEST', 'PER_REFUND'),
      'frais de remboursement (EVENT, ORG_FFEST, PER_REFUND)',
    );
    lazyRule(
      config,
      'platformFee',
      single('PLATFORM_CONTRACT', 'PLT_REDEV', 'FEE_AMOUNT'),
      'redevance de la plateforme (PLATFORM_CONTRACT, PLT_REDEV, FEE_AMOUNT)',
    );
    return config;
  }

  // ------------------------------------------------------------------ Lectures

  private async event(client: Queryable, query: ConfigQuery): Promise<EventRow> {
    const { rows } = await client.query<EventRow>(
      `SELECT e.id, e.operator_id, e.organizer_id, e.contract_id, e.jurisdiction_id
         FROM ledger l JOIN event e ON l.scope_type = 'EVENT' AND e.id = l.scope_id
        WHERE l.id = $1 AND ($2::uuid IS NULL OR e.id = $2)`,
      [query.ledgerId, query.eventId ?? null],
    );
    if (!rows[0])
      throw new ProblemException('VALIDATION_FAILED', {
        status: 422,
        detail: "Configuration : ce grand livre n'est pas celui d'un événement.",
      });
    return rows[0];
  }

  /** Partie plateforme du grand livre : la titulaire de ses comptes de redevance. */
  private async platformParty(client: Queryable, ledgerId: string): Promise<string> {
    const { rows } = await client.query<{ owner_party_id: string }>(
      `SELECT owner_party_id FROM account WHERE ledger_id = $1 AND purpose = 'PLT_REDEV' AND owner_party_id IS NOT NULL LIMIT 1`,
      [ledgerId],
    );
    if (!rows[0])
      throw new ProblemException('VALIDATION_FAILED', {
        status: 422,
        detail: 'Configuration : comptes de la plateforme absents du grand livre.',
      });
    return rows[0].owner_party_id;
  }

  /** Contrat prestataire–organisateur rattaché à l'événement (la version à laquelle il est rattaché fait foi). */
  private async contract(client: Queryable, event: EventRow) {
    const { rows } = await client.query<{
      breakage_organizer_bps: number;
      chargeback_bearer: LossBearer;
      cash_diff_bearer: LossBearer;
      offline_loss_bearer: LossBearer;
    }>(
      `SELECT breakage_organizer_bps, chargeback_bearer, cash_diff_bearer, offline_loss_bearer
         FROM contract WHERE id = $1 AND kind = 'OPERATOR_ORGANIZER'`,
      [event.contract_id],
    );
    if (!rows[0])
      throw new ProblemException('VALIDATION_FAILED', {
        status: 422,
        detail: "Configuration : aucun contrat prestataire–organisateur rattaché à l'événement.",
      });
    return rows[0];
  }

  /** Destination de la casse et taux de taxe du profil : la taxe unique du profil, ou `VAT` s'il en porte plusieurs. */
  private async jurisdiction(
    client: Queryable,
    jurisdictionId: string,
  ): Promise<{ breakageDestination: BreakageDestination; taxBps: bigint }> {
    const { rows } = await client.query<{
      breakage_destination: string;
      taxes: Record<string, { rate_bps?: unknown }> | null;
    }>(
      `SELECT breakage_destination, rules->'taxes' AS taxes FROM jurisdiction_profile WHERE id = $1`,
      [jurisdictionId],
    );
    const profile = rows[0];
    if (!profile)
      throw new ProblemException('VALIDATION_FAILED', {
        status: 422,
        detail: 'Configuration : profil de législation introuvable.',
      });
    const taxes = Object.entries(profile.taxes ?? {});
    const tax = taxes.length === 1 ? taxes[0]![1] : (profile.taxes ?? {}).VAT;
    if (taxes.length > 1 && !tax) {
      throw new ProblemException('VALIDATION_FAILED', {
        status: 422,
        detail: 'Configuration : plusieurs taxes au profil de législation, aucune nommée VAT.',
      });
    }
    const rate = tax?.rate_bps;
    if (tax && (typeof rate !== 'number' || !Number.isInteger(rate) || rate < 0)) {
      throw new ProblemException('VALIDATION_FAILED', {
        status: 422,
        detail: 'Configuration : taux de taxe du profil de législation invalide.',
      });
    }
    return {
      breakageDestination: profile.breakage_destination as BreakageDestination,
      taxBps: BigInt((rate as number | undefined) ?? 0),
    };
  }

  /** Règles en vigueur à la date : de l'événement, de ses participations, de son contrat, du contrat de plateforme. */
  private async rules(client: Queryable, event: EventRow, at: Date): Promise<RuleRow[]> {
    const { rows } = await client.query<RuleRow>(
      `SELECT f.id, f.scope_type, f.scope_id, f.payer_purpose, f.beneficiary_purpose, f.basis, f.rate_bps, f.fixed_amount, f.min_amount, f.max_amount
         FROM fee_rule f
        WHERE f.valid_from <= $2 AND (f.valid_to IS NULL OR f.valid_to > $2)
          AND ((f.scope_type = 'EVENT' AND f.scope_id = $1)
            OR (f.scope_type = 'PARTICIPATION' AND f.scope_id IN (SELECT mp.id FROM merchant_participation mp WHERE mp.event_id = $1))
            OR (f.scope_type = 'OPERATOR_CONTRACT' AND f.scope_id = $3)
            OR (f.scope_type = 'PLATFORM_CONTRACT' AND f.scope_id = (
                  SELECT c.id FROM contract c WHERE c.operator_id = $4 AND c.kind = 'PLATFORM_OPERATOR' AND c.valid_from <= $2
                   ORDER BY c.version DESC LIMIT 1)))
        ORDER BY f.scope_type, f.scope_id, f.basis, f.version DESC`,
      [event.id, at, event.contract_id, event.operator_id],
    );
    return rows;
  }

  /**
   * Frais de la recharge : règle `PSP_CONFIGURATION` / `TOPUP_AMOUNT` en vigueur à la date, version la plus haute,
   * de la configuration figée par la recharge, rangée sous le canal de son moyen. Une configuration d'un autre
   * organisateur que celui de l'événement ne donne aucune règle (frais nuls) ; sans règle : frais nuls (R-13).
   */
  private async pspFees(
    client: Queryable,
    event: EventRow,
    at: Date,
    configId: string | undefined,
  ): Promise<Record<string, FeeRule>> {
    if (configId === undefined) return {};
    if (!UUID.test(configId))
      throw new ProblemException('VALIDATION_FAILED', {
        status: 422,
        detail: 'Configuration : identifiant de configuration PSP invalide.',
      });
    const { rows } = await client.query<RuleRow & { method: PspMethod }>(
      `SELECT f.id, f.scope_type, f.scope_id, f.payer_purpose, f.beneficiary_purpose, f.basis, f.rate_bps,
              f.fixed_amount, f.min_amount, f.max_amount, c.method
         FROM fee_rule f
         JOIN psp_configuration c ON c.psp_configuration_id = f.scope_id AND c.organizer_id = $2
        WHERE f.scope_type = 'PSP_CONFIGURATION' AND f.scope_id = $1 AND f.basis = 'TOPUP_AMOUNT'
          AND f.valid_from <= $3 AND (f.valid_to IS NULL OR f.valid_to > $3)
        ORDER BY f.version DESC LIMIT 1`,
      [configId, event.organizer_id, at],
    );
    const row = rows[0];
    return row ? { [FEE_CHANNEL[row.method]]: feeRule(row) } : {};
  }

  /** Droits de place dus, par participation (les participations sans droit de place n'y figurent pas). */
  private async pitchFees(client: Queryable, eventId: string): Promise<Record<string, bigint>> {
    const { rows } = await client.query<{ id: string; pitch_fee: bigint }>(
      'SELECT id, pitch_fee FROM merchant_participation WHERE event_id = $1 AND pitch_fee > 0',
      [eventId],
    );
    return Object.fromEntries(rows.map((row) => [row.id, row.pitch_fee]));
  }

  /**
   * Version de configuration de l'événement en vigueur à la date ; une opération datée d'avant la première version
   * (heure de terminal antérieure à la création de l'événement) prend la première.
   */
  private async configVersion(
    client: Queryable,
    eventId: string,
    at: Date,
  ): Promise<string | undefined> {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM (
         (SELECT id, 1 AS rank, version FROM config_version WHERE scope_type = 'EVENT' AND scope_id = $1 AND valid_from <= $2 ORDER BY version DESC LIMIT 1)
         UNION ALL
         (SELECT id, 2 AS rank, -version FROM config_version WHERE scope_type = 'EVENT' AND scope_id = $1 ORDER BY version ASC LIMIT 1)
       ) v ORDER BY rank LIMIT 1`,
      [eventId, at],
    );
    return rows[0]?.id;
  }
}

/** Pose une règle unique ; absente, la lire lève l'erreur « règle de frais manquante ». */
function lazyRule(
  config: ResolvedConfig,
  key: 'activationFee' | 'refundFee' | 'platformFee',
  rule: FeeRule | undefined,
  what: string,
): void {
  if (rule) config[key] = rule;
  else {
    Object.defineProperty(config, key, {
      enumerable: true,
      get: () => {
        throw missing(what);
      },
    });
  }
}
