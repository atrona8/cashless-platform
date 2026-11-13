// Session B6 / NFR-010 : un colis de mots de passe déposé au central APRÈS la première copie du
// flux de réplication est revu par une passerelle déjà en marche, sans relecture complète.
// Cause corrigée (migration 0071) : `deposit_edge_pwd_pack` n'émettait aucun changement de
// référence, donc la page de réplication ne rendait plus le bracelet dans la fenêtre du curseur.
import 'reflect-metadata';
import { awaitLocalPacks, depositPacks, seedFreshMedia } from '../support/pack-delivery';
import { activateEdge } from '../support/load-support';
import { TwoProcessBench, until } from '../support/two-process-bench';

let bench: TwoProcessBench;
afterAll(async () => bench?.close());

describe('colis déposé après le démarrage de la passerelle', () => {
  it('la passerelle en marche reçoit le colis scellé par le flux', async () => {
    bench = await TwoProcessBench.start();
    // Première copie faite : la passerelle est en marche et son curseur a avancé.
    await activateEdge(bench);
    const before = await bench.localQuery<{ c: string }>(
      'SELECT last_change_seq::text AS c FROM edge_replication_cursor',
    );
    expect(Number(before[0]!.c)).toBeGreaterThan(0);
    const fresh = await seedFreshMedia(bench, 2);
    const mediaIds = fresh.map((m) => m.id);
    // La passerelle a déjà copié les bracelets (sans colis) : le dépôt vient bien APRÈS leur copie.
    await until(
      'bracelets copiés sans colis',
      async () =>
        Number(
          (
            await bench.localQuery<{ n: string }>(
              'SELECT count(*)::text AS n FROM edge_media WHERE media_id = ANY($1::uuid[])',
              [mediaIds],
            )
          )[0]!.n,
        ) === mediaIds.length,
      60_000,
      200,
    );
    expect(await depositPacks(bench)).toBeGreaterThanOrEqual(1);
    await awaitLocalPacks(bench, mediaIds);
    const cursor = await bench.localQuery<{ c: string }>(
      'SELECT last_change_seq::text AS c FROM edge_replication_cursor',
    );
    expect(Number(cursor[0]!.c)).toBeGreaterThan(Number(before[0]!.c));
  }, 600_000);
});
