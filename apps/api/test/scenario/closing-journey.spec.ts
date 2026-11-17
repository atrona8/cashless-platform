// Mission 9b, WP14 (T062 ; SC-001, NFR-002) : le festival de référence mené de CLOSING à LOCKED par les SEULES routes du
// back-office, avec deux administrateurs distincts là où deux personnes sont requises.
//
// Préparation (fixture, pas de route de la mission) : configuration par les routes (`createApiConfigFixture`), ventes et
// recharges T1 à T23 rejouées par le moteur, fermeture de la session de caisse (mission 6), écritures de caisse, de
// banque et de règlement PSP T24 à T29 (missions antérieures), remboursements T41 et T42 (mission 9a). Tout le reste passe
// par HTTP : passages de statut, relevés (import, rapprochement automatique puis manuel), étapes de clôture (aperçu puis
// exécution), lots de versements (demande, validation par une autre personne, export, résultat), CLOSED, LOCKED.
// Contrôles : après chaque étape, chaque transaction est à somme nulle, `ledger_invariant.must_be_zero = 0`, argent
// détenu = droits ; à la fin, soldes = `expected.after_closing.balances` ; un rejeu complet des écritures HTTP, mêmes
// clés, ne crée ni transaction ni ligne.
import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import request from 'supertest';
import { TenantTx } from '../../src/db/tenant-tx';
import { LedgerEngineService } from '../../src/ledger/ledger-engine.service';
import type { EventStatus } from '../../src/ledger/status-matrix';
import { createTestApp } from '../support/app';
import { withOwner } from '../support/db';
import { FakeIdp, type TestPerson } from '../support/fake-idp';
import { scenario } from '../unit/builders/support/scenario-lines';
import { createApiConfigFixture, type ApiConfigFixture } from './api-config-fixture';
import { STEPS } from './commands';
import { MERCHANTS } from './fixture';

interface Expected {
  after_festival: { after_tx: number; balances: Record<string, number> };
  after_closing: { after_tx: number; balances: Record<string, number> };
}
const expected = (scenario as unknown as { expected: Expected }).expected;

jest.setTimeout(600_000);

const IBAN = 'SN08SN0100152000048500003035';
type Res = request.Response;

describe('SC-001 : de CLOSING à LOCKED par les routes du back-office', () => {
  let app: INestApplication;
  let idp: FakeIdp;
  let fx: ApiConfigFixture;
  let engine: LedgerEngineService;
  let tx: TenantTx;
  let operatorAdmin2: TestPerson;
  let organizerAdmin2: TestPerson;
  const op = () => fx.parties.OPE;
  const orgAdmin = () => fx.people.organizerAdmin;
  const opAdmin = () => fx.people.operatorAdmin;
  /** Écritures HTTP envoyées (pour le rejeu complet à clés identiques). */
  const writes: { path: string; key: string; who: string; body: unknown; type: string }[] = [];
  const checks: string[] = [];

  const owner = <T extends QueryResultRow>(sql: string, values: unknown[] = []) =>
    withOwner(async (db) => (await db.query<T>(sql, values)).rows);

  const http = (
    method: 'get' | 'post',
    path: string,
    who: TestPerson,
    o: { body?: unknown; key?: string; type?: string; query?: string } = {},
  ): Promise<Res> => {
    const url = `/v1${path}${o.query ? `?${o.query}` : ''}`;
    let req = request(app.getHttpServer())[method](url).set('Authorization', `Bearer ${who.token}`);
    if (method === 'post') {
      const key = o.key ?? randomUUID();
      const type = o.type ?? 'application/json';
      writes.push({ path: url, key, who: who.token, body: o.body ?? {}, type });
      req = req.set('Idempotency-Key', key).set('Content-Type', type);
      return Promise.resolve(
        req.send(type === 'application/json' ? (o.body ?? {}) : String(o.body)),
      );
    }
    return Promise.resolve(req.buffer(true));
  };
  const must = (res: Res, status: number, what: string) => {
    if (res.status !== status) throw new Error(`${what} : ${res.status} ${res.text}`);
    return res;
  };

  const base = () => `/operators/${op()}/events/${fx.eventId}`;
  const transition = (to: EventStatus, who: TestPerson = opAdmin()) =>
    http('post', `${base()}/status-transitions`, who, { body: { to } });
  const eventStatus = async () =>
    (
      await owner<{ s: string }>('SELECT status::text AS s FROM event WHERE id = $1', [fx.eventId])
    )[0]!.s;

  const lookup = async (key: string): Promise<string> => {
    const [row] = await owner<{ id: string }>(
      'SELECT id FROM journal_transaction WHERE ledger_id = $1 AND idempotency_key = $2',
      [fx.ledgerId, key],
    );
    if (!row) throw new Error(`transaction introuvable pour la clé ${key}`);
    return row.id;
  };
  /** Écriture du scénario n° `no` par le moteur (préparation seulement). */
  const prep = async (from: number, to: number) => {
    for (const s of STEPS.filter((x) => x.no >= from && x.no <= to)) {
      const command = await s.command(fx, lookup);
      if (command.type === 'TOPUP') {
        const channel = (command.payload as { channel: keyof typeof fx.pspConfigurations }).channel;
        command.metadata = {
          ...command.metadata,
          psp_configuration_id: fx.pspConfigurations[channel],
        };
      }
      try {
        await tx.run(op(), (client) => engine.execute(client, command));
      } catch (error) {
        const e = error as { code?: string; detail?: string; message?: string };
        throw new Error(`T${s.no} refusée : ${e.code ?? ''} ${e.detail ?? e.message ?? ''}`);
      }
    }
  };
  const setStatusDirect = (status: EventStatus) =>
    tx.run(op(), (client) =>
      client.query('SELECT set_event_status($1, $2, $3)', [fx.eventId, status, fx.users.author]),
    );

  const scenarioCode = (code: string): string => {
    const merchant = MERCHANTS.find((key) => code === `L-MCH-${fx.participations[key]}`);
    return merchant ? `L-MCH-${merchant}` : code;
  };
  const balances = async () =>
    Object.fromEntries(
      (
        await owner<{ code: string; b: string }>(
          'SELECT code, signed_balance::text AS b FROM trial_balance WHERE ledger_id = $1',
          [fx.ledgerId],
        )
      ).map((row) => [scenarioCode(row.code), BigInt(row.b)]),
    );
  const counts = async () =>
    (
      await owner<{ transactions: number; postings: number }>(
        `SELECT (SELECT count(*)::int FROM journal_transaction WHERE ledger_id = $1) AS transactions,
                (SELECT count(*)::int FROM posting WHERE ledger_id = $1) AS postings`,
        [fx.ledgerId],
      )
    )[0]!;

  /** Après chaque étape : somme nulle par transaction, invariant du grand livre, argent détenu = droits. */
  const invariants = async (label: string) => {
    const unbalanced = await owner(
      `SELECT transaction_id FROM posting WHERE ledger_id = $1 GROUP BY transaction_id HAVING sum(amount) <> 0`,
      [fx.ledgerId],
    );
    const [inv] = await owner<{ must_be_zero: string; money_held: string; total_claims: string }>(
      `SELECT must_be_zero::text, money_held::text, total_claims::text FROM ledger_invariant WHERE ledger_id = $1`,
      [fx.ledgerId],
    );
    const [drift] = await owner<{ n: number }>(
      `SELECT count(*)::int AS n FROM balance_drift d JOIN account a ON a.id = d.account_id WHERE a.ledger_id = $1`,
      [fx.ledgerId],
    );
    const negativeClaims = await owner(
      `SELECT owner_party_id FROM party_position WHERE ledger_id = $1 AND net_claim < 0`,
      [fx.ledgerId],
    );
    expect({ label, unbalanced, negativeClaims, drift: drift!.n }).toEqual({
      label,
      unbalanced: [],
      negativeClaims: [],
      drift: 0,
    });
    expect({
      label,
      must_be_zero: inv!.must_be_zero,
      equal: inv!.money_held === inv!.total_claims,
    }).toEqual({ label, must_be_zero: '0', equal: true });
    checks.push(label);
  };

  const accountId = async (code: string) =>
    (
      await owner<{ id: string }>('SELECT id FROM account WHERE ledger_id = $1 AND code = $2', [
        fx.ledgerId,
        code,
      ])
    )[0]!.id;

  /** Mouvements d'un compte, une ligne de relevé par transaction (net sur le compte), construits depuis le grand livre. */
  const movements = (code: string) =>
    owner<{ tx: string; amount: string; day: string; ref: string | null }>(
      `SELECT t.id::text AS tx, sum(p.amount)::text AS amount, to_char(t.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
              (SELECT po.external_ref FROM payout po WHERE po.settled_tx_id = t.id AND po.status = 'CONFIRMED') AS ref
         FROM posting p JOIN account a ON a.id = p.account_id JOIN journal_transaction t ON t.id = p.transaction_id
        WHERE a.ledger_id = $1 AND a.code = $2 GROUP BY t.id, t.occurred_at ORDER BY t.occurred_at, t.id`,
      [fx.ledgerId, code],
    );
  const csv = (rows: { ref: string; day: string; amount: string }[]) =>
    `external_ref;value_date;amount;currency\r\n${rows
      .map((r) => `${r.ref};${r.day};${r.amount};XOF`)
      .join('\r\n')}\r\n`;

  /** Relevé d'un compte : import, puis rapprochement manuel de toutes les lignes que l'automatique n'a pas prises. */
  const statementFor = async (code: string, source: string) => {
    const rows = await movements(code);
    const total = rows.reduce((sum, r) => sum + BigInt(r.amount), 0n);
    const lines = rows.map((r, i) => ({
      ref: r.ref ?? `${source}-${code}-${i + 1}`,
      day: r.day,
      amount: r.amount,
      tx: r.tx,
    }));
    const account = await accountId(code);
    const imp = must(
      await http('post', `/ledgers/${fx.ledgerId}/accounts/${account}/statements`, opAdmin(), {
        body: csv(lines),
        type: 'text/csv',
        query: `source=${source}&statement_date=2099-01-01&closing_balance=${total}`,
      }),
      201,
      `import ${code}`,
    );
    const open = must(
      await http('get', `/ledgers/${fx.ledgerId}/statement-lines`, opAdmin(), {
        query: `account_id=${account}&matched=false&limit=200`,
      }),
      200,
      `lignes ${code}`,
    );
    const byRef = new Map(lines.map((l) => [l.ref, l.tx]));
    for (const line of open.body.data as { statement_line_id: string; external_ref: string }[]) {
      must(
        await http('post', `/statement-lines/${line.statement_line_id}/match`, orgAdmin(), {
          body: { transaction_id: byRef.get(line.external_ref) },
        }),
        200,
        `rapprochement ${line.external_ref}`,
      );
    }
    return {
      created: imp.body.lines_created as number,
      auto: imp.body.lines_matched as number,
      manual: open.body.data.length as number,
    };
  };
  const reconciliation = async () =>
    Object.fromEntries(
      (
        must(
          await http('get', `/ledgers/${fx.ledgerId}/reconciliation`, opAdmin()),
          200,
          'état du rapprochement',
        ).body.data as { code?: string; account_id: string; reconciled: boolean }[]
      ).map((r) => [r.account_id, r.reconciled]),
    );

  const stepPath = (step: string) => `${base()}/closing-steps/${step}`;
  /** Aperçu (rien d'écrit) puis exécution d'une étape ; le total exécuté est celui de l'aperçu. */
  const closingStep = async (step: string, total: number, status = 'DONE') => {
    const before = await counts();
    const preview = must(
      await http('get', `${stepPath(step)}/preview`, opAdmin()),
      200,
      `aperçu ${step}`,
    );
    expect(preview.body.total).toBe(total);
    expect(await counts()).toEqual(before);
    const done = must(await http('post', stepPath(step), opAdmin()), 200, `étape ${step}`);
    expect(done.body.status).toBe(status);
    expect(done.body.summary?.total ?? 0).toBe(total);
    await invariants(`étape ${step}`);
  };

  /** Lot de versements : demandé par `author`, validé par `approver` ; rend les versements créés. */
  const batch = async (
    lines: unknown[],
    author: TestPerson,
    approver: TestPerson,
    label: string,
  ) => {
    const asked = must(
      await http('post', `/ledgers/${fx.ledgerId}/payout-batches/approval-requests`, author, {
        body: { lines },
      }),
      202,
      `demande ${label}`,
    );
    const id = String(asked.body.approval_request_id);
    const self = await http('post', `/approval-requests/${id}/approve`, author);
    expect([403, 409]).toContain(self.status);
    const approved = must(
      await http('post', `/approval-requests/${id}/approve`, approver),
      200,
      `validation ${label}`,
    );
    expect(approved.body.status).toBe('EXECUTED');
    const list = must(
      await http('get', `/ledgers/${fx.ledgerId}/payouts`, author, {
        query: `approval_request_id=${id}&limit=100`,
      }),
      200,
      `liste ${label}`,
    );
    const exported = must(
      await http('get', `/ledgers/${fx.ledgerId}/payout-batches/${id}/export`, author),
      200,
      `export ${label}`,
    );
    expect(exported.headers['content-type']).toContain('text/csv');
    await invariants(`lot ${label}`);
    return {
      id,
      payouts: list.body.data as {
        payout_id: string;
        beneficiary_party_id: string;
        amount: number;
      }[],
      csv: exported.text,
    };
  };
  const result = async (
    payoutId: string,
    who: TestPerson,
    body:
      | { outcome: 'CONFIRMED'; external_reference: string }
      | { outcome: 'FAILED'; failure_reason: string },
    label: string,
  ) => {
    must(
      await http('post', `/payouts/${payoutId}/confirm`, who, { body }),
      200,
      `résultat ${label}`,
    );
    await invariants(`résultat ${label}`);
  };

  beforeAll(async () => {
    idp = await FakeIdp.create();
    app = await createTestApp({ identity: idp });
    fx = await createApiConfigFixture(app, idp);
    engine = app.get(LedgerEngineService);
    tx = app.get(TenantTx);
    await withOwner(async (db) => {
      const { rows } = await db.query<{ id: string }>(
        'SELECT id FROM media_batch WHERE event_id = $1 LIMIT 1',
        [fx.eventId],
      );
      for (const key of ['W01', 'W02', 'W03', 'W06'] as const)
        await db.query(
          `INSERT INTO media (operator_id, kind, token_hash, batch_id, wallet_id, status)
           VALUES ($1, 'NFC_TAG', $2, $3, $4, 'ACTIVE')`,
          [op(), randomBytes(32), rows[0]!.id, fx.wallets[key]],
        );
      operatorAdmin2 = await idp.createPerson(db, {
        operatorId: op(),
        roles: [{ role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: op() }],
      });
      organizerAdmin2 = await idp.createPerson(db, {
        operatorId: op(),
        roles: [{ role: 'ORGANIZER_ADMIN', scopeType: 'ORGANIZER', scopeId: fx.parties.ORG }],
      });
    });
  });
  afterAll(async () => {
    await app.close();
  });

  it('festival T1 à T23 (préparation), puis CLOSING et RECONCILING : refus tant qu’une caisse est ouverte', async () => {
    await setStatusDirect('LIVE');
    await prep(1, expected.after_festival.after_tx);
    await invariants('fin de festival');
    must(await transition('CLOSING'), 200, 'CLOSING');
    await prep(24, 24); // CASH_CLOSE : fermeture de la caisse C1 (mission 6)
    const refused = await transition('RECONCILING');
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('CLOSING_CONDITION_NOT_MET');
    expect(refused.body.detail).toContain('NO_OPEN_CASH_SESSION');
    expect(await eventStatus()).toBe('CLOSING');
    // La session de caisse se ferme (mission 6) ; la condition devient remplie.
    await withOwner(async (db) => {
      await db.query('ALTER TABLE cash_session DISABLE TRIGGER USER');
      try {
        await db.query(
          `UPDATE cash_session SET status = 'CLOSED', closed_at = now(), counted_amount = 37000, expected_amount = 37000,
                  closed_by = opened_by,
                  close_tx_id = (SELECT id FROM journal_transaction WHERE ledger_id = $1 AND type = 'CASH_CLOSE' LIMIT 1)
            WHERE event_id = $2`,
          [fx.ledgerId, fx.eventId],
        );
      } finally {
        await db.query('ALTER TABLE cash_session ENABLE TRIGGER USER');
      }
    });
    must(await transition('RECONCILING'), 200, 'RECONCILING');
    expect(await eventStatus()).toBe('RECONCILING');
    await invariants('RECONCILING');
  });

  it('relevés PSP et bancaire : SETTLING refusé tant que les comptes PSP ne sont pas rapprochés', async () => {
    await prep(25, 29); // anomalie résolue, dépôt en banque, règlements PSP (missions antérieures)
    const refused = await transition('SETTLING');
    expect(refused.status).toBe(409);
    expect(refused.body.detail).toContain('PSP_RECONCILED');
    for (const [code, source] of [
      ['A-PSP-WAVE', 'wave'],
      ['A-PSP-OM', 'orange'],
      ['A-PSP-CARTE', 'carte'],
    ] as const) {
      const r = await statementFor(code, source);
      expect(r.created).toBeGreaterThan(0);
      expect(r.created).toBe(r.auto + r.manual);
    }
    const state = await reconciliation();
    for (const code of ['A-PSP-WAVE', 'A-PSP-OM', 'A-PSP-CARTE'])
      expect(state[await accountId(code)]).toBe(true);
    must(await transition('SETTLING'), 200, 'SETTLING');
    await invariants('SETTLING');
  });

  it('étapes 1 à 3 : 25 000, 6 000, 1 017 (aperçu puis exécution), REFUND_WINDOW', async () => {
    const list = must(await http('get', `${base()}/closing-steps`, opAdmin()), 200, 'liste');
    expect(list.body.data.map((s: { status: string }) => s.status)).toEqual(Array(7).fill('TODO'));
    await closingStep('PITCH_FEES', 25_000);
    await closingStep('OPERATOR_FEE', 6000);
    await closingStep('PLATFORM_FEE', 1017);
  });

  it('versements T33 à T40 : lots à deux personnes, export, résultats (un échec recrédité puis repris)', async () => {
    const entitlements = must(
      await http('get', `/ledgers/${fx.ledgerId}/payout-entitlements`, orgAdmin(), {
        query: 'limit=200',
      }),
      200,
      'droits',
    );
    const claim = (party: string) =>
      (entitlements.body.data as { party_id: string; available: number }[]).find(
        (e) => e.party_id === party,
      )?.available;
    expect([claim(fx.parties.FOOD), claim(fx.parties.TEE), claim(fx.parties.BAR)]).toEqual([
      11_400, 8000, 18_500,
    ]);
    // Tous les versements du scénario sortent de A-BANQUE : virement bancaire (un versement Wave sortirait de A-PSP-WAVE).
    const line = (party: string, amount: number, method = 'BANK_TRANSFER') => ({
      beneficiary_party_id: party,
      amount,
      currency: 'XOF',
      method,
      ...(method === 'BANK_TRANSFER' ? { iban: IBAN } : { msisdn: '+221770000001' }),
    });
    const merchants = await batch(
      [line(fx.parties.FOOD, 11_400), line(fx.parties.TEE, 8000), line(fx.parties.BAR, 18_500)],
      orgAdmin(),
      organizerAdmin2,
      'commerçants',
    );
    expect(merchants.payouts).toHaveLength(3);
    // L'export porte la destination ; le corps de la demande exposé n'en porte pas.
    expect(merchants.csv).toContain(IBAN);
    const operators = await batch(
      [line(fx.parties.OPE, 4983), line(fx.parties.PLT, 1017)],
      opAdmin(),
      operatorAdmin2,
      'prestataire et plateforme',
    );
    const of = (b: typeof merchants, party: string) =>
      b.payouts.find((p) => p.beneficiary_party_id === party)!.payout_id;
    await result(
      of(merchants, fx.parties.FOOD),
      orgAdmin(),
      { outcome: 'CONFIRMED', external_reference: 'WV-FOOD-1' },
      'FOOD',
    );
    await result(
      of(merchants, fx.parties.TEE),
      orgAdmin(),
      { outcome: 'FAILED', failure_reason: 'numéro refusé par l’opérateur' },
      'TEE (échec)',
    );
    await result(
      of(merchants, fx.parties.BAR),
      orgAdmin(),
      { outcome: 'CONFIRMED', external_reference: 'VIR-BAR-1' },
      'BAR',
    );
    await result(
      of(operators, fx.parties.OPE),
      opAdmin(),
      { outcome: 'CONFIRMED', external_reference: 'VIR-OPE-1' },
      'prestataire',
    );
    await result(
      of(operators, fx.parties.PLT),
      opAdmin(),
      { outcome: 'CONFIRMED', external_reference: 'VIR-PLT-1' },
      'plateforme',
    );
    // Le droit de TEE est recrédité par l'échec ; second lot (T39 et T40).
    const again = await batch(
      [line(fx.parties.TEE, 8000)],
      orgAdmin(),
      organizerAdmin2,
      'TEE (reprise)',
    );
    await result(
      again.payouts[0]!.payout_id,
      orgAdmin(),
      { outcome: 'CONFIRMED', external_reference: 'WV-TEE-2' },
      'TEE (reprise)',
    );
  });

  it('REFUND_WINDOW, remboursements (mission 9a), étapes de casse, de caution et de promotion', async () => {
    must(await transition('REFUND_WINDOW'), 200, 'REFUND_WINDOW');
    await owner(
      `UPDATE event SET refund_deadline = clock_timestamp() - interval '1 minute' WHERE id = $1`,
      [fx.eventId],
    );
    await prep(41, 42);
    await invariants('remboursements');
    await closingStep('OPERATOR_FEE_REGULARIZATION', 0, 'NOT_APPLICABLE');
    await closingStep('BREAKAGE', 20_000);
    await closingStep('DEPOSIT_FORFEIT', 2000);
    await closingStep('PROMO_EXPIRY', 1000);
    const list = must(await http('get', `${base()}/closing-steps`, opAdmin()), 200, 'liste');
    expect(list.body.data.map((s: { status: string }) => s.status)).toEqual([
      'DONE',
      'DONE',
      'DONE',
      'NOT_APPLICABLE',
      'DONE',
      'DONE',
      'DONE',
    ]);
  });

  it('versements T46 à T48 : droits restants de l’organisateur et du prestataire, relevé bancaire, CLOSED puis LOCKED', async () => {
    const rest = must(
      await http('get', `${base()}/remaining-balances`, opAdmin()),
      200,
      'soldes restants',
    );
    expect(rest.status).toBe(200);
    const entitlements = must(
      await http('get', `/ledgers/${fx.ledgerId}/payout-entitlements`, opAdmin(), {
        query: 'limit=200',
      }),
      200,
      'droits',
    );
    const claim = (party: string) =>
      (entitlements.body.data as { party_id: string; available: number }[]).find(
        (e) => e.party_id === party,
      )?.available;
    expect([claim(fx.parties.ORG), claim(fx.parties.OPE)]).toEqual([39_225, 4000]);
    const org = await batch(
      [
        {
          beneficiary_party_id: fx.parties.ORG,
          amount: 39_225,
          currency: 'XOF',
          method: 'BANK_TRANSFER',
          iban: IBAN,
        },
      ],
      orgAdmin(),
      organizerAdmin2,
      'organisateur',
    );
    const ope = await batch(
      [
        {
          beneficiary_party_id: fx.parties.OPE,
          amount: 4000,
          currency: 'XOF',
          method: 'BANK_TRANSFER',
          iban: IBAN,
        },
      ],
      opAdmin(),
      operatorAdmin2,
      'prestataire (solde)',
    );
    await result(
      org.payouts[0]!.payout_id,
      orgAdmin(),
      { outcome: 'CONFIRMED', external_reference: 'VIR-ORG-1' },
      'organisateur',
    );
    await result(
      ope.payouts[0]!.payout_id,
      opAdmin(),
      { outcome: 'CONFIRMED', external_reference: 'VIR-OPE-2' },
      'prestataire (solde)',
    );

    // Relevé bancaire : les versements confirmés se rapprochent seuls (référence et montant), le reste à la main.
    const bank = await statementFor('A-BANQUE', 'banque');
    expect(bank.auto).toBe(7); // les sept versements confirmés (référence et montant)
    expect(bank.created).toBe(bank.auto + bank.manual);
    expect((await reconciliation())[await accountId('A-BANQUE')]).toBe(true);

    must(await transition('CLOSED'), 200, 'CLOSED');
    expect(await eventStatus()).toBe('CLOSED');
    await invariants('CLOSED');
  });

  it('soldes de clôture exacts, grand livre LOCKED, nombre de transactions justifié', async () => {
    const [state] = await owner<{ ledger_status: string; event_status: string }>(
      `SELECT l.status AS ledger_status, e.status::text AS event_status FROM ledger l JOIN event e ON e.id = l.scope_id WHERE l.id = $1`,
      [fx.ledgerId],
    );
    expect(state).toEqual({ ledger_status: 'LOCKED', event_status: 'CLOSED' });
    const want = Object.fromEntries(
      Object.entries(expected.after_closing.balances).map(([code, v]) => [code, BigInt(v)]),
    );
    const actual = await balances();
    expect(Object.fromEntries(Object.keys(want).map((code) => [code, actual[code]]))).toEqual(want);
    expect(Object.entries(actual).filter(([code, v]) => !(code in want) && v !== 0n)).toEqual([]);
    // Transactions : le scénario compte `after_tx` transactions ; la mission écrit un lot par demande (au lieu d'une
    // transaction de versement par bénéficiaire d'un lot) et sépare les étapes de clôture : l'écart est consigné.
    const types = await owner<{ type: string; n: number }>(
      `SELECT type::text, count(*)::int AS n FROM journal_transaction WHERE ledger_id = $1 GROUP BY type ORDER BY type`,
      [fx.ledgerId],
    );
    const n = (type: string) => types.find((t) => t.type === type)?.n ?? 0;
    expect(n('PAYOUT_INITIATED')).toBe(5); // un par lot : commerçants, prestataire et plateforme, reprise de TEE, organisateur, solde du prestataire
    expect(n('PAYOUT_CONFIRMED')).toBe(7);
    expect(n('PAYOUT_FAILED')).toBe(1);
    // 50 au lieu de 48 : le scénario écrit un seul PAYOUT_INITIATED pour T33 (commerçants, prestataire et plateforme) et
    // un pour T46 (organisateur et prestataire) ; la mission exige un lot par rôle (SPECIFICATION §3.2 amendée) : un
    // PAYOUT_INITIATED de plus pour chacun. Les soldes, eux, sont ceux du scénario.
    expect((await counts()).transactions).toBe(50);
    expect(checks.length).toBeGreaterThan(15);
  });

  it('rejeu complet des écritures HTTP, mêmes clés : aucune transaction ni ligne nouvelle', async () => {
    const before = await counts();
    const sent = writes.length;
    expect(sent).toBeGreaterThan(40);
    const statuses: number[] = [];
    for (const w of writes.slice(0, sent)) {
      const req = request(app.getHttpServer())
        .post(w.path)
        .set('Authorization', `Bearer ${w.who}`)
        .set('Idempotency-Key', w.key)
        .set('Content-Type', w.type);
      const res = await req.send(
        w.type === 'application/json' ? (w.body as object) : String(w.body),
      );
      statuses.push(res.status);
    }
    expect(statuses.filter((s) => s >= 500)).toEqual([]);
    expect(await counts()).toEqual(before);
    await invariants('après rejeu');
  });
});
