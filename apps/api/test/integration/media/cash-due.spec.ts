// Intégration : rendu au guichet des espèces dues à un détenteur (FR-026 ; ADR-63, ADR-74 ; contrat
// `refundCashDue` ; spec US 6, scénario 4). Les espèces dues sont créées par jeu d'essai fidèle au
// schéma (recharge espèces hors ligne au-delà d'un plafond : écriture qui crédite L-ESP-A-RENDRE,
// puis anomalie CASH_TOPUP_OVER_LIMIT du bracelet). Au-delà du maximum de l'événement, une seconde
// personne valide sur place.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { actHash } from '../../../src/approval/onsite/act-hash';
import { createTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { createTestDevice, type TestDevice } from '../../support/fake-device';
import type { TestPerson } from '../../support/fake-idp';
import {
  createBatch,
  createMediaWorld,
  goLive,
  ledgerIsSound,
  openCashDesk,
  openCashSession,
  ownerRows as rows,
  seedPersonalizedMedia,
  tapBody,
  type MediaWorld,
  type SeededMedia,
} from '../../support/media-fixtures';

describe('espèces dues rendues au guichet', () => {
  let w: MediaWorld;
  let app: INestApplication;
  let device: TestDevice; // caisse ouverte
  let other: TestDevice; // second terminal à caisse ouverte
  let noDesk: TestDevice;
  let session: { sessionId: string; accountId: string; code: string };
  let otherSession: { sessionId: string; accountId: string; code: string };
  let cashDesk: string;
  let batch: string;
  let supervisorEvent: TestPerson; // SUPERVISOR de l'événement A, valideur
  let counter = 0;
  const next = () => (counter += 1);
  const path = (m: SeededMedia) => `/v1/media/${m.id}/cash-due-refunds`;
  const post = (
    m: SeededMedia,
    body: object,
    options: {
      key?: string;
      person?: TestPerson | null;
      device?: TestDevice;
      token?: string;
      language?: string;
    } = {},
  ) => {
    let req = request(app.getHttpServer())
      .post(path(m))
      .set((options.device ?? device).headers)
      .set('Idempotency-Key', options.key ?? randomUUID());
    const person = options.person === undefined ? w.cashierA : options.person;
    if (person) req = req.set('X-Staff-Authorization', `Bearer ${person.token}`);
    if (options.token) req = req.set('X-Approval-Token', options.token);
    if (options.language) req = req.set('Accept-Language', options.language);
    return req.send(body);
  };
  const approval = (who: TestPerson, m: SeededMedia, body: object, act = 'refundCashDue') =>
    w.idp.approvalToken({ subject: who.subject, act, actHash: actHash('POST', path(m), body) });
  const fresh = () =>
    withOwner(
      async (db) =>
        (
          await seedPersonalizedMedia(db, {
            operatorId: w.ops.a,
            batchId: batch,
            kmsKeyRef: w.keyRef.a,
            count: 1,
          })
        )[0]!,
    );
  const activated = async () => {
    const m = await fresh();
    const res = await request(app.getHttpServer())
      .post('/v1/media/activations')
      .set(device.headers)
      .set('Idempotency-Key', randomUUID())
      .set('X-Staff-Authorization', `Bearer ${w.cashierA.token}`)
      .send({ tap: tapBody(m, next()), channel: 'DESK', occurred_at: new Date().toISOString() });
    expect(res.status).toBe(201);
    return m;
  };
  /**
   * Recharge espèces hors ligne au-delà d'un plafond : le surplus est crédité à L-ESP-A-RENDRE, et
   * l'anomalie ouverte.
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
      return (
        await db.query<{ id: string }>(
          `INSERT INTO anomaly (operator_id, ledger_id, kind, media_id, amount) VALUES ($1, $2, 'CASH_TOPUP_OVER_LIMIT', $3, $4) RETURNING id`,
          [w.ops.a, w.ids.ledgerA, m.id, amount],
        )
      ).rows[0]!.id;
    });
  const openAnomalies = (m: SeededMedia) =>
    rows<{ n: number }>(
      `SELECT count(*)::int AS n FROM anomaly WHERE media_id = $1 AND kind = 'CASH_TOPUP_OVER_LIMIT' AND status = 'OPEN'`,
      [m.id],
    ).then((r) => r[0]!.n);
  const cashDueBalance = () =>
    rows<{ b: string }>(
      `SELECT coalesce(sum(p.amount), 0)::text AS b FROM posting p JOIN account a ON a.id = p.account_id WHERE a.ledger_id = $1 AND a.purpose = 'CUSTOMER_CASH_DUE'`,
      [w.ids.ledgerA],
    ).then((r) => Number(r[0]!.b));
  const sound = async () =>
    expect(await ledgerIsSound(w.ids.ledgerA)).toEqual({ unbalanced: 0, drift: 0 });
  const tapNow = (m: SeededMedia) =>
    request(app.getHttpServer()).post('/v1/taps').set(device.headers).send(tapBody(m, next()));
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
      device = await createTestDevice(db, {
        operatorId: w.ops.a,
        eventId: w.ids.eventA,
        kind: 'TOPUP',
      });
      other = await createTestDevice(db, {
        operatorId: w.ops.a,
        eventId: w.ids.eventA,
        kind: 'TOPUP',
      });
      noDesk = await createTestDevice(db, { operatorId: w.ops.a, eventId: w.ids.eventA });
      cashDesk = await openCashDesk(db, {
        operatorId: w.ops.a,
        ledgerId: w.ids.ledgerA,
        organizerId: w.ids.organizerA,
        serial: device.serial,
      });
      session = await openCashSession(db, {
        operatorId: w.ops.a,
        deviceId: device.deviceId,
        userId: w.cashierA.userId,
      });
      otherSession = await openCashSession(db, {
        operatorId: w.ops.a,
        deviceId: other.deviceId,
        userId: w.cashierA.userId,
      });
      batch = await createBatch(db, {
        operatorId: w.ops.a,
        organizerId: w.ids.organizerA,
        eventId: w.ids.eventA,
        status: 'ACTIVE',
      });
      await db.query('UPDATE event SET cash_refund_single_max = 10000 WHERE id = $1', [
        w.ids.eventA,
      ]);
      supervisorEvent = await w.idp.createPerson(db, {
        operatorId: w.ops.a,
        roles: [{ role: 'SUPERVISOR', scopeType: 'EVENT', scopeId: w.ids.eventA }],
      });
    });
    app = await createTestApp({ identity: w.idp });
  });

  afterAll(async () => {
    await app.close();
  });

  it('sous le maximum : écriture passée, anomalies closes, lecture consommée ; rejeu identique ; plus rien dû ensuite', async () => {
    const m = await activated();
    const a1 = await owe(m, 3000);
    const a2 = await owe(m, 4000);
    const dueBefore = await cashDueBalance();
    const key = `${device.serial}:${next()}`;
    const body = { tap: tapBody(m, next()), approved_by: w.cashierA.userId };
    const res = await post(m, body, { key });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      transaction_id: expect.any(String),
      idempotency_key: key,
      media_id: m.id,
      amount: 7000,
      currency: 'XOF',
      resolved_anomaly_ids: [a1, a2].sort(),
      approved_by: null,
      cash_session_id: session.sessionId,
    });
    expect(
      await rows('SELECT type, source, approved_by FROM journal_transaction WHERE id = $1', [
        res.body.transaction_id,
      ]),
    ).toEqual([{ type: 'WALLET_REFUND', source: 'ONLINE', approved_by: null }]);
    expect(await cashDueBalance()).toBe(dueBefore + 7000);
    expect(await openAnomalies(m)).toBe(0);
    expect(
      await rows(
        'SELECT count(*)::int AS n FROM media_tap WHERE media_id = $1 AND transaction_id = $2',
        [m.id, res.body.transaction_id],
      ),
    ).toEqual([{ n: 1 }]);
    expect(
      await rows(
        `SELECT actor_id, approver_id FROM audit_log WHERE object_id = $1 AND action = 'MEDIA_CASH_DUE_REFUNDED'`,
        [m.id],
      ),
    ).toEqual([{ actor_id: w.cashierA.userId, approver_id: null }]);

    const replay = await post(m, body, { key });
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body).toEqual(res.body);
    const nothing = await post(m, { tap: tapBody(m, next()) });
    expect(nothing.status).toBe(409);
    expect(nothing.body).toMatchObject({ code: 'MEDIA_STATE_INVALID', rule: 'cash_due.nothing' });
    // La restitution n'est plus bloquée par les espèces dues.
    const released = await request(app.getHttpServer())
      .post(`/v1/media/${m.id}/release`)
      .set(device.headers)
      .set('Idempotency-Key', randomUUID())
      .set('X-Staff-Authorization', `Bearer ${w.cashierA.token}`)
      .send({});
    expect(released.status).toBe(200);
    await sound();
  });

  it('au-delà du maximum : sans jeton 403 APPROVAL_REQUIRED ; jeton d’une seconde personne : valideur = sujet du jeton, consommé une fois', async () => {
    const m = await activated();
    await owe(m, 12000);
    const body = { tap: tapBody(m, next()), approved_by: w.cashierA.userId };
    const without = await post(m, body);
    expect(without.status).toBe(403);
    expect(without.body.code).toBe('APPROVAL_REQUIRED');
    expect(await openAnomalies(m)).toBe(1);

    // Jeton de l'appelant lui-même, d'une autre action, ou d'une personne sans le rôle : refusés.
    for (const token of [
      await approval(w.cashierA, m, body),
      await approval(supervisorEvent, m, body, 'releaseMedia'),
      await approval(w.organizerAdminA, m, body),
    ]) {
      const res = await post(m, body, { token });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('APPROVAL_INVALID');
    }
    // Jeton lié à une autre requête (autre corps) : refusé.
    expect(
      (
        await post(m, body, {
          token: await approval(supervisorEvent, m, { ...body, tap: tapBody(m, next()) }),
        })
      ).body.code,
    ).toBe('APPROVAL_INVALID');
    expect(await openAnomalies(m)).toBe(1);

    const token = await approval(supervisorEvent, m, body);
    const res = await post(m, body, { token });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ amount: 12000, approved_by: supervisorEvent.userId });
    expect(
      await rows('SELECT created_by, approved_by FROM journal_transaction WHERE id = $1', [
        res.body.transaction_id,
      ]),
    ).toEqual([{ created_by: w.cashierA.userId, approved_by: supervisorEvent.userId }]);
    expect(
      await rows(
        `SELECT approver_id FROM audit_log WHERE object_id = $1 AND action = 'MEDIA_CASH_DUE_REFUNDED'`,
        [m.id],
      ),
    ).toEqual([{ approver_id: supervisorEvent.userId }]);
    expect(await openAnomalies(m)).toBe(0);
    // Le même jeton, sous une autre clé : déjà consommé.
    await owe(m, 11000);
    expect((await post(m, body, { token })).body.code).toBe('APPROVAL_INVALID');
    expect(await openAnomalies(m)).toBe(1);
    // Le SUPERVISOR de l'organisateur valide aussi (portée englobante).
    const body2 = { tap: tapBody(m, next()) };
    expect(
      (await post(m, body2, { token: await approval(w.supervisorA, m, body2) })).body,
    ).toMatchObject({ amount: 11000, approved_by: w.supervisorA.userId });
    await sound();
  });

  it('refus : sans lecture, lecture d’un autre bracelet, session de caisse citée, terminal sans caisse ; rien n’est rendu', async () => {
    const m = await activated();
    const other = await activated();
    await owe(m, 2000);
    expect((await post(m, {})).status).toBe(400);
    const wrong = await post(m, { tap: tapBody(other, next()) });
    expect(wrong.status).toBe(422);
    expect(wrong.body.rule).toBe('return.wrong_media');
    // Session citée qui n'est pas celle du terminal (inconnue, ou ouverte par un autre terminal) : 409.
    for (const cash_session_id of [randomUUID(), otherSession.sessionId]) {
      const refused = await post(m, { tap: tapBody(m, next()), cash_session_id });
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({ code: 'CONFLICT_STATE', rule: 'cash.session_mismatch' });
    }
    expect((await post(m, { tap: tapBody(m, next()), cash_session_id: 'x' })).status).toBe(400);
    const accounts = () =>
      rows<{ n: number }>(
        `SELECT count(*)::int AS n FROM account WHERE ledger_id = $1 AND purpose = 'CASH_DESK'`,
        [w.ids.ledgerA],
      ).then((r) => r[0]!.n);
    const accountsBefore = await accounts();
    const desk = await post(m, { tap: tapBody(m, next()) }, { device: noDesk });
    expect(desk.status).toBe(409);
    expect(desk.body.code).toBe('CONFLICT_STATE');
    // Terminal sans session, même avec un identifiant cité : 409 ; aucun compte de caisse créé.
    const cited = await post(
      m,
      { tap: tapBody(m, next()), cash_session_id: session.sessionId },
      { device: noDesk },
    );
    expect(cited.status).toBe(409);
    expect(await accounts()).toBe(accountsBefore);
    expect(await openAnomalies(m)).toBe(1);
    // tap_id d'une lecture enregistrée par ce terminal : accepté et consommé.
    const tap = await request(app.getHttpServer())
      .post('/v1/taps')
      .set(device.headers)
      .send(tapBody(m, next()));
    const res = await post(m, { tap_id: tap.body.tap_id, cash_session_id: session.sessionId });
    expect(res.status).toBe(201);
    // La session est renvoyée, et l'écriture lui est rattachée (FR-004, FR-008).
    expect(res.body.cash_session_id).toBe(session.sessionId);
    expect(
      await rows('SELECT cash_session_id FROM cash_session_tx WHERE tx_id = $1', [
        res.body.transaction_id,
      ]),
    ).toEqual([{ cash_session_id: session.sessionId }]);
    expect(
      await rows('SELECT transaction_id FROM media_tap WHERE id = $1', [tap.body.tap_id]),
    ).toEqual([{ transaction_id: res.body.transaction_id }]);
  });

  it('bracelet déclaré perdu : une lecture citée par tap_id (avant ou après la perte) ne rend pas les espèces dues', async () => {
    const m = await activated();
    await owe(m, 1500);
    const before = await tapNow(m);
    expect(before.body).toMatchObject({ result: 'OK', tap_id: expect.any(Number) });
    const lost = await request(app.getHttpServer())
      .post(`/v1/operators/${w.ops.a}/media/${m.id}/loss`)
      .set('Idempotency-Key', randomUUID())
      .set('Authorization', `Bearer ${w.cashierA.token}`)
      .send({ reason: 'Perdu dans la foule' });
    expect(lost.status).toBe(200);
    // La lecture d'un bracelet suspendu est enregistrée `BLOCKED`, avec un tap_id que `byId`
    // accepte tel quel.
    const after = await tapNow(m);
    expect(after.body).toMatchObject({ result: 'BLOCKED', tap_id: expect.any(Number) });
    for (const tapId of [before.body.tap_id, after.body.tap_id]) {
      const res = await post(m, { tap_id: tapId }, { language: 'en' });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        code: 'MEDIA_STATE_INVALID',
        rule: 'cash_due.media_blocked',
        media_status: 'SUSPENDED',
      });
      expect(res.body.detail).toMatch(/not active/);
    }
    // Lecture embarquée : refusée dès la lecture.
    const embedded = await post(m, { tap: tapBody(m, next()) });
    expect(embedded.status).toBe(422);
    expect(embedded.body.code).toBe('MEDIA_BLOCKED');
    expect(await openAnomalies(m)).toBe(1);
    expect(
      await rows('SELECT transaction_id FROM media_tap WHERE id = ANY($1::bigint[]) ORDER BY id', [
        [before.body.tap_id, after.body.tap_id],
      ]),
    ).toEqual([{ transaction_id: null }, { transaction_id: null }]);
    expect(
      await rows(
        `SELECT count(*)::int AS n FROM audit_log WHERE object_id = $1 AND action = 'MEDIA_CASH_DUE_REFUNDED'`,
        [m.id],
      ),
    ).toEqual([{ n: 0 }]);
    await sound();
  });

  it('espèces dues inscrites au grand livre d’un autre événement : ce terminal ne les rend pas', async () => {
    const m = await activated();
    await owe(m, 1000);
    // Anomalie du même bracelet au grand livre d'un second événement du même organisateur (le refus
    // précède toute écriture : l'anomalie seule suffit à le provoquer).
    await withOwner(async (db) => {
      const eventA2 = randomUUID();
      await db.query(
        `INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder)
         SELECT $1, operator_id, organizer_id, 'Événement A2', currency, timezone, jurisdiction_id, funds_holder FROM event WHERE id = $2`,
        [eventA2, w.ids.eventA],
      );
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [w.ops.a]);
      const ledgerA2 = (
        await db.query<{ ledger: string }>('SELECT open_event_ledger($1) AS ledger', [eventA2])
      ).rows[0]!.ledger;
      await db.query(
        `INSERT INTO anomaly (operator_id, ledger_id, kind, media_id, amount) VALUES ($1, $2, 'CASH_TOPUP_OVER_LIMIT', $3, 500)`,
        [w.ops.a, ledgerA2, m.id],
      );
    });
    const res = await post(m, { tap: tapBody(m, next()) });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'CONFLICT_STATE', rule: 'cash_due.other_ledger' });
    expect(await openAnomalies(m)).toBe(2);
    await sound();
  });

  it('rôles et isolation à deux prestataires', async () => {
    const m = await activated();
    await owe(m, 1000);
    const body = () => ({ tap: tapBody(m, next()) });
    expect((await post(m, body(), { person: null })).status).toBe(401);
    for (const person of [w.operatorAdminA, w.organizerAdminA, w.personalizerA])
      expect((await post(m, body(), { person })).status).toBe(403);
    // Terminal de l'autre prestataire (et sa personne) : son identité ne désigne aucun bracelet
    // chez lui.
    const deviceB = await foreignDevice();
    const foreign = await post(m, body(), { person: w.cashierB, device: deviceB });
    expect(foreign.status).toBe(404);
    expect(foreign.body.code).toBe('MEDIA_UNKNOWN');
    expect(JSON.stringify(foreign.body)).not.toContain(m.id);
    // Personne d'un autre prestataire que le terminal : comme un terminal inconnu.
    const crossed = await post(m, body(), { person: w.cashierB });
    expect(crossed.status).toBe(404);
    expect(crossed.body.code).toBe('NOT_FOUND');
    expect(JSON.stringify(crossed.body)).not.toContain(m.id);
    expect(await openAnomalies(m)).toBe(1);
    expect((await post(m, body(), { person: w.supervisorA })).status).toBe(201);
    await sound();
  });
});
