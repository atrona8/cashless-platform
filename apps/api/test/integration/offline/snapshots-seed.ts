// Amorçage des snapshots pour les tests de WP15 : tout passe par les FONCTIONS SQL de la mission
// (`rotate_snapshot_signing_key`, `save_offline_snapshot_draft`, `publish_offline_snapshot`,
// `wrap_offline_snapshot_key`) sous le propriétaire ; jamais d'insertion qui les contourne.
// La signature est un bouchon (la base ne la vérifie pas) et les enveloppes sont des textes de forme
// valide : l'API sous test ne les ouvre pas.
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import type { Client } from 'pg';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

export interface SeedEntry {
  token: string;
  /** PWD||PACK de 34 octets (nonce 12, chiffré 6, tag 16), ou `null`. */
  pwdPack: Buffer | null;
  spendable?: number;
}

export function seedEntry(n: number, withPassword: boolean): SeedEntry {
  return {
    token: sha(Buffer.from(`wp15-token-${n}`)),
    pwdPack: withPassword ? randomBytes(34) : null,
    spendable: 1000 + n,
  };
}

/**
 * Vrai si une clé CENTRAL ACTIVE de la plateforme (sans prestataire) existe : `snapshot_public_keys`
 * la rend alors à un prestataire sans clé propre. Cette suite n'en crée ni n'en touche jamais.
 */
export async function platformKeyExists(db: Client): Promise<boolean> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM snapshot_signing_key
      WHERE owner = 'CENTRAL' AND operator_id IS NULL AND status = 'ACTIVE'`,
  );
  return rows[0]!.n > 0;
}

/**
 * Nouvelle clé de signature CENTRAL ACTIVE PROPRE au prestataire (`operator_id` = lui) ; l'ancienne
 * ACTIVE passe RETIRED, la plus ancienne RETIRED passe REVOKED (au plus deux valides, CL054). Aucune
 * clé d'un autre prestataire ni de la plateforme n'est lue ni modifiée. Rend le `key_id`.
 */
export async function rotateOwnKey(db: Client, operatorId: string, label: string): Promise<string> {
  const keyId = `wp15-${label}-${randomUUID().slice(0, 8)}`;
  const spki = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({
    type: 'spki',
    format: 'der',
  });
  const own = "owner = 'CENTRAL' AND operator_id = $1";
  await db.query(
    `UPDATE snapshot_signing_key SET status = 'REVOKED'
      WHERE ${own} AND status = 'RETIRED'`,
    [operatorId],
  );
  await db.query(
    `UPDATE snapshot_signing_key SET status = 'RETIRED', retired_at = clock_timestamp()
      WHERE ${own} AND status = 'ACTIVE'`,
    [operatorId],
  );
  await db.query(
    `INSERT INTO snapshot_signing_key (key_id, operator_id, owner, algorithm, public_key, kms_key_ref, status)
     VALUES ($1, $2, 'CENTRAL', 'ECDSA_P256_SHA256', $3, $4, 'ACTIVE')`,
    [keyId, operatorId, spki, `test:${keyId}`],
  );
  return keyId;
}

export interface PublishInput {
  operatorId: string;
  ledgerId: string;
  kind: 'FULL' | 'DELTA';
  entries: SeedEntry[];
  removed?: string[];
}

/** Publie une version (brouillon, scellé, publié) ; rend `{version, contentSha256}`. */
export async function publishVersion(
  db: Client,
  input: PublishInput,
): Promise<{ version: string; contentSha256: string }> {
  await db.query("SELECT set_config('app.operator_id', $1, false)", [input.operatorId]);
  const removed = input.removed ?? [];
  const contentSha256 = sha(randomBytes(16));
  const now = new Date();
  const header = {
    kind: input.kind,
    generated_at: now.toISOString(),
    valid_until: new Date(now.getTime() + 15 * 60_000).toISOString(),
    entries: input.entries.length,
    removed: removed.length,
    content_sha256: contentSha256,
  };
  const items = [
    ...input.entries.map((e) => ({
      token_hash: e.token,
      entry: {
        token_hash: e.token,
        nfc_uid: '04' + e.token.slice(0, 12),
        key_index: 1,
        originality_sig_sha256: sha(Buffer.from(`sig-${e.token}`)),
        status: 'ACTIVE',
        batch_event_id: null,
        batch_status: null,
        wallet_status: 'ACTIVE',
        spendable: e.spendable ?? 0,
        last_counter: 3,
        pwd_pack_sha256: e.pwdPack ? sha(e.pwdPack) : null,
      },
      pwd_pack_enc: e.pwdPack ? e.pwdPack.toString('hex') : null,
      removed: false,
    })),
    ...removed.map((t) => ({ token_hash: t, entry: null, pwd_pack_enc: null, removed: true })),
  ];
  const { rows: draft } = await db.query<{ id: string }>(
    'SELECT save_offline_snapshot_draft($1, $2, $3, $4, $5) AS id',
    [
      input.ledgerId,
      input.kind,
      JSON.stringify(header),
      Buffer.from('0102', 'hex'),
      JSON.stringify(items),
    ],
  );
  await db.query('SELECT seal_offline_snapshot_draft($1)', [draft[0]!.id]);
  const { rows: key } = await db.query<{ key_id: string }>(
    "SELECT key_id FROM snapshot_signing_key WHERE owner = 'CENTRAL' AND status = 'ACTIVE' AND operator_id = $1",
    [input.operatorId],
  );
  const { rows } = await db.query<{ version: string }>(
    'SELECT version::text AS version FROM publish_offline_snapshot($1, $2, $3)',
    [draft[0]!.id, key[0]!.key_id, Buffer.from('3045', 'hex')],
  );
  return { version: rows[0]!.version, contentSha256 };
}

/** Enveloppe de `tag` pour ce terminal et cette version (clé d'accord courante). */
export async function wrapFor(
  db: Client,
  operatorId: string,
  ledgerId: string,
  version: string,
  deviceId: string,
  tag: string,
): Promise<void> {
  await db.query("SELECT set_config('app.operator_id', $1, false)", [operatorId]);
  await db.query(
    `SELECT wrap_offline_snapshot_key($1, $2::bigint, $3,
              (SELECT sha256(agreement_public_key) FROM device WHERE id = $3), $4::jsonb)`,
    [
      ledgerId,
      version,
      deviceId,
      JSON.stringify({
        alg: 'ECDH-ES+HKDF-SHA256+A256GCM',
        epk: `epk-${tag}`,
        iv: `iv-${tag}`,
        wrapped_key: `wk-${tag}`,
      }),
    ],
  );
}
