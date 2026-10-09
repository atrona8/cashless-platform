// Intégration : moteur d'écritures sur la base locale, à travers la connexion applicative (TenantTx).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { TenantTx } from '../../../src/db/tenant-tx';
import { ProblemException } from '../../../src/errors/problem';
import { LedgerEngineService, type EngineResult } from '../../../src/ledger/ledger-engine.service';
import { CONFIG_RESOLVER, LedgerModule } from '../../../src/ledger/ledger.module';
import type { LedgerCommand } from '../../../src/ledger/types';
import { createTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { createMiniFixture, inMemoryConfigResolver, type MiniFixture } from './mini-fixture';

describe('moteur d’écritures (intégration)', () => {
  let app: INestApplication;
  let fx: MiniFixture;
  let engine: LedgerEngineService;
  let tx: TenantTx;
  let seq = 0;

  beforeAll(async () => {
    fx = await createMiniFixture();
    app = await createTestApp({
      imports: [LedgerModule.register({ provide: CONFIG_RESOLVER, useValue: inMemoryConfigResolver(() => fx.config) })],
    });
    engine = app.get(LedgerEngineService);
    tx = app.get(TenantTx);
    // Soldes de départ : W1 = 10 000 payés, W2 = 5 400 payés (recharges PSP par le moteur).
    await run(command('TOPUP', 'wave:seed-w1', { walletId: fx.wallet1, channel: 'WAVE', amount: 10_000n }, 'PSP_WEBHOOK'));
    await run(command('TOPUP', 'wave:seed-w2', { walletId: fx.wallet2, channel: 'WAVE', amount: 5_400n }, 'PSP_WEBHOOK'));
  });

  afterAll(async () => {
    await app.close();
  });

  function command<P>(type: LedgerCommand['type'], key: string, payload: P, source: LedgerCommand['source'] = 'ONLINE'): LedgerCommand {
    return { type, idempotencyKey: key, occurredAt: new Date(), source, ledgerId: fx.ledgerId, eventId: fx.eventId, currency: 'XOF', payload };
  }

  const run = (cmd: LedgerCommand): Promise<EngineResult> => tx.run(fx.operatorId, (client) => engine.execute(client, cmd));

  const failure = async (cmd: LedgerCommand): Promise<{ code: string; status: number }> => {
    const error = await run(cmd).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ProblemException);
    return { code: (error as ProblemException).code, status: (error as ProblemException).status };
  };

  const linesOf = (transactionId: string) =>
    withOwner(async (db) => {
      const { rows } = await db.query<{ code: string; amount: string }>(
        `SELECT a.code, p.amount::text AS amount FROM posting p JOIN account a ON a.id = p.account_id
          WHERE p.transaction_id = $1 ORDER BY p.line_no`,
        [transactionId],
      );
      return rows.map((row) => [row.code, BigInt(row.amount)] as const);
    });

  const balance = (code: string, ledgerId = fx.ledgerId) =>
    withOwner(async (db) => {
      const { rows } = await db.query<{ b: string }>(
        `SELECT coalesce(sum(p.amount), 0)::text AS b FROM posting p JOIN account a ON a.id = p.account_id
          WHERE a.ledger_id = $1 AND a.code = $2`,
        [ledgerId, code],
      );
      return BigInt(rows[0]!.b);
    });

  const transactionCount = (ledgerId: string) =>
    withOwner(async (db) => {
      const { rows } = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM journal_transaction WHERE ledger_id = $1', [ledgerId]);
      return rows[0]!.n;
    });

  const purchase = (key: string, walletId: string, amount: bigint) =>
    command('PURCHASE', key, { walletId, participationId: fx.participationId, amount });

  it('vente de 6 000 : 5 lignes exactes (commission 12 %, taxe 18 %) et soldes', async () => {
    const result = await run(purchase(`TPE-FOOD:${++seq}`, fx.wallet1, 6_000n));
    expect(result.replayed).toBe(false);
    expect(await linesOf(result.transactionId!)).toEqual([
      ['L-WAL-W1-P', 6_000n],
      ['L-MCH-FOOD', -6_000n],
      ['L-MCH-FOOD', 720n],
      ['L-ORG-COM', -610n],
      ['L-ORG-TVA', -110n],
    ]);
    expect(await balance('L-WAL-W1-P')).toBe(-4_000n);
    expect(await balance('L-MCH-FOOD')).toBe(-5_280n);
  });

  it('vente de 7 000 avec 5 400 disponibles : INSUFFICIENT_FUNDS, aucune écriture', async () => {
    const before = await transactionCount(fx.ledgerId);
    expect(await failure(purchase('TPE-FOOD:trop', fx.wallet2, 7_000n))).toEqual({ code: 'INSUFFICIENT_FUNDS', status: 422 });
    expect(await transactionCount(fx.ledgerId)).toBe(before);
    expect(await balance('L-WAL-W2-P')).toBe(-5_400n);
  });

  it('même commande rejouée : même transaction, replayed = true ; même clé autre montant : IDEMPOTENCY_KEY_REUSED', async () => {
    const key = `TPE-FOOD:${++seq}`;
    const first = await run(purchase(key, fx.wallet2, 1_000n));
    const before = await transactionCount(fx.ledgerId);
    const again = await run(purchase(key, fx.wallet2, 1_000n));
    expect(again).toEqual({ transactionId: first.transactionId, replayed: true });
    expect(await transactionCount(fx.ledgerId)).toBe(before);
    expect(await failure(purchase(key, fx.wallet2, 1_500n))).toEqual({ code: 'IDEMPOTENCY_KEY_REUSED', status: 409 });
  });

  it('rejeu sans soldes suffisants : toujours un rejeu (l’idempotence passe avant tout recalcul)', async () => {
    const key = `TPE-FOOD:${++seq}`;
    const first = await run(purchase(key, fx.wallet2, 4_000n)); // le solde restant ne couvre plus 4 000
    const again = await run(purchase(key, fx.wallet2, 4_000n));
    expect(again).toEqual({ transactionId: first.transactionId, replayed: true });
  });

  it('événement DRAFT et PURCHASE : VALIDATION_FAILED avant toute écriture', async () => {
    const draft: LedgerCommand = { ...purchase('TPE-FOOD:draft', fx.wallet1, 100n), ledgerId: fx.draftLedgerId, eventId: fx.draftEventId };
    expect(await failure(draft)).toEqual({ code: 'VALIDATION_FAILED', status: 422 });
    expect(await transactionCount(fx.draftLedgerId)).toBe(0);
  });

  it('devise différente de celle du grand livre : VALIDATION_FAILED', async () => {
    expect(await failure({ ...purchase('TPE-FOOD:eur', fx.wallet1, 100n), currency: 'EUR' })).toEqual({ code: 'VALIDATION_FAILED', status: 422 });
  });

  it('REVERSAL : contre-passation exacte, lignes opposées en ordre inverse, soldes rétablis', async () => {
    const before = await balance('L-WAL-W1-P');
    const sale = await run(purchase(`TPE-FOOD:${++seq}`, fx.wallet1, 2_500n));
    const reversal = await run({ ...command('REVERSAL', `TPE-FOOD:${++seq}`, {}), reversesId: sale.transactionId! });
    const original = await linesOf(sale.transactionId!);
    expect(await linesOf(reversal.transactionId!)).toEqual([...original].reverse().map(([code, amount]) => [code, -amount]));
    expect(await balance('L-WAL-W1-P')).toBe(before);
  });

  it('caution déléguée (take_deposit, SEPARATE) puis seconde demande sans effet', async () => {
    const deposit = (key: string): LedgerCommand => ({
      ...command('DEPOSIT_TAKEN', key, { moneyAccount: 'A-CAISSE-C1' }),
      mediaId: fx.mediaId,
    });
    const first = await run(deposit('caution:1'));
    expect(first.outcome).toBe('HELD');
    expect(first.transactionId).toEqual(expect.any(String));
    expect(await linesOf(first.transactionId!)).toEqual([
      ['A-CAISSE-C1', 500n],
      ['L-ORG-CAUTION', -500n],
    ]);
    const before = await transactionCount(fx.ledgerId);
    expect(await run(deposit('caution:2'))).toEqual({ transactionId: null, replayed: false, outcome: 'HELD' });
    expect(await transactionCount(fx.ledgerId)).toBe(before);
  });

  it('BACKOFFICE sans second valideur distinct : VALIDATION_FAILED avant la base', async () => {
    const actor = '9a0b0c0d-0000-4000-8000-000000000001';
    const cmd: LedgerCommand = {
      ...command('PROMO_CREDIT', 'promo:bo-1', { walletId: fx.wallet1, amount: 100n }, 'BACKOFFICE'),
      createdBy: actor,
      approvedBy: actor,
    };
    expect(await failure(cmd)).toEqual({ code: 'VALIDATION_FAILED', status: 422 });
  });
});

describe('architecture du moteur', () => {
  const SRC = join(__dirname, '../../../src');
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
    });
  const sources = files(SRC).map((path) => ({ path: relative(SRC, path).split(sep).join('/'), text: readFileSync(path, 'utf8') }));

  it('aucun INSERT direct dans journal_transaction ni posting depuis src/', () => {
    expect(sources.filter((f) => /INSERT\s+INTO\s+(journal_transaction|posting)\b/i.test(f.text)).map((f) => f.path)).toEqual([]);
  });

  it('post_transaction n’est appelé que par le moteur (src/ledger/)', () => {
    expect(sources.filter((f) => /post_transaction\(/.test(f.text) && !f.path.startsWith('ledger/')).map((f) => f.path)).toEqual([]);
  });
});
