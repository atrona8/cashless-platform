// SC-004, FR-016 : le festival de référence rejoué par le moteur avec le résolveur de configuration RÉEL
// (SqlConfigResolver), sur une configuration construite par les routes de l'API. Les lignes écrites et les soldes
// sont ceux de scenario_reference.json, comme dans le rejeu par fixture de la mission 1 (replay.spec.ts) ; chaque
// transaction écrite par le moteur porte sa version de configuration, chaque ligne de frais sa règle.
import type { INestApplication } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { SqlConfigResolver } from '../../src/configuration/sql-config-resolver';
import { TenantTx } from '../../src/db/tenant-tx';
import { LedgerEngineService, type EngineResult } from '../../src/ledger/ledger-engine.service';
import { CONFIG_RESOLVER } from '../../src/ledger/ledger.module';
import type { FeeRule } from '../../src/ledger/money';
import type { EventStatus } from '../../src/ledger/status-matrix';
import { createTestApp } from '../support/app';
import { withOwner } from '../support/db';
import { FakeIdp } from '../support/fake-idp';
import { expectedLines, scenario } from '../unit/builders/support/scenario-lines';
import { createApiConfigFixture, type ApiConfigFixture } from './api-config-fixture';
import { FINAL_STATUS, STEPS, type ScenarioStep } from './commands';
import { MERCHANTS } from './fixture';
import { scenarioResolvedConfig } from './scenario-config';

interface Expected {
  after_festival: { after_tx: number; balances: Record<string, number> };
  after_closing: { after_tx: number; balances: Record<string, number> };
}
const expected = (scenario as unknown as { expected: Expected }).expected;

jest.setTimeout(180_000);

describe('scénario de référence rejoué sur une configuration construite par l’API', () => {
  let app: INestApplication;
  let fx: ApiConfigFixture;
  let engine: LedgerEngineService;
  let tx: TenantTx;
  const written = new Map<number, string>();

  beforeAll(async () => {
    const idp = await FakeIdp.create();
    app = await createTestApp({ identity: idp });
    fx = await createApiConfigFixture(app, idp);
    engine = app.get(LedgerEngineService);
    tx = app.get(TenantTx);
  });

  afterAll(async () => {
    await app.close();
  });

  const owner = <T extends QueryResultRow>(sql: string, values: unknown[] = []) => withOwner(async (db) => (await db.query<T>(sql, values)).rows);
  const lookup = async (key: string): Promise<string> => {
    const [row] = await owner<{ id: string }>('SELECT id FROM journal_transaction WHERE ledger_id = $1 AND idempotency_key = $2', [fx.ledgerId, key]);
    if (!row) throw new Error(`transaction introuvable pour la clé ${key}`);
    return row.id;
  };
  const setStatus = async (status: EventStatus, before: string): Promise<void> => {
    try {
      await tx.run(fx.parties.OPE, (client) => client.query('SELECT set_event_status($1, $2, $3)', [fx.eventId, status, fx.users.author]));
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
  /** Code du scénario d'un compte : le compte d'un commerçant y est nommé par sa clé, ici par sa participation. */
  const scenarioCode = (code: string): string => {
    const merchant = MERCHANTS.find((key) => code === `L-MCH-${fx.participations[key]}`);
    return merchant ? `L-MCH-${merchant}` : code;
  };
  const postedLines = (transactionId: string) =>
    owner<{ code: string; amount: string }>(
      `SELECT a.code, p.amount::text AS amount FROM posting p JOIN account a ON a.id = p.account_id WHERE p.transaction_id = $1 ORDER BY p.line_no`,
      [transactionId],
    ).then((rows) => rows.map((row) => ({ account: scenarioCode(row.code), amount: BigInt(row.amount) })));
  const balances = async (): Promise<Record<string, bigint>> =>
    Object.fromEntries(
      (await owner<{ code: string; b: string }>('SELECT code, signed_balance::text AS b FROM trial_balance WHERE ledger_id = $1', [fx.ledgerId])).map((row) => [
        scenarioCode(row.code),
        BigInt(row.b),
      ]),
    );
  /** Soldes attendus du scénario ; les comptes fixes que le scénario n'utilise pas (créés avec le grand livre) sont à zéro. */
  const expectBalances = async (table: Record<string, number>) => {
    const actual = await balances();
    const want = Object.fromEntries(Object.entries(table).map(([code, value]) => [code, BigInt(value)]));
    expect(Object.fromEntries(Object.keys(want).map((code) => [code, actual[code]]))).toEqual(want);
    expect(Object.entries(actual).filter(([code, value]) => !(code in want) && value !== 0n)).toEqual([]);
  };
  const counts = async () => {
    const [row] = await owner<{ transactions: number; postings: number }>(
      `SELECT (SELECT count(*)::int FROM journal_transaction WHERE ledger_id = $1) AS transactions,
              (SELECT count(*)::int FROM posting WHERE ledger_id = $1) AS postings`,
      [fx.ledgerId],
    );
    return row!;
  };
  async function replay(from: number, to: number): Promise<void> {
    for (const s of STEPS.filter((x) => x.no >= from && x.no <= to)) {
      for (const status of s.statusBefore ?? []) await setStatus(status, `avant T${s.no}`);
      const result = await execute(s);
      if (!result.transactionId) throw new Error(`T${s.no} : aucune transaction écrite (${result.outcome ?? 'sans résultat'})`);
      expect({ no: s.no, replayed: result.replayed }).toEqual({ no: s.no, replayed: false });
      expect({ no: s.no, lines: await postedLines(result.transactionId) }).toEqual({ no: s.no, lines: expectedLines(s.no) });
      written.set(s.no, result.transactionId);
    }
  }

  it('le résolveur réel rend la configuration du scénario, règle par règle', async () => {
    const resolver = app.get<SqlConfigResolver>(CONFIG_RESOLVER);
    expect(resolver).toBeInstanceOf(SqlConfigResolver);
    const actual = await tx.run(fx.parties.OPE, (client) =>
      resolver.resolve({ ledgerId: fx.ledgerId, eventId: fx.eventId, occurredAt: new Date('2026-12-11T18:00:00Z'), client }),
    );
    const reference = scenarioResolvedConfig(fx);
    // Même arithmétique : un taux ou un montant absent de la référence vaut zéro, une borne absente vaut « aucune ».
    const plain = (rule: FeeRule) => ({ rateBps: rule.rateBps ?? 0n, fixed: rule.fixed ?? 0n, min: rule.min ?? null, max: rule.max ?? null });
    const table = (rules: Record<string, FeeRule>) => Object.fromEntries(Object.entries(rules).map(([key, rule]) => [key, plain(rule)]));
    expect(table(actual.commissions)).toEqual(table(reference.commissions));
    expect(table(actual.pspFees)).toEqual(table(reference.pspFees));
    expect(plain(actual.activationFee)).toEqual(plain(reference.activationFee));
    expect(plain(actual.refundFee)).toEqual(plain(reference.refundFee));
    expect(plain(actual.platformFee)).toEqual(plain(reference.platformFee));
    expect(actual.operatorFees.map((f) => ({ basis: f.basis, rule: plain(f.rule) }))).toEqual(reference.operatorFees.map((f) => ({ basis: f.basis, rule: plain(f.rule) })));
    const { commissions: _c, pspFees: _p, activationFee: _a, refundFee: _r, platformFee: _f, operatorFees: _o, configVersionId, ...scalars } = actual;
    const { commissions: _rc, pspFees: _rp, activationFee: _ra, refundFee: _rr, platformFee: _rf, operatorFees: _ro, ...referenceScalars } = reference;
    expect(scalars).toEqual(referenceScalars);
    // Chaque règle porte son identifiant ; la version de configuration est celle de l'événement.
    expect(Object.values(actual.commissions).map((rule) => rule.id).sort()).toEqual(Object.values(fx.commissionRules).sort());
    expect([actual.activationFee.id, actual.refundFee.id, actual.platformFee.id, ...actual.operatorFees.map((f) => f.rule.id)].every((id) => typeof id === 'string')).toBe(true);
    expect(await owner('SELECT scope_type, scope_id::text, version FROM config_version WHERE id = $1', [configVersionId])).toEqual([{ scope_type: 'EVENT', scope_id: fx.eventId, version: 1 }]);
  });

  it(`T1-T${expected.after_festival.after_tx} : lignes et soldes de fin de festival exacts`, async () => {
    await replay(1, expected.after_festival.after_tx);
    await expectBalances(expected.after_festival.balances);
  });

  it(`T${expected.after_festival.after_tx + 1}-T${expected.after_closing.after_tx} : soldes de clôture exacts, CLOSED, LOCKED`, async () => {
    await replay(expected.after_festival.after_tx + 1, expected.after_closing.after_tx);
    await expectBalances(expected.after_closing.balances);
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

  it('chaque transaction écrite par le moteur porte la version de configuration de l’événement', async () => {
    const rows = await owner<{ type: string; versioned: number; total: number }>(
      `SELECT t.type, count(t.config_version_id)::int AS versioned, count(*)::int AS total
         FROM journal_transaction t WHERE t.ledger_id = $1 GROUP BY t.type ORDER BY t.type`,
      [fx.ledgerId],
    );
    // Les cautions sont écrites par les fonctions de la base (take_deposit…), qui n'ont pas de version à poser.
    const delegated = ['DEPOSIT_TAKEN', 'DEPOSIT_REFUNDED', 'DEPOSIT_FORFEITED'];
    expect(rows.filter((row) => !delegated.includes(row.type) && row.versioned !== row.total)).toEqual([]);
    expect(rows.filter((row) => !delegated.includes(row.type)).reduce((sum, row) => sum + row.total, 0)).toBeGreaterThan(40);
    expect(await owner(`SELECT DISTINCT c.scope_type, c.scope_id::text FROM journal_transaction t JOIN config_version c ON c.id = t.config_version_id WHERE t.ledger_id = $1`, [fx.ledgerId])).toEqual([
      { scope_type: 'EVENT', scope_id: fx.eventId },
    ]);
  });

  it('chaque ligne de frais porte sa règle : commissions, frais de paiement, d’activation, de remboursement, du prestataire, redevance', async () => {
    // Lignes de frais reconnues par leur compte : toutes doivent porter une règle, de la bonne portée.
    const feeLines = await owner<{ purpose: string; lines: number; with_rule: number; scopes: string[] }>(
      `SELECT a.purpose, count(*)::int AS lines, count(p.fee_rule_id)::int AS with_rule, array_agg(DISTINCT f.scope_type ORDER BY f.scope_type) AS scopes
         FROM posting p JOIN account a ON a.id = p.account_id JOIN journal_transaction t ON t.id = p.transaction_id
         LEFT JOIN fee_rule f ON f.id = p.fee_rule_id
        WHERE p.ledger_id = $1 AND t.type <> 'REVERSAL'
          AND ((a.purpose = 'ORG_COM') OR (a.purpose = 'ORG_FPSP') OR (a.purpose = 'ORG_FPREST' AND p.amount > 0)
            OR (a.purpose IN ('OPE_REDEV', 'PLT_REDEV', 'PLT_TAX')) OR (a.purpose = 'ORG_FFEST'))
        GROUP BY a.purpose ORDER BY a.purpose`,
      [fx.ledgerId],
    );
    expect(feeLines.map((row) => [row.purpose, row.lines === row.with_rule, row.scopes])).toEqual([
      ['OPE_REDEV', true, ['PLATFORM_CONTRACT']],
      ['ORG_COM', true, ['PARTICIPATION']],
      ['ORG_FFEST', true, ['EVENT']],
      ['ORG_FPREST', true, ['OPERATOR_CONTRACT']],
      ['ORG_FPSP', true, ['EVENT']],
      ['PLT_REDEV', true, ['PLATFORM_CONTRACT']],
      ['PLT_TAX', true, ['PLATFORM_CONTRACT']],
    ]);
    // Une vente au food truck : la commission est celle de la règle de sa participation.
    const [sale] = await owner<{ rules: string[] }>(
      `SELECT array_agg(DISTINCT p.fee_rule_id::text) AS rules FROM posting p JOIN account a ON a.id = p.account_id JOIN journal_transaction t ON t.id = p.transaction_id
        WHERE p.ledger_id = $1 AND t.type = 'PURCHASE' AND a.participation_id = $2 AND p.amount > 0`,
      [fx.ledgerId, fx.participations.FOOD],
    );
    expect(sale!.rules).toEqual([fx.commissionRules.FOOD]);
    // Aucune ligne ne cite une règle étrangère à cet événement et à ses contrats.
    expect(
      await owner(
        `SELECT DISTINCT f.scope_type FROM posting p JOIN fee_rule f ON f.id = p.fee_rule_id
          WHERE p.ledger_id = $1 AND NOT (f.scope_id = ANY($2::uuid[]))`,
        [fx.ledgerId, [fx.eventId, fx.contractId, fx.platformContractId, ...Object.values(fx.participations)]],
      ),
    ).toEqual([]);
  });

  it('second rejeu des 48 commandes, grand livre verrouillé : 0 transaction et 0 ligne créées', async () => {
    const before = await counts();
    expect(before.transactions).toBe(STEPS.length);
    for (const s of STEPS) {
      const result = await execute(s);
      if (result.replayed) expect({ no: s.no, id: result.transactionId }).toEqual({ no: s.no, id: written.get(s.no) });
      else expect({ no: s.no, transactionId: result.transactionId }).toEqual({ no: s.no, transactionId: null });
    }
    expect(await counts()).toEqual(before);
  });
});
