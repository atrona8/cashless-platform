// Intégration : découpage d'une recharge en espèces (hors ligne seulement) et anomalie CASH_TOPUP_OVER_LIMIT
// ouverte dans la même transaction (WP06, FR-005, FR-006). Caisse non inscrite : la garde de caisse (WP02) ne
// s'applique pas (limite A17, mission 7).
import { randomInt, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { TenantTx } from '../../../src/db/tenant-tx';
import { LedgerEngineService, type EngineResult } from '../../../src/ledger/ledger-engine.service';
import { CONFIG_RESOLVER, LedgerModule } from '../../../src/ledger/ledger.module';
import type { LedgerCommand } from '../../../src/ledger/types';
import { createTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { createMiniFixture, inMemoryConfigResolver, type MiniFixture } from './mini-fixture';

describe('recharge en espèces : découpage hors ligne et anomalie', () => {
  let app: INestApplication;
  let fx: MiniFixture;
  let engine: LedgerEngineService;
  let tx: TenantTx;
  let seq = 0;

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
    engine = app.get(LedgerEngineService);
    tx = app.get(TenantTx);
    // Départ : W1 à 8 000 (avant la pose du plafond), puis plafond 10 000 / mensuel 100 000.
    await run(
      command(
        'TOPUP',
        'wave:seed-split',
        { walletId: fx.wallet1, channel: 'WAVE', amount: 8_000n },
        'PSP_WEBHOOK',
      ),
    );
    await withOwner(async (db) => {
      // Un profil de législation est immuable : on en crée un propre à la fixture, avec plafonds.
      const profileId = randomUUID();
      await db.query(
        `INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination,
                                           unidentified_max_balance, unidentified_monthly_limit)
         VALUES ($1, 'SN', $2, '2026-01-01', 'ORGANIZER', 10000, 100000)`,
        [profileId, randomInt(1_000_000, 2_000_000_000)],
      );
      await db.query('UPDATE event SET jurisdiction_id = $1 WHERE id = $2', [
        profileId,
        fx.eventId,
      ]);
      // EXECUTE de open_cash_due_anomaly pour cashless_app est accordé par WP05 (droits de la base), pas
      // encore présent dans cette lane : substitut limité à la base de test, retiré à chaque reset-db.
      await db.query(
        'GRANT EXECUTE ON FUNCTION open_cash_due_anomaly(uuid, uuid, bigint, uuid) TO cashless_app',
      );
      await db.query(
        `INSERT INTO account (operator_id, ledger_id, code, family, purpose, wallet_id, normal_side)
         VALUES ($1, $2, 'L-ESP-A-RENDRE-W1', 'CLAIM', 'CUSTOMER_CASH_DUE', $3, 'C')`,
        [fx.operatorId, fx.ledgerId, fx.wallet1],
      );
    });
  });

  afterAll(async () => {
    await app.close();
  });

  function command<P>(
    type: LedgerCommand['type'],
    key: string,
    payload: P,
    source: LedgerCommand['source'] = 'ONLINE',
    mediaId?: string,
  ): LedgerCommand {
    return {
      type,
      idempotencyKey: key,
      occurredAt: new Date(),
      source,
      ledgerId: fx.ledgerId,
      eventId: fx.eventId,
      currency: 'XOF',
      payload,
      ...(mediaId ? { mediaId } : {}),
    };
  }

  const run = (cmd: LedgerCommand): Promise<EngineResult> =>
    tx.run(fx.operatorId, (client) => engine.execute(client, cmd));

  const topup = (
    key: string,
    walletId: string,
    amount: bigint,
    source: LedgerCommand['source'],
    mediaId?: string,
    extra: Record<string, unknown> = {},
  ) => command('TOPUP_CASH', key, { walletId, cashDesk: 'C1', amount, ...extra }, source, mediaId);

  const rejection = async (cmd: LedgerCommand): Promise<{ code?: string; sqlstate?: string }> => {
    const error = (await run(cmd).then(
      () => undefined,
      (e: unknown) => e,
    )) as { code?: string; sqlstate?: string; cause?: { code?: string } } | undefined;
    expect(error).toBeDefined();
    return { code: error!.code, sqlstate: error!.sqlstate ?? error!.cause?.code };
  };

  const countOf = (table: 'journal_transaction' | 'anomaly', key?: string) =>
    withOwner(async (db) => {
      const { rows } =
        table === 'anomaly'
          ? await db.query<{ n: number }>(
              `SELECT count(*)::int AS n FROM anomaly WHERE ledger_id = $1 AND kind = 'CASH_TOPUP_OVER_LIMIT'
                 AND ($2::text IS NULL OR transaction_id = (SELECT id FROM journal_transaction
                       WHERE ledger_id = $1 AND idempotency_key = $2))`,
              [fx.ledgerId, key ?? null],
            )
          : await db.query<{ n: number }>(
              `SELECT count(*)::int AS n FROM journal_transaction
                WHERE ledger_id = $1 AND idempotency_key = $2`,
              [fx.ledgerId, key],
            );
      return rows[0]!.n;
    });

  const balance = (code: string) =>
    withOwner(async (db) => {
      const { rows } = await db.query<{ b: string }>(
        `SELECT coalesce(sum(p.amount), 0)::text AS b FROM posting p JOIN account a ON a.id = p.account_id
          WHERE a.ledger_id = $1 AND a.code = $2`,
        [fx.ledgerId, code],
      );
      return BigInt(rows[0]!.b);
    });

  const anomalyOf = (transactionId: string) =>
    withOwner(async (db) => {
      const { rows } = await db.query<{
        amount: string;
        status: string;
        media_id: string;
        transaction_id: string;
      }>(
        `SELECT amount::text, status, media_id, transaction_id FROM anomaly
          WHERE transaction_id = $1 AND kind = 'CASH_TOPUP_OVER_LIMIT'`,
        [transactionId],
      );
      return rows;
    });

  // Chaque cas de découpage utilise un portefeuille à 8 000 : on lit le solde courant plutôt que de le supposer.
  const wallet1Balance = async () => -(await balance('L-WAL-W1-P'));

  it('en ligne, au-delà du plafond : CL008, rien d’écrit', async () => {
    const key = `espece:online:${++seq}`;
    const amount = 10_000n - (await wallet1Balance()) + 1n;
    const rejected = await rejection(topup(key, fx.wallet1, amount, 'ONLINE', fx.mediaId));
    expect(rejected.code).toBe('CL008');
    expect(await countOf('journal_transaction', key)).toBe(0);
    expect(await countOf('anomaly')).toBe(0);
  });

  it('en ligne avec headroom forgé dans la charge : ignoré, même rejet', async () => {
    const key = `espece:forged:${++seq}`;
    const amount = 10_000n - (await wallet1Balance()) + 1n;
    const rejected = await rejection(
      topup(key, fx.wallet1, amount, 'ONLINE', fx.mediaId, { headroom: 1n }),
    );
    expect(rejected.code).toBe('CL008');
    expect(await countOf('journal_transaction', key)).toBe(0);
    expect(await countOf('anomaly')).toBe(0);
  });

  for (const source of ['OFFLINE_SYNC', 'EDGE_SYNC'] as const) {
    it(`${source} : découpage, espèces dues et une anomalie ouverte`, async () => {
      const key = `espece:${source}:${++seq}`;
      const paidBefore = await wallet1Balance();
      const dueBefore = await balance('L-ESP-A-RENDRE-W1');
      const margin = 10_000n - paidBefore; // marge exacte avant plafond
      const amount = margin + 4_000n;
      const result = await run(topup(key, fx.wallet1, amount, source, fx.mediaId));
      expect(result.replayed).toBe(false);
      expect((await wallet1Balance()) - paidBefore).toBe(margin);
      expect((await balance('L-ESP-A-RENDRE-W1')) - dueBefore).toBe(-4_000n);
      const anomalies = await anomalyOf(result.transactionId!);
      expect(anomalies).toHaveLength(1);
      expect(anomalies[0]).toMatchObject({
        amount: '4000',
        status: 'OPEN',
        media_id: fx.mediaId,
        transaction_id: result.transactionId,
      });
    });
  }

  it('OFFLINE_SYNC sans mediaId : 422 VALIDATION_FAILED, rien d’écrit', async () => {
    const key = `espece:nomedia:${++seq}`;
    const amount = 10_000n - (await wallet1Balance()) + 500n;
    const before = await countOf('anomaly');
    const rejected = await rejection(topup(key, fx.wallet1, amount, 'OFFLINE_SYNC'));
    expect(rejected.code).toBe('VALIDATION_FAILED');
    expect(await countOf('journal_transaction', key)).toBe(0);
    expect(await countOf('anomaly')).toBe(before);
  });

  it('rejeu de la même clé : même transaction, une seule anomalie', async () => {
    const key = `espece:replay:${++seq}`;
    const amount = 10_000n - (await wallet1Balance()) + 700n;
    const first = await run(topup(key, fx.wallet1, amount, 'OFFLINE_SYNC', fx.mediaId));
    const second = await run(topup(key, fx.wallet1, amount, 'OFFLINE_SYNC', fx.mediaId));
    expect(second).toEqual({ transactionId: first.transactionId, replayed: true });
    expect(await anomalyOf(first.transactionId!)).toHaveLength(1);
  });

  it('sous le plafond hors ligne : ni espèces dues ni anomalie', async () => {
    // Plafond mensuel et de solde : on libère de la place sur W2 (vide), recharge de 1 000.
    const key = `espece:under:${++seq}`;
    const dueBefore = await balance('L-ESP-A-RENDRE-W1');
    const result = await run(topup(key, fx.wallet2, 1_000n, 'OFFLINE_SYNC', fx.mediaId));
    expect(await anomalyOf(result.transactionId!)).toHaveLength(0);
    expect(await balance('L-ESP-A-RENDRE-W1')).toBe(dueBefore);
  });

  it('échec de l’anomalie : toute la transaction est annulée', async () => {
    // Support non attribué : post_transaction l'accepte, open_cash_due_anomaly le refuse (CL001).
    const orphan = randomUUID();
    await withOwner(async (db) => {
      await db.query(
        `INSERT INTO media (id, operator_id, kind, token_hash, batch_id, status)
         SELECT $1::uuid, operator_id, 'NFC_TAG', decode(md5($1::uuid::text) || md5($1::uuid::text), 'hex'), batch_id, 'PERSONALIZED'
           FROM media WHERE id = $2::uuid`,
        [orphan, fx.mediaId],
      );
    });
    const key = `espece:atomic:${++seq}`;
    const amount = 10_000n - (await wallet1Balance()) + 900n;
    const rejected = await rejection(topup(key, fx.wallet1, amount, 'OFFLINE_SYNC', orphan));
    expect(rejected.code).toBe('CL001');
    expect(await countOf('journal_transaction', key)).toBe(0);
  });
});
