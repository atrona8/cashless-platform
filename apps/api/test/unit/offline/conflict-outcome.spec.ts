import { conflictOutcome, type ConflictInput } from '../../../src/offline/rules/conflict-outcome';

const GEN = new Date('2026-10-30T10:00:00Z');
const OCC = new Date('2026-10-30T11:00:00Z');
const TOL = 120_000;
const base: ConflictInput = {
  tapResult: 'OK',
  amount: 9000n,
  spendable: 6000n,
  walletStatus: 'ACTIVE',
  blockTime: null,
  occurredAt: OCC,
  snapshotGeneratedAt: GEN,
  tolMs: TOL,
};
const w = (covered: bigint, shortfall: bigint, shortfallReason?: string) =>
  shortfallReason === undefined
    ? { kind: 'WRITE', covered, shortfall }
    : { kind: 'WRITE', covered, shortfall, shortfallReason };
const blockedAt = (deltaMs: number): Partial<ConflictInput> => ({
  tapResult: 'BLOCKED',
  blockTime: new Date(OCC.getTime() + deltaMs),
});

describe('conflictOutcome : table du protocole §7.3', () => {
  it.each<[string, Partial<ConflictInput>, unknown]>([
    ['1 OK, solde >= montant', { spendable: 9000n }, w(9000n, 0n)],
    ['2 OK, solde < montant', {}, w(6000n, 3000n, 'INSUFFICIENT_FUNDS')],
    [
      '3 bloqué, occurred < blocage + tol, solde suffisant',
      { ...blockedAt(0), spendable: 9000n },
      w(9000n, 0n),
    ],
    [
      '3b bloqué, occurred < blocage + tol, solde court',
      blockedAt(0),
      w(6000n, 3000n, 'INSUFFICIENT_FUNDS'),
    ],
    [
      '4 bloqué après, snapshot antérieur',
      blockedAt(-TOL - 1_000),
      w(0n, 9000n, 'MEDIA_BLOCKED_AFTER_SNAPSHOT'),
    ],
    ['5 CLONE_SUSPECTED', { tapResult: 'CLONE_SUSPECTED' }, w(0n, 9000n, 'MEDIA_CLONE_SUSPECTED')],
    ['6 UID_MISMATCH', { tapResult: 'UID_MISMATCH' }, w(0n, 9000n, 'MEDIA_UID_MISMATCH')],
    [
      '7 SIGNATURE_MISMATCH',
      { tapResult: 'SIGNATURE_MISMATCH' },
      w(0n, 9000n, 'MEDIA_SIGNATURE_MISMATCH'),
    ],
    [
      '8 signature absente : inchangé',
      { tapResult: 'SIGNATURE_MISSING' },
      w(6000n, 3000n, 'INSUFFICIENT_FUNDS'),
    ],
    ['9a portefeuille BLOCKED', { walletStatus: 'BLOCKED' }, w(0n, 9000n, 'WALLET_BLOCKED')],
    ['9b portefeuille CLOSED', { walletStatus: 'CLOSED' }, w(0n, 9000n, 'WALLET_BLOCKED')],
    ['10a UNKNOWN', { tapResult: 'UNKNOWN' }, { kind: 'REJECT', reason: 'MEDIA_NOT_IN_SNAPSHOT' }],
    [
      '10b NOT_ACTIVATED',
      { tapResult: 'NOT_ACTIVATED' },
      { kind: 'REJECT', reason: 'MEDIA_NOT_IN_SNAPSHOT' },
    ],
    [
      '11 WRONG_EVENT',
      { tapResult: 'WRONG_EVENT' },
      { kind: 'REJECT', reason: 'MEDIA_WRONG_EVENT' },
    ],
  ])('%s', (_n, over, expected) => {
    expect(conflictOutcome({ ...base, ...over })).toEqual(expected);
  });

  it('rejet du média avant le portefeuille bloqué', () => {
    const r = conflictOutcome({ ...base, tapResult: 'UNKNOWN', walletStatus: 'BLOCKED' });
    expect(r).toEqual({ kind: 'REJECT', reason: 'MEDIA_NOT_IN_SNAPSHOT' });
  });

  it('portefeuille bloqué avant blocage du bracelet', () => {
    const r = conflictOutcome({ ...base, ...blockedAt(0), walletStatus: 'BLOCKED' });
    expect(r).toEqual(w(0n, 9000n, 'WALLET_BLOCKED'));
  });

  describe('bornes de blockTime (occurredAt < blockTime + tol)', () => {
    it.each([
      ['blockTime = occurredAt - tol : manque entier', -TOL, false],
      ['blockTime = occurredAt - tol + 1 ms : couvert', -TOL + 1, true],
      ['blockTime = occurredAt - tol - 1 ms : manque entier', -TOL - 1, false],
      ['blockTime = occurredAt : couvert', 0, true],
      ['blockTime = occurredAt + tol : couvert', TOL, true],
    ])('%s', (_n, delta, covered) => {
      const r = conflictOutcome({ ...base, ...blockedAt(delta), spendable: 9000n });
      expect(r).toEqual(covered ? w(9000n, 0n) : w(0n, 9000n, 'MEDIA_BLOCKED_AFTER_SNAPSHOT'));
    });
  });

  it.each([
    ['blockTime UNKNOWN', 'UNKNOWN' as const],
    ['blockTime null', null],
  ])('BLOCKED avec %s : manque entier', (_n, blockTime) => {
    const r = conflictOutcome({ ...base, tapResult: 'BLOCKED', blockTime, spendable: 9000n });
    expect(r).toEqual(w(0n, 9000n, 'MEDIA_BLOCKED_AFTER_SNAPSHOT'));
  });

  it('hypothèse (b) : blocage daté avant ou à la génération du snapshot : manque entier', () => {
    for (const blockTime of [GEN, new Date(GEN.getTime() - 1)]) {
      const r = conflictOutcome({ ...base, tapResult: 'BLOCKED', blockTime, spendable: 9000n });
      expect(r).toEqual(w(0n, 9000n, 'MEDIA_BLOCKED_AFTER_SNAPSHOT'));
    }
  });

  it.each(['RETIRED', 'REPLACED', 'RELEASED', 'BATCH_INACTIVE'] as const)(
    'hypothèse (a) : %s traité comme blocage inconnu, même avec une date favorable',
    (tapResult) => {
      const r = conflictOutcome({
        ...base,
        tapResult,
        blockTime: new Date(OCC.getTime() + TOL),
        spendable: 9000n,
      });
      expect(r).toEqual(w(0n, 9000n, 'MEDIA_BLOCKED_AFTER_SNAPSHOT'));
    },
  );

  it('montant nul : aucun manque, aucune raison', () => {
    expect(conflictOutcome({ ...base, amount: 0n, tapResult: 'CLONE_SUSPECTED' })).toEqual(
      w(0n, 0n),
    );
  });

  it('montant négatif : Error', () => {
    expect(() => conflictOutcome({ ...base, amount: -1n })).toThrow();
  });

  it('invariants sur une grille (covered + shortfall = amount, bornes, raison)', () => {
    const amounts = [0n, 1n, 999n, 9000n, 10n ** 18n];
    const spendables = [0n, 1n, 999n, 9000n, 10n ** 18n, 10n ** 30n];
    const results = [
      'OK',
      'BLOCKED',
      'UNKNOWN',
      'NOT_ACTIVATED',
      'WRONG_EVENT',
      'CLONE_SUSPECTED',
      'UID_MISMATCH',
      'SIGNATURE_MISMATCH',
      'SIGNATURE_MISSING',
      'RETIRED',
      'REPLACED',
      'RELEASED',
      'BATCH_INACTIVE',
    ] as const;
    const blocks = [
      null,
      'UNKNOWN' as const,
      new Date(OCC.getTime() + 1),
      new Date(OCC.getTime() - 1e7),
    ];
    let n = 0;
    for (const amount of amounts)
      for (const spendable of spendables)
        for (const tapResult of results)
          for (const blockTime of blocks)
            for (const walletStatus of ['ACTIVE', 'BLOCKED']) {
              const r = conflictOutcome({
                ...base,
                amount,
                spendable,
                tapResult,
                blockTime,
                walletStatus,
              });
              n += 1;
              if (r.kind === 'REJECT') continue;
              expect(r.covered + r.shortfall).toBe(amount);
              expect(r.covered >= 0n).toBe(true);
              expect(r.covered <= spendable).toBe(true);
              expect(r.shortfall >= 0n).toBe(true);
              if (r.shortfall === 0n) expect(r.shortfallReason).toBeUndefined();
              else expect(r.shortfallReason).toBeDefined();
            }
    expect(n).toBeGreaterThan(1000);
  });
});
