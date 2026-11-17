// NFR-001 : 50 exécutions simultanées de la même étape, clés d'en-tête différentes : une seule série d'écritures ;
// 50 rejeux de la même clé : une seule. Aucun 500.
import { createClosingWorld, type ClosingWorld } from './closing-world';

jest.setTimeout(300_000);

describe('exécutions concurrentes des étapes de clôture', () => {
  let w: ClosingWorld;
  beforeAll(async () => {
    w = await createClosingWorld();
    await w.toSettling();
  });
  afterAll(async () => w.close());

  it('NFR-001 : 50 exécutions de l’étape 1 avec 50 clés : une seule série, aucun 500', async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, () => w.post('/closing-steps/PITCH_FEES')),
    );
    expect(results.map((r) => r.status).filter((s) => s !== 200)).toEqual([]);
    expect(new Set(results.map((r) => JSON.stringify(r.body))).size).toBe(1);
    expect((await w.counts()).closing).toBe(1);
  });

  it('NFR-001 : 50 rejeux de la même clé sur l’étape 2 : une seule série, aucun 500', async () => {
    const key = '7a1c2b3d-4e5f-4a6b-8c7d-222222222222';
    const results = await Promise.all(
      Array.from({ length: 50 }, () => w.post('/closing-steps/OPERATOR_FEE', undefined, key)),
    );
    expect(results.filter((r) => r.status >= 500)).toEqual([]);
    // Les requêtes de même clé simultanées : soit la réponse, soit un refus propre (409 en cours), jamais une écriture double.
    expect(results.filter((r) => r.status === 200).length).toBeGreaterThan(0);
    expect((await w.counts()).closing).toBe(2);
  });
});
