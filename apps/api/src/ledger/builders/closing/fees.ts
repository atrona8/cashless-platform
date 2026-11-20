// PITCH_FEE, MERCHANT_DEBT_TRANSFER, OPERATOR_FEE, PLATFORM_FEE — SPECIFICATION §5.4, §5.6.
import { extractTax, fee, groupForTax } from '@cashless/shared-rules';
import {
  BuildError,
  merchant,
  partyAccounts,
  type BuildContext,
  type LedgerCommand,
  type Line,
} from '../../types';
import {
  balanced,
  creditWithTax,
  push,
  requireId,
  requirePositive,
  tagFee,
} from '../festival/lines';

export type PitchFeeMode = 'DEDUCT_OR_DEBT' | 'DEDUCT_CAPPED' | 'PREPAID';

export interface PitchFeePayload {
  items: {
    participationId: string;
    mode: PitchFeeMode;
    /** Solde disponible du commerçant (positif = dû au commerçant), requis en `DEDUCT_CAPPED`. */
    merchantBalance?: bigint;
  }[];
}

/** Droits de place : un débit par commerçant retenu, puis une seule extraction de taxe sur la somme (cas 18). */
export function buildPitchFee(
  command: LedgerCommand<'PITCH_FEE', PitchFeePayload>,
  ctx: BuildContext,
): Line[] {
  const { config } = ctx;
  const { org } = partyAccounts(config);
  const lines: Line[] = [];
  for (const item of command.payload.items ?? []) {
    if (item.mode === 'PREPAID') continue;
    const due = config.pitchFees[requireId(item.participationId, 'participation')] ?? 0n;
    let amount = due;
    if (item.mode === 'DEDUCT_CAPPED') {
      if (item.merchantBalance === undefined)
        throw new BuildError(
          'VALIDATION_FAILED',
          'droit de place plafonné : solde du commerçant manquant',
        );
      const available = item.merchantBalance > 0n ? item.merchantBalance : 0n;
      amount = due < available ? due : available;
    }
    push(lines, merchant(item.participationId), amount);
  }
  const total = lines.reduce((sum, line) => sum + line.amount, 0n);
  requirePositive(total, 'droits de place');
  for (const group of groupForTax([{ beneficiary: 'ORG', taxBps: config.taxBps, ttc: total }])) {
    push(lines, org('ORG_PLACE'), -group.ht);
    push(lines, org('ORG_TAX'), -group.tax);
  }
  return balanced(lines);
}

export interface MerchantDebtTransferPayload {
  participationId: string;
  /** Solde du commerçant (positif = dû au commerçant) ; seule une dette (solde négatif) se transfère. */
  merchantBalance: bigint;
}

/** Dette d'un commerçant reprise par l'organisateur (créance). */
export function buildMerchantDebtTransfer(
  command: LedgerCommand<'MERCHANT_DEBT_TRANSFER', MerchantDebtTransferPayload>,
  ctx: BuildContext,
): Line[] {
  const { participationId, merchantBalance } = command.payload;
  requireId(participationId, 'participation');
  if (merchantBalance >= 0n)
    throw new BuildError(
      'VALIDATION_FAILED',
      'transfert de dette : le commerçant n’est pas débiteur',
    );
  const { org } = partyAccounts(ctx.config);
  const debt = -merchantBalance;
  return balanced([
    { account: org('ORG_RECEIVABLE'), amount: debt },
    { account: merchant(participationId), amount: -debt },
  ]);
}

export interface OperatorFeePayload {
  /** Assiettes de la période fournies par le service : montant des recharges payées, nombre de supports activés. */
  bases: { TOPUP_AMOUNT?: bigint; PER_MEDIA?: bigint };
  /** Régularisation `NET_OF_REFUNDS` : écriture de sens inverse (§5.6). */
  regularization?: boolean;
  /**
   * Variante `REGULARIZATION` seulement : écart explicite (frais sur assiette brute moins frais sur assiette nette,
   * calculé avec la même règle min/max/fixe), écrit en une transaction inversée. Ignoré hors régularisation.
   */
  amount?: bigint;
}

/**
 * Frais TTC bruts de toutes les règles du prestataire pour ces assiettes (plafond de la régularisation,
 * OP-N141). `PER_MEDIA` : nombre de supports × montant fixe ; `TOPUP_AMOUNT` : règle sur le montant.
 */
export function operatorFeeTotal(
  config: Pick<BuildContext['config'], 'operatorFees'>,
  bases: OperatorFeePayload['bases'] | undefined,
): bigint {
  return config.operatorFees.reduce(
    (sum, { basis, rule }) =>
      sum +
      (basis === 'PER_MEDIA'
        ? (bases?.PER_MEDIA ?? 0n) * fee(0n, rule)
        : fee(bases?.TOPUP_AMOUNT ?? 0n, rule)),
    0n,
  );
}

/** Frais du prestataire : une ligne `ORG_FPREST` par règle (jamais fusionnées), une extraction de taxe sur la somme. */
export function buildOperatorFee(
  command: LedgerCommand<'OPERATOR_FEE', OperatorFeePayload>,
  ctx: BuildContext,
): Line[] {
  const { bases, regularization, amount } = command.payload;
  const { config } = ctx;
  const { org, ope } = partyAccounts(config);
  const lines: Line[] = [];
  if (regularization && amount !== undefined) {
    requirePositive(amount, 'écart de régularisation');
    // Plafond (OP-N141) : l'écart ne dépasse jamais les frais bruts TTC, avant toute ligne écrite.
    if (amount > operatorFeeTotal(config, bases)) {
      throw new BuildError(
        'VALIDATION_FAILED',
        'écart de régularisation : supérieur aux frais bruts',
      );
    }
    push(lines, org('ORG_FPREST'), amount);
    creditWithTax(lines, amount, config.taxBps, ope('OPE_FRAIS'), ope('OPE_TAX'));
    return balanced(lines.map((line) => ({ ...line, amount: -line.amount })));
  }
  for (const { basis, rule } of config.operatorFees) {
    const base = bases?.[basis] ?? 0n;
    // PER_MEDIA : nombre de supports × montant par support ; TOPUP_AMOUNT : frais sur le montant des recharges.
    const from = lines.length;
    push(lines, org('ORG_FPREST'), basis === 'PER_MEDIA' ? base * fee(0n, rule) : fee(base, rule));
    tagFee(lines, from, rule);
  }
  const total = lines.reduce((sum, line) => sum + line.amount, 0n);
  requirePositive(total, 'frais du prestataire');
  creditWithTax(lines, total, config.taxBps, ope('OPE_FRAIS'), ope('OPE_TAX'));
  return balanced(
    regularization ? lines.map((line) => ({ ...line, amount: -line.amount })) : lines,
  );
}

export interface PlatformFeePayload {
  /** Assiette : frais HT du prestataire de la période. */
  operatorFeeHt: bigint;
}

export function buildPlatformFee(
  command: LedgerCommand<'PLATFORM_FEE', PlatformFeePayload>,
  ctx: BuildContext,
): Line[] {
  const { config } = ctx;
  const { ope, plt } = partyAccounts(config);
  const ttc = requirePositive(
    fee(
      requirePositive(command.payload.operatorFeeHt, 'assiette de la redevance'),
      config.platformFee,
    ),
    'redevance',
  );
  const { ht, tax } = extractTax(ttc, config.taxBps);
  const lines: Line[] = [];
  push(lines, ope('OPE_REDEV'), ttc);
  push(lines, plt('PLT_REDEV'), -ht);
  push(lines, plt('PLT_TAX'), -tax);
  tagFee(lines, 0, config.platformFee);
  return balanced(lines);
}
