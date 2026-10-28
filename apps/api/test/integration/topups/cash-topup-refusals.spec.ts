// Intégration : refus de la recharge en espèces (`createCashTopup`, FR-004, FR-005 ; ADR-89). Chaque refus est
// prouvé sans écriture : aucune ligne `journal_transaction`, `posting`, `cash_session_tx`, et la lecture du
// bracelet n'est pas consommée. Le bracelet est valide partout ailleurs : un refus ne peut venir que du motif testé.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { withOwner } from '../../support/db';
import { createCashWorld, type CashWorld } from '../../support/cash-fixtures';
import { createTestDevice } from '../../support/fake-device';
import {
  createBatch,
  ownerRows as rows,
  openCashSession,
  tapBody,
  type SeededMedia,
} from '../../support/media-fixtures';

describe('recharge en espèces : refus', () => {
  let c: CashWorld;

  beforeAll(async () => {
    c = await createCashWorld();
  });
  afterAll(async () => {
    await c.close();
  });

  const active = async () => {
    const m = await c.fresh(c.batches.plain);
    expect((await c.activate(m)).status).toBe(201);
    return m;
  };
  const consumedTaps = (m: SeededMedia) =>
    rows<{ n: number }>(
      `SELECT count(*)::int AS n FROM media_tap WHERE media_id = $1 AND transaction_id IS NOT NULL`,
      [m.id],
    ).then((r) => r[0]!.n);
  /** Le refus n'a rien écrit : mêmes compteurs, aucune lecture consommée. */
  const expectNothingWritten = async (
    before: Awaited<ReturnType<CashWorld['counts']>>,
    m: SeededMedia,
  ) => {
    expect(await c.counts()).toEqual(before);
    expect(await consumedTaps(m)).toBe(0);
  };

  it('sans session ouverte : 409 CONFLICT_STATE avant toute écriture, lecture non consommée', async () => {
    const m = await active();
    const before = await c.counts();
    const res = await c.topup(c.topupBody(m, 2000), { device: c.noSession });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CONFLICT_STATE');
    await expectNothingWritten(before, m);
    // Même avec un identifiant de session cité : la session d'un autre terminal ne sert pas.
    const cited = await c.topup(c.topupBody(m, 2000, { cash_session_id: c.session.sessionId }), {
      device: c.noSession,
    });
    expect(cited.status).toBe(409);
    await expectNothingWritten(before, m);
    // Aucun compte de caisse n'a été créé pour ce terminal.
    expect(
      await rows(`SELECT 1 FROM account WHERE ledger_id = $1 AND code = $2`, [
        c.w.ids.ledgerA,
        `A-CAISSE-${c.noSession.serial}`,
      ]),
    ).toEqual([]);
  });

  it('session d’un autre terminal du même événement, ou inconnue : 409, règle cash.session_mismatch', async () => {
    const m = await active();
    const before = await c.counts();
    for (const cash_session_id of [c.otherSession.sessionId, randomUUID()]) {
      const res = await c.topup(c.topupBody(m, 2000, { cash_session_id }));
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'CONFLICT_STATE', rule: 'cash.session_mismatch' });
    }
    const bad = await c.topup(c.topupBody(m, 2000, { cash_session_id: 'pas-un-uuid' }));
    expect(bad.status).toBe(400);
    await expectNothingWritten(before, m);
  });

  it('session en cours de fermeture (CLOSING) : non ouverte, 409, rien d’écrit', async () => {
    const m = await active();
    const closing = await withOwner(async (db) => {
      const d = await createTestDevice(db, {
        operatorId: c.w.ops.a,
        eventId: c.w.ids.eventA,
        kind: 'TOPUP',
      });
      const s = await openCashSession(db, {
        operatorId: c.w.ops.a,
        deviceId: d.deviceId,
        userId: c.w.cashierA.userId,
      });
      await db.query(`SELECT count_cash_session($1, 0, $2, $3)`, [
        s.sessionId,
        c.w.cashierA.userId,
        d.deviceId,
      ]);
      await db.query(`SELECT * FROM begin_cash_close($1, $2)`, [
        s.sessionId,
        c.w.supervisorA.userId,
      ]);
      return { d, s };
    });
    expect(
      await rows('SELECT status FROM cash_session WHERE cash_session_id = $1', [
        closing.s.sessionId,
      ]),
    ).toEqual([{ status: 'CLOSING' }]);
    const before = await c.counts();
    const res = await c.topup(c.topupBody(m, 2000), { device: closing.d });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CONFLICT_STATE');
    await expectNothingWritten(before, m);
  });

  it('plafond de solde : 422 WALLET_LIMIT_EXCEEDED, rien d’écrit (ni ligne, ni rattachement, ni lecture consommée)', async () => {
    const m = await active();
    const restore = await c.setCaps({ maxBalance: 1000, monthly: null });
    try {
      const before = await c.counts();
      const res = await c.topup(c.topupBody(m, 5000));
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('WALLET_LIMIT_EXCEEDED');
      await expectNothingWritten(before, m);
      expect(await rows(`SELECT 1 FROM anomaly WHERE media_id = $1`, [m.id])).toEqual([]);
    } finally {
      await restore();
    }
  });

  it('plafond mensuel : 422 MONTHLY_TOPUP_LIMIT_EXCEEDED, rien d’écrit', async () => {
    const m = await active();
    const restore = await c.setCaps({ maxBalance: null, monthly: 3000 });
    try {
      expect((await c.topup(c.topupBody(m, 2000))).status).toBe(201);
      const before = await c.counts();
      const consumed = await consumedTaps(m);
      const res = await c.topup(c.topupBody(m, 2000));
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('MONTHLY_TOPUP_LIMIT_EXCEEDED');
      expect(await c.counts()).toEqual(before);
      expect(await consumedTaps(m)).toBe(consumed);
    } finally {
      await restore();
    }
  });

  it('terminal d’un autre mode que TOPUP_DESK : 422 DEVICE_MODE_NOT_ALLOWED, rien d’écrit', async () => {
    const m = await active();
    const pos = await withOwner((db) =>
      createTestDevice(db, { operatorId: c.w.ops.a, eventId: c.w.ids.eventA }),
    );
    const before = await c.counts();
    const res = await c.topup(c.topupBody(m, 2000), { device: pos });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('DEVICE_MODE_NOT_ALLOWED');
    await expectNothingWritten(before, m);
  });

  it('rôle insuffisant : 403 ; sans personne : 401 ; personne d’un autre prestataire : 404 ; rien d’écrit', async () => {
    const m = await active();
    const before = await c.counts();
    for (const person of [c.w.operatorAdminA, c.w.organizerAdminA, c.w.personalizerA])
      expect((await c.topup(c.topupBody(m, 2000), { person })).status).toBe(403);
    expect((await c.topup(c.topupBody(m, 2000), { person: null })).status).toBe(401);
    expect((await c.topup(c.topupBody(m, 2000), { person: c.w.cashierB })).status).toBe(404);
    await expectNothingWritten(before, m);
  });

  it('clé fausse (autre série, ou UUID) : 422, rien d’écrit ni rangé au registre', async () => {
    const m = await active();
    const before = await c.counts();
    const registry = () =>
      rows<{ n: number }>(
        `SELECT count(*)::int AS n FROM device_seq_registry WHERE device_id = $1`,
        [c.device.deviceId],
      ).then((r) => r[0]!.n);
    const rows0 = await registry();
    for (const key of ['AUTRE-SERIE:0001', randomUUID(), `${c.device.serial}`]) {
      const res = await c.topup(c.topupBody(m, 2000), { key });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    }
    await expectNothingWritten(before, m);
    expect(await registry()).toBe(rows0);
  });

  it('devise étrangère, montant nul ou négatif, deux lectures, cash_tendered insuffisant : refusés, rien d’écrit', async () => {
    const m = await active();
    const before = await c.counts();
    const cases: Array<Record<string, unknown>> = [
      { currency: 'EUR' },
      { amount: 0 },
      { amount: -5 },
      { tap_id: 12 },
      { cash_tendered: 100 },
    ];
    for (const extra of cases) {
      const res = await c.topup(c.topupBody(m, 2000, extra));
      expect([400, 422]).toContain(res.status);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    }
    await expectNothingWritten(before, m);
  });

  it('bracelet bloqué (déclaré perdu) : MEDIA_BLOCKED en lecture embarquée, 409 par tap_id, rien d’écrit', async () => {
    const m = await active();
    const lost = await request(c.app.getHttpServer())
      .post(`/v1/operators/${c.w.ops.a}/media/${m.id}/loss`)
      .set('Idempotency-Key', randomUUID())
      .set('Authorization', `Bearer ${c.w.cashierA.token}`)
      .send({ reason: 'Perdu dans la foule' });
    expect(lost.status).toBe(200);
    const before = await c.counts();
    // Lecture embarquée d'un bracelet suspendu, puis lecture déjà enregistrée citée par tap_id.
    const embedded = await c.topup(c.topupBody(m, 2000));
    expect(embedded.status).toBe(422);
    expect(embedded.body.code).toBe('MEDIA_BLOCKED');
    const tap = await request(c.app.getHttpServer())
      .post('/v1/taps')
      .set(c.device.headers)
      .send(tapBody(m, c.next()));
    expect(tap.body.result).toBe('BLOCKED');
    const body = {
      amount: 2000,
      currency: 'XOF',
      occurred_at: new Date().toISOString(),
      tap_id: tap.body.tap_id,
    };
    const byId = await c.topup(body);
    expect(byId.status).toBe(409);
    expect(byId.body).toMatchObject({
      code: 'MEDIA_STATE_INVALID',
      rule: 'cash_due.media_blocked',
    });
    await expectNothingWritten(before, m);
  });

  it('lecture déjà consommée : 409 TAP_UNUSABLE ; bracelet d’un autre organisateur : 404, rien d’écrit', async () => {
    const m = await active();
    const ok = await c.topup(c.topupBody(m, 1000));
    expect(ok.status).toBe(201);
    const consumedTap = await rows<{ id: string }>(
      `SELECT id::text FROM media_tap WHERE media_id = $1 AND transaction_id IS NOT NULL`,
      [m.id],
    );
    const before = await c.counts();
    const again = await c.topup({
      amount: 1000,
      currency: 'XOF',
      occurred_at: new Date().toISOString(),
      tap_id: Number(consumedTap[0]!.id),
    });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('TAP_UNUSABLE');
    expect(await c.counts()).toEqual(before);

    // Bracelet actif d'un lot d'un autre organisateur du même prestataire : il n'existe pas pour ce guichet.
    const ownBatch = await withOwner((db) =>
      createBatch(db, {
        operatorId: c.w.ops.a,
        organizerId: c.w.ids.organizerA,
        eventId: c.w.ids.eventA,
        status: 'ACTIVE',
      }),
    );
    const foreign = await c.fresh(ownBatch);
    expect((await c.activate(foreign)).status).toBe(201);
    // Lecture enregistrée AVANT le changement d'organisateur : seul `tap_id` atteint le contrôle de visibilité.
    const registered = await request(c.app.getHttpServer())
      .post('/v1/taps')
      .set(c.device.headers)
      .send(tapBody(foreign, c.next()));
    expect(registered.body.result).toBe('OK');
    await withOwner(async (db) => {
      const organizer = randomUUID();
      await db.query(
        `INSERT INTO party (id, kind, operator_id, legal_name, country_code)
         VALUES ($1, 'ORGANIZER', $2, 'Organisateur A2', 'SN')`,
        [organizer, c.w.ops.a],
      );
      await db.query(`UPDATE media_batch SET organizer_id = $2 WHERE id = $1`, [
        ownBatch,
        organizer,
      ]);
    });
    const before2 = await c.counts();
    const res = await c.topup({
      amount: 1000,
      currency: 'XOF',
      occurred_at: new Date().toISOString(),
      tap_id: registered.body.tap_id,
    });
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain(foreign.id);
    await expectNothingWritten(before2, foreign);
  });
});
