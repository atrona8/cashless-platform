// Isolation des routes et des tables de la mission 6 (lot WP14, T070 ; NFR-007, SC-007, A27 ; modèle :
// payment-isolation.spec.ts). Prestataire A (jeu d'essai des recharges PSP) face à des acteurs du prestataire B,
// d'un autre événement du même prestataire, et d'un festivalier de B.
//   1. Garde du contrat : les opérations de la mission sont LUES dans `openapi.yaml` (chemins des sessions de caisse,
//      recharges, configurations PSP, choix d'événement, dépôt, déblocage, contestation tardive, notifications) ;
//      chacune a un cas ici, aucun cas n'est orphelin. Une route ajoutée plus tard sans cas fait échouer ce test.
//   2. Chaque cas : jamais 2xx, jamais 5xx, rien de A dans la réponse (secret_ref, titulaire), rien ne change chez A.
//   3. Route publique : configuration de A sous le chemin d'un autre fournisseur, inconnue : mêmes corps et en-têtes.
//   4. Nouvelles tables sous `cashless_app` avec le prestataire B posé : 0 ligne de A (contrôle : A en a).
//   5. Aucune réponse accessible à un CASHIER ne rend le solde d'un compte CASH_DESK (A27).
// Écritures directes en base : amorçage seulement.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { APP_URL, connect, withOwner } from '../../support/db';
import { createTestCustomer, type TestCustomer } from '../../support/fake-customer';
import { ownerRows } from '../../support/media-fixtures';
import { send, type TerminalResponse } from '../../support/test-terminal';
import { ChargebackWorld } from '../chargebacks/chargeback-fixtures';
import { closeBacklog } from '../webhooks/webhook-fixtures';

jest.setTimeout(400_000);

const CONTRACT = join(__dirname, '../../../../../packages/contracts/openapi.yaml');
const MISSION_PATH =
  /^\/(cash-sessions|topups\/|psp-configurations|organizers\/\{[a-z_]+\}\/psp-configurations|events\/\{[a-z_]+\}\/(psp-selections|cash-sessions)|ledgers\/\{[a-z_]+\}\/cash-deposits|wallets\/\{[a-z_]+\}\/unblock|chargebacks\/|webhooks\/)/;
const DENIED = [400, 401, 403, 404, 409, 422];

function missionOperations(): string[] {
  const contract = parse(readFileSync(CONTRACT, 'utf8')) as {
    paths: Record<string, Record<string, { operationId?: string }>>;
  };
  const ids: string[] = [];
  for (const [path, operations] of Object.entries(contract.paths))
    if (MISSION_PATH.test(path))
      for (const operation of Object.values(operations))
        if (typeof operation === 'object' && operation?.operationId)
          ids.push(operation.operationId);
  return ids.sort();
}

interface Attack {
  op: string;
  who: string;
  call: () => Promise<TerminalResponse>;
}

describe('NFR-007, SC-007 : isolation des routes et des tables de la mission 6 (WP14)', () => {
  let c: ChargebackWorld;
  let custB: TestCustomer;
  let sessionA = '';
  let topupA = '';
  let walletA = '';
  let chargebackA = '';
  let blockedWallet = '';
  const cw = () => c.cw;
  const p = () => c.p;
  const opA = () => p().op;
  const opB = () => cw().w.ops.b;

  const snapshot = async () =>
    (
      await ownerRows<Record<string, unknown>>(
        `SELECT (SELECT count(*) FROM cash_session WHERE operator_id = $1)::int AS sessions,
                (SELECT count(*) FROM cash_session_count WHERE operator_id = $1)::int AS counts,
                (SELECT count(*) FROM cash_session_tx WHERE operator_id = $1)::int AS session_tx,
                (SELECT count(*) FROM psp_topup WHERE operator_id = $1)::int AS topups,
                (SELECT string_agg(status, ',' ORDER BY psp_topup_id) FROM psp_topup WHERE operator_id = $1) AS topup_states,
                (SELECT count(*) FROM psp_chargeback WHERE operator_id = $1)::int AS chargebacks,
                (SELECT string_agg(status || version, ',' ORDER BY psp_configuration_id) FROM psp_configuration WHERE operator_id = $1) AS configs,
                (SELECT count(*) FROM event_psp_selection WHERE operator_id = $1)::int AS selections,
                (SELECT count(*) FROM approval_request WHERE operator_id = $1)::int AS requests,
                (SELECT count(*) FROM journal_transaction WHERE operator_id = $1)::int AS journal,
                (SELECT count(*) FROM anomaly WHERE operator_id = $1)::int AS anomalies,
                (SELECT count(*) FROM wallet WHERE operator_id = $1 AND status <> 'ACTIVE')::int AS not_active`,
        [opA()],
      )
    )[0];

  beforeAll(async () => {
    c = await ChargebackWorld.create();
    await closeBacklog();
    custB = await withOwner((db) => createTestCustomer(db, opB()));
    const ready = await cw().ready({ expected: 3000, counted: 3000 });
    sessionA = ready.id;
    // Amorçage des tables que le balayage contrôle : une session fermée (rattachement des écritures), un
    // choix d'événement et une notification reçue.
    const closed = await cw().ready({ expected: 1000, counted: 1000 });
    expect((await cw().closeBo(closed.id, cw().supervisor)).status).toBe(200);
    await ownerRows(
      `INSERT INTO event_psp_selection (event_id, method, psp_configuration_id, selected_by, approved_by,
                                        operator_id)
       VALUES ($1, 'WAVE', $2, $3, $4, $5)`,
      [
        p().ev.eventId,
        p().configs.WAVE,
        cw().w.organizerAdminA.userId,
        cw().w.operatorAdminA.userId,
        opA(),
      ],
    );
    const noted = await p().topup();
    expect((await c.w.post(c.w.event(noted.row))).status).toBe(200);
    const wallet = await p().wallet();
    walletA = wallet.walletId;
    topupA = (await p().topup({ wallet })).row.topupId;
    const credited = await c.credited({ amount: 10_000 });
    await c.spend(credited.walletId, Number(credited.net));
    await c.handle(credited.row, c.notification(credited.row, c.disputeId(), 2_000));
    chargebackA = (await c.chargebacks(credited.row.topupId))[0]!.psp_chargeback_id;
    blockedWallet = credited.walletId;
  }, 400_000);
  afterAll(async () => {
    await c?.close();
  });

  const put = (who: { token: string }, path: string, body: unknown): Promise<TerminalResponse> =>
    send(
      {
        url: new URL(`${cw().api.baseUrl}${path}`),
        method: 'PUT',
        headers: {
          authorization: `Bearer ${who.token}`,
          'content-type': 'application/json',
          'idempotency-key': randomUUID(),
        },
        body: JSON.stringify(body),
        cert: null,
        key: null,
      },
      cw().api.tls.serverCaPem,
    );

  /** Un cas par opération du contrat ; chaque cas rend ses attaques (qui, appel). */
  const cases = (): Record<string, Attack[]> => {
    const cfg = p().configs.WAVE;
    const ev = p().ev;
    const org = cw().w.ids.organizerA;
    const people = [
      ['OPERATOR_ADMIN de B', cw().operatorAdminOp2],
      ['ORGANIZER_ADMIN de B', cw().organizerAdminOp2],
      ['SUPERVISOR de B', cw().supervisorOp2],
    ] as const;
    const each = (
      op: string,
      make: (who: (typeof people)[number][1]) => Promise<TerminalResponse>,
    ) => people.map(([name, who]) => ({ op, who: name, call: () => make(who) }));
    return {
      openCashSession: [
        ...each('openCashSession', (who) => cw().bo('POST', '/cash-sessions', who, {})),
      ],
      countCashSession: each('countCashSession', (who) =>
        cw().bo('POST', `/cash-sessions/${sessionA}/counts`, who, {
          counted_amount: 1,
          counted_at: new Date().toISOString(),
        }),
      ),
      closeCashSession: each('closeCashSession', (who) =>
        cw().bo('POST', `/cash-sessions/${sessionA}/close`, who),
      ),
      getCashSession: each('getCashSession', (who) =>
        cw().bo('GET', `/cash-sessions/${sessionA}`, who),
      ),
      listCashSessions: each('listCashSessions', (who) =>
        cw().bo('GET', `/events/${ev.eventId}/cash-sessions`, who),
      ),
      createCashTopup: [
        {
          op: 'createCashTopup',
          who: 'festivalier de B',
          call: () =>
            p().cust(custB, 'POST', '/topups/cash', {
              amount: 1000,
              currency: 'XOF',
              occurred_at: new Date().toISOString(),
            }),
        },
      ],
      initiatePspTopup: [
        {
          op: 'initiatePspTopup',
          who: 'festivalier de B sur un portefeuille de A',
          call: () => p().cust(custB, 'POST', '/topups/psp', p().body(walletA)),
        },
      ],
      getPspTopup: [
        {
          op: 'getPspTopup',
          who: 'festivalier de B',
          call: () => p().cust(custB, 'GET', `/topups/psp/${topupA}`),
        },
        ...each('getPspTopup', (who) => cw().bo('GET', `/topups/psp/${topupA}`, who)),
      ],
      cancelPspTopup: [
        {
          op: 'cancelPspTopup',
          who: 'festivalier de B',
          call: () => p().cust(custB, 'POST', `/topups/psp/${topupA}/cancel`, {}),
        },
      ],
      createPspConfiguration: each('createPspConfiguration', (who) =>
        cw().bo('POST', `/organizers/${org}/psp-configurations`, who, {
          method: 'WAVE',
          provider: 'WAVE',
          holder_party_id: org,
          secret_ref: `psp/${org}/intruder`,
        }),
      ),
      listPspConfigurations: each('listPspConfigurations', (who) =>
        cw().bo('GET', `/organizers/${org}/psp-configurations`, who),
      ),
      getPspConfiguration: each('getPspConfiguration', (who) =>
        cw().bo('GET', `/psp-configurations/${cfg}`, who),
      ),
      requestPspConfigurationChange: each('requestPspConfigurationChange', (who) =>
        cw().bo('POST', `/psp-configurations/${cfg}/approval-requests`, who, {
          status: 'SUSPENDED',
        }),
      ),
      getEventPspSelections: each('getEventPspSelections', (who) =>
        cw().bo('GET', `/events/${ev.eventId}/psp-selections`, who),
      ),
      setEventPspSelection: people.map(([name, who]) => ({
        op: 'setEventPspSelection',
        who: name,
        call: () => put(who, `/events/${ev.eventId}/psp-selections/WAVE`, { psp_config_id: cfg }),
      })),
      requestCashDeposit: each('requestCashDeposit', (who) =>
        cw().bo('POST', `/ledgers/${ev.ledgerId}/cash-deposits/approval-requests`, who, {
          amount: 1,
          bank_reference: 'X',
        }),
      ),
      requestWalletUnblock: each('requestWalletUnblock', (who) =>
        cw().bo('POST', `/wallets/${blockedWallet}/unblock/approval-requests`, who, {}),
      ),
      requestLateChargeback: each('requestLateChargeback', (who) =>
        cw().bo('POST', `/chargebacks/${chargebackA}/approval-requests`, who, {}),
      ),
      receivePspWebhook: [
        {
          op: 'receivePspWebhook',
          who: 'anonyme, configuration de A sous un autre fournisseur',
          call: () => c.w.raw('{}', {}, { method: 'WAVE', segment: 'orange-money' }),
        },
      ],
    };
  };

  it('garde du contrat : chaque opération de la mission a un cas, aucun cas orphelin', () => {
    const operations = missionOperations();
    expect(operations.length).toBeGreaterThanOrEqual(19);
    expect(Object.keys(cases()).sort()).toEqual(operations);
  });

  it('B (personne, festivalier) sur les objets de A : jamais 2xx ni 5xx, rien de A rendu, rien ne change', async () => {
    const before = await snapshot();
    const org = cw().w.ids.organizerA;
    const failures: string[] = [];
    for (const attacks of Object.values(cases()))
      for (const attack of attacks) {
        const res = await attack.call();
        if (!DENIED.includes(res.status))
          failures.push(`${attack.op} / ${attack.who} : ${res.status}`);
        if (
          /secret_ref|psp\/|cash_account_id/.test(res.text) &&
          !res.text.includes(`psp/${org}/intruder`)
        )
          failures.push(`${attack.op} / ${attack.who} : fuite ${res.text.slice(0, 80)}`);
      }
    expect(failures).toEqual([]);
    expect(await snapshot()).toEqual(before);
  });

  it('listes de B : sans objet de A ; autre événement du même prestataire : session de A invisible', async () => {
    const list = await cw().bo(
      'GET',
      `/organizers/${cw().w.ids.organizerB}/psp-configurations`,
      cw().organizerAdminOp2,
    );
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain(p().configs.WAVE);
    const terminalB = await cw().terminal(cw().b);
    const own = await cw().term(terminalB, 'GET', `/cash-sessions/${sessionA}`, cw().cashierOfB);
    expect(DENIED).toContain(own.status);
  });

  it('route publique : configuration de A sous un autre fournisseur, inconnue : mêmes corps et en-têtes de 404', async () => {
    const other = await c.w.raw('{}', {}, { method: 'WAVE', segment: 'orange-money' });
    const unknown = await c.w.raw('{}', {}, { method: 'WAVE', configId: randomUUID() });
    expect(other.status).toBe(404);
    expect(unknown.status).toBe(404);
    const normalize = (r: TerminalResponse) => ({
      body: JSON.stringify(r.body).replace(/[0-9a-f-]{36}/g, '<id>'),
      type: r.headers['content-type'],
    });
    expect(normalize(other)).toEqual(normalize(unknown));
  });

  it('nouvelles tables sous cashless_app avec B posé : 0 ligne de A (A en a, contrôle du balayage)', async () => {
    const tables = [
      'cash_session',
      'cash_session_count',
      'cash_session_tx',
      'cash_desk',
      'psp_configuration',
      'event_psp_selection',
      'psp_topup',
      'psp_event',
      'psp_chargeback',
      'psp_webhook_rejection',
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
        if (owned[0]!.n === 0 && table !== 'psp_webhook_rejection') controls.push(table);
        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.operator_id', $1, true)`, [opB()]);
        const { rows } = await client.query<{ a: number; other: number }>(
          `SELECT count(*) FILTER (WHERE operator_id = $1)::int AS a,
                  count(*) FILTER (WHERE operator_id <> $2)::int AS other FROM ${table}`,
          [opA(), opB()],
        );
        await client.query('ROLLBACK');
        if (rows[0]!.a !== 0 || rows[0]!.other !== 0)
          visible.push(`${table} : ${JSON.stringify(rows[0])}`);
      }
    } finally {
      await client.end();
    }
    expect(controls).toEqual([]);
    expect(visible).toEqual([]);
  });

  it('A27 : aucune réponse accessible à un CASHIER ne rend le solde d’un compte CASH_DESK', async () => {
    const t = await cw().terminal();
    const id = await cw().open(t, cw().w.cashierA);
    await cw().seedCash(t, 4321);
    const balance = await cw().deskBalance(t);
    expect(balance).toBe(4321);
    const responses = [
      await cw().term(t, 'GET', `/cash-sessions/${id}`, cw().w.cashierA),
      await cw().count(t, id, cw().w.cashierA, 4000),
      await cw().term(t, 'GET', `/cash-sessions/${id}`, cw().w.cashierA),
      await cw().bo('GET', `/events/${p().ev.eventId}/cash-sessions`, cw().w.cashierA),
    ];
    for (const res of responses) {
      expect(res.text).not.toMatch(/expected_amount":\d|difference":-?\d/);
      expect(res.text).not.toMatch(/(?<![0-9])4321(?![0-9])/);
    }
    const view = responses[0]!.body as Record<string, unknown>;
    expect(view).toMatchObject({
      expected_amount: null,
      difference: null,
      cash_diff_anomaly_id: null,
    });
  });
});
