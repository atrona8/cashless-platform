import { extractTax, fee, groupForTax, InsufficientFundsError, roundDiv, spendSplit, splitShare } from '../../../src/ledger/money';

describe('roundDiv', () => {
  it.each([
    [1005n * 1000n, 10_000n, 101n],
    [-1005n * 1000n, 10_000n, -101n],
    [0n, 7n, 0n],
    [1n, 3n, 0n],
    [2n, 3n, 1n],
    [-2n, 3n, -1n],
    [-1n, 3n, 0n],
    [1n, 2n, 1n],
    [-1n, 2n, -1n],
  ])('%p / %p → %p', (num, den, expected) => {
    expect(roundDiv(num, den)).toBe(expected);
  });

  it('refuse un dénominateur nul ou négatif', () => {
    expect(() => roundDiv(1n, 0n)).toThrow(RangeError);
    expect(() => roundDiv(1n, -2n)).toThrow(RangeError);
  });
});

describe('fee', () => {
  it('ajoute le fixe après arrondi du taux', () => {
    expect(fee(1005n, { rateBps: 1000n, fixed: 50n })).toBe(151n);
  });

  it('applique le minimum puis le maximum', () => {
    // Bornes incohérentes (min > max) : le maximum, appliqué en dernier, l'emporte comme dans la référence.
    expect(fee(1000n, { rateBps: 300n, min: 100n, max: 80n })).toBe(80n);
  });

  it('sans règle : zéro', () => {
    expect(fee(1000n)).toBe(0n);
  });
});

describe('extractTax / groupForTax', () => {
  it('HT + taxe = TTC', () => {
    for (const ttc of [1n, 99n, 720n, 5085n, 123_457n]) {
      const { ht, tax } = extractTax(ttc, 1800n);
      expect(ht + tax).toBe(ttc);
    }
  });

  it("regroupe par bénéficiaire et taux, dans l'ordre de première apparition", () => {
    const groups = groupForTax([
      { beneficiary: 'ORG', taxBps: 1800n, ttc: 15_000n },
      { beneficiary: 'OPE', taxBps: 1800n, ttc: 1_000n },
      { beneficiary: 'ORG', taxBps: 1800n, ttc: 10_000n },
      { beneficiary: 'ORG', taxBps: 0n, ttc: 500n },
    ]);
    expect(groups).toEqual([
      { beneficiary: 'ORG', taxBps: 1800n, ttc: 25_000n, ht: 21_186n, tax: 3_814n },
      { beneficiary: 'OPE', taxBps: 1800n, ttc: 1_000n, ht: 847n, tax: 153n },
      { beneficiary: 'ORG', taxBps: 0n, ttc: 500n, ht: 500n, tax: 0n },
    ]);
  });

  it('ne modifie pas les éléments reçus', () => {
    const items = [
      { beneficiary: 'ORG', taxBps: 1800n, ttc: 1n },
      { beneficiary: 'ORG', taxBps: 1800n, ttc: 2n },
    ];
    groupForTax(items);
    expect(items[0]?.ttc).toBe(1n);
  });
});

describe('splitShare', () => {
  it('la seconde part reçoit le reste', () => {
    expect(splitShare(1001n, 5000n)).toEqual([501n, 500n]);
  });
});

describe('spendSplit', () => {
  it("en ligne, payés d'abord", () => {
    expect(spendSplit({ amount: 1000n, promoBalance: 400n, paidBalance: 700n, promoFirst: false, mode: 'ONLINE' })).toEqual({
      fromPromo: 300n,
      fromPaid: 700n,
      uncovered: 0n,
    });
  });

  it('en ligne, solde insuffisant', () => {
    const run = () => spendSplit({ amount: 10n, promoBalance: 3n, paidBalance: 6n, promoFirst: true, mode: 'ONLINE' });
    expect(run).toThrow(InsufficientFundsError);
    expect(run).toThrow(expect.objectContaining({ code: 'INSUFFICIENT_FUNDS' }));
  });

  it('hors ligne, solde payé négatif ignoré pour la couverture', () => {
    expect(spendSplit({ amount: 500n, promoBalance: 200n, paidBalance: -100n, promoFirst: true, mode: 'OFFLINE' })).toEqual({
      fromPromo: 200n,
      fromPaid: 0n,
      uncovered: 300n,
    });
  });

  it("hors ligne, payés d'abord", () => {
    expect(spendSplit({ amount: 9000n, promoBalance: 2000n, paidBalance: 5000n, promoFirst: false, mode: 'OFFLINE' })).toEqual({
      fromPromo: 2000n,
      fromPaid: 5000n,
      uncovered: 2000n,
    });
  });
});
