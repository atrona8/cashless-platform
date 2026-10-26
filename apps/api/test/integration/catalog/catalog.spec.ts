// Back-office du catalogue (mission 5b, lot WP10, T044, T045, T047 ; FR-007, FR-026, NFR-007 ;
// contracts/catalog.md ; research R-11 A21). Routes servies à une personne (`FakeIdp`, vraie garde)
// :
// création et modification par ORGANIZER_ADMIN et OPERATOR_ADMIN, une version par écriture,
// versions
// précédentes inchangées ; MERCHANT_ADMIN refusé sans délégation, accepté avec, refusé après
// retrait
// (y compris un retrait validé pendant que sa requête attend le verrou de la base) ; autre
// organisateur, autre commerçant, autre prestataire → 404 ; écritures simultanées → versions
// successives ; événement CLOSED → 409 ; audit avec la version créée ; rejeu d'une clé.
//
// Écritures directes en base : amorçage seulement (commerçants, participations, points de vente,
// personnes, clôture de l'événement C sans ses déclencheurs) et le retrait concurrent de la
// délégation (propriétaire, pour tenir le verrou de la ligne pendant la requête).
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../support/app';
import { contractViolations } from '../../support/contract-schema';
import { commitWhileWaiting, withOwner } from '../../support/db';
import type { TestPerson } from '../../support/fake-idp';
import { createMediaWorld, ownerRows, type MediaWorld } from '../../support/media-fixtures';

type Method = 'get' | 'post' | 'patch' | 'put';

describe('Back-office du catalogue (WP10)', () => {
  let w: MediaWorld;
  let app: INestApplication;
  const ids = {
    organizerA2: randomUUID(),
    eventA2: randomUUID(),
    eventC: randomUUID(),
    merchantM: randomUUID(),
    merchantN: randomUUID(),
    participationM: randomUUID(),
    participationA2: randomUUID(),
    participationC: randomUUID(),
    posA: randomUUID(), // événement A, commerçant M
    posA2: randomUUID(), // événement A2 (autre organisateur du même prestataire)
    posC: randomUUID(), // événement C, clos
  };
  let merchantAdminM: TestPerson;
  let merchantAdminN: TestPerson;
  let organizerAdminA2: TestPerson;
  let operatorAdminB: TestPerson;

  const call = (
    person: { token: string },
    method: Method,
    path: string,
    body?: unknown,
    key: string | null = randomUUID(),
  ) => {
    const req = request(app.getHttpServer())
      [method](`/v1${path}`)
      .set('Authorization', `Bearer ${person.token}`);
    if (method === 'get') return req;
    if (key !== null) req.set('Idempotency-Key', key);
    return req.send(body as object);
  };
  const versionsOf = async (posId: string) =>
    (
      await ownerRows<{ n: number }>(
        'SELECT coalesce(max(version), 0)::int AS n FROM catalog_version WHERE pos_id = $1',
        [posId],
      )
    )[0]!.n;
  const newCategory = async (person: TestPerson, posId: string, label = `Cat ${randomUUID()}`) => {
    const res = await call(person, 'post', `/points-of-sale/${posId}/catalog/categories`, {
      label_fr: label,
      label_en: `${label} (en)`,
    });
    expect(res.status).toBe(201);
    return res.body as { category: { category_id: string }; catalog_version: number };
  };
  const newItem = async (person: TestPerson, categoryId: string, price = 1000) => {
    const res = await call(person, 'post', `/catalog-categories/${categoryId}/items`, {
      label_fr: `Article ${randomUUID()}`,
      label_en: 'Item',
      unit_price: price,
      vat_rate_bps: 1800,
    });
    expect(res.status).toBe(201);
    return res.body as { item: { item_id: string }; catalog_version: number };
  };
  const setPolicy = (person: TestPerson, posId: string, merchantManages: boolean) =>
    call(person, 'put', `/points-of-sale/${posId}/catalog-policy`, {
      merchant_manages: merchantManages,
    });

  beforeAll(async () => {
    w = await createMediaWorld();
    await withOwner(async (db) => {
      const { rows: event } = await db.query<{ jurisdiction_id: string }>(
        'SELECT jurisdiction_id FROM event WHERE id = $1',
        [w.ids.eventA],
      );
      const jurisdiction = event[0]!.jurisdiction_id;
      await db.query(
        `INSERT INTO party (id, kind, operator_id, legal_name, country_code) VALUES
           ($1, 'ORGANIZER', $4, 'Organisateur A2', 'SN'),
           ($2, 'MERCHANT', $4, 'Commerçant M', 'SN'),
           ($3, 'MERCHANT', $4, 'Commerçant N', 'SN')`,
        [ids.organizerA2, ids.merchantM, ids.merchantN, w.ops.a],
      );
      await db.query(
        `INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone,
                            jurisdiction_id, funds_holder) VALUES
           ($1, $3, $4, 'Événement A2', 'XOF', 'Africa/Dakar', $6, 'ORGANIZER'),
           ($2, $3, $5, 'Événement C', 'XOF', 'Africa/Dakar', $6, 'ORGANIZER')`,
        [ids.eventA2, ids.eventC, w.ops.a, ids.organizerA2, w.ids.organizerA, jurisdiction],
      );
      await db.query(
        `INSERT INTO merchant_participation (id, operator_id, event_id, merchant_id, link_type)
         VALUES ($1, $4, $5, $7, 'EXTERNAL'), ($2, $4, $6, $7, 'EXTERNAL'),
                ($3, $4, $8, $7, 'EXTERNAL')`,
        [
          ids.participationM,
          ids.participationA2,
          ids.participationC,
          w.ops.a,
          w.ids.eventA,
          ids.eventA2,
          ids.merchantM,
          ids.eventC,
        ],
      );
      await db.query(
        `INSERT INTO point_of_sale (id, operator_id, participation_id, name) VALUES
           ($1, $4, $5, 'Buvette A'), ($2, $4, $6, 'Buvette A2'), ($3, $4, $7, 'Buvette C')`,
        [
          ids.posA,
          ids.posA2,
          ids.posC,
          w.ops.a,
          ids.participationM,
          ids.participationA2,
          ids.participationC,
        ],
      );
      merchantAdminM = await w.idp.createPerson(db, {
        operatorId: w.ops.a,
        roles: [{ role: 'MERCHANT_ADMIN', scopeType: 'MERCHANT', scopeId: ids.merchantM }],
      });
      merchantAdminN = await w.idp.createPerson(db, {
        operatorId: w.ops.a,
        roles: [{ role: 'MERCHANT_ADMIN', scopeType: 'MERCHANT', scopeId: ids.merchantN }],
      });
      organizerAdminA2 = await w.idp.createPerson(db, {
        operatorId: w.ops.a,
        roles: [{ role: 'ORGANIZER_ADMIN', scopeType: 'ORGANIZER', scopeId: ids.organizerA2 }],
      });
      operatorAdminB = await w.idp.createPerson(db, {
        operatorId: w.ops.b,
        roles: [{ role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: w.ops.b }],
      });
    });
    app = await createTestApp({ identity: w.idp });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('FR-007 : ORGANIZER_ADMIN puis OPERATOR_ADMIN écrivent ; une version par écriture ; versions précédentes inchangées', async () => {
    const start = await versionsOf(ids.posA);
    const created = await call(
      w.organizerAdminA,
      'post',
      `/points-of-sale/${ids.posA}/catalog/categories`,
      { label_fr: '  Boissons ', label_en: 'Drinks', position: 1 },
    );
    expect(created.status).toBe(201);
    expect(contractViolations('CatalogCategoryResult', created.body)).toEqual([]);
    expect(created.body).toMatchObject({
      category: { label_fr: 'Boissons', label_en: 'Drinks', position: 1, active: true },
      catalog_version: start + 1,
    });
    const categoryId = created.body.category.category_id as string;

    const item = await call(w.organizerAdminA, 'post', `/catalog-categories/${categoryId}/items`, {
      label_fr: 'Bissap 33 cl',
      label_en: 'Bissap 33 cl',
      unit_price: 1000,
      vat_rate_bps: 1800,
    });
    expect(item.status).toBe(201);
    expect(contractViolations('CatalogItemResult', item.body)).toEqual([]);
    expect(item.body).toMatchObject({
      item: { category_id: categoryId, unit_price: 1000, vat_rate_bps: 1800, active: true },
      catalog_version: start + 2,
    });
    const itemId = item.body.item.item_id as string;

    const repriced = await call(w.operatorAdminA, 'patch', `/catalog-items/${itemId}`, {
      unit_price: 1200,
    });
    expect(repriced.status).toBe(200);
    expect(repriced.body).toMatchObject({
      item: { item_id: itemId, unit_price: 1200, label_fr: 'Bissap 33 cl' },
      catalog_version: start + 3,
    });

    const renamed = await call(w.operatorAdminA, 'patch', `/catalog-categories/${categoryId}`, {
      label_en: 'Beverages',
      position: 0,
    });
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({
      category: { label_fr: 'Boissons', label_en: 'Beverages', position: 0 },
      catalog_version: start + 4,
    });

    // Version précédente inchangée : la version 2 garde le prix 1000.
    const v2 = await call(
      w.organizerAdminA,
      'get',
      `/points-of-sale/${ids.posA}/catalog/versions/${start + 2}`,
    );
    expect(v2.status).toBe(200);
    expect(contractViolations('CatalogVersion', v2.body)).toEqual([]);
    expect(v2.body.items).toEqual([
      {
        item_id: itemId,
        category_id: categoryId,
        label_fr: 'Bissap 33 cl',
        label_en: 'Bissap 33 cl',
        unit_price: 1000,
        vat_rate_bps: 1800,
      },
    ]);
    const v3 = await call(
      w.organizerAdminA,
      'get',
      `/points-of-sale/${ids.posA}/catalog/versions/${start + 3}`,
    );
    expect(v3.body.items[0].unit_price).toBe(1200);

    // Désactivation : l'article reste au catalogue courant, absent de la version suivante.
    const off = await call(w.organizerAdminA, 'patch', `/catalog-items/${itemId}`, {
      active: false,
    });
    expect(off.body.catalog_version).toBe(start + 5);
    const v5 = await call(
      w.organizerAdminA,
      'get',
      `/points-of-sale/${ids.posA}/catalog/versions/${start + 5}`,
    );
    expect(v5.body.items).toEqual([]);

    const current = await call(w.organizerAdminA, 'get', `/points-of-sale/${ids.posA}/catalog`);
    expect(current.status).toBe(200);
    expect(contractViolations('Catalog', current.body)).toEqual([]);
    expect(current.body).toMatchObject({
      pos_id: ids.posA,
      version: start + 5,
      merchant_manages: false,
    });
    expect(current.body.items).toContainEqual(
      expect.objectContaining({ item_id: itemId, unit_price: 1200, active: false }),
    );

    // Version inconnue → 404 ; version mal formée → 400.
    const missing = await call(
      w.organizerAdminA,
      'get',
      `/points-of-sale/${ids.posA}/catalog/versions/${start + 99}`,
    );
    expect(missing.status).toBe(404);
    const malformed = await call(
      w.organizerAdminA,
      'get',
      `/points-of-sale/${ids.posA}/catalog/versions/abc`,
    );
    expect(malformed.status).toBe(400);
  });

  it('getCatalog : catégories ordonnées par rang ; point de vente sans catalogue : version 0', async () => {
    const empty = await call(w.operatorAdminA, 'get', `/points-of-sale/${ids.posA2}/catalog`);
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({
      pos_id: ids.posA2,
      version: 0,
      merchant_manages: false,
      categories: [],
      items: [],
    });
    await call(w.operatorAdminA, 'post', `/points-of-sale/${ids.posA2}/catalog/categories`, {
      label_fr: 'Second',
      label_en: 'Second',
      position: 5,
    });
    await call(w.operatorAdminA, 'post', `/points-of-sale/${ids.posA2}/catalog/categories`, {
      label_fr: 'Premier',
      label_en: 'First',
      position: 2,
    });
    // Sans rang : après la dernière (6).
    const last = await call(
      w.operatorAdminA,
      'post',
      `/points-of-sale/${ids.posA2}/catalog/categories`,
      { label_fr: 'Dernier', label_en: 'Last' },
    );
    expect(last.body.category.position).toBe(6);
    const list = await call(w.operatorAdminA, 'get', `/points-of-sale/${ids.posA2}/catalog`);
    expect(list.body.categories.map((c: { label_fr: string }) => c.label_fr)).toEqual([
      'Premier',
      'Second',
      'Dernier',
    ]);
    expect(list.body.version).toBe(3);
  });

  it('FR-026 : une ligne d’audit par écriture, avec la version créée, l’auteur et son rôle', async () => {
    const category = await newCategory(w.organizerAdminA, ids.posA);
    const categoryId = category.category.category_id;
    const item = await newItem(w.operatorAdminA, categoryId, 2500);
    const updated = await call(w.operatorAdminA, 'patch', `/catalog-items/${item.item.item_id}`, {
      unit_price: 2600,
      label_en: 'Updated',
    });
    const rows = await ownerRows<{
      action: string;
      actor_id: string;
      actor_role: string;
      before: Record<string, unknown> | null;
      after: Record<string, unknown>;
    }>(
      `SELECT action, actor_id::text, actor_role, before, after FROM audit_log
        WHERE object_id IN ($1, $2) ORDER BY seq`,
      [categoryId, item.item.item_id],
    );
    expect(rows.map((r) => [r.action, r.actor_role, r.after.catalog_version])).toEqual([
      ['CATALOG_CATEGORY_CREATED', 'ORGANIZER_ADMIN', category.catalog_version],
      ['CATALOG_ITEM_CREATED', 'OPERATOR_ADMIN', item.catalog_version],
      ['CATALOG_ITEM_UPDATED', 'OPERATOR_ADMIN', updated.body.catalog_version],
    ]);
    expect(rows[0]!.actor_id).toBe(w.organizerAdminA.userId);
    expect(rows[1]!.after).toMatchObject({
      unit_price: '2500',
      vat_rate_bps: 1800,
      pos_id: ids.posA,
    });
    expect(rows[2]!.before).toMatchObject({ unit_price: '2500', label_en: 'Item' });
    expect(rows[2]!.after).toEqual({
      unit_price: '2600',
      label_en: 'Updated',
      catalog_version: updated.body.catalog_version,
    });

    const policy = await setPolicy(w.operatorAdminA, ids.posA2, true);
    expect(policy.status).toBe(200);
    await setPolicy(w.operatorAdminA, ids.posA2, false);
    const policyRows = await ownerRows<{ before: unknown; after: unknown }>(
      `SELECT before, after FROM audit_log
        WHERE action = 'CATALOG_POLICY_SET' AND object_id = $1 ORDER BY seq`,
      [ids.posA2],
    );
    expect(policyRows).toEqual([
      { before: { merchant_manages: false }, after: { merchant_manages: true } },
      { before: { merchant_manages: true }, after: { merchant_manages: false } },
    ]);
  });

  it('T045 : MERCHANT_ADMIN refusé sans délégation (403), accepté avec, refusé après retrait ; jamais la délégation', async () => {
    const category = await newCategory(w.organizerAdminA, ids.posA);
    const categoryId = category.category.category_id;
    expect((await setPolicy(w.organizerAdminA, ids.posA, false)).status).toBe(200);

    // Lecture permise au commerçant du point de vente.
    const read = await call(merchantAdminM, 'get', `/points-of-sale/${ids.posA}/catalog`);
    expect(read.status).toBe(200);
    const version = await versionsOf(ids.posA);
    const before = await versionsOf(ids.posA);
    const refused = await call(merchantAdminM, 'post', `/catalog-categories/${categoryId}/items`, {
      label_fr: 'Sans délégation',
      label_en: 'No delegation',
      unit_price: 500,
      vat_rate_bps: 0,
    });
    expect([refused.status, refused.body.code]).toEqual([403, 'FORBIDDEN']);
    expect(await versionsOf(ids.posA)).toBe(before);

    // Le commerçant ne se délègue jamais lui-même.
    const self = await setPolicy(merchantAdminM, ids.posA, true);
    expect([self.status, self.body.code]).toEqual([403, 'FORBIDDEN']);

    const granted = await setPolicy(w.organizerAdminA, ids.posA, true);
    expect(granted.status).toBe(200);
    expect(contractViolations('CatalogPolicy', granted.body)).toEqual([]);
    expect(granted.body).toEqual({ pos_id: ids.posA, merchant_manages: true });
    const accepted = await newItem(merchantAdminM, categoryId, 700);
    expect(accepted.catalog_version).toBe(version + 1);
    const audit = await ownerRows<{ actor_role: string }>(
      `SELECT actor_role FROM audit_log WHERE object_id = $1`,
      [accepted.item.item_id],
    );
    expect(audit).toEqual([{ actor_role: 'MERCHANT_ADMIN' }]);

    expect((await setPolicy(w.operatorAdminA, ids.posA, false)).status).toBe(200);
    const after = await call(merchantAdminM, 'patch', `/catalog-items/${accepted.item.item_id}`, {
      unit_price: 800,
    });
    expect([after.status, after.body.code]).toEqual([403, 'FORBIDDEN']);
    expect(await versionsOf(ids.posA)).toBe(version + 1);
  });

  it('A21 : délégation retirée pendant que la requête du commerçant attend le verrou → refus de la base, rien écrit', async () => {
    const category = await newCategory(w.organizerAdminA, ids.posA);
    expect((await setPolicy(w.organizerAdminA, ids.posA, true)).status).toBe(200);
    const before = await versionsOf(ids.posA);
    // L'API lit la délégation (vraie) avant le verrou ; la base la relit sous verrou (fausse).
    const res = await commitWhileWaiting(
      {
        sql: `UPDATE point_of_sale_catalog_policy SET merchant_manages = false WHERE pos_id = $1`,
        params: [ids.posA],
      },
      { role: 'cashless_app', statement: 'create_catalog_item' },
      () =>
        call(merchantAdminM, 'post', `/catalog-categories/${category.category.category_id}/items`, {
          label_fr: 'Course',
          label_en: 'Race',
          unit_price: 900,
          vat_rate_bps: 0,
        }),
    );
    expect([res.status, res.body.code]).toEqual([404, 'NOT_FOUND']);
    expect(await versionsOf(ids.posA)).toBe(before);
    const items = await ownerRows('SELECT 1 FROM catalog_item WHERE label_fr = $1', ['Course']);
    expect(items).toEqual([]);
  });

  it('NFR-007 : autre organisateur, autre commerçant, autre prestataire → 404 ; rôle absent → 403', async () => {
    const category = await newCategory(w.organizerAdminA, ids.posA);
    const categoryId = category.category.category_id;
    const item = await newItem(w.organizerAdminA, categoryId);
    expect((await setPolicy(w.organizerAdminA, ids.posA, true)).status).toBe(200);
    const before = await versionsOf(ids.posA);
    const itemBody = { label_fr: 'Intrus', label_en: 'Intruder', unit_price: 1, vat_rate_bps: 0 };
    const routes: Array<[Method, string, unknown]> = [
      ['get', `/points-of-sale/${ids.posA}/catalog`, undefined],
      ['get', `/points-of-sale/${ids.posA}/catalog/versions/1`, undefined],
      ['post', `/points-of-sale/${ids.posA}/catalog/categories`, { label_fr: 'x', label_en: 'y' }],
      ['patch', `/catalog-categories/${categoryId}`, { label_fr: 'Intrus' }],
      ['post', `/catalog-categories/${categoryId}/items`, itemBody],
      ['patch', `/catalog-items/${item.item.item_id}`, { unit_price: 1 }],
      ['put', `/points-of-sale/${ids.posA}/catalog-policy`, { merchant_manages: false }],
    ];
    for (const intruder of [organizerAdminA2, merchantAdminN, operatorAdminB]) {
      for (const [method, path, body] of routes) {
        const res = await call(intruder, method, path, body);
        expect([path, res.status, res.body.code]).toEqual([path, 404, 'NOT_FOUND']);
        expect(res.text).not.toContain('Intrus');
      }
    }
    for (const [method, path, body] of routes) {
      const res = await call(w.cashierA, method, path, body);
      expect([path, res.status]).toEqual([path, 403]);
    }
    // Objet inconnu : même 404.
    const unknown = await call(w.operatorAdminA, 'patch', `/catalog-items/${randomUUID()}`, {
      active: false,
    });
    expect(unknown.status).toBe(404);
    expect(await versionsOf(ids.posA)).toBe(before);
    const policy = await ownerRows<{ merchant_manages: boolean }>(
      'SELECT merchant_manages FROM point_of_sale_catalog_policy WHERE pos_id = $1',
      [ids.posA],
    );
    expect(policy).toEqual([{ merchant_manages: true }]);
  });

  it('article déplacé vers une catégorie d’un autre point de vente → 404 ; bornes → 422', async () => {
    const here = await newCategory(w.organizerAdminA, ids.posA);
    const there = await newCategory(w.operatorAdminA, ids.posA2);
    const item = await newItem(w.organizerAdminA, here.category.category_id);
    const before = await versionsOf(ids.posA);
    const moved = await call(w.organizerAdminA, 'patch', `/catalog-items/${item.item.item_id}`, {
      category_id: there.category.category_id,
    });
    expect(moved.status).toBe(404);
    const bad = await call(
      w.organizerAdminA,
      'post',
      `/catalog-categories/${here.category.category_id}/items`,
      { label_fr: '', label_en: 'x'.repeat(121), unit_price: 0, vat_rate_bps: 10_001 },
    );
    expect([bad.status, bad.body.code]).toEqual([422, 'VALIDATION_FAILED']);
    expect(bad.body.violations.map((v: { field: string }) => v.field)).toEqual([
      'label_fr',
      'label_en',
      'unit_price',
      'vat_rate_bps',
    ]);
    expect(await versionsOf(ids.posA)).toBe(before);
  });

  it('A21 : deux modifications simultanées → deux versions successives', async () => {
    const category = await newCategory(w.organizerAdminA, ids.posA);
    const item = await newItem(w.organizerAdminA, category.category.category_id);
    const before = await versionsOf(ids.posA);
    const [one, two] = await Promise.all([
      call(w.organizerAdminA, 'patch', `/catalog-items/${item.item.item_id}`, { unit_price: 111 }),
      call(w.operatorAdminA, 'patch', `/catalog-categories/${category.category.category_id}`, {
        position: 9,
      }),
    ]);
    expect([one.status, two.status]).toEqual([200, 200]);
    expect([one.body.catalog_version, two.body.catalog_version].sort()).toEqual([
      before + 1,
      before + 2,
    ]);
    expect(await versionsOf(ids.posA)).toBe(before + 2);
  });

  it('événement CLOSED : écriture refusée (409 CONFLICT_STATE), rien écrit', async () => {
    const category = await newCategory(w.organizerAdminA, ids.posC);
    await withOwner(async (db) => {
      await db.query(`SET session_replication_role = replica`);
      await db.query(`UPDATE event SET status = 'CLOSED' WHERE id = $1`, [ids.eventC]);
      await db.query(`SET session_replication_role = origin`);
    });
    const before = await versionsOf(ids.posC);
    const writes: Array<[Method, string, unknown]> = [
      ['post', `/points-of-sale/${ids.posC}/catalog/categories`, { label_fr: 'a', label_en: 'b' }],
      ['patch', `/catalog-categories/${category.category.category_id}`, { active: false }],
      [
        'post',
        `/catalog-categories/${category.category.category_id}/items`,
        { label_fr: 'a', label_en: 'b', unit_price: 1, vat_rate_bps: 0 },
      ],
      ['put', `/points-of-sale/${ids.posC}/catalog-policy`, { merchant_manages: true }],
    ];
    for (const [method, path, body] of writes) {
      const res = await call(w.organizerAdminA, method, path, body);
      expect([path, res.status, res.body.code]).toEqual([path, 409, 'CONFLICT_STATE']);
    }
    expect(await versionsOf(ids.posC)).toBe(before);
    // Lecture toujours permise.
    expect(
      (await call(w.organizerAdminA, 'get', `/points-of-sale/${ids.posC}/catalog`)).status,
    ).toBe(200);
  });

  it('rejeu d’une clé : réponse enregistrée, aucune nouvelle version ; clé obligatoire', async () => {
    const key = randomUUID();
    const body = { label_fr: 'Rejeu', label_en: 'Replay' };
    const path = `/points-of-sale/${ids.posA}/catalog/categories`;
    const first = await call(w.organizerAdminA, 'post', path, body, key);
    const version = await versionsOf(ids.posA);
    const replay = await call(w.organizerAdminA, 'post', path, body, key);
    expect([first.status, replay.status, replay.headers['idempotency-replayed']]).toEqual([
      201,
      201,
      'true',
    ]);
    expect(replay.body).toEqual(first.body);
    expect(await versionsOf(ids.posA)).toBe(version);
    const audits = await ownerRows('SELECT 1 FROM audit_log WHERE object_id = $1', [
      first.body.category.category_id,
    ]);
    expect(audits).toHaveLength(1);
    const noKey = await call(w.organizerAdminA, 'post', path, body, null);
    expect(noKey.status).toBe(400);
  });
});
