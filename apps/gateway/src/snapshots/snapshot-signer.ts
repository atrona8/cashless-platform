// Signature des snapshots par la clé PROPRE de la passerelle (WP23, T105 ; R-22, interfaces.md § 4).
// FICHIER À FAIRE RELIRE PAR UNE PERSONNE (cryptographie, rotation de clé).
//
// La clé privée ne sort jamais du port (`HARDWARE_KEYSTORE.sign('snapshot', ...)`, aucune méthode
// d'export). Le port tient UNE clé par usage : quand sa clé publique change (rotation côté matériel), la
// ligne `edge_snapshot_signing_key` ACTIVE passe RETIRED et une nouvelle devient ACTIVE. `config.snapshot_keys`
// publie AU PLUS DEUX clés (ACTIVE et la dernière RETIRED encore valable `RETIRED_VALID_MS`), jamais une
// troisième. Signature : ECDSA P-256 / SHA-256 de `JCS(header)`, DER, base64 (contrat `OfflineSnapshot`).
// Le port rend du P1363 (r‖s) : converti en DER ici. Une signature qui ne se vérifie pas avec la clé
// publique du port est un défaut : rien n'est publié (`SnapshotSignError`).
import { createPublicKey, verify } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import canonicalize from 'canonicalize';
import { GATEWAY_CLOCK, type GatewayClock } from '../clock/gateway-clock';
import type { TxClient } from '../db/gateway-tx';
import type { GatewaySnapshotKeys, SnapshotKeyView } from '../device/ports';
import { HARDWARE_KEYSTORE, type HardwareKeystore } from '../key-store/hardware-keystore.port';

/** Une clé retirée vérifie encore les snapshots émis avant sa rotation, pendant au plus une heure. */
export const RETIRED_VALID_MS = 3_600_000;
export const MAX_PUBLISHED_KEYS = 2;

export class SnapshotSignError extends Error {
  constructor(readonly code: 'KEY_UNAVAILABLE' | 'SIGNATURE_DEFECT') {
    super(code);
    this.name = 'SnapshotSignError';
  }
}

/** Signature IEEE P1363 (r‖s, 64 octets) -> DER (SEQUENCE de deux INTEGER). */
export function p1363ToDer(signature: Buffer): Buffer {
  if (signature.length !== 64) throw new SnapshotSignError('SIGNATURE_DEFECT');
  const integer = (bytes: Buffer): Buffer => {
    let i = 0;
    while (i < bytes.length - 1 && bytes[i] === 0) i += 1;
    let v = bytes.subarray(i);
    if (v[0]! & 0x80) v = Buffer.concat([Buffer.from([0]), v]);
    return Buffer.concat([Buffer.from([0x02, v.length]), v]);
  };
  const body = Buffer.concat([integer(signature.subarray(0, 32)), integer(signature.subarray(32))]);
  return Buffer.concat([Buffer.from([0x30, body.length]), body]);
}

export interface SigningKey {
  keyId: string;
  publicKey: Buffer;
}

@Injectable()
export class SnapshotSigner implements GatewaySnapshotKeys {
  constructor(
    @Inject(HARDWARE_KEYSTORE) private readonly keystore: HardwareKeystore,
    @Inject(GATEWAY_CLOCK) private readonly clock: GatewayClock,
  ) {}

  /**
   * La clé ACTIVE du port, enregistrée (rotation comprise). Dans la transaction de l'appelant.
   * `SnapshotSignError('KEY_UNAVAILABLE')` si le port refuse (clé détruite par la purge).
   */
  async activeKey(tx: TxClient): Promise<SigningKey> {
    let publicKey: Buffer;
    try {
      publicKey = await this.keystore.publicKey('snapshot');
    } catch {
      throw new SnapshotSignError('KEY_UNAVAILABLE');
    }
    await tx.query(`SELECT pg_advisory_xact_lock(hashtext('edge_snapshot_signing_key'))`);
    const { rows } = await tx.query<{ key_id: string; seq: number; public_key: Buffer }>(
      `SELECT key_id, seq, public_key FROM edge_snapshot_signing_key WHERE status = 'ACTIVE'`,
    );
    const active = rows[0];
    if (active && active.public_key.equals(publicKey)) {
      return { keyId: active.key_id, publicKey };
    }
    if (active) {
      await tx.query(
        `UPDATE edge_snapshot_signing_key SET status = 'RETIRED', retired_at = $2 WHERE key_id = $1`,
        [active.key_id, this.clock.now()],
      );
    }
    const next = await tx.query<{ seq: number; gateway_id: string }>(
      `SELECT COALESCE((SELECT max(seq) FROM edge_snapshot_signing_key), 0) + 1 AS seq,
              (SELECT gateway_id FROM edge_meta) AS gateway_id`,
    );
    const seq = Number(next.rows[0]!.seq);
    const keyId = `edge:${next.rows[0]!.gateway_id}:snap:${seq}`;
    await tx.query(
      `INSERT INTO edge_snapshot_signing_key (key_id, seq, public_key, status) VALUES ($1, $2, $3, 'ACTIVE')`,
      [keyId, seq, publicKey],
    );
    return { keyId, publicKey };
  }

  /** JCS(header) signé par le port, en DER, vérifié avec la clé publique du port avant tout usage. */
  async sign(header: Record<string, unknown>, key: SigningKey): Promise<Buffer> {
    const canonical = canonicalize(header);
    if (canonical === undefined) throw new SnapshotSignError('SIGNATURE_DEFECT');
    const data = Buffer.from(canonical, 'utf8');
    let der: Buffer;
    try {
      der = p1363ToDer(await this.keystore.sign('snapshot', data));
    } catch (error) {
      if (error instanceof SnapshotSignError) throw error;
      throw new SnapshotSignError('KEY_UNAVAILABLE');
    }
    const ok = verify(
      'sha256',
      data,
      {
        key: createPublicKey({ key: key.publicKey, format: 'der', type: 'spki' }),
        dsaEncoding: 'der',
      },
      der,
    );
    if (!ok) throw new SnapshotSignError('SIGNATURE_DEFECT');
    return der;
  }

  /** La clé ACTIVE existe-t-elle et le port peut-il signer ? (sans écrire). */
  async available(): Promise<boolean> {
    try {
      await this.keystore.publicKey('snapshot');
      return true;
    } catch {
      return false;
    }
  }

  /** `GATEWAY_SNAPSHOT_KEYS` : clés publiques publiées dans `config.snapshot_keys` (deux au plus). */
  async list(tx: TxClient): Promise<SnapshotKeyView[]> {
    try {
      await this.activeKey(tx);
    } catch (error) {
      if (!(error instanceof SnapshotSignError)) throw error;
      // Port détruit : plus de clé ACTIVE publiable, les clés RETIRÉES restent listées jusqu'à leur terme.
    }
    const now = this.clock.now().getTime();
    const { rows } = await tx.query<{
      key_id: string;
      public_key: Buffer;
      status: string;
      retired_at: Date | null;
    }>(
      `SELECT key_id, public_key, status, retired_at FROM edge_snapshot_signing_key ORDER BY seq DESC`,
    );
    const views: SnapshotKeyView[] = [];
    for (const r of rows) {
      if (views.length >= MAX_PUBLISHED_KEYS) break;
      if (r.status === 'RETIRED') {
        const until = r.retired_at!.getTime() + RETIRED_VALID_MS;
        if (until <= now) continue;
        views.push({
          key_id: r.key_id,
          algorithm: 'ECDSA_P256_SHA256',
          public_key: r.public_key.toString('base64'),
          not_after: new Date(until).toISOString(),
        });
      } else if (await this.available()) {
        views.push({
          key_id: r.key_id,
          algorithm: 'ECDSA_P256_SHA256',
          public_key: r.public_key.toString('base64'),
          not_after: null,
        });
      }
    }
    return views;
  }
}
