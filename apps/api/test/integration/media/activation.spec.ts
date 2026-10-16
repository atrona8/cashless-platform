// Intégration : activation d'un bracelet au guichet et consultation (FR-021, FR-024 ; SPECIFICATION §7.8 ; contrat
// `activateMedia`, `getMedia`, `listMedia`, `getMediaAdmin`). Route de guichet : un terminal ET une personne.
import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { createTestCustomer } from '../../support/fake-customer';
import { createTestDevice, type TestDevice } from '../../support/fake-device';
import type { TestPerson } from '../../support/fake-idp';
import {
  activateMedia,
  createBatch,
  createMediaWorld,
  ledgerIsSound,
  ownerRows as rows,
  seedPersonalizedMedia,
  tapBody,
  type MediaWorld,
  type SeededMedia,
} from '../../support/media-fixtures';

describe('activation d’un bracelet au guichet', () => {
  let w: MediaWorld;
  let app: INestApplication;
  let device: TestDevice;
  let deviceB: TestDevice;
  let batch: string;
  let preloaded: string;
  let counter = 0;
  const next = () => (counter += 1);
  const call = (
    method: 'get' | 'post',
    who: { device?: TestDevice | null; person?: TestPerson | null },
    path: string,
    body?: object,
    key: string | null = randomUUID(),
    language?: string,
  ) => {
    let req = request(app.getHttpServer())[method](path);
    if (who.device) req = req.set(who.device.headers);
    if (who.person) req = req.set('Authorization', `Bearer ${who.person.token}`);
    if (key !== null && method === 'post') req = req.set('Idempotency-Key', key);
    if (language) req = req.set('Accept-Language', language);
    return method === 'post' ? req.send(body ?? {}) : req;
  };
  const desk = () => ({ device, person: w.cashierA });
  const activation = (m: SeededMedia, overrides: Record<string, unknown> = {}) => ({
    tap: tapBody(m, next()),
    channel: 'DESK',
    occurred_at: new Date().toISOString(),
    ...overrides,
  });
  const fresh = (batchId: string = batch, count = 1) =>
    withOwner((db) =>
      seedPersonalizedMedia(db, { operatorId: w.ops.a, batchId, kmsKeyRef: w.keyRef.a, count }),
    );
  const media = (m: SeededMedia) =>
    rows<{ status: string; wallet_id: string | null }>(
      'SELECT status, wallet_id FROM media WHERE id = $1',
      [m.id],
    ).then((r) => r[0]!);

  beforeAll(async () => {
    w = await createMediaWorld();
    await withOwner(async (db) => {
      device = await createTestDevice(db, { operatorId: w.ops.a, eventId: w.ids.eventA });
      deviceB = await createTestDevice(db, { operatorId: w.ops.b });
      batch = await createBatch(db, {
        operatorId: w.ops.a,
        organizerId: w.ids.organizerA,
        eventId: w.ids.eventA,
        status: 'ACTIVE',
        quantity: 1000,
      });
      preloaded = await createBatch(db, {
        operatorId: w.ops.a,
        organizerId: w.ids.organizerA,
        eventId: w.ids.eventA,
        status: 'ACTIVE',
        kind: 'STAFF',
        preloadPromoAmount: 1500,
      });
    });
    app = await createTestApp({ identity: w.idp });
  });

  afterAll(async () => {
    await app.close();
  });

  it('active un bracelet en stock : portefeuille anonyme créé au grand livre de l’événement, avec ses deux comptes', async () => {
    const [m] = await fresh();
    const res = await call('post', desk(), '/v1/media/activations', activation(m!));
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      media_id: m!.id,
      media_status: 'ACTIVE',
      wallet: {
        wallet_id: expect.any(String),
        status: 'ACTIVE',
        currency: 'XOF',
        spendable: 0,
        paid: 0,
        promo: 0,
      },
      deposit: { status: 'NONE', amount: 0, mode: null, transaction_id: null },
    });
    const walletId = res.body.wallet.wallet_id as string;
    expect(await media(m!)).toEqual({ status: 'ACTIVE', wallet_id: walletId });
    expect(
      await rows('SELECT ledger_id, customer_id FROM wallet WHERE id = $1', [walletId]),
    ).toEqual([{ ledger_id: w.ids.ledgerA, customer_id: null }]);
    expect(
      await rows('SELECT purpose FROM account WHERE wallet_id = $1 ORDER BY purpose', [walletId]),
    ).toEqual([{ purpose: 'WALLET_PAID' }, { purpose: 'WALLET_PROMO' }]);
    expect(
      await rows(
        'SELECT to_status, actor_id FROM media_status_history WHERE media_id = $1 ORDER BY id',
        [m!.id],
      ),
    ).toEqual([
      { to_status: 'PERSONALIZED', actor_id: null },
      { to_status: 'ISSUED', actor_id: w.cashierA.userId },
      { to_status: 'ACTIVE', actor_id: w.cashierA.userId },
    ]);
    expect(
      await rows(
        `SELECT actor_id, actor_role, origin, after->>'wallet_created' AS created FROM audit_log WHERE operator_id = $1 AND object_id = $2 AND action = 'MEDIA_ACTIVATED'`,
        [w.ops.a, m!.id],
      ),
    ).toEqual([
      {
        actor_id: w.cashierA.userId,
        actor_role: 'CASHIER',
        origin: `device:${device.deviceId}`,
        created: 'true',
      },
    ]);
    // Le bracelet répond maintenant OK à une lecture.
    const tap = await request(app.getHttpServer())
      .post('/v1/taps')
      .set(device.headers)
      .send(tapBody(m!, next()));
    expect(tap.body).toMatchObject({ result: 'OK', wallet: { wallet_id: walletId } });
  });

  it('crédits offerts du lot posés une seule fois, même si la demande est rejouée', async () => {
    const [m] = await fresh(preloaded);
    const key = randomUUID();
    const body = activation(m!);
    const first = await call('post', desk(), '/v1/media/activations', body, key);
    expect(first.status).toBe(201);
    expect(first.body.wallet).toMatchObject({ spendable: 1500, paid: 0, promo: 1500 });
    const replay = await call('post', desk(), '/v1/media/activations', body, key);
    expect(replay.status).toBe(201);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body).toEqual(first.body);
    expect(
      await rows(
        `SELECT count(*)::int AS n FROM journal_transaction WHERE media_id = $1 AND type = 'PROMO_CREDIT'`,
        [m!.id],
      ),
    ).toEqual([{ n: 1 }]);
    // Une nouvelle demande pour le même bracelet : il est déjà actif.
    const again = await call('post', desk(), '/v1/media/activations', activation(m!));
    expect(again.status).toBe(409);
    expect(
      await rows(
        `SELECT count(*)::int AS n FROM journal_transaction WHERE media_id = $1 AND type = 'PROMO_CREDIT'`,
        [m!.id],
      ),
    ).toEqual([{ n: 1 }]);
    expect(await ledgerIsSound(w.ids.ledgerA)).toEqual({ unbalanced: 0, drift: 0 });
  });

  it('portefeuille existant ou compte festivalier : rattachement sans création superflue', async () => {
    const [a, b, c] = await fresh(batch, 3);
    const first = await call('post', desk(), '/v1/media/activations', activation(a!));
    const walletId = first.body.wallet.wallet_id as string;
    // Un portefeuille déjà ouvert (ici celui d'un premier bracelet) reçoit un second bracelet.
    const second = await call(
      'post',
      desk(),
      '/v1/media/activations',
      activation(b!, { wallet_id: walletId }),
    );
    expect(second.status).toBe(201);
    expect(second.body.wallet.wallet_id).toBe(walletId);
    const customer = await withOwner((db) => createTestCustomer(db, w.ops.a));
    const third = await call(
      'post',
      desk(),
      '/v1/media/activations',
      activation(c!, { customer_id: customer.customerId }),
    );
    expect(third.status).toBe(201);
    expect(
      await rows('SELECT customer_id FROM wallet WHERE id = $1', [third.body.wallet.wallet_id]),
    ).toEqual([{ customer_id: customer.customerId }]);
  });

  describe('refus', () => {
    const untouched = async (m: SeededMedia) => {
      expect(await media(m)).toEqual({ status: 'PERSONALIZED', wallet_id: null });
    };

    it('sans lecture embarquée : 422, règle citée en français et en anglais', async () => {
      const [m] = await fresh();
      const fr = await call('post', desk(), '/v1/media/activations', {
        tap_id: 12,
        channel: 'DESK',
        occurred_at: new Date().toISOString(),
      });
      const en = await call(
        'post',
        desk(),
        '/v1/media/activations',
        { tap_id: 12, channel: 'DESK', occurred_at: new Date().toISOString() },
        randomUUID(),
        'en',
      );
      expect(fr.status).toBe(422);
      expect(fr.body.rule).toBe('activation.tap_required');
      expect(en.body.rule).toBe('activation.tap_required');
      expect(en.body.detail).not.toBe(fr.body.detail);
      await untouched(m!);
    });

    it('mode d’activation non permis par l’événement : 422 ACTIVATION_MODE_NOT_ALLOWED', async () => {
      const [m] = await fresh();
      const res = await call(
        'post',
        desk(),
        '/v1/media/activations',
        activation(m!, { channel: 'FIRST_TOPUP' }),
      );
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('ACTIVATION_MODE_NOT_ALLOWED');
      await untouched(m!);
    });

    it('une autre puce que celle de la personnalisation (UID ou signature) : refusée, rien n’est activé', async () => {
      const [m] = await fresh();
      const uid = await call('post', desk(), '/v1/media/activations', {
        ...activation(m!),
        tap: tapBody(m!, next(), {
          nfc_uid: Buffer.concat([Buffer.from([0x04]), randomBytes(6)]).toString('hex'),
        }),
      });
      expect(uid.body.code).toBe('MEDIA_UID_MISMATCH');
      const signature = await call('post', desk(), '/v1/media/activations', {
        ...activation(m!),
        tap: tapBody(m!, next(), { originality_signature: randomBytes(32).toString('hex') }),
      });
      expect(signature.body.code).toBe('MEDIA_SIGNATURE_MISMATCH');
      const missing = await call('post', desk(), '/v1/media/activations', {
        ...activation(m!),
        tap: tapBody(m!, next(), { originality_signature: undefined }),
      });
      expect(missing.body.code).toBe('MEDIA_SIGNATURE_MISSING');
      await untouched(m!);
    });

    it('bracelet inconnu, lot suspendu, lot d’un autre événement, portefeuille d’ailleurs, compte inconnu', async () => {
      const [m] = await fresh();
      expect(
        (
          await call(
            'post',
            desk(),
            '/v1/media/activations',
            activation({ ...m!, tokenHash: randomBytes(32) }),
          )
        ).body.code,
      ).toBe('MEDIA_UNKNOWN');
      const { suspended, elsewhere } = await withOwner(async (db) => {
        const other = randomUUID();
        await db.query(
          `INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder)
           SELECT $1, operator_id, organizer_id, 'Autre événement', currency, timezone, jurisdiction_id, funds_holder FROM event WHERE id = $2`,
          [other, w.ids.eventA],
        );
        const s = await createBatch(db, {
          operatorId: w.ops.a,
          organizerId: w.ids.organizerA,
          eventId: w.ids.eventA,
          status: 'ACTIVE',
        });
        const e = await createBatch(db, {
          operatorId: w.ops.a,
          organizerId: w.ids.organizerA,
          eventId: other,
          status: 'ACTIVE',
        });
        const seeded = {
          suspended: (
            await seedPersonalizedMedia(db, {
              operatorId: w.ops.a,
              batchId: s,
              kmsKeyRef: w.keyRef.a,
              count: 1,
            })
          )[0]!,
          elsewhere: (
            await seedPersonalizedMedia(db, {
              operatorId: w.ops.a,
              batchId: e,
              kmsKeyRef: w.keyRef.a,
              count: 1,
            })
          )[0]!,
        };
        await db.query(`UPDATE media_batch SET status = 'SUSPENDED' WHERE id = $1`, [s]);
        return seeded;
      });
      expect(
        (await call('post', desk(), '/v1/media/activations', activation(suspended))).body.code,
      ).toBe('MEDIA_BATCH_INACTIVE');
      expect(
        (await call('post', desk(), '/v1/media/activations', activation(elsewhere))).body.code,
      ).toBe('MEDIA_WRONG_EVENT');
      expect(
        (
          await call(
            'post',
            desk(),
            '/v1/media/activations',
            activation(m!, { wallet_id: randomUUID() }),
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await call(
            'post',
            desk(),
            '/v1/media/activations',
            activation(m!, { wallet_id: w.ids.walletA, customer_id: null }),
          )
        ).status,
      ).toBe(201);
      const [n] = await fresh();
      expect(
        (
          await call(
            'post',
            desk(),
            '/v1/media/activations',
            activation(n!, { customer_id: randomUUID() }),
          )
        ).body.rule,
      ).toBe('activation.customer_unknown');
      await untouched(n!);
      await untouched(suspended);
      await untouched(elsewhere);
    });

    it('événement qui exige un compte : refus sans compte, activation avec', async () => {
      const [m] = await fresh();
      await rows(`UPDATE event SET identity_mode = 'ACCOUNT_REQUIRED' WHERE id = $1`, [
        w.ids.eventA,
      ]);
      try {
        const res = await call('post', desk(), '/v1/media/activations', activation(m!));
        expect(res.status).toBe(422);
        expect(res.body.code).toBe('ACCOUNT_REQUIRED');
        await untouched(m!);
        const customer = await withOwner((db) => createTestCustomer(db, w.ops.a));
        expect(
          (
            await call(
              'post',
              desk(),
              '/v1/media/activations',
              activation(m!, { customer_id: customer.customerId }),
            )
          ).status,
        ).toBe(201);
      } finally {
        await rows(`UPDATE event SET identity_mode = 'ANONYMOUS_ALLOWED' WHERE id = $1`, [
          w.ids.eventA,
        ]);
      }
    });

    it('corps mal formé : 400 ; sans clé d’idempotence : 400', async () => {
      const [m] = await fresh();
      for (const overrides of [
        { channel: 'SELF_APP' },
        { occurred_at: 'hier' },
        { wallet_id: 'abc' },
        { deposit_payment: { method: 'CHEQUE' } },
        { tap: { nfc_uid: 'zz' } },
      ]) {
        expect(
          (await call('post', desk(), '/v1/media/activations', activation(m!, overrides))).status,
        ).toBe(400);
      }
      expect(
        (await call('post', desk(), '/v1/media/activations', activation(m!), null)).status,
      ).toBe(400);
      await untouched(m!);
    });
  });

  describe('qui peut activer', () => {
    it('un terminal ET une personne du guichet de cet événement', async () => {
      const [m] = await fresh();
      const body = () => activation(m!);
      expect(
        (await call('post', { device, person: null }, '/v1/media/activations', body())).status,
      ).toBe(401);
      expect(
        (await call('post', { device: null, person: w.cashierA }, '/v1/media/activations', body()))
          .status,
      ).toBe(401);
      for (const person of [w.operatorAdminA, w.organizerAdminA, w.personalizerA])
        expect(
          (await call('post', { device, person }, '/v1/media/activations', body())).status,
        ).toBe(403);
      // Personne d'un autre prestataire avec ce terminal, ou terminal d'un autre prestataire : rien.
      expect([403, 404]).toContain(
        (await call('post', { device, person: w.cashierB }, '/v1/media/activations', body()))
          .status,
      );
      expect([403, 404, 409]).toContain(
        (
          await call(
            'post',
            { device: deviceB, person: w.cashierA },
            '/v1/media/activations',
            body(),
          )
        ).status,
      );
      expect(await media(m!)).toEqual({ status: 'PERSONALIZED', wallet_id: null });
      // Le SUPERVISOR de l'organisateur peut aussi tenir le guichet.
      expect(
        (await call('post', { device, person: w.supervisorA }, '/v1/media/activations', body()))
          .status,
      ).toBe(201);
    });
  });

  describe('consultation', () => {
    let active: SeededMedia;
    let stock: SeededMedia;

    beforeAll(async () => {
      const seeded = await fresh(batch, 2);
      active = seeded[0]!;
      stock = seeded[1]!;
      await withOwner((db) =>
        activateMedia(db, {
          operatorId: w.ops.a,
          eventId: w.ids.eventA,
          walletId: w.ids.walletA,
          mediaIds: [active!.id],
        }),
      );
    });

    const secretsOf = (m: SeededMedia) => [
      m.tokenHash.toString('hex'),
      m.identity.toString('hex'),
      m.pwdPack.toString('hex'),
    ];

    it('au guichet : état du bracelet, sans identité ni mot de passe', async () => {
      const res = await call('get', desk(), `/v1/media/${active.id}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        media_id: active.id,
        kind: 'NFC_TAG',
        chip_type: 'MF0UL11',
        nfc_uid: active.uid,
        key_index: 1,
        status: 'ACTIVE',
        batch_id: batch,
        batch_kind: 'PUBLIC',
        deposit_status: 'NONE',
        deposit_held: 0,
        wallet_ids: [w.ids.walletA],
        last_counter: null,
      });
      for (const secret of secretsOf(active))
        expect(JSON.stringify(res.body)).not.toContain(secret);
      expect((await call('get', { device, person: null }, `/v1/media/${active.id}`)).status).toBe(
        401,
      );
      expect(
        (await call('get', { device, person: w.operatorAdminA }, `/v1/media/${active.id}`)).status,
      ).toBe(403);
      expect((await call('get', desk(), `/v1/media/${randomUUID()}`)).status).toBe(404);
    });

    it('au back-office : liste filtrée et paginée, détail avec l’historique des statuts', async () => {
      const path = `/v1/operators/${w.ops.a}/media`;
      const list = await call(
        'get',
        { person: w.organizerAdminA },
        `${path}?batch_id=${batch}&status=PERSONALIZED&limit=200`,
      );
      expect(list.status).toBe(200);
      const ids = (list.body.data as { media_id: string; status: string }[]).map((m) => m.media_id);
      expect(ids).toContain(stock.id);
      expect(ids).not.toContain(active.id);
      expect(
        (list.body.data as { status: string }[]).every((m) => m.status === 'PERSONALIZED'),
      ).toBe(true);
      const page = await call(
        'get',
        { person: w.operatorAdminA },
        `${path}?batch_id=${batch}&limit=1`,
      );
      expect(page.body).toMatchObject({ has_more: true, next_cursor: expect.any(String) });
      const detail = await call('get', { person: w.supervisorA }, `${path}/${active.id}`);
      expect(detail.status).toBe(200);
      expect(detail.body).toMatchObject({
        media_id: active.id,
        status: 'ACTIVE',
        kind: 'NFC_TAG',
        key_index: 1,
        batch_id: batch,
        batch_kind: 'PUBLIC',
        batch_status: 'ACTIVE',
        organizer_id: w.ids.organizerA,
        event_id: w.ids.eventA,
        deposit_status: 'NONE',
        deposit_held: 0,
        has_claim_code: false,
        claim_code_used_at: null,
        wallets: [
          {
            wallet_id: w.ids.walletA,
            currency: 'XOF',
            spendable: expect.any(Number),
            attached_to_account: false,
          },
        ],
      });
      expect(
        (detail.body.status_history as { to_status: string }[]).map((h) => h.to_status),
      ).toEqual(['PERSONALIZED', 'ISSUED', 'ACTIVE']);
      for (const body of [list.body, detail.body])
        for (const secret of [...secretsOf(active), ...secretsOf(stock)])
          expect(JSON.stringify(body)).not.toContain(secret);
      for (const bad of ['status=NOPE', 'batch_id=abc', 'limit=0'])
        expect((await call('get', { person: w.operatorAdminA }, `${path}?${bad}`)).status).toBe(
          400,
        );
    });

    it('rôles et isolation', async () => {
      const path = `/v1/operators/${w.ops.a}/media`;
      expect((await call('get', { person: w.personalizerA }, path)).status).toBe(403);
      expect((await call('get', { person: w.cashierB }, path)).status).toBe(404);
      expect(
        (await call('get', { person: w.cashierB }, `/v1/operators/${w.ops.b}/media/${active.id}`))
          .status,
      ).toBe(404);
      expect(
        (await call('get', { person: w.cashierB }, `/v1/operators/${w.ops.b}/media`)).body.data,
      ).toEqual([]);
      expect(
        (await call('get', { device: deviceB, person: w.cashierB }, `/v1/media/${active.id}`))
          .status,
      ).not.toBe(200);
      expect(
        (await call('get', { person: w.organizerAdminA }, `${path}/${randomUUID()}`)).status,
      ).toBe(404);
    });
  });
});
