// OP-N98 / ADR-151 : borne de la dette « autre changement visible en 60 s » (NFR-005). Le délai avant un DELTA
// ordinaire reste celui du porteur (R-30.5) : 60 s. Ce test échoue si on l'allonge, ce qui élargirait l'écart.
import { DELTA_AFTER_MS } from '../../../src/snapshots-content/snapshot-cadence';

describe('OP-N98 : délai avant un DELTA ordinaire', () => {
  it('ne dépasse pas 60 000 ms (NFR-005, autres changements)', () => {
    expect(DELTA_AFTER_MS).toBeLessThanOrEqual(60_000);
  });
});
