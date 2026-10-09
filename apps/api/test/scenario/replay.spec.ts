// Critère V1 n° 3 (US3, FR-020, SC-003) : le festival de référence rejoué par les constructeurs du moteur, à travers
// la connexion applicative, donne exactement les soldes attendus ; l'événement finit CLOSED, le grand livre LOCKED ;
// un second rejeu ne crée ni transaction ni ligne.
import type { INestApplication } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { TenantTx } from '../../src/db/tenant-tx';
import { LedgerEngineService, type EngineResult } from '../../src/ledger/ledger-engine.service';
import { CONFIG_RESOLVER, LedgerModule } from '../../src/ledger/ledger.module';
import type { EventStatus } from '../../src/ledger/status-matrix';
import { createTestApp } from '../support/app';
import { withOwner } from '../support/db';
import { expectedLines, scenario } from '../unit/builders/support/scenario-lines';
import { FINAL_STATUS, STEPS, type ScenarioStep } from './commands';
import { createScenarioFixture, type ScenarioFixture } from './fixture';
import { scenarioConfigResolver } from './scenario-config';

interface Expected {
  after_festival: { after_tx: number; balances: Record<string, number> };
  after_closing: { after_tx: number; balances: Record<string, number> };
}
const expected = (scenario as unknown as { expected: Expected }).expected;

jest.setTimeout(120_000);

describe('scénario de référence rejoué par le moteur', () => {
  let app: INestApplication;
  let fx: ScenarioFixture;
  let engine: LedgerEngineService;
  let tx: TenantTx;
  /** Transaction écrite à la première passe, par numéro du scénario. */
  const written = new Map<number, string>();

  beforeAll(async () => {
    fx = await createScenarioFixture();
    app = await createTestApp({
      imports: [LedgerModule.register({ provide: CONFIG_RESOLVER, useValue: scenarioConfigResolver(() => fx) })],
    });
    engine = app.get(LedgerEngineService);
    tx = app.get(TenantTx);
  });

  afterAll(async () => {
    await app.close();
  });

  const owner = <T extends QueryResultRow>(sql: string, values: unknown[] = []) => withOwner(async (db) => (await db.query<T>(sql, values)).rows);

  const lookup = async (key: string): Promise<string> => {
    const [row] = await owner<{ id: string }>('SELECT id FROM journal_transaction WHERE ledger_id = $1 AND idempotency_key = $2', [
      fx.ledgerId,
      key,
    ]);
    if (!row) throw new Error(`transaction introuvable pour la clé ${key}`);
    return row.id;
  };

  /** Passage de statut par la connexion applicative ; un refus (CL019…) fait échouer le test avec sa condition. */
  const setStatus = async (status: EventStatus, before: string): Promise<void> => {
    try {
      await tx.run(fx.parties.OPE, (client) =>
        client.query('SELECT set_event_status($1, $2, $3)', [fx.eventId, status, fx.users.author]),
      );
    } catch (error) {
      const e = error as { code?: string; message?: string };
      throw new Error(`passage ${status} ${before} refusé (${e.code}) : ${e.message}`);
    }
  };

  const execute = async (s: ScenarioStep): Promise<EngineResult> => {
    const command = await s.command(fx, lookup);
    try {
      return await tx.run(fx.parties.OPE, (client) => engine.execute(client, command));
    } catch (error) {
      const e = error as { code?: string; detail?: string; message?: string };
      throw new Error(`T${s.no} (${command.type}) refusée : ${e.code ?? ''} ${e.detail ?? e.message ?? ''}`);
    }
  };

  const postedLines = (transactionId: string) =>
    owner<{ code: string; amount: string }>(
      `SELECT a.code, p.amount::text AS amount FROM posting p JOIN account a ON a.id = p.account_id
        WHERE p.transaction_id = $1 ORDER BY p.line_no`,
      [transactionId],
    ).then((rows) => rows.map((row) => ({ account: row.code, amount: BigInt(row.amount) })));

  const balances = async (): Promise<Record<string, bigint>> =>
    Object.fromEntries(
      (await owner<{ code: string; b: string }>('SELECT code, signed_balance::text AS b FROM trial_balance WHERE ledger_id = $1', [fx.ledgerId])).map(
        (row) => [row.code, BigInt(row.b)],
      ),
    );

  const asBigints = (table: Record<string, number>) => Object.fromEntries(Object.entries(table).map(([code, v]) => [code, BigInt(v)]));

  const counts = async () => {
    const [row] = await owner<{ transactions: number; postings: number }>(
      `SELECT (SELECT count(*)::int FROM journal_transaction WHERE ledger_id = $1) AS transactions,
              (SELECT count(*)::int FROM posting WHERE ledger_id = $1) AS postings`,
      [fx.ledgerId],
    );
    return row!;
  };

  /** Rejoue les étapes [from, to] : statuts intercalés, écriture, puis comparaison (code, montant) aux lignes du JSON. */
  async function replay(from: number, to: number): Promise<void> {
    for (const s of STEPS.filter((x) => x.no >= from && x.no <= to)) {
      for (const status of s.statusBefore ?? []) await setStatus(status, `avant T${s.no}`);
      const result = await execute(s);
      if (!result.transactionId) throw new Error(`T${s.no} : aucune transaction écrite (${result.outcome ?? 'sans résultat'})`);
      expect({ no: s.no, replayed: result.replayed }).toEqual({ no: s.no, replayed: false });
      // Écart → le numéro de la transaction et le diff des lignes apparaissent dans le message d'échec.
      expect({ no: s.no, lines: await postedLines(result.transactionId) }).toEqual({ no: s.no, lines: expectedLines(s.no) });
      written.set(s.no, result.transactionId);
    }
  }

  it(`T1-T${expected.after_festival.after_tx} : soldes de fin de festival exacts`, async () => {
    await replay(1, expected.after_festival.after_tx);
    expect(await balances()).toEqual(asBigints(expected.after_festival.balances));
  });

  it(`T${expected.after_festival.after_tx + 1}-T${expected.after_closing.after_tx} : soldes de clôture exacts, CLOSED, LOCKED`, async () => {
    await replay(expected.after_festival.after_tx + 1, expected.after_closing.after_tx);
    expect(await balances()).toEqual(asBigints(expected.after_closing.balances));
    await setStatus(FINAL_STATUS, 'après la dernière transaction');

    const [state] = await owner<{ event_status: string; ledger_status: string; must_be_zero: string; drift: number }>(
      `SELECT e.status::text AS event_status, l.status AS ledger_status,
              (SELECT must_be_zero::text FROM ledger_invariant WHERE ledger_id = l.id) AS must_be_zero,
              (SELECT count(*)::int FROM balance_drift d JOIN account a ON a.id = d.account_id WHERE a.ledger_id = l.id) AS drift
         FROM ledger l JOIN event e ON e.id = l.scope_id WHERE l.id = $1`,
      [fx.ledgerId],
    );
    expect(state).toEqual({ event_status: 'CLOSED', ledger_status: 'LOCKED', must_be_zero: '0', drift: 0 });
  });

  it('second rejeu des 48 commandes, grand livre verrouillé : 0 transaction et 0 ligne créées', async () => {
    const before = await counts();
    expect(before.transactions).toBe(STEPS.length);
    for (const s of STEPS) {
      const result = await execute(s);
      // Types à lignes : la transaction existante ; cautions déléguées : sans effet (rien n'est réécrit).
      if (result.replayed) expect({ no: s.no, id: result.transactionId }).toEqual({ no: s.no, id: written.get(s.no) });
      else expect({ no: s.no, transactionId: result.transactionId }).toEqual({ no: s.no, transactionId: null });
    }
    expect(await counts()).toEqual(before);
  });

  it('comportement de la base : post_transaction rejoué à l’identique sur un grand livre LOCKED renvoie l’existant', async () => {
    const original = written.get(1)!;
    const [t1] = await owner<{ type: string; key: string; occurred: string; source: string; event: string; metadata: string }>(
      `SELECT type, idempotency_key AS key, occurred_at::text AS occurred, source, event_id AS event, metadata::text AS metadata
         FROM journal_transaction WHERE id = $1`,
      [original],
    );
    const lines = await owner<{ account_id: string; amount: string }>(
      'SELECT account_id, amount::text AS amount FROM posting WHERE transaction_id = $1 ORDER BY line_no',
      [original],
    );
    const json = `[${lines.map((l) => `{"account_id":"${l.account_id}","amount":${l.amount}}`).join(',')}]`;
    const id = await tx.run(fx.parties.OPE, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `SELECT post_transaction($1, $2, $3, $4, $5, $6::jsonb, $7, NULL, NULL, NULL, NULL, NULL, NULL, $8::jsonb) AS id`,
        [fx.ledgerId, t1!.type, t1!.key, t1!.occurred, t1!.source, json, t1!.event, t1!.metadata],
      );
      return rows[0]!.id;
    });
    expect(id).toBe(original);
  });
});
