// Intégration (mission 10a, lot WP09) : `printed_number` et `pending_offline_notice` servis par `/me/media`,
// `/me/wallets` et `reportMyMediaLost` ; mesure NFR-004. Vraie base, RLS du prestataire.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Client } from 'pg';
import request from 'supertest';
import { createTestApp } from '../../support/app';
import { contractViolations } from '../../support/contract-schema';
import { withOwner } from '../../support/db';
import {
  createCustomerWallet,
  createTestCustomer,
  type TestCustomer,
} from '../../support/fake-customer';
import {
  activateMedia,
  createBatch,
  createMediaWorld,
  goLive,
  seedPersonalizedMedia,
  type MediaWorld,
} from '../../support/media-fixtures';

const latency = process.env.SKIP_LATENCY ? it.skip : it;
const p95 = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]!;
const NFR004_P95_MS = 300;

describe('/me complet : numéro imprimé et avis de solde provisoire (10a, WP09)', () => {
  let w: MediaWorld;
  let app: INestApplication;
  let awa: TestCustomer;
  let customerB: TestCustomer;
  let perf: TestCustomer;
  let walletLive: string;
  let walletLive2: string;
  let walletClosed: string;
  let ledgerLive2: string;
  let ledgerClosed: string;
  let mediaNumbered: string;
  let mediaPlain: string;
  let mediaB: string;
  let walletB: string;
  const devices: Record<'live' | 'revoked' | 'live2' | 'closed', string> = {
    live: '',
    revoked: '',
    live2: '',
    closed: '',
  };

  const get = (path: string, who: TestCustomer) =>
    request(app.getHttpServer()).get(`/v1${path}`).set(who.headers);
  const noticeOf = async (who: TestCustomer, walletId: string) => {
    const res = await get('/me/wallets', who);
    expect(res.status).toBe(200);
    const wallet = res.body.data.find((x: { wallet_id: string }) => x.wallet_id === walletId);
    expect(contractViolations('Wallet', wallet)).toEqual([]);
    return wallet.pending_offline_notice as boolean;
  };

  const newEvent = async (db: Client, status: 'LIVE' | 'CLOSED', name: string) => {
    const eventId = randomUUID();
    await db.query(
      `INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id,
                          funds_holder, status)
       SELECT $1, operator_id, organizer_id, $2, currency, timezone, jurisdiction_id, funds_holder,
              $3::event_status
         FROM event WHERE id = $4`,
      [eventId, name, status, w.ids.eventA],
    );
    await db.query(`SELECT set_config('app.operator_id', $1, false)`, [w.ops.a]);
    const { rows } = await db.query<{ ledger: string }>('SELECT open_event_ledger($1) AS ledger', [
      eventId,
    ]);
    return { eventId, ledgerId: rows[0]!.ledger };
  };
  const newDevice = async (db: Client, eventId: string, status: 'ACTIVE' | 'REVOKED') => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO device (operator_id, kind, event_id, serial, status)
       VALUES ($1, 'POS', $2, $3, $4) RETURNING id`,
      [w.ops.a, eventId, `D10A-${randomUUID().slice(0, 8)}`, status],
    );
    return rows[0]!.id;
  };
  const ack = (deviceId: string, ledgerId: string, version: number) =>
    withOwner((db) =>
      db.query(
        `INSERT INTO offline_snapshot_ack (device_id, version, operator_id, ledger_id, acked_at)
         VALUES ($1, $2, $3, $4, clock_timestamp())`,
        [deviceId, version, w.ops.a, ledgerId],
      ),
    );
  const batch = (deviceId: string, ledgerId: string, seq: number) =>
    withOwner((db) =>
      db.query(
        `INSERT INTO offline_batch (id, operator_id, device_id, ledger_id, seq_from, seq_to, op_hashes,
                prev_chain_hash, last_chain_hash, signature, status, chain_status, results, received_at,
                completed_at)
         VALUES ($1, $2, $3, $4, $5, $5, ARRAY[sha256('x')], sha256('p'), sha256('l'), '\\x01',
                 'COMPLETED', 'VERIFIED', '[]'::jsonb, clock_timestamp(), clock_timestamp())`,
        [randomUUID(), w.ops.a, deviceId, ledgerId, seq],
      ),
    );

  beforeAll(async () => {
    w = await createMediaWorld();
    await withOwner(async (db) => {
      await goLive(db, w.ops.a, w.ids.eventA, w.operatorAdminA.userId);
      awa = await createTestCustomer(db, w.ops.a);
      perf = await createTestCustomer(db, w.ops.a);
      customerB = await createTestCustomer(db, w.ops.b);
      const make = async (customer: TestCustomer, ledgerId: string) =>
        (
          await createCustomerWallet(db, {
            operatorId: w.ops.a,
            ledgerId,
            customerId: customer.customerId,
          })
        ).walletId;
      walletLive = await make(awa, w.ids.ledgerA);
      const live2 = await newEvent(db, 'LIVE', 'Événement 2');
      const closed = await newEvent(db, 'CLOSED', 'Événement clos');
      ledgerLive2 = live2.ledgerId;
      ledgerClosed = closed.ledgerId;
      walletLive2 = await make(awa, ledgerLive2);
      walletClosed = await make(awa, ledgerClosed);
      devices.live = await newDevice(db, w.ids.eventA, 'ACTIVE');
      devices.revoked = await newDevice(db, live2.eventId, 'REVOKED');
      devices.live2 = await newDevice(db, live2.eventId, 'ACTIVE');
      devices.closed = await newDevice(db, closed.eventId, 'ACTIVE');
      for (let i = 0; i < 5; i += 1) await make(perf, w.ids.ledgerA);

      const lot = await createBatch(db, {
        operatorId: w.ops.a,
        organizerId: w.ids.organizerA,
        eventId: w.ids.eventA,
        status: 'ACTIVE',
      });
      const media = await seedPersonalizedMedia(db, {
        operatorId: w.ops.a,
        batchId: lot,
        kmsKeyRef: w.keyRef.a,
        count: 2,
      });
      mediaNumbered = media[0]!.id;
      mediaPlain = media[1]!.id;
      await activateMedia(db, {
        operatorId: w.ops.a,
        eventId: w.ids.eventA,
        walletId: walletLive,
        mediaIds: [mediaNumbered, mediaPlain],
      });
      await db.query('UPDATE media SET printed_number = $2 WHERE id = $1', [
        mediaNumbered,
        'K7-0042',
      ]);
      // Prestataire B : un bracelet portant un autre numéro, rattaché à un client de B.
      const eventB = randomUUID();
      await db.query(
        `INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id,
                            funds_holder)
         SELECT $1, $2, $3, 'Événement B', currency, timezone, jurisdiction_id, funds_holder
           FROM event WHERE id = $4`,
        [eventB, w.ops.b, w.ids.organizerB, w.ids.eventA],
      );
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [w.ops.b]);
      const ledgerB = (
        await db.query<{ ledger: string }>('SELECT open_event_ledger($1) AS ledger', [eventB])
      ).rows[0]!.ledger;
      walletB = (
        await createCustomerWallet(db, {
          operatorId: w.ops.b,
          ledgerId: ledgerB,
          customerId: customerB.customerId,
        })
      ).walletId;
      const lotB = await createBatch(db, {
        operatorId: w.ops.b,
        organizerId: w.ids.organizerB,
        eventId: eventB,
        status: 'ACTIVE',
      });
      const mb = await seedPersonalizedMedia(db, {
        operatorId: w.ops.b,
        batchId: lotB,
        kmsKeyRef: w.keyRef.b,
        count: 1,
      });
      mediaB = mb[0]!.id;
      await activateMedia(db, {
        operatorId: w.ops.b,
        eventId: eventB,
        walletId: walletB,
        mediaIds: [mediaB],
      });
      await db.query('UPDATE media SET printed_number = $2 WHERE id = $1', [mediaB, 'ZZ-B-0001']);
    });
    app = await createTestApp({ identity: w.idp });
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /me/media et /me/wallets : numéro imprimé lu en base, null sinon', async () => {
    const res = await get('/me/media', awa);
    expect(res.status).toBe(200);
    const byId = new Map<string, { printed_number: string | null }>(
      res.body.data.map((m: { media_id: string }) => [m.media_id, m]),
    );
    expect(byId.get(mediaNumbered)!.printed_number).toBe('K7-0042');
    expect(byId.get(mediaPlain)!.printed_number).toBeNull();
    for (const m of res.body.data) expect(contractViolations('CustomerMedia', m)).toEqual([]);
    const wallets = await get('/me/wallets', awa);
    const live = wallets.body.data.find((x: { wallet_id: string }) => x.wallet_id === walletLive);
    expect(
      live.media.map((m: { printed_number: string | null }) => m.printed_number).sort(),
    ).toEqual(['K7-0042', null]);
  });

  it('cloisonnement : le festivalier B ne voit ni le numéro ni l’avis d’un autre', async () => {
    const res = await get('/me/media', customerB);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ media_id: mediaB, printed_number: 'ZZ-B-0001' });
    const wallets = await get('/me/wallets', customerB);
    const text = JSON.stringify([res.body, wallets.body]);
    for (const secret of ['K7-0042', mediaNumbered, mediaPlain, walletLive, walletLive2])
      expect(text).not.toContain(secret);
    expect(JSON.stringify((await get('/me/media', awa)).body)).not.toContain('ZZ-B-0001');
  });

  it('reportMyMediaLost rend le même numéro imprimé que /me/media', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/me/media/${mediaNumbered}/report-lost`)
      .set('Idempotency-Key', randomUUID())
      .set(awa.headers);
    expect(res.status).toBe(200);
    expect(res.body.printed_number).toBe('K7-0042');
    expect(contractViolations('CustomerMedia', res.body)).toEqual([]);
  });

  it('pending_offline_notice : faux, vrai après un accusé sans lot, faux après la remontée (SC-004)', async () => {
    expect(await noticeOf(awa, walletLive)).toBe(false);
    await ack(devices.live, w.ids.ledgerA, 1);
    expect(await noticeOf(awa, walletLive)).toBe(true);
    // Un autre événement du même client garde sa propre valeur.
    expect(await noticeOf(awa, walletLive2)).toBe(false);
    await batch(devices.live, w.ids.ledgerA, 1);
    expect(await noticeOf(awa, walletLive)).toBe(false);
  });

  it('terminal révoqué ou événement CLOSED : l’avis reste faux ; autre événement : sa valeur', async () => {
    await ack(devices.revoked, ledgerLive2, 1);
    expect(await noticeOf(awa, walletLive2)).toBe(false);
    await ack(devices.live2, ledgerLive2, 1);
    expect(await noticeOf(awa, walletLive2)).toBe(true);
    expect(await noticeOf(awa, walletLive)).toBe(false);
    await ack(devices.closed, ledgerClosed, 1);
    expect(await noticeOf(awa, walletClosed)).toBe(false);
    // L'avis d'un client ne fuit pas chez un autre prestataire.
    expect(JSON.stringify((await get('/me/wallets', customerB)).body)).not.toContain(walletLive2);
  });

  it('getMe ne porte aucun portefeuille ni avis', async () => {
    const res = await get('/me', awa);
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('pending_offline_notice');
    expect(contractViolations('CustomerProfile', res.body)).toEqual([]);
  });

  latency(
    `NFR-004 : p95 de getMe et listMyWallets < ${NFR004_P95_MS} ms (5 portefeuilles)`,
    async () => {
      const wallets = await get('/me/wallets', perf);
      expect(wallets.body.data).toHaveLength(5);
      const measure = async (path: string) => {
        const durations: number[] = [];
        for (let i = 0; i < 30; i += 1) {
          const started = process.hrtime.bigint();
          const res = await get(path, perf);
          durations.push(Number(process.hrtime.bigint() - started) / 1e6);
          expect(res.status).toBe(200);
        }
        return p95(durations);
      };
      const me = await measure('/me');
      const list = await measure('/me/wallets');
      console.info(`NFR-004 p95 : getMe ${me.toFixed(1)} ms, listMyWallets ${list.toFixed(1)} ms`);
      expect(me).toBeLessThan(NFR004_P95_MS);
      expect(list).toBeLessThan(NFR004_P95_MS);
    },
  );
});
