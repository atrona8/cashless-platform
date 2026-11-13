// Construction des snapshots locaux de la passerelle (WP23, T105 ; R-22 ; contrat de la mission 7
// `snapshots.md`). FICHIER À FAIRE RELIRE PAR UNE PERSONNE (cryptographie, secrets en mémoire, contenu signé).
//
// Source : `edge_media`, `edge_wallet` (+ deltas locaux), blocage RÉPLIQUÉ (`edge_wallet_state`, statut du
// bracelet répliqué). Format de la mission 7 : `FULL` ou `DELTA` de la version précédente, en-tête de 15
// champs signé, `content_sha256 = SHA-256(JCS({entries, removed_token_hashes}))` (entrées SANS
// `pwd_pack_enc`, triées par `token_hash`), mots de passe rechiffrés sous une clé de contenu `K_v` tirée
// pour la version et scellée pour chaque terminal (`sealForRecipient`, AAD `CASHLESS/SNAPKEY/v1`).
// Aucun mot de passe en clair : `PWD‖PACK` n'existe en mémoire que le temps du rechiffrement, puis est mis
// à zéro (ainsi que `K` et `K_v`). Les erreurs ne portent que des codes.
//
// Cadence : un changement BLOQUANT (retrait, statut bloquant, lot non ACTIF, portefeuille BLOQUÉ) donne une
// version dès le passage suivant du travailleur (≤ 5 s avec le pas par défaut de 1 s) ; tout autre
// changement attend 60 s depuis la dernière version ; version de maintien (`DELTA` vide) à `valid_until/3`.
import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import canonicalize from 'canonicalize';
import { snapshotKeyAad, sealForRecipient, toWrappedKey } from '@cashless/tag-format';
import { AUTHORITY, type AuthorityService } from '../authority/authority.service';
import { GATEWAY_CLOCK, type GatewayClock } from '../clock/gateway-clock';
import type { TxClient } from '../db/gateway-tx';
import {
  PackCryptoError,
  openMediaPack,
  sealForSnapshot,
  wipe,
} from '../operations/offline/pack-crypto';
import { PackKeyReader } from '../operations/offline/pack-key-reader';
import { readEffectiveBalance } from '../replication/effective-balance';
import { SnapshotSigner, type SigningKey } from './snapshot-signer';

export const SNAPSHOT_FORMAT = 'CASHLESS-SNAPSHOT/v1';
/** Délai avant une version pour un changement non bloquant (R-30.5). */
export const DELTA_AFTER_MS = 60_000;
export const FULL_EVERY_MS = 3_600_000;
export const FULL_RATIO = 0.2;
export const DEFAULT_MAX_AGE_SECONDS = 900;
const BLOCKING_STATUSES = new Set(['SUSPENDED', 'BLACKLISTED', 'REPLACED', 'RETIRED']);

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

interface Live {
  entry: SnapshotEntry;
  /** Colis sous `K_v`, au format `EncryptedBlob` (octets du JSON), ou null. */
  pack: Buffer | null;
}

const byHex = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Empreinte de contenu (R-30) : entrées sans `pwd_pack_enc`, triées, les deux clés toujours présentes. */
export function contentSha256Hex(
  entries: readonly SnapshotEntry[],
  removed: readonly string[],
): string {
  const text = canonicalize({
    entries: [...entries].sort((a, b) => byHex(a.token_hash, b.token_hash)),
    removed_token_hashes: [...removed].sort(byHex),
  });
  if (text === undefined) throw new Error('contenu non canonicalisable');
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Clé de comparaison de l'état : tout sauf l'empreinte du colis (aléatoire à chaque version). */
// Clés triées (JCS) : l'état précédent vient de jsonb, qui ne conserve pas l'ordre des clés.
const stateKey = (e: SnapshotEntry): string =>
  canonicalize({ ...e, pwd_pack_sha256: e.pwd_pack_sha256 !== null }) ?? '';

export function isBlocking(
  e: Pick<SnapshotEntry, 'status' | 'batch_status' | 'wallet_status'> | null,
): boolean {
  if (e === null) return true;
  return (
    BLOCKING_STATUSES.has(e.status) ||
    (e.batch_status !== null && e.batch_status !== 'ACTIVE') ||
    e.wallet_status === 'BLOCKED'
  );
}

export type Decision = 'none' | 'DELTA' | 'FULL' | 'KEEPALIVE';

export interface Eligible {
  deviceId: string;
  agreementKey: Buffer;
  maxAgeSeconds: number;
}

export interface BuildOutcome {
  version: number;
  kind: 'FULL' | 'DELTA';
  skippedPasswords: number;
}

interface MediaRow {
  token_hash: Buffer;
  media_id: string;
  wallet_id: string;
  status: string;
  batch_id: string | null;
  batch_status: string | null;
  uid: Buffer | null;
  counter_last: string;
  key_index: number | null;
  originality_sig_sha256: Buffer | null;
  pwd_pack_enc: Buffer | null;
  wallet_status: string | null;
}

@Injectable()
export class SnapshotBuilder {
  constructor(
    @Inject(GATEWAY_CLOCK) private readonly clock: GatewayClock,
    @Inject(SnapshotSigner) private readonly signer: SnapshotSigner,
    @Inject(PackKeyReader) private readonly packKey: PackKeyReader,
    @Inject(AUTHORITY) private readonly authority: Pick<AuthorityService, 'state'>,
  ) {}

  /** Terminaux qui reçoivent des snapshots : `ACTIVE`, clé d'accord valide, hors ligne permis. */
  async eligible(tx: TxClient): Promise<Eligible[]> {
    const { rows } = await tx.query<{
      device_id: string;
      agreement_public_key: Buffer;
      policy_in_force: Array<{
        device_id: string;
        in_force: boolean;
        offline_policy: Record<string, unknown>;
      }> | null;
    }>(
      `SELECT d.device_id, d.agreement_public_key, e.policy_in_force
         FROM edge_device d LEFT JOIN edge_event_setting e ON true
        WHERE d.status = 'ACTIVE' AND d.agreement_public_key IS NOT NULL
          AND octet_length(d.agreement_public_key) = 65
        ORDER BY d.device_id`,
    );
    const out: Eligible[] = [];
    for (const r of rows) {
      const policy = (r.policy_in_force ?? []).find(
        (c) =>
          c.device_id === r.device_id && c.in_force && c.offline_policy.offline_enabled === true,
      );
      if (!policy) continue;
      out.push({
        deviceId: r.device_id,
        agreementKey: r.agreement_public_key,
        maxAgeSeconds: Number(
          policy.offline_policy.max_snapshot_age_seconds ?? DEFAULT_MAX_AGE_SECONDS,
        ),
      });
    }
    return out;
  }

  /**
   * Un passage : décide, puis construit et publie au plus UNE version. Dans la transaction de l'appelant.
   * Rend `null` si rien n'est dû. `SnapshotSignError` : rien n'est publié.
   */
  async buildIfDue(tx: TxClient): Promise<BuildOutcome | null> {
    await tx.query(`SELECT pg_advisory_xact_lock(hashtext('edge_snapshot_build'))`);
    if ((await this.authority.state()).state !== 'ACTIVE') return null;
    const eligible = await this.eligible(tx);
    if (eligible.length === 0) return null;

    const last = await tx.query<{
      version: string;
      kind: string;
      generated_at: string;
      created_at: Date;
    }>(
      `SELECT version, kind, header->>'generated_at' AS generated_at, created_at
         FROM edge_snapshot ORDER BY version DESC LIMIT 1`,
    );
    const lastRow = last.rows[0];
    const previous = await this.previousState(tx);
    const key = await this.signer.activeKey(tx);
    const now = this.clock.now();

    const lacking = lastRow
      ? await this.devicesWithoutEnvelope(tx, Number(lastRow.version), eligible)
      : eligible.length;
    const validityMs = Math.min(...eligible.map((e) => e.maxAgeSeconds)) * 1000;

    // État courant (colis déchiffrés SEULEMENT si une version est due : voir `collect`).
    const current = await this.currentEntries(tx);
    const changes = this.diff(previous, current);
    const decision = this.decide({
      lastVersion: lastRow ? Number(lastRow.version) : 0,
      lastGeneratedAt: lastRow ? new Date(lastRow.generated_at) : null,
      lastFullAt: await this.lastFullAt(tx),
      lacking,
      total: current.size,
      changes,
      validityMs,
      now,
    });
    if (decision === 'none') return null;

    const kind: 'FULL' | 'DELTA' = decision === 'FULL' ? 'FULL' : 'DELTA';
    const nextVersion = await this.nextVersion(tx);
    return this.publish(tx, {
      kind,
      version: nextVersion,
      baseVersion: kind === 'DELTA' ? Number(lastRow!.version) : null,
      now,
      validityMs,
      key,
      eligible,
      current,
      changed: kind === 'FULL' ? [...current.keys()] : changes.changed,
      removed: kind === 'FULL' ? [] : changes.removed,
    });
  }

  decide(input: {
    lastVersion: number;
    lastGeneratedAt: Date | null;
    lastFullAt: Date | null;
    lacking: number;
    total: number;
    changes: { changed: string[]; removed: string[]; blocking: boolean };
    validityMs: number;
    now: Date;
  }): Decision {
    const age = (since: Date | null): number =>
      since === null ? 0 : Math.max(0, input.now.getTime() - since.getTime());
    if (input.lastVersion === 0) return 'FULL';
    // Terminal devenu éligible : nouvelle version complète (nouvelle clé de contenu, enveloppe pour lui).
    if (input.lacking > 0) return 'FULL';
    if (input.lastFullAt !== null && age(input.lastFullAt) > FULL_EVERY_MS) return 'FULL';
    const count = input.changes.changed.length + input.changes.removed.length;
    const sinceLast = age(input.lastGeneratedAt);
    if (count === 0) return sinceLast >= input.validityMs / 3 ? 'KEEPALIVE' : 'none';
    if (!input.changes.blocking && sinceLast < DELTA_AFTER_MS) return 'none';
    if (input.total > 0 && count / input.total > FULL_RATIO) return 'FULL';
    return 'DELTA';
  }

  // ---------------------------------------------------------------------------------- lecture de l'état

  private async lastFullAt(tx: TxClient): Promise<Date | null> {
    const { rows } = await tx.query<{ generated_at: string }>(
      `SELECT header->>'generated_at' AS generated_at FROM edge_snapshot
        WHERE kind = 'FULL' ORDER BY version DESC LIMIT 1`,
    );
    return rows[0] ? new Date(rows[0].generated_at) : null;
  }

  private async devicesWithoutEnvelope(
    tx: TxClient,
    version: number,
    eligible: Eligible[],
  ): Promise<number> {
    const { rows } = await tx.query<{ device_id: string }>(
      'SELECT device_id FROM edge_snapshot_key WHERE version = $1',
      [version],
    );
    const have = new Set(rows.map((r) => r.device_id));
    return eligible.filter((e) => !have.has(e.deviceId)).length;
  }

  private async nextVersion(tx: TxClient): Promise<number> {
    const { rows } = await tx.query<{ last: string | null; reported: string | null }>(
      `SELECT (SELECT max(version) FROM edge_snapshot) AS last,
              (SELECT max(reported_snapshot_version) FROM edge_device) AS reported`,
    );
    const r = rows[0]!;
    // Première version : au-dessus de ce que les terminaux disent déjà tenir (jamais un recul pour eux).
    return r.last !== null ? Number(r.last) + 1 : Math.max(1, Number(r.reported ?? 0) + 1);
  }

  /** Dernier état publié, par jeton, à partir du dernier FULL (retraits exclus). */
  private async previousState(tx: TxClient): Promise<Map<string, SnapshotEntry>> {
    const { rows } = await tx.query<{ token_hash: Buffer; entry: SnapshotEntry; removed: boolean }>(
      `SELECT DISTINCT ON (token_hash) token_hash, entry, removed FROM edge_snapshot_entry
        WHERE version >= COALESCE((SELECT max(version) FROM edge_snapshot WHERE kind = 'FULL'), 0)
        ORDER BY token_hash, version DESC`,
    );
    const map = new Map<string, SnapshotEntry>();
    for (const r of rows) if (!r.removed) map.set(r.token_hash.toString('hex'), r.entry);
    return map;
  }

  /** Entrées de l'état courant (sans colis : il se rechiffre seulement si une version est due). */
  private async currentEntries(tx: TxClient): Promise<Map<string, SnapshotEntry>> {
    const meta = await tx.query<{ event_id: string }>('SELECT event_id FROM edge_meta');
    const eventId = meta.rows[0]!.event_id;
    const { rows } = await tx.query<MediaRow>(
      `SELECT m.token_hash, m.media_id, m.wallet_id, m.status, m.batch_id, m.batch_status, m.uid,
              m.counter_last, m.key_index, m.originality_sig_sha256, m.pwd_pack_enc,
              COALESCE(ws.status, w.status) AS wallet_status
         FROM edge_media m
         JOIN edge_wallet w ON w.wallet_id = m.wallet_id
         LEFT JOIN edge_wallet_state ws ON ws.wallet_id = m.wallet_id
        WHERE m.media_id IS NOT NULL AND m.wallet_id IS NOT NULL
        ORDER BY m.token_hash`,
    );
    const spendable = new Map<string, number>();
    const out = new Map<string, SnapshotEntry>();
    for (const r of rows) {
      let value = spendable.get(r.wallet_id);
      if (value === undefined) {
        const b = await readEffectiveBalance(tx, r.wallet_id);
        const sum = b.paid + b.promo;
        if (sum > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('solde hors des entiers sûrs');
        value = Number(sum);
        spendable.set(r.wallet_id, value);
      }
      const hex = r.token_hash.toString('hex');
      out.set(hex, {
        token_hash: hex,
        nfc_uid: r.uid ? r.uid.toString('hex') : null,
        key_index: r.key_index ?? 0,
        originality_sig_sha256: r.originality_sig_sha256
          ? r.originality_sig_sha256.toString('hex')
          : null,
        status: r.status,
        batch_event_id: r.batch_id === null ? null : eventId,
        batch_status: r.batch_status,
        wallet_status: r.wallet_status ?? 'BLOCKED',
        spendable: value,
        last_counter: Number(r.counter_last),
        // Provisoire : présence du colis (l'empreinte réelle est posée à la publication, au rechiffrement).
        pwd_pack_sha256: r.pwd_pack_enc !== null && r.uid !== null ? 'PENDING' : null,
      });
    }
    return out;
  }

  private diff(
    previous: Map<string, SnapshotEntry>,
    current: Map<string, SnapshotEntry>,
  ): { changed: string[]; removed: string[]; blocking: boolean } {
    const changed: string[] = [];
    let blocking = false;
    for (const [hex, entry] of current) {
      const before = previous.get(hex);
      if (!before || stateKey(before) !== stateKey(entry)) {
        changed.push(hex);
        if (isBlocking(entry)) blocking = true;
      }
    }
    const removed = [...previous.keys()].filter((hex) => !current.has(hex));
    if (removed.length > 0) blocking = true;
    return { changed, removed, blocking };
  }

  // ------------------------------------------------------------------------------------- publication

  private async publish(
    tx: TxClient,
    p: {
      kind: 'FULL' | 'DELTA';
      version: number;
      baseVersion: number | null;
      now: Date;
      validityMs: number;
      key: SigningKey;
      eligible: Eligible[];
      current: Map<string, SnapshotEntry>;
      changed: string[];
      removed: string[];
    },
  ): Promise<BuildOutcome> {
    const meta = await tx.query<{
      operator_id: string;
      event_id: string;
      ledger_id: string;
      currency: string | null;
      epoch: string;
    }>(
      `SELECT m.operator_id, m.event_id, m.ledger_id, e.currency, a.epoch
         FROM edge_meta m LEFT JOIN edge_event_setting e ON true CROSS JOIN edge_authority a`,
    );
    const m = meta.rows[0]!;
    if (m.currency === null) return { version: 0, kind: p.kind, skippedPasswords: 0 };
    const version = BigInt(p.version);

    let contentKey: Buffer | null = null;
    let kv: Buffer | undefined;
    const lives: Live[] = [];
    let skipped = 0;
    try {
      kv = randomBytes(32);
      const needsPack = p.changed.some((hex) => p.current.get(hex)!.pwd_pack_sha256 !== null);
      if (needsPack) {
        try {
          contentKey = await this.packKey.open(tx);
        } catch (error) {
          if (!(error instanceof PackCryptoError)) throw error;
          contentKey = null;
        }
      }
      const packs = await this.storedPacks(tx, p.changed);
      for (const hex of p.changed) {
        const entry = { ...p.current.get(hex)! };
        const stored = packs.get(hex);
        let pack: Buffer | null = null;
        if (entry.pwd_pack_sha256 !== null && stored && contentKey !== null && entry.nfc_uid) {
          let pwdPack: Buffer | undefined;
          try {
            pwdPack = openMediaPack({
              contentKey,
              stored: stored.enc,
              mediaId: stored.mediaId,
              operatorId: m.operator_id,
              keyIndex: entry.key_index,
              uid: Buffer.from(entry.nfc_uid, 'hex'),
            });
            const sealed = sealForSnapshot({
              snapshotKey: kv,
              pwdPack,
              ledgerId: m.ledger_id,
              version,
              tokenHash: Buffer.from(hex, 'hex'),
              uid: Buffer.from(entry.nfc_uid, 'hex'),
            });
            entry.pwd_pack_sha256 = sealed.sha256;
            pack = Buffer.from(JSON.stringify(sealed.blob), 'utf8');
          } catch (error) {
            if (!(error instanceof PackCryptoError)) throw error;
            entry.pwd_pack_sha256 = null;
            skipped += 1;
          } finally {
            wipe(pwdPack);
          }
        } else {
          if (entry.pwd_pack_sha256 !== null) skipped += 1;
          entry.pwd_pack_sha256 = null;
        }
        lives.push({ entry, pack });
      }

      const entries = lives.map((l) => l.entry);
      const contentSha = contentSha256Hex(entries, p.removed);
      const header = {
        format: SNAPSHOT_FORMAT,
        kind: p.kind,
        operator_id: m.operator_id,
        ledger_id: m.ledger_id,
        event_id: m.event_id,
        currency: m.currency,
        version: p.version,
        base_version: p.baseVersion,
        generated_at: p.now.toISOString(),
        valid_until: new Date(p.now.getTime() + p.validityMs).toISOString(),
        entries: entries.length,
        removed: p.removed.length,
        content_sha256: contentSha,
        authority_epoch: Number(m.epoch),
        key_id: p.key.keyId,
      };
      const signature = await this.signer.sign(header, p.key);

      await tx.query(
        `INSERT INTO edge_snapshot (version, kind, base_version, header, signature, signing_kid,
                                    content_sha256, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)`,
        [
          p.version,
          p.kind,
          p.baseVersion,
          JSON.stringify(header),
          signature,
          p.key.keyId,
          Buffer.from(contentSha, 'hex'),
          p.now,
        ],
      );
      for (const live of lives) {
        await tx.query(
          `INSERT INTO edge_snapshot_entry (version, token_hash, entry, pwd_pack_enc, removed)
           VALUES ($1, $2, $3::jsonb, $4, false)`,
          [
            p.version,
            Buffer.from(live.entry.token_hash, 'hex'),
            JSON.stringify(live.entry),
            live.pack,
          ],
        );
      }
      for (const hex of p.removed) {
        await tx.query(
          `INSERT INTO edge_snapshot_entry (version, token_hash, entry, pwd_pack_enc, removed)
           VALUES ($1, $2, '{}'::jsonb, NULL, true)`,
          [p.version, Buffer.from(hex, 'hex')],
        );
      }
      for (const device of p.eligible) {
        const blob = sealForRecipient({
          recipientPublicKey: device.agreementKey,
          plaintext: kv,
          aad: snapshotKeyAad(m.ledger_id, version, device.deviceId),
        });
        await tx.query(
          'INSERT INTO edge_snapshot_key (version, device_id, envelope) VALUES ($1, $2, $3::jsonb)',
          [p.version, device.deviceId, JSON.stringify(toWrappedKey(blob))],
        );
      }
      return { version: p.version, kind: p.kind, skippedPasswords: skipped };
    } finally {
      wipe(kv, contentKey);
    }
  }

  private async storedPacks(
    tx: TxClient,
    tokens: string[],
  ): Promise<Map<string, { enc: Buffer; mediaId: string }>> {
    const out = new Map<string, { enc: Buffer; mediaId: string }>();
    if (tokens.length === 0) return out;
    const { rows } = await tx.query<{ token_hash: Buffer; pwd_pack_enc: Buffer; media_id: string }>(
      `SELECT token_hash, pwd_pack_enc, media_id FROM edge_media
        WHERE token_hash = ANY($1::bytea[]) AND pwd_pack_enc IS NOT NULL AND media_id IS NOT NULL`,
      [tokens.map((hex) => Buffer.from(hex, 'hex'))],
    );
    for (const r of rows)
      out.set(r.token_hash.toString('hex'), { enc: r.pwd_pack_enc, mediaId: r.media_id });
    return out;
  }
}
