// Construction d'un snapshot (WP11, T047) : différences contre l'état courant, chiffrement (port
// `EntryEncryptor`),
// empreinte de contenu, en-tête du producteur et paquets de 5 000. Aucun accès base ici : fonctions
// testables.
// FICHIER À FAIRE RELIRE PAR UNE PERSONNE (règle 4 de CLAUDE.md) : il décide ce qui entre dans le
// contenu signé.
import { contentSha256Cooperative, type SnapshotEntry } from './content-hash';
import type { EncryptedEntry, EntryEncryptor, LiveRow } from './entry-encryptor';

/** Taille maximale d'un paquet accepté par la base (offline_snapshot_add_entries). */
export const PACKET_SIZE = 5000;

/** Ligne rendue par offline_snapshot_source / _source_delta. */
export interface SourceRow {
  tokenHash: Buffer;
  mediaId: string;
  entry: SnapshotEntry | null;
  pwdPackEnc: Buffer | null;
  pwdPackDekId: string | null;
  keyIndex: number | null;
  nfcUid: Buffer | null;
  removed: boolean;
}

/** État courant d'un bracelet (offline_snapshot_state_hashes). */
export interface StateHash {
  entrySha256: Buffer;
  removed: boolean;
}

export interface Diff {
  live: SourceRow[];
  removed: SourceRow[];
  unchanged: number;
}

/**
 * Garde les entrées modifiées et les retirées. `entryShas` : empreinte de changement
 * (offline_snapshot_entry_sha256,
 * calculée par la base) de chaque ligne vivante, par jeton hexadécimal. Une ligne vivante absente
 * de l'état, ou
 * retirée dans l'état, ou d'empreinte différente est gardée ; un retrait déjà marqué retiré est
 * écarté.
 */
export function diffRows(
  rows: readonly SourceRow[],
  entryShas: ReadonlyMap<string, Buffer>,
  state: ReadonlyMap<string, StateHash>,
): Diff {
  const diff: Diff = { live: [], removed: [], unchanged: 0 };
  for (const row of rows) {
    const hex = row.tokenHash.toString('hex');
    const known = state.get(hex);
    if (row.removed) {
      if (known?.removed) diff.unchanged += 1;
      else diff.removed.push(row);
      continue;
    }
    const sha = entryShas.get(hex);
    if (known && !known.removed && sha !== undefined && known.entrySha256.equals(sha))
      diff.unchanged += 1;
    else diff.live.push(row);
  }
  return diff;
}

export interface DraftItem {
  token_hash: string;
  entry: SnapshotEntry | null;
  pwd_pack_enc: string | null;
  removed: boolean;
}

/** Champs du producteur de l'en-tête, plus ceux de la base qu'il connaît (égalité vérifiée par
 * save_). */
export interface ProducerHeader {
  kind: 'FULL' | 'DELTA';
  version: number;
  base_version: number | null;
  generated_at: string;
  valid_until: string;
  entries: number;
  removed: number;
  content_sha256: string;
}

export interface BuiltSnapshot {
  header: ProducerHeader;
  contentKeyWrapped: Buffer;
  items: DraftItem[];
}

export interface BuildInput {
  kind: 'FULL' | 'DELTA';
  operatorId: string;
  ledgerId: string;
  /** Version qui sera réservée par save_ (dernière publiée + 1) ; la base refuse l'en-tête si elle
   * diffère. */
  expectedVersion: number;
  baseVersion: number | null;
  live: readonly SourceRow[];
  removed: readonly SourceRow[];
  generatedAt: Date;
  validityMs: number;
  encryptor: EntryEncryptor;
}

const hex = (buffer: Buffer): string => buffer.toString('hex');

export function toLiveRow(row: SourceRow): LiveRow {
  if (row.entry === null) throw new Error('Ligne vivante sans entrée');
  return {
    tokenHash: row.tokenHash,
    mediaId: row.mediaId,
    entry: row.entry,
    pwdPackEnc: row.pwdPackEnc,
    pwdPackDekId: row.pwdPackDekId,
    keyIndex: row.keyIndex ?? row.entry.key_index,
    nfcUid: row.nfcUid,
  };
}

export async function buildSnapshot(input: BuildInput): Promise<BuiltSnapshot> {
  if ((input.kind === 'DELTA') !== (input.baseVersion !== null))
    throw new Error('Version de base attendue pour un DELTA, absente pour un FULL');
  const encrypted = await input.encryptor.encrypt({
    operatorId: input.operatorId,
    ledgerId: input.ledgerId,
    version: input.expectedVersion,
    rows: input.live.map(toLiveRow),
  });
  if (encrypted.entries.length !== input.live.length)
    throw new Error('Le chiffreur a rendu un nombre d’entrées différent de celui reçu');
  const byToken = new Map<string, EncryptedEntry>(
    encrypted.entries.map((entry) => [hex(entry.tokenHash), entry]),
  );
  const liveItems: DraftItem[] = input.live.map((row) => {
    const done = byToken.get(hex(row.tokenHash));
    if (!done) throw new Error('Entrée absente du résultat du chiffreur');
    return {
      token_hash: hex(row.tokenHash),
      entry: done.entry,
      pwd_pack_enc: done.pwdPackEncHex,
      removed: false,
    };
  });
  const removedItems: DraftItem[] = input.removed.map((row) => ({
    token_hash: hex(row.tokenHash),
    entry: null,
    pwd_pack_enc: null,
    removed: true,
  }));
  const items = [...liveItems, ...removedItems].sort((a, b) =>
    a.token_hash < b.token_hash ? -1 : a.token_hash > b.token_hash ? 1 : 0,
  );
  const header: ProducerHeader = {
    kind: input.kind,
    version: input.expectedVersion,
    base_version: input.baseVersion,
    generated_at: input.generatedAt.toISOString(),
    valid_until: new Date(input.generatedAt.getTime() + input.validityMs).toISOString(),
    entries: liveItems.length,
    removed: removedItems.length,
    // Même empreinte que `contentSha256`, calculée par tranches pour ne pas figer la boucle (NFR-005).
    content_sha256: await contentSha256Cooperative(
      liveItems.map((item) => item.entry as SnapshotEntry),
      removedItems.map((item) => item.token_hash),
    ),
  };
  return { header, contentKeyWrapped: encrypted.contentKeyWrapped, items };
}

/** Découpe en paquets d'au plus 5 000 (au moins un paquet, même vide). */
export function packets<T>(items: readonly T[], size = PACKET_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out.length === 0 ? [[]] : out;
}
