// Constructeurs de clôture et de back-office comparés ligne à ligne au scénario de référence.
import {
  buildAdjustment,
  buildAnomalyResolution,
  buildBreakage,
  buildBreakageReversal,
  buildCashClose,
  buildCashDeposit,
  buildMerchantDebtTransfer,
  buildOperatorFee,
  buildPayoutConfirmed,
  buildPayoutFailed,
  buildPayoutInitiated,
  buildPitchFee,
  buildPlatformFee,
  buildPspSettlement,
} from '../../../../src/ledger/builders/closing';
import { BuildError, type BuildContext, type Line } from '../../../../src/ledger/types';
import { coded, command, expectedLines, scenarioConfig } from '../support/scenario-lines';

const config = scenarioConfig();
const ctx: BuildContext = { config };
const TWO_PEOPLE = { createdBy: 'user-a', approvedBy: 'user-b' };

function expectBalanced(lines: Line[]): void {
  expect(lines.length).toBeGreaterThanOrEqual(2);
  expect(lines.reduce((sum, line) => sum + line.amount, 0n)).toBe(0n);
  expect(lines.every((line) => line.amount !== 0n)).toBe(true);
}

const confirmed = (no: number, amount: bigint) => () =>
  buildPayoutConfirmed(command(no, { amount, moneyAccount: 'A-BANQUE' }), ctx);

const CASES: [no: number, build: () => Line[]][] = [
  [24, () => buildCashClose(command(24, { cashDesk: 'C1', counted: 36_800n, expected: 37_000n }, TWO_PEOPLE), ctx)],
  [25, () => buildAnomalyResolution(command(25, { amount: 3000n }, TWO_PEOPLE), ctx)],
  [26, () => buildCashDeposit(command(26, { amount: 36_800n }), ctx)],
  [27, () => buildPspSettlement(command(27, { channel: 'WAVE', net: 19_800n }), ctx)],
  [28, () => buildPspSettlement(command(28, { channel: 'OM', net: 14_775n }), ctx)],
  [29, () => buildPspSettlement(command(29, { channel: 'CARTE', net: 29_250n }), ctx)],
  [
    30,
    () =>
      buildPitchFee(
        command(30, {
          items: [
            { participationId: 'FOOD', mode: 'DEDUCT_OR_DEBT' },
            { participationId: 'TEE', mode: 'DEDUCT_OR_DEBT' },
            { participationId: 'BAR', mode: 'PREPAID' },
          ],
        }),
        ctx,
      ),
  ],
  [31, () => buildOperatorFee(command(31, { bases: { TOPUP_AMOUNT: 100_000n, PER_MEDIA: 6n } }), ctx)],
  [32, () => buildPlatformFee(command(32, { operatorFeeHt: 5085n }), ctx)],
  [
    33,
    () =>
      buildPayoutInitiated(
        command(33, {
          payouts: [
            { beneficiary: { participationId: 'FOOD' }, amount: 11_400n },
            { beneficiary: { participationId: 'TEE' }, amount: 8000n },
            { beneficiary: { participationId: 'BAR' }, amount: 18_500n },
            { beneficiary: 'OPERATOR', amount: 4983n },
            { beneficiary: 'PLATFORM', amount: 1017n },
          ],
        }),
        ctx,
      ),
  ],
  [34, confirmed(34, 11_400n)],
  [35, () => buildPayoutFailed(command(35, { amount: 8000n, beneficiary: { participationId: 'TEE' } }), ctx)],
  [36, confirmed(36, 18_500n)],
  [37, confirmed(37, 4983n)],
  [38, confirmed(38, 1017n)],
  [39, () => buildPayoutInitiated(command(39, { payouts: [{ beneficiary: { participationId: 'TEE' }, amount: 8000n }] }, TWO_PEOPLE), ctx)],
  [40, confirmed(40, 8000n)],
  [
    43,
    () =>
      buildBreakage(
        command(43, {
          wallets: [
            { walletId: 'W01', paid: 9000n },
            { walletId: 'W05', paid: 11_000n },
          ],
        }),
        ctx,
      ),
  ],
  [
    46,
    () =>
      buildPayoutInitiated(
        command(46, {
          payouts: [
            { beneficiary: 'ORGANIZER', amount: 39_225n },
            { beneficiary: 'OPERATOR', amount: 4000n },
          ],
        }),
        ctx,
      ),
  ],
  [47, confirmed(47, 39_225n)],
  [48, confirmed(48, 4000n)],
];

describe('constructeurs « clôture et back-office » — scénario de référence', () => {
  it.each(CASES)('T%i : lignes identiques au scénario', (no, build) => {
    const lines = build();
    expectBalanced(lines);
    expect(coded(lines)).toEqual(expectedLines(no));
  });
});

describe('cas dédiés', () => {
  const org = (purpose: string) => ({ purpose, ownerPartyId: config.parties.organizerId });
  const ope = (purpose: string) => ({ purpose, ownerPartyId: config.parties.operatorId });

  it('MERCHANT_DEBT_TRANSFER : dette reprise par l’organisateur', () => {
    const lines = buildMerchantDebtTransfer(command(30, { participationId: 'TEE', merchantBalance: -2500n }, { type: 'MERCHANT_DEBT_TRANSFER' }), ctx);
    expectBalanced(lines);
    expect(lines).toEqual([
      { account: org('ORG_RECEIVABLE'), amount: 2500n },
      { account: { purpose: 'MERCHANT', participationId: 'TEE' }, amount: -2500n },
    ]);
    expect(() =>
      buildMerchantDebtTransfer(command(30, { participationId: 'TEE', merchantBalance: 100n }, { type: 'MERCHANT_DEBT_TRANSFER' }), ctx),
    ).toThrow(BuildError);
  });

  it('PITCH_FEE plafonné au solde du commerçant ; aucune retenue : refus', () => {
    const lines = buildPitchFee(command(30, { items: [{ participationId: 'FOOD', mode: 'DEDUCT_CAPPED', merchantBalance: 4000n }] }), ctx);
    expectBalanced(lines);
    expect(lines[0]).toEqual({ account: { purpose: 'MERCHANT', participationId: 'FOOD' }, amount: 4000n });
    expect(() => buildPitchFee(command(30, { items: [{ participationId: 'FOOD', mode: 'PREPAID' }] }), ctx)).toThrow(BuildError);
  });

  describe('ADJUSTMENT', () => {
    const adjustment = (lines: Line[], extra: object = {}) =>
      buildAdjustment(command(25, { lines }, { type: 'ADJUSTMENT', metadata: { reason: 'correction' }, ...TWO_PEOPLE, ...extra }), ctx);
    const ok: Line[] = [
      { account: { code: 'A-BANQUE' }, amount: 500n },
      { account: org('ORG_PERTES'), amount: -500n },
    ];

    it('lignes fournies acceptées si équilibrées', () => {
      expect(adjustment(ok)).toEqual(ok);
    });
    it('déséquilibrée : refus', () => {
      expect(() => adjustment([ok[0]!, { ...ok[1]!, amount: -400n }])).toThrow(BuildError);
    });
    it('ligne nulle : refus', () => {
      expect(() => adjustment([...ok, { account: { code: 'A-TRANSIT' }, amount: 0n }])).toThrow(BuildError);
    });
    it('auteur = valideur : refus', () => {
      expect(() => adjustment(ok, { approvedBy: 'user-a' })).toThrow(BuildError);
    });
    it('motif absent : refus', () => {
      expect(() => adjustment(ok, { metadata: {} })).toThrow(BuildError);
    });
    it('hors BACKOFFICE : refus', () => {
      expect(() => adjustment(ok, { source: 'BATCH' })).toThrow(BuildError);
    });
  });

  it('ANOMALY_RESOLUTION hors BACKOFFICE ou sans seconde personne : refus', () => {
    expect(() => buildAnomalyResolution(command(25, { amount: 3000n }, { ...TWO_PEOPLE, source: 'BATCH' }), ctx)).toThrow(BuildError);
    expect(() => buildAnomalyResolution(command(25, { amount: 3000n }), ctx)).toThrow(BuildError);
  });

  it('BREAKAGE_REVERSAL : prorata de la casse initiale (± 1)', () => {
    const lines = buildBreakageReversal(
      command(43, { walletId: 'W01', amount: 1001n, originalShares: { organizer: 16_000n, operator: 4000n } }, {
        type: 'BREAKAGE_REVERSAL',
        source: 'BACKOFFICE',
        ...TWO_PEOPLE,
      }),
      ctx,
    );
    expectBalanced(lines);
    expect(lines).toEqual([
      { account: org('ORG_CASSE'), amount: 801n },
      { account: ope('OPE_CASSE'), amount: 200n },
      { account: { purpose: 'WALLET_PAID', walletId: 'W01' }, amount: -1001n },
    ]);
  });

  it('BREAKAGE vers le compte légal', () => {
    const lines = buildBreakage(command(43, { wallets: [{ walletId: 'W01', paid: 9000n, cashDue: 500n }] }), {
      config: scenarioConfig({ breakageDestination: 'LEGAL_ACCOUNT' }),
    });
    expectBalanced(lines);
    expect(lines.at(-1)).toEqual({ account: { purpose: 'LEGAL_BREAKAGE' }, amount: -9500n });
  });

  it('CASH_CLOSE avec surplus : crédit du compte de pertes', () => {
    const lines = buildCashClose(command(24, { cashDesk: 'C1', counted: 37_300n, expected: 37_000n }), ctx);
    expectBalanced(lines);
    expect(coded(lines)).toEqual([
      { account: 'A-TRANSIT', amount: 37_300n },
      { account: 'L-ORG-PERTES', amount: -300n },
      { account: 'A-CAISSE-C1', amount: -37_000n },
    ]);
  });

  it('OPERATOR_FEE en régularisation : sens inverse', () => {
    const lines = buildOperatorFee(command(31, { bases: { TOPUP_AMOUNT: 100_000n, PER_MEDIA: 6n }, regularization: true }), ctx);
    expectBalanced(lines);
    expect(coded(lines)).toEqual(expectedLines(31).map((line) => ({ ...line, amount: -line.amount })));
  });
});
