// Lots hors ligne (WP23, T103/T104/T107). Chaque cas d'autorité échoue sur une implémentation qui oublie la
// règle INVERSÉE (la passerelle exige `ACTIVE` et l'époque ; le central, lui, refuse un lot sous `EDGE`).
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { chainStep, edgeContentSha256, edgeChainGenesis } from '@cashless/shared-rules';
import {
  buildDeviceBatch,
  makeBench,
  readySnapshot,
  submit,
  type Bench,
  type OfflineDevice,
  type SeedMediaResult,
} from './_support/bench';

let b: Bench;
let dev: OfflineDevice;
let media: SeedMediaResult;
let version: number;

beforeEach(async () => {
  b = await makeBench();
  dev = await b.newDevice();
  media = await b.seedMedia({ balancePaid: 10000, pwdPack: Buffer.from('PWD1PK') });
  version = await readySnapshot(b);
});
afterEach(async () => {
  await b.close();
});

const opts = () => ({ snapshotVersion: version });
const count = async (table: string): Promise<number> =>
  Number((await b.q(`SELECT count(*) AS n FROM ${table}`))[0]!.n);
const balance = async (): Promise<number> => {
  const r = await b.q(
    `SELECT w.central_paid + w.central_promo + COALESCE((SELECT sum(paid_delta + promo_delta)
       FROM edge_op_delta d WHERE d.wallet_id = w.wallet_id), 0) AS v
       FROM edge_wallet w WHERE w.wallet_id = $1`,
    [media.walletId],
  );
  return Number(r[0]!.v);
};

describe('lot valide', () => {
  it('opérations en file (DEVICE_OFFLINE, maillon du terminal), deltas, en-tête et signature rangés', async () => {
    const built = buildDeviceBatch(
      b,
      dev,
      [
        { media, amount: 500 },
        { media, amount: 700 },
      ],
      opts(),
    );
    const res = await submit(b, dev, built);
    expect(res.status).toBe(200);
    const results = (res.json as any).results;
    expect(results.map((r: any) => [r.seq, r.status, r.charged_to_wallet])).toEqual([
      [1, 'ACCEPTED', 500],
      [2, 'ACCEPTED', 700],
    ]);
    const ops = await b.q('SELECT * FROM edge_op ORDER BY edge_seq');
    expect(ops.map((o) => [o.edge_seq, o.type, o.authorized_mode, o.origin_key])).toEqual([
      ['1', 'PURCHASE', 'DEVICE_OFFLINE', `${dev.serial}:0001`],
      ['2', 'PURCHASE', 'DEVICE_OFFLINE', `${dev.serial}:0002`],
    ]);
    expect(ops[0]!.device_batch_id).toBe(built.batchId);
    // Le maillon de la chaîne de la PASSERELLE se déduit du contenu (code partagé) ; celui du terminal reste
    // dans l'opération relayée.
    let chain = edgeChainGenesis(b.gatewayId);
    for (const o of ops) {
      chain = chainStep(chain, edgeContentSha256(o.operation));
      expect(o.chain_hash.equals(chain)).toBe(true);
    }
    expect(ops[0]!.operation.chain_hash).toBe((built.body.operations[0] as any).chain_hash);
    const stored = (await b.q('SELECT * FROM edge_device_batch'))[0]!;
    expect(stored.header).toEqual(built.header);
    expect(stored.signature.toString('base64')).toBe(built.body.signature);
    expect(await balance()).toBe(10000 - 1200);
  });

  it('le résultat est mémorisé : même lot, même réponse, un seul jeu d’entrées', async () => {
    const built = buildDeviceBatch(b, dev, [{ media }], opts());
    const first = await submit(b, dev, built);
    const again = await submit(b, dev, built);
    expect(again.status).toBe(200);
    expect(again.json).toEqual(first.json);
    expect(await count('edge_op')).toBe(1);
  });

  it('même batch_id, autre corps : 409 IDEMPOTENCY_KEY_REUSED', async () => {
    const built = buildDeviceBatch(b, dev, [{ media, amount: 500 }], opts());
    await submit(b, dev, built);
    const other = buildDeviceBatch(b, dev, [{ media, amount: 600 }], {
      ...opts(),
      batchId: built.batchId,
    });
    const res = await submit(b, dev, other);
    expect(res.status).toBe(409);
    expect((res.json as any).code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await count('edge_op')).toBe(1);
  });
});

describe('décision locale jointe (edge_decision, défaut B)', () => {
  const decisions = async () =>
    (await b.q('SELECT type, operation FROM edge_op ORDER BY edge_seq')).map((o) => [
      o.type,
      o.operation.edge_decision,
    ]);

  it('vente acceptée : décision de la passerelle, parts et verdict', async () => {
    const built = buildDeviceBatch(b, dev, [{ media, amount: 500 }], opts());
    expect((await submit(b, dev, built)).status).toBe(200);
    expect(await decisions()).toEqual([
      ['PURCHASE', { status: 'ACCEPTED', charged_to_wallet: 500, shortfall_amount: 0 }],
    ]);
  });

  it('bracelet bloqué après le snapshot : part en attente et raison', async () => {
    await b.q(`UPDATE edge_media SET status = 'SUSPENDED' WHERE token_hash = $1`, [
      media.tokenHash,
    ]);
    const built = buildDeviceBatch(b, dev, [{ media, amount: 500 }], opts());
    expect((await submit(b, dev, built)).status).toBe(200);
    expect(await decisions()).toEqual([
      [
        'PURCHASE',
        {
          status: 'ACCEPTED_WITH_SHORTFALL',
          charged_to_wallet: 0,
          shortfall_amount: 500,
          shortfall_reason: 'MEDIA_BLOCKED_AFTER_SNAPSHOT',
        },
      ],
    ]);
  });

  it('rejet local : décision REJECTED avec la raison, sans part', async () => {
    const built = buildDeviceBatch(b, dev, [{ type: 'TOPUP_CASH', amount: 1000 }], opts());
    expect((await submit(b, dev, built)).status).toBe(200);
    expect(await decisions()).toEqual([
      [
        'TOPUP_CASH',
        {
          status: 'REJECTED',
          charged_to_wallet: 0,
          shortfall_amount: 0,
          reject_reason: 'OFFLINE_NOT_ALLOWED',
        },
      ],
    ]);
  });

  it('une décision fournie par le terminal est écartée au profit de celle de la passerelle', async () => {
    const forged = { status: 'ACCEPTED', charged_to_wallet: 1, shortfall_amount: 0 };
    const built = buildDeviceBatch(
      b,
      dev,
      [{ media, amount: 500, extra: { edge_decision: forged } }],
      opts(),
    );
    expect((await submit(b, dev, built)).status).toBe(200);
    expect((await decisions())[0]![1].charged_to_wallet).toBe(500);
  });
});

describe('contrôles d’entrée : rien n’est écrit', () => {
  const nothing = async (): Promise<void> => {
    expect(await count('edge_op')).toBe(0);
    expect(await count('edge_device_batch')).toBe(0);
    expect(await count('edge_offline_op_result')).toBe(0);
    expect(Number((await b.q('SELECT last_edge_seq FROM edge_chain_head'))[0]!.last_edge_seq)).toBe(
      0,
    );
  };

  it('signature d’un autre terminal : 400 BATCH_SIGNATURE_INVALID', async () => {
    const other = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
    const res = await submit(
      b,
      dev,
      buildDeviceBatch(b, dev, [{ media }], { ...opts(), signer: other }),
    );
    expect(res.status).toBe(400);
    expect((res.json as any).code).toBe('BATCH_SIGNATURE_INVALID');
    await nothing();
  });

  it('signature P1363 (non DER) : refusée', async () => {
    const built = buildDeviceBatch(b, dev, [{ media }], opts());
    built.body.signature = Buffer.alloc(64, 7).toString('base64');
    const res = await submit(b, dev, built);
    expect((res.json as any).code).toBe('BATCH_SIGNATURE_INVALID');
    await nothing();
  });

  it('chaîne rompue au 3e maillon : 409 CHAIN_BROKEN', async () => {
    const res = await submit(
      b,
      dev,
      buildDeviceBatch(
        b,
        dev,
        [{ media }, { media }, { media, corruptChain: true }, { media }],
        opts(),
      ),
    );
    expect(res.status).toBe(409);
    expect((res.json as any).code).toBe('CHAIN_BROKEN');
    await nothing();
  });

  it('en-tête lié à la requête : série, grand livre, clé d’idempotence, époque', async () => {
    const built = buildDeviceBatch(b, dev, [{ media }], opts());
    const wrongKey = await b.request(dev, {
      method: 'POST',
      path: '/v1/offline-batches',
      body: built.body,
      idempotencyKey: randomUUID(),
      headers: { 'x-authority-epoch': '3' },
    });
    expect(wrongKey.status).toBe(400);
    const wrongEpoch = await submit(b, dev, built, { epoch: 4 });
    expect(wrongEpoch.status).toBe(400);
    const other = await b.newDevice();
    const wrongDevice = await submit(b, other, built);
    expect(wrongDevice.status).toBe(400);
    await nothing();
  });

  it('501 opérations : 413 BATCH_TOO_LARGE', async () => {
    const specs = Array.from({ length: 501 }, () => ({ type: 'VOID' as const }));
    const res = await submit(b, dev, buildDeviceBatch(b, dev, specs, opts()));
    expect(res.status).toBe(413);
    expect((res.json as any).code).toBe('BATCH_TOO_LARGE');
    await nothing();
  });

  it('numéros non continus : 400 SEQ_OUT_OF_ORDER', async () => {
    const built = buildDeviceBatch(b, dev, [{ media }, { media }], opts());
    (built.body.operations[1] as any).seq = 9;
    const res = await submit(b, dev, built);
    expect(res.status).toBe(400);
    await nothing();
  });
});

describe('autorité de débit : règle inversée', () => {
  it.each([
    ['RELEASING', 'DEBIT_AUTHORITY_MOVING', 409],
    ['STALE', 'STALE_AUTHORITY_EPOCH', 409],
    ['ARMED', 'CONFLICT_STATE', 409],
    ['REVOKED', 'STALE_AUTHORITY_EPOCH', 409],
  ])('%s : %s, aucune entrée, aucun numéro consommé', async (state, code, status) => {
    await b.setAuthority(state as string);
    const res = await submit(b, dev, buildDeviceBatch(b, dev, [{ media }], opts()));
    expect(res.status).toBe(status);
    expect((res.json as any).code).toBe(code);
    if (state === 'ARMED') expect((res.json as any).detail).toBe('GATEWAY_NOT_AUTHORITY');
    expect(await count('edge_op')).toBe(0);
    expect(Number((await b.q('SELECT last_edge_seq FROM edge_chain_head'))[0]!.last_edge_seq)).toBe(
      0,
    );
  });

  it('ACTIVE accepte (le central, lui, refuserait sous EDGE)', async () => {
    const res = await submit(b, dev, buildDeviceBatch(b, dev, [{ media }], opts()));
    expect(res.status).toBe(200);
  });

  it('époque détenue différente de celle du lot : 409 STALE_AUTHORITY_EPOCH', async () => {
    const res = await submit(
      b,
      dev,
      buildDeviceBatch(b, dev, [{ media }], { ...opts(), epoch: 2 }),
    );
    expect(res.status).toBe(409);
    expect((res.json as any).code).toBe('STALE_AUTHORITY_EPOCH');
    expect(await count('edge_op')).toBe(0);
  });
});

describe('règles de la mission 7 (code partagé)', () => {
  const only = async (specs: any[], extra = {}) => {
    const res = await submit(b, dev, buildDeviceBatch(b, dev, specs, { ...opts(), ...extra }));
    expect(res.status).toBe(200);
    return (res.json as any).results as any[];
  };

  it('plafond par vente dépassé : REJECTED POLICY_LIMIT_EXCEEDED, sans delta, mais mise en file', async () => {
    const [r] = await only([{ media, amount: 5001 }]);
    expect(r).toMatchObject({ status: 'REJECTED', reject_reason: 'POLICY_LIMIT_EXCEEDED' });
    expect(await count('edge_op')).toBe(1);
    expect(await count('edge_op_delta')).toBe(0);
  });

  it('plafond par bracelet cumulé sur plusieurs opérations du lot', async () => {
    await b.q(
      `UPDATE edge_event_setting SET policy_in_force = jsonb_set(policy_in_force, '{0,offline_policy,max_per_media_per_device}', '1000')`,
    );
    const rs = await only([
      { media, amount: 600 },
      { media, amount: 600 },
    ]);
    expect(rs.map((r) => r.status)).toEqual(['ACCEPTED', 'REJECTED']);
    expect(rs[1].reject_reason).toBe('POLICY_LIMIT_EXCEEDED');
  });

  it('configuration citée inconnue : OFFLINE_NOT_ALLOWED (règle partagée, 1er motif)', async () => {
    const [r] = await only([{ media }], { configId: 99 });
    expect(r.reject_reason).toBe('OFFLINE_NOT_ALLOWED');
    expect(await count('edge_op_delta')).toBe(0);
  });

  it('bracelet bloqué APRÈS le snapshot (blocage répliqué) : manque entier, aucun débit local', async () => {
    await b.q(`UPDATE edge_media SET status = 'SUSPENDED' WHERE token_hash = $1`, [
      media.tokenHash,
    ]);
    const [r] = await only([{ media, amount: 500 }]);
    expect(r).toMatchObject({
      status: 'ACCEPTED_WITH_SHORTFALL',
      charged_to_wallet: 0,
      shortfall_amount: 500,
      shortfall_reason: 'MEDIA_BLOCKED_AFTER_SNAPSHOT',
      tap_result: 'BLOCKED',
    });
    expect(await count('edge_op_delta')).toBe(0);
    expect(await balance()).toBe(10000);
  });

  it('bracelet bloqué DANS le snapshot cité : REJECTED MEDIA_BLOCKED_IN_SNAPSHOT', async () => {
    await b.q(`UPDATE edge_media SET status = 'SUSPENDED' WHERE token_hash = $1`, [
      media.tokenHash,
    ]);
    b.clock.advance(1000);
    const v2 = (await b.worker.tick())!.version; // blocage : version immédiate
    const [r] = await only([{ media }], { snapshotVersion: v2 });
    expect(r).toMatchObject({ status: 'REJECTED', reject_reason: 'MEDIA_BLOCKED_IN_SNAPSHOT' });
  });

  it('lot du bracelet non actif dans le snapshot : MEDIA_BLOCKED_IN_SNAPSHOT', async () => {
    await b.q(`UPDATE edge_media SET batch_status = 'SUSPENDED' WHERE token_hash = $1`, [
      media.tokenHash,
    ]);
    b.clock.advance(1000);
    const v2 = (await b.worker.tick())!.version;
    const [r] = await only([{ media }], { snapshotVersion: v2 });
    expect(r.reject_reason).toBe('MEDIA_BLOCKED_IN_SNAPSHOT');
  });

  it('événement en SETTLING : REJECTED SYNC_DEADLINE_PASSED', async () => {
    await b.q(`UPDATE edge_event_setting SET status = 'SETTLING'`);
    const [r] = await only([{ media }]);
    expect(r.reject_reason).toBe('SYNC_DEADLINE_PASSED');
  });

  it('solde insuffisant : part couverte limitée, reste en manque', async () => {
    await b.q(`UPDATE edge_wallet SET central_paid = 300 WHERE wallet_id = $1`, [media.walletId]);
    const [r] = await only([{ media, amount: 500 }]);
    expect(r).toMatchObject({
      status: 'ACCEPTED_WITH_SHORTFALL',
      charged_to_wallet: 300,
      shortfall_amount: 200,
      shortfall_reason: 'INSUFFICIENT_FUNDS',
    });
    expect(await balance()).toBe(0);
  });

  it('snapshot inconnu ou non enveloppé pour ce terminal : SNAPSHOT_VERSION_UNKNOWN', async () => {
    const [unknown] = await only([{ media }], { snapshotVersion: 999 });
    expect(unknown.reject_reason).toBe('SNAPSHOT_VERSION_UNKNOWN');
    await b.q('DELETE FROM edge_snapshot_key WHERE device_id = $1', [dev.deviceId]);
    const [notWrapped] = await only([{ media }], { seqFrom: 5 });
    expect(notWrapped.reject_reason).toBe('SNAPSHOT_VERSION_UNKNOWN');
  });

  it('bracelet inconnu : REJECTED MEDIA_NOT_IN_SNAPSHOT', async () => {
    const ghost = {
      ...media,
      tokenHex: 'ab'.repeat(32),
      uid: Buffer.alloc(7, 1),
    } as SeedMediaResult;
    const [r] = await only([{ media: ghost }]);
    expect(r.reject_reason).toBe('MEDIA_NOT_IN_SNAPSHOT');
  });

  it('annulation : delta inverse ; une seconde annulation : ALREADY_REVERSED', async () => {
    await only([{ media, amount: 500 }]);
    expect(await balance()).toBe(9500);
    const rev = {
      type: 'REVERSAL' as const,
      extra: { reverses_seq: 1 },
    };
    const built = buildDeviceBatch(b, dev, [rev], { ...opts(), seqFrom: 2 });
    const res = await submit(b, dev, built);
    expect((res.json as any).results[0].status).toBe('ACCEPTED');
    expect(await balance()).toBe(10000);
    const built2 = buildDeviceBatch(b, dev, [rev], { ...opts(), seqFrom: 3 });
    const res2 = await submit(b, dev, built2);
    expect((res2.json as any).results[0]).toMatchObject({
      status: 'REJECTED',
      reject_reason: 'ALREADY_REVERSED',
    });
    expect(await balance()).toBe(10000);
  });

  it('annulation d’une vente d’un AUTRE terminal : REVERSAL_TARGET_NOT_FOUND', async () => {
    await only([{ media, amount: 500 }]);
    const other = await b.newDevice();
    const otherVersion = (await b.worker.tick())?.version ?? version;
    const built = buildDeviceBatch(b, other, [{ type: 'REVERSAL', extra: { reverses_seq: 1 } }], {
      snapshotVersion: otherVersion,
      seqFrom: 10,
    });
    const res = await submit(b, other, built);
    expect((res.json as any).results[0].reject_reason).toBe('REVERSAL_TARGET_NOT_FOUND');
  });

  it('numéro déjà pris par une décision de la passerelle (en ligne) : DUPLICATE, rien de nouveau en file', async () => {
    await b.q(
      `INSERT INTO edge_device_batch (device_batch_id, device_id, header, signature) VALUES ($1, $2, '{}', '\\x00')`,
      [randomUUID(), dev.deviceId],
    );
    const [r] = await only([{ media }]);
    expect(r.status).toBe('ACCEPTED');
  });
});

describe('TOPUP_CASH (C-006)', () => {
  it('rejeté dans un lot de terminal, sans delta ni effet sur le solde, mais consigné et relayé', async () => {
    const res = await submit(
      b,
      dev,
      buildDeviceBatch(b, dev, [{ type: 'TOPUP_CASH', amount: 2000 }, { media }], opts()),
    );
    const results = (res.json as any).results;
    expect(results[0]).toMatchObject({ status: 'REJECTED', reject_reason: 'OFFLINE_NOT_ALLOWED' });
    expect(results[0].detail).toBe('TOPUP_CASH');
    expect(results[1].status).toBe('ACCEPTED');
    const ops = await b.q('SELECT type, authorized_mode FROM edge_op ORDER BY edge_seq');
    expect(ops[0]).toMatchObject({ type: 'TOPUP_CASH', authorized_mode: 'DEVICE_OFFLINE' });
    expect(await count('edge_op_delta')).toBe(1);
    expect(await balance()).toBe(10000 - 500);
  });

  it('indépendant du TOPUP_CASH EDGE_ONLINE du guichet (WP22) : la file admet toujours celui-ci', async () => {
    const { EdgeQueue } = await import('../../src/queue/edge-queue');
    const queue = new EdgeQueue();
    const { GatewayTx } = await import('../../src/db/gateway-tx');
    const tx = new GatewayTx(b.db.pool);
    await tx.run((t) =>
      queue.append(
        t,
        {
          originKey: `${dev.serial}:50`,
          type: 'TOPUP_CASH',
          authorizedMode: 'EDGE_ONLINE',
          deviceSerial: dev.serial,
          deviceId: dev.deviceId,
          operation: { seq: 50, type: 'TOPUP_CASH', amount: 1000, currency: 'XOF' },
          occurredAt: new Date(),
          recordedAt: new Date(),
        },
        [{ walletId: media.walletId, paidDelta: 1000n, promoDelta: 0n }],
      ),
    );
    expect(await balance()).toBe(11000);
    const res = await submit(b, dev, buildDeviceBatch(b, dev, [{ type: 'TOPUP_CASH' }], opts()));
    expect((res.json as any).results[0].reject_reason).toBe('OFFLINE_NOT_ALLOWED');
    expect(await balance()).toBe(11000);
  });
});

describe('getOfflineBatchResult', () => {
  const get = (id: string, d = dev) => b.request(d, { path: `/v1/offline-batches/${id}` });

  it('404 inconnu ; 200 le résultat local ; le résultat du central REMPLACE le local', async () => {
    expect((await get(randomUUID())).status).toBe(404);
    const built = buildDeviceBatch(
      b,
      dev,
      [
        { media, amount: 500 },
        { media, amount: 5001 },
      ],
      opts(),
    );
    await submit(b, dev, built);
    const local = await get(built.batchId);
    expect(local.status).toBe(200);
    expect((local.json as any).results[0].status).toBe('ACCEPTED');
    const txId = randomUUID();
    await b.q(
      `UPDATE edge_op SET central_status = 'ACCEPTED_WITH_SHORTFALL', central_transaction_id = $1,
              central_detail = '{"charged_to_wallet": 300, "shortfall_amount": 200, "shortfall_reason": "INSUFFICIENT_FUNDS"}'
        WHERE edge_seq = 1`,
      [txId],
    );
    const merged = (await get(built.batchId)).json as any;
    expect(merged.results[0]).toMatchObject({
      status: 'ACCEPTED_WITH_SHORTFALL',
      effect: 'LEDGER_WRITTEN',
      transaction_id: txId,
      charged_to_wallet: 300,
      shortfall_amount: 200,
    });
    expect(merged.results[1].status).toBe('REJECTED');
  });

  it('un lot d’un autre terminal est introuvable (404)', async () => {
    const built = buildDeviceBatch(b, dev, [{ media }], opts());
    await submit(b, dev, built);
    const other = await b.newDevice();
    expect((await get(built.batchId, other)).status).toBe(404);
  });
});
