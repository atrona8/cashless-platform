// Lecture et accusé des snapshots par un terminal (WP23, T105 ; contrat de la mission 7 `snapshots.md`).
// Ce service ne signe ni ne chiffre rien : il choisit la version, rend l'enveloppe du SEUL terminal appelant
// et traduit les refus. Les mots de passe ne sont jamais en clair : chaque entrée porte son colis chiffré sous
// `K_v`, et `K_v` n'existe que scellée pour ce terminal (`edge_snapshot_key`).
import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AUTHORITY, type AuthorityService } from '../authority/authority.service';
import type { TxClient } from '../db/gateway-tx';
import type { AuthenticatedDevice } from '../device-proofs/device-proofs.guard';
import { ProblemException } from '../device-proofs/problem';
import type { LocalSnapshotState } from '../device/ports';
import { SnapshotBuilder } from './snapshot-builder';
import { SnapshotSigner } from './snapshot-signer';

export const RETRY_AFTER_SECONDS = 2;
/** Au-delà de 5 pas entre `b` et la dernière version, le dernier FULL est servi. */
export const MAX_DELTA_STEPS = 5;

export interface ServedSnapshot {
  body: Record<string, unknown>;
  etag: string;
  latestVersion: number;
}

interface SnapshotRow {
  version: string;
  kind: 'FULL' | 'DELTA';
  base_version: string | null;
  header: Record<string, unknown>;
  signature: Buffer;
}

@Injectable()
export class SnapshotsService implements LocalSnapshotState {
  constructor(
    @Inject(AUTHORITY) private readonly authority: Pick<AuthorityService, 'state'>,
    @Inject(SnapshotBuilder) private readonly builder: SnapshotBuilder,
    @Inject(SnapshotSigner) private readonly signer: SnapshotSigner,
  ) {}

  /** Dernière version dont le terminal détient l'enveloppe (battement de cœur) ; `null` si aucune. */
  async latestVersion(tx: TxClient, deviceId: string): Promise<number | null> {
    const { rows } = await tx.query<{ v: string | null }>(
      'SELECT max(version) AS v FROM edge_snapshot_key WHERE device_id = $1',
      [deviceId],
    );
    return rows[0]?.v == null ? null : Number(rows[0].v);
  }

  async get(
    tx: TxClient,
    device: AuthenticatedDevice,
    since: number | null,
  ): Promise<ServedSnapshot> {
    if ((await this.authority.state()).state === 'REVOKED')
      throw new ProblemException('CONFLICT_STATE', { detail: 'GATEWAY_NOT_AUTHORITY' });
    // Hors ligne interdit, clé de signature absente (purgée), terminal sans clé d'accord : 403.
    const eligible = (await this.builder.eligible(tx)).find((e) => e.deviceId === device.deviceId);
    if (!eligible || !(await this.signer.available()))
      throw new ProblemException('OFFLINE_NOT_ALLOWED', {
        detail: !eligible ? 'OFFLINE_DISABLED' : 'SNAPSHOTS_UNAVAILABLE',
      });

    const latestRow = await tx.query<{ v: string | null }>(
      'SELECT max(version) AS v FROM edge_snapshot_key WHERE device_id = $1',
      [device.deviceId],
    );
    if (latestRow.rows[0]?.v == null) throw this.notReady();
    const latest = Number(latestRow.rows[0].v);
    const target = await this.pick(tx, device.deviceId, since, latest);
    if (target === null) throw this.notReady();

    const entries = await tx.query<{
      entry: Record<string, unknown>;
      pwd_pack_enc: Buffer | null;
      removed: boolean;
    }>(
      `SELECT entry, pwd_pack_enc, removed FROM edge_snapshot_entry
        WHERE version = $1 ORDER BY token_hash`,
      [target.version],
    );
    let hasPassword = false;
    const live: Record<string, unknown>[] = [];
    const removed: string[] = [];
    const removedRows = await tx.query<{ token_hash: Buffer }>(
      'SELECT token_hash FROM edge_snapshot_entry WHERE version = $1 AND removed ORDER BY token_hash',
      [target.version],
    );
    for (const r of removedRows.rows) removed.push(r.token_hash.toString('hex'));
    for (const r of entries.rows) {
      if (r.removed) continue;
      let pack: unknown = null;
      if (r.pwd_pack_enc !== null) {
        hasPassword = true;
        pack = JSON.parse(r.pwd_pack_enc.toString('utf8'));
      }
      // Les colis de la version sont rendus tels que stockés (chiffrés sous K_v), jamais déchiffrés ici.
      const { pwd_pack_sha256: sha, ...rest } = r.entry as Record<string, unknown>;
      live.push({ ...rest, pwd_pack_sha256: sha ?? null, pwd_pack_enc: pack });
    }
    const env = await tx.query<{ envelope: Record<string, unknown> }>(
      'SELECT envelope FROM edge_snapshot_key WHERE version = $1 AND device_id = $2',
      [target.version, device.deviceId],
    );
    const body = {
      header: target.header,
      signature: target.signature.toString('base64'),
      ...(hasPassword ? { pwd_pack_key: env.rows[0]!.envelope } : {}),
      entries: live,
      removed_token_hashes: removed,
    };
    const ledger = String(target.header.ledger_id);
    const agreement = createHash('sha256').update(eligible.agreementKey).digest('hex');
    return {
      body,
      etag: `"${ledger}:${target.version}:${device.deviceId}:${agreement}"`,
      latestVersion: latest,
    };
  }

  /** Version servie (contrat `snapshots.md`), parmi celles dont CE terminal détient l'enveloppe. */
  private async pick(
    tx: TxClient,
    deviceId: string,
    since: number | null,
    latest: number,
  ): Promise<SnapshotRow | null> {
    const select = `SELECT s.version, s.kind, s.base_version, s.header, s.signature
                      FROM edge_snapshot s
                      JOIN edge_snapshot_key k ON k.version = s.version AND k.device_id = $1`;
    const full = async (): Promise<SnapshotRow | null> =>
      (
        await tx.query<SnapshotRow>(
          `${select} WHERE s.kind = 'FULL' ORDER BY s.version DESC LIMIT 1`,
          [deviceId],
        )
      ).rows[0] ?? null;
    const lastFull = await full();
    if (since === null || since >= latest) {
      if (since !== null && since >= latest) {
        return (
          (await tx.query<SnapshotRow>(`${select} WHERE s.version = $2`, [deviceId, latest]))
            .rows[0] ?? null
        );
      }
      return lastFull;
    }
    if (lastFull && Number(lastFull.version) > since) return lastFull;
    if (latest - since > MAX_DELTA_STEPS) return lastFull;
    const next = (
      await tx.query<SnapshotRow>(`${select} WHERE s.version > $2 ORDER BY s.version ASC LIMIT 1`, [
        deviceId,
        since,
      ])
    ).rows[0];
    if (!next) return lastFull;
    // Un DELTA ne s'applique qu'à sa base : sinon le dernier FULL.
    if (next.kind === 'DELTA' && Number(next.base_version) !== since) return lastFull;
    return next;
  }

  private notReady(): ProblemException {
    return new ProblemException('CONFLICT_STATE', {
      detail: 'Aucun snapshot disponible pour ce terminal pour le moment.',
      headers: { 'Retry-After': String(RETRY_AFTER_SECONDS) },
    });
  }

  /**
   * Accusé : la version doit avoir été enveloppée pour CE terminal et l'empreinte égale (sinon `409
   * SNAPSHOT_VERSION_UNKNOWN`). `204` idempotent ; `reported_snapshot_version` ne recule jamais.
   */
  async ack(
    tx: TxClient,
    device: AuthenticatedDevice,
    input: { version: number; contentSha256: Buffer },
  ): Promise<void> {
    const { rows } = await tx.query<{ content_sha256: Buffer }>(
      `SELECT s.content_sha256 FROM edge_snapshot s
         JOIN edge_snapshot_key k ON k.version = s.version AND k.device_id = $1
        WHERE s.version = $2`,
      [device.deviceId, input.version],
    );
    const row = rows[0];
    if (!row || !row.content_sha256.equals(input.contentSha256))
      throw new ProblemException('SNAPSHOT_VERSION_UNKNOWN');
    await tx.query(
      `INSERT INTO edge_snapshot_ack (device_id, version) VALUES ($1, $2)
       ON CONFLICT (device_id, version) DO NOTHING`,
      [device.deviceId, input.version],
    );
    await tx.query(
      `UPDATE edge_device SET reported_snapshot_version = GREATEST(COALESCE(reported_snapshot_version, 0), $2)
        WHERE device_id = $1`,
      [device.deviceId, input.version],
    );
  }
}
