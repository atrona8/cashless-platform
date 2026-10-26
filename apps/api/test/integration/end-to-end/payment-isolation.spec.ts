// Isolation des routes et des tables de la mission 5b (mission 5b, lot WP14, T067 ; NFR-007, SC-007 ; modèle :
// device-isolation.spec.ts). Deux prestataires A et B (B : son événement, son commerçant, son terminal enrôlé et sa
// session ouverte par la route, son vendeur, ses personnes, son festivalier) et deux commerçants du même prestataire A.
//   1. Garde du contrat : les opérations de la mission sont LUES dans `openapi.yaml` (tags Vendeurs, Catalogue,
//      Paiements, Demandes de paiement QR, plus `createCustomerQrToken`) ; chacune a un cas ici, aucun cas n'est
//      orphelin. Une route ajoutée plus tard sans cas fait échouer ce test.
//   2. Chaque cas : B (personne, terminal ou festivalier) sur un objet de A → jamais 2xx, jamais 5xx, aucun
//      identifiant ni jeton de A dans la réponse, et rien ne change chez A (comparaison avant/après).
//   3. Listes de B : sans objet de A. Commerçant 1 de A : ni vendeurs, ni sessions, ni ventes du commerçant 2.
//   4. Chaque nouvelle table, sous `cashless_app` avec le prestataire B posé : 0 ligne de A lisible, et seulement
//      les lignes de B (contrôle : A en a bien, lues par le propriétaire).
//
// Écritures directes en base : amorçage seulement (prestataire B, commerçants, personnes, festivaliers).
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { APP_URL, connect, withOwner } from '../../support/db';
import { createCustomerWallet, createTestCustomer } from '../../support/fake-customer';
import type { TestPerson } from '../../support/fake-idp';
import { goLive, ownerRows, tapBody } from '../../support/media-fixtures';
import { send, TestTerminal } from '../../support/test-terminal';
import { QrWorld } from '../payment-requests/qr-fixtures';
import { PIN, PaymentWorld, type PayMedia, type PayTerminal } from '../payments/payments-fixtures';
import { ReversalWorld } from '../reversals/reversal-fixtures';
import { asOperator, seedPos, seedVendor } from '../vendors/vendor-fixtures';

jest.setTimeout(300_000);

const CONTRACT = join(__dirname, '../../../../../packages/contracts/openapi.yaml');
const MISSION_TAGS = ['Vendeurs', 'Catalogue', 'Paiements', 'Demandes de paiement QR'];
const EXTRA_OPERATIONS = ['createCustomerQrToken'];
/** Statuts de refus admis par défaut : jamais un 2xx, jamais un 5xx. */
const DENIED = [401, 403, 404, 409, 422];

/** Opérations de la mission, lues dans le contrat. */
function missionOperations(): string[] {
  const contract = parse(readFileSync(CONTRACT, 'utf8')) as {
    paths: Record<string, Record<string, { operationId?: string; tags?: string[] }>>;
  };
  const ids: string[] = [];
  for (const operations of Object.values(contract.paths))
    for (const operation of Object.values(operations)) {
      if (typeof operation !== 'object' || !operation?.operationId) continue;
      if (
        EXTRA_OPERATIONS.includes(operation.operationId) ||
        (operation.tags ?? []).some((tag) => MISSION_TAGS.includes(tag))
      )
        ids.push(operation.operationId);
    }
  return ids.sort();
}

interface Reply {
  status: number;
  text: string;
  body: Record<string, unknown>;
}
interface Attack {
  /** Qui appelle (libellé du rapport). */
  who: string;
  call: () => Promise<Reply>;
  /** Statuts admis ; défaut `DENIED`. */
  expect?: number[];
}

describe('NFR-007, SC-007 : isolation des routes et des tables de la mission 5b (WP14)', () => {
  let pw: PaymentWorld;
  let qw: QrWorld;
  let rw: ReversalWorld;
  const opB = () => pw.w.ops.b;
  const opA = () => pw.w.ops.a;

  // Prestataire A.
  let termA: PayTerminal;
  let merchantAdminA: TestPerson; // MERCHANT_ADMIN du commerçant 1 de A
  let mediaA: PayMedia;
  let saleA: string;
  let requestA: { id: string; token: string };
  let categoryA: string;
  let customerQrA: string; // portefeuille de A
  let merchant2: Awaited<ReturnType<PaymentWorld['newPos']>>;
  let term2: PayTerminal; // terminal du commerçant 2 de A
  let sale2: string;
  // Prestataire B.
  let termB: PayTerminal;
  let operatorAdminB: TestPerson;
  let organizerAdminB: TestPerson;
  let merchantAdminB: TestPerson;
  let customerB: Awaited<ReturnType<QrWorld['customer']>>;

  const person = (token: string) => ({
    call: (method: string, path: string, body?: unknown): Promise<Reply> =>
      send(
        {
          url: new URL(`${pw.api.baseUrl}${path}`),
          method,
          headers: {
            authorization: `Bearer ${token}`,
            'x-request-id': randomUUID(),
            ...(method === 'GET' || method === 'DELETE'
              ? {}
              : { 'content-type': 'application/json', 'idempotency-key': randomUUID() }),
          },
          body: method === 'GET' || method === 'DELETE' ? '' : JSON.stringify(body ?? {}),
          cert: null,
          key: null,
        },
        pw.api.tls.serverCaPem,
      ) as Promise<Reply>,
  });
  /** Chemin d'un appel de personne : sans le préfixe `/v1` (ajouté par `person`). */
  const persons = (): Array<[string, string]> => [
    ['OPERATOR_ADMIN de B', operatorAdminB.token],
    ['ORGANIZER_ADMIN de B', organizerAdminB.token],
    ['MERCHANT_ADMIN de B', merchantAdminB.token],
  ];
  const asPersons = (method: string, path: string, body?: unknown): Attack[] =>
    persons().map(([who, token]) => ({ who, call: () => person(token).call(method, path, body) }));

  /** Identifiants et valeurs de A qui ne doivent apparaître dans aucune réponse faite à B. */
  const secretsOfA = (): string[] => [
    pw.vendorId,
    pw.pos.posId,
    pw.pos.merchantId,
    pw.pos.participationId,
    termA.sessionId!,
    termA.t.deviceId,
    termA.t.serial,
    categoryA,
    ...pw.items.map((i) => i.id),
    saleA,
    requestA.id,
    requestA.token,
    mediaA.walletId,
    pw.vendorName,
  ];
  const leaks = (text: string) =>
    secretsOfA().filter((secret) => {
      if (!secret) throw new Error('secret de A non initialisé');
      return text.includes(secret);
    });

  // ------------------------------------------------------------------------------ cas, un par opération

  const cases = (): Record<string, () => Attack[]> => ({
    // ----- Vendeurs -----
    listVendors: () => asPersons('GET', `/merchants/${pw.pos.merchantId}/vendors`),
    createVendor: () =>
      asPersons('POST', `/merchants/${pw.pos.merchantId}/vendors`, {
        display_name: 'Intrus',
        pin: '246802',
      }),
    getVendor: () => asPersons('GET', `/vendors/${pw.vendorId}`),
    setVendorPin: () => asPersons('POST', `/vendors/${pw.vendorId}/pin`, { pin: '246802' }),
    setVendorStatus: () =>
      asPersons('POST', `/vendors/${pw.vendorId}/status`, { status: 'DISABLED' }),
    listTerminalVendors: () => [
      {
        who: 'terminal de B',
        // Liste de SON commerçant : 200 admis, sans aucun vendeur de A (contrôle des fuites).
        expect: [200],
        call: () =>
          termB.t.request(pw.api.baseUrl, pw.api.tls.serverCaPem, {
            method: 'GET',
            path: '/vendor-sessions/vendors',
          }) as Promise<Reply>,
      },
    ],
    openVendorSession: () => [
      {
        who: 'terminal de B, vendeur de A, bon PIN',
        call: () =>
          termB.t.request(pw.api.baseUrl, pw.api.tls.serverCaPem, {
            method: 'POST',
            path: '/vendor-sessions',
            body: { vendor_id: pw.vendorId, pin: PIN },
            idempotencyKey: randomUUID(),
          }) as Promise<Reply>,
      },
    ],
    closeVendorSession: () => [
      {
        who: 'terminal de B (ferme SA session seulement)',
        // La route n'adresse aucun objet : elle ferme la session du terminal appelant. La session de A reste ouverte
        // (comparaison avant/après) ; B doit rouvrir la sienne ensuite (fait en fin de test).
        expect: [200, 204],
        call: () =>
          termB.t.request(pw.api.baseUrl, pw.api.tls.serverCaPem, {
            method: 'DELETE',
            path: '/vendor-sessions/current',
            idempotencyKey: randomUUID(),
          }) as Promise<Reply>,
      },
    ],
    // ----- Catalogue -----
    getCatalog: () => asPersons('GET', `/points-of-sale/${pw.pos.posId}/catalog`),
    createCatalogCategory: () =>
      asPersons('POST', `/points-of-sale/${pw.pos.posId}/catalog/categories`, {
        label_fr: 'Intrus',
        label_en: 'Intruder',
      }),
    updateCatalogCategory: () =>
      asPersons('PATCH', `/catalog-categories/${categoryA}`, { label_fr: 'Intrus' }),
    createCatalogItem: () =>
      asPersons('POST', `/catalog-categories/${categoryA}/items`, {
        label_fr: 'Intrus',
        label_en: 'Intruder',
        unit_price: 1,
        vat_rate_bps: 1800,
      }),
    updateCatalogItem: () =>
      asPersons('PATCH', `/catalog-items/${pw.items[0]!.id}`, { unit_price: 1 }),
    getCatalogVersion: () => asPersons('GET', `/points-of-sale/${pw.pos.posId}/catalog/versions/1`),
    setCatalogPolicy: () =>
      asPersons('PUT', `/points-of-sale/${pw.pos.posId}/catalog-policy`, {
        merchant_manages: true,
      }),
    // ----- Paiements -----
    createPayment: () => [
      {
        who: 'terminal de B, bracelet et session de A',
        call: () =>
          pw.pay(termB, {
            amount: 1000,
            currency: 'XOF',
            occurred_at: new Date().toISOString(),
            vendor_session_id: termA.sessionId,
            tap: tapBody(mediaA.media, ++mediaA.counter),
          }) as Promise<Reply>,
      },
      {
        who: 'terminal de B, bracelet de A, session de B',
        call: () =>
          pw.pay(termB, {
            amount: 1000,
            currency: 'XOF',
            occurred_at: new Date().toISOString(),
            vendor_session_id: termB.sessionId,
            tap: tapBody(mediaA.media, ++mediaA.counter),
          }) as Promise<Reply>,
      },
    ],
    getPayment: () => [
      { who: 'terminal de B', call: () => pw.get(termB, saleA) as Promise<Reply> },
      ...asPersons('GET', `/payments/${saleA}`),
    ],
    reversePayment: () => [
      { who: 'terminal de B', call: () => rw.reverse(termB, saleA) as Promise<Reply> },
      ...asPersons('POST', `/payments/${saleA}/reversal`, { reason: 'INPUT_ERROR' }),
    ],
    // ----- Demandes de paiement QR -----
    createPaymentRequest: () => [
      {
        who: 'terminal de B, session de A',
        call: () =>
          qw
            .create(termB, { amount: 1000, currency: 'XOF', vendor_session_id: termA.sessionId })
            .then((r) => ({ status: r.status, body: r.body, text: JSON.stringify(r.body) })),
      },
    ],
    getPaymentRequest: () => [
      {
        who: 'terminal de B',
        call: () => qw.byTerminal(termB, 'GET', requestA.id) as Promise<Reply>,
      },
      {
        who: 'festivalier de B, jeton valide de A',
        call: () =>
          qw.asCustomer(customerB, 'GET', `/payment-requests/${requestA.id}`, {
            headers: { 'x-payment-request-token': requestA.token },
          }) as Promise<Reply>,
      },
    ],
    payPaymentRequest: () => [
      {
        who: 'festivalier de B, jeton valide de A, son portefeuille',
        call: () => qw.pay(customerB, requestA.id, requestA.token) as Promise<Reply>,
      },
    ],
    cancelPaymentRequest: () => [
      {
        who: 'terminal de B',
        call: () => qw.byTerminal(termB, 'POST', requestA.id, '/cancel') as Promise<Reply>,
      },
      {
        who: 'festivalier de B, jeton valide de A',
        call: () =>
          qw.asCustomer(customerB, 'POST', `/payment-requests/${requestA.id}/cancel`, {
            body: {},
            headers: { 'x-payment-request-token': requestA.token },
          }) as Promise<Reply>,
      },
    ],
    createCustomerQrToken: () => [
      {
        who: 'festivalier de B, portefeuille de A',
        call: () =>
          qw.asCustomer(customerB, 'POST', '/me/customer-qr-tokens', {
            body: { wallet_id: customerQrA },
          }) as Promise<Reply>,
      },
    ],
  });

  /** État des données de A (et de son commerçant 2) touchées par les opérations de la mission. */
  const snapshot = () =>
    ownerRows<Record<string, unknown>>(
      `SELECT
         (SELECT string_agg(id || ':' || status || ':' || failed_attempts || ':'
                            || coalesce(locked_at::text, '-') || ':' || md5(pin_hash), '|' ORDER BY id)
            FROM vendor WHERE operator_id = $1) AS vendors,
         (SELECT string_agg(id || ':' || coalesce(closed_at::text, 'ouverte'), '|' ORDER BY id)
            FROM vendor_session WHERE operator_id = $1) AS sessions,
         (SELECT count(*)::int FROM vendor_pin_check WHERE operator_id = $1) AS pin_checks,
         (SELECT count(*)::int FROM catalog_category WHERE operator_id = $1) AS categories,
         (SELECT string_agg(id || ':' || unit_price || ':' || active, '|' ORDER BY id)
            FROM catalog_item WHERE operator_id = $1) AS items,
         (SELECT string_agg(pos_id || ':' || version, '|' ORDER BY pos_id, version)
            FROM catalog_version WHERE operator_id = $1) AS versions,
         (SELECT string_agg(pos_id || ':' || merchant_manages, '|' ORDER BY pos_id)
            FROM point_of_sale_catalog_policy WHERE operator_id = $1) AS policies,
         (SELECT count(*)::int FROM journal_transaction t JOIN ledger l ON l.id = t.ledger_id
           WHERE l.operator_id = $1) AS transactions,
         (SELECT count(*)::int FROM sale_attribution WHERE operator_id = $1) AS attributions,
         (SELECT count(*)::int FROM sale_line WHERE operator_id = $1) AS lines,
         (SELECT string_agg(id || ':' || status || ':' || coalesce(wallet_id::text, '-'), '|' ORDER BY id)
            FROM payment_request WHERE operator_id = $1) AS requests,
         (SELECT count(*)::int FROM payment_request_detail WHERE operator_id = $1) AS request_details,
         (SELECT count(*)::int FROM device_seq_registry r JOIN device d ON d.id = r.device_id
           WHERE d.operator_id = $1) AS registry,
         (SELECT count(*)::int FROM audit_log WHERE operator_id = $1) AS audit`,
      [opA()],
    ).then((rows) => rows[0]!);

  beforeAll(async () => {
    pw = await PaymentWorld.create();
    qw = new QrWorld(pw);
    rw = new ReversalWorld(pw);
    const { w } = pw;

    // ----- Prestataire A : un terminal, une vente, une demande QR en attente, son commerçant 2 -----
    termA = await pw.terminal({ mode: 'CATALOG_POS' });
    [mediaA] = (await pw.media(1)) as [PayMedia];
    const sold = await pw.pay(termA, pw.catalogBody(termA, { tap: pw.tap(mediaA) }));
    expect(sold.status).toBe(201);
    saleA = String(sold.body.transaction_id);
    const keypadA = await pw.terminal({ mode: 'KEYPAD_TPE' });
    const created = await qw.create(keypadA, qw.keypad(keypadA, 2500));
    expect(created.status).toBe(201);
    requestA = { id: created.id, token: created.token };
    const walletA = await qw.customer(20_000);
    customerQrA = walletA.walletId;
    categoryA = (
      await ownerRows<{ id: string }>('SELECT id FROM catalog_category WHERE pos_id = $1', [
        pw.pos.posId,
      ])
    )[0]!.id;
    // Une politique de catalogue et un catalogue servi : lignes des tables à contrôler.
    await withOwner((db) =>
      asOperator(db, opA(), () =>
        db.query('SELECT * FROM record_device_catalog_served($1)', [termA.t.deviceId]),
      ),
    );
    await withOwner((db) =>
      asOperator(db, opA(), () =>
        db.query('SELECT * FROM set_catalog_policy($1, true, $2)', [
          pw.pos.posId,
          w.operatorAdminA.userId,
        ]),
      ),
    );
    merchant2 = await pw.newPos([['Jus', 'Juice', 1000]]);
    term2 = await pw.terminal({
      mode: 'CATALOG_POS',
      posId: merchant2.pos.posId,
      vendorId: merchant2.vendorId,
    });
    const [media2] = (await pw.media(1)) as [PayMedia];
    const sold2 = await pw.pay(term2, pw.catalogBody(term2, { tap: pw.tap(media2) }, [[0, 1]]));
    sale2 = String(sold2.body.transaction_id ?? '');
    merchantAdminA = await withOwner((db) =>
      w.idp.createPerson(db, {
        operatorId: opA(),
        roles: [{ role: 'MERCHANT_ADMIN', scopeType: 'MERCHANT', scopeId: pw.pos.merchantId }],
      }),
    );

    // ----- Prestataire B -----
    const ledgerB = await withOwner(async (db) => {
      const eventB = randomUUID();
      const profile = randomUUID();
      await db.query(
        `INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
         VALUES ($1, 'SN', (1000000 + floor(random() * 1000000000))::int, '2026-01-01', 'ORGANIZER')`,
        [profile],
      );
      await db.query(
        `INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id,
                            funds_holder)
         VALUES ($1, $2, $3, 'Événement B', 'XOF', 'Africa/Dakar', $4, 'ORGANIZER')`,
        [eventB, opB(), w.ids.organizerB, profile],
      );
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [opB()]);
      const ledger = (
        await db.query<{ ledger: string }>('SELECT open_event_ledger($1) AS ledger', [eventB])
      ).rows[0]!.ledger;
      operatorAdminB = await w.idp.createPerson(db, {
        operatorId: opB(),
        roles: [{ role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: opB() }],
      });
      organizerAdminB = await w.idp.createPerson(db, {
        operatorId: opB(),
        roles: [{ role: 'ORGANIZER_ADMIN', scopeType: 'ORGANIZER', scopeId: w.ids.organizerB }],
      });
      await goLive(db, opB(), eventB, operatorAdminB.userId);
      const posB = await seedPos(db, { operatorId: opB(), eventId: eventB, name: 'Comptoir de B' });
      await asOperator(db, opB(), () =>
        db.query('SELECT open_participation_account($1)', [posB.participationId]),
      );
      merchantAdminB = await w.idp.createPerson(db, {
        operatorId: opB(),
        roles: [{ role: 'MERCHANT_ADMIN', scopeType: 'MERCHANT', scopeId: posB.merchantId }],
      });
      const vendorB = await seedVendor(db, {
        operatorId: opB(),
        merchantId: posB.merchantId,
        actorId: operatorAdminB.userId,
        displayName: 'Vendeur de B',
        pinHash: await pw.hasher.hash(PIN),
      });
      const t = await new TestTerminal('ANDROID').enroll(db, {
        operatorId: opB(),
        eventId: eventB,
        posId: posB.posId,
        mode: 'KEYPAD_TPE',
        ca: pw.ca,
      });
      termB = { t, sessionId: null };
      (termB as PayTerminal & { vendorB: string }).vendorB = vendorB;
      return ledger;
    });
    await termB.t.issueToken(pw.tokens);
    await pw.openSession(termB, (termB as PayTerminal & { vendorB: string }).vendorB);
    customerB = await withOwner(async (db) => {
      const customer = await createTestCustomer(db, opB());
      const { walletId } = await createCustomerWallet(db, {
        operatorId: opB(),
        ledgerId: ledgerB,
        customerId: customer.customerId,
        funds: 20_000,
      });
      return { customer, walletId };
    });
  }, 300_000);

  afterAll(async () => {
    await pw?.close();
  });

  it('le contrat déclare les opérations de la mission, chacune a un cas, aucun cas n’est orphelin', () => {
    const declared = missionOperations();
    expect(declared.length).toBeGreaterThanOrEqual(23);
    const covered = Object.keys(cases()).sort();
    expect(declared.filter((id) => !covered.includes(id))).toEqual([]);
    expect(covered.filter((id) => !declared.includes(id))).toEqual([]);
  });

  it('B (personne, terminal, festivalier) sur un objet de A : jamais 2xx, sans fuite, rien ne change', async () => {
    const before = await snapshot();
    const problems: string[] = [];
    let calls = 0;
    // `closeVendorSession` en dernier : il ferme la session de B (rouverte ensuite).
    const order = Object.keys(cases()).sort((a, b) =>
      a === 'closeVendorSession' ? 1 : b === 'closeVendorSession' ? -1 : a.localeCompare(b),
    );
    for (const operationId of order) {
      for (const attack of cases()[operationId]!()) {
        calls += 1;
        const res = await attack.call();
        const label = `${operationId} par ${attack.who}`;
        const admitted = attack.expect ?? DENIED;
        if (!admitted.includes(res.status))
          problems.push(`${label} : ${res.status} (attendu ${admitted.join(' ou ')}) ${res.text}`);
        const leaked = leaks(res.text);
        if (leaked.length > 0) problems.push(`${label} : donnée de A (${leaked.join(', ')})`);
      }
    }
    expect(problems).toEqual([]);
    expect(calls).toBeGreaterThanOrEqual(Object.keys(cases()).length);
    expect(await snapshot()).toEqual(before);
    // B rouvre sa session pour la suite.
    await pw.openSession(termB, (termB as PayTerminal & { vendorB: string }).vendorB);
  });

  it('les listes de B ne montrent aucun objet de A', async () => {
    const lists: Array<[string, Reply]> = [
      [
        'vendeurs du commerçant de B',
        await person(merchantAdminB.token).call(
          'GET',
          `/merchants/${await merchantOf(merchantAdminB)}/vendors`,
        ),
      ],
      [
        'vendeurs du terminal de B',
        (await termB.t.request(pw.api.baseUrl, pw.api.tls.serverCaPem, {
          method: 'GET',
          path: '/vendor-sessions/vendors',
        })) as Reply,
      ],
    ];
    for (const [name, res] of lists) {
      expect([name, res.status]).toEqual([name, 200]);
      expect([name, leaks(res.text)]).toEqual([name, []]);
    }
  });

  it('commerçant 1 de A : ni les vendeurs, ni les sessions, ni les ventes du commerçant 2', async () => {
    const own = person(merchantAdminA.token);
    const listed = await own.call('GET', `/merchants/${pw.pos.merchantId}/vendors`);
    expect(listed.status).toBe(200);
    expect(listed.text).toContain(pw.vendorId);
    expect(listed.text).not.toContain(merchant2.vendorId);
    for (const res of [
      await own.call('GET', `/merchants/${merchant2.pos.merchantId}/vendors`),
      await own.call('GET', `/vendors/${merchant2.vendorId}`),
      await own.call('POST', `/vendors/${merchant2.vendorId}/pin`, { pin: '246802' }),
      await own.call('POST', `/vendors/${merchant2.vendorId}/status`, { status: 'DISABLED' }),
      await own.call('GET', `/points-of-sale/${merchant2.pos.posId}/catalog`),
      await own.call('PATCH', `/catalog-items/${merchant2.items[0]!.id}`, { unit_price: 1 }),
    ]) {
      expect([403, 404]).toContain(res.status);
      expect(res.text).not.toContain(merchant2.vendorId);
    }
    // Terminal du commerçant 1 : la liste de ses vendeurs ne montre pas ceux du commerçant 2.
    const terminalList = await termA.t.request(pw.api.baseUrl, pw.api.tls.serverCaPem, {
      method: 'GET',
      path: '/vendor-sessions/vendors',
    });
    expect(terminalList.status).toBe(200);
    expect(terminalList.text).not.toContain(merchant2.vendorId);
    // Il ne rouvre pas une session sur un vendeur du commerçant 2 et ne lit pas sa vente.
    const open = await termA.t.request(pw.api.baseUrl, pw.api.tls.serverCaPem, {
      method: 'POST',
      path: '/vendor-sessions',
      body: { vendor_id: merchant2.vendorId, pin: PIN },
      idempotencyKey: randomUUID(),
    });
    expect(open.status).toBe(401);
    if (sale2) expect((await pw.get(termA, sale2)).status).toBe(404);
    // Il ne paie pas avec la session d'un autre commerçant.
    const [m] = (await pw.media(1)) as [PayMedia];
    const other = await pw.pay(
      termA,
      pw.catalogBody(termA, { tap: pw.tap(m) }, [[0, 1]], { vendor_session_id: term2.sessionId }),
    );
    expect([409, 422, 404]).toContain(other.status);
  });

  it('chaque nouvelle table, sous cashless_app avec le prestataire B posé : 0 ligne de A lisible', async () => {
    const tables = [
      'vendor',
      'vendor_pin_check',
      'vendor_session',
      'point_of_sale_catalog_policy',
      'catalog_category',
      'catalog_item',
      'catalog_version',
      'catalog_version_item',
      'device_catalog_served',
      'sale_line',
      'sale_attribution',
      'payment_request',
      'payment_request_detail',
    ];
    const controls: string[] = [];
    const visible: string[] = [];
    const client = await connect(APP_URL);
    try {
      for (const table of tables) {
        const owned = await ownerRows<{ n: number }>(
          `SELECT count(*)::int AS n FROM ${table} WHERE operator_id = $1`,
          [opA()],
        );
        // Contrôle du balayage : A a bien des lignes dans la table (sauf `vendor_pin_check`, éphémère).
        if (owned[0]!.n === 0 && table !== 'vendor_pin_check') controls.push(table);
        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.operator_id', $1, true)`, [opB()]);
        const { rows } = await client.query<{ a: number; other: number }>(
          `SELECT count(*) FILTER (WHERE operator_id = $1)::int AS a,
                  count(*) FILTER (WHERE operator_id <> $2)::int AS other FROM ${table}`,
          [opA(), opB()],
        );
        await client.query('ROLLBACK');
        if (rows[0]!.a !== 0 || rows[0]!.other !== 0)
          visible.push(`${table} : ${rows[0]!.a} ligne(s) de A, ${rows[0]!.other} d'un autre`);
      }
    } finally {
      await client.end();
    }
    expect(controls).toEqual([]);
    expect(visible).toEqual([]);
  });

  /** Commerçant d'une personne MERCHANT_ADMIN de test. */
  async function merchantOf(who: TestPerson): Promise<string> {
    const rows = await ownerRows<{ scope_id: string }>(
      `SELECT scope_id FROM role_assignment WHERE user_id = $1 AND scope_type = 'MERCHANT'`,
      [who.userId],
    );
    return rows[0]!.scope_id;
  }
});
