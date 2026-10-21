// Intégration : restitution d'un bracelet et remise en stock d'un lot réattribuable (FR-025 ;
// SPECIFICATION §7.8, §7.9 ; contrat `releaseMedia`, `reassignPoolMedia` ; spec US 6, scénarios 2
// et 3). Chaque refus nomme ce qui reste à faire ; l'API n'enchaîne pas le guichet de retour à la
// place de l'agent.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { createTestDevice, type TestDevice } from '../../support/fake-device';
import type { TestPerson } from '../../support/fake-idp';
import {
  createBatch,
  createMediaWorld,
  creditWallet,
  goLive,
  ledgerIsSound,
  openCashDesk,
  ownerRows as rows,
  seedPersonalizedMedia,
  tapBody,
  type MediaWorld,
  type SeededMedia,
} from '../../support/media-fixtures';

describe('restitution d’un bracelet', () => {
  let w: MediaWorld;
  let app: INestApplication;
  let device: TestDevice;
  let cashDesk: string;
  let plain: string; // lot sans caution, usage unique
  let separate: string; // caution payée à part
  let pool: string; // lot réattribuable
  let counter = 0;
  const next = () => (counter += 1);
  const post = (
    path: string,
    body: object = {},
    options: {
      key?: string;
      person?: TestPerson | null;
      device?: TestDevice;
      language?: string;
    } = {},
  ) => {
    let req = request(app.getHttpServer())
      .post(path)
      .set((options.device ?? device).headers)
      .set('Idempotency-Key', options.key ?? randomUUID());
    const person = options.person === undefined ? w.cashierA : options.person;
    if (person) req = req.set('X-Staff-Authorization', `Bearer ${person.token}`);
    if (options.language) req = req.set('Accept-Language', options.language);
    return req.send(body);
  };
  const fresh = (batchId: string) =>
    withOwner(
      async (db) =>
        (
          await seedPersonalizedMedia(db, {
            operatorId: w.ops.a,
            batchId,
            kmsKeyRef: w.keyRef.a,
            count: 1,
          })
        )[0]!,
    );
  const activate = async (m: SeededMedia, overrides: Record<string, unknown> = {}) => {
    const res = await post('/v1/media/activations', {
      tap: tapBody(m, next()),
      channel: 'DESK',
      occurred_at: new Date().toISOString(),
      ...overrides,
    });
    expect(res.status).toBe(201);
    return res.body.wallet.wallet_id as string;
  };
  const status = (id: string) =>
    rows<{ status: string }>('SELECT status FROM media WHERE id = $1', [id]).then(
      (r) => r[0]!.status,
    );
  /**
   * Espèces dues au détenteur, comme après une recharge hors ligne au-delà d'un plafond (écriture,
   * puis anomalie).
   */
  const owe = (m: SeededMedia, amount: number) =>
    withOwner(async (db) => {
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [w.ops.a]);
      await db.query(
        `SELECT post_transaction($1, 'TOPUP_CASH', $2, now(), 'OFFLINE_SYNC', jsonb_build_array(
           jsonb_build_object('account_id', (SELECT id FROM account WHERE ledger_id = $1 AND code = $3), 'amount', $4::bigint),
           jsonb_build_object('account_id', (SELECT id FROM account WHERE ledger_id = $1 AND purpose = 'CUSTOMER_CASH_DUE'), 'amount', -$4::bigint)))`,
        [w.ids.ledgerA, `test-cash-over:${randomUUID()}`, cashDesk, amount],
      );
      await db.query(
        `INSERT INTO anomaly (operator_id, ledger_id, kind, media_id, amount) VALUES ($1, $2, 'CASH_TOPUP_OVER_LIMIT', $3, $4)`,
        [w.ops.a, w.ids.ledgerA, m.id, amount],
      );
    });
  const sound = async () =>
    expect(await ledgerIsSound(w.ids.ledgerA)).toEqual({ unbalanced: 0, drift: 0 });
  /** Terminal de l'autre prestataire, à un événement de son organisateur (avec son grand livre). */
  const foreignDevice = () =>
    withOwner(async (db) => {
      const eventB = randomUUID();
      await db.query(
        `INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder)
         SELECT $1, $2, $3, 'Événement B', currency, timezone, jurisdiction_id, funds_holder FROM event WHERE id = $4`,
        [eventB, w.ops.b, w.ids.organizerB, w.ids.eventA],
      );
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [w.ops.b]);
      await db.query('SELECT open_event_ledger($1)', [eventB]);
      return createTestDevice(db, { operatorId: w.ops.b, eventId: eventB });
    });

  beforeAll(async () => {
    w = await createMediaWorld();
    await withOwner(async (db) => {
      await goLive(db, w.ops.a, w.ids.eventA, w.operatorAdminA.userId);
      device = await createTestDevice(db, { operatorId: w.ops.a, eventId: w.ids.eventA });
      cashDesk = await openCashDesk(db, {
        operatorId: w.ops.a,
        ledgerId: w.ids.ledgerA,
        organizerId: w.ids.organizerA,
        serial: device.serial,
      });
      plain = await createBatch(db, {
        operatorId: w.ops.a,
        organizerId: w.ids.organizerA,
        eventId: w.ids.eventA,
        status: 'ACTIVE',
      });
      separate = await createBatch(db, {
        operatorId: w.ops.a,
        organizerId: w.ids.organizerA,
        eventId: w.ids.eventA,
        status: 'ACTIVE',
        depositAmount: 1000,
        depositMode: 'SEPARATE',
      });
      pool = await createBatch(db, {
        operatorId: w.ops.a,
        organizerId: w.ids.organizerA,
        eventId: w.ids.eventA,
        status: 'ACTIVE',
      });
      await db.query(`UPDATE media_batch SET reuse_policy = 'POOL' WHERE id = $1`, [pool]);
    });
    app = await createTestApp({ identity: w.idp });
  });

  afterAll(async () => {
    await app.close();
  });

  it('caution détenue, espèces dues, solde : chaque refus nomme ce qui reste à faire ; une fois soldé, le bracelet est rendu', async () => {
    const m = await fresh(separate);
    const walletId = await activate(m, { deposit_payment: { method: 'CASH' } });
    await withOwner((db) =>
      creditWallet(db, { operatorId: w.ops.a, ledgerId: w.ids.ledgerA, walletId, amount: 2500 }),
    );
    await owe(m, 700);
    const path = `/v1/media/${m.id}/release`;

    const held = await post(path, { tap: tapBody(m, next()) });
    expect(held.status).toBe(409);
    expect(held.body).toMatchObject({
      code: 'DEPOSIT_OUTSTANDING',
      rule: 'release.deposit_held',
      deposit_held: 1000,
    });
    expect(held.body.detail).toMatch(/refundDeposit/);
    const refund = await post(`/v1/media/${m.id}/deposit/refund`, {
      tap: tapBody(m, next()),
      payment: { method: 'CASH' },
    });
    expect(refund.body.status).toBe('REFUNDED');

    const due = await post(path, {});
    expect(due.status).toBe(409);
    expect(due.body).toMatchObject({
      code: 'MEDIA_STATE_INVALID',
      rule: 'release.cash_due',
      cash_due: 700,
    });
    expect(due.body.detail).toMatch(/refundCashDue/);
    await withOwner(async (db) => {
      // Rendu des espèces (prouvé par sa propre suite) : par la fonction du schéma, pour passer à
      // l'étape suivante.
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [w.ops.a]);
      await db.query(
        'SELECT refund_cash_due($1, (SELECT id FROM account WHERE ledger_id = $2 AND code = $3), $4, $5)',
        [m.id, w.ids.ledgerA, cashDesk, `test:${randomUUID()}`, w.cashierA.userId],
      );
    });

    const balance = await post(path, {}, { language: 'en' });
    expect(balance.status).toBe(409);
    expect(balance.body).toMatchObject({
      code: 'BALANCE_OUTSTANDING',
      rule: 'release.balance',
      balances: [{ wallet_id: walletId, currency: 'XOF', spendable: 2500 }],
    });
    expect(balance.body.detail).toMatch(/refunded or written off/);
    expect(await status(m.id)).toBe('ACTIVE');
    // Remboursement du solde payé (mission 9) : posé directement pour la suite du parcours.
    await withOwner(async (db) => {
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [w.ops.a]);
      await db.query(
        `SELECT post_transaction($1, 'WALLET_REFUND', $2, now(), 'ONLINE', jsonb_build_array(
           jsonb_build_object('account_id', (SELECT id FROM account WHERE wallet_id = $3 AND purpose = 'WALLET_PAID'), 'amount', 2500),
           jsonb_build_object('account_id', (SELECT id FROM account WHERE ledger_id = $1 AND purpose = 'BANK'), 'amount', -2500)))`,
        [w.ids.ledgerA, `test-refund:${randomUUID()}`, walletId],
      );
    });

    const key = randomUUID();
    const body = { tap: tapBody(m, next()) };
    const released = await post(path, body, { key });
    expect(released.status).toBe(200);
    expect(released.body).toEqual({
      media_id: m.id,
      media_status: 'RELEASED',
      deposit_refund_transaction_id: null,
      promo_expiry_transaction_id: null,
      balance_refund_transaction_id: null,
      cash_to_hand_back: 0,
    });
    expect(await rows('SELECT status, wallet_id FROM media WHERE id = $1', [m.id])).toEqual([
      { status: 'RELEASED', wallet_id: null },
    ]);
    expect(
      await rows(`SELECT release_reason FROM media_assignment WHERE media_id = $1`, [m.id]),
    ).toEqual([{ release_reason: 'RETURNED' }]);
    expect(
      await rows(
        `SELECT actor_id, reason FROM media_status_history WHERE media_id = $1 AND to_status = 'RELEASED'`,
        [m.id],
      ),
    ).toEqual([{ actor_id: w.cashierA.userId, reason: 'RETURNED' }]);
    expect(
      await rows(
        `SELECT actor_id FROM audit_log WHERE operator_id = $1 AND object_id = $2 AND action = 'MEDIA_RELEASED'`,
        [w.ops.a, m.id],
      ),
    ).toEqual([{ actor_id: w.cashierA.userId }]);
    // Rejeu : même réponse ; nouvelle demande : déjà rendu, rien de plus.
    const replay = await post(path, body, { key });
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body).toEqual(released.body);
    expect((await post(path, {})).body).toMatchObject({ media_status: 'RELEASED' });
    expect(
      await rows(
        `SELECT count(*)::int AS n FROM audit_log WHERE object_id = $1 AND action = 'MEDIA_RELEASED'`,
        [m.id],
      ),
    ).toEqual([{ n: 1 }]);
    // Le bracelet rendu ne paie plus.
    expect(
      (
        await request(app.getHttpServer())
          .post('/v1/taps')
          .set(device.headers)
          .send(tapBody(m, next()))
      ).body.result,
    ).toBe('RELEASED');
    await sound();
  });

  it('le serveur n’enchaîne pas le guichet de retour : refund_deposit_by et settle_balance refusés (422, règle citée)', async () => {
    const m = await fresh(plain);
    await activate(m);
    for (const body of [
      { settle_balance: { method: 'CASH' } },
      { refund_deposit_by: { method: 'CASH' } },
    ]) {
      const res = await post(`/v1/media/${m.id}/release`, body);
      expect(res.status).toBe(422);
      expect(res.body.rule).toBe('release.no_chaining');
    }
    expect(await status(m.id)).toBe('ACTIVE');
  });

  it('lecture d’un autre bracelet : refusée ; pendant que la passerelle a l’autorité : 409 DEBIT_AUTHORITY_EDGE', async () => {
    const m = await fresh(plain);
    const other = await fresh(plain);
    await activate(m);
    await activate(other);
    const wrong = await post(`/v1/media/${m.id}/release`, { tap: tapBody(other, next()) });
    expect(wrong.status).toBe(422);
    expect(wrong.body.rule).toBe('return.wrong_media');
    await rows(`UPDATE ledger SET debit_authority = 'EDGE' WHERE id = $1`, [w.ids.ledgerA]);
    try {
      const edge = await post(`/v1/media/${m.id}/release`, {});
      expect(edge.status).toBe(409);
      expect(edge.body.code).toBe('DEBIT_AUTHORITY_EDGE');
    } finally {
      await rows(`UPDATE ledger SET debit_authority = 'CENTRAL' WHERE id = $1`, [w.ids.ledgerA]);
    }
    expect(await status(m.id)).toBe('ACTIVE');
  });

  it('bracelet suspendu (déclaré perdu) : la base refuse la restitution (409 MEDIA_STATE_INVALID)', async () => {
    const m = await fresh(plain);
    await activate(m);
    await rows(`SELECT set_config('app.operator_id', $1, false), suspend_media($2, 'perdu', $3)`, [
      w.ops.a,
      m.id,
      w.cashierA.userId,
    ]);
    const res = await post(`/v1/media/${m.id}/release`, {});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('MEDIA_STATE_INVALID');
    expect(await status(m.id)).toBe('SUSPENDED');
  });

  describe('lot réattribuable (POOL)', () => {
    it('rendu puis remis en stock avec une nouvelle identité : l’ancienne présentée ensuite est une copie (CLONE_SUSPECTED, RETIRED_IDENTITY)', async () => {
      const m = await fresh(pool);
      await activate(m);
      expect((await post(`/v1/media/${m.id}/release`, { tap: tapBody(m, next()) })).status).toBe(
        200,
      );
      const identity = randomBytes(16);
      const newHash = createHash('sha256').update(identity).digest();
      const key = randomUUID();
      const res = await post(
        `/v1/media/${m.id}/reassignment`,
        { new_token_hash: newHash.toString('hex') },
        { key },
      );
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ media_id: m.id, media_status: 'ISSUED' });
      expect(
        (
          await post(
            `/v1/media/${m.id}/reassignment`,
            { new_token_hash: newHash.toString('hex') },
            { key },
          )
        ).body,
      ).toEqual(res.body);
      expect(await rows('SELECT status, token_hash FROM media WHERE id = $1', [m.id])).toEqual([
        { status: 'ISSUED', token_hash: newHash },
      ]);
      expect(
        await rows(
          `SELECT actor_id, reason FROM media_status_history WHERE media_id = $1 AND to_status = 'ISSUED' AND from_status = 'RELEASED'`,
          [m.id],
        ),
      ).toEqual([{ actor_id: w.cashierA.userId, reason: 'REASSIGNED' }]);
      expect(
        await rows(
          `SELECT count(*)::int AS n FROM audit_log WHERE object_id = $1 AND action = 'MEDIA_REASSIGNED'`,
          [m.id],
        ),
      ).toEqual([{ n: 1 }]);

      // L'ancien détenteur présente une copie de l'ancienne identité.
      const copy = await request(app.getHttpServer())
        .post('/v1/taps')
        .set(device.headers)
        .send(tapBody(m, next()));
      expect(copy.body.result).toBe('CLONE_SUSPECTED');
      expect(
        await rows(`SELECT kind FROM anomaly WHERE media_id = $1 AND kind = 'RETIRED_IDENTITY'`, [
          m.id,
        ]),
      ).toEqual([{ kind: 'RETIRED_IDENTITY' }]);
    });

    it('refus : lot à usage unique, bracelet non rendu, identité déjà connue', async () => {
      const single = await fresh(plain);
      await activate(single);
      expect((await post(`/v1/media/${single.id}/release`, {})).status).toBe(200);
      const hash = () => randomBytes(32).toString('hex');
      const notPool = await post(`/v1/media/${single.id}/reassignment`, { new_token_hash: hash() });
      expect(notPool.status).toBe(409);
      expect(notPool.body).toMatchObject({
        code: 'MEDIA_STATE_INVALID',
        rule: 'reassign.not_pool',
      });
      expect(await status(single.id)).toBe('RELEASED');

      const active = await fresh(pool);
      await activate(active);
      const notReleased = await post(`/v1/media/${active.id}/reassignment`, {
        new_token_hash: hash(),
      });
      expect(notReleased.status).toBe(409);
      expect(notReleased.body).toMatchObject({
        rule: 'reassign.not_released',
        media_status: 'ACTIVE',
      });

      const rendered = await fresh(pool);
      await activate(rendered);
      expect((await post(`/v1/media/${rendered.id}/release`, {})).status).toBe(200);
      // L'identité d'un bracelet en service, puis une identité passée (celle du bracelet lui-même)
      // : refusées.
      for (const known of [active.tokenHash, rendered.tokenHash]) {
        const res = await post(`/v1/media/${rendered.id}/reassignment`, {
          new_token_hash: known.toString('hex'),
        });
        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({ code: 'CONFLICT_STATE', rule: 'reassign.identity_known' });
      }
      expect(
        (await post(`/v1/media/${rendered.id}/reassignment`, { new_token_hash: 'XYZ' })).status,
      ).toBe(400);
      expect(
        (await post(`/v1/media/${rendered.id}/reassignment`, { new_token_hash: hash(), extra: 1 }))
          .status,
      ).toBe(400);
      expect(await status(rendered.id)).toBe('RELEASED');
    });
  });

  it('rôles et isolation à deux prestataires', async () => {
    const m = await fresh(plain);
    await activate(m);
    const path = `/v1/media/${m.id}/release`;
    expect((await post(path, {}, { person: null })).status).toBe(401);
    for (const person of [w.operatorAdminA, w.organizerAdminA, w.personalizerA])
      expect((await post(path, {}, { person })).status).toBe(403);
    // Terminal de l'autre prestataire (et sa personne) : le bracelet n'existe pas pour lui.
    // Personne d'un autre prestataire que le terminal : comme un terminal inconnu. Réponse neutre,
    // sans l'identifiant du bracelet.
    const deviceB = await foreignDevice();
    const refusals = [
      await post(path, {}, { person: w.cashierB, device: deviceB }),
      await post(path, {}, { person: w.cashierB }),
      await post(
        `/v1/media/${m.id}/reassignment`,
        { new_token_hash: randomBytes(32).toString('hex') },
        { person: w.cashierB, device: deviceB },
      ),
      await post(
        `/v1/media/${m.id}/reassignment`,
        { new_token_hash: randomBytes(32).toString('hex') },
        { person: w.cashierB },
      ),
    ];
    for (const res of refusals) {
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
      expect(JSON.stringify(res.body)).not.toContain(m.id);
    }
    expect(await status(m.id)).toBe('ACTIVE');
    expect((await post(`/v1/media/${randomUUID()}/release`, {})).status).toBe(404);
    // Le SUPERVISOR de l'organisateur agit aussi.
    expect((await post(path, {}, { person: w.supervisorA })).status).toBe(200);
  });
});
