// Mission 9b, WP14 : balayage d'isolation des 20 opérations ajoutées au contrat par la mission (liste figée
// `test/support/mission-9b-operations.ts`, recoupée avec le contrat et avec `contract-additions.md`). Chaque opération est
// appelée par le personnel d'un AUTRE prestataire (B : OPERATOR_ADMIN puis ORGANIZER_ADMIN) sur les objets du prestataire A :
// jamais de succès (403 ou 404), aucune donnée de A dans le corps, rien de modifié chez A ; puis sans jeton (401). Une
// opération sans cas fait échouer le test. Les balayages des missions antérieures (`configuration-isolation`,
// `media-isolation`) écartent ces opérations de leur sélection.
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { withOwner } from '../../support/db';
import { createTestCustomer } from '../../support/fake-customer';
import {
  TEST_CUSTOMER_DEVICE_HEADER,
  TEST_CUSTOMER_HEADER,
  TEST_CUSTOMER_OPERATOR_HEADER,
} from '../../../src/customer-identity/fake-customer-identity';
import { MISSION_9B_OPERATIONS } from '../../support/mission-9b-operations';
import { ownerRows } from '../../support/media-fixtures';
import { send } from '../../support/test-terminal';
import { PayoutWorld } from '../payouts/payout-fixtures';

jest.setTimeout(300_000);

const CONTRACT = join(__dirname, '../../../../../packages/contracts/openapi.yaml');
const ADDITIONS = join(
  __dirname,
  '../../../../../kitty-specs/versements-rapprochements-cloture-01M7JT4G/contracts/contract-additions.md',
);

type Method = 'GET' | 'POST';
interface Case {
  method: Method;
  path: () => string;
  body?: () => unknown;
  /** Festivalier de B plutôt que le personnel de B. */
  customer?: boolean;
}

describe('balayage d’isolation des opérations de la mission 9b', () => {
  let p: PayoutWorld;
  let a: { op: string; org: string; event: string; ledger: string; wallet: string };
  let marker: string;
  let account: string;
  let line: string;
  let payout: string;
  let batch: string;
  let pending: string;
  let stranger: { headers: Record<string, string> };

  beforeAll(async () => {
    p = await PayoutWorld.create();
    a = {
      op: p.w.ops.a,
      org: p.w.ids.organizerA,
      event: p.w.ids.eventA,
      ledger: p.w.ids.ledgerA,
      wallet: p.w.ids.walletA,
    };
    marker = `ISO-SECRET-${randomUUID().slice(0, 8)}`;
    account = (
      await ownerRows<{ id: string }>(
        `SELECT id FROM account WHERE ledger_id = $1 AND code = 'A-PSP-WAVE'`,
        [a.ledger],
      )
    )[0]!.id;
    line = (
      await ownerRows<{ id: string }>(
        `INSERT INTO external_statement_line (operator_id, ledger_id, account_id, source, external_ref, value_date, amount)
         VALUES ($1, $2, $3, 'wave', $4, current_date, 1000) RETURNING id::text`,
        [a.op, a.ledger, account, marker],
      )
    )[0]!.id;
    const m = await p.merchant(20_000);
    const done = await p.batch([p.line(m, 5_000)]);
    batch = done.id;
    payout = (await p.payoutsOf(batch))[0]!.id;
    const open = await p.request([p.line(await p.merchant(9_000), 1_000)]);
    pending = String(open.body.approval_request_id);
    stranger = await withOwner(async (db) =>
      createTestCustomer(db, p.w.ops.b).then((c) => ({
        headers: {
          [TEST_CUSTOMER_HEADER]: c.customerId,
          [TEST_CUSTOMER_OPERATOR_HEADER]: p.w.ops.b,
          [TEST_CUSTOMER_DEVICE_HEADER]: 'iso-device',
        },
      })),
    );
  }, 300_000);
  afterAll(async () => p.close());

  const ev = () => `/operators/${a.op}/events/${a.event}`;
  const cases: Record<string, Case> = {
    listEventClosingSteps: { method: 'GET', path: () => `${ev()}/closing-steps` },
    previewEventClosingStep: {
      method: 'GET',
      path: () => `${ev()}/closing-steps/PITCH_FEES/preview`,
    },
    executeEventClosingStep: { method: 'POST', path: () => `${ev()}/closing-steps/PITCH_FEES` },
    getEventRemainingBalances: { method: 'GET', path: () => `${ev()}/remaining-balances` },
    listPayoutEntitlements: {
      method: 'GET',
      path: () => `/ledgers/${a.ledger}/payout-entitlements`,
    },
    requestPayoutBatch: {
      method: 'POST',
      path: () => `/ledgers/${a.ledger}/payout-batches/approval-requests`,
      body: () => ({
        lines: [
          {
            beneficiary_party_id: randomUUID(),
            amount: 100,
            currency: 'XOF',
            method: 'WAVE',
            msisdn: '+221770000001',
          },
        ],
      }),
    },
    listPayouts: { method: 'GET', path: () => `/ledgers/${a.ledger}/payouts` },
    exportPayoutBatch: {
      method: 'GET',
      path: () => `/ledgers/${a.ledger}/payout-batches/${batch}/export`,
    },
    confirmPayout: {
      method: 'POST',
      path: () => `/payouts/${payout}/confirm`,
      body: () => ({ outcome: 'CONFIRMED', external_reference: 'INTRUS-REF' }),
    },
    importAccountStatement: {
      method: 'POST',
      path: () =>
        `/ledgers/${a.ledger}/accounts/${account}/statements?source=wave&statement_date=2026-12-31&closing_balance=0`,
      body: () => 'external_ref;value_date;amount;currency\r\nINTRUS-1;2026-12-01;100;XOF\r\n',
    },
    listStatementLines: { method: 'GET', path: () => `/ledgers/${a.ledger}/statement-lines` },
    matchStatementLine: {
      method: 'POST',
      path: () => `/statement-lines/${line}/match`,
      body: () => ({ transaction_id: randomUUID() }),
    },
    getLedgerReconciliation: { method: 'GET', path: () => `/ledgers/${a.ledger}/reconciliation` },
    postLateAdjustment: {
      method: 'POST',
      path: () => `/ledgers/${a.ledger}/late-adjustments`,
      body: () => ({
        beneficiary_party_id: a.org,
        amount: 100,
        currency: 'XOF',
        reason: 'Essai d’intrusion du balayage.',
      }),
    },
    createRefundRequest: {
      method: 'POST',
      path: () => '/refund-requests',
      body: () => ({
        wallet_id: a.wallet,
        destination: { method: 'WAVE', msisdn: '+221770000001' },
        reason: 'Essai d’intrusion du balayage.',
      }),
    },
    getPartyStatement: {
      method: 'GET',
      path: () => `${ev()}/statements/ORGANIZER?party_id=${a.org}`,
    },
    getMyWalletStatement: {
      method: 'GET',
      path: () => `/me/wallets/${a.wallet}/statement`,
      customer: true,
    },
    listAccountMappings: { method: 'GET', path: () => `/operators/${a.op}/account-mappings` },
    createAccountMappingVersion: {
      method: 'POST',
      path: () => `/operators/${a.op}/account-mappings`,
      body: () => ({
        entity_party_id: a.org,
        valid_from: '2030-01-01T00:00:00Z',
        mappings: [{ purpose: 'ORG_COM', debit_account: '411', credit_account: '706' }],
      }),
    },
    exportAccounting: {
      method: 'GET',
      path: () =>
        `/operators/${a.op}/accounting-exports?entity=${a.org}&from=2026-01-01&to=2030-12-31`,
    },
  };

  /** Contenu de A qui ne doit jamais apparaître dans une réponse à B (hors les identifiants du chemin appelé). */
  const secrets = () => [marker, 'INTRUS-REF', 'INTRUS-1'];

  const call = (c: Case, token: string | null, customerHeaders?: Record<string, string>) => {
    const isText = typeof c.body?.() === 'string';
    return send(
      {
        url: new URL(`${p.api.baseUrl}${c.path()}`),
        method: c.method,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(customerHeaders ?? {}),
          ...(c.method === 'POST'
            ? {
                'content-type': isText ? 'text/csv' : 'application/json',
                'idempotency-key': randomUUID(),
              }
            : {}),
        },
        body:
          c.method === 'POST'
            ? isText
              ? String(c.body!())
              : JSON.stringify(c.body?.() ?? {})
            : '',
        cert: null,
        key: null,
      },
      p.api.tls.serverCaPem,
    );
  };

  /** Ce qui, chez A, ne doit pas bouger pendant le balayage. */
  const state = async () =>
    (
      await ownerRows<Record<string, string>>(
        `SELECT (SELECT count(*) FROM journal_transaction WHERE ledger_id = $1)::text AS tx,
                (SELECT count(*) FROM closing_step WHERE event_id = $2)::text AS steps,
                (SELECT count(*) FROM approval_request WHERE operator_id = $3)::text AS approvals,
                (SELECT string_agg(status, ',' ORDER BY id) FROM payout WHERE ledger_id = $1) AS payouts,
                (SELECT count(*) FROM external_statement_line WHERE ledger_id = $1)::text AS lines,
                (SELECT count(*) FROM external_statement_line WHERE ledger_id = $1 AND matched_tx_id IS NOT NULL)::text AS matched,
                (SELECT count(*) FROM statement_import WHERE ledger_id = $1)::text AS imports,
                (SELECT count(*) FROM refund_request WHERE ledger_id = $1)::text AS refunds,
                (SELECT count(*) FROM account_mapping WHERE operator_id = $3)::text AS mappings`,
        [a.ledger, a.event, a.op],
      )
    )[0]!;

  it('le contrat et le fichier des ajouts déclarent exactement ces 20 opérations, chacune a un cas, aucun cas orphelin', () => {
    expect(MISSION_9B_OPERATIONS).toHaveLength(20);
    const contract = parse(readFileSync(CONTRACT, 'utf8')) as {
      paths: Record<string, Record<string, { operationId?: string }>>;
    };
    const declared = new Set(
      Object.values(contract.paths).flatMap((ops) =>
        Object.values(ops)
          .map((o) => o?.operationId)
          .filter((id): id is string => typeof id === 'string'),
      ),
    );
    expect(MISSION_9B_OPERATIONS.filter((id) => !declared.has(id))).toEqual([]);
    expect(MISSION_9B_OPERATIONS.filter((id) => !(id in cases))).toEqual([]);
    expect(Object.keys(cases).filter((id) => !MISSION_9B_OPERATIONS.includes(id))).toEqual([]);
    // Recoupement avec le fichier des ajouts (présent dans le dépôt de la mission).
    expect(existsSync(ADDITIONS)).toBe(true);
    const text = readFileSync(ADDITIONS, 'utf8');
    const listed = [...text.matchAll(/`([a-z][A-Za-z]+)`/g)]
      .map((m) => m[1]!)
      .filter((id) => MISSION_9B_OPERATIONS.includes(id));
    expect(new Set(listed)).toEqual(new Set(MISSION_9B_OPERATIONS));
  });

  it('chaque opération : refus 403 ou 404 au personnel de B (OPERATOR_ADMIN et ORGANIZER_ADMIN) et au festivalier de B, aucune donnée de A, rien de modifié', async () => {
    const before = await state();
    const problems: string[] = [];
    let calls = 0;
    for (const id of MISSION_9B_OPERATIONS) {
      const c = cases[id]!;
      const callers = c.customer
        ? [{ label: 'festivalier de B', token: null as string | null, headers: stranger.headers }]
        : [
            { label: 'OPERATOR_ADMIN de B', token: p.operatorAdminB.token, headers: undefined },
            { label: 'ORGANIZER_ADMIN de B', token: p.organizerAdminB.token, headers: undefined },
          ];
      for (const who of callers) {
        const res = await call(c, who.token, who.headers);
        calls += 1;
        const text = JSON.stringify(res.body ?? {});
        if (![403, 404].includes(res.status))
          problems.push(`${id} par ${who.label} : ${res.status}`);
        for (const secret of secrets())
          if (secret && text.includes(secret))
            problems.push(`${id} par ${who.label} : fuite ${secret}`);
      }
    }
    expect(problems).toEqual([]);
    expect(calls).toBeGreaterThanOrEqual(MISSION_9B_OPERATIONS.length);
    expect(await state()).toEqual(before);
    // Les objets de A sont intacts : le versement attend toujours son résultat, la ligne n'est pas rapprochée.
    expect((await p.payoutsOf(batch))[0]!.status).toBe('INITIATED');
    expect(pending).toBeTruthy();
  });

  it('chaque opération sans jeton : 401, rien d’écrit', async () => {
    const before = await state();
    const problems: string[] = [];
    for (const id of MISSION_9B_OPERATIONS) {
      const res = await call(cases[id]!, null);
      if (res.status !== 401) problems.push(`${id} : ${res.status}`);
    }
    expect(problems).toEqual([]);
    expect(await state()).toEqual(before);
  });

  it('témoin : le personnel de A atteint les mêmes objets (les refus viennent de l’isolation, pas des chemins)', async () => {
    for (const id of [
      'listPayoutEntitlements',
      'listPayouts',
      'getLedgerReconciliation',
      'listStatementLines',
    ]) {
      const res = await call(cases[id]!, p.w.operatorAdminA.token);
      expect({ id, status: res.status }).toEqual({ id, status: 200 });
    }
    // Le marqueur de A est bien lisible par A : l'absence de fuite vers B est donc un vrai contrôle.
    const lines = await call(cases.listStatementLines!, p.w.operatorAdminA.token);
    expect(JSON.stringify(lines.body)).toContain(marker);
    const steps = await call(cases.listEventClosingSteps!, p.w.operatorAdminA.token);
    expect(steps.status).toBe(200);
  });
});
