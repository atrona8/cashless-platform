// Aucun secret des paiements en clair (mission 5b, lot WP14, T068 ; NFR-002, NFR-008, SC-003 ; modèle :
// device-secrets.spec.ts, A26). Après un parcours qui touche tout ce qui porte un secret (création de vendeurs et
// changement de PIN par le back-office, ouvertures de session réussies et refusées, QR commerçant payé, QR client
// encaissé, paiements, annulation, configuration servie), chaque PIN de test, chaque jeton de QR commerçant et de
// QR client et la valeur de `VENDOR_PIN_SECRET` (et de `VENDOR_PIN_IDEMPOTENCY_SECRET`) sont recherchés sous
// toutes leurs formes (texte, octets en hexadécimal comme les montre `bytea`) dans TOUTES les tables (dont
// `api_idempotency`, `audit_log`, `device_seq_registry`), dans tout ce qui part au journal (`Logger` de Nest,
// `console`, sorties standard) et dans toutes les réponses, y compris d'erreur : 0.
// Le préfixe `$argon2id$` n'existe qu'en `vendor.pin_hash` : jamais dans une réponse, un journal, l'audit, une
// autre colonne ni la configuration servie.
//
// Les PIN (6 chiffres exactement) sont tirés au hasard et propres à la suite ; pour qu'un PIN n'ait aucune chance
// de coïncider avec un chiffre d'une autre ligne (microsecondes d'une date, numéro), le tirage écarte tout PIN
// déjà lisible dans la base avant le parcours, et la recherche d'un PIN exige qu'il ne soit ni précédé ni suivi
// d'un chiffre ni précédé d'un point. Écritures directes en base : amorçage seulement (jeu d'essai commun).
import 'reflect-metadata';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { loadConfig } from '../../../src/config/config';
import { asPerson } from '../../support/device-e2e';
import { withOwner } from '../../support/db';
import { ownerRows } from '../../support/media-fixtures';
import { QrWorld, type QrCustomer } from '../payment-requests/qr-fixtures';
import { PaymentWorld, type PayMedia, type PayTerminal } from '../payments/payments-fixtures';
import { ReversalWorld } from '../reversals/reversal-fixtures';
import type { TerminalResponse } from '../../support/test-terminal';

jest.setTimeout(300_000);

const LOGGER_METHODS = ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const;
const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const;
const hex = (text: string) => Buffer.from(text, 'utf8').toString('hex');

interface Secret {
  label: string;
  /** Formes littérales cherchées (sous-chaîne). */
  forms: string[];
  /** PIN : recherche par expression régulière (voir l'en-tête), à la place des formes littérales. */
  pin?: string;
}

describe('NFR-002, NFR-008, SC-003 : aucun PIN, jeton ni secret en clair après le parcours', () => {
  let pw: PaymentWorld;
  let qw: QrWorld;
  let rw: ReversalWorld;
  const secrets: Secret[] = [];
  const responses: Array<{ step: string; res: { status: number; text: string } }> = [];
  const journal: string[] = [];
  const myVendors: string[] = [];

  const note = <T extends { status: number; text: string }>(step: string, res: T): T => {
    responses.push({ step, res });
    return res;
  };
  const pinSecret = (label: string, pin: string) => secrets.push({ label, forms: [hex(pin)], pin });
  const tokenSecret = (label: string, token: string) =>
    secrets.push({ label, forms: [token, hex(token)] });

  /** PIN de 6 chiffres, aléatoire, absent de la base au moment du tirage. */
  async function freshPin(): Promise<string> {
    for (;;) {
      const pin = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const hits = await ownerRows<{ n: number }>(pinCountSql(), [pin, pin]);
      if (hits[0]!.n === 0) return pin;
    }
  }
  /** Nombre de lignes (toutes tables) où le PIN apparaît comme nombre isolé. */
  function pinCountSql(): string {
    return `SELECT coalesce(sum(n), 0)::int AS n FROM (
        SELECT (xpath('/row/c/text()', query_to_xml(
                  format('SELECT count(*) AS c FROM %I.%I t WHERE t::text ~ %L',
                         schemaname, tablename, '(?<![0-9.])' || $1 || '(?![0-9])'),
                  false, true, '')))[1]::text::int AS n
          FROM pg_tables WHERE schemaname = 'public' AND $2::text IS NOT NULL) s`;
  }

  async function journey(): Promise<void> {
    const server = { baseUrl: pw.api.baseUrl, serverCaPem: pw.api.tls.serverCaPem };
    const config = loadConfig({ NODE_ENV: 'test' });
    secrets.push(
      {
        label: 'VENDOR_PIN_SECRET',
        forms: [
          config.vendorPinSecret.toString('hex'),
          config.vendorPinSecret.toString('base64'),
          hex(config.vendorPinSecret.toString('hex')),
        ],
      },
      {
        label: 'VENDOR_PIN_IDEMPOTENCY_SECRET',
        forms: [
          config.vendorPinIdempotencySecret.toString('hex'),
          config.vendorPinIdempotencySecret.toString('base64'),
          hex(config.vendorPinIdempotencySecret.toString('hex')),
        ],
      },
    );
    const merchantAdmin = await withOwner((db) =>
      pw.w.idp.createPerson(db, {
        operatorId: pw.w.ops.a,
        roles: [{ role: 'MERCHANT_ADMIN', scopeType: 'MERCHANT', scopeId: pw.pos.merchantId }],
      }),
    );
    const admin = asPerson(server, merchantAdmin.token);

    // Vendeurs créés par la route (PIN d'origine), puis PIN changé par la route.
    const pin1 = await freshPin();
    const pin2 = await freshPin();
    const wrong = await freshPin();
    const wrong2 = await freshPin();
    const created = note(
      'création du vendeur',
      await admin.post(`/merchants/${pw.pos.merchantId}/vendors`, {
        display_name: 'Vendeur des secrets',
        pin: pin1,
      }),
    );
    expect(created.status).toBe(201);
    const vendorId = String(created.body.vendor_id);
    myVendors.push(vendorId);
    pinSecret('PIN d’origine', pin1);
    pinSecret('PIN faux 1', wrong);
    pinSecret('PIN faux 2', wrong2);
    const changed = note(
      'changement de PIN',
      await admin.post(`/vendors/${vendorId}/pin`, { pin: pin2 }),
    );
    expect(changed.status).toBe(200);
    pinSecret('PIN changé', pin2);
    // Création rejouée avec la même clé : le PIN est dans le corps et dans l'empreinte d'idempotence.
    const key = randomUUID();
    const pin3 = await freshPin();
    pinSecret('PIN d’une création rejouée', pin3);
    const first = await admin.post(
      `/merchants/${pw.pos.merchantId}/vendors`,
      { display_name: 'Vendeur rejoué', pin: pin3 },
      { key },
    );
    expect(first.status).toBe(201);
    myVendors.push(String(first.body.vendor_id));
    note(
      'création rejouée',
      await admin.post(
        `/merchants/${pw.pos.merchantId}/vendors`,
        { display_name: 'Vendeur rejoué', pin: pin3 },
        { key },
      ),
    );
    note(
      'création : même clé, autre PIN',
      await admin.post(
        `/merchants/${pw.pos.merchantId}/vendors`,
        { display_name: 'Vendeur rejoué', pin: wrong2 },
        { key },
      ),
    );

    // Sessions : PIN faux (deux fois), puis bon PIN ; sur un terminal sans session de départ.
    const term: PayTerminal = await pw.terminal({ mode: 'KEYPAD_TPE', session: false });
    const open = (pin: string, idempotencyKey: string = randomUUID()) =>
      term.t.request(pw.api.baseUrl, pw.api.tls.serverCaPem, {
        method: 'POST',
        path: '/vendor-sessions',
        body: { vendor_id: vendorId, pin },
        idempotencyKey,
      });
    note('ouverture, PIN faux 1', await open(wrong));
    note('ouverture, PIN faux 2', await open(wrong2));
    note('ouverture, ancien PIN', await open(pin1));
    const opened = note('ouverture, bon PIN', await open(pin2));
    expect(opened.status).toBe(201);
    term.sessionId = String((opened as TerminalResponse).body.vendor_session_id);
    note(
      'liste des vendeurs du terminal',
      await term.t.request(pw.api.baseUrl, pw.api.tls.serverCaPem, {
        method: 'GET',
        path: '/vendor-sessions/vendors',
      }),
    );
    note(
      'configuration servie',
      await term.t.request(pw.api.baseUrl, pw.api.tls.serverCaPem, {
        method: 'GET',
        path: '/device/config',
      }),
    );

    // Paiement par bracelet, QR commerçant payé, QR client encaissé, annulation.
    const [m] = (await pw.media(1)) as [PayMedia];
    const sale = note(
      'paiement par bracelet',
      await pw.pay(term, pw.keypadBody(term, { tap: pw.tap(m) }, 3000)),
    );
    expect([sale.status]).toEqual([201]);
    const customer: QrCustomer = await qw.customer(20_000);
    const qr = await qw.create(term, qw.keypad(term, 2000));
    note('QR commerçant, création', {
      status: qr.status,
      text: JSON.stringify(qr.body),
    });
    expect(qr.status).toBe(201);
    tokenSecret('jeton du QR commerçant', qr.token);
    expect(qr.token).not.toBe('');
    note('QR commerçant, payé', await qw.pay(customer, qr.id, qr.token));
    note('QR commerçant, rejeu', await qw.pay(customer, qr.id, qr.token));
    note('QR commerçant, jeton faux', await qw.pay(customer, qr.id, 'A'.repeat(22)));
    const customerQr = await qw.asCustomer(customer, 'POST', '/me/customer-qr-tokens', {
      body: { wallet_id: customer.walletId },
    });
    note('QR client, création', customerQr);
    expect(customerQr.status).toBe(201);
    const customerToken = String(customerQr.body.token);
    tokenSecret('jeton du QR client', customerToken);
    note(
      'QR client, encaissé',
      await pw.pay(term, pw.keypadBody(term, { customer_qr_token: customerToken }, 1000)),
    );
    note(
      'QR client, rejeu',
      await pw.pay(term, pw.keypadBody(term, { customer_qr_token: customerToken }, 1000)),
    );
    const reversed = note('annulation', await rw.reverse(term, String(sale.body.transaction_id)));
    expect(reversed.status).toBe(201);
    // Vendeur absent du terminal ou désactivé : erreurs d'ouverture.
    note(
      'ouverture, vendeur inconnu',
      await term.t.request(pw.api.baseUrl, pw.api.tls.serverCaPem, {
        method: 'POST',
        path: '/vendor-sessions',
        body: { vendor_id: randomUUID(), pin: wrong },
        idempotencyKey: randomUUID(),
      }),
    );
  }

  beforeAll(async () => {
    pw = await PaymentWorld.create();
    qw = new QrWorld(pw);
    rw = new ReversalWorld(pw);
    const text = (args: unknown[]) =>
      args
        .map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.stack : JSON.stringify(a)))
        .join(' ');
    const spies = [
      ...LOGGER_METHODS.map((m) =>
        jest.spyOn(Logger.prototype, m).mockImplementation((...args: unknown[]) => {
          journal.push(text(args));
        }),
      ),
      ...LOGGER_METHODS.map((m) =>
        jest.spyOn(Logger, m).mockImplementation((...args: unknown[]) => {
          journal.push(text(args));
        }),
      ),
      ...CONSOLE_METHODS.map((m) =>
        jest.spyOn(console, m).mockImplementation((...args: unknown[]) => {
          journal.push(text(args));
        }),
      ),
      ...[process.stdout, process.stderr].map((stream) =>
        jest.spyOn(stream, 'write').mockImplementation((chunk: unknown) => {
          journal.push(String(chunk));
          return true;
        }),
      ),
    ];
    try {
      await journey();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  }, 300_000);

  afterAll(async () => {
    await pw?.close();
  });

  /** Valeurs d'un secret trouvées dans un texte. */
  const inText = (secret: Secret, text: string): boolean =>
    secret.pin
      ? new RegExp(`(?<![0-9.])${secret.pin}(?![0-9])`).test(text) ||
        secret.forms.some((f) => text.includes(f))
      : secret.forms.some((f) => text.includes(f));

  it('le parcours a bien produit des secrets, des refus et des réponses à chercher', () => {
    expect(secrets.filter((s) => s.pin)).toHaveLength(5);
    expect(secrets.filter((s) => s.label.startsWith('jeton'))).toHaveLength(2);
    expect(secrets.map((s) => s.label)).toEqual(
      expect.arrayContaining(['VENDOR_PIN_SECRET', 'VENDOR_PIN_IDEMPOTENCY_SECRET']),
    );
    expect(responses.length).toBeGreaterThanOrEqual(20);
    expect(responses.filter((r) => r.res.status >= 400).length).toBeGreaterThanOrEqual(6);
  });

  it('base : aucune table ne contient un PIN, un jeton ou un secret, sous aucune forme', async () => {
    const found = await withOwner(async (db) => {
      const { rows: tables } = await db.query<{ name: string }>(
        `SELECT format('%I.%I', schemaname, tablename) AS name
           FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`,
      );
      // Tables attendues dans la recherche : sinon le balayage ne prouve rien.
      expect(tables.map((t) => t.name)).toEqual(
        expect.arrayContaining([
          'public.audit_log',
          'public.api_idempotency',
          'public.device_seq_registry',
          'public.vendor',
          'public.vendor_session',
          'public.payment_request',
          'public.payment_request_detail',
          'public.sale_attribution',
          'public.sale_line',
        ]),
      );
      const hits: string[] = [];
      for (const { name } of tables) {
        for (const secret of secrets) {
          const patterns = secret.pin ? ['(?<![0-9.])' + secret.pin + '(?![0-9])'] : [];
          const literals = secret.forms;
          const { rows } = await db.query<{ n: number }>(
            `WITH r AS MATERIALIZED (SELECT t::text AS x FROM ${name} t)
             SELECT count(*)::int AS n FROM r
              WHERE EXISTS (SELECT 1 FROM unnest($1::text[]) f WHERE strpos(r.x, f) > 0)
                 OR EXISTS (SELECT 1 FROM unnest($2::text[]) p WHERE r.x ~ p)`,
            [literals, patterns],
          );
          if (rows[0]!.n > 0) hits.push(`${name} : ${secret.label}`);
        }
      }
      return hits;
    });
    expect(found).toEqual([]);
  });

  it('journaux : aucun PIN, jeton ni secret dans ce qui part au journal', () => {
    const text = journal.join('\n');
    expect(journal.length).toBeGreaterThan(0);
    expect(secrets.filter((s) => inText(s, text)).map((s) => s.label)).toEqual([]);
    expect(text).not.toContain('$argon2id$');
  });

  it('réponses, y compris d’erreur : aucun PIN, jeton ni secret hors de la création du jeton', () => {
    const leaks = responses.flatMap(({ step, res }) =>
      secrets
        // Un jeton de QR est rendu UNE fois, dans la réponse de sa création (et nulle part ailleurs).
        .filter((s) => !(s.label.startsWith('jeton') && /création/.test(step)))
        .filter((s) => inText(s, res.text))
        .map((s) => `${step} : ${s.label}`),
    );
    expect(leaks).toEqual([]);
    expect(responses.filter((r) => r.res.text.includes('$argon2id$')).map((r) => r.step)).toEqual(
      [],
    );
  });

  it('les jetons ne sont rendus qu’une fois : réponses de création seulement', () => {
    for (const label of ['jeton du QR commerçant', 'jeton du QR client']) {
      const secret = secrets.find((s) => s.label === label)!;
      const where = responses.filter((r) => inText(secret, r.res.text)).map((r) => r.step);
      expect(where).toHaveLength(1);
      expect(where[0]).toMatch(/création/);
    }
  });

  it('`$argon2id$` : présent dans vendor.pin_hash seulement, dans aucune autre colonne ni table', async () => {
    const holders = await withOwner(async (db) => {
      const { rows: tables } = await db.query<{ name: string }>(
        `SELECT format('%I.%I', schemaname, tablename) AS name
           FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`,
      );
      const out: string[] = [];
      for (const { name } of tables) {
        const { rows } = await db.query<{ column: string }>(
          `SELECT DISTINCT e.key AS "column"
             FROM ${name} t, LATERAL jsonb_each_text(to_jsonb(t)) e
            WHERE strpos(e.value, '$argon2id$') > 0`,
        );
        for (const { column } of rows) out.push(`${name}.${column}`);
      }
      return out;
    });
    expect(holders).toEqual(['public.vendor.pin_hash']);
  });

  it('contrôle du balayage : les empreintes attendues sont bien en base', async () => {
    const vendors = await ownerRows<{ pin_hash: string }>(
      'SELECT pin_hash FROM vendor WHERE id = ANY($1)',
      [myVendors],
    );
    expect(vendors).toHaveLength(2);
    for (const v of vendors) expect(v.pin_hash).toMatch(/^\$argon2id\$v=19\$/);
    // Empreintes SHA-256 des jetons de QR : présentes (le balayage cherche bien dans cette table).
    const merchant = secrets.find((s) => s.label === 'jeton du QR commerçant')!.forms[0]!;
    const customerToken = secrets.find((s) => s.label === 'jeton du QR client')!.forms[0]!;
    const hashes = await ownerRows<{ n: number }>(
      'SELECT count(*)::int AS n FROM payment_request WHERE nonce_hash = ANY($1::bytea[])',
      [[merchant, customerToken].map((t) => createHash('sha256').update(t, 'utf8').digest())],
    );
    expect(hashes[0]!.n).toBe(2);
    // Registre d'idempotence, audit et registre des numéros : non vides pour cette suite.
    expect(
      (
        await ownerRows<{ n: number }>(
          `SELECT count(*)::int AS n FROM audit_log WHERE object_type = 'vendor' AND object_id = ANY($1)`,
          [myVendors],
        )
      )[0]!.n,
    ).toBeGreaterThanOrEqual(3);
    expect(
      (await ownerRows<{ n: number }>('SELECT count(*)::int AS n FROM api_idempotency'))[0]!.n,
    ).toBeGreaterThan(5);
    expect(
      (await ownerRows<{ n: number }>('SELECT count(*)::int AS n FROM device_seq_registry'))[0]!.n,
    ).toBeGreaterThan(3);
  });
});
