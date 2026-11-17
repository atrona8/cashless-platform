// Intégration : compte d'argent de sortie et frais du remboursement tardif (mission 9b, lot WP10,
// T043 et T046 ; FR-016). `moneyAccountFor` étendu (virement, espèces), remboursement tardif SANS
// frais (arbitrage à faire confirmer par le porteur : la base n'admet sur un grand livre `LOCKED`
// que « portefeuille débité, compte d'argent crédité »).
import { randomUUID } from 'node:crypto';
import { buildWalletRefund, moneyAccountFor } from '../../../src/ledger/builders/festival/refund';
import { BuildError, type LedgerCommand } from '../../../src/ledger/types';
import { withOwner } from '../../support/db';
import { ownerRows } from '../../support/media-fixtures';
import { scenarioConfig } from '../../unit/builders/support/scenario-lines';
import { FUNDS, LateWorld } from './late-claim-fixtures';

jest.setTimeout(180_000);

describe('moneyAccountFor (T043)', () => {
  it('chaque branche : canaux PSP, virement, espèces (compte fourni), refus des autres', () => {
    expect(moneyAccountFor('WAVE')).toBe('A-PSP-WAVE');
    expect(moneyAccountFor('ORANGE_MONEY')).toBe('A-PSP-OM');
    expect(moneyAccountFor('BANK_TRANSFER')).toBe('A-BANQUE');
    expect(moneyAccountFor('CASH', 'A-CAISSE-C1')).toBe('A-CAISSE-C1');
    // Un compte de caisse est ignoré pour les autres moyens.
    expect(moneyAccountFor('WAVE', 'A-CAISSE-C1')).toBe('A-PSP-WAVE');
    for (const [method, cash] of [
      ['CASH', undefined],
      ['CASH', ''],
      ['CARD', undefined],
      ['wave', undefined],
      ['', undefined],
    ] as const)
      expect(() => moneyAccountFor(method, cash)).toThrow(BuildError);
  });
});

describe('buildWalletRefund sans frais (T043)', () => {
  const config = scenarioConfig();
  const command = (source: LedgerCommand['source'], waiveFee?: boolean) =>
    ({
      type: 'WALLET_REFUND',
      idempotencyKey: 'bo:x',
      occurredAt: new Date(),
      source,
      ledgerId: 'L',
      currency: 'XOF',
      payload: { walletId: 'W1', amount: 10_000n, moneyAccount: 'A-BANQUE', waiveFee },
    }) as LedgerCommand<'WALLET_REFUND', never>;

  it('par défaut : lignes de frais (règle de remboursement) ; waiveFee : deux lignes, aucun frais', () => {
    const withFees = buildWalletRefund(command('BACKOFFICE'), { config });
    expect(withFees.length).toBeGreaterThan(2);
    const free = buildWalletRefund(command('BACKOFFICE', true), { config });
    expect(free).toHaveLength(2);
    expect(free.map((line) => line.amount)).toEqual([10_000n, -10_000n]);
    expect(free.every((line) => line.feeRuleId === undefined)).toBe(true);
  });

  it('waiveFee hors back-office : refusé (VALIDATION_FAILED)', () => {
    for (const source of ['ONLINE', 'PSP_WEBHOOK', 'BATCH', 'OFFLINE_SYNC', 'EDGE_SYNC'] as const)
      expect(() => buildWalletRefund(command(source, true), { config })).toThrow(BuildError);
  });
});

describe('remboursement tardif : frais, espèces (T046)', () => {
  let lw: LateWorld;
  beforeAll(async () => {
    lw = await LateWorld.create();
  }, 240_000);
  afterEach(async () => {
    await lw.reset();
  });
  afterAll(async () => {
    await lw.close();
  });

  /**
   * Écriture directe `WALLET_REFUND` BACKOFFICE sur le grand livre `LOCKED`, avec ou sans ligne de
   * frais.
   */
  const refundByOwner = (walletId: string, fee: number) =>
    withOwner(async (db) => {
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [lw.operatorId]);
      const id = async (sql: string, ...params: unknown[]) =>
        (await db.query<{ id: string }>(sql, params)).rows[0]!.id;
      const wallet = await id(
        `SELECT id FROM account WHERE wallet_id = $1 AND purpose = 'WALLET_PAID'`,
        walletId,
      );
      const money = await id(
        `SELECT id FROM account WHERE ledger_id = $1 AND code = 'A-PSP-WAVE'`,
        lw.ledgerId,
      );
      const feeAccount = await id(
        `SELECT id FROM account WHERE ledger_id = $1 AND purpose = 'ORG_FFEST'`,
        lw.ledgerId,
      );
      const lines = [
        { account_id: wallet, amount: 1000 },
        { account_id: money, amount: -(1000 - fee) },
        ...(fee > 0 ? [{ account_id: feeAccount, amount: -fee }] : []),
      ];
      return db.query(
        `SELECT post_transaction($1, 'WALLET_REFUND', $2, clock_timestamp(), 'BACKOFFICE', $3::jsonb,
                                 NULL, NULL, $4, $5)`,
        [
          lw.ledgerId,
          `test-fee:${randomUUID()}`,
          JSON.stringify(lines),
          lw.author().userId,
          lw.validator().userId,
        ],
      );
    });

  it('la base refuse sur LOCKED un remboursement qui porte une ligne de frais (CL024), accepte celui sans frais', async () => {
    const { walletId } = await lw.brokenWallet();
    const funded = (await lw.pw.wallet({ funds: 5_000 })).walletId;
    await lw.lock();
    await expect(refundByOwner(funded, 100)).rejects.toMatchObject({ code: 'CL024' });
    await expect(refundByOwner(funded, 0)).resolves.toBeDefined();
    expect(walletId).toBeDefined();
  });

  /** Compte et session de caisse `OPEN` ouverte par `userId`. */
  async function openSession(userId: string, code: string): Promise<void> {
    await withOwner(async (db) => {
      await db.query(
        `INSERT INTO account (operator_id, ledger_id, code, family, purpose, owner_party_id, normal_side, allow_negative)
         VALUES ($1, $2, $3, 'ASSET', 'CASH_DESK', $4, 'D', false)`,
        [lw.operatorId, lw.ledgerId, code, lw.organizerId],
      );
      const device = await db.query<{ id: string }>(
        `INSERT INTO device (operator_id, kind, app_mode, serial) VALUES ($1, 'TOPUP', 'TOPUP_DESK', $2)
         RETURNING id`,
        [lw.operatorId, `late-cash-${randomUUID()}`],
      );
      await db.query(
        `INSERT INTO cash_session (operator_id, ledger_id, event_id, device_id, cash_account_id, opened_by)
         SELECT $1, $2, $3, $4, a.id, $5 FROM account a WHERE a.ledger_id = $2 AND a.code = $6`,
        [lw.operatorId, lw.ledgerId, lw.eventId, device.rows[0]!.id, userId, code],
      );
    });
  }

  const cashBody = (walletId: string) =>
    lw.claimBody(walletId, { destination: { method: 'CASH' } });

  it('CASH sans session de caisse ouverte par l’auteur : 422 REFUND_NOT_ALLOWED, rien d’écrit ; la caisse d’un autre n’est jamais utilisée', async () => {
    const { walletId } = await lw.brokenWallet();
    await lw.lock();
    const writes = await lw.lateWrites();
    const requests = (await lw.requests('LATE_CLAIM')).length;
    const none = await lw.claim(cashBody(walletId));
    expect([none.status, none.body.code]).toEqual([422, 'REFUND_NOT_ALLOWED']);
    // Une session ouverte par une AUTRE personne (le valideur) n'est pas celle de l'auteur.
    await openSession(lw.validator().userId, `A-CAISSE-OTHER-${randomUUID().slice(0, 6)}`);
    const other = await lw.claim(cashBody(walletId));
    expect([other.status, other.body.code]).toEqual([422, 'REFUND_NOT_ALLOWED']);
    expect(await lw.lateWrites()).toBe(writes);
    expect((await lw.requests('LATE_CLAIM')).length).toBe(requests);
  });

  it('CASH avec une session ouverte par l’auteur : remboursement vers son compte de caisse ; caisse insuffisante : FAILED, aucune des deux écritures', async () => {
    const { walletId } = await lw.brokenWallet();
    const second = await lw.brokenWallet(2_000);
    const code = `A-CAISSE-OWN-${randomUUID().slice(0, 6)}`;
    await openSession(lw.author().userId, code);
    // Espèces en caisse : exactement de quoi rembourser la première réclamation.
    await withOwner(async (db) => {
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [lw.operatorId]);
      await db.query(
        `SELECT post_transaction($1, 'ADJUSTMENT', $2, clock_timestamp(), 'BACKOFFICE', jsonb_build_array(
           jsonb_build_object('account_id', (SELECT id FROM account WHERE ledger_id = $1 AND code = $3), 'amount', $4::bigint),
           jsonb_build_object('account_id', (SELECT id FROM account WHERE ledger_id = $1 AND code = 'A-BANQUE'), 'amount', -$4::bigint)),
           NULL, NULL, $5, $6)`,
        [
          lw.ledgerId,
          `test-desk:${randomUUID()}`,
          code,
          FUNDS,
          lw.author().userId,
          lw.validator().userId,
        ],
      );
    });
    await lw.lock();
    const asked = await lw.claim(cashBody(walletId));
    expect(asked.status).toBe(202);
    const done = await lw.approve(asked.body.approval_request_id);
    expect([done.body.status, done.body.failure_code]).toEqual(['EXECUTED', null]);
    const refund = (done.body.result as { wallet_refund_transaction_id: string })
      .wallet_refund_transaction_id;
    expect(await lw.lines(refund)).toEqual({ WALLET_PAID: FUNDS, [code]: -FUNDS });

    // La caisse est vide : le remboursement échoue APRÈS l'annulation de casse, tout est annulé.
    const writes = await lw.lateWrites();
    const empty = await lw.claim(
      lw.claimBody(second.walletId, { amount: 2_000, destination: { method: 'CASH' } }),
    );
    expect(empty.status).toBe(202);
    const failed = await lw.approve(empty.body.approval_request_id);
    expect(failed.body).toMatchObject({ status: 'FAILED', failure_code: 'INSUFFICIENT_FUNDS' });
    expect(await lw.lateWrites()).toBe(writes);
    expect(await lw.walletPaid(second.walletId)).toBe(0n);
    expect(
      await ownerRows(
        `SELECT 1 FROM journal_transaction WHERE metadata->>'approval_request_id' = $1`,
        [empty.body.approval_request_id],
      ),
    ).toHaveLength(0);
  });

  it('BANK_TRANSFER : remboursement vers A-BANQUE ; IBAN absent du journal des écritures et de l’audit de la demande', async () => {
    const { walletId } = await lw.brokenWallet();
    await lw.lock();
    const asked = await lw.claim(
      lw.claimBody(walletId, {
        destination: { method: 'BANK_TRANSFER', iban: 'SN08SN0100152000048500003035' },
      }),
    );
    expect(asked.status).toBe(202);
    const done = await lw.approve(asked.body.approval_request_id);
    expect(done.body.status).toBe('EXECUTED');
    const refund = (done.body.result as { wallet_refund_transaction_id: string })
      .wallet_refund_transaction_id;
    expect(await lw.lines(refund)).toEqual({ WALLET_PAID: FUNDS, 'A-BANQUE': -FUNDS });
    const own = await ownerRows<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_log
        WHERE action = 'LATE_CLAIM_REQUESTED' AND object_id = $1
          AND (after::text LIKE '%SN08%' OR before::text LIKE '%SN08%')`,
      [walletId],
    );
    expect(own[0]!.n).toBe(0);
  });

  it('moyens WAVE et ORANGE_MONEY : comptes A-PSP-WAVE et A-PSP-OM', async () => {
    const a = await lw.brokenWallet(3_000);
    const b = await lw.brokenWallet(2_000);
    await lw.lock();
    const wave = await lw.claim(lw.claimBody(a.walletId, { amount: 3_000 }));
    const om = await lw.claim(
      lw.claimBody(b.walletId, {
        amount: 2_000,
        destination: { method: 'ORANGE_MONEY', msisdn: '+221770000003' },
      }),
    );
    const w = await lw.approve(wave.body.approval_request_id);
    const o = await lw.approve(om.body.approval_request_id);
    const refunds = [w, o].map(
      (r) =>
        (r.body.result as { wallet_refund_transaction_id: string }).wallet_refund_transaction_id,
    );
    expect(await lw.lines(refunds[0]!)).toEqual({ WALLET_PAID: 3_000, 'A-PSP-WAVE': -3_000 });
    expect(await lw.lines(refunds[1]!)).toEqual({ WALLET_PAID: 2_000, 'A-PSP-OM': -2_000 });
  });
});
