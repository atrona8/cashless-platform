// Parcours complet des paiements (mission 5b, lot WP14, T066 ; SC-001, SC-002, SC-004, NFR-006 ; FR-001 à FR-026 ;
// quickstart.md), entièrement par l'API, en HTTPS réel avec un terminal de test (trois preuves), une vraie base et le
// festivalier du faux fournisseur d'identité :
//   1. un MERCHANT_ADMIN crée deux vendeurs ; 2. un ORGANIZER_ADMIN crée le catalogue (catégorie, articles) ;
//   3. une caisse CATALOG_POS s'enrôle (code émis pour son point de vente) et lit sa configuration (version du
//      catalogue) ; 4. ouverture de session ; 5. paiement par bracelet en un aller-retour, puis en deux temps
//      (`tap_id`) ; 6. QR commerçant payé par le festivalier ; 7. QR client encaissé ; 8. annulation par le vendeur ;
//      9. annulation hors fenêtre par un SUPERVISOR (jeton sur place) ; 10. 5 PIN faux : le vendeur est bloqué sur TOUS
//      les terminaux, un nouveau PIN le débloque (SC-004) ; 11. changement de prix pendant que la caisse a l'ancienne
//      configuration : l'ancien prix est accepté ; 12. contrôles finaux en lecture (SC-002, NFR-006).
//
// Écritures directes en base : amorçage seulement (jeu d'essai commun : prestataire, événement, commerçant, point de
// vente, bracelets crédités, festivalier) et UN recul de `recorded_at` d'une vente (étape 9 : la fenêtre se mesure sur
// l'heure de la base, on ne peut pas attendre 15 minutes). Aucune autre étape n'écrit en base.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { contractViolations } from '../../support/contract-schema';
import { asPerson } from '../../support/device-e2e';
import { withOwner } from '../../support/db';
import type { TestPerson } from '../../support/fake-idp';
import { ownerRows } from '../../support/media-fixtures';
import { send, TestTerminal, type TerminalResponse } from '../../support/test-terminal';
import { QrWorld } from '../payment-requests/qr-fixtures';
import { PIN, PaymentWorld, type PayMedia, type PayTerminal } from '../payments/payments-fixtures';
import { ReversalWorld } from '../reversals/reversal-fixtures';
import { asOperator, seedPos } from '../vendors/vendor-fixtures';

jest.setTimeout(300_000);

const NEW_PIN = '864202';
const WRONG_PIN = '000001';

describe('SC-001, SC-002, SC-004 : parcours complet des paiements, tout par l’API', () => {
  let pw: PaymentWorld;
  let qw: QrWorld;
  let rw: ReversalWorld;
  let merchantAdmin: TestPerson;
  let supervisor: TestPerson;
  let posId: string;
  let merchantId: string;
  const vendors: string[] = [];
  const items: Array<{ id: string; price: number }> = [];
  let categoryId: string;
  let catalogVersion = 0;
  let desk: PayTerminal; // caisse enrôlée par la route
  let desk2: PayTerminal; // seconde caisse du même point de vente
  let media: PayMedia[] = [];
  const sales: string[] = [];
  let server: { baseUrl: string; serverCaPem: string };
  /**
   * Requêtes lancées sur un client `pg` qui en exécute déjà une (le pilote le signale par un `DeprecationWarning`,
   * retiré dans pg@9 ; relevé ici à la source, car l'avertissement part du processus réel, hors du bac à sable de
   * Jest). Chaque vente le déclenchait avant la correction de `SqlConfigResolver.resolve`.
   */
  const overlaps: string[] = [];
  let querySpy: jest.SpyInstance;

  const admin = (who: TestPerson) => asPerson(server, who.token);
  const patch = (who: TestPerson, path: string, body: unknown): Promise<TerminalResponse> =>
    send(
      {
        url: new URL(`${server.baseUrl}${path}`),
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${who.token}`,
          'x-request-id': randomUUID(),
          'content-type': 'application/json',
          'idempotency-key': randomUUID(),
        },
        body: JSON.stringify(body),
        cert: null,
        key: null,
      },
      server.serverCaPem,
    );
  const call = (t: PayTerminal, method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown) =>
    t.t.request(pw.api.baseUrl, pw.api.tls.serverCaPem, {
      method,
      path,
      body,
      ...(method === 'GET' ? {} : { idempotencyKey: randomUUID() }),
    });

  /** Caisse enrôlée par la route : code émis pour le point de vente, puis `POST /device-enrollments`. */
  async function enrollDesk(): Promise<PayTerminal> {
    const res = await admin(pw.w.operatorAdminA).post('/device-enrollment-codes', {
      event_id: pw.w.ids.eventA,
      pos_id: posId,
      app_mode: 'CATALOG_POS',
      kind: 'POS',
      personal_phone: false,
    });
    expect(res.status).toBe(201);
    const t = new TestTerminal('ANDROID');
    const enrolled = await t.enrollByRoute(server, String(res.body.code));
    expect([enrolled.status, enrolled.text.slice(0, 200)]).toEqual([
      201,
      enrolled.text.slice(0, 200),
    ]);
    return { t, sessionId: null };
  }

  beforeAll(async () => {
    const inflight = new WeakMap<object, number>();
    const original = Client.prototype.query as (...args: unknown[]) => unknown;
    querySpy = jest.spyOn(Client.prototype, 'query').mockImplementation(function (
      this: Client,
      ...args: unknown[]
    ) {
      const running = inflight.get(this) ?? 0;
      if (running > 0)
        overlaps.push(typeof args[0] === 'string' ? args[0].slice(0, 80) : 'requête');
      inflight.set(this, running + 1);
      const done = () => inflight.set(this, (inflight.get(this) ?? 1) - 1);
      const result = original.apply(this, args);
      if (result && typeof (result as Promise<unknown>).then === 'function')
        (result as Promise<unknown>).then(done, done);
      else done();
      return result;
    } as never);
    pw = await PaymentWorld.create();
    qw = new QrWorld(pw);
    rw = new ReversalWorld(pw);
    server = { baseUrl: pw.api.baseUrl, serverCaPem: pw.api.tls.serverCaPem };
    const { w } = pw;
    // Amorçage : un commerçant et son point de vente (participation et compte ouverts), les personnes.
    await withOwner(async (db) => {
      const pos = await seedPos(db, {
        operatorId: w.ops.a,
        eventId: w.ids.eventA,
        name: 'Commerçant du parcours',
      });
      posId = pos.posId;
      merchantId = pos.merchantId;
      await asOperator(db, w.ops.a, () =>
        db.query('SELECT open_participation_account($1)', [pos.participationId]),
      );
      merchantAdmin = await w.idp.createPerson(db, {
        operatorId: w.ops.a,
        roles: [{ role: 'MERCHANT_ADMIN', scopeType: 'MERCHANT', scopeId: merchantId }],
      });
      supervisor = await w.idp.createPerson(db, {
        operatorId: w.ops.a,
        roles: [{ role: 'SUPERVISOR', scopeType: 'EVENT', scopeId: w.ids.eventA }],
      });
    });
    media = await pw.media(8, 30_000);
  }, 300_000);

  afterAll(async () => {
    querySpy?.mockRestore();
    await pw?.close();
  });

  it('1. le MERCHANT_ADMIN crée deux vendeurs (PIN jamais rendu)', async () => {
    for (const name of ['Awa', 'Moussa']) {
      const res = await admin(merchantAdmin).post(`/merchants/${merchantId}/vendors`, {
        display_name: name,
        pin: PIN,
      });
      expect([name, res.status]).toEqual([name, 201]);
      expect(contractViolations('Vendor', res.body)).toEqual([]);
      expect(res.text).not.toContain(PIN);
      vendors.push(String(res.body.vendor_id));
    }
    const list = await admin(merchantAdmin).get(`/merchants/${merchantId}/vendors`);
    expect(list.status).toBe(200);
    for (const id of vendors) expect(list.text).toContain(id);
  });

  it('2. l’ORGANIZER_ADMIN crée le catalogue : une catégorie, deux articles, une version par écriture', async () => {
    const organizer = admin(pw.w.organizerAdminA);
    const category = await organizer.post(`/points-of-sale/${posId}/catalog/categories`, {
      label_fr: 'Boissons',
      label_en: 'Drinks',
    });
    expect(category.status).toBe(201);
    categoryId = String((category.body.category as { category_id: string }).category_id);
    for (const [fr, en, price] of [
      ['Bière', 'Beer', 3000],
      ['Sandwich', 'Sandwich', 1500],
    ] as const) {
      const item = await organizer.post(`/catalog-categories/${categoryId}/items`, {
        label_fr: fr,
        label_en: en,
        unit_price: price,
        vat_rate_bps: 1800,
      });
      expect(item.status).toBe(201);
      items.push({ id: String((item.body.item as { item_id: string }).item_id), price });
      catalogVersion = Number(item.body.catalog_version);
    }
    expect(catalogVersion).toBeGreaterThanOrEqual(3);
  });

  it('3. une caisse CATALOG_POS s’enrôle par la route et lit sa configuration (version du catalogue)', async () => {
    desk = await enrollDesk();
    const config = await call(desk, 'GET', '/device/config');
    expect(config.status).toBe(200);
    expect(contractViolations('DeviceConfig', config.body)).toEqual([]);
    const catalog = config.body.catalog as {
      version: number;
      items: Array<{ product_id: string; unit_price: number }>;
    };
    expect(catalog.version).toBe(catalogVersion);
    expect(catalog.items.map((i) => i.product_id).sort()).toEqual(items.map((i) => i.id).sort());
    // Le catalogue servi est enregistré (ancien prix accepté plus tard, étape 11).
    const served = await ownerRows<{ version: number }>(
      'SELECT version FROM device_catalog_served WHERE device_id = $1',
      [desk.t.deviceId],
    );
    expect(served.map((s) => s.version)).toContain(catalogVersion);
    desk2 = await enrollDesk();
    expect((await call(desk2, 'GET', '/device/config')).status).toBe(200);
  });

  const lines = (sale: Array<[number, number]>) =>
    sale.map(([i, quantity]) => ({
      product_id: items[i]!.id,
      quantity,
      unit_price: items[i]!.price,
    }));
  const total = (sale: Array<[number, number]>) =>
    sale.reduce((sum, [i, q]) => sum + items[i]!.price * q, 0);
  const saleBody = (
    t: PayTerminal,
    means: Record<string, unknown>,
    sale: Array<[number, number]>,
  ) => ({
    amount: total(sale),
    currency: 'XOF',
    occurred_at: new Date().toISOString(),
    vendor_session_id: t.sessionId,
    lines: lines(sale),
    ...means,
  });

  it('4. ouverture de session par la route : liste des vendeurs du terminal, bon PIN → 201', async () => {
    const listed = await call(desk, 'GET', '/vendor-sessions/vendors');
    expect(listed.status).toBe(200);
    expect(listed.text).toContain(vendors[0]!);
    const opened = await call(desk, 'POST', '/vendor-sessions', {
      vendor_id: vendors[0],
      pin: PIN,
    });
    expect(opened.status).toBe(201);
    expect(contractViolations('VendorSession', opened.body)).toEqual([]);
    desk.sessionId = String(opened.body.vendor_session_id);
  });

  it('5. paiement par bracelet : un aller-retour, puis en deux temps (tap_id)', async () => {
    const one = await pw.pay(desk, saleBody(desk, { tap: pw.tap(media[0]!) }, [[0, 2]]));
    expect(one.status).toBe(201);
    expect(contractViolations('PaymentResult', one.body)).toEqual([]);
    sales.push(String(one.body.transaction_id));
    const tapId = await pw.readTap(desk, media[1]!);
    const two = await pw.pay(
      desk,
      saleBody(desk, { tap_id: tapId }, [
        [0, 1],
        [1, 2],
      ]),
    );
    expect(two.status).toBe(201);
    sales.push(String(two.body.transaction_id));
    expect(await pw.spendable(media[0]!.walletId)).toBe(30_000 - 6000);
    expect(await pw.spendable(media[1]!.walletId)).toBe(30_000 - 6000);
    // Lecture du paiement par le terminal.
    const read = await pw.get(desk, sales[0]!);
    expect(read.status).toBe(200);
  });

  it('6. QR commerçant : la caisse crée la demande, le festivalier la paie', async () => {
    const customer = await qw.customer(20_000);
    const created = await qw.create(desk, {
      amount: total([[1, 2]]),
      currency: 'XOF',
      vendor_session_id: desk.sessionId,
      lines: lines([[1, 2]]),
    });
    expect(created.status).toBe(201);
    const waiting = await qw.byTerminal(desk, 'GET', created.id);
    expect(waiting.body.status).toBe('PENDING');
    const paid = await qw.pay(customer, created.id, created.token);
    expect(paid.status).toBe(200);
    expect(contractViolations('PaymentResult', paid.body)).toEqual([]);
    sales.push(String(paid.body.transaction_id));
    expect((await qw.byTerminal(desk, 'GET', created.id)).body.status).toBe('CONFIRMED');
    expect(await pw.spendable(customer.walletId)).toBe(20_000 - 3000);
  });

  it('7. QR client : le festivalier crée son jeton, la caisse l’encaisse', async () => {
    const customer = await qw.customer(20_000);
    const made = await qw.asCustomer(customer, 'POST', '/me/customer-qr-tokens', {
      body: { wallet_id: customer.walletId },
    });
    expect(made.status).toBe(201);
    const res = await pw.pay(
      desk,
      saleBody(desk, { customer_qr_token: String(made.body.token) }, [[0, 1]]),
    );
    expect(res.status).toBe(201);
    sales.push(String(res.body.transaction_id));
    expect(await pw.spendable(customer.walletId)).toBe(20_000 - 3000);
  });

  it('8. annulation par le vendeur de la vente, dans la fenêtre : 201, le bracelet est recrédité', async () => {
    const before = await pw.spendable(media[0]!.walletId);
    const reversed = await rw.reverse(desk, sales[0]!);
    expect(reversed.status).toBe(201);
    expect(await pw.spendable(media[0]!.walletId)).toBe(before + 6000);
    expect(await rw.reversalsOf(sales[0]!)).toHaveLength(1);
    // Une seconde annulation est refusée.
    expect((await rw.reverse(desk, sales[0]!)).body.code).toBe('ALREADY_REVERSED');
  });

  it('9. annulation hors fenêtre : refusée au vendeur, acceptée avec le jeton d’un SUPERVISOR sur place', async () => {
    const sale = await pw.pay(desk, saleBody(desk, { tap: pw.tap(media[2]!) }, [[1, 2]]));
    expect(sale.status).toBe(201);
    const id = String(sale.body.transaction_id);
    sales.push(id);
    await rw.ageSale(id, 60);
    const vendor = await rw.reverse(desk, id);
    expect([vendor.status, vendor.body.code]).toEqual([409, 'REVERSAL_WINDOW_EXPIRED']);
    const { res } = await rw.reverseWithToken(desk, id, supervisor);
    expect(res.status).toBe(201);
    expect(await rw.reversalsOf(id)).toHaveLength(1);
    expect(await pw.spendable(media[2]!.walletId)).toBe(30_000);
  });

  it('10. SC-004 : 5 PIN faux bloquent le vendeur sur TOUS les terminaux ; un nouveau PIN le débloque', async () => {
    const victim = vendors[1]!;
    const open = (t: PayTerminal, pin: string) =>
      call(t, 'POST', '/vendor-sessions', { vendor_id: victim, pin });
    for (let i = 0; i < 5; i += 1) expect((await open(desk, WRONG_PIN)).status).toBe(401);
    // Bloqué : le bon PIN est refusé sur le second terminal, et le vendeur a quitté la liste.
    const blocked = await open(desk2, PIN);
    expect([blocked.status, blocked.body.code]).toEqual([401, 'VENDOR_PIN_INVALID']);
    expect((await call(desk2, 'GET', '/vendor-sessions/vendors')).text).not.toContain(victim);
    const state = await admin(merchantAdmin).get(`/vendors/${victim}`);
    expect(state.body.locked).toBe(true);
    // Un nouveau PIN (merchant admin) débloque.
    expect(
      (await admin(merchantAdmin).post(`/vendors/${victim}/pin`, { pin: NEW_PIN })).status,
    ).toBe(200);
    expect((await open(desk2, PIN)).status).toBe(401);
    const unlocked = await open(desk2, NEW_PIN);
    expect(unlocked.status).toBe(201);
    desk2.sessionId = String(unlocked.body.vendor_session_id);
    expect((await call(desk, 'GET', '/vendor-sessions/vendors')).text).toContain(victim);
  });

  it('11. changement de prix pendant que la caisse a l’ancienne configuration : l’ancien prix est accepté', async () => {
    const old = items[0]!.price;
    const updated = await patch(pw.w.organizerAdminA, `/catalog-items/${items[0]!.id}`, {
      unit_price: old + 500,
    });
    expect(updated.status).toBe(200);
    expect(Number(updated.body.catalog_version)).toBeGreaterThan(catalogVersion);
    // La caisse n'a pas relu sa configuration : elle vend à l'ancien prix (version servie).
    const res = await pw.pay(desk, saleBody(desk, { tap: pw.tap(media[3]!) }, [[0, 1]]));
    expect(res.status).toBe(201);
    sales.push(String(res.body.transaction_id));
    // La caisse relit sa configuration : la nouvelle version est servie, l'ancien prix n'est plus accepté.
    const reread = await call(desk, 'GET', '/device/config');
    expect(reread.status).toBe(200);
    const stale = await pw.pay(desk, saleBody(desk, { tap: pw.tap(media[4]!) }, [[0, 1]]));
    expect([stale.status, stale.body.code]).toEqual([422, 'SALE_LINES_INVALID']);
    expect(await pw.spendable(media[4]!.walletId)).toBe(30_000);
    items[0]!.price = old + 500;
    const fresh = await pw.pay(desk, saleBody(desk, { tap: pw.tap(media[4]!) }, [[0, 1]]));
    expect(fresh.status).toBe(201);
    sales.push(String(fresh.body.transaction_id));
  });

  it('12. contrôles finaux : ventes attribuées, lignes = montant, aucune vente sans lignes, aucun passage perdu', async () => {
    // Un paiement refusé (fonds insuffisants) ne consomme aucun passage (NFR-006).
    const poor = (await pw.media(1, 100)) as [PayMedia];
    const tapId = await pw.readTap(desk, poor[0]);
    const refused = await pw.pay(desk, saleBody(desk, { tap_id: tapId }, [[0, 1]]));
    expect(refused.status).toBe(422);
    const consumed = await ownerRows<{ transaction_id: string | null }>(
      'SELECT transaction_id FROM media_tap WHERE id = $1',
      [tapId],
    );
    expect(consumed[0]!.transaction_id).toBeNull();

    const device = desk.t.deviceId;
    // 100 % des ventes attribuées à un vendeur de session.
    const unattributed = await ownerRows<{ id: string }>(
      `SELECT t.id FROM journal_transaction t
        WHERE t.device_id = ANY($1) AND t.type = 'PURCHASE'
          AND NOT EXISTS (SELECT 1 FROM sale_attribution a WHERE a.transaction_id = t.id AND a.vendor_id IS NOT NULL)`,
      [[device, desk2.t.deviceId]],
    );
    expect(unattributed).toEqual([]);
    const byVendor = await ownerRows<{ vendor_id: string }>(
      `SELECT DISTINCT a.vendor_id FROM sale_attribution a WHERE a.device_id = $1`,
      [device],
    );
    expect(byVendor.map((r) => r.vendor_id)).toEqual([vendors[0]]);
    // Σ lignes = montant pour chaque vente au catalogue (SC-002).
    const mismatched = await ownerRows<{ id: string }>(
      `SELECT t.id FROM journal_transaction t
         JOIN LATERAL (SELECT sum(line_total) AS s FROM sale_line l WHERE l.transaction_id = t.id) l ON true
         JOIN LATERAL (SELECT sum(p.amount) AS amount FROM posting p JOIN account c ON c.id = p.account_id
                        WHERE p.transaction_id = t.id AND c.purpose IN ('WALLET_PAID', 'WALLET_PROMO')
                          AND p.amount > 0) d ON true
        WHERE t.device_id = $1 AND t.type = 'PURCHASE' AND l.s IS DISTINCT FROM d.amount`,
      [device],
    );
    expect(mismatched).toEqual([]);
    // Aucune vente sans lignes (caisse catalogue), aucune ligne sans vente.
    const withoutLines = await ownerRows<{ id: string }>(
      `SELECT t.id FROM journal_transaction t
        WHERE t.device_id = $1 AND t.type = 'PURCHASE'
          AND NOT EXISTS (SELECT 1 FROM sale_line l WHERE l.transaction_id = t.id)`,
      [device],
    );
    expect(withoutLines).toEqual([]);
    const orphanLines = await ownerRows<{ n: number }>(
      `SELECT count(*)::int AS n FROM sale_line l
        WHERE NOT EXISTS (SELECT 1 FROM journal_transaction t WHERE t.id = l.transaction_id)`,
    );
    expect(orphanLines[0]!.n).toBe(0);
    // Aucun passage consommé par un paiement refusé : chaque passage consommé pointe vers une vente.
    const danglingTaps = await ownerRows<{ n: number }>(
      `SELECT count(*)::int AS n FROM media_tap m WHERE m.device_id = $1 AND m.transaction_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM journal_transaction t WHERE t.id = m.transaction_id)`,
      [device],
    );
    expect(danglingTaps[0]!.n).toBe(0);
    // Le grand livre reste équilibré et aucun avertissement du pilote n'a été levé pendant les ventes.
    expect(overlaps).toEqual([]);
    expect(sales.length).toBeGreaterThanOrEqual(7);
  });
});
