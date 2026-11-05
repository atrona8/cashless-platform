// Délai de jet des brouillons non signés (SNAPSHOT_ORPHAN_DISCARD_SECONDS) : strictement au-delà de
// l'alarme de 5 min du signataire.
import { loadConfig } from '../../../src/config/config';

const LOCAL = { NODE_ENV: 'test' };

describe('SNAPSHOT_ORPHAN_DISCARD_SECONDS', () => {
  it('10 min par défaut', () => {
    expect(loadConfig(LOCAL).snapshotOrphanDiscardSeconds).toBe(600);
  });
  it('301 s accepté, configurable', () => {
    expect(
      loadConfig({ ...LOCAL, SNAPSHOT_ORPHAN_DISCARD_SECONDS: '301' }).snapshotOrphanDiscardSeconds,
    ).toBe(301);
  });
  it.each(['300', '60', '0', '-5', 'abc'])('refus au démarrage pour %s', (value) => {
    expect(() => loadConfig({ ...LOCAL, SNAPSHOT_ORPHAN_DISCARD_SECONDS: value })).toThrow(
      /SNAPSHOT_ORPHAN_DISCARD_SECONDS/,
    );
  });
});
