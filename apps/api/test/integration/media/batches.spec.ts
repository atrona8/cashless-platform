// Intégration : lots de bracelets (FR-011 à FR-014 ; US4 de la spec) — création et refus de règle, modification tant
// que le lot est commandé, passages de statut, inventaire, clôture par relances d'un lot de 600 cautions, rattrapage
// du préchargement, rôles, isolation à deux prestataires, audit.
import { randomUUID } from 'node:crypto';
import { withOwner } from '../../support/db';
import { client, createBatchWorld, KEY, rows, seedMedia, type BatchWorld } from './batch-fixtures';

describe('lots de bracelets', () => {
  let w: BatchWorld;
  let api: ReturnType<typeof client>;
  const A = () => `/v1/operators/${w.ops.a}/media-batches`;
  const B = () => `/v1/operators/${w.ops.b}/media-batches`;
  const base = () => ({ organizer_id: w.ids.a1, kind: 'PUBLIC', quantity: 50, key_index: KEY.shared });
  const create = async (body: object = {}) => {
    const res = await api.post(w.orgAdmin, A(), { ...base(), ...body });
    expect(res.status).toBe(201);
    return res.body as { batch_id: string; status: string };
  };

  beforeAll(async () => {
    w = await createBatchWorld();
    api = client(w);
  });

  afterAll(async () => {
    await w.app.close();
  });

  describe('création', () => {
    it('crée un lot commandé, avec ses valeurs par défaut, et le journalise', async () => {
      const res = await api.post(w.orgAdmin, A(), { ...base(), print_order_ref: '  BC-2026-041 ' });
      expect(res.status).toBe(201);
      expect(res.headers.location).toBe(`${A()}/${res.body.batch_id}`);
      expect(res.body).toEqual({
        batch_id: expect.any(String), operator_id: w.ops.a, organizer_id: w.ids.a1, event_id: null, kind: 'PUBLIC', quantity: 50, key_index: KEY.shared,
        key_mode: 'SHARED', reuse_policy: 'SINGLE_USE', print_order_ref: 'BC-2026-041', status: 'ORDERED', preload_promo_amount: 0, deposit_amount: 0,
        deposit_mode: null, claim_codes_issued: false, created_at: expect.any(String),
      });
      expect(await rows(`SELECT action, actor_id, actor_role, after->>'quantity' AS quantity FROM audit_log WHERE operator_id = $1 AND object_id = $2`, [w.ops.a, res.body.batch_id])).toEqual([
        { action: 'MEDIA_BATCH_CREATED', actor_id: w.orgAdmin.userId, actor_role: 'ORGANIZER_ADMIN', quantity: '50' },
      ]);
      expect((await api.get(w.orgAdmin, `${A()}/${res.body.batch_id}`)).body).toEqual(res.body);
    });

    it('lot à clé dédiée, caution, préchargement, réservé à un événement', async () => {
      const res = await api.post(w.orgAdmin, A(), {
        ...base(), kind: 'VIP', event_id: w.ids.eventA1, key_index: KEY.dedicated, key_mode: 'DEDICATED', preload_promo_amount: 2500, deposit_amount: 1000, deposit_mode: 'SEPARATE',
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ event_id: w.ids.eventA1, key_mode: 'DEDICATED', reuse_policy: 'SINGLE_USE', preload_promo_amount: 2500, deposit_amount: 1000, deposit_mode: 'SEPARATE' });
    });

    it('rejoue la même clé d’idempotence sans créer un second lot', async () => {
      const key = randomUUID();
      const first = await api.post(w.orgAdmin, A(), { ...base(), print_order_ref: 'REJEU' }, key);
      const second = await api.post(w.orgAdmin, A(), { ...base(), print_order_ref: 'REJEU' }, key);
      expect(second.status).toBe(201);
      expect(second.headers['idempotency-replayed']).toBe('true');
      expect(second.body).toEqual(first.body);
      expect(await rows(`SELECT 1 FROM media_batch WHERE operator_id = $1 AND print_order_ref = 'REJEU'`, [w.ops.a])).toHaveLength(1);
    });

    it.each([
      ['caution sans mode', { deposit_amount: 1000 }, 'batch.deposit_mode'],
      ['mode sans caution', { deposit_mode: 'SEPARATE' }, 'batch.deposit_mode'],
      ['clé dédiée sans événement', { key_mode: 'DEDICATED', key_index: KEY.dedicated }, 'batch.dedicated_event'],
      ['clé dédiée et lot réutilisable', { key_mode: 'DEDICATED', key_index: KEY.dedicated, event_id: 'eventA1', reuse_policy: 'POOL' }, 'batch.dedicated_single_use'],
      ['index de clé inconnu', { key_index: 4242 }, 'batch.key_unknown'],
      ['clé qui n’est plus active', { key_index: KEY.inactive }, 'batch.key_inactive'],
      ['lot partagé sur une clé dédiée', { key_index: KEY.dedicated }, 'batch.key_shared'],
      ['lot dédié sur une clé partagée', { key_mode: 'DEDICATED', key_index: KEY.shared, event_id: 'eventA1' }, 'batch.key_dedicated'],
      ['lot dédié sur la clé d’un autre événement', { key_mode: 'DEDICATED', key_index: KEY.dedicatedOther, event_id: 'eventA1' }, 'batch.key_dedicated'],
      ['événement d’un autre organisateur', { event_id: 'eventA2' }, 'batch.event_unknown'],
      ['événement inconnu', { event_id: 'random' }, 'batch.event_unknown'],
    ])('refuse : %s (422, règle citée, en français et en anglais)', async (_name, body, rule) => {
      const event = (body as { event_id?: string }).event_id;
      const resolved = event === undefined ? body : { ...body, event_id: event === 'random' ? randomUUID() : w.ids[event as 'eventA1' | 'eventA2'] };
      const before = await rows('SELECT count(*)::int AS n FROM media_batch WHERE operator_id = $1', [w.ops.a]);
      const fr = await api.post(w.orgAdmin, A(), { ...base(), ...resolved });
      const en = await api.post(w.orgAdmin, A(), { ...base(), ...resolved }, randomUUID(), 'en');
      expect(fr.status).toBe(422);
      expect(fr.body).toMatchObject({ code: 'VALIDATION_FAILED', rule });
      expect(en.status).toBe(422);
      expect(en.body.rule).toBe(rule);
      expect(en.body.detail).not.toBe(fr.body.detail);
      expect(`${fr.body.detail}${en.body.detail}`).not.toMatch(/media_batch|CHECK|SQL|constraint/i);
      expect(await rows('SELECT count(*)::int AS n FROM media_batch WHERE operator_id = $1', [w.ops.a])).toEqual(before);
    });

    it.each([
      ['quantité nulle', { quantity: 0 }],
      ['quantité au-delà du million', { quantity: 1_000_001 }],
      ['type inconnu', { kind: 'CREW' }],
      ['index hors bornes', { key_index: 70_000 }],
      ['organisateur mal formé', { organizer_id: 'abc' }],
      ['montant négatif', { deposit_amount: -5, deposit_mode: 'SEPARATE' }],
    ])('corps invalide : %s (400)', async (_name, body) => {
      expect((await api.post(w.orgAdmin, A(), { ...base(), ...body })).status).toBe(400);
    });

    it('seul l’administrateur de l’organisateur crée un lot', async () => {
      expect((await api.post(w.operatorAdmin, A(), base())).status).toBe(403);
      expect((await api.post(w.supervisor, A(), base())).status).toBe(403);
      expect((await api.post(w.otherOrgAdmin, A(), base())).status).toBe(403);
      expect((await api.post(w.orgAdmin, A(), { ...base(), organizer_id: w.ids.a2 })).status).toBe(403);
      expect((await api.post(w.orgAdmin, A(), { ...base(), organizer_id: randomUUID() })).status).toBe(404);
      expect((await api.post(w.orgAdmin, A(), { ...base(), organizer_id: w.ids.b1 })).status).toBe(404);
    });
  });

  describe('lecture', () => {
    let mine: string;
    let reusable: string;
    let theirs: string;

    beforeAll(async () => {
      mine = (await create({ event_id: w.ids.eventA1, print_order_ref: 'LECTURE-1' })).batch_id;
      reusable = (await create({ print_order_ref: 'LECTURE-2', kind: 'STAFF' })).batch_id;
      const other = await api.post(w.otherOrgAdmin, A(), { ...base(), organizer_id: w.ids.a2 });
      expect(other.status).toBe(201);
      theirs = other.body.batch_id;
    });

    it('chacun voit les lots de son organisateur ; l’administrateur du prestataire les voit tous', async () => {
      for (const who of [w.orgAdmin, w.supervisor, w.eventCashier]) {
        expect((await api.get(who, `${A()}/${mine}`)).status).toBe(200);
        expect((await api.get(who, `${A()}/${reusable}`)).status).toBe(200);
        expect((await api.get(who, `${A()}/${theirs}`)).status).toBe(403);
        const list = await api.get(who, `${A()}?limit=200`);
        const listed = (list.body.data as { batch_id: string; organizer_id: string }[]).map((b) => b.batch_id);
        expect(listed).toEqual(expect.arrayContaining([mine, reusable]));
        expect(listed).not.toContain(theirs);
      }
      expect((await api.get(w.otherCashier, `${A()}/${mine}`)).status).toBe(403);
      expect((await api.get(w.otherCashier, `${A()}/${theirs}`)).status).toBe(200);
      const all = (await api.get(w.operatorAdmin, `${A()}?limit=200`)).body.data as { batch_id: string }[];
      expect(all.map((b) => b.batch_id)).toEqual(expect.arrayContaining([mine, reusable, theirs]));
    });

    it('filtres et pagination', async () => {
      const byEvent = await api.get(w.orgAdmin, `${A()}?event_id=${w.ids.eventA1}&limit=200`);
      expect((byEvent.body.data as { event_id: string }[]).every((b) => b.event_id === w.ids.eventA1)).toBe(true);
      expect((byEvent.body.data as { batch_id: string }[]).map((b) => b.batch_id)).toContain(mine);
      const byOrganizer = await api.get(w.operatorAdmin, `${A()}?organizer_id=${w.ids.a2}`);
      expect((byOrganizer.body.data as { batch_id: string }[]).map((b) => b.batch_id)).toEqual([theirs]);
      // Un filtre sur un organisateur hors de sa portée ne montre rien.
      expect((await api.get(w.orgAdmin, `${A()}?organizer_id=${w.ids.a2}`)).body.data).toEqual([]);
      expect((await api.get(w.orgAdmin, `${A()}?status=CLOSED`)).body.data).toEqual([]);
      const first = await api.get(w.orgAdmin, `${A()}?limit=1`);
      expect(first.body).toMatchObject({ has_more: true, next_cursor: expect.any(String) });
      const second = await api.get(w.orgAdmin, `${A()}?limit=1&cursor=${first.body.next_cursor}`);
      expect(second.body.data[0].batch_id).not.toBe(first.body.data[0].batch_id);
      for (const bad of ['status=NOPE', 'organizer_id=abc', 'event_id=abc', 'limit=0', 'cursor=%25']) expect((await api.get(w.orgAdmin, `${A()}?${bad}`)).status).toBe(400);
    });

    it('isolation : un autre prestataire ne voit ni ne touche ces lots', async () => {
      expect((await api.get(w.orgAdminB, `${A()}/${mine}`)).status).toBe(404);
      expect((await api.get(w.orgAdminB, `${B()}/${mine}`)).status).toBe(404);
      expect((await api.get(w.orgAdminB, `${B()}/${mine}/inventory`)).status).toBe(404);
      expect((await api.get(w.orgAdminB, B())).body.data).toEqual([]);
      for (const path of ['status', 'closure', 'preload-catchup', 'claim-code-order']) {
        expect((await api.post(w.orgAdminB, `${B()}/${mine}/${path}`, { status: 'PERSONALIZED' })).status).toBe(404);
      }
      expect((await api.patch(w.orgAdminB, `${B()}/${mine}`, { quantity: 1 })).status).toBe(404);
      expect((await api.post(w.orgAdmin, B(), { ...base() })).status).toBe(404);
      expect(await rows('SELECT status, quantity FROM media_batch WHERE id = $1', [mine])).toEqual([{ status: 'ORDERED', quantity: 50 }]);
      expect((await api.get(w.orgAdmin, `${A()}/${randomUUID()}`)).status).toBe(404);
      expect((await api.get(w.orgAdmin, `${A()}/pas-un-uuid`)).status).toBe(404);
    });
  });

  describe('modification', () => {
    it('un lot commandé se modifie ; avant et après sont journalisés', async () => {
      const batch = await create();
      const res = await api.patch(w.orgAdmin, `${A()}/${batch.batch_id}`, { quantity: 80, print_order_ref: 'BC-2', deposit_amount: 500, deposit_mode: 'FROM_BALANCE', reuse_policy: 'POOL', preload_promo_amount: 100 });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ quantity: 80, print_order_ref: 'BC-2', deposit_amount: 500, deposit_mode: 'FROM_BALANCE', reuse_policy: 'POOL', preload_promo_amount: 100 });
      expect(
        await rows(`SELECT before->>'quantity' AS b, after->>'quantity' AS a, actor_id FROM audit_log WHERE operator_id = $1 AND object_id = $2 AND action = 'MEDIA_BATCH_UPDATED'`, [w.ops.a, batch.batch_id]),
      ).toEqual([{ b: '50', a: '80', actor_id: w.orgAdmin.userId }]);
      // Retirer la caution : montant à zéro et mode à null, ensemble.
      expect((await api.patch(w.orgAdmin, `${A()}/${batch.batch_id}`, { deposit_amount: 0 })).body).toMatchObject({ code: 'VALIDATION_FAILED', rule: 'batch.deposit_mode' });
      expect((await api.patch(w.orgAdmin, `${A()}/${batch.batch_id}`, { deposit_amount: 0, deposit_mode: null })).body).toMatchObject({ deposit_amount: 0, deposit_mode: null });
      expect((await api.patch(w.orgAdmin, `${A()}/${batch.batch_id}`, { print_order_ref: null })).body.print_order_ref).toBeNull();
    });

    it('champ inconnu ou non modifiable, corps vide : 400', async () => {
      const batch = await create();
      for (const body of [{}, { kind: 'VIP' }, { key_index: 2 }, { status: 'ACTIVE' }, { quantity: 0 }]) {
        expect((await api.patch(w.orgAdmin, `${A()}/${batch.batch_id}`, body)).status).toBe(400);
      }
    });

    it('un lot à clé dédiée reste à usage unique', async () => {
      const batch = await create({ event_id: w.ids.eventA1, key_index: KEY.dedicated, key_mode: 'DEDICATED' });
      expect((await api.patch(w.orgAdmin, `${A()}/${batch.batch_id}`, { reuse_policy: 'POOL' })).body).toMatchObject({ code: 'VALIDATION_FAILED', rule: 'batch.dedicated_single_use' });
    });

    it('un lot qui n’est plus commandé ne se modifie plus (409) ; seuls les administrateurs de l’organisateur modifient', async () => {
      const batch = await create();
      expect((await api.patch(w.operatorAdmin, `${A()}/${batch.batch_id}`, { quantity: 10 })).status).toBe(403);
      expect((await api.patch(w.otherOrgAdmin, `${A()}/${batch.batch_id}`, { quantity: 10 })).status).toBe(403);
      expect((await api.post(w.orgAdmin, `${A()}/${batch.batch_id}/status`, { status: 'PERSONALIZED' })).status).toBe(200);
      const res = await api.patch(w.orgAdmin, `${A()}/${batch.batch_id}`, { quantity: 10 });
      expect(res.status).toBe(409);
      expect(await rows('SELECT quantity FROM media_batch WHERE id = $1', [batch.batch_id])).toEqual([{ quantity: 50 }]);
    });
  });

  describe('cycle de vie', () => {
    it('ORDERED → PERSONALIZED → DELIVERED → ACTIVE ⇄ SUSPENDED, tracé avec auteur et motif', async () => {
      const batch = await create();
      const to = (status: string, reason?: string) => api.post(w.orgAdmin, `${A()}/${batch.batch_id}/status`, reason ? { status, reason } : { status });
      for (const status of ['PERSONALIZED', 'DELIVERED', 'ACTIVE']) {
        const res = await to(status);
        expect(res.status).toBe(200);
        expect(res.body.status).toBe(status);
      }
      const noReason = await to('SUSPENDED');
      expect(noReason.status).toBe(422);
      expect(noReason.body.rule).toBe('batch.suspend_reason');
      expect((await to('SUSPENDED', 'Carton volé à la livraison')).body.status).toBe('SUSPENDED');
      expect((await to('ACTIVE')).body.status).toBe('ACTIVE');
      // Redemander le statut courant ne fait rien de plus.
      expect((await to('ACTIVE')).body.status).toBe('ACTIVE');
      expect(await rows('SELECT from_status, to_status, reason, actor_id FROM media_batch_status_history WHERE batch_id = $1 ORDER BY id', [batch.batch_id])).toEqual([
        { from_status: null, to_status: 'ORDERED', reason: null, actor_id: null },
        { from_status: 'ORDERED', to_status: 'PERSONALIZED', reason: null, actor_id: w.orgAdmin.userId },
        { from_status: 'PERSONALIZED', to_status: 'DELIVERED', reason: null, actor_id: w.orgAdmin.userId },
        { from_status: 'DELIVERED', to_status: 'ACTIVE', reason: null, actor_id: w.orgAdmin.userId },
        { from_status: 'ACTIVE', to_status: 'SUSPENDED', reason: 'Carton volé à la livraison', actor_id: w.orgAdmin.userId },
        { from_status: 'SUSPENDED', to_status: 'ACTIVE', reason: null, actor_id: w.orgAdmin.userId },
      ]);
      expect(await rows(`SELECT count(*)::int AS n FROM audit_log WHERE operator_id = $1 AND object_id = $2 AND action = 'MEDIA_BATCH_STATUS_CHANGED'`, [w.ops.a, batch.batch_id])).toEqual([{ n: 5 }]);
    });

    it('un passage non prévu est refusé (409) avec les passages permis ; la clôture ne passe pas par cette route', async () => {
      const batch = await create();
      const res = await api.post(w.orgAdmin, `${A()}/${batch.batch_id}/status`, { status: 'ACTIVE' });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'MEDIA_STATE_INVALID', from: 'ORDERED', allowed: ['PERSONALIZED'] });
      expect((await api.post(w.orgAdmin, `${A()}/${batch.batch_id}/status`, { status: 'CLOSED' })).status).toBe(400);
      expect((await api.post(w.orgAdmin, `${A()}/${batch.batch_id}/status`, { status: 'ORDERED' })).status).toBe(400);
      expect((await api.post(w.orgAdmin, `${A()}/${batch.batch_id}/status`, {})).status).toBe(400);
      expect((await api.post(w.operatorAdmin, `${A()}/${batch.batch_id}/status`, { status: 'PERSONALIZED' })).status).toBe(403);
      expect((await api.post(w.otherOrgAdmin, `${A()}/${batch.batch_id}/status`, { status: 'PERSONALIZED' })).status).toBe(403);
      expect(await rows('SELECT status FROM media_batch WHERE id = $1', [batch.batch_id])).toEqual([{ status: 'ORDERED' }]);
    });
  });

  describe('inventaire', () => {
    it('compte les bracelets du lot par statut, et ceux qui manquent au registre', async () => {
      const batch = await create({ event_id: w.ids.eventA1, quantity: 10 });
      await withOwner(async (db) => {
        await seedMedia(db, w.ops.a, batch.batch_id, KEY.shared, 2);
        await seedMedia(db, w.ops.a, batch.batch_id, KEY.shared, 1, { status: 'ISSUED' });
        const active = await seedMedia(db, w.ops.a, batch.batch_id, KEY.shared, 4, { status: 'ACTIVE', walletId: w.ids.walletA1 });
        await db.query(`UPDATE media SET status = 'SUSPENDED' WHERE id = $1`, [active[0]!.id]);
        await db.query(`UPDATE media SET status = 'BLACKLISTED' WHERE id = $1`, [active[1]!.id]);
        await db.query(`UPDATE media SET status = 'RETIRED' WHERE id = $1`, [active[2]!.id]);
      });
      const res = await api.get(w.supervisor, `${A()}/${batch.batch_id}/inventory`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        batch_id: batch.batch_id, ordered: 10, registered: 7, in_stock: 2, issued: 1, active: 1, suspended: 1, blacklisted: 1, replaced: 0, released: 0, retired: 1, missing: 3,
      });
      expect((await api.get(w.operatorAdmin, `${A()}/${batch.batch_id}/inventory`)).status).toBe(200);
      expect((await api.get(w.otherOrgAdmin, `${A()}/${batch.batch_id}/inventory`)).status).toBe(403);
    });
  });

  describe('clôture', () => {
    it('600 cautions détenues : la clôture avance par relances, puis clôt, retire les bracelets et acquiert les cautions', async () => {
      const batchId = randomUUID();
      await withOwner(async (db) => {
        await db.query(
          `INSERT INTO media_batch (id, operator_id, organizer_id, event_id, kind, quantity, key_index, status, deposit_amount, deposit_mode)
           VALUES ($1, $2, $3, $4, 'PUBLIC', 600, ${KEY.shared}, 'ACTIVE', 1000, 'SEPARATE')`,
          [batchId, w.ops.a, w.ids.a1, w.ids.eventA1],
        );
        await seedMedia(db, w.ops.a, batchId, KEY.shared, 600, { status: 'ACTIVE', walletId: w.ids.walletA1, depositHeld: 1000 });
        await db.query(`SELECT set_config('app.operator_id', $1, false)`, [w.ops.a]);
        await db.query(
          `SELECT post_transaction($1, 'DEPOSIT_TAKEN', $2, now(), 'ONLINE', jsonb_build_array(
             jsonb_build_object('account_id', (SELECT id FROM account WHERE ledger_id = $1 AND purpose = 'BANK'), 'amount', 600000),
             jsonb_build_object('account_id', (SELECT id FROM account WHERE ledger_id = $1 AND purpose = 'ORG_DEPOSIT'), 'amount', -600000)))`,
          [w.ids.ledgerA1, `seed-deposits:${batchId}`],
        );
      });
      const forfeited = () => rows<{ total: string }>(`SELECT total_credit::text AS total FROM trial_balance WHERE ledger_id = $1 AND code = 'L-ORG-CAUTION-ACQ'`, [w.ids.ledgerA1]);
      const before = Number((await forfeited())[0]?.total ?? 0);

      expect((await api.post(w.operatorAdmin, `${A()}/${batchId}/closure`)).status).toBe(403);
      expect((await api.post(w.otherOrgAdmin, `${A()}/${batchId}/closure`)).status).toBe(403);

      const first = await api.post(w.orgAdmin, `${A()}/${batchId}/closure`);
      expect(first.status).toBe(200);
      expect(first.body).toEqual({ status: 'ACTIVE', remaining_deposits: 100, retired_media: 0, invalidated_claim_codes: 0 });
      expect(await rows('SELECT status FROM media_batch WHERE id = $1', [batchId])).toEqual([{ status: 'ACTIVE' }]);
      expect(await rows(`SELECT deposit_status, count(*)::int AS n FROM media WHERE batch_id = $1 GROUP BY 1 ORDER BY 1`, [batchId])).toEqual([
        { deposit_status: 'FORFEITED', n: 500 },
        { deposit_status: 'HELD', n: 100 },
      ]);

      const second = await api.post(w.orgAdmin, `${A()}/${batchId}/closure`);
      expect(second.body).toEqual({ status: 'CLOSED', remaining_deposits: 0, retired_media: 600, invalidated_claim_codes: 0 });
      expect(await rows(`SELECT status, deposit_status, count(*)::int AS n FROM media WHERE batch_id = $1 GROUP BY 1, 2`, [batchId])).toEqual([{ status: 'RETIRED', deposit_status: 'FORFEITED', n: 600 }]);
      expect(Number((await forfeited())[0]!.total) - before).toBe(600_000);
      expect(await rows(`SELECT to_status, actor_id FROM media_batch_status_history WHERE batch_id = $1 AND to_status = 'CLOSED'`, [batchId])).toEqual([{ to_status: 'CLOSED', actor_id: w.orgAdmin.userId }]);

      // Relance sur un lot clos : rien de plus.
      const third = await api.post(w.orgAdmin, `${A()}/${batchId}/closure`);
      expect(third.body).toEqual({ status: 'CLOSED', remaining_deposits: 0, retired_media: 0, invalidated_claim_codes: 0 });
      expect(Number((await forfeited())[0]!.total) - before).toBe(600_000);
      expect(
        await rows(`SELECT after->>'status' AS status, (after->>'remaining_deposits')::int AS remaining FROM audit_log WHERE operator_id = $1 AND object_id = $2 AND action = 'MEDIA_BATCH_CLOSURE' ORDER BY id`, [w.ops.a, batchId]),
      ).toEqual([{ status: 'ACTIVE', remaining: 100 }, { status: 'CLOSED', remaining: 0 }]);
      // Un lot clos ne change plus de statut et ne se modifie plus.
      expect((await api.post(w.orgAdmin, `${A()}/${batchId}/status`, { status: 'ACTIVE' })).status).toBe(409);
      expect((await api.patch(w.orgAdmin, `${A()}/${batchId}`, { quantity: 5 })).status).toBe(409);
    }, 120_000);

    it('un lot commandé, sans bracelet, se clôt en un appel', async () => {
      const batch = await create();
      const res = await api.post(w.orgAdmin, `${A()}/${batch.batch_id}/closure`);
      expect(res.body).toEqual({ status: 'CLOSED', remaining_deposits: 0, retired_media: 0, invalidated_claim_codes: 0 });
    });
  });

  describe('rattrapage du préchargement', () => {
    it('pose les crédits offerts une seule fois par bracelet actif', async () => {
      const batchId = randomUUID();
      await withOwner(async (db) => {
        await db.query(
          `INSERT INTO media_batch (id, operator_id, organizer_id, event_id, kind, quantity, key_index, status, preload_promo_amount)
           VALUES ($1, $2, $3, $4, 'STAFF', 5, ${KEY.shared}, 'ACTIVE', 700)`,
          [batchId, w.ops.a, w.ids.a1, w.ids.eventA1],
        );
        await seedMedia(db, w.ops.a, batchId, KEY.shared, 3, { status: 'ACTIVE', walletId: w.ids.walletA1 });
        await seedMedia(db, w.ops.a, batchId, KEY.shared, 2);
      });
      const posted = () => rows<{ n: number }>(`SELECT count(*)::int AS n FROM journal_transaction WHERE ledger_id = $1 AND idempotency_key LIKE 'preload:%' AND media_id IN (SELECT id FROM media WHERE batch_id = $2)`, [w.ids.ledgerA1, batchId]);
      expect((await api.post(w.operatorAdmin, `${A()}/${batchId}/preload-catchup`)).status).toBe(403);
      const first = await api.post(w.orgAdmin, `${A()}/${batchId}/preload-catchup`);
      expect(first.status).toBe(200);
      expect(first.body).toEqual({ processed: 3 });
      expect((await api.post(w.orgAdmin, `${A()}/${batchId}/preload-catchup`)).body).toEqual({ processed: 0 });
      expect(await posted()).toEqual([{ n: 3 }]);
      expect(await rows(`SELECT (after->>'processed')::int AS processed FROM audit_log WHERE operator_id = $1 AND object_id = $2 AND action = 'MEDIA_BATCH_PRELOAD_CAUGHT_UP'`, [w.ops.a, batchId])).toEqual([{ processed: 3 }]);
    });

    it('un lot sans préchargement : 409', async () => {
      const batch = await create();
      expect((await api.post(w.orgAdmin, `${A()}/${batch.batch_id}/preload-catchup`)).status).toBe(409);
    });
  });
});
