// Intégration : rattachement d'un bracelet par son code imprimé, demande en attente confirmée au
// guichet, limites d'essais, consultation anonyme du solde (FR-030 à FR-033, SC-006 ; spec US 7
// ; contracts/claim-codes.md).
import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { generateClaimCode } from '@cashless/tag-format';
import request from 'supertest';
import { ClaimHasher } from '../../../src/kms/claim-hash';
import { createTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { createTestCustomer, type TestCustomer } from '../../support/fake-customer';
import { createTestDevice, type TestDevice } from '../../support/fake-device';
import type { TestPerson } from '../../support/fake-idp';
import {
  activateMedia,
  createBatch,
  createMediaWorld,
  creditWallet,
  goLive,
  ownerRows as rows,
  seedPersonalizedMedia,
  tapBody,
  type MediaWorld,
  type SeededMedia,
} from '../../support/media-fixtures';

describe('rattachement par code imprimé', () => {
  let w: MediaWorld;
  let app: INestApplication;
  let hasher: ClaimHasher;
  let device: TestDevice;
  let batch: string;
  let counter = 0;
  const next = () => (counter += 1);

  const customer = (deviceRef?: string) =>
    withOwner((db) => createTestCustomer(db, w.ops.a, deviceRef));
  const claim = (
    who: TestCustomer,
    code: string,
    options: { key?: string; headers?: Record<string, string> } = {},
  ) =>
    request(app.getHttpServer())
      .post('/v1/me/media')
      .set(options.headers ?? who.headers)
      .set('Idempotency-Key', options.key ?? randomUUID())
      .send({ claim_code: code });
  const confirm = (body: object, person: TestPerson = w.cashierA, dev: TestDevice = device) =>
    request(app.getHttpServer())
      .post('/v1/media/claims/confirmations')
      .set(dev.headers)
      .set('X-Staff-Authorization', `Bearer ${person.token}`)
      .set('Idempotency-Key', randomUUID())
      .send(body);
  const lookup = (code: string, ip = '203.0.113.7') =>
    request(app.getHttpServer())
      .post('/v1/public/balance-lookups')
      .set('X-Forwarded-For', ip)
      .send({ claim_code: code });
  const tap = async (m: SeededMedia, dev: TestDevice = device) =>
    (await request(app.getHttpServer()).post('/v1/taps').set(dev.headers).send(tapBody(m, next())))
      .body.tap_id as number;

  /**
   * Bracelet du lot, avec son code imprimé associé ; actif sur un portefeuille anonyme crédité
   * de `balance`.
   */
  const bracelet = async (options: { balance?: number; active?: boolean; batchId?: string } = {}) =>
    withOwner(async (db) => {
      const batchId = options.batchId ?? batch;
      const [m] = await seedPersonalizedMedia(db, {
        operatorId: w.ops.a,
        batchId,
        kmsKeyRef: w.keyRef.a,
        count: 1,
      });
      const code = generateClaimCode(randomBytes);
      const hash = hasher.claimCodeHash(code);
      await db.query(
        `INSERT INTO claim_code (operator_id, batch_id, code_hash, media_id, associated_at)
         VALUES ($1, $2, $3, $4, now())`,
        [w.ops.a, batchId, hash, m!.id],
      );
      await db.query('UPDATE media SET claim_code_hash = $2 WHERE id = $1', [m!.id, hash]);
      let walletId: string | null = null;
      if (options.active !== false) {
        await db.query(`SELECT set_config('app.operator_id', $1, false)`, [w.ops.a]);
        walletId = (
          await db.query<{ id: string }>('SELECT open_event_wallet($1) AS id', [w.ids.eventA])
        ).rows[0]!.id;
        await activateMedia(db, {
          operatorId: w.ops.a,
          eventId: w.ids.eventA,
          walletId: walletId!,
          mediaIds: [m!.id],
        });
        if (options.balance)
          await creditWallet(db, {
            operatorId: w.ops.a,
            ledgerId: w.ids.ledgerA,
            walletId: walletId!,
            amount: options.balance,
          });
      }
      return { media: m!, code, walletId };
    });
  const walletOwner = (walletId: string) =>
    rows<{ customer_id: string | null }>('SELECT customer_id FROM wallet WHERE id = $1', [
      walletId,
    ]).then((r) => r[0]!.customer_id);
  const unknownCode = () => generateClaimCode(randomBytes);
  /**
   * Corps d'un refus sans son identifiant de requête : ce qui doit être identique d'un refus à
   * l'autre.
   */
  const refusal = (res: request.Response) => {
    const { instance: _instance, ...body } = res.body as Record<string, unknown>;
    return { status: res.status, body };
  };

  beforeAll(async () => {
    w = await createMediaWorld();
    await withOwner(async (db) => {
      await goLive(db, w.ops.a, w.ids.eventA, w.operatorAdminA.userId);
      device = await createTestDevice(db, { operatorId: w.ops.a, eventId: w.ids.eventA });
      batch = await createBatch(db, {
        operatorId: w.ops.a,
        organizerId: w.ids.organizerA,
        eventId: w.ids.eventA,
        status: 'ACTIVE',
      });
    });
    // Un répartiteur de confiance (OP-N53) : les adresses de `X-Forwarded-For` sont celles des clients.
    app = await createTestApp({ identity: w.idp, trustProxyHops: 1 });
    hasher = app.get(ClaimHasher, { strict: false });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('par le festivalier', () => {
    it('solde nul : rattaché tout de suite (201), et le code ne sert plus — même refus qu’un code inconnu', async () => {
      const b = await bracelet();
      const me = await customer();
      const key = randomUUID();
      const typed = b.code.toLowerCase().replace(/(.{4})/, '$1-');
      const res = await claim(me, typed, { key });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        media_id: b.media.id,
        printed_number: null,
        status: 'ACTIVE',
        deposit_status: 'NONE',
        wallet_id: b.walletId,
      });
      expect(await walletOwner(b.walletId!)).toBe(me.customerId);
      expect(
        await rows(`SELECT claim_code_used_at IS NOT NULL AS used FROM media WHERE id = $1`, [
          b.media.id,
        ]),
      ).toEqual([{ used: true }]);
      // Même clé renvoyée : la réponse n'est pas conservée (route `transient`), 409 sans le corps.
      const replay = await claim(me, typed, { key });
      expect(replay.status).toBe(409);
      expect(replay.body.code).toBe('CONFLICT_STATE');

      const other = await customer();
      const used = await claim(other, b.code);
      const unknown = await claim(other, unknownCode());
      expect(used.status).toBe(422);
      expect(used.body.code).toBe('MEDIA_CLAIM_INVALID');
      expect(refusal(used)).toEqual(refusal(unknown));
      expect(Object.keys(used.headers).sort()).toEqual(Object.keys(unknown.headers).sort());
    });

    it('code mal formé : 400, sans recherche ni essai compté', async () => {
      const me = await customer();
      for (const code of ['K7QM-4XH9R', 'K7QM-4XH9R0', 'ABCDEFGHIO', 42]) {
        const res = await request(app.getHttpServer())
          .post('/v1/me/media')
          .set(me.headers)
          .set('Idempotency-Key', randomUUID())
          .send({ claim_code: code });
        expect(res.status).toBe(400);
      }
      expect(
        await rows('SELECT count(*)::int AS n FROM claim_attempt WHERE customer_id = $1', [
          me.customerId,
        ]),
      ).toEqual([{ n: 0 }]);
    });

    it('solde disponible : demande en attente (202), code de confirmation rendu une fois et jamais conservé en clair ; 3 au plus', async () => {
      const b = await bracelet({ balance: 3000 });
      const me = await customer();
      const res = await claim(me, b.code);
      expect(res.status).toBe(202);
      expect(res.body).toEqual({
        claim_id: expect.any(String),
        status: 'PENDING_DESK_CONFIRMATION',
        confirmation_code: expect.stringMatching(/^\d{6}$/),
        expires_at: expect.any(String),
      });
      expect(await walletOwner(b.walletId!)).toBeNull();
      expect(
        await rows(`SELECT claim_code_used_at FROM media WHERE id = $1`, [b.media.id]),
      ).toEqual([{ claim_code_used_at: null }]);
      const stored = await rows<{ h: string }>(
        `SELECT encode(confirmation_hash, 'hex') AS h FROM media_claim WHERE id = $1`,
        [res.body.claim_id],
      );
      expect(stored[0]!.h).toHaveLength(64);
      expect(stored[0]!.h).not.toContain(res.body.confirmation_code);
      // Ni la demande ni le registre d'idempotence ne gardent le code en clair.
      const registry = await rows<{ n: number }>(
        `SELECT count(*)::int AS n FROM api_idempotency WHERE response_body::text LIKE $1`,
        [`%${res.body.confirmation_code}%`],
      );
      expect(registry).toEqual([{ n: 0 }]);
      const hours = Math.round((new Date(res.body.expires_at).getTime() - Date.now()) / 3_600_000);
      expect(hours).toBe(24);

      expect((await claim(await customer(), b.code)).status).toBe(202);
      expect((await claim(await customer(), b.code)).status).toBe(202);
      const fourth = await claim(await customer(), b.code);
      expect(fourth.status).toBe(422);
      expect(fourth.body.code).toBe('MEDIA_CLAIM_INVALID');
      expect(
        await rows(
          `SELECT count(*)::int AS n FROM media_claim WHERE media_id = $1 AND status = 'PENDING'`,
          [b.media.id],
        ),
      ).toEqual([{ n: 3 }]);
    });

    it('lot réattribuable déjà rattaché une fois par son code : le nouveau porteur reçoit la réponse d’un code utilisé', async () => {
      const pool = await withOwner(async (db) => {
        const id = await createBatch(db, {
          operatorId: w.ops.a,
          organizerId: w.ids.organizerA,
          eventId: w.ids.eventA,
          status: 'ACTIVE',
        });
        await db.query(`UPDATE media_batch SET reuse_policy = 'POOL' WHERE id = $1`, [id]);
        return id;
      });
      const b = await bracelet({ batchId: pool });
      expect((await claim(await customer(), b.code)).status).toBe(201);
      const next = await claim(await customer(), b.code);
      expect(refusal(next)).toEqual(refusal(await claim(await customer(), unknownCode())));
    });
  });

  describe('limites d’essais', () => {
    it('5 essais par compte et par heure : le 6e est bloqué (429, Retry-After), avec une alerte', async () => {
      const me = await customer();
      for (let i = 0; i < 5; i += 1) expect((await claim(me, unknownCode())).status).toBe(422);
      const blocked = await claim(me, unknownCode());
      expect(blocked.status).toBe(429);
      expect(blocked.body.code).toBe('RATE_LIMITED');
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(3500);
      expect(Number(blocked.headers['retry-after'])).toBeLessThanOrEqual(3600);
      // Même un bon code est refusé pendant le blocage.
      const b = await bracelet();
      expect((await claim(me, b.code)).status).toBe(429);
      expect(await walletOwner(b.walletId!)).toBeNull();
      expect(
        await rows(
          `SELECT count(*)::int AS n FROM audit_log
          WHERE action = 'MEDIA_CLAIM_BLOCKED' AND object_id = $1`,
          [me.customerId],
        ),
      ).toEqual([{ n: 2 }]);
    });

    it('20 essais par appareil et par jour, tous comptes confondus : le 21e est bloqué', async () => {
      const deviceRef = `app-${randomUUID()}`;
      for (let i = 0; i < 20; i += 1) {
        const who = await customer(deviceRef);
        expect((await claim(who, unknownCode())).status).toBe(422);
      }
      const blocked = await claim(await customer(deviceRef), unknownCode());
      expect(blocked.status).toBe(429);
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(80_000);
    });
  });

  describe('confirmation au guichet', () => {
    const pending = async (balance = 2500) => {
      const b = await bracelet({ balance });
      const me = await customer();
      const res = await claim(me, b.code);
      expect(res.status).toBe(202);
      return {
        ...b,
        me,
        claimId: res.body.claim_id as string,
        digits: res.body.confirmation_code as string,
      };
    };
    const wrongDigits = (digits: string) =>
      String((Number(digits) + 1) % 1_000_000).padStart(6, '0');

    it('même bracelet et bon code : rattaché sans mouvement d’argent, code consommé, autres demandes annulées, lecture consommée', async () => {
      const p = await pending();
      const other = await claim(await customer(), p.code);
      expect(other.status).toBe(202);
      const journal = () =>
        rows<{ n: number }>(
          'SELECT count(*)::int AS n FROM journal_transaction WHERE ledger_id = $1',
          [w.ids.ledgerA],
        ).then((r) => r[0]!.n);
      const before = await journal();
      const tapId = await tap(p.media);
      const res = await confirm({ tap_id: tapId, claim_code: p.code, confirmation_code: p.digits });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        media_id: p.media.id,
        printed_number: null,
        status: 'ACTIVE',
        deposit_status: 'NONE',
        wallet_id: p.walletId,
      });
      expect(await walletOwner(p.walletId!)).toBe(p.me.customerId);
      expect(await rows('SELECT wallet_spendable($1)::int AS s', [p.walletId])).toEqual([
        { s: 2500 },
      ]);
      expect(await journal()).toBe(before);
      expect(
        await rows(
          `SELECT id, status, confirmed_tap_id::int AS tap FROM media_claim
            WHERE media_id = $1 ORDER BY created_at`,
          [p.media.id],
        ),
      ).toEqual([
        { id: p.claimId, status: 'CONFIRMED', tap: tapId },
        { id: other.body.claim_id, status: 'CANCELLED', tap: null },
      ]);
      expect(
        await rows(
          `SELECT actor_id, after->>'device_id' AS device FROM audit_log
            WHERE action = 'MEDIA_CLAIM_CONFIRMED' AND object_id = $1`,
          [p.media.id],
        ),
      ).toEqual([{ actor_id: w.cashierA.userId, device: device.deviceId }]);
      // Le code imprimé ne sert plus, ni au festivalier ni à la consultation anonyme.
      expect((await claim(await customer(), p.code)).status).toBe(422);
      expect((await lookup(p.code)).status).toBe(404);
      // La même lecture ne confirme pas une autre demande.
      const p2 = await pending();
      expect(
        (await confirm({ tap_id: tapId, claim_code: p2.code, confirmation_code: p2.digits }))
          .status,
      ).toBe(422);
    });

    it('5 codes faux : la demande ne peut plus être confirmée ; lecture d’un autre bracelet : refusée et annulée', async () => {
      const p = await pending();
      for (let i = 0; i < 5; i += 1) {
        const res = await confirm({
          tap_id: await tap(p.media),
          claim_code: p.code,
          confirmation_code: wrongDigits(p.digits),
        });
        expect(res.status).toBe(422);
        expect(res.body.code).toBe('MEDIA_CLAIM_INVALID');
      }
      expect(
        await rows('SELECT status, attempts FROM media_claim WHERE id = $1', [p.claimId]),
      ).toEqual([{ status: 'CANCELLED', attempts: 5 }]);
      expect(
        (
          await confirm({
            tap_id: await tap(p.media),
            claim_code: p.code,
            confirmation_code: p.digits,
          })
        ).status,
      ).toBe(422);
      expect(await walletOwner(p.walletId!)).toBeNull();

      const q = await pending();
      const stranger = await bracelet();
      const wrong = await confirm({
        tap_id: await tap(stranger.media),
        claim_code: q.code,
        confirmation_code: q.digits,
      });
      expect(wrong.status).toBe(422);
      expect(await rows('SELECT status FROM media_claim WHERE id = $1', [q.claimId])).toEqual([
        { status: 'CANCELLED' },
      ]);
      expect(
        (
          await confirm({
            tap_id: await tap(q.media),
            claim_code: q.code,
            confirmation_code: q.digits,
          })
        ).status,
      ).toBe(422);
      expect(await walletOwner(q.walletId!)).toBeNull();
    });

    it('demande expirée : refusée ; lecture trop ancienne : refusée sans rattachement', async () => {
      const p = await pending();
      await rows(`UPDATE media_claim SET expires_at = now() - interval '1 minute' WHERE id = $1`, [
        p.claimId,
      ]);
      expect(
        (
          await confirm({
            tap_id: await tap(p.media),
            claim_code: p.code,
            confirmation_code: p.digits,
          })
        ).status,
      ).toBe(422);
      expect(await rows('SELECT status FROM media_claim WHERE id = $1', [p.claimId])).toEqual([
        { status: 'EXPIRED' },
      ]);

      const q = await pending();
      const old = await tap(q.media);
      await rows(
        `UPDATE media_tap SET received_at = clock_timestamp() - interval '10 minutes'
          WHERE id = $1`,
        [old],
      );
      const res = await confirm({ tap_id: old, claim_code: q.code, confirmation_code: q.digits });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('TAP_UNUSABLE');
      expect(await walletOwner(q.walletId!)).toBeNull();
      expect(await rows('SELECT status FROM media_claim WHERE id = $1', [q.claimId])).toEqual([
        { status: 'PENDING' },
      ]);
    });

    it('lecture ancienne d’un autre bracelet : 409, aucune demande annulée ni essai compté', async () => {
      const q = await pending();
      const stranger = await bracelet();
      const old = await tap(stranger.media);
      await rows(
        `UPDATE media_tap SET received_at = clock_timestamp() - interval '10 minutes'
          WHERE id = $1`,
        [old],
      );
      const res = await confirm({ tap_id: old, claim_code: q.code, confirmation_code: q.digits });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('TAP_UNUSABLE');
      expect(
        await rows('SELECT status, attempts FROM media_claim WHERE id = $1', [q.claimId]),
      ).toEqual([{ status: 'PENDING', attempts: 0 }]);
      // La demande reste confirmable avec une lecture récente du bon bracelet.
      const ok = await confirm({
        tap_id: await tap(q.media),
        claim_code: q.code,
        confirmation_code: q.digits,
      });
      expect(ok.status).toBe(200);
    });

    it('SC-006 : qui connaît seulement le code d’un bracelet approvisionné ne le rattache pas sans le bracelet', async () => {
      const b = await bracelet({ balance: 9000 });
      const thief = await customer();
      const res = await claim(thief, b.code);
      expect(res.status).toBe(202);
      // Sans lecture du bracelet lui-même au guichet : aucun chemin ne rattache.
      const decoy = await bracelet();
      expect(
        (
          await confirm({
            tap_id: await tap(decoy.media),
            claim_code: b.code,
            confirmation_code: res.body.confirmation_code,
          })
        ).status,
      ).toBe(422);
      expect(
        (
          await confirm({
            tap_id: 999_999_999,
            claim_code: b.code,
            confirmation_code: res.body.confirmation_code,
          })
        ).status,
      ).toBe(409);
      expect(await walletOwner(b.walletId!)).toBeNull();
      expect(
        await rows(
          `SELECT count(*)::int AS n FROM media_claim WHERE media_id = $1 AND status = 'CONFIRMED'`,
          [b.media.id],
        ),
      ).toEqual([{ n: 0 }]);
    });

    it('champs invalides : 400 ; rôles et isolation à deux prestataires', async () => {
      const p = await pending();
      const tapId = await tap(p.media);
      expect(
        (await confirm({ tap_id: tapId, claim_code: p.code, confirmation_code: '12345' })).status,
      ).toBe(400);
      expect(
        (await confirm({ tap_id: tapId, claim_code: 'bad', confirmation_code: p.digits })).status,
      ).toBe(400);
      for (const person of [w.operatorAdminA, w.organizerAdminA, w.personalizerA]) {
        expect(
          (
            await confirm(
              { tap_id: tapId, claim_code: p.code, confirmation_code: p.digits },
              person,
            )
          ).status,
        ).toBe(403);
      }
      const body = { tap_id: tapId, claim_code: p.code, confirmation_code: p.digits };
      // Personne d'un autre prestataire que le terminal : traitée comme un terminal inconnu
      // (`CounterAccess.authorize`), 404, sans rien dire du bracelet.
      const crossPerson = await confirm(body, w.cashierB);
      expect(crossPerson.status).toBe(404);
      expect(crossPerson.body.code).toBe('NOT_FOUND');
      expect(JSON.stringify(crossPerson.body)).not.toContain(p.media.id);
      // Terminal d'un autre prestataire, affecté à un événement de B, tenu par un caissier de B :
      // la lecture de A est introuvable pour ce terminal (`TapService.byId`) : 409 TAP_UNUSABLE.
      const deviceB = await withOwner(async (db) => {
        const profile = randomUUID();
        const eventB = randomUUID();
        await db.query(
          `INSERT INTO jurisdiction_profile (id, country_code, version, valid_from,
                                            breakage_destination)
           VALUES ($1, 'SN', (1000000 + floor(random() * 1000000000))::int, '2026-01-01',
                   'ORGANIZER')`,
          [profile],
        );
        await db.query(
          `INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone,
                              jurisdiction_id, funds_holder)
           VALUES ($1, $2, $3, 'Événement B', 'XOF', 'Africa/Dakar', $4, 'ORGANIZER')`,
          [eventB, w.ops.b, w.ids.organizerB, profile],
        );
        await db.query(`SELECT set_config('app.operator_id', $1, false)`, [w.ops.b]);
        await db.query('SELECT open_event_ledger($1)', [eventB]);
        return createTestDevice(db, { operatorId: w.ops.b, eventId: eventB });
      });
      const crossDevice = await confirm(body, w.cashierB, deviceB);
      expect(crossDevice.status).toBe(409);
      expect(crossDevice.body.code).toBe('TAP_UNUSABLE');
      expect(JSON.stringify(crossDevice.body)).not.toContain(p.media.id);
      expect(await rows('SELECT status FROM media_claim WHERE id = $1', [p.claimId])).toEqual([
        { status: 'PENDING' },
      ]);
      // Festivalier d'un autre prestataire : le code n'existe pas pour lui.
      const foreign = await withOwner((db) => createTestCustomer(db, w.ops.b));
      expect(refusal(await claim(foreign, p.code))).toEqual(
        refusal(await claim(foreign, unknownCode())),
      );
      expect(await walletOwner(p.walletId!)).toBeNull();
      expect((await confirm(body, w.supervisorA)).status).toBe(200);
    });
  });

  describe('activation depuis l’app (SELF_APP)', () => {
    const setModes = (modes: string[]) =>
      rows('UPDATE event SET activation_modes = $2 WHERE id = $1', [w.ids.eventA, modes]);

    it('événement qui l’autorise : activé sur un portefeuille du festivalier, code consommé', async () => {
      const b = await bracelet({ active: false });
      const me = await customer();
      await setModes(['DESK', 'SELF_APP']);
      try {
        const res = await claim(me, b.code);
        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({
          media_id: b.media.id,
          status: 'ACTIVE',
          deposit_status: 'NONE',
          wallet_id: expect.any(String),
        });
        expect(await walletOwner(res.body.wallet_id)).toBe(me.customerId);
        expect(
          await rows(`SELECT claim_code_used_at IS NOT NULL AS used FROM media WHERE id = $1`, [
            b.media.id,
          ]),
        ).toEqual([{ used: true }]);
        expect(
          await rows(
            `SELECT actor_id, reason FROM media_status_history
              WHERE media_id = $1 AND to_status = 'ACTIVE'`,
            [b.media.id],
          ),
        ).toEqual([{ actor_id: me.customerId, reason: 'ACTIVATION:SELF_APP' }]);
        expect((await claim(await customer(), b.code)).status).toBe(422);
      } finally {
        await setModes(['DESK']);
      }
    });

    it('événement qui ne l’autorise pas : refus, essai compté, bracelet inchangé', async () => {
      const b = await bracelet({ active: false });
      const me = await customer();
      const res = await claim(me, b.code);
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('ACTIVATION_MODE_NOT_ALLOWED');
      expect(
        await rows(`SELECT status, claim_code_used_at FROM media WHERE id = $1`, [b.media.id]),
      ).toEqual([{ status: 'PERSONALIZED', claim_code_used_at: null }]);
      expect(
        await rows('SELECT outcome FROM claim_attempt WHERE customer_id = $1', [me.customerId]),
      ).toEqual([{ outcome: 'NOT_ACTIVE' }]);
    });
  });

  describe('consultation anonyme', () => {
    it('solde et 10 derniers mouvements, sans donnée personnelle ; le code n’est pas consommé', async () => {
      const b = await bracelet({ balance: 1000 });
      await withOwner(async (db) => {
        for (let i = 0; i < 11; i += 1)
          await creditWallet(db, {
            operatorId: w.ops.a,
            ledgerId: w.ids.ledgerA,
            walletId: b.walletId!,
            amount: 100,
          });
      });
      const res = await lookup(b.code.toLowerCase());
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        currency: 'XOF',
        spendable: 2100,
        media_status: 'ACTIVE',
        recent: expect.any(Array),
      });
      expect(res.body.recent).toHaveLength(10);
      expect(res.body.recent[0]).toEqual({
        occurred_at: expect.any(String),
        type: 'TOPUP',
        amount: 100,
      });
      expect(JSON.stringify(res.body)).not.toMatch(/customer|wallet_id|media_id|uid|token/i);
      expect((await claim(await customer(), b.code)).status).toBe(202);
    });

    it('code inconnu, utilisé ou bracelet rattaché : même réponse 404 ; mal formé : 400', async () => {
      const attached = await bracelet();
      expect((await claim(await customer(), attached.code)).status).toBe(201);
      const unknown = await lookup(unknownCode());
      expect(unknown.status).toBe(404);
      expect(refusal(await lookup(attached.code))).toEqual(refusal(unknown));
      expect((await lookup('pas-un-code')).status).toBe(400);
    });

    it('20 consultations par code et par heure : la 21e est bloquée (429, Retry-After)', async () => {
      const b = await bracelet({ balance: 500 });
      for (let i = 0; i < 20; i += 1)
        expect((await lookup(b.code, `198.51.100.${i}`)).status).toBe(200);
      const blocked = await lookup(b.code, '198.51.100.99');
      expect(blocked.status).toBe(429);
      expect(blocked.headers['retry-after']).toBe('3600');
    });
  });
});
