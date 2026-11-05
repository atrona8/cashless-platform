// Traitement des opérations d'un lot (mission 7, lot WP19 ; T077, T078, T080, T082) : registre et doublons, opérations
// sans effet, espèces rejetées, conformité (une raison par test), période, horloge, annulation, résultat écrit et rejeu.
// Route réelle `POST /offline-batches`, vrai processeur, base du lot. Chaque test d'argent compare des bigint exacts.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { contractViolations } from '../../support/contract-schema';
import { ownerRows } from '../../support/media-fixtures';
import { withOwner } from '../../support/db';
import { ProcessingWorld, type OfflineTerminal } from './processing-fixtures';
import { OFFLINE_OPERATION_PROCESSOR } from '../../../src/offline/batches/batch.types';
import type { OfflineOperationProcessor } from '../../../src/offline/batches/batch.types';
import type { PayMedia } from '../payments/payments-fixtures';

jest.setTimeout(240_000);

describe('traitement d’un lot : registre, conformité, écriture (WP19)', () => {
  let world: ProcessingWorld;
  beforeAll(async () => {
    world = await ProcessingWorld.create();
  });
  afterAll(async () => {
    await world?.close();
  });

  const setup = async (policy = {}, count = 1, funds = 20_000) => {
    const t = await world.terminal(policy);
    const media = await world.pw.media(count, funds);
    const version = await world.snapshot(t, media);
    return { t, media, version };
  };

  it('vente couverte : écrite OFFLINE_SYNC avec device_id, soldes exacts, registre, passage consommé, résultat conforme', async () => {
    const { t, media, version } = await setup();
    const m = media[0]!;
    const res = await world.submit(t, [world.sale(t, m, 4000, version)]);
    const [r] = world.results(res);
    expect(contractViolations('OfflineOperationResult', r)).toEqual([]);
    expect(r).toMatchObject({
      seq: 1,
      status: 'ACCEPTED',
      effect: 'LEDGER_WRITTEN',
      charged_to_wallet: 4000,
      tap_result: 'OK',
      retryable: false,
    });
    const txs = await world.txRows(t.t.deviceId);
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({
      type: 'PURCHASE',
      source: 'OFFLINE_SYNC',
      device_id: t.t.deviceId,
    });
    expect(txs[0]!.metadata).toMatchObject({
      vendor_session_id: t.sessionId,
      batch_id: res.batch.header.batch_id,
    });
    expect(await world.spendable(m.walletId)).toBe(16_000);
    expect((await world.postings(txs[0]!.id)).map((p) => [p.purpose, p.amount])).toEqual([
      ['WALLET_PAID', '4000'],
      ['MERCHANT', '-4000'],
    ]);
    const reg = await world.pw.registry(t.t.deviceId);
    expect(reg).toMatchObject([
      { seq: '1', outcome: 'ACCEPTED', channel: 'BATCH', transaction_id: txs[0]!.id },
    ]);
    const tap = await ownerRows<{ n: number }>(
      'SELECT count(*)::int AS n FROM media_tap WHERE device_id = $1 AND transaction_id = $2',
      [t.t.deviceId, txs[0]!.id],
    );
    expect(tap[0]!.n).toBe(1);
    const attr = await ownerRows<{ vendor_session_id: string }>(
      'SELECT vendor_session_id FROM sale_attribution WHERE transaction_id = $1',
      [txs[0]!.id],
    );
    expect(attr[0]!.vendor_session_id).toBe(t.sessionId);
    const stored = await ownerRows<{ result: Record<string, unknown> }>(
      'SELECT result FROM offline_op_result WHERE batch_id = $1',
      [res.batch.header.batch_id],
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]!.result).toMatchObject({ seq: 1, status: 'ACCEPTED' });
  });

  it('rejeu du lot : mêmes octets, aucune seconde écriture ; même numéro dans un nouveau lot : DUPLICATE', async () => {
    const { t, media, version } = await setup();
    const op = world.sale(t, media[0]!, 1000, version);
    const first = await world.submit(t, [op]);
    const again = await t.t.submitBatch(
      world.pw.api.baseUrl,
      world.pw.api.tls.serverCaPem,
      first.batch,
    );
    expect(again.status).toBe(200);
    expect(JSON.stringify(again.body.results)).toBe(JSON.stringify(first.body.results));
    // Nouveau lot (autre identifiant), mêmes numéros et mêmes octets d'opération.
    const second = await world.submit(t, [op], { fromSeq: 1 });
    const [r] = world.results(second);
    const [tx] = await world.txRows(t.t.deviceId);
    expect(r).toMatchObject({
      status: 'DUPLICATE',
      transaction_id: tx!.id,
      effect: 'LEDGER_WRITTEN',
    });
    expect(await world.txRows(t.t.deviceId)).toHaveLength(1);
    expect(await world.spendable(media[0]!.walletId)).toBe(19_000);
  });

  it('FR-036 : même numéro, autre contenu : IDEMPOTENCY_KEY_REUSED + IDEMPOTENCY_CONFLICT, une seule transaction, première ligne du registre', async () => {
    const { t, media, version } = await setup();
    const op = world.sale(t, media[0]!, 1000, version);
    await world.submit(t, [op]);
    const intruder = world.sale(t, media[0]!, 7000, version);
    const res = await world.submit(t, [intruder], { fromSeq: 1 });
    const [r] = world.results(res);
    expect(r).toMatchObject({
      status: 'REJECTED',
      reject_reason: 'IDEMPOTENCY_KEY_REUSED',
      effect: 'NONE',
    });
    expect(await world.txRows(t.t.deviceId)).toHaveLength(1);
    expect(await world.anomalies(t.t.deviceId, 'IDEMPOTENCY_CONFLICT')).toHaveLength(1);
    const reg = await world.pw.registry(t.t.deviceId);
    expect(reg).toHaveLength(1);
    expect(reg[0]!.outcome).toBe('ACCEPTED');
    expect(await world.spendable(media[0]!.walletId)).toBe(19_000);
  });

  it('vente déjà faite en ligne avec les mêmes octets : DUPLICATE, transaction d’origine, empreinte identique sur les deux canaux', async () => {
    const kp = await world.pw.terminal({ mode: 'KEYPAD_TPE' });
    const [m] = await world.pw.media(1);
    const body = world.pw.keypadBody(kp, { tap: world.pw.tap(m!) }, 2500);
    const paid = await world.pw.pay(kp, body);
    expect(paid.status).toBe(201);
    // Le même terminal envoie le même numéro dans un lot : champs chaînés identiques.
    const offline = { ...kp, configId: 0 } as OfflineTerminal;
    const op = {
      type: 'PURCHASE',
      occurred_at: body.occurred_at as string,
      amount: 2500,
      currency: 'XOF',
      tap: body.tap,
      online_status: 'CONFIRMED',
      online_transaction_id: paid.body.transaction_id,
    };
    const res = await world.submit(offline, [op as never]);
    const [r] = world.results(res);
    expect(r).toMatchObject({
      status: 'DUPLICATE',
      transaction_id: paid.body.transaction_id,
      effect: 'LEDGER_WRITTEN',
    });
    expect(await world.pw.salesOf(kp.t.deviceId)).toBe(1);
  });

  it('VOID, ONLINE_REF non exécutée : ACCEPTED/NONE au registre (VOID) ; TOPUP_CASH de 50 000 rejeté sans mouvement, les autres passent', async () => {
    const { t, media, version } = await setup();
    const now = new Date().toISOString();
    const res = await world.submit(t, [
      world.sale(t, media[0]!, 1000, version),
      { type: 'TOPUP_CASH', occurred_at: now, amount: 50_000, currency: 'XOF' },
      { type: 'VOID', occurred_at: now, void_reason: 'ABORTED_BY_OPERATOR' },
      {
        type: 'ONLINE_REF',
        occurred_at: now,
        online_operation: 'activateMedia',
        online_status: 'UNKNOWN',
      },
    ]);
    const rs = world.results(res);
    expect(rs[0]).toMatchObject({ status: 'ACCEPTED' });
    expect(rs[1]).toMatchObject({
      status: 'REJECTED',
      reject_reason: 'OFFLINE_NOT_ALLOWED',
      effect: 'NONE',
      detail: 'TOPUP_CASH',
    });
    expect(rs[2]).toMatchObject({ status: 'ACCEPTED', effect: 'NONE' });
    expect(rs[3]).toMatchObject({ status: 'ACCEPTED', effect: 'NONE' });
    const reg = await world.pw.registry(t.t.deviceId);
    expect(reg.map((x) => [x.seq, x.outcome, x.reason])).toEqual([
      ['1', 'ACCEPTED', null],
      ['2', 'REJECTED', 'OFFLINE_NOT_ALLOWED'],
      ['3', 'VOID', null],
      ['4', 'VOID', 'ONLINE_NOT_EXECUTED'],
    ]);
    const txs = await world.txRows(t.t.deviceId);
    expect(txs.map((x) => x.type)).toEqual(['PURCHASE']);
    const cash = await ownerRows<{ n: number }>(
      `SELECT count(*)::int AS n FROM journal_transaction WHERE ledger_id = $1 AND type = 'TOPUP_CASH' AND device_id = $2`,
      [world.ledgerId, t.t.deviceId],
    );
    expect(cash[0]!.n).toBe(0);
    const an = await world.anomalies(t.t.deviceId, 'NON_COMPLIANT_OPERATION');
    expect(an).toMatchObject([{ amount: '50000', loss_bearer: 'OPERATOR', seq: '2' }]);
  });

  describe('conformité : une raison de rejet par test, rien d’écrit', () => {
    const rejected = async (
      build: (a: { t: OfflineTerminal; m: PayMedia; version: number }) => Record<string, unknown>,
      options: { policy?: object; snapshot?: Parameters<ProcessingWorld['snapshot']>[2] } = {},
    ) => {
      const t = await world.terminal(options.policy);
      const media = await world.pw.media(1);
      const version = await world.snapshot(t, media, options.snapshot);
      const op = build({ t, m: media[0]!, version }) as never;
      const res = await world.submit(t, [op]);
      const [r] = world.results(res);
      expect(await world.txRows(t.t.deviceId)).toHaveLength(0);
      expect(await world.spendable(media[0]!.walletId)).toBe(20_000);
      const an = await world.anomalies(t.t.deviceId, 'NON_COMPLIANT_OPERATION');
      expect(an).toHaveLength(1);
      expect(an[0]).toMatchObject({ amount: '3000', loss_bearer: 'OPERATOR' });
      const reg = await world.pw.registry(t.t.deviceId);
      expect(reg).toMatchObject([{ outcome: 'REJECTED', reason: r!.reject_reason }]);
      return r!;
    };
    const sale = (a: { t: OfflineTerminal; m: PayMedia; version: number }, o = {}) =>
      world.sale(a.t, a.m, 3000, a.version, o);

    it('CURRENCY_MISMATCH', async () => {
      const r = await rejected((a) => sale(a, { currency: 'EUR' }));
      expect(r.reject_reason).toBe('CURRENCY_MISMATCH');
    });
    it('OFFLINE_NOT_ALLOWED : session de vendeur absente (détail VENDOR_SESSION)', async () => {
      const r = await rejected((a) => sale(a, { vendor_session_id: randomUUID() }));
      expect(r).toMatchObject({ reject_reason: 'OFFLINE_NOT_ALLOWED', detail: 'VENDOR_SESSION' });
    });
    it('OFFLINE_NOT_ALLOWED : hors ligne désactivé dans la configuration détenue', async () => {
      const r = await rejected((a) => sale(a), { policy: { offline_enabled: false } });
      expect(r.reject_reason).toBe('OFFLINE_NOT_ALLOWED');
    });
    it('POLICY_LIMIT_EXCEEDED : au-dessus de max_per_sale', async () => {
      const r = await rejected((a) => sale(a), { policy: { max_per_sale: 2999 } });
      expect(r.reject_reason).toBe('POLICY_LIMIT_EXCEEDED');
    });
    it('configuration inconnue : refusée (WP17 range OFFLINE_DISABLED en premier ; POLICY_LIMIT_EXCEEDED dans le détail)', async () => {
      const r = await rejected((a) => sale(a, { config_id: 987_654_321 }));
      expect(r.reject_reason).toBe('OFFLINE_NOT_ALLOWED');
      expect(String(r.detail).split(',')).toContain('POLICY_LIMIT_EXCEEDED');
    });
    it('SNAPSHOT_VERSION_UNKNOWN', async () => {
      const r = await rejected((a) => sale(a, { snapshot_version: 999_999_999 }));
      expect(r.reject_reason).toBe('SNAPSHOT_VERSION_UNKNOWN');
    });
    it('SNAPSHOT_TOO_OLD', async () => {
      const r = await rejected((a) => sale(a), { snapshot: { generatedAgo: 7200 } });
      expect(r.reject_reason).toBe('SNAPSHOT_TOO_OLD');
    });
    it('MEDIA_NOT_IN_SNAPSHOT', async () => {
      const r = await rejected((a) => sale(a), {
        snapshot: { log: () => ({ in_snapshot: false }) },
      });
      expect(r.reject_reason).toBe('MEDIA_NOT_IN_SNAPSHOT');
    });
    it('MEDIA_BLOCKED_IN_SNAPSHOT', async () => {
      const r = await rejected((a) => sale(a), {
        snapshot: { log: () => ({ media_status: 'SUSPENDED' }) },
      });
      expect(r.reject_reason).toBe('MEDIA_BLOCKED_IN_SNAPSHOT');
    });
    it('MEDIA_WRONG_EVENT', async () => {
      const r = await rejected((a) => sale(a), {
        snapshot: { log: () => ({ batch_event_id: randomUUID() }) },
      });
      expect(r.reject_reason).toBe('MEDIA_WRONG_EVENT');
    });
    it('PACK_NOT_VERIFIED : jamais cru, pas une erreur de forme', async () => {
      const r = await rejected((a) => {
        const op = sale(a) as unknown as { tap: Record<string, unknown> };
        return { ...op, tap: { ...op.tap, pack_verified: false } };
      });
      expect(r.reject_reason).toBe('PACK_NOT_VERIFIED');
    });
  });

  it('REVERSAL_TARGET_NOT_FOUND / ALREADY_REVERSED ; annulation valide : soldes revenus ; rejeu DUPLICATE ; vente d’un autre terminal : rien d’écrit', async () => {
    const { t, media, version } = await setup();
    const other = await setup();
    const m = media[0]!;
    const buy = world.sale(t, m, 5000, version);
    const otherBuy = world.sale(other.t, other.media[0]!, 2000, other.version);
    await world.submit(other.t, [otherBuy]);
    const [otherTx] = await world.txRows(other.t.t.deviceId);
    const reversal = (extra: Record<string, unknown>) => {
      const s = world.sale(t, m, 5000, version, extra);
      const { amount: _a, ...rest } = s;
      return { ...rest, type: 'REVERSAL' };
    };
    const res = await world.submit(t, [
      buy,
      reversal({ reverses_seq: 1 }),
      reversal({ reverses_seq: 1 }),
      reversal({ reverses_seq: 77 }),
      reversal({ reverses_transaction_id: otherTx!.id }),
    ] as never);
    const rs = world.results(res);
    expect(rs[0]).toMatchObject({ status: 'ACCEPTED' });
    expect(rs[1]).toMatchObject({ status: 'ACCEPTED', effect: 'LEDGER_WRITTEN' });
    expect(rs[2]).toMatchObject({ status: 'REJECTED', reject_reason: 'ALREADY_REVERSED' });
    expect(rs[3]).toMatchObject({ status: 'REJECTED', reject_reason: 'REVERSAL_TARGET_NOT_FOUND' });
    expect(rs[4]).toMatchObject({ status: 'REJECTED', reject_reason: 'REVERSAL_TARGET_NOT_FOUND' });
    expect(await world.spendable(m.walletId)).toBe(20_000);
    const txs = await world.txRows(t.t.deviceId);
    expect(txs.map((x) => x.type)).toEqual(['PURCHASE', 'REVERSAL']);
    // La vente d'un autre terminal reste intacte.
    expect(await world.spendable(other.media[0]!.walletId)).toBe(18_000);
    expect(await world.txRows(other.t.t.deviceId)).toHaveLength(1);
  });

  it('vente avec manque puis annulation hors ligne : anomalie réduite à 0, soldes revenus ; annulation rejouée : DUPLICATE', async () => {
    const { t, media, version } = await setup({}, 1, 6000);
    const m = media[0]!;
    const reversalOp = () => {
      const { amount: _a, ...rest } = world.sale(t, m, 9000, version, { reverses_seq: 1 });
      return { ...rest, type: 'REVERSAL' } as never;
    };
    const op2 = reversalOp();
    const op1 = world.sale(t, m, 9000, version);
    const res = await world.submit(t, [op1, op2]);
    const rs = world.results(res);
    expect(rs[0]).toMatchObject({ status: 'ACCEPTED_WITH_SHORTFALL', shortfall_amount: 3000 });
    expect(rs[1]).toMatchObject({ status: 'ACCEPTED', effect: 'LEDGER_WRITTEN' });
    const txs = await world.txRows(t.t.deviceId);
    expect(txs.map((x) => x.type)).toEqual(['PURCHASE', 'REVERSAL']);
    expect((await world.postings(txs[1]!.id)).map((p) => `${p.purpose}:${p.amount}`)).toEqual([
      'MERCHANT:9000',
      'SUSPENSE:-3000',
      'WALLET_PAID:-6000',
    ]);
    expect(await world.spendable(m.walletId)).toBe(6000);
    const [an] = await world.anomalies(t.t.deviceId, 'OFFLINE_SHORTFALL');
    expect(an).toMatchObject({ amount: '0', status: 'RESOLVED' });
    const again = await world.submit(t, [op1, op2], { fromSeq: 1 });
    expect(world.results(again).map((r) => r.status)).toEqual(['DUPLICATE', 'DUPLICATE']);
    expect(await world.txRows(t.t.deviceId)).toHaveLength(2);
  });

  it('annulation EN LIGNE d’une vente hors ligne avec manque : l’anomalie est réduite avec la vraie transaction d’annulation', async () => {
    const { t, media, version } = await setup({}, 1, 6000);
    const res = await world.submit(t, [world.sale(t, media[0]!, 9000, version)]);
    expect(world.results(res)[0]).toMatchObject({ shortfall_amount: 3000 });
    const [sale] = await world.txRows(t.t.deviceId);
    t.t.nextSeq = 2;
    const online = await t.t.request(
      world.pw.api.baseUrl,
      world.pw.api.tls.serverCaPem,
      {
        method: 'POST',
        path: `/payments/${sale!.id}/reversal`,
        body: {
          reason: 'INPUT_ERROR',
          comment: 'Erreur de saisie',
          occurred_at: new Date().toISOString(),
          vendor_session_id: t.sessionId,
        },
        idempotencyKey: t.t.seqKey(),
      },
      { headers: { 'x-authority-epoch': '0' } },
    );
    expect(online.status).toBe(201);
    const [an] = await ownerRows<{
      amount: string;
      status: string;
      resolution_tx_id: string | null;
    }>(
      `SELECT amount::text, status, resolution_tx_id FROM anomaly WHERE transaction_id = $1 AND kind = 'OFFLINE_SHORTFALL'`,
      [sale!.id],
    );
    expect(an).toEqual({
      amount: '0',
      status: 'RESOLVED',
      resolution_tx_id: online.body.transaction_id,
    });
    expect(await world.spendable(media[0]!.walletId)).toBe(6000);
  });

  it('période : date dans une période close → PERIOD_CLOSED + PERIOD_CLOSED_OPERATION, terminal non fautif', async () => {
    const { t, media, version } = await setup();
    await withOwner((db) =>
      db.query(`UPDATE ledger SET locked_until = now() + interval '1 hour' WHERE id = $1`, [
        world.ledgerId,
      ]),
    );
    try {
      const res = await world.submit(t, [world.sale(t, media[0]!, 1000, version)]);
      const [r] = world.results(res);
      expect(r).toMatchObject({ status: 'REJECTED', reject_reason: 'PERIOD_CLOSED' });
      expect(await world.anomalies(t.t.deviceId, 'PERIOD_CLOSED_OPERATION')).toHaveLength(1);
      expect(await world.txRows(t.t.deviceId)).toHaveLength(0);
    } finally {
      await withOwner((db) =>
        db.query('UPDATE ledger SET locked_until = NULL WHERE id = $1', [world.ledgerId]),
      );
    }
  });

  it('horloge : date dans le futur → heure corrigée = réception, CLOCK_SKEW, original dans metadata.device_occurred_at', async () => {
    const { t, media, version } = await setup();
    const op = world.sale(t, media[0]!, 1000, version, {}, -3600);
    const res = await world.submit(t, [op]);
    const [r] = world.results(res);
    expect(r).toMatchObject({ status: 'ACCEPTED' });
    const [tx] = await world.txRows(t.t.deviceId);
    expect(tx!.metadata.device_occurred_at).toBe(op.occurred_at);
    expect(await world.anomalies(t.t.deviceId, 'CLOCK_SKEW')).toHaveLength(1);
    const [row] = await ownerRows<{ delta: number }>(
      `SELECT abs(extract(epoch FROM (j.occurred_at - b.received_at)))::float AS delta
         FROM journal_transaction j JOIN offline_batch b ON b.id = $2 WHERE j.id = $1`,
      [tx!.id, res.batch.header.batch_id],
    );
    expect(row!.delta).toBeLessThan(1);
  });

  it('CONFIRMED introuvable : ONLINE_CONFIRMED_MISSING puis conformité complète ; une violation rejette quand même', async () => {
    const { t, media, version } = await setup({ max_per_sale: 1000 });
    const op = world.sale(t, media[0]!, 3000, version, {
      online_status: 'CONFIRMED',
      online_transaction_id: randomUUID(),
    });
    const res = await world.submit(t, [op]);
    const [r] = world.results(res);
    expect(r).toMatchObject({ status: 'REJECTED', reject_reason: 'POLICY_LIMIT_EXCEEDED' });
    expect(await world.anomalies(t.t.deviceId, 'ONLINE_CONFIRMED_MISSING')).toHaveLength(1);
    expect(await world.anomalies(t.t.deviceId, 'NON_COMPLIANT_OPERATION')).toHaveLength(1);
    expect(await world.txRows(t.t.deviceId)).toHaveLength(0);
  });

  it('exposition : 500 ventes datées réception + 119 s, plafond par terminal tenu (cumul lu en base)', async () => {
    const { t, media, version } = await setup(
      { max_total_per_device: 4000, max_per_media_per_device: 100_000 },
      1,
      50_000,
    );
    const m = media[0]!;
    const ops = Array.from({ length: 500 }, () => world.sale(t, m, 10, version, {}, -119));
    const res = await world.submit(t, ops);
    const rs = world.results(res);
    const accepted = rs.filter((r) => r.status === 'ACCEPTED');
    expect(accepted).toHaveLength(400);
    expect(rs.slice(400).every((r) => r.reject_reason === 'POLICY_LIMIT_EXCEEDED')).toBe(true);
    expect(await world.spendable(m.walletId)).toBe(46_000);
  });

  it('lot abandonné pendant le traitement : la garde du vrai processeur arrête avant toute écriture', async () => {
    const { t, media, version } = await setup();
    const ops = [1000, 1100, 1200].map((amount) => world.sale(t, media[0]!, amount, version));
    const processor = world.pw.api.app.get<OfflineOperationProcessor>(OFFLINE_OPERATION_PROCESSOR, {
      strict: false,
    });
    const real = processor.process.bind(processor);
    // Après l'opération 1 : lot REJECTED / ABANDONED (même UPDATE que `open_offline_batch`).
    const spy = jest.spyOn(processor, 'process').mockImplementation(async (ctx, op) => {
      const result = await real(ctx, op);
      if (op.seq === 1n)
        await ownerRows(
          `UPDATE offline_batch SET status = 'REJECTED', reject_reason = 'ABANDONED'
            WHERE id = $1 AND status = 'PROCESSING'`,
          [ctx.batchId],
        );
      return result;
    });
    let res: Awaited<ReturnType<typeof world.submit>>;
    try {
      res = await world.submit(t, ops);
    } finally {
      spy.mockRestore();
    }
    expect(res.status).toBe(200);
    expect(res.body.abandoned).toBe(true);
    expect(world.results(res).map((r) => r.seq)).toEqual([1]);
    const batchId = res.batch.header.batch_id;
    const batch = await ownerRows<{ status: string; reject_reason: string }>(
      'SELECT status, reject_reason FROM offline_batch WHERE id = $1',
      [batchId],
    );
    expect(batch).toEqual([{ status: 'REJECTED', reject_reason: 'ABANDONED' }]);
    // Rien au-delà de l'opération 1 : ni transaction, ni registre, ni résultat, ni solde débité.
    expect(await world.txRows(t.t.deviceId)).toHaveLength(1);
    expect((await world.pw.registry(t.t.deviceId)).map((r) => r.seq)).toEqual(['1']);
    const stored = await ownerRows<{ seq: string }>(
      'SELECT seq::text FROM offline_op_result WHERE batch_id = $1 ORDER BY seq',
      [batchId],
    );
    expect(stored.map((r) => r.seq)).toEqual(['1']);
    expect(await world.spendable(media[0]!.walletId)).toBe(19_000);
  });
});
