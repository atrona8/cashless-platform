// Intégration : remplacement d'un bracelet, perte et bracelet retrouvé (FR-027, FR-028 ;
// SPECIFICATION §7.8 ; contrat `replaceMedia`, `reportMediaLost`, `recoverMedia` ; spec US 6,
// scénarios 5 à 7). Le neuf reprend les portefeuilles et la caution, sans écriture comptable ni
// préchargement ; chaque refus nomme sa règle.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { createTestDevice, type TestDevice } from '../../support/fake-device';
import type { TestPerson } from '../../support/fake-idp';
import {
  activateMedia,
  createBatch,
  createMediaWorld,
  creditWallet,
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

describe('remplacement, perte et bracelet retrouvé', () => {
  let w: MediaWorld;
  let app: INestApplication;
  let device: TestDevice;
  let plain: string;
  let separate: string; // caution payée à part
  let fromBalance: string; // caution prélevée sur le solde
  let preload: string; // lot qui précharge des crédits offerts à l'activation
  let otherOrganizer: string; // lot d'un autre organisateur du même prestataire
  let otherEvent: string; // lot réservé à un autre événement
  let eventA2: string; // second événement du même organisateur
  let counter = 0;
  const next = () => (counter += 1);
  const post = (
    path: string,
    body: object = {},
    options: {
      key?: string;
      person?: TestPerson | null;
      device?: TestDevice | null;
      language?: string;
    } = {},
  ) => {
    let req = request(app.getHttpServer())
      .post(path)
      .set('Idempotency-Key', options.key ?? randomUUID());
    const dev = options.device === undefined ? device : options.device;
    if (dev) req = req.set(dev.headers);
    const person = options.person === undefined ? w.cashierA : options.person;
    // Terminal ET personne : route de guichet, jeton de la personne dans X-Staff-Authorization.
    if (person)
      req = req.set(dev ? 'X-Staff-Authorization' : 'Authorization', `Bearer ${person.token}`);
    if (options.language) req = req.set('Accept-Language', options.language);
    return req.send(body);
  };
  const fresh = (batchId: string, operatorId = w.ops.a) =>
    withOwner(
      async (db) =>
        (
          await seedPersonalizedMedia(db, {
            operatorId,
            batchId,
            kmsKeyRef: operatorId === w.ops.a ? w.keyRef.a : w.keyRef.b,
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
  const replace = (
    old: SeededMedia,
    neu: SeededMedia,
    options: Parameters<typeof post>[2] = {},
    tapOverrides: Record<string, unknown> = {},
  ) =>
    post(
      `/v1/media/${old.id}/replace`,
      {
        new_media_tap: tapBody(neu, next(), tapOverrides),
        reason: 'Bracelet déchiré, identité vérifiée sur pièce.',
      },
      options,
    );
  const media = (id: string) =>
    rows<{ status: string; wallet_id: string | null; deposit_status: string; held: number }>(
      'SELECT status, wallet_id, deposit_status, deposit_held::int AS held FROM media WHERE id = $1',
      [id],
    ).then((r) => r[0]!);
  const journalCount = () =>
    rows<{ n: number }>('SELECT count(*)::int AS n FROM journal_transaction WHERE ledger_id = $1', [
      w.ids.ledgerA,
    ]).then((r) => r[0]!.n);
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
      device = await createTestDevice(db, {
        operatorId: w.ops.a,
        eventId: w.ids.eventA,
        kind: 'TOPUP',
      });
      await openCashDesk(db, {
        operatorId: w.ops.a,
        ledgerId: w.ids.ledgerA,
        organizerId: w.ids.organizerA,
        serial: device.serial,
      });
      // Toute espèce passe par la session ouverte du terminal (mission des caisses, WP09).
      await openCashSession(db, {
        operatorId: w.ops.a,
        deviceId: device.deviceId,
        userId: w.cashierA.userId,
      });
      const base = {
        operatorId: w.ops.a,
        organizerId: w.ids.organizerA,
        eventId: w.ids.eventA,
        status: 'ACTIVE' as const,
      };
      plain = await createBatch(db, base);
      separate = await createBatch(db, { ...base, depositAmount: 1000, depositMode: 'SEPARATE' });
      fromBalance = await createBatch(db, {
        ...base,
        depositAmount: 1500,
        depositMode: 'FROM_BALANCE',
      });
      preload = await createBatch(db, { ...base, preloadPromoAmount: 500 });
      const organizerA2 = randomUUID();
      await db.query(
        `INSERT INTO party (id, kind, operator_id, legal_name, country_code) VALUES ($1, 'ORGANIZER', $2, 'Organisateur A2', 'SN')`,
        [organizerA2, w.ops.a],
      );
      otherOrganizer = await createBatch(db, { ...base, organizerId: organizerA2, eventId: null });
      eventA2 = randomUUID();
      await db.query(
        `INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder)
         SELECT $1, operator_id, organizer_id, 'Événement A2', currency, timezone, jurisdiction_id, funds_holder FROM event WHERE id = $2`,
        [eventA2, w.ids.eventA],
      );
      otherEvent = await createBatch(db, { ...base, eventId: eventA2 });
    });
    app = await createTestApp({ identity: w.idp });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('remplacement', () => {
    it('le neuf reprend le portefeuille et la caution détenue, sans écriture comptable ni préchargement ; l’ancien est remplacé', async () => {
      const old = await fresh(separate);
      const walletId = await activate(old, { deposit_payment: { method: 'CASH' } });
      await withOwner((db) =>
        creditWallet(db, { operatorId: w.ops.a, ledgerId: w.ids.ledgerA, walletId, amount: 4000 }),
      );
      const neu = await fresh(separate);
      const before = await journalCount();
      const key = randomUUID();
      const body = {
        new_media_tap: tapBody(neu, next()),
        reason: 'Bracelet déchiré, identité vérifiée sur pièce.',
      };
      const res = await post(`/v1/media/${old.id}/replace`, body, { key });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ old_media_id: old.id, new_media_id: neu.id, wallet_id: walletId });
      expect(await media(old.id)).toEqual({
        status: 'REPLACED',
        wallet_id: null,
        deposit_status: 'NONE',
        held: 0,
      });
      expect(await media(neu.id)).toEqual({
        status: 'ACTIVE',
        wallet_id: walletId,
        deposit_status: 'HELD',
        held: 1000,
      });
      expect(await rows('SELECT wallet_spendable($1)::int AS s', [walletId])).toEqual([
        { s: 4000 },
      ]);
      expect(await journalCount()).toBe(before);
      expect(
        await rows(
          `SELECT actor_id, reason FROM media_status_history WHERE media_id = $1 AND to_status = 'REPLACED'`,
          [old.id],
        ),
      ).toEqual([
        { actor_id: w.cashierA.userId, reason: 'Bracelet déchiré, identité vérifiée sur pièce.' },
      ]);
      expect(
        await rows(
          `SELECT actor_id, after->>'new_media_id' AS neu FROM audit_log WHERE object_id = $1 AND action = 'MEDIA_REPLACED'`,
          [old.id],
        ),
      ).toEqual([{ actor_id: w.cashierA.userId, neu: neu.id }]);
      // Rejeu : même réponse, rien de plus.
      const replay = await post(`/v1/media/${old.id}/replace`, body, { key });
      expect(replay.headers['idempotency-replayed']).toBe('true');
      expect(replay.body).toEqual(res.body);
      // L'ancien ne paie plus ; le neuf paie, et sa caution se rend.
      expect(
        (
          await request(app.getHttpServer())
            .post('/v1/taps')
            .set(device.headers)
            .send(tapBody(old, next()))
        ).body.result,
      ).toBe('REPLACED');
      const tap = await request(app.getHttpServer())
        .post('/v1/taps')
        .set(device.headers)
        .send(tapBody(neu, next()));
      expect(tap.body).toMatchObject({
        result: 'OK',
        wallet: { wallet_id: walletId, spendable: 4000 },
      });
      expect(
        (
          await post(`/v1/media/${neu.id}/deposit/refund`, {
            tap: tapBody(neu, next()),
            payment: { method: 'CASH' },
          })
        ).body.status,
      ).toBe('REFUNDED');
      await sound();
    });

    it('bracelet déclaré perdu (suspendu) : remplacé ; une caution due suit le neuf ; un lot qui précharge ne précharge pas', async () => {
      const old = await fresh(fromBalance);
      const walletId = await activate(old);
      expect(await media(old.id)).toMatchObject({ deposit_status: 'DUE' });
      const lost = await post(
        `/v1/operators/${w.ops.a}/media/${old.id}/loss`,
        { reason: 'Perdu dans la foule' },
        { device: null },
      );
      expect(lost.status).toBe(200);
      const neu = await fresh(preload);
      const before = await journalCount();
      const res = await replace(old, neu);
      expect(res.status).toBe(200);
      expect(await media(neu.id)).toEqual({
        status: 'ACTIVE',
        wallet_id: walletId,
        deposit_status: 'DUE',
        held: 0,
      });
      expect(await rows('SELECT wallet_spendable($1)::int AS s', [walletId])).toEqual([{ s: 0 }]);
      expect(await journalCount()).toBe(before);
      expect(await media(old.id)).toMatchObject({ status: 'REPLACED' });
    });

    it('refus : neuf déjà actif, déjà sous caution, d’un autre organisateur, mode de caution différent avec caution détenue', async () => {
      const old = await fresh(separate);
      const walletId = await activate(old, { deposit_payment: { method: 'CASH' } });

      const active = await fresh(plain);
      await activate(active);
      const already = await replace(old, active);
      expect(already.status).toBe(409);
      expect(already.body.code).toBe('MEDIA_STATE_INVALID');

      const deposited = await fresh(separate);
      await rows(`UPDATE media SET deposit_status = 'REFUNDED' WHERE id = $1`, [deposited.id]);
      const underDeposit = await replace(old, deposited);
      expect(underDeposit.status).toBe(409);
      expect(underDeposit.body).toMatchObject({
        code: 'MEDIA_STATE_INVALID',
        rule: 'replace.new_deposit',
      });

      const foreign = await replace(old, await fresh(otherOrganizer));
      expect(foreign.status).toBe(409);
      expect(foreign.body.rule).toBe('replace.other_organizer');

      const mode = await replace(old, await fresh(fromBalance), { language: 'en' });
      expect(mode.status).toBe(409);
      expect(mode.body.rule).toBe('replace.deposit_mode');
      expect(mode.body.detail).toMatch(/same deposit mode/);

      // Nothing moved.
      expect(await media(old.id)).toEqual({
        status: 'ACTIVE',
        wallet_id: walletId,
        deposit_status: 'HELD',
        held: 1000,
      });
    });

    it('refus : ancien ni actif ni suspendu, neuf réservé à un autre événement, même bracelet, puce différente, sans lecture du neuf', async () => {
      const released = await fresh(plain);
      await activate(released);
      expect((await post(`/v1/media/${released.id}/release`, {})).status).toBe(200);
      const oldState = await replace(released, await fresh(plain));
      expect(oldState.status).toBe(409);
      expect(oldState.body).toMatchObject({ rule: 'replace.old_state', media_status: 'RELEASED' });

      const old = await fresh(plain);
      const walletId = await activate(old);
      expect((await replace(old, await fresh(otherEvent))).body.code).toBe('MEDIA_WRONG_EVENT');
      const same = await post(`/v1/media/${old.id}/replace`, {
        new_media_tap: tapBody(old, next()),
        reason: 'x',
      });
      expect(same.status).toBe(409); // la lecture d'un bracelet actif n'est pas celle d'un bracelet neuf

      const neu = await fresh(plain);
      const uid = await replace(old, neu, {}, { nfc_uid: '04ffffffffffff' });
      expect(uid.status).toBe(422);
      expect(uid.body.code).toBe('MEDIA_UID_MISMATCH');
      const noTap = await post(`/v1/media/${old.id}/replace`, {
        new_media_tap_id: 918410,
        reason: 'x',
      });
      expect(noTap.status).toBe(422);
      expect(noTap.body.rule).toBe('replace.tap_required');
      expect(
        (await post(`/v1/media/${old.id}/replace`, { new_media_tap: tapBody(neu, next()) })).status,
      ).toBe(400);
      expect(await media(old.id)).toMatchObject({ status: 'ACTIVE', wallet_id: walletId });
      expect(await media(neu.id)).toMatchObject({ status: 'PERSONALIZED', wallet_id: null });
    });

    it('refus : ancien bracelet servant un autre événement que celui du terminal ; rien ne bouge', async () => {
      // Ancien bracelet du même organisateur, activé à l'événement A2 (lot réservé à A2,
      // portefeuille de son grand livre).
      const old = await fresh(otherEvent);
      const walletId = randomUUID();
      await withOwner(async (db) => {
        await db.query(`SELECT set_config('app.operator_id', $1, false)`, [w.ops.a]);
        const ledgerA2 = (
          await db.query<{ ledger: string }>('SELECT open_event_ledger($1) AS ledger', [eventA2])
        ).rows[0]!.ledger;
        await db.query('INSERT INTO wallet (id, operator_id, ledger_id) VALUES ($1, $2, $3)', [
          walletId,
          w.ops.a,
          ledgerA2,
        ]);
        await activateMedia(db, {
          operatorId: w.ops.a,
          eventId: eventA2,
          walletId,
          mediaIds: [old.id],
        });
      });
      expect(await rows('SELECT media_event($1) AS e', [old.id])).toEqual([{ e: eventA2 }]);
      const neu = await fresh(plain);
      const res = await replace(old, neu, { language: 'en' });
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({
        code: 'MEDIA_WRONG_EVENT',
        rule: 'replace.old_wrong_event',
      });
      expect(res.body.detail).toMatch(/another event/);
      expect(await media(old.id)).toMatchObject({ status: 'ACTIVE', wallet_id: walletId });
      expect(await media(neu.id)).toMatchObject({ status: 'PERSONALIZED', wallet_id: null });
      expect(
        await rows(
          `SELECT count(*)::int AS n FROM audit_log WHERE object_id = $1 AND action = 'MEDIA_REPLACED'`,
          [old.id],
        ),
      ).toEqual([{ n: 0 }]);
    });

    it('rôles et isolation à deux prestataires', async () => {
      const old = await fresh(plain);
      await activate(old);
      const neu = await fresh(plain);
      expect((await replace(old, neu, { person: null })).status).toBe(401);
      for (const person of [w.operatorAdminA, w.organizerAdminA, w.personalizerA])
        expect((await replace(old, neu, { person })).status).toBe(403);
      // Terminal de l'autre prestataire (et sa personne) : l'ancien bracelet n'existe pas pour lui.
      // Personne d'un autre prestataire que le terminal : comme un terminal inconnu. Réponse
      // neutre, sans aucun des identifiants.
      const deviceB = await foreignDevice();
      for (const res of [
        await replace(old, neu, { person: w.cashierB, device: deviceB }),
        await replace(old, neu, { person: w.cashierB }),
      ]) {
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('NOT_FOUND');
        expect(JSON.stringify(res.body)).not.toContain(old.id);
        expect(JSON.stringify(res.body)).not.toContain(neu.id);
      }
      expect(await media(neu.id)).toMatchObject({ status: 'PERSONALIZED', wallet_id: null });
      expect(await media(old.id)).toMatchObject({ status: 'ACTIVE' });
      expect((await replace(old, neu, { person: w.supervisorA })).status).toBe(200);
    });
  });

  describe('perte et bracelet retrouvé', () => {
    const loss = (
      m: SeededMedia,
      options: Parameters<typeof post>[2] = {},
      body: object = { reason: 'Perdu au concert' },
    ) => post(`/v1/operators/${w.ops.a}/media/${m.id}/loss`, body, { device: null, ...options });
    const recovery = (m: SeededMedia, options: Parameters<typeof post>[2] = {}) =>
      post(`/v1/operators/${w.ops.a}/media/${m.id}/recovery`, undefined, {
        device: null,
        ...options,
      });
    const setPolicy = (policy: 'REACTIVATE' | 'END_OF_LIFE') =>
      rows('UPDATE event SET lost_media_policy = $2 WHERE id = $1', [w.ids.eventA, policy]);

    it('perte : suspendu, tout passage bloqué, motif et auteur tracés ; retrouvé (fin de vie, défaut) : retiré', async () => {
      const m = await fresh(plain);
      const walletId = await activate(m);
      const key = randomUUID();
      const res = await loss(m, { key });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        media_id: m.id,
        status: 'SUSPENDED',
        wallets: [{ wallet_id: walletId }],
      });
      expect(res.body.status_history.at(-1)).toMatchObject({
        to_status: 'SUSPENDED',
        reason: 'Perdu au concert',
        actor_id: w.cashierA.userId,
      });
      expect((await loss(m, { key })).body).toEqual(res.body);
      expect((await loss(m)).body).toMatchObject({ status: 'SUSPENDED' });
      expect(
        await rows(
          `SELECT count(*)::int AS n FROM audit_log WHERE object_id = $1 AND action = 'MEDIA_REPORTED_LOST'`,
          [m.id],
        ),
      ).toEqual([{ n: 1 }]);
      expect(
        (
          await request(app.getHttpServer())
            .post('/v1/taps')
            .set(device.headers)
            .send(tapBody(m, next()))
        ).body.result,
      ).toBe('BLOCKED');

      const back = await recovery(m);
      expect(back.status).toBe(200);
      expect(back.body).toMatchObject({ status: 'RETIRED', wallets: [] });
      expect(back.body.status_history.at(-1)).toMatchObject({
        to_status: 'RETIRED',
        reason: 'LOST_MEDIA_RECOVERED',
        actor_id: w.cashierA.userId,
      });
      expect(
        await rows(
          `SELECT actor_id, after->>'status' AS status FROM audit_log WHERE object_id = $1 AND action = 'MEDIA_RECOVERED'`,
          [m.id],
        ),
      ).toEqual([{ actor_id: w.cashierA.userId, status: 'RETIRED' }]);
      // Le portefeuille reste au festivalier, remboursable par ailleurs.
      expect(await rows('SELECT status FROM wallet WHERE id = $1', [walletId])).toEqual([
        { status: 'ACTIVE' },
      ]);
    });

    it('retrouvé quand l’événement réactive : de nouveau actif, et il paie', async () => {
      const m = await fresh(plain);
      const walletId = await activate(m);
      expect((await loss(m)).status).toBe(200);
      await setPolicy('REACTIVATE');
      try {
        const back = await recovery(m, { person: w.supervisorA });
        expect(back.status).toBe(200);
        expect(back.body).toMatchObject({ status: 'ACTIVE', wallets: [{ wallet_id: walletId }] });
      } finally {
        await setPolicy('END_OF_LIFE');
      }
      expect(
        (
          await request(app.getHttpServer())
            .post('/v1/taps')
            .set(device.headers)
            .send(tapBody(m, next()))
        ).body.result,
      ).toBe('OK');
    });

    it('refus : retrouvé sans avoir été perdu, perte d’un bracelet jamais activé, motif absent ; rôles et isolation', async () => {
      const m = await fresh(plain);
      await activate(m);
      const notLost = await recovery(m);
      expect(notLost.status).toBe(409);
      expect(notLost.body.code).toBe('MEDIA_STATE_INVALID');
      const neverActivated = await fresh(plain);
      expect((await loss(neverActivated)).status).toBe(409);
      expect((await loss(m, {}, {})).status).toBe(400);
      expect((await loss(m, {}, { reason: 'x', extra: true })).status).toBe(400);

      expect((await loss(m, { person: null })).status).toBe(401);
      for (const person of [w.operatorAdminA, w.organizerAdminA, w.personalizerA])
        expect((await loss(m, { person })).status).toBe(403);
      // Autre prestataire : son chemin n'est pas le sien (404), et le bracelet n'existe pas chez
      // lui.
      expect((await loss(m, { person: w.cashierB })).status).toBe(404);
      expect(
        (
          await post(
            `/v1/operators/${w.ops.b}/media/${m.id}/loss`,
            { reason: 'x' },
            { device: null, person: w.cashierB },
          )
        ).status,
      ).toBe(404);
      // Caissier d'un autre organisateur du même prestataire : pas de droit sur ce bracelet.
      const outsider = await withOwner(async (db) => {
        const organizer = (
          await rows<{ organizer_id: string }>(
            'SELECT organizer_id FROM media_batch WHERE id = $1',
            [otherOrganizer],
          )
        )[0]!.organizer_id;
        return w.idp.createPerson(db, {
          operatorId: w.ops.a,
          roles: [{ role: 'CASHIER', scopeType: 'ORGANIZER', scopeId: organizer }],
        });
      });
      expect((await loss(m, { person: outsider })).status).toBe(403);
      expect(
        (
          await post(
            `/v1/operators/${w.ops.a}/media/${randomUUID()}/loss`,
            { reason: 'x' },
            { device: null },
          )
        ).status,
      ).toBe(404);
      expect(await media(m.id)).toMatchObject({ status: 'ACTIVE' });
    });
  });
});
