import { effectiveBalance } from '../src/effective-balance';

describe('effectiveBalance', () => {
  const central = { paid: 5000n, promo: 2000n };

  it('sans delta : le solde du central, copié', () => {
    const out = effectiveBalance(central, []);
    expect(out).toEqual(central);
    expect(out).not.toBe(central);
  });

  it('avec des deltas négatifs, composantes séparées', () => {
    expect(
      effectiveBalance(central, [
        { paid: -1000n, promo: 0n },
        { paid: 0n, promo: -500n },
        { paid: -250n, promo: -250n },
      ]),
    ).toEqual({ paid: 3750n, promo: 1250n });
  });

  it('sans perte de précision au-delà de 2^53', () => {
    const big = 2n ** 60n + 1n;
    expect(effectiveBalance({ paid: big, promo: big }, [{ paid: 1n, promo: -1n }])).toEqual({
      paid: big + 1n,
      promo: big - 1n,
    });
  });

  it('ne modifie pas ses entrées', () => {
    const deltas = [{ paid: 1n, promo: 2n }];
    effectiveBalance(central, deltas);
    expect(central).toEqual({ paid: 5000n, promo: 2000n });
    expect(deltas).toEqual([{ paid: 1n, promo: 2n }]);
  });
});
