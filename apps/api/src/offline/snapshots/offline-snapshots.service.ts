// Snapshots hors ligne servis au terminal (contracts/snapshots.md ; R-30.5, R-30.9). Ce module ne
// signe ni ne chiffre rien : il lit `offline_snapshot_for_device` (qui choisit la version et rend la
// seule enveloppe du terminal appelant), traduit les refus, met en forme et calcule l'ETag.
// Jamais de `SELECT *` sur `offline_snapshot` ni de lecture de `content_key_wrapped` (décision du
// porteur du 02/11) ; jamais de journal d'un `pwd_pack_enc` ni d'une enveloppe.
import { Injectable } from '@nestjs/common';
import type { components } from '@cashless/contracts';
import type { TxClient } from '../../db/tenant-tx';
import type { DeviceContext } from '../../device-identity/device-identity.port';
import { ProblemException } from '../../errors/problem';
import { snapshotEtag } from './snapshot-etag';
import type { AckInput } from './offline-snapshots.dto';

export type OfflineSnapshotBody = components['schemas']['OfflineSnapshot'];

/** Snapshot prêt à servir. */
export interface ServedSnapshot {
  body: OfflineSnapshotBody;
  etag: string;
  latestVersion: string;
}

interface SnapshotRow {
  version: string;
  latest_version: string;
  header: OfflineSnapshotBody['header'];
  signature: Buffer;
  entries: { entries: Array<Record<string, unknown>>; removed_token_hashes: string[] };
  envelope: Record<string, unknown> & { agreement_key_sha256: string };
}

const RETRY_AFTER_SECONDS = 2;
/** nonce (12) + chiffré (6) + tag (16) : le blob de `media.pwd_pack_enc` (R-30.9). */
const NONCE = 12;
const BLOB = 34;
const NOT_ALLOWED_DETAILS = new Set([
  'OFFLINE_DISABLED',
  'NO_EVENT',
  'PERSONAL_PHONE',
  'SNAPSHOTS_UNAVAILABLE',
  'DEVICE_SUSPENDED',
]);

/** Découpe le blob base64 de 34 octets en `EncryptedBlob` (openapi prime sur la forme de la base). */
export function splitPwdPack(base64: string): { nonce: string; ciphertext: string; tag: string } {
  const raw = Buffer.from(base64, 'base64');
  if (raw.length !== BLOB) throw new Error('pwd_pack_enc : 34 octets attendus.');
  return {
    nonce: raw.subarray(0, NONCE).toString('base64'),
    ciphertext: raw.subarray(NONCE, BLOB - 16).toString('base64'),
    tag: raw.subarray(BLOB - 16).toString('base64'),
  };
}

function sqlCode(error: unknown): { code?: string; detail?: string } {
  return typeof error === 'object' && error !== null
    ? (error as { code?: string; detail?: string })
    : {};
}

@Injectable()
export class OfflineSnapshotsService {
  /**
   * Snapshot destiné au terminal (identité du jeton). `since === null` : sans version connue.
   * Refus : `403 DEVICE_SUSPENDED`, `403 OFFLINE_NOT_ALLOWED` (détail = motif de la base),
   * `409 CONFLICT_STATE` + `Retry-After: 2` (rien de prêt pour ce terminal).
   */
  async get(
    client: TxClient,
    device: DeviceContext,
    since: bigint | null,
  ): Promise<ServedSnapshot> {
    let row: SnapshotRow | undefined;
    try {
      const res = await client.query<SnapshotRow>(
        `SELECT version::text AS version, latest_version::text AS latest_version, header,
                signature, entries, envelope
           FROM offline_snapshot_for_device($1, $2::bigint)`,
        [device.deviceId, since === null ? null : since.toString()],
      );
      row = res.rows[0];
    } catch (error) {
      const { code, detail } = sqlCode(error);
      if (code === 'CL051') {
        if (detail === 'DEVICE_SUSPENDED') throw new ProblemException('DEVICE_SUSPENDED');
        throw new ProblemException('OFFLINE_NOT_ALLOWED', {
          detail: detail && NOT_ALLOWED_DETAILS.has(detail) ? detail : undefined,
        });
      }
      if (code === 'CL050') throw this.notReady();
      throw error;
    }
    if (!row) throw this.notReady();
    return this.shape(device, row);
  }

  /** Accusé (`ack_offline_snapshot`) ; `CL049` devient `409 SNAPSHOT_VERSION_UNKNOWN` par la carte SQLSTATE. */
  async ack(client: TxClient, device: DeviceContext, input: AckInput): Promise<void> {
    await client.query('SELECT ack_offline_snapshot($1, $2::bigint, $3)', [
      device.deviceId,
      input.version.toString(),
      input.contentSha256,
    ]);
  }

  /**
   * Dernière version du grand livre du terminal (`null` si aucune ou sans événement) et demande de
   * synchronisation (événement `CLOSING`), lues en base dans la transaction de l'appelant.
   */
  async heartbeatState(
    client: TxClient,
    device: DeviceContext,
  ): Promise<{ latestVersion: number | null; syncRequested: boolean }> {
    const { rows } = await client.query<{ latest: string | null; closing: boolean }>(
      `SELECT (SELECT max(s.version) FROM offline_snapshot s WHERE s.ledger_id = l.id)::text
                AS latest,
              e.status::text = 'CLOSING' AS closing
         FROM device d
         JOIN event e ON e.id = d.event_id
         LEFT JOIN ledger l ON l.scope_type = 'EVENT' AND l.scope_id = e.id
                           AND l.currency = e.currency
        WHERE d.id = $1`,
      [device.deviceId],
    );
    const r = rows[0];
    if (!r) return { latestVersion: null, syncRequested: false };
    if (r.latest !== null && BigInt(r.latest) > BigInt(Number.MAX_SAFE_INTEGER))
      throw new Error('latest_snapshot_version hors de la plage exacte.');
    return {
      latestVersion: r.latest === null ? null : Number(r.latest),
      syncRequested: r.closing === true,
    };
  }

  private notReady(): ProblemException {
    return new ProblemException('CONFLICT_STATE', {
      detail: 'Aucun snapshot disponible pour ce terminal pour le moment.',
      headers: { 'Retry-After': String(RETRY_AFTER_SECONDS) },
    });
  }

  private shape(device: DeviceContext, row: SnapshotRow): ServedSnapshot {
    const { entries, removed_token_hashes: removed } = row.entries;
    let hasPassword = false;
    const shaped = entries.map((e) => {
      const enc = e.pwd_pack_enc;
      if (typeof enc === 'string') {
        hasPassword = true;
        return { ...e, pwd_pack_enc: splitPwdPack(enc) };
      }
      return { ...e, pwd_pack_enc: null };
    });
    const { agreement_key_sha256: agreement, ...wrapped } = row.envelope;
    const body = {
      header: row.header,
      signature: Buffer.from(row.signature).toString('base64'),
      // Seule l'enveloppe de CE terminal est rendue par la base ; requise dès qu'une entrée a un mot de passe.
      ...(hasPassword ? { pwd_pack_key: wrapped } : {}),
      entries: shaped,
      removed_token_hashes: removed,
    } as unknown as OfflineSnapshotBody;
    return {
      body,
      etag: snapshotEtag(row.header.ledger_id, row.version, device.deviceId, agreement),
      latestVersion: row.latest_version,
    };
  }
}
