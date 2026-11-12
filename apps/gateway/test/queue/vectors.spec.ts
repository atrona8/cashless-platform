// T092 : vecteurs indépendants de R-12 (cas (a) à (j)), générés par `gen_edge_vectors.py`, jamais
// par le code testé. La file doit donner les mêmes empreintes et la même chaîne.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chainStep, edgeChainGenesis, edgeContentSha256 } from '@cashless/shared-rules';
import { EdgeQueue, type EdgeOpInput } from '../../src/queue/edge-queue';
import {
  DEVICE_ID,
  head,
  makeQueueHarness,
  ops,
  type QueueHarness,
} from './_support/queue-harness';

interface Vectors {
  genesis: { gateway_id: string; chain_hash_0: string }[];
  ops: { name: string; op: Record<string, any>; content_sha256: string }[];
  chain: {
    gateway_id: string;
    chain_hash_0: string;
    ops: string[];
    links: { content_sha256: string; chain_hash: string }[];
  };
  decision_pair: {
    sha_with: string;
    sha_without: string;
    with_decision: any;
    without_decision: any;
  };
  rejected: { name: string; op: Record<string, any> }[];
}
const vectors: Vectors = JSON.parse(
  readFileSync(
    join(__dirname, '..', '..', '..', 'api', 'test', 'fixtures', 'edge-vectors', 'vectors.json'),
    'utf8',
  ),
);
const byName = (name: string): Vectors['ops'][number] => vectors.ops.find((o) => o.name === name)!;

function input(op: Record<string, any>, originSuffix: string): EdgeOpInput {
  const { edge_seq: _s, device_serial, authorized_mode, device_batch_id, ...rest } = op;
  return {
    originKey: `${device_serial}:${originSuffix}`,
    type: op.type,
    authorizedMode: authorized_mode,
    deviceSerial: device_serial,
    deviceId: DEVICE_ID,
    deviceBatchId: device_batch_id ?? null,
    operation:
      authorized_mode === 'DEVICE_OFFLINE' ? { ...rest, chain_hash: 'cd'.repeat(32) } : rest,
    occurredAt: new Date(op.occurred_at),
    recordedAt: new Date(op.occurred_at),
  };
}

describe('vecteurs R-12', () => {
  it('(a) genèse : le code partagé redonne chaque chain_hash_0', () => {
    for (const g of vectors.genesis) {
      expect(edgeChainGenesis(g.gateway_id).toString('hex')).toBe(g.chain_hash_0);
    }
  });

  it('(a)-(i) empreinte de contenu de chaque cas, edge_seq 2^32 et 2^53 - 1 compris', () => {
    for (const v of vectors.ops) {
      expect(edgeContentSha256(v.op as never).toString('hex')).toBe(v.content_sha256);
    }
    expect(byName('g1_edge_seq_2_pow_32').op.edge_seq).toBe(2 ** 32);
    expect(byName('g2_edge_seq_max_safe').op.edge_seq).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('(h) avec et sans edge_decision : empreintes différentes, conformes', () => {
    const d = vectors.decision_pair;
    expect(edgeContentSha256(d.with_decision).toString('hex')).toBe(d.sha_with);
    expect(edgeContentSha256(d.without_decision).toString('hex')).toBe(d.sha_without);
    expect(d.sha_with).not.toBe(d.sha_without);
  });

  it('(j) edge_seq 2^53, négatif, fractionnaire : refusés', () => {
    for (const r of vectors.rejected) {
      expect(() => edgeContentSha256(r.op as never)).toThrow();
    }
  });

  describe('par la file, sur une base', () => {
    let h: QueueHarness;
    beforeEach(async () => {
      h = await makeQueueHarness();
    });
    afterEach(async () => {
      await h.close();
    });

    it('(b) PURCHASE, VOID, REVERSAL puis (c)-(f) : mêmes empreintes, même chaîne', async () => {
      // La tête part de la genèse du vecteur (autre identifiant de passerelle que la base de test).
      await h.db.pool.query('UPDATE edge_chain_head SET last_chain_hash = $1', [
        Buffer.from(vectors.chain.chain_hash_0, 'hex'),
      ]);
      let previous: Buffer = Buffer.from(vectors.chain.chain_hash_0, 'hex');
      const names = [
        ...vectors.chain.ops,
        'c_device_offline_relayed',
        'd_activation',
        'e_deposit_cash',
        'f_topup_cash',
      ];
      await h.db.pool.query(
        `INSERT INTO edge_device_batch (device_batch_id, device_id, header, signature)
         VALUES ($1, $2, '{}', '\\x01')`,
        [byName('c_device_offline_relayed').op.device_batch_id, DEVICE_ID],
      );
      for (const [i, name] of names.entries()) {
        const v = byName(name);
        await h.addOp(input(v.op, String(i + 1)));
      }
      const rows = await ops(h.db);
      expect(rows).toHaveLength(names.length);
      rows.forEach((row, i) => {
        const v = byName(names[i]!);
        expect(Buffer.from(row.content_sha256).toString('hex')).toBe(v.content_sha256);
        previous = chainStep(previous, Buffer.from(v.content_sha256, 'hex'));
        expect(Buffer.from(row.chain_hash).toString('hex')).toBe(previous.toString('hex'));
        if (i < vectors.chain.links.length) {
          expect(previous.toString('hex')).toBe(vectors.chain.links[i]!.chain_hash);
        }
      });
      expect(Buffer.from((await head(h.db)).last_chain_hash).equals(previous)).toBe(true);
    });

    it('(g) (j) edge_seq 2^53 refusé par append, avant toute écriture', async () => {
      const stub = {
        // La clé d'origine est lue avant le verrou de la tête (aucune ligne), puis la tête.
        query: async (sql: string) =>
          sql.includes('origin_key')
            ? { rows: [], rowCount: 0 }
            : {
                rows: [
                  { last_edge_seq: String(2n ** 53n - 1n), last_chain_hash: Buffer.alloc(32) },
                ],
                rowCount: 1,
              },
      } as never;
      await expect(
        new EdgeQueue().append(stub, input(byName('b1_purchase').op, '1'), []),
      ).rejects.toMatchObject({ code: 'SEQ_OUT_OF_RANGE' });
    });
  });
});
