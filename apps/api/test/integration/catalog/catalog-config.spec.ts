// Catalogue servi dans la configuration du terminal (mission 5b, lot WP10, T046, T047 ; FR-008,
// part
// « version servie » de FR-012, NFR-007 ; contracts/catalog.md ; research R-04 révisé par A2).
// Terminaux de test enrôlés en propriétaire (`TestTerminal.enroll`), requêtes HTTPS avec les trois
// preuves. Catalogue écrit par les fonctions de la base (0032, auteur OPERATOR_ADMIN) : le
// back-office a sa propre suite (catalog.spec.ts).
//
// Prouvé : `catalog.version` = dernière version, inscrite dans `device_catalog_served` une seule
// fois
// par terminal, point de vente et version ; nouvelle version → nouvel ETag (configuration et
// battement de cœur), `config_id` identique ; libellés dans la langue de `Accept-Language` ; ordre
// rang de catégorie puis libellé ; aucun article d'un autre point de vente ; `KEYPAD_TPE` →
// `catalog: null` ; sans point de vente ou sans version → version 0, rien écrit ; terminal suspendu
// servi ; réponse conforme au schéma `DeviceConfig`.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { components } from '@cashless/contracts';
import type { DeviceCaPort } from '../../../src/device-ca/device-ca.port';
import { FakeDeviceCa } from '../../../src/device-ca/fake-device-ca';
import { DeviceTokenService } from '../../../src/device-tokens/device-token.service';
import { startHttpsApp, type HttpsTestApp } from '../../support/app';
import { contractViolations } from '../../support/contract-schema';
import { withOwner } from '../../support/db';
import { createMediaWorld, ownerRows, type MediaWorld } from '../../support/media-fixtures';
import {
  TestTerminal,
  type TerminalMode,
  type TerminalResponse,
} from '../../support/test-terminal';

type DeviceConfig = components['schemas']['DeviceConfig'];
type CatalogItem = components['schemas']['CatalogItem'];

describe('catalogue servi dans la configuration (WP10, T046)', () => {
  let w: MediaWorld;
  let api: HttpsTestApp;
  let ca: DeviceCaPort;
  let tokens: DeviceTokenService;
  const ids = {
    merchant: randomUUID(),
    participation: randomUUID(),
    posA: randomUUID(), // catalogue de deux catégories
    posB: randomUUID(), // autre point de vente du même événement, avec son catalogue
    posEmpty: randomUUID(), // sans catalogue
  };
  const cat = { drinks: '', food: '', other: '' };
  const item = { water: '', bissap: '', thieb: '', foreign: '' };

  /** Écriture du catalogue par une fonction de 0032 (prestataire A, auteur OPERATOR_ADMIN). */
  const write = (sql: string, params: unknown[]) =>
    withOwner(async (db) => {
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [w.ops.a]);
      const { rows } = await db.query<{ id: string; version: number }>(sql, [
        ...params,
        w.operatorAdminA.userId,
      ]);
      return rows[0]!;
    });
  const category = (posId: string, fr: string, en: string, position: number) =>
    write('SELECT id, version FROM create_catalog_category($1, $2, $3, $4, $5)', [
      posId,
      fr,
      en,
      position,
    ]);
  const newItem = (categoryId: string, fr: string, en: string, price: number) =>
    write('SELECT id, version FROM create_catalog_item($1, $2, $3, $4, 1800, $5)', [
      categoryId,
      fr,
      en,
      price,
    ]);
  const reprice = (itemId: string, price: number) =>
    write('SELECT id, version FROM update_catalog_item($1, NULL, NULL, NULL, $2, NULL, NULL, $3)', [
      itemId,
      price,
    ]);

  const enrolled = async (posId: string | null, mode: TerminalMode): Promise<TestTerminal> => {
    const t = await withOwner((db) =>
      new TestTerminal().enroll(db, {
        operatorId: w.ops.a,
        eventId: w.ids.eventA,
        posId,
        mode,
        ca,
      }),
    );
    await t.issueToken(tokens);
    return t;
  };
  const getConfig = (t: TestTerminal, headers: Record<string, string> = {}) =>
    t.request(
      api.baseUrl,
      api.tls.serverCaPem,
      { method: 'GET', path: '/device/config' },
      { headers },
    );
  const heartbeat = (t: TestTerminal) =>
    t.request(api.baseUrl, api.tls.serverCaPem, {
      method: 'POST',
      path: '/device/heartbeat',
      body: {
        device_time: new Date().toISOString(),
        snapshot_version: null,
        last_local_seq: 0,
        pending_operations: 0,
        pending_exposure: 0,
        battery_percent: 80,
        app_version: '1.0.0',
      },
    });
  const servedRows = (deviceId: string) =>
    ownerRows<{ pos_id: string; version: number }>(
      `SELECT pos_id, version FROM device_catalog_served WHERE device_id = $1
        ORDER BY version`,
      [deviceId],
    );
  const catalogOf = (res: TerminalResponse) =>
    (res.body as unknown as DeviceConfig).catalog as { version: number; items: CatalogItem[] };

  beforeAll(async () => {
    w = await createMediaWorld();
    api = await startHttpsApp(undefined, { identity: w.idp });
    ca = await FakeDeviceCa.fromFiles({
      certFile: api.tls.deviceCaCertFile,
      keyFile: api.tls.deviceCaFakeKeyFile,
    });
    tokens = api.app.get(DeviceTokenService, { strict: false });
    await withOwner(async (db) => {
      await db.query(
        `INSERT INTO party (id, kind, operator_id, legal_name)
         VALUES ($1, 'MERCHANT', $2, 'Buvette')`,
        [ids.merchant, w.ops.a],
      );
      await db.query(
        `INSERT INTO merchant_participation (id, operator_id, event_id, merchant_id, link_type)
         VALUES ($1, $2, $3, $4, 'EXTERNAL')`,
        [ids.participation, w.ops.a, w.ids.eventA, ids.merchant],
      );
      await db.query(
        `INSERT INTO point_of_sale (id, operator_id, participation_id, name) VALUES
           ($1, $4, $5, 'Comptoir A'), ($2, $4, $5, 'Comptoir B'), ($3, $4, $5, 'Comptoir vide')`,
        [ids.posA, ids.posB, ids.posEmpty, w.ops.a, ids.participation],
      );
    });
    // Point de vente A : « Plats » (rang 2) puis « Boissons » (rang 1), articles dans le désordre.
    cat.food = (await category(ids.posA, 'Plats', 'Dishes', 2)).id;
    cat.drinks = (await category(ids.posA, 'Boissons', 'Drinks', 1)).id;
    item.thieb = (await newItem(cat.food, 'Thiéboudienne', 'Fish and rice', 3500)).id;
    item.water = (await newItem(cat.drinks, 'Eau', 'Water', 500)).id;
    item.bissap = (await newItem(cat.drinks, 'Bissap', 'Hibiscus juice', 1000)).id;
    // Point de vente B : son propre article (jamais servi à un terminal de A).
    cat.other = (await category(ids.posB, 'Autre', 'Other', 0)).id;
    item.foreign = (await newItem(cat.other, 'Étranger', 'Foreign', 42)).id;
  });

  afterAll(async () => {
    await api?.close();
  });

  it('CATALOG_POS : dernière version servie, ordonnée, en français par défaut ; inscrite une fois ; conforme au contrat', async () => {
    const t = await enrolled(ids.posA, 'CATALOG_POS');
    const res = await getConfig(t);
    expect(res.status).toBe(200);
    expect(contractViolations('DeviceConfig', res.body)).toEqual([]);
    expect(catalogOf(res)).toEqual({
      version: 5,
      items: [
        {
          product_id: item.bissap,
          name: 'Bissap',
          unit_price: 1000,
          category: 'Boissons',
          vat_rate_bps: 1800,
        },
        {
          product_id: item.water,
          name: 'Eau',
          unit_price: 500,
          category: 'Boissons',
          vat_rate_bps: 1800,
        },
        {
          product_id: item.thieb,
          name: 'Thiéboudienne',
          unit_price: 3500,
          category: 'Plats',
          vat_rate_bps: 1800,
        },
      ],
    });
    expect(JSON.stringify(res.body)).not.toContain(item.foreign);
    expect(await servedRows(t.deviceId)).toEqual([{ pos_id: ids.posA, version: 5 }]);

    // Deux lectures sans modification : une seule ligne, même ETag, même config_id.
    const again = await getConfig(t);
    expect(again.headers.etag).toBe(res.headers.etag);
    expect(again.body.config_id).toBe(res.body.config_id);
    expect(await servedRows(t.deviceId)).toHaveLength(1);
    expect((await getConfig(t, { 'if-none-match': String(res.headers.etag) })).status).toBe(304);
    expect(await servedRows(t.deviceId)).toHaveLength(1);
  });

  it('FR-008 : nouvelle version → nouvel ETag (configuration et battement de cœur), config_id identique ; deux lignes servies', async () => {
    const t = await enrolled(ids.posA, 'CATALOG_POS');
    const first = await getConfig(t);
    const beat = await heartbeat(t);
    expect(beat.status).toBe(200);
    expect(beat.body.config_etag).toBe(first.headers.etag);
    const before = catalogOf(first).version;

    const changed = await reprice(item.water, 600);
    expect(changed.version).toBe(before + 1);
    // Le battement de cœur suivant annonce le changement.
    const nextBeat = await heartbeat(t);
    expect(nextBeat.body.config_etag).not.toBe(first.headers.etag);
    // Une version créée n'est pas inscrite tant qu'elle n'est pas servie (A2).
    expect((await servedRows(t.deviceId)).map((r) => r.version)).toEqual([before]);

    const after = await getConfig(t, { 'if-none-match': String(first.headers.etag) });
    expect(after.status).toBe(200);
    expect(after.headers.etag).not.toBe(first.headers.etag);
    expect(after.headers.etag).toBe(nextBeat.body.config_etag);
    expect(after.body.config_id).toBe(first.body.config_id);
    expect(catalogOf(after).version).toBe(before + 1);
    expect(catalogOf(after).items.find((i) => i.product_id === item.water)!.unit_price).toBe(600);
    expect(await servedRows(t.deviceId)).toEqual([
      { pos_id: ids.posA, version: before },
      { pos_id: ids.posA, version: before + 1 },
    ]);
  });

  it('Accept-Language: en → libellés anglais (article et catégorie)', async () => {
    const t = await enrolled(ids.posA, 'CATALOG_POS');
    const res = await getConfig(t, { 'accept-language': 'en-GB,en;q=0.9,fr;q=0.5' });
    expect(res.status).toBe(200);
    const items = catalogOf(res).items;
    expect(items.map((i) => [i.name, i.category])).toEqual([
      ['Hibiscus juice', 'Drinks'],
      ['Water', 'Drinks'],
      ['Fish and rice', 'Dishes'],
    ]);
    const fr = await getConfig(t, { 'accept-language': 'fr' });
    expect(fr.headers.etag).not.toBe(res.headers.etag);
    expect(fr.body.config_id).toBe(res.body.config_id);
  });

  it('KEYPAD_TPE → catalog null, rien inscrit', async () => {
    const t = await enrolled(ids.posA, 'KEYPAD_TPE');
    const res = await getConfig(t);
    expect(res.status).toBe(200);
    expect(contractViolations('DeviceConfig', res.body)).toEqual([]);
    expect(res.body.catalog).toBeNull();
    expect(await servedRows(t.deviceId)).toEqual([]);
  });

  it('CATALOG_POS sans point de vente, ou point de vente sans catalogue → version 0, rien inscrit', async () => {
    for (const posId of [null, ids.posEmpty]) {
      const t = await enrolled(posId, 'CATALOG_POS');
      const res = await getConfig(t);
      expect(res.status).toBe(200);
      expect(contractViolations('DeviceConfig', res.body)).toEqual([]);
      expect(res.body.catalog).toEqual({ version: 0, items: [] });
      expect(await servedRows(t.deviceId)).toEqual([]);
    }
  });

  it('terminal suspendu : configuration et catalogue servis, version inscrite', async () => {
    const t = await enrolled(ids.posB, 'CATALOG_POS');
    await withOwner((db) => t.setStatus(db, 'SUSPENDED'));
    const res = await getConfig(t);
    expect(res.status).toBe(200);
    expect(catalogOf(res)).toEqual({
      version: 2,
      items: [
        {
          product_id: item.foreign,
          name: 'Étranger',
          unit_price: 42,
          category: 'Autre',
          vat_rate_bps: 1800,
        },
      ],
    });
    expect(await servedRows(t.deviceId)).toEqual([{ pos_id: ids.posB, version: 2 }]);
  });
});
