// Restitution d'un bracelet au guichet de retour (SPECIFICATION §7.8, §7.9 ; FR-025 ; contrat `releaseMedia`,
// `reassignPoolMedia`). L'ordre du guichet est tenu par les refus de `release_media` : l'API n'enchaîne rien à la place
// de l'agent (étapes 2 et 3 de §7.9 : mission 9). Avant l'appel, elle lit ce qui reste à faire pour le nommer (caution
// détenue, espèces dues, solde d'un portefeuille) ; la règle reste celle de la base, qui refuse de toute façon.
import { Injectable } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import type { TxClient } from '../../db/tenant-tx';
import { ProblemException } from '../../errors/problem';
import { isSqlError } from '../../errors/sqlstate-map';
import type { Language } from '../../http/language';
import type { CounterActor } from './counter-access';
import { counterRefusal } from './lifecycle.dto';

/** Bracelet d'un lot de l'organisateur du terminal, verrouillé (404 sinon : il n'existe pas pour ce guichet). */
export async function lockCounterMedia(
  client: TxClient,
  actor: CounterActor,
  mediaId: string,
): Promise<void> {
  const { rows } = await client.query<{ organizer_id: string | null }>(
    'SELECT b.organizer_id FROM media m LEFT JOIN media_batch b ON b.id = m.batch_id WHERE m.id = $1 FOR UPDATE OF m',
    [mediaId],
  );
  if (!rows[0] || rows[0].organizer_id !== actor.organizerId)
    throw new ProblemException('NOT_FOUND');
}

export interface ReleaseResult {
  media_id: string;
  media_status: string;
  deposit_refund_transaction_id: null;
  promo_expiry_transaction_id: null;
  balance_refund_transaction_id: null;
  cash_to_hand_back: 0;
}

@Injectable()
export class ReleaseService {
  constructor(private readonly audit: AuditService) {}

  async release(
    client: TxClient,
    actor: CounterActor,
    mediaId: string,
    language: Language,
  ): Promise<ReleaseResult> {
    await lockCounterMedia(client, actor, mediaId);
    const { rows } = await client.query<{
      status: string;
      deposit_status: string;
      deposit_held: bigint;
      cash_due: bigint;
    }>(
      `SELECT m.status, m.deposit_status, m.deposit_held,
              (SELECT coalesce(sum(a.amount), 0) FROM anomaly a WHERE a.media_id = m.id AND a.kind = 'CASH_TOPUP_OVER_LIMIT' AND a.status = 'OPEN')::bigint AS cash_due
         FROM media m WHERE m.id = $1`,
      [mediaId],
    );
    const media = rows[0]!;
    const done: ReleaseResult = {
      media_id: mediaId,
      media_status: 'RELEASED',
      deposit_refund_transaction_id: null,
      promo_expiry_transaction_id: null,
      balance_refund_transaction_id: null,
      cash_to_hand_back: 0,
    };
    if (media.status === 'RELEASED') return done;

    if (media.deposit_status === 'HELD')
      throw counterRefusal('release.deposit_held', language, 'DEPOSIT_OUTSTANDING', 409, {
        deposit_held: Number(media.deposit_held),
      });
    if (media.cash_due > 0n)
      throw counterRefusal('release.cash_due', language, 'MEDIA_STATE_INVALID', 409, {
        cash_due: Number(media.cash_due),
      });
    const wallets = await client.query<{
      wallet_id: string;
      currency: string;
      spendable: bigint;
      debit_authority: string;
    }>(
      `SELECT ma.wallet_id, ma.currency, wallet_spendable(ma.wallet_id) AS spendable, l.debit_authority
         FROM media_assignment ma JOIN wallet w ON w.id = ma.wallet_id JOIN ledger l ON l.id = w.ledger_id
        WHERE ma.media_id = $1 AND ma.released_at IS NULL ORDER BY ma.currency`,
      [mediaId],
    );
    // Pendant que la passerelle a l'autorité, le solde central n'est pas sûr (contrat ; sync_protocol.md §9.6).
    if (wallets.rows.some((w) => w.debit_authority === 'EDGE'))
      throw new ProblemException('DEBIT_AUTHORITY_EDGE');
    const unsettled = wallets.rows.filter((w) => w.spendable !== 0n);
    if (unsettled.length > 0) {
      throw counterRefusal('release.balance', language, 'BALANCE_OUTSTANDING', 409, {
        balances: unsettled.map((w) => ({
          wallet_id: w.wallet_id,
          currency: w.currency.trim(),
          spendable: Number(w.spendable),
        })),
      });
    }

    await client.query('SELECT media_set_actor($1, $2)', [actor.userId, 'RETURNED']);
    await client.query(`SELECT release_media($1, 'RETURNED')`, [mediaId]);
    await this.audit.record(client, {
      ...actor.audit,
      operatorId: actor.operatorId,
      action: 'MEDIA_RELEASED',
      objectType: 'media',
      objectId: mediaId,
      before: {
        status: media.status,
        deposit_status: media.deposit_status,
        wallets: wallets.rows.map((w) => w.wallet_id),
      },
      after: { status: 'RELEASED' },
    });
    return done;
  }

  /** Lot `POOL` : le bracelet rendu reçoit une nouvelle identité ; l'ancienne rejoint l'historique (copie suspectée). */
  async reassign(
    client: TxClient,
    actor: CounterActor,
    mediaId: string,
    newTokenHash: Buffer,
    language: Language,
  ) {
    await lockCounterMedia(client, actor, mediaId);
    const { rows } = await client.query<{ status: string; reuse_policy: string | null }>(
      'SELECT m.status, b.reuse_policy FROM media m LEFT JOIN media_batch b ON b.id = m.batch_id WHERE m.id = $1',
      [mediaId],
    );
    const media = rows[0]!;
    if (media.reuse_policy !== 'POOL')
      throw counterRefusal('reassign.not_pool', language, 'MEDIA_STATE_INVALID', 409);
    if (media.status !== 'RELEASED')
      throw counterRefusal('reassign.not_released', language, 'MEDIA_STATE_INVALID', 409, {
        media_status: media.status,
      });
    const known = await client.query(
      'SELECT 1 FROM media WHERE token_hash = $1 UNION ALL SELECT 1 FROM media_identity_history WHERE token_hash = $1',
      [newTokenHash],
    );
    if ((known.rowCount ?? 0) > 0)
      throw counterRefusal('reassign.identity_known', language, 'CONFLICT_STATE', 409);
    await client.query('SELECT media_set_actor($1, $2)', [actor.userId, 'REASSIGNED']);
    try {
      await client.query('SELECT reassign_pool_media($1, $2)', [mediaId, newTokenHash]);
    } catch (error) {
      // Identité posée entre la lecture et l'écriture (index unique de la base).
      if (isSqlError(error) && error.code === '23505')
        throw counterRefusal('reassign.identity_known', language, 'CONFLICT_STATE', 409);
      throw error;
    }
    await this.audit.record(client, {
      ...actor.audit,
      operatorId: actor.operatorId,
      action: 'MEDIA_REASSIGNED',
      objectType: 'media',
      objectId: mediaId,
      before: { status: 'RELEASED' },
      after: { status: 'ISSUED' },
    });
    return { media_id: mediaId, media_status: 'ISSUED' as const };
  }
}
