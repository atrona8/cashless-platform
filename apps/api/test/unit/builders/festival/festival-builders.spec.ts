// Constructeurs « festival » comparés ligne à ligne au scénario de référence (comptes et montants, dans l'ordre).
import {
  buildActivationFee,
  buildChargeback,
  buildPromoCredit,
  buildPromoExpiry,
  buildPurchase,
  buildReversal,
  buildTopup,
  buildTopupCash,
  buildWalletRefund,
} from '../../../../src/ledger/builders/festival';
import { BuildError, TRANSACTION_TYPES, type BuildContext, type Line } from '../../../../src/ledger/types';
import {
  bps,
  coded,
  command,
  expectedLines,
  originalLines,
  scenarioConfig,
  walletBalancesBefore,
} from '../support/scenario-lines';

const config = scenarioConfig();
const ctx = (extra: Partial<BuildContext> = {}): BuildContext => ({ config, ...extra });

function expectBalanced(lines: Line[]): void {
  expect(lines.length).toBeGreaterThanOrEqual(2);
  expect(lines.reduce((sum, line) => sum + line.amount, 0n)).toBe(0n);
  expect(lines.every((line) => line.amount !== 0n)).toBe(true);
}

function purchase(no: number, walletId: string, participationId: string, amount: bigint): Line[] {
  return buildPurchase(command(no, { walletId, participationId, amount }), ctx({ balances: walletBalancesBefore(no, walletId) }));
}

const CASES: [no: number, build: () => Line[]][] = [
  [1, () => buildTopup(command(1, { walletId: 'W01', channel: 'WAVE', amount: 20_000n }), ctx())],
  [2, () => buildTopup(command(2, { walletId: 'W02', channel: 'OM', amount: 15_000n }), ctx())],
  [3, () => buildTopup(command(3, { walletId: 'W03', channel: 'CARTE', amount: 30_000n }), ctx())],
  [4, () => buildTopupCash(command(4, { walletId: 'W04', cashDesk: 'C1', amount: 10_000n }), ctx())],
  [6, () => buildTopupCash(command(6, { walletId: 'W05', cashDesk: 'C1', amount: 25_000n }), ctx())],
  [8, () => buildPromoCredit(command(8, { walletId: 'W06', amount: 6000n }), ctx())],
  [9, () => buildActivationFee(command(9, { walletIds: ['W01', 'W02', 'W03', 'W04', 'W05'] }), ctx())],
  [10, () => purchase(10, 'W01', 'FOOD', 6000n)],
  [11, () => purchase(11, 'W01', 'BAR', 4000n)],
  [12, () => purchase(12, 'W02', 'TEE', 12_000n)],
  [13, () => purchase(13, 'W03', 'FOOD', 9000n)],
  [14, () => purchase(14, 'W03', 'BAR', 7500n)],
  [15, () => purchase(15, 'W04', 'BAR', 6000n)],
  [16, () => buildReversal(command(16, {}, { reversesId: 'tx-15' }), ctx({ original: originalLines(15) }))],
  [17, () => purchase(17, 'W04', 'BAR', 3000n)],
  [18, () => purchase(18, 'W05', 'TEE', 8000n)],
  [19, () => purchase(19, 'W05', 'FOOD', 5000n)],
  [20, () => purchase(20, 'W06', 'BAR', 4000n)],
  [21, () => purchase(21, 'W06', 'FOOD', 1000n)],
  [22, () => purchase(22, 'W04', 'FOOD', 9000n)],
  [41, () => buildWalletRefund(command(41, { walletId: 'W02', amount: 2000n, moneyAccount: 'A-BANQUE' }), ctx())],
  [42, () => buildWalletRefund(command(42, { walletId: 'W03', amount: 12_500n, moneyAccount: 'A-BANQUE' }), ctx())],
  [45, () => buildPromoExpiry(command(45, { walletId: 'W06', amount: 1000n }), ctx())],
];

describe('constructeurs « festival » — scénario de référence', () => {
  it.each(CASES)('T%i : lignes identiques au scénario', (no, build) => {
    const lines = build();
    expectBalanced(lines);
    expect(coded(lines)).toEqual(expectedLines(no));
  });
});

describe('types du moteur', () => {
  it('26 types de transaction', () => {
    expect(TRANSACTION_TYPES).toHaveLength(26);
  });

  it('paramètres décimaux convertis depuis le texte', () => {
    expect(bps('Frais PSP Orange Money')).toBe(150n);
    expect(bps('Commission Food truck')).toBe(1200n);
    expect(bps("Part de la casse revenant à l'organisateur")).toBe(8000n);
  });
});

describe('cas limites', () => {
  it.each([0n, -100n])('montant %p refusé (VALIDATION_FAILED)', (amount) => {
    expect(() => buildTopup(command(1, { walletId: 'W01', channel: 'WAVE', amount }), ctx())).toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }),
    );
    expect(() => purchase(10, 'W01', 'FOOD', amount)).toThrow(BuildError);
  });

  it('portefeuille manquant refusé', () => {
    expect(() => buildPromoCredit(command(8, { walletId: '', amount: 10n }), ctx())).toThrow(BuildError);
  });

  it('vente en ligne au-delà du solde : INSUFFICIENT_FUNDS', () => {
    expect(() =>
      buildPurchase(command(10, { walletId: 'W01', participationId: 'FOOD', amount: 7000n }), ctx({ balances: { promo: 400n, paid: 5000n } })),
    ).toThrow(expect.objectContaining({ code: 'INSUFFICIENT_FUNDS' }));
  });

  it('commission nulle : aucune ligne de commission', () => {
    const lines = purchase(11, 'W01', 'BAR', 4000n);
    expect(coded(lines).map((l) => l.account)).toEqual(['L-WAL-W01-P', 'L-MCH-BAR']);
  });

  it('taxe nulle : aucune ligne de taxe', () => {
    const lines = buildPurchase(
      command(10, { walletId: 'W01', participationId: 'FOOD', amount: 6000n }),
      { config: scenarioConfig({ taxBps: 0n }), balances: { promo: 0n, paid: 6000n } },
    );
    expectBalanced(lines);
    expect(coded(lines)).toEqual([
      { account: 'L-WAL-W01-P', amount: 6000n },
      { account: 'L-MCH-FOOD', amount: -6000n },
      { account: 'L-MCH-FOOD', amount: 720n },
      { account: 'L-ORG-COM', amount: -720n },
    ]);
  });

  it('frais PSP payés par le festivalier : portefeuille crédité du net, frais HT + taxe', () => {
    const lines = buildTopup(
      command(1, { walletId: 'W01', channel: 'WAVE', amount: 20_000n }),
      { config: scenarioConfig({ pspFeeBearer: 'CUSTOMER' }) },
    );
    expectBalanced(lines);
    expect(coded(lines)).toEqual([
      { account: 'A-PSP-WAVE', amount: 20_000n },
      { account: 'L-WAL-W01-P', amount: -19_800n },
      { account: 'L-ORG-FFEST', amount: -169n },
      { account: 'L-ORG-TVA', amount: -31n },
    ]);
  });

  it('frais PSP payés par le prestataire', () => {
    const lines = buildTopup(
      command(1, { walletId: 'W01', channel: 'WAVE', amount: 20_000n }),
      { config: scenarioConfig({ pspFeeBearer: 'OPERATOR' }) },
    );
    expect(lines[2]).toEqual({ account: { purpose: 'OPE_FPSP', ownerPartyId: config.parties.operatorId }, amount: 200n });
  });

  it('recharge en espèces au-delà de la marge : le reste en espèces dues', () => {
    const lines = buildTopupCash(command(4, { walletId: 'W04', cashDesk: 'C1', amount: 10_000n, headroom: 3000n }), ctx());
    expectBalanced(lines);
    expect(lines).toEqual([
      { account: { code: 'A-CAISSE-C1' }, amount: 10_000n },
      { account: { purpose: 'WALLET_PAID', walletId: 'W04' }, amount: -3000n },
      { account: { purpose: 'CUSTOMER_CASH_DUE', walletId: 'W04' }, amount: -7000n },
    ]);
  });

  it('contre-passation sans reversesId ni lignes d’origine refusée', () => {
    expect(() => buildReversal(command(16, {}), ctx({ original: originalLines(15) }))).toThrow(BuildError);
    expect(() => buildReversal(command(16, {}, { reversesId: 'tx-15' }), ctx())).toThrow(BuildError);
  });

  it('remboursement inférieur aux frais refusé', () => {
    expect(() => buildWalletRefund(command(41, { walletId: 'W02', amount: 500n, moneyAccount: 'A-BANQUE' }), ctx())).toThrow(BuildError);
  });

  describe('CHARGEBACK', () => {
    const chargeback = (paid: bigint, bearer: 'ORGANIZER' | 'OPERATOR' = 'ORGANIZER') =>
      coded(
        buildChargeback(command(3, { walletId: 'W03', channel: 'CARTE', amount: 30_000n }, { type: 'CHARGEBACK' }), {
          config: scenarioConfig({ chargebackBearer: bearer }),
          balances: { promo: 0n, paid },
        }),
      );

    it('solde suffisant : tout sur le portefeuille', () => {
      expect(chargeback(40_000n)).toEqual([
        { account: 'L-WAL-W03-P', amount: 30_000n },
        { account: 'A-PSP-CARTE', amount: -30_000n },
      ]);
    });

    it('solde insuffisant : le reste aux pertes de l’organisateur', () => {
      expect(chargeback(12_000n)).toEqual([
        { account: 'L-WAL-W03-P', amount: 12_000n },
        { account: 'L-ORG-PERTES', amount: 18_000n },
        { account: 'A-PSP-CARTE', amount: -30_000n },
      ]);
    });

    it('solde nul : tout aux pertes de la partie désignée (prestataire)', () => {
      const lines = buildChargeback(command(3, { walletId: 'W03', channel: 'CARTE', amount: 30_000n }, { type: 'CHARGEBACK' }), {
        config: scenarioConfig({ chargebackBearer: 'OPERATOR' }),
        balances: { promo: 0n, paid: 0n },
      });
      expectBalanced(lines);
      expect(lines[0]).toEqual({ account: { purpose: 'OPE_PERTES', ownerPartyId: config.parties.operatorId }, amount: 30_000n });
    });
  });
});
