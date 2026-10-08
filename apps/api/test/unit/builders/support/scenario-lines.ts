// Accès au scénario de référence (packages/ledger-sql/scenario_reference.json) pour les tests des constructeurs.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AccountRef, LedgerCommand, Line, ResolvedConfig, Source, TransactionType, WalletBalances } from '../../../../src/ledger/types';

interface ScenarioLine {
  account: string;
  amount: number;
  memo?: string;
}
interface ScenarioTransaction {
  no: number;
  type: TransactionType;
  source: Source;
  occurred_at: string;
  idempotency_key: string;
  lines: ScenarioLine[];
}
interface ScenarioAccount {
  code: string;
  purpose: string;
  owner: string | null;
}
interface Scenario {
  parameters: Record<string, unknown>;
  parties: Record<string, { id: string; kind: string; name: string }>;
  accounts: ScenarioAccount[];
  transactions: ScenarioTransaction[];
}

const SCENARIO_FILE = join(__dirname, '../../../../../../packages/ledger-sql/scenario_reference.json');
const raw = readFileSync(SCENARIO_FILE, 'utf8');
export const scenario: Scenario = JSON.parse(raw);

export const LEDGER_ID = '10000000-0000-0000-0000-00000000a001';

/** Ligne attendue, comparable à une ligne construite une fois sa référence résolue. */
export interface CodedLine {
  account: string;
  amount: bigint;
}

export function transaction(no: number): ScenarioTransaction {
  const tx = scenario.transactions.find((t) => t.no === no);
  if (!tx) throw new Error(`transaction ${no} absente du scénario`);
  return tx;
}

export function expectedLines(no: number): CodedLine[] {
  return transaction(no).lines.map((line) => ({ account: line.account, amount: BigInt(line.amount) }));
}

/** Lignes de la transaction sous forme de lignes du moteur (références par code), pour REVERSAL. */
export function originalLines(no: number): Line[] {
  return expectedLines(no).map(({ account, amount }) => ({ account: { code: account }, amount }));
}

/** Solde signé d'un compte (somme des lignes) avant la transaction `no`. */
export function balanceBefore(no: number, code: string): bigint {
  return scenario.transactions
    .filter((t) => t.no < no)
    .flatMap((t) => t.lines)
    .filter((line) => line.account === code)
    .reduce((sum, line) => sum + BigInt(line.amount), 0n);
}

/** Soldes d'un portefeuille avant la transaction `no`, en convention « positif = disponible ». */
export function walletBalancesBefore(no: number, walletId: string): WalletBalances {
  return { promo: -balanceBefore(no, `L-WAL-${walletId}-X`), paid: -balanceBefore(no, `L-WAL-${walletId}-P`) };
}

// ------------------------------------------------------------------ paramètres

/** Texte brut d'un paramètre numérique (jamais relu en flottant, research R-09). */
function parameterText(name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`"${escaped}":\\s*(-?[0-9]+(?:\\.[0-9]+)?)`).exec(raw);
  if (!match?.[1]) throw new Error(`paramètre numérique introuvable : ${name}`);
  return match[1];
}

/** Taux décimal du scénario converti en points de base depuis son texte : "0.015" → 150n. */
export function bps(name: string): bigint {
  const [whole = '0', fraction = ''] = parameterText(name).split('.');
  if (fraction.length > 4) throw new Error(`${name} : plus de 4 décimales`);
  return BigInt(whole) * 10_000n + BigInt(fraction.padEnd(4, '0'));
}

export function amountParameter(name: string): bigint {
  return BigInt(parameterText(name));
}

const partyId = (key: string): string => {
  const party = scenario.parties[key];
  if (!party) throw new Error(`partie absente : ${key}`);
  return party.id;
};

/** Configuration du scénario, telle que ConfigResolver la fournirait. */
export function scenarioConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    parties: { platformId: partyId('PLT'), operatorId: partyId('OPE'), organizerId: partyId('ORG') },
    taxBps: bps('Taxe sur commissions et frais (TVA)'),
    commissions: {
      FOOD: { rateBps: bps('Commission Food truck') },
      TEE: { rateBps: bps('Commission Tee-shirts') },
      BAR: { rateBps: bps("Commission Bar de l'organisateur") },
    },
    pspFees: {
      WAVE: { rateBps: bps('Frais PSP Wave') },
      OM: { rateBps: bps('Frais PSP Orange Money') },
      CARTE: { rateBps: bps('Frais PSP carte bancaire') },
    },
    pspFeeBearer: scenario.parameters['Payeur des frais PSP'] as ResolvedConfig['pspFeeBearer'],
    activationFee: { fixed: amountParameter("Frais d'activation par bracelet (festivalier)") },
    refundFee: { fixed: amountParameter('Frais de remboursement du solde') },
    operatorFees: [
      { basis: 'TOPUP_AMOUNT', rule: { rateBps: bps('Frais prestataire : % des recharges payées') } },
      { basis: 'PER_MEDIA', rule: { fixed: amountParameter('Frais prestataire : par bracelet activé') } },
    ],
    platformFee: { rateBps: bps('Redevance plateforme : % des frais du prestataire') },
    breakageOrganizerBps: bps("Part de la casse revenant à l'organisateur"),
    pitchFees: {
      FOOD: amountParameter('Droit de place Food truck'),
      TEE: amountParameter('Droit de place Tee-shirts'),
    },
    spendOrder: 'PROMO_FIRST',
    chargebackBearer: 'ORGANIZER',
    cashDiffBearer: 'ORGANIZER',
    offlineLossBearer: 'ORGANIZER',
    breakageDestination: 'ORGANIZER',
    ...overrides,
  };
}

// ------------------------------------------------------------------ résolution des comptes

/**
 * Résolveur de test : référence → code du scénario. Portefeuilles et commerçants par convention de code
 * (`L-WAL-<id>-P|X`, `L-MCH-<participation>`), les autres par fonction et titulaire.
 */
export function resolve(ref: AccountRef): string {
  if ('code' in ref) return ref.code;
  if (ref.walletId) return `L-WAL-${ref.walletId}-${ref.purpose === 'WALLET_PAID' ? 'P' : ref.purpose === 'WALLET_PROMO' ? 'X' : ref.purpose}`;
  if (ref.participationId) return `L-MCH-${ref.participationId}`;
  const owner = ref.ownerPartyId
    ? Object.entries(scenario.parties).find(([, party]) => party.id === ref.ownerPartyId)?.[0]
    : null;
  const candidates = scenario.accounts.filter((a) => a.purpose === ref.purpose && a.owner === (owner ?? null));
  if (candidates.length !== 1) throw new Error(`compte introuvable ou ambigu : ${JSON.stringify(ref)}`);
  return candidates[0]!.code;
}

export function coded(lines: Line[]): CodedLine[] {
  return lines.map((line) => ({ account: resolve(line.account), amount: line.amount }));
}

/** Commande du scénario n° `no` (type, source, clé, date) avec le payload donné. */
export function command<T extends TransactionType, P>(
  no: number,
  payload: P,
  extra: Partial<LedgerCommand<T, P>> = {},
): LedgerCommand<T, P> {
  const tx = transaction(no);
  return {
    type: tx.type as T,
    idempotencyKey: tx.idempotency_key,
    occurredAt: new Date(tx.occurred_at),
    source: tx.source,
    ledgerId: LEDGER_ID,
    currency: 'XOF',
    payload,
    ...extra,
  };
}
