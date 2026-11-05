// Champs chaînés (sync_protocol.md §3.3) : les vecteurs de vectors.json sont calculés par gen_vectors.py
// (Python), jamais par le code testé.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chainedContent } from '../../../src/payments/chained-content';
import { contentSha256 } from '../../../src/payments/device-seq-registry';

interface Vectors {
  ops: { name: string; op: Record<string, unknown>; canonical: string; content_sha256: string }[];
  state_fields: Record<string, unknown>;
  chain: {
    device_id: string;
    chain_hash_0: string;
    links: { content_sha256: string; chain_hash: string }[];
  };
}
const V: Vectors = JSON.parse(
  readFileSync(join(__dirname, '../../fixtures/offline-vectors/vectors.json'), 'utf8'),
);

describe('chainedContent : vecteurs Python', () => {
  it.each(V.ops.map((o) => [o.name, o] as const))('%s', (_name, o) => {
    expect(contentSha256(chainedContent(o.op)).toString('hex')).toBe(o.content_sha256);
  });

  it('les vecteurs 5b sont ceux d’origine, valeur inchangée', () => {
    const byName = Object.fromEntries(V.ops.map((o) => [o.name, o.content_sha256]));
    expect(byName['5b_purchase_tap_lines']).toBe(
      '3bea7bf24e0c18626e98856e8e5d20341b8103a00999b47206c357dc0d745c7b',
    );
    expect(byName['5b_purchase_keypad']).toBe(
      '24c53c208f16d9621bbee7294f00c1542db47b7e1007fa579f8c3382c48ef704',
    );
  });

  it('seq en bigint ou en nombre donne la même empreinte', () => {
    const o = V.ops.find((x) => x.name === 'batch_sale_lines')!;
    const asBig = { ...o.op, seq: BigInt(o.op.seq as number) };
    expect(contentSha256(chainedContent(asBig)).toString('hex')).toBe(o.content_sha256);
  });
});

describe('chainedContent : champs retenus', () => {
  const base = V.ops.find((x) => x.name === 'batch_sale_lines')!.op;

  it('un champ d’état ne change pas l’empreinte', () => {
    const ref = contentSha256(chainedContent(base));
    for (const [k, v] of Object.entries(V.state_fields))
      expect(contentSha256(chainedContent({ ...base, [k]: v })).equals(ref)).toBe(true);
    expect(contentSha256(chainedContent({ ...base, ...V.state_fields })).equals(ref)).toBe(true);
    expect(Object.keys(chainedContent({ ...base, ...V.state_fields })).sort()).toEqual(
      Object.keys(base).sort(),
    );
  });

  it('champs absents ou undefined omis', () => {
    expect(chainedContent({ seq: 1, amount: undefined, type: 'VOID' })).toEqual({
      seq: 1,
      type: 'VOID',
    });
  });

  it('propriété inconnue dans tap : prise en compte, valeurs non normalisées', () => {
    const tap = { a: 1, inconnue: ' x ' };
    expect(chainedContent({ seq: 1, tap }).tap).toBe(tap);
    const other = contentSha256(chainedContent({ seq: 1, tap: { a: 1 } }));
    expect(contentSha256(chainedContent({ seq: 1, tap })).equals(other)).toBe(false);
  });

  it('seq : entiers sûrs seulement', () => {
    expect(chainedContent({ seq: 9007199254740991n }).seq).toBe(9007199254740991);
    expect(() => chainedContent({ seq: 9007199254740992n })).toThrow();
    expect(() => chainedContent({ seq: 9007199254740992 })).toThrow();
    expect(() => chainedContent({ seq: 1.5 })).toThrow();
    expect(() => chainedContent({ seq: '12' })).toThrow();
    expect(() => chainedContent({ seq: -1n })).toThrow();
  });
});

describe('chaîne (sync_protocol.md §3.2) : vecteurs Python', () => {
  it('chain_hash(0) puis trois maillons', () => {
    const uuidBytes = Buffer.from(V.chain.device_id.replace(/-/g, ''), 'hex');
    let h = createHash('sha256')
      .update(Buffer.concat([Buffer.from('CASHLESS/CHAIN/v1'), uuidBytes]))
      .digest();
    expect(h.toString('hex')).toBe(V.chain.chain_hash_0);
    for (const link of V.chain.links) {
      h = createHash('sha256')
        .update(Buffer.concat([h, Buffer.from(link.content_sha256, 'hex')]))
        .digest();
      expect(h.toString('hex')).toBe(link.chain_hash);
    }
  });

  it('les contenus de la chaîne sont ceux des trois ventes/annulations de lot', () => {
    const names = ['batch_sale_lines', 'reversal_by_seq', 'reversal_by_transaction'];
    expect(V.chain.links.map((l) => l.content_sha256)).toEqual(
      names.map((n) => V.ops.find((o) => o.name === n)!.content_sha256),
    );
  });
});
