// Back-office des vendeurs (mission 5b, lot WP09, T039, T043 ; FR-001, FR-002, FR-026, NFR-002,
// NFR-007 ; contracts/vendors.md). Routes servies à une personne (`FakeIdp`, vraie garde) :
// création, liste, fiche, changement de PIN (débloque), désactivation et réactivation, par un
// MERCHANT_ADMIN du commerçant et par l'OPERATOR_ADMIN du prestataire ; `404` neutre hors
// périmètre (autre commerçant, autre prestataire) ; `403` pour un rôle non admis. Aucun PIN ni
// empreinte dans les réponses, l'audit ou le registre d'idempotence.
//
// Écritures directes en base : amorçage seulement (commerçants, points de vente, personnes,
// vendeur d'un autre prestataire par `create_vendor`, blocage d'un vendeur posé à la main pour
// prouver le déblocage par un nouveau PIN).
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { VendorPinHasher } from '../../../src/vendor-pin/vendor-pin.hasher';
import { createTestApp } from '../../support/app';
import { contractViolations } from '../../support/contract-schema';
import { withOwner } from '../../support/db';
import type { TestPerson } from '../../support/fake-idp';
import { createMediaWorld, ownerRows, type MediaWorld } from '../../support/media-fixtures';
import { seedPos, seedVendor } from './vendor-fixtures';

jest.setTimeout(60_000);

const PIN = '135790';
const NEW_PIN = '864202';

/** Problème sans ce qui varie d'une requête à l'autre. */
const stable = (body: Record<string, unknown>) => {
  const { instance: _i, request_id: _r, ...rest } = body;
  return rest;
};

describe('Back-office des vendeurs (WP09, T039)', () => {
  let w: MediaWorld;
  let app: INestApplication;
  let merchantA: string;
  let merchantA2: string;
  let merchantB: string;
  let vendorB: string;
  let merchantAdminA: TestPerson;
  let merchantAdminA2: TestPerson;
  let operatorAdminB: TestPerson;

  const as = (person: { token: string }) => ({
    get: (path: string) =>
      request(app.getHttpServer()).get(`/v1${path}`).set('Authorization', `Bearer ${person.token}`),
    post: (path: string, body: unknown, key: string = randomUUID()) =>
      request(app.getHttpServer())
        .post(`/v1${path}`)
        .set('Authorization', `Bearer ${person.token}`)
        .set('Idempotency-Key', key)
        .send(body as object),
  });
  const create = (person: TestPerson, merchant: string, name = 'Awa (bar)', pin = PIN) =>
    as(person).post(`/merchants/${merchant}/vendors`, { display_name: name, pin });

  const auditOf = (vendorId: string) =>
    ownerRows<{ action: string; actor_id: string | null; before: unknown; after: unknown }>(
      `SELECT action, actor_id, before, after FROM audit_log
        WHERE object_type = 'vendor' AND object_id = $1 ORDER BY seq`,
      [vendorId],
    );

  beforeAll(async () => {
    w = await createMediaWorld();
    await withOwner(async (db) => {
      merchantA = (await seedPos(db, { operatorId: w.ops.a, eventId: w.ids.eventA })).merchantId;
      merchantA2 = (await seedPos(db, { operatorId: w.ops.a, eventId: w.ids.eventA })).merchantId;
      merchantB = randomUUID();
      await db.query(
        `INSERT INTO party (id, kind, operator_id, legal_name, country_code)
         VALUES ($1, 'MERCHANT', $2, 'Commerçant B', 'SN')`,
        [merchantB, w.ops.b],
      );
      merchantAdminA = await w.idp.createPerson(db, {
        operatorId: w.ops.a,
        roles: [{ role: 'MERCHANT_ADMIN', scopeType: 'MERCHANT', scopeId: merchantA }],
      });
      merchantAdminA2 = await w.idp.createPerson(db, {
        operatorId: w.ops.a,
        roles: [{ role: 'MERCHANT_ADMIN', scopeType: 'MERCHANT', scopeId: merchantA2 }],
      });
      operatorAdminB = await w.idp.createPerson(db, {
        operatorId: w.ops.b,
        roles: [{ role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: w.ops.b }],
      });
    });
    app = await createTestApp({ identity: w.idp });
    const pinHash = await app.get(VendorPinHasher, { strict: false }).hash(PIN);
    vendorB = await withOwner((db) =>
      seedVendor(db, {
        operatorId: w.ops.b,
        merchantId: merchantB,
        actorId: operatorAdminB.userId,
        displayName: 'Vendeur B',
        pinHash,
      }),
    );
  });

  afterAll(async () => {
    await app?.close();
  });

  it('FR-001 : création par le MERCHANT_ADMIN, 201 + Location, Vendor sans PIN ni empreinte', async () => {
    const res = await create(merchantAdminA, merchantA);
    expect(res.status).toBe(201);
    expect(contractViolations('Vendor', res.body)).toEqual([]);
    expect(res.body).toMatchObject({
      merchant_id: merchantA,
      display_name: 'Awa (bar)',
      status: 'ACTIVE',
      locked: false,
    });
    expect(res.headers.location).toBe(`/v1/vendors/${res.body.vendor_id}`);
    expect(res.text).not.toContain(PIN);
    expect(res.text).not.toContain('$argon2');
    // Empreinte en base : argon2id PHC, jamais le PIN.
    const [row] = await ownerRows<{ pin_hash: string }>(
      'SELECT pin_hash FROM vendor WHERE id = $1',
      [res.body.vendor_id],
    );
    expect(row!.pin_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(row!.pin_hash).not.toContain(PIN);
  });

  it('FR-026, NFR-002 : audit VENDOR_CREATED et registre d’idempotence sans PIN ni empreinte', async () => {
    const key = randomUUID();
    const res = await as(merchantAdminA).post(
      `/merchants/${merchantA}/vendors`,
      { display_name: 'Moussa', pin: PIN },
      key,
    );
    expect(res.status).toBe(201);
    const audit = await auditOf(res.body.vendor_id);
    expect(audit.map((a) => [a.action, a.actor_id])).toEqual([
      ['VENDOR_CREATED', merchantAdminA.userId],
    ]);
    const stored = await ownerRows<{ text: string }>(
      `SELECT row_to_json(i)::text AS text FROM api_idempotency i WHERE idempotency_key = $1`,
      [key],
    );
    expect(stored).toHaveLength(1);
    for (const text of [JSON.stringify(audit), stored[0]!.text]) {
      expect(text).not.toContain(PIN);
      expect(text).not.toContain('$argon2');
    }
    // Rejeu de la même clé : la réponse enregistrée, sans second vendeur.
    const replay = await as(merchantAdminA).post(
      `/merchants/${merchantA}/vendors`,
      { display_name: 'Moussa', pin: PIN },
      key,
    );
    expect([replay.status, replay.headers['idempotency-replayed']]).toEqual([201, 'true']);
    expect(replay.body).toEqual(res.body);
  });

  it('liste et fiche : MERCHANT_ADMIN et OPERATOR_ADMIN ; filtre de statut ; pagination', async () => {
    const created = await create(merchantAdminA, merchantA, 'Zoé');
    for (const person of [merchantAdminA, w.operatorAdminA]) {
      const list = await as(person).get(`/merchants/${merchantA}/vendors?limit=200`);
      expect(list.status).toBe(200);
      expect(contractViolations('VendorPage', list.body)).toEqual([]);
      expect(list.body.data.map((v: { vendor_id: string }) => v.vendor_id)).toContain(
        created.body.vendor_id,
      );
      expect(JSON.stringify(list.body)).not.toMatch(/pin|failed_attempts|locked_at/);
      const one = await as(person).get(`/vendors/${created.body.vendor_id}`);
      expect([one.status, one.body]).toEqual([200, created.body]);
    }
    const page = await as(merchantAdminA).get(`/merchants/${merchantA}/vendors?limit=1`);
    expect([page.body.data.length, page.body.has_more]).toEqual([1, true]);
    const disabled = await as(merchantAdminA).get(
      `/merchants/${merchantA}/vendors?status=DISABLED`,
    );
    expect(disabled.body.data).toEqual([]);
  });

  it('FR-002 : nouveau PIN (OPERATOR_ADMIN) débloque, audit « débloqué », sans PIN', async () => {
    const created = await create(merchantAdminA, merchantA, 'Bloqué');
    const id = created.body.vendor_id as string;
    // Amorçage : blocage posé à la main (5 essais comptés).
    await withOwner((db) =>
      db.query(`UPDATE vendor SET failed_attempts = 5, locked_at = now() WHERE id = $1`, [id]),
    );
    expect((await as(merchantAdminA).get(`/vendors/${id}`)).body.locked).toBe(true);
    const res = await as(w.operatorAdminA).post(`/vendors/${id}/pin`, { pin: NEW_PIN });
    expect(res.status).toBe(200);
    expect(contractViolations('Vendor', res.body)).toEqual([]);
    expect(res.body.locked).toBe(false);
    expect(res.text).not.toContain(NEW_PIN);
    const [row] = await ownerRows<{ failed_attempts: number; locked_at: Date | null }>(
      'SELECT failed_attempts, locked_at FROM vendor WHERE id = $1',
      [id],
    );
    expect(row).toEqual({ failed_attempts: 0, locked_at: null });
    const audit = await auditOf(id);
    expect(audit.at(-1)).toMatchObject({
      action: 'VENDOR_PIN_CHANGED',
      actor_id: w.operatorAdminA.userId,
      before: { locked: true },
      after: { locked: false, unlocked: true },
    });
    expect(JSON.stringify(audit)).not.toMatch(new RegExp(`${NEW_PIN}|\\$argon2`));
    // Le nouveau PIN est bien celui en base (vérifié par le hacheur de l'application).
    const [hash] = await ownerRows<{ pin_hash: string }>(
      'SELECT pin_hash FROM vendor WHERE id = $1',
      [id],
    );
    const hasher = app.get(VendorPinHasher, { strict: false });
    expect(await hasher.verify(hash!.pin_hash, NEW_PIN)).toBe(true);
    expect(await hasher.verify(hash!.pin_hash, PIN)).toBe(false);
  });

  it('FR-001 : désactivation puis réactivation, audit VENDOR_DISABLED et VENDOR_REACTIVATED', async () => {
    const created = await create(merchantAdminA, merchantA, 'Statut');
    const id = created.body.vendor_id as string;
    const off = await as(merchantAdminA).post(`/vendors/${id}/status`, { status: 'DISABLED' });
    expect([off.status, off.body.status]).toEqual([200, 'DISABLED']);
    const on = await as(w.operatorAdminA).post(`/vendors/${id}/status`, { status: 'ACTIVE' });
    expect([on.status, on.body.status]).toEqual([200, 'ACTIVE']);
    expect((await auditOf(id)).map((a) => [a.action, a.before, a.after])).toEqual([
      ['VENDOR_CREATED', null, expect.anything()],
      ['VENDOR_DISABLED', { status: 'ACTIVE' }, { status: 'DISABLED', locked: false }],
      ['VENDOR_REACTIVATED', { status: 'DISABLED' }, { status: 'ACTIVE', locked: false }],
    ]);
  });

  it('NFR-002 : PIN mal formé → 422 sans écho, rien écrit', async () => {
    const before = await ownerRows<{ n: number }>(
      'SELECT count(*)::int AS n FROM vendor WHERE merchant_id = $1',
      [merchantA],
    );
    const vendor = (await create(merchantAdminA, merchantA, 'PIN')).body.vendor_id as string;
    for (const pin of ['12345', '1234567', 'abcdef', ' 98765', 987654]) {
      const made = await create(merchantAdminA, merchantA, 'Refus', pin as string);
      const changed = await as(merchantAdminA).post(`/vendors/${vendor}/pin`, { pin });
      for (const res of [made, changed]) {
        expect([res.status, res.body.code]).toEqual([422, 'VALIDATION_FAILED']);
        expect(res.text).not.toContain(String(pin).trim());
      }
    }
    const after = await ownerRows<{ n: number }>(
      'SELECT count(*)::int AS n FROM vendor WHERE merchant_id = $1',
      [merchantA],
    );
    expect(after[0]!.n).toBe(before[0]!.n + 1);
    const name = await create(merchantAdminA, merchantA, 'x'.repeat(81));
    expect([name.status, name.body.code]).toEqual([422, 'VALIDATION_FAILED']);
  });

  it('NFR-007 : hors périmètre ou autre prestataire → 404 neutre, rien écrit', async () => {
    const vendorA = (await create(merchantAdminA, merchantA, 'Isolé')).body.vendor_id as string;
    const unknownVendor = randomUUID();
    const reference = stable((await as(w.operatorAdminA).get(`/vendors/${unknownVendor}`)).body);
    expect(reference.status).toBe(404);
    const attempts: Array<[string, () => request.Test]> = [
      ['A2 liste A', () => as(merchantAdminA2).get(`/merchants/${merchantA}/vendors`)],
      ['A2 crée chez A', () => create(merchantAdminA2, merchantA)],
      ['A2 fiche A', () => as(merchantAdminA2).get(`/vendors/${vendorA}`)],
      ['A2 PIN A', () => as(merchantAdminA2).post(`/vendors/${vendorA}/pin`, { pin: NEW_PIN })],
      [
        'A2 statut A',
        () => as(merchantAdminA2).post(`/vendors/${vendorA}/status`, { status: 'DISABLED' }),
      ],
      ['B liste A', () => as(operatorAdminB).get(`/merchants/${merchantA}/vendors`)],
      ['B crée chez A', () => create(operatorAdminB, merchantA)],
      ['B fiche A', () => as(operatorAdminB).get(`/vendors/${vendorA}`)],
      ['B PIN A', () => as(operatorAdminB).post(`/vendors/${vendorA}/pin`, { pin: NEW_PIN })],
      ['A fiche B', () => as(w.operatorAdminA).get(`/vendors/${vendorB}`)],
      ['A liste B', () => as(w.operatorAdminA).get(`/merchants/${merchantB}/vendors`)],
      [
        'A statut B',
        () => as(w.operatorAdminA).post(`/vendors/${vendorB}/status`, { status: 'DISABLED' }),
      ],
      ['A commerçant inconnu', () => create(w.operatorAdminA, randomUUID())],
    ];
    const wrong: string[] = [];
    for (const [name, send] of attempts) {
      const res = await send();
      if (JSON.stringify(stable(res.body)) !== JSON.stringify(reference))
        wrong.push(`${name} : ${res.status} ${String(res.body.code)}`);
    }
    expect(wrong).toEqual([]);
    const [a] = await ownerRows<{ status: string; failed_attempts: number }>(
      'SELECT status, failed_attempts FROM vendor WHERE id = $1',
      [vendorA],
    );
    expect(a).toEqual({ status: 'ACTIVE', failed_attempts: 0 });
    expect(
      (
        await ownerRows<{ status: string }>('SELECT status FROM vendor WHERE id = $1', [vendorB])
      )[0],
    ).toEqual({ status: 'ACTIVE' });
    expect((await auditOf(vendorA)).map((x) => x.action)).toEqual(['VENDOR_CREATED']);
  });

  it('rôle non admis (CASHIER, ORGANIZER_ADMIN) → 403 ; sans jeton → 401', async () => {
    for (const person of [w.cashierA, w.organizerAdminA]) {
      const list = await as(person).get(`/merchants/${merchantA}/vendors`);
      const made = await create(person, merchantA);
      expect([list.status, made.status]).toEqual([403, 403]);
    }
    expect(
      (await request(app.getHttpServer()).get(`/v1/merchants/${merchantA}/vendors`)).status,
    ).toBe(401);
  });
});
