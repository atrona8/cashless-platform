// Intégration : borne OP-N161 (mission durcissements-serveur, 11a). Le verrou consultatif du lot est
// pris AVANT le contrôle RLS : un prestataire qui connaît l'UUID d'un lot d'un autre peut
// retarder son PATCH, mais n'obtient aucune donnée et n'écrit rien. Les tests échouent si l'accès
// s'élargit (réponse autre que 404, donnée renvoyée, écriture, audit) ou si la clé du verrou
// perd son préfixe ou sa portée par lot.
import { withOwner } from '../../support/db';
import { client, createBatchWorld, KEY, rows, type BatchWorld } from './batch-fixtures';

describe('lots de bracelets : borne OP-N161', () => {
  let w: BatchWorld;
  let api: ReturnType<typeof client>;
  const A = () => `/v1/operators/${w.ops.a}/media-batches`;
  const B = () => `/v1/operators/${w.ops.b}/media-batches`;
  const create = async () => {
    const res = await api.post(w.orgAdmin, A(), {
      organizer_id: w.ids.a1,
      kind: 'PUBLIC',
      quantity: 50,
      key_index: KEY.shared,
    });
    expect(res.status).toBe(201);
    return (res.body as { batch_id: string }).batch_id;
  };
  const snapshot = async (id: string) => ({
    batch: await rows('SELECT * FROM media_batch WHERE id = $1', [id]),
    audit: await rows('SELECT count(*)::int AS n FROM audit_log WHERE object_id = $1', [id]),
    history: await rows(
      'SELECT count(*)::int AS n FROM media_batch_status_history WHERE batch_id = $1',
      [id],
    ),
  });
  /** Détient un verrou consultatif pendant `fn` (propriétaire, transaction ouverte). */
  const holding = <T>(keySql: string, id: string, fn: () => Promise<T>): Promise<T> =>
    withOwner(async (db) => {
      await db.query('BEGIN');
      try {
        await db.query(`SELECT pg_advisory_xact_lock(${keySql})`, [id]);
        return await fn();
      } finally {
        await db.query('COMMIT');
      }
    });

  beforeAll(async () => {
    w = await createBatchWorld();
    api = client(w);
  });
  afterAll(async () => {
    await w.app.close();
  });

  it('PATCH du prestataire B sur le lot de A : 404, aucune donnée, aucune écriture, aucun audit', async () => {
    const id = await create();
    const before = await snapshot(id);
    for (const path of [`${B()}/${id}`, `${A()}/${id}`]) {
      const res = await api.patch(w.orgAdminB, path, { quantity: 1, print_order_ref: 'PIRATE' });
      expect(res.status).toBe(404);
      const text = JSON.stringify(res.body) + res.text;
      expect(text).not.toContain(id);
      expect(text).not.toContain(w.ids.a1);
      expect(text).not.toContain('PIRATE');
      expect(res.body).not.toHaveProperty('quantity');
      expect(res.body).not.toHaveProperty('batch_id');
    }
    expect(await snapshot(id)).toEqual(before);
  });

  it('la clé du verrou est préfixée « media-batch: » et propre au lot', async () => {
    const id = await create();
    const other = await create();
    const waiting = () =>
      rows<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE wait_event_type = 'Lock' AND wait_event = 'advisory'
            AND usename = 'cashless_app' AND datname = current_database()`,
      );
    // Verrou d'un AUTRE lot, ou de l'identifiant sans préfixe : le PATCH n'attend pas.
    for (const [key, held] of [
      ["hashtextextended('media-batch:' || $1::text, 0)", other],
      ['hashtextextended($1::text, 0)', id],
      ["hashtextextended('autre:' || $1::text, 0)", id],
    ] as const) {
      const res = await holding(key, held, () =>
        Promise.race([
          api.patch(w.orgAdmin, `${A()}/${id}`, { quantity: 61 }).then((r) => r),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
        ]),
      );
      expect(res).not.toBeNull();
      expect(res!.status).toBe(200);
    }
    expect((await waiting())[0]!.n).toBe(0);
    // Le verrou préfixé de CE lot, lui, retient bien le PATCH (la clé est exactement celle-là).
    const blocked = await holding(
      "hashtextextended('media-batch:' || $1::text, 0)",
      id,
      async () => {
        const pending = api.patch(w.orgAdmin, `${A()}/${id}`, { quantity: 62 }).then((r) => r);
        let n = 0;
        for (let waited = 0; waited < 5000 && n === 0; waited += 25) {
          n = (await waiting())[0]!.n;
          if (n === 0) await new Promise((resolve) => setTimeout(resolve, 25));
        }
        return { n, pending };
      },
    );
    expect(blocked.n).toBeGreaterThan(0);
    expect((await blocked.pending).status).toBe(200);
  });

  it('la RLS reste active sur media_batch (seule barrière de lecture du prestataire)', async () => {
    const [flags] = await rows<{ relrowsecurity: boolean }>(
      "SELECT relrowsecurity FROM pg_class WHERE relname = 'media_batch'",
    );
    expect(flags!.relrowsecurity).toBe(true);
  });
});
