// Vecteurs de la chaîne de la passerelle (research R-12, R-13), calculés par gen_edge_vectors.py (Python, JCS réécrit),
// jamais par le code testé. Cas (a) à (k).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  batchSigningPayload,
  chainStep,
  edgeChainGenesis,
  edgeContent,
  edgeContentSha256,
  type EdgeSyncBatchLike,
  type EdgeSyncOperationLike,
} from '../src';

interface Vectors {
  genesis: { name: string; gateway_id: string; chain_hash_0: string }[];
  ops: {
    name: string;
    op: EdgeSyncOperationLike;
    edge_content_canonical: string;
    content_sha256: string;
  }[];
  chain: {
    gateway_id: string;
    chain_hash_0: string;
    ops: string[];
    links: { content_sha256: string; chain_hash: string }[];
  };
  decision_pair: {
    with_decision: EdgeSyncOperationLike;
    without_decision: EdgeSyncOperationLike;
    sha_with: string;
    sha_without: string;
  };
  rejected: { name: string; op: EdgeSyncOperationLike }[];
  signature_payloads: {
    name: string;
    batch: EdgeSyncBatchLike;
    payload_canonical: string;
    payload_sha256: string;
  }[];
}

const V: Vectors = JSON.parse(
  readFileSync(
    join(__dirname, '../../../apps/api/test/fixtures/edge-vectors/vectors.json'),
    'utf8',
  ),
);
const op = (name: string): EdgeSyncOperationLike => V.ops.find((o) => o.name === name)!.op;

describe('vecteurs : le fichier n’est pas vide', () => {
  it('au moins 11 cas, tous les groupes présents', () => {
    const count =
      V.genesis.length +
      V.ops.length +
      V.chain.links.length +
      2 +
      V.rejected.length +
      V.signature_payloads.length;
    expect(count).toBeGreaterThanOrEqual(11);
    expect(V.genesis.length).toBeGreaterThanOrEqual(1);
    expect(V.ops.length).toBeGreaterThanOrEqual(10);
    expect(V.rejected.length).toBeGreaterThanOrEqual(1);
    expect(V.signature_payloads.length).toBeGreaterThanOrEqual(2);
  });
});

describe('(a) genèse', () => {
  it.each(V.genesis.map((g) => [g.name, g] as const))('%s', (_n, g) => {
    expect(edgeChainGenesis(g.gateway_id).toString('hex')).toBe(g.chain_hash_0);
  });

  it('refuse un identifiant qui n’est pas un UUID', () => {
    expect(() => edgeChainGenesis('pas-un-uuid')).toThrow();
  });
});

describe('(b) à (g), (i) contenu et empreinte', () => {
  it.each(V.ops.map((o) => [o.name, o] as const))('%s', (_n, o) => {
    expect(JSON.stringify(sortKeys(edgeContent(o.op)))).toBe(
      JSON.stringify(sortKeys(JSON.parse(o.edge_content_canonical))),
    );
    expect(edgeContentSha256(o.op).toString('hex')).toBe(o.content_sha256);
  });

  it('(g) edge_seq = 2^32 et 2^53 - 1 sont conservés tels quels', () => {
    expect((edgeContent(op('g1_edge_seq_2_pow_32')) as { edge_seq: number }).edge_seq).toBe(
      2 ** 32,
    );
    expect((edgeContent(op('g2_edge_seq_max_safe')) as { edge_seq: number }).edge_seq).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });

  it('(g) edge_seq en bigint donne la même empreinte qu’en nombre', () => {
    const asBig = { ...op('g1_edge_seq_2_pow_32'), edge_seq: 2n ** 32n };
    expect(edgeContentSha256(asBig).equals(edgeContentSha256(op('g1_edge_seq_2_pow_32')))).toBe(
      true,
    );
  });

  it('(i) une propriété inconnue de tap est conservée telle quelle', () => {
    const tap = (edgeContent(op('i_unknown_tap_property')) as { tap: Record<string, unknown> }).tap;
    expect(tap['extra_é']).toBe('ü\n\u0001');
  });

  it('un champ d’état ou inconnu hors liste n’entre pas dans le contenu', () => {
    const base = op('b2_void');
    const noisy = { ...base, online_status: 'CONFIRMED', snapshot_version: 3, clock: { x: 1 } };
    expect(edgeContentSha256(noisy).equals(edgeContentSha256(base))).toBe(true);
  });

  it('device_serial et authorized_mode sont liés à l’empreinte', () => {
    const base = op('b2_void');
    expect(
      edgeContentSha256({ ...base, device_serial: 'AUTRE' }).equals(edgeContentSha256(base)),
    ).toBe(false);
    expect(
      edgeContentSha256({ ...base, authorized_mode: 'DEVICE_OFFLINE' }).equals(
        edgeContentSha256(base),
      ),
    ).toBe(false);
  });

  it('(c) device_batch_id est lié à l’empreinte', () => {
    const c = op('c_device_offline_relayed');
    expect(
      edgeContentSha256({ ...c, device_batch_id: undefined }).equals(edgeContentSha256(c)),
    ).toBe(false);
  });

  it('(d)(e) edge_guichet est lié à l’empreinte', () => {
    const d = op('d_activation');
    const other = { ...d, edge_guichet: { ...(d.edge_guichet as object), media_id: 'autre' } };
    expect(edgeContentSha256(other).equals(edgeContentSha256(d))).toBe(false);
  });
});

describe('(b) chaîne de trois maillons', () => {
  it('chaque maillon égale le vecteur', () => {
    let chain = edgeChainGenesis(V.chain.gateway_id);
    expect(chain.toString('hex')).toBe(V.chain.chain_hash_0);
    V.chain.ops.forEach((name, i) => {
      const content = edgeContentSha256(op(name));
      expect(content.toString('hex')).toBe(V.chain.links[i]!.content_sha256);
      chain = chainStep(chain, content);
      expect(chain.toString('hex')).toBe(V.chain.links[i]!.chain_hash);
    });
  });
});

describe('(h) edge_decision protège la chaîne', () => {
  it('avec et sans décision : empreintes conformes et différentes', () => {
    const { with_decision: w, without_decision: wo } = V.decision_pair;
    expect(edgeContentSha256(w).toString('hex')).toBe(V.decision_pair.sha_with);
    expect(edgeContentSha256(wo).toString('hex')).toBe(V.decision_pair.sha_without);
    expect(V.decision_pair.sha_with).not.toBe(V.decision_pair.sha_without);
  });

  it('changer un seul montant de la décision change l’empreinte', () => {
    const w = V.decision_pair.with_decision;
    const altered = {
      ...w,
      edge_decision: { ...(w.edge_decision as object), charged_to_wallet: 1 },
    };
    expect(edgeContentSha256(altered).toString('hex')).not.toBe(V.decision_pair.sha_with);
  });
});

describe('(j) edge_seq refusé', () => {
  it.each(V.rejected.map((r) => [r.name, r] as const))('%s lève', (_n, r) => {
    expect(() => edgeContent(r.op)).toThrow(/edge_seq/);
    expect(() => edgeContentSha256(r.op)).toThrow(/edge_seq/);
  });

  it('en bigint : 2^53 et -1 refusés, 2^53 - 1 accepté', () => {
    const base = op('b2_void');
    expect(() => edgeContent({ ...base, edge_seq: 2n ** 53n })).toThrow(/edge_seq/);
    expect(() => edgeContent({ ...base, edge_seq: -1n })).toThrow(/edge_seq/);
    expect(() => edgeContent({ ...base, edge_seq: 2n ** 53n - 1n })).not.toThrow();
  });

  it('device_serial ou authorized_mode absent : refusé', () => {
    const { device_serial: _s, ...noSerial } = op('b2_void');
    expect(() => edgeContent(noSerial as unknown as EdgeSyncOperationLike)).toThrow();
  });
});

describe('(k) charge utile de signature d’un lot', () => {
  it.each(V.signature_payloads.map((p) => [p.name, p] as const))('%s', (_n, p) => {
    const payload = batchSigningPayload(p.batch);
    expect(payload.toString('utf8')).toBe(p.payload_canonical);
    expect(payload.toString('utf8')).not.toContain('"signature"');
  });

  it('la signature ne change pas la charge utile ; staff_token_audit la change', () => {
    const [without, withAudit, unknown] = V.signature_payloads;
    const resigned = batchSigningPayload({ ...without!.batch, signature: 'autre' });
    expect(resigned.equals(batchSigningPayload(without!.batch))).toBe(true);
    expect(batchSigningPayload(withAudit!.batch).equals(batchSigningPayload(without!.batch))).toBe(
      false,
    );
    expect(batchSigningPayload(unknown!.batch).equals(batchSigningPayload(withAudit!.batch))).toBe(
      false,
    );
  });

  it('ne modifie pas le lot reçu', () => {
    const batch = V.signature_payloads[0]!.batch;
    batchSigningPayload(batch);
    expect(batch.signature).toBeDefined();
  });
});

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.entries(v as object)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, x]) => [k, sortKeys(x)]),
    );
  return v;
}
