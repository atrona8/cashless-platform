// Intégration : REVERSAL d'un WALLET_REFUND de source BACKOFFICE (mission remboursements 9a, WP02, FR-009, ADR-189).
// Un paiement échoué doit pouvoir recréditer le festivalier : le moteur accepte ce REVERSAL partout où WALLET_REFUND
// l'est, et rien d'autre. `post_transaction` n'est pas modifiée : le grand livre LOCKED reste refusé par la base.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { TenantTx } from '../../../src/db/tenant-tx';
import { ProblemException } from '../../../src/errors/problem';
import { LedgerEngineService, type EngineResult } from '../../../src/ledger/ledger-engine.service';
import { CONFIG_RESOLVER, LedgerModule } from '../../../src/ledger/ledger.module';
import type { LedgerCommand } from '../../../src/ledger/types';
import { createTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import {
  createMiniFixture,
  inMemoryConfigResolver,
  type MiniFixture,
} from '../engine/mini-fixture';

describe('REVERSAL d’un WALLET_REFUND BACKOFFICE (intégration)', () => {
  let app: INestApplication;
  let fx: MiniFixture;
  let engine: LedgerEngineService;
  let tx: TenantTx;
  let seq = 0;
  const author = randomUUID();
  const approver = randomUUID();

  beforeAll(async () => {
    fx = await createMiniFixture();
    app = await createTestApp({
      imports: [
        LedgerModule.register({
          provide: CONFIG_RESOLVER,
          useValue: inMemoryConfigResolver(() => fx.config),
        }),
      ],
    });
    await withOwner(async (db) => {
      for (const [id, name] of [
        [author, 'auteur'],
        [approver, 'valideur'],
      ] as const) {
        await db.query(
          `INSERT INTO app_user (id, operator_id, issuer, subject, email, display_name)
           VALUES ($1, $2, 'https://idp.test', $5, $3, $4)`,
          [id, fx.operatorId, `${name}-${id}@test`, name, `s-${id}`],
        );
      }
    });
    engine = app.get(LedgerEngineService);
    tx = app.get(TenantTx);
    await run(
      command(
        'TOPUP',
        'wave:seed-refund',
        { walletId: fx.wallet1, channel: 'WAVE', amount: 50_000n },
        'PSP_WEBHOOK',
      ),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  function command<P>(
    type: LedgerCommand['type'],
    key: string,
    payload: P,
    source: LedgerCommand['source'] = 'BACKOFFICE',
  ): LedgerCommand {
    return {
      type,
      idempotencyKey: key,
      occurredAt: new Date(),
      source,
      ...(source === 'BACKOFFICE' ? { createdBy: author, approvedBy: approver } : {}),
      ledgerId: fx.ledgerId,
      eventId: fx.eventId,
      currency: 'XOF',
      payload,
    };
  }

  const run = (cmd: LedgerCommand): Promise<EngineResult> =>
    tx.run(fx.operatorId, (client) => engine.execute(client, cmd));

  const caught = (cmd: LedgerCommand): Promise<unknown> =>
    run(cmd).then(
      () => undefined,
      (error: unknown) => error,
    );

  const problem = async (cmd: LedgerCommand): Promise<{ code: string; status: number }> => {
    const error = await caught(cmd);
    expect(error).toBeInstanceOf(ProblemException);
    return { code: (error as ProblemException).code, status: (error as ProblemException).status };
  };

  const refund = (key: string, source: LedgerCommand['source'] = 'BACKOFFICE'): LedgerCommand =>
    command(
      'WALLET_REFUND',
      key,
      { walletId: fx.wallet1, amount: 700n, moneyAccount: 'A-PSP-WAVE' },
      source,
    );

  const reversal = (
    reversesId: string,
    key: string,
    source: LedgerCommand['source'] = 'BACKOFFICE',
  ): LedgerCommand => ({ ...command('REVERSAL', key, {}, source), reversesId });

  const setStates = (event: string, ledger: string, lateClaims: 'future' | 'past' | null = null) =>
    withOwner(async (db) => {
      // Amorçage seulement (propriétaire) : le garde `guard_event_status` n'ouvre que sous ce marqueur.
      await db.query(`SELECT set_config('app.event_status_change', 'on', false)`);
      await db.query('UPDATE event SET status = $2 WHERE id = $1', [fx.eventId, event]);
      await db.query(`SELECT set_config('app.event_status_change', 'off', false)`);
      await db.query(
        `UPDATE ledger SET status = $2,
                late_claims_until = CASE $3::text WHEN 'future' THEN clock_timestamp() + interval '1 hour'
                                                  WHEN 'past' THEN clock_timestamp() - interval '1 hour' END
          WHERE id = $1`,
        [fx.ledgerId, ledger, lateClaims],
      );
    });

  const walletPaid = () =>
    withOwner(async (db) => {
      const { rows } = await db.query<{ b: string }>(
        `SELECT coalesce(sum(p.amount), 0)::text AS b FROM posting p JOIN account a ON a.id = p.account_id
          WHERE a.ledger_id = $1 AND a.code = 'L-WAL-W1-P'`,
        [fx.ledgerId],
      );
      return BigInt(rows[0]!.b);
    });

  const sum = (transactionId: string) =>
    withOwner(async (db) => {
      const { rows } = await db.query<{ s: string; n: number }>(
        'SELECT coalesce(sum(amount), 0)::text AS s, count(*)::int AS n FROM posting WHERE transaction_id = $1',
        [transactionId],
      );
      return { sum: BigInt(rows[0]!.s), lines: rows[0]!.n };
    });

  const sqlCode = (error: unknown): string | undefined => (error as { code?: string }).code;

  afterEach(() => setStates('LIVE', 'OPEN'));

  it.each([
    ['SETTLING', 'OPEN'],
    ['REFUND_WINDOW', 'OPEN'],
    ['CLOSED', 'CLOSING'],
    ['CLOSING', 'OPEN'],
  ] as const)(
    'accepté, événement %s (grand livre %s) : solde recrédité, transaction équilibrée',
    async (event, ledger) => {
      await setStates(event, ledger);
      const before = await walletPaid();
      const refunded = await run(refund(`bo:refund-${event}-${++seq}`));
      expect(await walletPaid()).toBe(before + 700n);
      const back = await run(reversal(refunded.transactionId!, `bo:reversal-${event}-${++seq}`));
      expect(back.replayed).toBe(false);
      expect(await walletPaid()).toBe(before);
      expect(await sum(back.transactionId!)).toEqual({ sum: 0n, lines: expect.any(Number) });
    },
  );

  it('refusé : REVERSAL d’un PURCHASE, événement SETTLING (VALIDATION_FAILED)', async () => {
    const sale = await run(
      command(
        'PURCHASE',
        `TPE-FOOD:rv-${++seq}`,
        { walletId: fx.wallet1, participationId: fx.participationId, amount: 1_000n },
        'ONLINE',
      ),
    );
    await setStates('SETTLING', 'OPEN');
    expect(await problem(reversal(sale.transactionId!, `bo:reversal-purchase-${++seq}`))).toEqual({
      code: 'VALIDATION_FAILED',
      status: 422,
    });
  });

  it('refusé : source autre que BACKOFFICE pour le REVERSAL du WALLET_REFUND, en SETTLING', async () => {
    const refunded = await run(refund(`bo:refund-src-${++seq}`));
    await setStates('SETTLING', 'OPEN');
    for (const source of ['ONLINE', 'OFFLINE_SYNC', 'EDGE_SYNC', 'PSP_WEBHOOK', 'BATCH'] as const) {
      expect(
        await problem(
          reversal(refunded.transactionId!, `bo:reversal-src-${source}-${++seq}`, source),
        ),
      ).toEqual({ code: 'VALIDATION_FAILED', status: 422 });
    }
  });

  it('refusé : événement DRAFT', async () => {
    const refunded = await run(refund(`bo:refund-draft-${++seq}`));
    await setStates('DRAFT', 'OPEN');
    expect(await problem(reversal(refunded.transactionId!, `bo:reversal-draft-${++seq}`))).toEqual({
      code: 'VALIDATION_FAILED',
      status: 422,
    });
  });

  it('transaction contre-passée introuvable : refusé (jamais un contournement)', async () => {
    await setStates('SETTLING', 'OPEN');
    const error = await caught(
      reversal('00000000-0000-4000-8000-000000000001', `bo:reversal-none-${++seq}`),
    );
    expect(error).toBeInstanceOf(ProblemException);
  });

  it('seconde contre-passation du même WALLET_REFUND, autre clé : refusée par l’index existant', async () => {
    const refunded = await run(refund(`bo:refund-twice-${++seq}`));
    await setStates('SETTLING', 'OPEN');
    const first = await run(reversal(refunded.transactionId!, 'bo:reversal-twice-a'));
    const before = await walletPaid();
    const error = await caught(reversal(refunded.transactionId!, 'bo:reversal-twice-b'));
    expect(sqlCode(error)).toBe('23505');
    expect((error as Error).message).toContain('journal_transaction_reverses_once');
    expect(await walletPaid()).toBe(before);
    // même clé : rejeu, même transaction
    const replay = await run(reversal(refunded.transactionId!, 'bo:reversal-twice-a'));
    expect(replay).toEqual({ transactionId: first.transactionId, replayed: true });
  });

  it('WALLET_REFUND en grand livre LOCKED : accepté en BACKOFFICE avant late_claims_until, refusé sinon', async () => {
    await setStates('CLOSED', 'LOCKED', 'future');
    const accepted = await run(refund(`bo:refund-locked-${++seq}`));
    expect(accepted.transactionId).toEqual(expect.any(String));
    await setStates('CLOSED', 'LOCKED', 'past');
    expect(sqlCode(await caught(refund(`bo:refund-locked-late-${++seq}`)))).toBe('CL003');
    await setStates('CLOSED', 'LOCKED', 'future');
    expect(await problem(refund(`bo:refund-locked-online-${++seq}`, 'ONLINE'))).toEqual({
      code: 'VALIDATION_FAILED',
      status: 422,
    });
  });

  it('REVERSAL d’un WALLET_REFUND en grand livre LOCKED : refus de la base (CL003), comme avant', async () => {
    await setStates('CLOSED', 'LOCKED', 'future');
    const refunded = await run(refund(`bo:refund-locked-rev-${++seq}`));
    const before = await walletPaid();
    expect(
      sqlCode(await caught(reversal(refunded.transactionId!, `bo:reversal-locked-${++seq}`))),
    ).toBe('CL003');
    expect(await walletPaid()).toBe(before);
  });
});
