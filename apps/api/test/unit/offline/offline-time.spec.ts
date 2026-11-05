import { detectInversions, resolveOfflineTime } from '../../../src/offline/rules/offline-time';

const REC = new Date('2026-10-30T12:00:00.000Z');
const GEN = new Date('2026-10-30T10:00:00.000Z');
const TOL = 120_000;
const at = (base: Date, deltaMs: number): string =>
  new Date(base.getTime() + deltaMs).toISOString();

describe('resolveOfflineTime', () => {
  it.each([
    ['-100 s accepté', at(REC, -100_000), 'NONE', at(REC, -100_000)],
    ['+100 s accepté', at(REC, 100_000), 'NONE', at(REC, 100_000)],
    ['exactement +tol reste NONE', at(REC, TOL), 'NONE', at(REC, TOL)],
    ['+tol+1 ms : ramené à la réception', at(REC, TOL + 1), 'FUTURE', REC.toISOString()],
    ['+2 h : ramené à la réception', at(REC, 7_200_000), 'FUTURE', REC.toISOString()],
    ['-2 h : ramené au snapshot', at(GEN, -7_200_000), 'BEFORE_SNAPSHOT', GEN.toISOString()],
    ['exactement generated-tol reste NONE', at(GEN, -TOL), 'NONE', at(GEN, -TOL)],
    ['generated-tol-1 ms : ramené', at(GEN, -TOL - 1), 'BEFORE_SNAPSHOT', GEN.toISOString()],
  ])('%s', (_n, occurred, skew, corrected) => {
    const r = resolveOfflineTime(occurred, REC, GEN, TOL);
    expect(r.skew).toBe(skew);
    expect(r.corrected.toISOString()).toBe(corrected);
  });

  it('snapshot inconnu : seul le futur s’applique', () => {
    expect(resolveOfflineTime(at(GEN, -7_200_000), REC, null, TOL).skew).toBe('NONE');
    expect(resolveOfflineTime(at(REC, 7_200_000), REC, null, TOL).skew).toBe('FUTURE');
  });

  it('snapshot postérieur à la réception : le futur gagne', () => {
    const later = new Date(REC.getTime() + 3_600_000);
    const r = resolveOfflineTime(at(REC, 3_600_000), REC, later, TOL);
    expect(r.skew).toBe('FUTURE');
  });

  it('accepte un fuseau non UTC', () => {
    const r = resolveOfflineTime('2026-10-30T14:00:00+02:00', REC, GEN, TOL);
    expect(r.corrected.toISOString()).toBe('2026-10-30T12:00:00.000Z');
  });

  it.each(['pas une date', '2026-10-30T12:00:00', '2026-13-45T00:00:00Z', ''])(
    'date invalide %p : Error',
    (bad) => {
      expect(() => resolveOfflineTime(bad, REC, GEN, TOL)).toThrow();
    },
  );
});

describe('detectInversions', () => {
  const op = (seq: bigint, deltaMs: number) => ({
    seq,
    occurredAt: new Date(REC.getTime() + deltaMs),
  });

  it.each([
    ['croissant', [op(1n, 0), op(2n, 10_000)], []],
    ['inversion de 119 s non signalée', [op(1n, 0), op(2n, -119_000)], []],
    ['inversion de 120 s exacte non signalée', [op(1n, 0), op(2n, -TOL)], []],
    ['inversion de 121 s signalée', [op(1n, 0), op(2n, -121_000)], [2n]],
    ['max glissant, pas la voisine', [op(1n, 0), op(2n, -100_000), op(3n, -200_000)], [3n]],
    ['plusieurs signalés', [op(1n, 0), op(2n, -300_000), op(3n, -400_000)], [2n, 3n]],
    ['vide', [], []],
  ])('%s', (_n, ops, expected) => {
    expect(detectInversions(ops, TOL)).toEqual(expected);
  });
});
