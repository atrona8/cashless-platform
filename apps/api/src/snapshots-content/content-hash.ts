// Empreinte du contenu d'un snapshot (contracts/snapshots.md « Contenu », research R-30) :
//   content_sha256 = SHA-256(JCS({"entries": [...], "removed_token_hashes": [...]}))
// entrées SANS `pwd_pack_enc`, triées par `token_hash` hexadécimal croissant, `null` gardés, les
// deux clés toujours
// présentes, `removed_token_hashes` triée. JCS = RFC 8785 (`canonicalize`), jamais
// `JSON.stringify`.
import { createHash } from 'node:crypto';
import canonicalize from 'canonicalize';
import { SLICE_ROWS, yieldToLoop } from '../processes/cooperative';

/** Entrée signée : les onze clés de interfaces.md § 3 (jamais `pwd_pack_enc`). */
export interface SnapshotEntry {
  token_hash: string;
  nfc_uid: string | null;
  key_index: number;
  originality_sig_sha256: string | null;
  status: string;
  batch_event_id: string | null;
  batch_status: string | null;
  wallet_status: string;
  spendable: number;
  last_counter: number | null;
  pwd_pack_sha256: string | null;
}

const byHex = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const guardNoPassword = (entries: readonly SnapshotEntry[]): void => {
  for (const entry of entries)
    if ('pwd_pack_enc' in (entry as object))
      throw new Error('pwd_pack_enc ne doit pas figurer dans les entrées hachées');
};

/** Texte JCS du contenu haché. Une entrée portant `pwd_pack_enc` est une erreur : il est hors
 * empreinte. */
export function contentCanonical(
  entries: readonly SnapshotEntry[],
  removedTokenHashes: readonly string[],
): string {
  guardNoPassword(entries);
  const text = canonicalize({
    entries: [...entries].sort((a, b) => byHex(a.token_hash, b.token_hash)),
    removed_token_hashes: [...removedTokenHashes].sort(byHex),
  });
  if (text === undefined) throw new Error('Contenu non canonicalisable');
  return text;
}

/** `content_sha256` en hexadécimal minuscule (64 caractères). */
export function contentSha256(
  entries: readonly SnapshotEntry[],
  removedTokenHashes: readonly string[],
): string {
  return createHash('sha256')
    .update(contentCanonical(entries, removedTokenHashes), 'utf8')
    .digest('hex');
}

/**
 * Même empreinte que `contentSha256`, octet pour octet, en rendant la main à la boucle entre deux tranches
 * d'entrées. Le JCS d'un objet à deux clés (`entries` < `removed_token_hashes`) est la concaténation de celui de
 * chaque élément de `entries`, séparés par des virgules : on alimente le hachage tranche par tranche, sans jamais
 * construire le texte entier. Un test l'égale à `contentSha256` sur des jeux variés.
 */
export async function contentSha256Cooperative(
  entries: readonly SnapshotEntry[],
  removedTokenHashes: readonly string[],
): Promise<string> {
  guardNoPassword(entries);
  const sorted = [...entries].sort((a, b) => byHex(a.token_hash, b.token_hash));
  const removed = canonicalize([...removedTokenHashes].sort(byHex));
  if (removed === undefined) throw new Error('Contenu non canonicalisable');
  const hash = createHash('sha256');
  hash.update('{"entries":[', 'utf8');
  for (let from = 0; from < sorted.length; from += SLICE_ROWS) {
    const texts = sorted.slice(from, from + SLICE_ROWS).map((entry) => {
      const text = canonicalize(entry);
      if (text === undefined) throw new Error('Contenu non canonicalisable');
      return text;
    });
    hash.update((from > 0 ? ',' : '') + texts.join(','), 'utf8');
    await yieldToLoop();
  }
  hash.update(`],"removed_token_hashes":${removed}}`, 'utf8');
  return hash.digest('hex');
}
