// `getPayment` (mission 5b, lot WP11, T053, T054 ; FR-025, NFR-007 ; A13 ; contracts/payments.md, « GET
// /payments/{transaction_id} »). Garde exclusive : un marqueur de terminal (certificat présenté ou en-tête
// `Signature`) exige les trois preuves, SANS repli sur le jeton d'une personne ; sans marqueur, la personne
// seule. Terminal : ses propres ventes. Personne : OPERATOR_ADMIN, ORGANIZER_ADMIN, SUPERVISOR de l'événement,
// MERCHANT_ADMIN du commerçant. Tout le reste : 404 neutre, le même corps que pour une vente inexistante.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { contractViolations } from '../../support/contract-schema';
import { withOwner } from '../../support/db';
import { ownerRows, type MediaWorld } from '../../support/media-fixtures';
import { createOperators } from '../transverse/fixtures';
import { send, type TerminalResponse } from '../../support/test-terminal';
import { PaymentWorld, type PayMedia, type PayTerminal } from './payments-fixtures';

jest.setTimeout(180_000);

const stable = (body: Record<string, unknown>) => {
  const { instance: _i, request_id: _r, ...rest } = body;
  return rest;
};

describe('getPayment (WP11, T053)', () => {
  let pw: PaymentWorld;
  let w: MediaWorld;
  let bar: PayTerminal;
  let other: PayTerminal;
  let sale: Record<string, unknown>;
  let txId: string;
  let merchantAdmin: { token: string };
  let supervisorEvent: { token: string };
  let strangers: Record<string, { token: string }>;

  beforeAll(async () => {
    pw = await PaymentWorld.create();
    w = pw.w;
    bar = await pw.terminal({ mode: 'CATALOG_POS' });
    other = await pw.terminal({ mode: 'CATALOG_POS' });
    const [m] = (await pw.media(1)) as [PayMedia];
    const res = await pw.pay(
      bar,
      pw.catalogBody(bar, { tap: pw.tap(m) }, [
        [0, 1],
        [1, 2],
      ]),
    );
    expect(res.status).toBe(201);
    sale = res.body;
    txId = sale.transaction_id as string;
    const otherMerchant = await pw.newPos();
    const opsB = (await createOperators()).b;
    await withOwner(async (db) => {
      merchantAdmin = await w.idp.createPerson(db, {
        operatorId: w.ops.a,
        roles: [{ role: 'MERCHANT_ADMIN', scopeType: 'MERCHANT', scopeId: pw.pos.merchantId }],
      });
      supervisorEvent = await w.idp.createPerson(db, {
        operatorId: w.ops.a,
        roles: [{ role: 'SUPERVISOR', scopeType: 'EVENT', scopeId: w.ids.eventA }],
      });
      strangers = {
        'MERCHANT_ADMIN d’un autre commerçant': await w.idp.createPerson(db, {
          operatorId: w.ops.a,
          roles: [
            {
              role: 'MERCHANT_ADMIN',
              scopeType: 'MERCHANT',
              scopeId: otherMerchant.pos.merchantId,
            },
          ],
        }),
        'CASHIER de l’événement': w.cashierA,
        'PERSONALIZER du prestataire': w.personalizerA,
        'PLATFORM_ADMIN (sans prestataire)': w.platformAdmin,
        'OPERATOR_ADMIN d’un autre prestataire': await w.idp.createPerson(db, {
          operatorId: opsB,
          roles: [{ role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: opsB }],
        }),
        'CASHIER d’un autre prestataire': w.cashierB,
      };
    });
  });
  afterAll(async () => {
    await pw?.close();
  });

  /** Chemin personne : le jeton seul, aucune preuve de terminal. */
  const asPerson = (token: string | null, id = txId): Promise<TerminalResponse> =>
    send(
      {
        url: new URL(`${pw.api.baseUrl}/payments/${id}`),
        method: 'GET',
        headers: {
          'x-request-id': randomUUID(),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: '',
        cert: null,
        key: null,
      },
      pw.api.tls.serverCaPem,
    );
  const asTerminal = (t: PayTerminal, id = txId) => pw.get(t, id);

  it('terminal : sa propre vente → 200 PaymentResult (vendeur, lignes, canal, solde après)', async () => {
    const res = await asTerminal(bar);
    expect(res.status).toBe(200);
    expect(contractViolations('PaymentResult', res.body)).toEqual([]);
    expect(res.body).toEqual(sale);
  });

  it('NFR-007 : la vente d’un AUTRE terminal, une vente inexistante, un identifiant non UUID → 404, même corps', async () => {
    const bodies = new Set<string>();
    for (const res of [
      await asTerminal(other),
      await asTerminal(bar, randomUUID()),
      await asTerminal(bar, 'pas-un-uuid'),
    ]) {
      expect([res.status, res.body.code]).toEqual([404, 'NOT_FOUND']);
      bodies.add(JSON.stringify(stable(res.body)));
    }
    expect(bodies.size).toBe(1);
  });

  it('chaque rôle admis lit la vente : OPERATOR_ADMIN, ORGANIZER_ADMIN, SUPERVISOR (événement ou organisateur), MERCHANT_ADMIN', async () => {
    for (const [name, person] of [
      ['OPERATOR_ADMIN', w.operatorAdminA],
      ['ORGANIZER_ADMIN', w.organizerAdminA],
      ['SUPERVISOR de l’organisateur', w.supervisorA],
      ['SUPERVISOR de l’événement', supervisorEvent],
      ['MERCHANT_ADMIN du commerçant', merchantAdmin],
    ] as const) {
      const res = await asPerson(person.token);
      expect([name, res.status]).toEqual([name, 200]);
      expect(res.body).toEqual(sale);
    }
  });

  it('NFR-007 : rôle hors périmètre, autre commerçant, autre prestataire, plateforme → 404 neutre (le même corps qu’une vente inexistante)', async () => {
    const unknown = stable((await asPerson(w.operatorAdminA.token, randomUUID())).body);
    for (const [name, person] of Object.entries(strangers)) {
      const res = await asPerson(person.token);
      expect([name, res.status, res.body.code]).toEqual([name, 404, 'NOT_FOUND']);
      expect(stable(res.body)).toEqual(unknown);
    }
  });

  it('seule une vente PURCHASE se lit : l’identifiant d’une recharge → 404', async () => {
    const [topup] = await ownerRows<{ id: string }>(
      `SELECT id FROM journal_transaction WHERE ledger_id = $1 AND type = 'TOPUP' LIMIT 1`,
      [w.ids.ledgerA],
    );
    expect(topup).toBeDefined();
    expect((await asPerson(w.operatorAdminA.token, topup!.id)).status).toBe(404);
    expect((await asTerminal(bar, topup!.id)).status).toBe(404);
  });

  it('A13 — garde exclusive : preuves mêlées (terminal + jeton de personne) refusées, sans repli', async () => {
    const person = w.operatorAdminA.token;
    const call = (proofs: Parameters<PayTerminal['t']['request']>[3]) =>
      bar.t.request(
        pw.api.baseUrl,
        pw.api.tls.serverCaPem,
        { method: 'GET', path: `/payments/${txId}` },
        proofs,
      );
    // Certificat et signature du terminal, mais le jeton d'une personne à la place du jeton d'appareil.
    expect((await call({ token: person })).status).toBe(401);
    // Certificat seul présenté (pas de signature) : marqueur de terminal, preuves incomplètes.
    expect((await call({ token: person, signature: 'none' })).status).toBe(401);
    // Signature seule présentée (pas de certificat).
    expect((await call({ token: person, certificate: 'none' })).status).toBe(401);
    // Jeton de personne seul, mais un en-tête Signature vide-de-sens présent : traité comme un terminal.
    const withSignature = await send(
      {
        url: new URL(`${pw.api.baseUrl}/payments/${txId}`),
        method: 'GET',
        headers: {
          'x-request-id': randomUUID(),
          authorization: `Bearer ${person}`,
          signature: 'sig=:AAAA:',
          'signature-input': 'sig=("@method")',
        },
        body: '',
        cert: null,
        key: null,
      },
      pw.api.tls.serverCaPem,
    );
    expect(withSignature.status).toBe(401);
    // Rien du tout, ou un jeton qui n'est pas valide : 401.
    expect((await asPerson(null)).status).toBe(401);
    expect((await asPerson('jeton-faux')).status).toBe(401);
    // Les trois preuves du terminal, sans repli vers la personne : 200 pour sa vente.
    expect((await asTerminal(bar)).status).toBe(200);
    // X-Staff-Authorization n'a pas sa place ici.
    const staff = await bar.t.request(
      pw.api.baseUrl,
      pw.api.tls.serverCaPem,
      { method: 'GET', path: `/payments/${txId}` },
      { headers: { 'x-staff-authorization': `Bearer ${person}` } },
    );
    expect(staff.status).toBe(401);
  });

  it('balance_after est celui d’APRÈS la vente, même consulté après d’autres ventes du portefeuille', async () => {
    const term = await pw.terminal({ mode: 'KEYPAD_TPE' });
    const [m] = (await pw.media(1, 10_000)) as [PayMedia];
    const first = await pw.pay(term, pw.keypadBody(term, { tap: pw.tap(m) }, 1000));
    const second = await pw.pay(term, pw.keypadBody(term, { tap: pw.tap(m) }, 2500));
    expect((first.body.balance_after as { spendable: number }).spendable).toBe(9000);
    expect((second.body.balance_after as { spendable: number }).spendable).toBe(6500);
    const again = await asTerminal(term, first.body.transaction_id as string);
    expect(again.body).toEqual(first.body);
  });
});
