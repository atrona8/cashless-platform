// `createTap` et la table locale `edge_tap` (T093 ; research R-18). Un passage n'est PAS une
// décision : rien n'entre dans la file. Le `tap_id` est local (suite démarrée à 2^52, disjointe de
// celle du central), n'entre jamais dans le contenu haché et n'est jamais envoyé au central ; le
// central enregistre le passage depuis l'objet `tap` de l'opération.
//
// Règles (miroir de `register_tap` du central, sur les données répliquées) :
//  - bracelet absent ou sans `media_id` (WP18 : non utilisable) : `UNKNOWN`, aucun passage ;
//  - statut du bracelet, UID, signature d'originalité (SHA-256 des 32 octets comparé à la copie),
//    statut du lot ;
//  - anti-clone : le compteur doit être STRICTEMENT supérieur au compteur répliqué ET au plus grand
//    compteur déjà vu ici ; la même lecture (même terminal, même UID, même compteur) jamais
//    utilisée, ou renvoyée dans `tap_replay_window_seconds`, est réutilisée ; toute autre est
//    `CLONE_SUSPECTED` (audit local ; la passerelle n'a aucun moyen d'écrire la liste noire au
//    central).
import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { GATEWAY_CLOCK, type GatewayClock } from '../../clock/gateway-clock';
import { GatewayTx, type TxClient } from '../../db/gateway-tx';
import type { AuthenticatedDevice } from '../../device-proofs/device-proofs.guard';
import { NonceStore } from '../../device-proofs/nonce-store';
import { ProblemException } from '../../device-proofs/problem';
import { ReplicationService } from '../../replication/replication.service';
import {
  assertNotRevoked,
  iso,
  objectBody,
  parseTapReading,
  readEventSettings,
  type EventSettings,
  type TapReading,
} from './sales-support';

export type TapResult =
  | 'OK'
  | 'UNKNOWN'
  | 'BLOCKED'
  | 'UID_MISMATCH'
  | 'SIGNATURE_MISMATCH'
  | 'SIGNATURE_MISSING'
  | 'CLONE_SUSPECTED'
  | 'RETIRED'
  | 'REPLACED'
  | 'NOT_ACTIVATED'
  | 'RELEASED'
  | 'BATCH_INACTIVE'
  | 'WRONG_EVENT';

export interface MediaRow {
  token_hash: Buffer;
  media_id: string | null;
  wallet_id: string | null;
  status: string;
  batch_status: string | null;
  uid: Buffer | null;
  counter_last: string;
  originality_sig_sha256: Buffer | null;
}

export interface TapOutcome {
  result: TapResult;
  tapId: string | null;
  createdAt: Date | null;
  media: MediaRow | null;
  /** Lecture complète enregistrée avec le passage (objet `tap` de l'opération). */
  wire: Record<string, unknown> | null;
}

/** Code d'erreur de paiement (`MEDIA_*`) d'un résultat de lecture qui refuse l'écriture. */
const TAP_REFUSALS: Record<
  Exclude<TapResult, 'OK'>,
  ConstructorParameters<typeof ProblemException>[0]
> = {
  UNKNOWN: 'MEDIA_UNKNOWN',
  BLOCKED: 'MEDIA_BLOCKED',
  UID_MISMATCH: 'MEDIA_UID_MISMATCH',
  SIGNATURE_MISMATCH: 'MEDIA_SIGNATURE_MISMATCH',
  SIGNATURE_MISSING: 'MEDIA_SIGNATURE_MISSING',
  CLONE_SUSPECTED: 'MEDIA_CLONE_SUSPECTED',
  RETIRED: 'MEDIA_RETIRED',
  REPLACED: 'MEDIA_REPLACED',
  NOT_ACTIVATED: 'MEDIA_NOT_ACTIVATED',
  RELEASED: 'MEDIA_RELEASED',
  BATCH_INACTIVE: 'MEDIA_BATCH_INACTIVE',
  WRONG_EVENT: 'MEDIA_WRONG_EVENT',
};

export function tapRefusal(result: Exclude<TapResult, 'OK'>): ProblemException {
  return new ProblemException(TAP_REFUSALS[result]);
}

/** Résultat d'un bracelet d'après son statut seul (ordre de `register_tap`). */
export function statusResult(status: string): Exclude<TapResult, 'OK'> | 'ACTIVE' {
  if (status === 'RETIRED' || status === 'DESTROYED') return 'RETIRED';
  if (status === 'REPLACED') return 'REPLACED';
  if (status === 'PERSONALIZED' || status === 'ISSUED') return 'NOT_ACTIVATED';
  if (status === 'RELEASED') return 'RELEASED';
  return status === 'ACTIVE' ? 'ACTIVE' : 'BLOCKED';
}

const sha256 = (data: Buffer): Buffer => createHash('sha256').update(data).digest();

export async function readMedia(tx: TxClient, tokenHash: Buffer): Promise<MediaRow | null> {
  const { rows } = await tx.query<MediaRow>(
    `SELECT token_hash, media_id, wallet_id, status, batch_status, uid, counter_last,
            originality_sig_sha256
       FROM edge_media WHERE token_hash = $1`,
    [tokenHash],
  );
  return rows[0] ?? null;
}

@Injectable()
export class TapsService {
  constructor(
    @Inject(GatewayTx) private readonly gatewayTx: GatewayTx,
    @Inject(NonceStore) private readonly nonces: NonceStore,
    @Inject(GATEWAY_CLOCK) private readonly clock: GatewayClock,
    @Inject(ReplicationService) private readonly replication: ReplicationService,
  ) {}

  async createTap(device: AuthenticatedDevice, rawBody: unknown): Promise<Record<string, unknown>> {
    const reading = parseTapReading(objectBody(rawBody), 'corps');
    return this.gatewayTx.run(async (tx) => {
      await this.nonces.consumeOrThrow(tx, device.deviceId, device.proof);
      await assertNotRevoked(tx);
      const settings = await readEventSettings(tx);
      if (!settings) throw new ProblemException('CONFLICT_STATE', { detail: 'EVENT_UNKNOWN' });
      const outcome = await this.register(tx, device.deviceId, reading, settings);
      return this.response(tx, outcome, settings);
    });
  }

  /**
   * À appeler DANS la transaction de l'appelant (créer un passage ou le rejouer). Prend un verrou
   * par bracelet : deux lectures simultanées du même compteur ne passent pas ensemble.
   */
  async register(
    tx: TxClient,
    deviceId: string,
    reading: TapReading,
    settings: EventSettings,
  ): Promise<TapOutcome> {
    const none = (result: TapResult, media: MediaRow | null): TapOutcome => ({
      result,
      tapId: null,
      createdAt: null,
      media,
      wire: null,
    });
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 21))', [
      reading.tokenHash.toString('hex'),
    ]);
    const media = await readMedia(tx, reading.tokenHash);
    // `media_id` NULL : entrée reçue avant son lien (WP18), jamais une valeur inventée.
    if (!media || media.media_id === null) return none('UNKNOWN', null);
    const byStatus = statusResult(media.status);
    if (byStatus !== 'ACTIVE' && byStatus !== 'BLOCKED') return none(byStatus, media);
    if (media.uid !== null && !media.uid.equals(reading.nfcUid)) {
      await this.audit(tx, 'TAP_UID_MISMATCH', deviceId, reading);
      return none('UID_MISMATCH', media);
    }
    if (media.originality_sig_sha256 !== null) {
      if (reading.originalitySignature === null) return none('SIGNATURE_MISSING', media);
      if (!sha256(reading.originalitySignature).equals(media.originality_sig_sha256)) {
        await this.audit(tx, 'TAP_SIGNATURE_MISMATCH', deviceId, reading);
        return none('SIGNATURE_MISMATCH', media);
      }
    }
    if (media.batch_status !== null && media.batch_status !== 'ACTIVE')
      return none('BATCH_INACTIVE', media);

    const result: TapResult = byStatus === 'ACTIVE' ? 'OK' : 'BLOCKED';
    const now = this.clock.now();
    const windowMs = settings.tapReplayWindowSeconds * 1000;
    const known = await tx.query<{
      tap_id: string;
      device_id: string;
      consumed_by_edge_seq: string | null;
      created_at: Date;
      reading: Record<string, unknown> | null;
    }>(
      'SELECT tap_id, device_id, consumed_by_edge_seq, created_at, reading FROM edge_tap WHERE token_hash = $1 AND counter = $2',
      [reading.tokenHash, reading.counter],
    );
    const previous = known.rows[0];
    if (previous) {
      const sameReading =
        previous.device_id === deviceId &&
        previous.reading !== null &&
        previous.reading.nfc_uid === reading.wire.nfc_uid;
      const reusable =
        sameReading &&
        (previous.consumed_by_edge_seq === null ||
          now.getTime() - previous.created_at.getTime() <= windowMs);
      if (reusable)
        return {
          result,
          tapId: previous.tap_id,
          createdAt: previous.created_at,
          media,
          wire: previous.reading,
        };
      await this.audit(tx, 'TAP_CLONE_SUSPECTED', deviceId, reading);
      return none('CLONE_SUSPECTED', media);
    }
    const local = await tx.query<{ top: string | null }>(
      'SELECT max(counter) AS top FROM edge_tap WHERE token_hash = $1',
      [reading.tokenHash],
    );
    const top = Math.max(Number(media.counter_last), Number(local.rows[0]?.top ?? -1));
    if (reading.counter <= top) {
      await this.audit(tx, 'TAP_CLONE_SUSPECTED', deviceId, reading);
      return none('CLONE_SUSPECTED', media);
    }
    const inserted = await tx.query<{ tap_id: string }>(
      `INSERT INTO edge_tap (token_hash, device_id, counter, result, created_at, reading)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING tap_id`,
      [reading.tokenHash, deviceId, reading.counter, result, now, JSON.stringify(reading.wire)],
    );
    return {
      result,
      tapId: inserted.rows[0]!.tap_id,
      createdAt: now,
      media,
      wire: reading.wire,
    };
  }

  private async audit(
    tx: TxClient,
    kind: string,
    deviceId: string,
    reading: TapReading,
  ): Promise<void> {
    // Ni identité complète, ni signature : un préfixe d'empreinte et le compteur suffisent.
    await tx.query(
      `INSERT INTO edge_audit (kind, actor, device_id, detail) VALUES ($1, 'gateway', $2, $3)`,
      [
        kind,
        deviceId,
        JSON.stringify({
          token_hash_prefix: reading.tokenHash.toString('hex').slice(0, 8),
          counter: reading.counter,
        }),
      ],
    );
  }

  private async response(
    tx: TxClient,
    outcome: TapOutcome,
    settings: EventSettings,
  ): Promise<Record<string, unknown>> {
    const { media } = outcome;
    const usable = media !== null && media.media_id !== null;
    let wallet: Record<string, unknown> | null = null;
    if (usable && media.wallet_id !== null) {
      const row = await tx.query<{ status: string }>(
        'SELECT status FROM edge_wallet WHERE wallet_id = $1',
        [media.wallet_id],
      );
      if (row.rows[0]) {
        const balance = await this.replication.effectiveBalance(tx, media.wallet_id);
        wallet = {
          wallet_id: media.wallet_id,
          status: row.rows[0].status,
          currency: settings.currency,
          spendable: Number(balance.paid + balance.promo),
          paid: Number(balance.paid),
          promo: Number(balance.promo),
        };
      }
    }
    return {
      tap_id: outcome.tapId === null ? null : Number(outcome.tapId),
      result: outcome.result,
      tap_expires_at:
        outcome.tapId === null || outcome.createdAt === null
          ? null
          : iso(new Date(outcome.createdAt.getTime() + settings.tapReplayWindowSeconds * 1000)),
      media: usable
        ? {
            media_id: media.media_id,
            status: media.status,
            // Non répliqué (data-model B.3) : l'état de la caution n'est pas connu ici.
            deposit_status: 'NONE',
          }
        : null,
      wallet,
    };
  }
}
