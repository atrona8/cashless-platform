// Recherche d'un bracelet et d'un portefeuille (mission routes-backoffice, WP08 ; FR-011, FR-012, FR-014, NFR-001,
// NFR-006 ; recette n° 4 de quickstart.md).
import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ClaimHasher } from '../../../src/kms/claim-hash';
import { createTestApp } from '../../support/app';
import { contractViolations } from '../../support/contract-schema';
import { withOwner } from '../../support/db';
import type { TestPerson } from '../../support/fake-idp';
import { createMediaWorld, type MediaWorld } from '../../support/media-fixtures';
import {
  batchOf,
  createBracelet,
  createPhoneCustomer,
  createSearchPeople,
  createSecondEvent,
  type Bracelet,
  type SearchPeople,
} from './search-fixtures';

describe('recherche d’un bracelet et d’un portefeuille', () => {
  let w: MediaWorld;
  let app: INestApplication;
  let hasher: ClaimHasher;
  let people: SearchPeople;
  let second: Awaited<ReturnType<typeof createSecondEvent>>;
  let active: Bracelet; // activé, événement A, portefeuille crédité de 7000
  let activeWallet: string;
  let stock: Bracelet; // personnalisé, sans portefeuille, lot de l'événement A
  let otherEvent: Bracelet; // activé à l'événement A2
  let otherWallet: string;
  let batchAId: string;
  let released: Bracelet; // rendu : plus de portefeuille
  let releasedWallet: string;

  const get = (path: string, person: TestPerson | null) => {
    const req = request(app.getHttpServer()).get(`/v1${path}`);
    return person ? req.set('Authorization', `Bearer ${person.token}`) : req;
  };
  const byUid = (uid: string, person: TestPerson | null) =>
    get(`/search/media?nfc_uid=${uid}`, person);
  const byCode = (code: string, person: TestPerson | null) =>
    get(`/search/media?printed_code=${encodeURIComponent(code)}`, person);

  beforeAll(async () => {
    w = await createMediaWorld();
    app = await createTestApp({ identity: w.idp });
    hasher = app.get(ClaimHasher, { strict: false });
    await withOwner(async (db) => {
      second = await createSecondEvent(db, w);
      people = await createSearchPeople(db, w, second);
      const batchA = await batchOf(db, w, w.ids.eventA, w.ids.organizerA);
      batchAId = batchA;
      const batchA2 = await batchOf(db, w, second.eventId, second.organizerId);
      const c1 = await createPhoneCustomer(db, {
        operatorId: w.ops.a,
        ledgerId: w.ids.ledgerA,
        funds: 7000,
      });
      activeWallet = c1.walletId;
      active = await createBracelet(db, w, hasher, {
        batchId: batchA,
        eventId: w.ids.eventA,
        walletId: activeWallet,
      });
      stock = await createBracelet(db, w, hasher, { batchId: batchA, eventId: w.ids.eventA });
      const c2 = await createPhoneCustomer(db, {
        operatorId: w.ops.a,
        ledgerId: second.ledgerId,
        funds: 100,
      });
      otherWallet = c2.walletId;
      otherEvent = await createBracelet(db, w, hasher, {
        batchId: batchA2,
        eventId: second.eventId,
        walletId: otherWallet,
      });
      const c3 = await createPhoneCustomer(db, { operatorId: w.ops.a, ledgerId: w.ids.ledgerA });
      releasedWallet = c3.walletId;
      released = await createBracelet(db, w, hasher, {
        batchId: batchA,
        eventId: w.ids.eventA,
        walletId: releasedWallet,
      });
      // Restitution (portefeuille soldé) : le bracelet n'a plus de portefeuille.
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [w.ops.a]);
      await db.query('SELECT release_media($1)', [released.media.id]);
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('UID et code imprimé rendent le même bracelet, avec soldes et numéro imprimé', async () => {
    const a = await byUid(active.media.uid, w.operatorAdminA);
    const b = await byCode(active.code, w.operatorAdminA);
    expect(a.status).toBe(200);
    expect(b.body).toEqual(a.body);
    expect(a.body.data).toHaveLength(1);
    expect(a.body.data[0]).toEqual({
      media_id: active.media.id,
      status: 'ACTIVE',
      event_id: w.ids.eventA,
      wallet_id: activeWallet,
      printed_number: active.printedNumber,
      paid_balance: 7000,
      promo_balance: 0,
      deposit: 0,
    });
    expect(contractViolations('MediaSearchResult', a.body.data[0])).toEqual([]);
    // Le code se saisit comme il est imprimé (casse, tirets, espaces).
    const typed = `${active.code.slice(0, 5)}-${active.code.slice(5).toLowerCase()} `;
    expect((await byCode(typed, w.operatorAdminA)).body).toEqual(a.body);
  });

  it('bracelet inconnu, code inconnu, prestataire voisin : liste vide, identique', async () => {
    const unknown = await byUid('04aabbccddeeff', w.operatorAdminA);
    expect(unknown.status).toBe(200);
    expect(unknown.body).toEqual({ data: [] });
    expect((await byCode('22222-22222', w.operatorAdminA)).body).toEqual({ data: [] });
    // Prestataire B : le bracelet de A est introuvable, par UID comme par code.
    expect((await byUid(active.media.uid, people.operatorAdminB)).body).toEqual({ data: [] });
    expect((await byCode(active.code, people.operatorAdminB)).body).toEqual({ data: [] });
  });

  it('aucune recherche partielle : préfixe d’UID refusé, code tronqué ou voisin introuvable', async () => {
    expect((await byUid(active.media.uid.slice(0, 12), w.operatorAdminA)).status).toBe(400);
    expect((await byUid('%', w.operatorAdminA)).status).toBe(400);
    expect((await byCode(active.code.slice(0, 6), w.operatorAdminA)).body).toEqual({ data: [] });
    expect((await byCode(`${active.code}2`, w.operatorAdminA)).body).toEqual({ data: [] });
    expect((await byCode('%', w.operatorAdminA)).body).toEqual({ data: [] });
    const printed = await get(
      `/search/media?printed_code=${active.printedNumber}`,
      w.operatorAdminA,
    );
    expect(printed.body).toEqual({ data: [] });
  });

  it('aucun critère, ou les deux, ou critère répété : 400', async () => {
    expect((await get('/search/media', w.operatorAdminA)).status).toBe(400);
    const both = await get(
      `/search/media?nfc_uid=${active.media.uid}&printed_code=${active.code}`,
      w.operatorAdminA,
    );
    expect(both.status).toBe(400);
    const twice = await get(
      `/search/media?nfc_uid=${active.media.uid}&nfc_uid=${stock.media.uid}`,
      w.operatorAdminA,
    );
    expect(twice.status).toBe(400);
    expect(both.body.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(both.body)).not.toContain(active.code);
  });

  it('bracelet sans portefeuille : wallet_id et soldes nuls', async () => {
    const res = await byUid(stock.media.uid, w.operatorAdminA);
    expect(res.body.data[0]).toMatchObject({
      media_id: stock.media.id,
      wallet_id: null,
      paid_balance: null,
      promo_balance: null,
      deposit: null,
    });
    expect(contractViolations('MediaSearchResult', res.body.data[0])).toEqual([]);
  });

  it('portée : chacun ne trouve que les bracelets de sa portée', async () => {
    const found = async (person: TestPerson, b: Bracelet) =>
      (await byUid(b.media.uid, person)).body.data.length;
    // Événement A : prestataire, organisateur A, superviseur de A, caissier de A, commerçant participant.
    for (const person of [
      w.operatorAdminA,
      w.organizerAdminA,
      w.supervisorA,
      people.supervisorEventA,
      w.cashierA,
      people.merchantAdminParticipant,
    ])
      expect(await found(person, active)).toBe(1);
    // Hors portée : liste vide, jamais un refus qui trahirait l'existence.
    for (const person of [people.organizerAdminA2, people.merchantAdminA])
      expect(await found(person, active)).toBe(0);
    // Événement A2 : seuls le prestataire et son organisateur le voient.
    expect(await found(w.operatorAdminA, otherEvent)).toBe(1);
    expect(await found(people.organizerAdminA2, otherEvent)).toBe(1);
    for (const person of [w.organizerAdminA, people.supervisorEventA, w.cashierA])
      expect(await found(person, otherEvent)).toBe(0);
    // Sans portefeuille : portée par l'organisateur du lot.
    expect(await found(w.organizerAdminA, stock)).toBe(1);
    expect(await found(people.organizerAdminA2, stock)).toBe(0);
    // Même chose par le code imprimé.
    expect((await byCode(otherEvent.code, w.cashierA)).body).toEqual({ data: [] });
  });

  it('rôles : plateforme, vendeur refusés (403) ; sans jeton 401', async () => {
    for (const person of [w.platformAdmin, people.vendorA])
      expect((await byUid(active.media.uid, person)).status).toBe(403);
    expect((await byUid(active.media.uid, null)).status).toBe(401);
  });

  it('bracelet réattribué : l’ancien code ne retrouve plus l’ancien portefeuille', async () => {
    const res = await byCode(released.code, w.operatorAdminA);
    expect(res.body.data[0]).toMatchObject({
      media_id: released.media.id,
      status: 'RELEASED',
      wallet_id: null,
      paid_balance: null,
    });
    expect(JSON.stringify(res.body)).not.toContain(releasedWallet);
    const wallet = await get(`/search/wallets/${releasedWallet}`, w.operatorAdminA);
    expect(wallet.body.media).toEqual([]);
  });

  describe('portefeuille', () => {
    it('soldes, statut, bracelets, référence du festivalier masquée', async () => {
      const res = await get(`/search/wallets/${activeWallet}`, w.operatorAdminA);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        wallet_id: activeWallet,
        status: 'ACTIVE',
        event_id: w.ids.eventA,
        currency: 'XOF',
        paid_balance: 7000,
        promo_balance: 0,
        deposit: 0,
        media: [
          { media_id: active.media.id, status: 'ACTIVE', printed_number: active.printedNumber },
        ],
      });
      expect(res.body.customer_ref).toMatch(/^[0-9a-f]{16}$/);
      expect(contractViolations('WalletOverview', res.body)).toEqual([]);
      const keys = Object.keys(res.body).sort();
      expect(keys).toEqual(
        [
          'wallet_id',
          'status',
          'event_id',
          'currency',
          'paid_balance',
          'promo_balance',
          'deposit',
          'media',
          'customer_ref',
        ].sort(),
      );
      // La référence se dérive de l'identifiant interne, pas du numéro.
      const phone = (
        await withOwner((db) =>
          db.query<{ phone: string }>(
            `SELECT i.phone FROM customer_identity i JOIN wallet x ON x.customer_id = i.customer_id WHERE x.id = $1`,
            [activeWallet],
          ),
        )
      ).rows[0]!.phone;
      expect(JSON.stringify(res.body)).not.toContain(phone.slice(1));
      expect(res.body.customer_ref).not.toBe(
        createHash('sha256').update(phone).digest('hex').slice(0, 16),
      );
    });

    it('portée : hors événement de l’appelant, autre prestataire, id inconnu ou mal formé : 404', async () => {
      const status = async (id: string, person: TestPerson) =>
        (await get(`/search/wallets/${id}`, person)).status;
      expect(await status(activeWallet, w.cashierA)).toBe(200);
      expect(await status(activeWallet, people.supervisorEventA)).toBe(200);
      expect(await status(otherWallet, w.cashierA)).toBe(404);
      expect(await status(otherWallet, w.organizerAdminA)).toBe(404);
      expect(await status(otherWallet, people.organizerAdminA2)).toBe(200);
      expect(await status(activeWallet, people.operatorAdminB)).toBe(404);
      expect(await status(randomUUID(), w.operatorAdminA)).toBe(404);
      expect(await status('pas-un-uuid', w.operatorAdminA)).toBe(404);
    });

    it('rôles : plateforme, vendeur, commerçant refusés (403)', async () => {
      for (const person of [w.platformAdmin, people.vendorA, people.merchantAdminParticipant])
        expect((await get(`/search/wallets/${activeWallet}`, person)).status).toBe(403);
    });
  });

  const latency = process.env.SKIP_LATENCY ? it.skip : it;
  latency(
    'NFR-001 : p95 < 500 ms sur la recherche d’un bracelet avec 200 000 bracelets',
    async () => {
      // Amorçage en masse par le propriétaire : déclencheurs de transition écartés pour le seul chargement.
      await withOwner(async (db) => {
        await db.query('SET session_replication_role = replica');
        await db.query(
          `INSERT INTO media (operator_id, kind, token_hash, nfc_uid, batch_id, status)
         SELECT $1, 'NFC_TAG', sha256(('lat-' || g)::bytea || gen_random_uuid()::text::bytea),
                substring(sha256(('uid-' || g)::bytea) FROM 1 FOR 7), $2, 'PERSONALIZED'
           FROM generate_series(1, 200000) g`,
          [w.ops.a, batchAId],
        );
        await db.query('SET session_replication_role = DEFAULT');
        await db.query('ANALYZE media');
      });
      const samples: number[] = [];
      for (let i = 0; i < 40; i += 1) {
        const target =
          i % 2 === 0
            ? byUid(active.media.uid, w.operatorAdminA)
            : byCode(active.code, w.operatorAdminA);
        const start = performance.now();
        const res = await target;
        samples.push(performance.now() - start);
        expect(res.body.data).toHaveLength(1);
      }
      samples.sort((x, y) => x - y);
      const p95 = samples[Math.floor(samples.length * 0.95) - 1]!;
      console.info(`searchMedia p95 = ${p95.toFixed(0)} ms (200 000 bracelets)`);
      expect(p95).toBeLessThan(500);
    },
    300_000,
  );
});
