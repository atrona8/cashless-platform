// Frais et commissions d'une vente reçue d'une passerelle (WP13, T059, décision 26 du porteur). Le central les
// RECALCULE avec la même règle qu'en ligne (`buildPurchase` : `fee` et `extractTax` de `@cashless/shared-rules`) :
// règle de commission en vigueur à la date de la vente, du point de vente du terminal (lu en base), taux de taxe du
// profil de législation. Les frais annoncés par la passerelle ne sont JAMAIS lus. La vente est calculée « couverte en
// entier » : seules les lignes de frais sont gardées, la répartition portefeuille / attente vient de `edge_decision`.
// La configuration vient de `edge_fee_config` (SQL, SECURITY DEFINER, décision 39) : `cashless_edge` n'a aucun droit
// de table. Lignes produites comme `buildPurchase` : commerçant +commission, ORG_COM −HT, ORG_TAX −taxe (omise si
// nulle), chacune portant l'identifiant de la règle.
import { extractTax, fee } from '@cashless/shared-rules';
import { ProblemException } from '../../errors/problem';
import type { FeeLine } from './edge-sync-central.port';

/** Ligne rendue par `edge_fee_config`. */
export interface FeeConfigRow {
  rule_id: string;
  rate_bps: number;
  fixed_amount: string | number | bigint;
  min_amount: string | number | bigint | null;
  max_amount: string | number | bigint | null;
  tax_bps: number;
  merchant_account_id: string | null;
  org_com_account_id: string | null;
  org_tax_account_id: string | null;
}

const unresolved = (what: string): ProblemException =>
  new ProblemException('VALIDATION_FAILED', {
    status: 422,
    detail: `Configuration : compte introuvable : ${what}.`,
  });

export function feeLinesFromConfig(config: FeeConfigRow | undefined, amount: bigint): FeeLine[] {
  if (config === undefined) return [];
  const big = (v: string | number | bigint | null): bigint | null =>
    v === null ? null : BigInt(v);
  const commission = fee(amount, {
    id: config.rule_id,
    rateBps: BigInt(config.rate_bps),
    fixed: BigInt(config.fixed_amount),
    min: big(config.min_amount),
    max: big(config.max_amount),
  });
  if (commission <= 0n) return [];
  const { ht, tax } = extractTax(commission, BigInt(config.tax_bps));
  const line = (account: string | null, value: bigint, what: string): FeeLine => {
    if (account === null) throw unresolved(what);
    return { account_id: account, amount: Number(value), fee_rule_id: config.rule_id, memo: null };
  };
  const lines = [line(config.merchant_account_id, commission, 'commerçant')];
  if (ht !== 0n) lines.push(line(config.org_com_account_id, -ht, 'ORG_COM'));
  if (tax !== 0n) lines.push(line(config.org_tax_account_id, -tax, 'ORG_TAX'));
  return lines;
}
