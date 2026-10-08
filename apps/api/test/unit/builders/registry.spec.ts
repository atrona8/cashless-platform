// Registre : exactement les 26 types de la contrainte CHECK du schéma, chacun construit ou délégué (SC-004).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUILDERS, plan, type Plan } from '../../../src/ledger/builders/registry';
import { BuildError, TRANSACTION_TYPES, type LedgerCommand, type TransactionType } from '../../../src/ledger/types';
import { command, originalLines, scenarioConfig, walletBalancesBefore } from './support/scenario-lines';

const SCHEMA = join(__dirname, '../../../../../packages/ledger-sql/schema_grand_livre_cashless.sql');

function schemaTypes(): string[] {
  const text = readFileSync(SCHEMA, 'utf8');
  const check = /type\s+text NOT NULL CHECK \(type IN \(([^)]*)\)\)/.exec(text);
  if (!check?.[1]) throw new Error('contrainte CHECK de journal_transaction.type introuvable');
  return [...check[1].matchAll(/'([A-Z_]+)'/g)].map((match) => match[1]!);
}

const config = scenarioConfig();
const TWO_PEOPLE = { createdBy: 'user-a', approvedBy: 'user-b' };
const run = <P>(no: number, type: TransactionType, payload: P, extra: Partial<LedgerCommand<TransactionType, P>> = {}, balancesOf?: string): Plan =>
  plan(command(no, payload, { type, ...extra }) as LedgerCommand, {
    config,
    ...(balancesOf ? { balances: walletBalancesBefore(no, balancesOf) } : {}),
    original: originalLines(15),
  });

/** Un exemple par type : l'oubli d'un type est une erreur de compilation (Record exhaustif). */
const SAMPLES: Record<TransactionType, () => Plan> = {
  TOPUP: () => run(1, 'TOPUP', { walletId: 'W01', channel: 'WAVE', amount: 20_000n }),
  TOPUP_CASH: () => run(4, 'TOPUP_CASH', { walletId: 'W04', cashDesk: 'C1', amount: 10_000n }),
  PROMO_CREDIT: () => run(8, 'PROMO_CREDIT', { walletId: 'W06', amount: 6000n }, TWO_PEOPLE),
  PROMO_EXPIRY: () => run(45, 'PROMO_EXPIRY', { walletId: 'W06', amount: 1000n }),
  ACTIVATION_FEE: () => run(9, 'ACTIVATION_FEE', { walletIds: ['W01'] }),
  DEPOSIT_TAKEN: () => run(5, 'DEPOSIT_TAKEN', {}),
  DEPOSIT_REFUNDED: () => run(23, 'DEPOSIT_REFUNDED', {}),
  DEPOSIT_FORFEITED: () => run(44, 'DEPOSIT_FORFEITED', {}),
  PURCHASE: () => run(10, 'PURCHASE', { walletId: 'W01', participationId: 'FOOD', amount: 6000n }, {}, 'W01'),
  REVERSAL: () => run(16, 'REVERSAL', {}, { reversesId: 'tx-15' }),
  PITCH_FEE: () => run(30, 'PITCH_FEE', { items: [{ participationId: 'FOOD', mode: 'DEDUCT_OR_DEBT' }] }),
  OPERATOR_FEE: () => run(31, 'OPERATOR_FEE', { bases: { TOPUP_AMOUNT: 100_000n, PER_MEDIA: 6n } }),
  PLATFORM_FEE: () => run(32, 'PLATFORM_FEE', { operatorFeeHt: 5085n }),
  ANOMALY_RESOLUTION: () => run(25, 'ANOMALY_RESOLUTION', { amount: 3000n }, TWO_PEOPLE),
  CASH_CLOSE: () => run(24, 'CASH_CLOSE', { cashDesk: 'C1', counted: 36_800n, expected: 37_000n }, TWO_PEOPLE),
  CASH_DEPOSIT: () => run(26, 'CASH_DEPOSIT', { amount: 36_800n }),
  PSP_SETTLEMENT: () => run(27, 'PSP_SETTLEMENT', { channel: 'WAVE', net: 19_800n }),
  CHARGEBACK: () => run(3, 'CHARGEBACK', { walletId: 'W03', channel: 'CARTE', amount: 1000n }, {}, 'W03'),
  WALLET_REFUND: () => run(41, 'WALLET_REFUND', { walletId: 'W02', amount: 2000n, moneyAccount: 'A-BANQUE' }),
  BREAKAGE: () => run(43, 'BREAKAGE', { wallets: [{ walletId: 'W01', paid: 9000n }] }),
  PAYOUT_INITIATED: () => run(46, 'PAYOUT_INITIATED', { payouts: [{ beneficiary: 'ORGANIZER', amount: 100n }] }),
  PAYOUT_CONFIRMED: () => run(47, 'PAYOUT_CONFIRMED', { amount: 100n, moneyAccount: 'A-BANQUE' }),
  PAYOUT_FAILED: () => run(35, 'PAYOUT_FAILED', { amount: 100n, beneficiary: 'ORGANIZER' }),
  ADJUSTMENT: () =>
    run(
      25,
      'ADJUSTMENT',
      {
        lines: [
          { account: { code: 'A-BANQUE' }, amount: 1n },
          { account: { code: 'A-TRANSIT' }, amount: -1n },
        ],
      },
      { ...TWO_PEOPLE, metadata: { reason: 'test' } },
    ),
  MERCHANT_DEBT_TRANSFER: () => run(30, 'MERCHANT_DEBT_TRANSFER', { participationId: 'TEE', merchantBalance: -1n }),
  BREAKAGE_REVERSAL: () =>
    run(43, 'BREAKAGE_REVERSAL', { walletId: 'W01', amount: 10n, originalShares: { legal: 9000n } }, { source: 'BACKOFFICE', ...TWO_PEOPLE }),
};

const DELEGATED: Partial<Record<TransactionType, string>> = {
  DEPOSIT_TAKEN: 'take_deposit',
  DEPOSIT_REFUNDED: 'refund_deposit',
  DEPOSIT_FORFEITED: 'forfeit_deposit',
};

describe('registre des constructeurs', () => {
  it('clés = exactement les 26 types de la contrainte CHECK du schéma, dans le même ordre', () => {
    expect(schemaTypes()).toEqual([...TRANSACTION_TYPES]);
    expect(Object.keys(BUILDERS).sort()).toEqual([...TRANSACTION_TYPES].sort());
  });

  it.each([...TRANSACTION_TYPES])('%s : construit ou délégué', (type) => {
    const result = SAMPLES[type]();
    if (DELEGATED[type]) {
      expect(result).toEqual({ kind: 'delegated', fn: DELEGATED[type] });
    } else {
      expect(result.kind).toBe('lines');
      const lines = result.kind === 'lines' ? result.lines : [];
      expect(lines.length).toBeGreaterThanOrEqual(2);
      expect(lines.reduce((sum, line) => sum + line.amount, 0n)).toBe(0n);
    }
  });

  it('types mixtes : la variante choisit la fonction SQL', () => {
    expect(run(8, 'PROMO_CREDIT', { variant: 'PRELOAD' }, TWO_PEOPLE)).toEqual({ kind: 'delegated', fn: 'preload_media' });
    expect(run(41, 'WALLET_REFUND', { variant: 'CASH_DUE' })).toEqual({ kind: 'delegated', fn: 'refund_cash_due' });
  });

  it('toute commande BACKOFFICE exige deux personnes distinctes', () => {
    expect(() => run(26, 'CASH_DEPOSIT', { amount: 1n }, { source: 'BACKOFFICE', createdBy: 'u', approvedBy: 'u' })).toThrow(BuildError);
  });
});
