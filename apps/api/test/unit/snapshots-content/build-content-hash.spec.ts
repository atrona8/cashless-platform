// Empreinte de contenu (WP11, T047) : vecteurs calculés HORS du code testé par un script Python
// indépendant
// (json.dumps sort_keys, separators compacts, SHA-256), puis collés ici. WP13 recalcule l'empreinte
// de son côté.
import { createHash } from 'node:crypto';
import {
  contentCanonical,
  contentSha256,
  type SnapshotEntry,
} from '../../../src/snapshots-content/content-hash';

const entry = (token: string, extra: Partial<SnapshotEntry> = {}): SnapshotEntry => ({
  token_hash: token,
  nfc_uid: '04a1b2c3d4e5f6',
  key_index: 1,
  originality_sig_sha256: null,
  status: 'ACTIVE',
  batch_event_id: null,
  batch_status: 'ACTIVE',
  wallet_status: 'ACTIVE',
  spendable: 1250,
  last_counter: null,
  pwd_pack_sha256: null,
  ...extra,
});
const A = 'aa'.repeat(32);
const B = '0b'.repeat(32);
const C = 'ff'.repeat(32);

describe('content_sha256', () => {
  it('vecteur 1 : contenu vide, les deux clés présentes', () => {
    expect(contentCanonical([], [])).toBe('{"entries":[],"removed_token_hashes":[]}');
    expect(contentSha256([], [])).toBe(
      '67164dacb279eb59c2605c4439f2c84681572b5b8d77a254657e69d66bd536e1',
    );
  });

  const entries = [
    entry(A),
    entry(B, { last_counter: 7, nfc_uid: null, spendable: -5, status: 'SUSPENDED' }),
  ];
  const removed = [C, '01'.repeat(32)];
  const VECTOR = 'bf3d73ded3ec048150e654b865c3d3b7d90e5270fe375ccf0513de173e61ee01';

  it('vecteur 2 : tri par token_hash, null gardés, retirés triés', () => {
    expect(contentSha256(entries, removed)).toBe(VECTOR);
  });

  it('indépendant de l’ordre d’entrée', () => {
    expect(contentSha256([...entries].reverse(), [...removed].reverse())).toBe(VECTOR);
  });

  it('JSON.stringify ne donne pas le vecteur (JCS trie les clés)', () => {
    const naive = JSON.stringify({
      entries: [...entries].sort((a, b) => (a.token_hash < b.token_hash ? -1 : 1)),
      removed_token_hashes: [...removed].sort(),
    });
    expect(createHash('sha256').update(naive).digest('hex')).not.toBe(VECTOR);
  });

  it('refuse une entrée qui porte pwd_pack_enc (hors empreinte)', () => {
    const bad = { ...entry(A), pwd_pack_enc: 'x' } as unknown as SnapshotEntry;
    expect(() => contentSha256([bad], [])).toThrow(/pwd_pack_enc/);
  });
});
