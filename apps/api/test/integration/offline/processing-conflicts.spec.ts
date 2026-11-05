// Table de conflit hors ligne (mission 7, lot WP19 ; T079, T082 ; contracts/compliance.md « Table de conflit »,
// sync_protocol.md §7.3) : chaque ligne a un test. Route réelle, vrai processeur, bigint exacts. Les dates de blocage
// sont posées dans les historiques par le propriétaire (déclencheurs désactivés le temps de l'amorçage).
import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { tapBody, ownerRows } from '../../support/media-fixtures';
import { withOwner } from '../../support/db';
import { ProcessingWorld, type OfflineTerminal } from './processing-fixtures';
import type { PayMedia } from '../payments/payments-fixtures';

jest.setTimeout(240_000);

describe('table de conflit hors ligne (WP19)', () => {
  let world: ProcessingWorld;
  beforeAll(async () => {
    world = await ProcessingWorld.create();
  });
  afterAll(async () => {
    await world?.close();
  });

  const setup = async (funds = 6000) => {
    const t = await world.terminal({ max_snapshot_age_seconds: 7200 });
    const media = await world.pw.media(1, funds);
    const version = await world.snapshot(t, media, { generatedAgo: 2400 });
    return { t, m: media[0]!, version };
  };

  const one = async (t: OfflineTerminal, op: Record<string, unknown>) => {
    const res = await world.submit(t, [op as never]);
    const [r] = world.results(res);
    const [tx] = await world.txRows(t.t.deviceId);
    return { r: r!, tx, res };
  };

  const linesOf = async (txId: string) =>
    (await world.postings(txId)).map((p) => `${p.purpose}:${p.amount}`);

  it('OK, solde ≥ montant : ACCEPTED, tout couvert', async () => {
    const { t, m, version } = await setup(20_000);
    const { r, tx } = await one(t, world.sale(t, m, 9000, version));
    expect(r).toMatchObject({ status: 'ACCEPTED', charged_to_wallet: 9000 });
    expect(r.shortfall_amount).toBeUndefined();
    expect(await linesOf(tx!.id)).toEqual(['WALLET_PAID:9000', 'MERCHANT:-9000']);
    expect(await world.anomalies(t.t.deviceId, 'OFFLINE_SHORTFALL')).toHaveLength(0);
  });

  it('OK, solde < montant (transaction 22 : 9 000 pour 6 000) : portefeuille +6000, S-ATTENTE +3000, commerçant −9000, anomalie 3000', async () => {
    const { t, m, version } = await setup(6000);
    const { r, tx } = await one(t, world.sale(t, m, 9000, version));
    expect(r).toMatchObject({
      status: 'ACCEPTED_WITH_SHORTFALL',
      charged_to_wallet: 6000,
      shortfall_amount: 3000,
      shortfall_reason: 'INSUFFICIENT_FUNDS',
    });
    expect(await linesOf(tx!.id)).toEqual(['WALLET_PAID:6000', 'SUSPENSE:3000', 'MERCHANT:-9000']);
    expect(await world.spendable(m.walletId)).toBe(0);
    const [an] = await world.anomalies(t.t.deviceId, 'OFFLINE_SHORTFALL');
    expect(an).toMatchObject({
      amount: '3000',
      transaction_id: tx!.id,
      status: 'OPEN',
      loss_bearer: 'OPERATOR',
    });
    expect(r.anomaly_id).toBe(an!.id);
    const reg = await world.pw.registry(t.t.deviceId);
    expect(reg[0]).toMatchObject({
      outcome: 'ACCEPTED_WITH_SHORTFALL',
      reason: 'INSUFFICIENT_FUNDS',
    });
  });

  describe('bracelet bloqué : date du blocage et tolérance', () => {
    /** Historique du bracelet posé à la main : `[statut, secondes depuis maintenant]`, statut courant = le dernier. */
    const history = async (m: PayMedia, rows: Array<[string, number]>) =>
      withOwner(async (db) => {
        await db.query('BEGIN');
        await db.query('SET LOCAL session_replication_role = replica');
        await db.query('DELETE FROM media_status_history WHERE media_id = $1', [m.media.id]);
        let from: string | null = null;
        for (const [to, offset] of rows) {
          await db.query(
            `INSERT INTO media_status_history (operator_id, media_id, from_status, to_status, at)
             VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5))`,
            [world.operatorId, m.media.id, from, to, offset],
          );
          from = to;
        }
        await db.query('UPDATE media SET status = $2 WHERE id = $1', [m.media.id, rows.at(-1)![0]]);
        await db.query('COMMIT');
      });

    it('vente 100 s avant le blocage (donc moins de blocage + tolérance) : couverte', async () => {
      const { t, m, version } = await setup(20_000);
      await history(m, [
        ['ACTIVE', -7200],
        ['SUSPENDED', 99],
      ]);
      const { r } = await one(t, world.sale(t, m, 5000, version));
      expect(r).toMatchObject({
        status: 'ACCEPTED',
        charged_to_wallet: 5000,
        tap_result: 'BLOCKED',
      });
    });

    it('vente 130 s après le blocage, snapshot antérieur : manque entier MEDIA_BLOCKED_AFTER_SNAPSHOT', async () => {
      const { t, m, version } = await setup(20_000);
      await history(m, [
        ['ACTIVE', -7200],
        ['SUSPENDED', -131],
      ]);
      const { r, tx } = await one(t, world.sale(t, m, 5000, version));
      expect(r).toMatchObject({
        status: 'ACCEPTED_WITH_SHORTFALL',
        charged_to_wallet: 0,
        shortfall_amount: 5000,
        shortfall_reason: 'MEDIA_BLOCKED_AFTER_SNAPSHOT',
      });
      expect(await linesOf(tx!.id)).toEqual(['SUSPENSE:5000', 'MERCHANT:-5000']);
      expect(await world.spendable(m.walletId)).toBe(20_000);
    });

    it('date de blocage inconnue (-infinity) : manque entier', async () => {
      const { t, m, version } = await setup(20_000);
      await withOwner((db) =>
        db.query(`UPDATE media SET status = 'SUSPENDED' WHERE id = $1`, [m.media.id]),
      );
      await withOwner((db) =>
        db.query('DELETE FROM media_status_history WHERE media_id = $1', [m.media.id]),
      );
      const { r } = await one(t, world.sale(t, m, 5000, version));
      expect(r).toMatchObject({
        charged_to_wallet: 0,
        shortfall_amount: 5000,
        shortfall_reason: 'MEDIA_BLOCKED_AFTER_SNAPSHOT',
      });
    });

    // Tolérance de `p_before` (heure de l'opération + 120 s) : un déblocage 100 s après la vente compte (couverte),
    // un déblocage 130 s après ne compte pas encore (le blocage du début tient : manque entier).
    it('déblocage 100 s après la vente (dans la tolérance), re-blocage plus tard : couverte', async () => {
      const { t, m, version } = await setup(20_000);
      await history(m, [
        ['ACTIVE', -7200],
        ['SUSPENDED', -600],
        ['ACTIVE', 99],
        ['SUSPENDED', 300],
      ]);
      const { r } = await one(t, world.sale(t, m, 5000, version));
      expect(r).toMatchObject({ status: 'ACCEPTED', charged_to_wallet: 5000 });
    });

    it('déblocage 130 s après la vente (hors tolérance), re-blocage plus tard : manque entier', async () => {
      const { t, m, version } = await setup(20_000);
      await history(m, [
        ['ACTIVE', -7200],
        ['SUSPENDED', -600],
        ['ACTIVE', 129],
        ['SUSPENDED', 300],
      ]);
      const { r } = await one(t, world.sale(t, m, 5000, version));
      expect(r).toMatchObject({
        status: 'ACCEPTED_WITH_SHORTFALL',
        charged_to_wallet: 0,
        shortfall_amount: 5000,
        shortfall_reason: 'MEDIA_BLOCKED_AFTER_SNAPSHOT',
      });
    });

    it('deuxième blocage plus tardif : ne masque pas le premier (p_before = heure + tolérance), manque entier', async () => {
      const { t, m, version } = await setup(20_000);
      await history(m, [
        ['ACTIVE', -7200],
        ['SUSPENDED', -600],
        ['ACTIVE', 200],
        ['SUSPENDED', 400],
      ]);
      const { r } = await one(t, world.sale(t, m, 5000, version));
      expect(r).toMatchObject({
        charged_to_wallet: 0,
        shortfall_reason: 'MEDIA_BLOCKED_AFTER_SNAPSHOT',
      });
    });

    it('blocage entièrement postérieur à l’heure + tolérance (précédé d’un blocage levé) : couverte', async () => {
      const { t, m, version } = await setup(20_000);
      await history(m, [
        ['ACTIVE', -7200],
        ['SUSPENDED', -3000],
        ['ACTIVE', -2900],
        ['SUSPENDED', 400],
      ]);
      const { r } = await one(t, world.sale(t, m, 5000, version));
      expect(r).toMatchObject({ status: 'ACCEPTED', charged_to_wallet: 5000 });
    });
  });

  it('UID différent : bracelet en liste noire, manque entier MEDIA_UID_MISMATCH', async () => {
    const { t, m, version } = await setup(20_000);
    const op = world.sale(t, m, 4000, version);
    (op.tap as Record<string, unknown>).nfc_uid = 'aa'.repeat(7);
    const { r } = await one(t, op);
    expect(r).toMatchObject({
      charged_to_wallet: 0,
      shortfall_amount: 4000,
      shortfall_reason: 'MEDIA_UID_MISMATCH',
    });
    const [row] = await ownerRows<{ status: string }>('SELECT status FROM media WHERE id = $1', [
      m.media.id,
    ]);
    expect(row!.status).toBe('BLACKLISTED');
  });

  it('signature d’originalité différente : MEDIA_SIGNATURE_MISMATCH, manque entier', async () => {
    const { t, m, version } = await setup(20_000);
    const op = world.sale(t, m, 4000, version);
    (op.tap as Record<string, unknown>).originality_signature = randomBytes(32).toString('hex');
    const { r } = await one(t, op);
    expect(r).toMatchObject({ charged_to_wallet: 0, shortfall_reason: 'MEDIA_SIGNATURE_MISMATCH' });
  });

  it('signature absente alors que la puce en a une : résultat inchangé, anomalie SIGNATURE_MISMATCH en plus', async () => {
    const { t, m, version } = await setup(20_000);
    const op = world.sale(t, m, 4000, version);
    delete (op.tap as Record<string, unknown>).originality_signature;
    const { r } = await one(t, op);
    expect(r).toMatchObject({ status: 'ACCEPTED', charged_to_wallet: 4000 });
    const an = await ownerRows<{ n: number }>(
      `SELECT count(*)::int AS n FROM anomaly WHERE media_id = $1 AND kind = 'SIGNATURE_MISMATCH'`,
      [m.media.id],
    );
    expect(an[0]!.n).toBe(1);
  });

  it('copie suspectée (compteur déjà vu par un autre terminal) : MEDIA_CLONE_SUSPECTED, manque entier', async () => {
    const { t, m, version } = await setup(20_000);
    const other = await world.pw.terminal({ mode: 'CATALOG_POS' });
    await world.pw.readTap(other, m); // compteur 1 vu par un autre terminal
    m.counter -= 1;
    const { r } = await one(t, world.sale(t, m, 4000, version));
    expect(r).toMatchObject({ charged_to_wallet: 0, shortfall_reason: 'MEDIA_CLONE_SUSPECTED' });
  });

  it('portefeuille BLOCKED : manque entier WALLET_BLOCKED', async () => {
    const { t, m, version } = await setup(20_000);
    await withOwner((db) =>
      db.query(`UPDATE wallet SET status = 'BLOCKED' WHERE id = $1`, [m.walletId]),
    );
    const { r } = await one(t, world.sale(t, m, 4000, version));
    expect(r).toMatchObject({
      charged_to_wallet: 0,
      shortfall_amount: 4000,
      shortfall_reason: 'WALLET_BLOCKED',
    });
    expect(await world.spendable(m.walletId)).toBe(20_000);
  });

  it('bracelet inconnu du serveur mais présent au snapshot : REJECTED MEDIA_NOT_IN_SNAPSHOT, rien d’écrit', async () => {
    const t = await world.terminal();
    const ghost = {
      media: {
        id: '',
        uid: 'bb'.repeat(7),
        tokenHash: randomBytes(32),
        signature: randomBytes(32),
      },
      walletId: '',
      counter: 0,
    } as unknown as PayMedia;
    const version = await world.snapshot(t, [ghost]);
    const op = world.sale(t, ghost, 1000, version);
    op.tap = tapBody(ghost.media, 1, { occurred_at: op.occurred_at });
    const { r, tx } = await one(t, op);
    expect(r).toMatchObject({
      status: 'REJECTED',
      reject_reason: 'MEDIA_NOT_IN_SNAPSHOT',
      effect: 'NONE',
    });
    expect(tx).toBeUndefined();
  });

  it('device_id renseigné à l’écriture : la vente entre dans l’exposition du terminal (offline_device_exposure)', async () => {
    const { t, m, version } = await setup(20_000);
    const { tx } = await one(t, world.sale(t, m, 3000, version));
    expect(tx!.device_id).toBe(t.t.deviceId);
    const [e] = await ownerRows<{ per_device: string; per_media: string }>(
      `SELECT per_device::text, per_media::text FROM (
         SELECT set_config('app.operator_id', $1, true)) s,
         offline_device_exposure($2, $3, 99, now() + interval '1 minute', interval '120 seconds')`,
      [world.operatorId, t.t.deviceId, m.media.id],
    );
    expect(e).toEqual({ per_device: '3000', per_media: '3000' });
  });
});
