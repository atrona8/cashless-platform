// Rattachement d'un bracelet par son code imprimé (SPECIFICATION §7.8, §8.5 ; FR-030 à FR-033 ;
// ADR-36, ADR-57 ; contracts/claim-codes.md). Les règles sont celles de la base : `claim_media`,
// `confirm_media_claim`, `public_balance_lookup` décident ; ce service calcule les empreintes,
// traduit les résultats et valide les refus avec l'essai inscrit (`CommittedProblem`), sans quoi
// les limites d'essais ne compteraient jamais un refus. Pas d'énumération (NFR-007) : un code
// inconnu et un code utilisé suivent le même chemin (une empreinte, un code de confirmation
// tiré, un appel) et reçoivent la même réponse.
import { randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AuditService, type AuditContext } from '../../audit/audit.service';
import type { CustomerContext } from '../../customer-identity/customer-identity.port';
import { TenantTx, type TxClient } from '../../db/tenant-tx';
import { ProblemException } from '../../errors/problem';
import type { Language } from '../../http/language';
import { CommittedProblem } from '../../idempotency/committed-problem';
import { ClaimHasher } from '../../kms/claim-hash';
import type { CounterActor } from '../lifecycle/counter-access';
import { DepositService } from '../lifecycle/deposit.service';
import { TapService } from '../taps/tap.service';
import {
  claimInvalid,
  claimRule,
  type ClaimInput,
  type ConfirmInput,
  type CustomerMedia,
} from './claims.dto';

export type ClaimResult =
  | { kind: 'ATTACHED'; media: CustomerMedia }
  | {
      kind: 'PENDING';
      claim_id: string;
      status: 'PENDING_DESK_CONFIRMATION';
      confirmation_code: string;
      expires_at: string;
    };

interface ClaimRow {
  outcome: 'ATTACHED' | 'PENDING' | 'NOT_ACTIVE' | 'REFUSED' | 'BLOCKED';
  claim_id: string | null;
  media_id: string | null;
  expires_at: Date | null;
}

interface LookupRow {
  outcome: 'LOOKUP' | 'REFUSED' | 'BLOCKED';
  currency: string | null;
  spendable: bigint | null;
  media_status: string | null;
  movements: Array<{ occurred_at: string; type: string; amount: number }> | null;
}

const HOUR = 3600;
const CONFIRM_SQL = 'SELECT confirm_media_claim($1, $2, $3, $4, $5) AS result';
// Secondes avant que l'essai le plus ancien encore compté sorte de sa fenêtre.
const UNTIL = (window: string) =>
  `ceil(extract(epoch FROM a.attempted_at + interval '${window}' - clock_timestamp()))::int`;

@Injectable()
export class ClaimsService {
  constructor(
    private readonly tx: TenantTx,
    private readonly hasher: ClaimHasher,
    private readonly deposits: DepositService,
    private readonly taps: TapService,
    private readonly audit: AuditService,
  ) {}

  /** Rattachement par le festivalier (`claimMedia`). */
  async claim(
    client: TxClient,
    customer: CustomerContext,
    input: ClaimInput,
    audit: AuditContext,
    language: Language,
  ) {
    const hash = this.hasher.claimCodeHash(input.code);
    // Tirés avant l'appel, quel que soit le résultat : même travail pour tous les chemins
    // (NFR-007).
    const claimId = randomUUID();
    const digits = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const confirmation = this.hasher.confirmationHash(claimId, digits);
    const { rows } = await client.query<ClaimRow>('SELECT * FROM claim_media($1, $2, $3, $4, $5)', [
      hash,
      customer.customerId,
      customer.deviceRef,
      claimId,
      confirmation,
    ]);
    const row = rows[0]!;
    const base = { ...audit, operatorId: customer.operatorId, objectType: 'media' };
    switch (row.outcome) {
      case 'ATTACHED': {
        await this.audit.record(client, {
          ...base,
          action: 'MEDIA_CLAIMED',
          objectId: row.media_id!,
        });
        return {
          kind: 'ATTACHED',
          media: await this.customerMedia(client, row.media_id!),
        } satisfies ClaimResult;
      }
      case 'PENDING': {
        // Le code de confirmation n'est rendu qu'ici, une fois ; seule son empreinte est
        // conservée.
        await this.audit.record(client, {
          ...base,
          action: 'MEDIA_CLAIM_PENDING',
          objectId: row.media_id!,
          after: { claim_id: claimId },
        });
        return {
          kind: 'PENDING',
          claim_id: claimId,
          status: 'PENDING_DESK_CONFIRMATION',
          confirmation_code: digits,
          expires_at: row.expires_at!.toISOString(),
        } satisfies ClaimResult;
      }
      case 'NOT_ACTIVE':
        return {
          kind: 'ATTACHED',
          media: await this.activate(client, customer, row.media_id!, input, base, language),
        } satisfies ClaimResult;
      case 'BLOCKED': {
        const retry = await this.retryAfter(client, customer);
        await this.audit.record(client, {
          ...base,
          objectType: 'customer',
          action: 'MEDIA_CLAIM_BLOCKED',
          objectId: customer.customerId,
          after: { device_ref: customer.deviceRef },
        });
        throw new CommittedProblem('RATE_LIMITED', {
          status: 429,
          headers: { 'Retry-After': String(retry) },
        });
      }
      default:
        throw claimInvalid();
    }
  }

  /**
   * Code valide d'un bracelet jamais activé : activation par l'app (`SELF_APP`, contrat
   * `claimMedia`) sur un portefeuille du festivalier, puis code consommé. Chaque refus est
   * validé avec l'essai inscrit, avant toute écriture.
   */
  private async activate(
    client: TxClient,
    customer: CustomerContext,
    mediaId: string,
    input: ClaimInput,
    base: AuditContext & { operatorId: string; objectType: string },
    language: Language,
  ) {
    const { rows } = await client.query<{
      batch_status: string;
      event_id: string | null;
      deposit_amount: bigint | null;
      deposit_mode: string | null;
      activation_modes: string[] | null;
      ledger_id: string | null;
      debit_authority: string | null;
    }>(
      `SELECT b.status AS batch_status, b.event_id, b.deposit_amount, b.deposit_mode,
              e.activation_modes, l.id AS ledger_id, l.debit_authority
         FROM media m
         JOIN media_batch b ON b.id = m.batch_id
         LEFT JOIN event e ON e.id = b.event_id
         LEFT JOIN ledger l ON l.scope_type = 'EVENT' AND l.scope_id = e.id
        WHERE m.id = $1`,
      [mediaId],
    );
    const target = rows[0];
    if (!target) throw claimInvalid();
    if (target.event_id === null || target.ledger_id === null)
      throw new CommittedProblem('MEDIA_CLAIM_INVALID', {
        status: 422,
        ...claimRule('claim.event_required', language),
      });
    if (target.batch_status !== 'ACTIVE') throw new CommittedProblem('MEDIA_BATCH_INACTIVE');
    if (!(target.activation_modes ?? []).includes('SELF_APP'))
      throw new CommittedProblem('ACTIVATION_MODE_NOT_ALLOWED');
    const deposit = Number(target.deposit_amount ?? 0n);
    if (deposit > 0 && target.deposit_mode === 'SEPARATE')
      throw new CommittedProblem('MEDIA_CLAIM_INVALID', {
        status: 422,
        ...claimRule('claim.deposit_at_desk', language),
      });
    if (deposit > 0 && target.debit_authority === 'EDGE')
      throw new CommittedProblem('DEBIT_AUTHORITY_EDGE');

    let walletId = input.walletId;
    if (walletId !== null) {
      const wallet = await client.query(
        `SELECT 1 FROM wallet
          WHERE id = $1 AND customer_id = $2 AND ledger_id = $3 AND status = $4`,
        [walletId, customer.customerId, target.ledger_id, 'ACTIVE'],
      );
      if (wallet.rowCount !== 1)
        throw new CommittedProblem('MEDIA_CLAIM_INVALID', {
          status: 422,
          ...claimRule('claim.wallet', language),
        });
    } else {
      walletId = (
        await client.query<{ id: string }>('SELECT open_event_wallet($1, $2) AS id', [
          target.event_id,
          customer.customerId,
        ])
      ).rows[0]!.id;
    }
    await client.query('SELECT media_set_actor($1, $2)', [
      customer.customerId,
      'ACTIVATION:SELF_APP',
    ]);
    await client.query(`SELECT activate_media($1, $2, 'SELF_APP', $3)`, [
      mediaId,
      walletId,
      target.event_id,
    ]);
    // Caution sur le solde : due (le portefeuille neuf est vide), prise après une recharge.
    await this.deposits.take(
      client,
      { operatorId: customer.operatorId, cashDeskCode: null, audit: base, language },
      mediaId,
      null,
      new Date(),
    );
    await client.query('SELECT mark_claim_code_used($1)', [mediaId]);
    await this.audit.record(client, {
      ...base,
      action: 'MEDIA_SELF_ACTIVATED',
      objectId: mediaId,
      after: { event_id: target.event_id, wallet_id: walletId },
    });
    return this.customerMedia(client, mediaId);
  }

  /** Délai avant le prochain essai admis : celui des deux limites (compte, appareil) atteintes. */
  private async retryAfter(client: TxClient, customer: CustomerContext): Promise<number> {
    const { rows } = await client.query<{ account: number | null; device: number | null }>(
      `SELECT
         (SELECT ${UNTIL('1 hour')} FROM claim_attempt a
           WHERE a.customer_id = $1 AND a.outcome <> 'BLOCKED'
             AND a.attempted_at > clock_timestamp() - interval '1 hour'
           ORDER BY a.attempted_at DESC OFFSET 4 LIMIT 1) AS account,
         (SELECT ${UNTIL('1 day')} FROM claim_attempt a
           WHERE a.device_ref = $2 AND a.customer_id IS NOT NULL AND a.outcome <> 'BLOCKED'
             AND a.attempted_at > clock_timestamp() - interval '1 day'
           ORDER BY a.attempted_at DESC OFFSET 19 LIMIT 1) AS device`,
      [customer.customerId, customer.deviceRef],
    );
    return Math.max(1, rows[0]?.account ?? 0, rows[0]?.device ?? 0) || HOUR;
  }

  /**
   * Confirmation au guichet (`confirmMediaClaim`) : le guichet ne connaît pas la demande ; le
   * code imprimé désigne le bracelet, le code de confirmation désigne la demande. Lecture d'un
   * autre bracelet : toutes les demandes en attente sont annulées ; mauvais code : un essai
   * compté sur chacune (5 au plus). Succès : la lecture est consommée par la demande
   * (migration 0016), dans la même transaction. La fraîcheur de la lecture est vérifiée AVANT
   * toute décision : une lecture ancienne de ce terminal n'annule ni ne compte rien.
   */
  async confirm(
    client: TxClient,
    actor: CounterActor,
    input: ConfirmInput,
  ): Promise<CustomerMedia> {
    if (actor.debitAuthority === 'EDGE') throw new ProblemException('DEBIT_AUTHORITY_EDGE');
    const tap = await this.taps.byId(client, actor.device, input.tapId);
    await this.assertFresh(client, tap.tapId!);
    const hash = this.hasher.claimCodeHash(input.code);
    const media = await client.query<{ id: string; organizer_id: string | null }>(
      `SELECT m.id, b.organizer_id
         FROM media m LEFT JOIN media_batch b ON b.id = m.batch_id
        WHERE m.claim_code_hash = $1 FOR UPDATE OF m`,
      [hash],
    );
    const codeMedia = media.rows[0];
    if (!codeMedia || codeMedia.organizer_id !== actor.organizerId) throw claimInvalid();
    const pending = await client.query<{ id: string; confirmation_hash: Buffer }>(
      `SELECT id, confirmation_hash FROM media_claim
        WHERE media_id = $1 AND status = 'PENDING' ORDER BY created_at FOR UPDATE`,
      [codeMedia.id],
    );
    const claims = pending.rows.map((c) => ({
      id: c.id,
      stored: c.confirmation_hash,
      given: this.hasher.confirmationHash(c.id, input.digits),
    }));
    const { deviceId } = actor.device;
    const decide = async (claimId: string, mediaId: string, given: Buffer) => {
      const params = [claimId, mediaId, given, deviceId, actor.userId];
      const { rows } = await client.query<{ result: string }>(CONFIRM_SQL, params);
      return rows[0]!.result;
    };

    if (tap.mediaId !== codeMedia.id) {
      for (const c of claims) await decide(c.id, tap.mediaId!, c.given);
      throw claimInvalid();
    }
    const match = claims.find(
      (c) => c.stored.length === c.given.length && timingSafeEqual(c.stored, c.given),
    );
    if (!match) {
      for (const c of claims) await decide(c.id, codeMedia.id, c.given);
      throw claimInvalid();
    }
    if ((await decide(match.id, codeMedia.id, match.given)) !== 'CONFIRMED') throw claimInvalid();
    await client.query('SELECT consume_tap_for_claim($1, $2)', [tap.tapId, match.id]);
    await this.audit.record(client, {
      ...actor.audit,
      operatorId: actor.operatorId,
      action: 'MEDIA_CLAIM_CONFIRMED',
      objectType: 'media',
      objectId: codeMedia.id,
      after: { claim_id: match.id, device_id: actor.device.deviceId, tap_id: tap.tapId },
    });
    return this.customerMedia(client, codeMedia.id);
  }

  /**
   * Même fenêtre que `consume_tap_for_claim` (migration 0016) : `received_at` dans les
   * `tap_replay_window_seconds` de l'événement du terminal (120 s par défaut, 1 s au moins).
   * Hors fenêtre : `TAP_UNUSABLE` (409), avant toute annulation ou tout essai compté.
   */
  private async assertFresh(client: TxClient, tapId: string): Promise<void> {
    const { rows } = await client.query<{ fresh: boolean }>(
      `SELECT t.received_at >= clock_timestamp()
                - make_interval(secs => greatest(coalesce(e.tap_replay_window_seconds, 120), 1))
              AS fresh
         FROM media_tap t
         LEFT JOIN device d ON d.id = t.device_id
         LEFT JOIN event e ON e.id = d.event_id
        WHERE t.id = $1`,
      [tapId],
    );
    if (rows[0]?.fresh !== true) throw new ProblemException('TAP_UNUSABLE');
  }

  /**
   * Consultation anonyme (`lookupBalanceByClaimCode`) : sans compte ni prestataire.
   * `public_balance_lookup` (SECURITY DEFINER) contrôle elle-même ses limites et ne rend que
   * le solde et les 10 derniers mouvements.
   */
  async lookup(code: string, address: string) {
    const hash = this.hasher.claimCodeHash(code);
    const rows = await this.tx.unscoped(
      async (client) =>
        (
          await client.query<LookupRow>(
            'SELECT * FROM public_balance_lookup($1, $2) ORDER BY currency',
            [hash, this.hasher.addressRef(address)],
          )
        ).rows,
    );
    const row = rows[0]!;
    if (row.outcome === 'BLOCKED')
      throw new ProblemException('RATE_LIMITED', {
        status: 429,
        headers: { 'Retry-After': String(HOUR) },
      });
    if (row.outcome !== 'LOOKUP') throw new ProblemException('NOT_FOUND');
    return {
      currency: row.currency!.trim(),
      spendable: Number(row.spendable),
      media_status: row.media_status,
      recent: (row.movements ?? []).map((m) => ({
        occurred_at: new Date(m.occurred_at).toISOString(),
        type: m.type,
        amount: Number(m.amount),
      })),
    };
  }

  private async customerMedia(client: TxClient, mediaId: string): Promise<CustomerMedia> {
    const { rows } = await client.query<{
      status: string;
      deposit_status: string;
      wallet_id: string | null;
    }>('SELECT status, deposit_status, wallet_id FROM media WHERE id = $1', [mediaId]);
    const m = rows[0]!;
    return {
      media_id: mediaId,
      printed_number: null,
      status: m.status,
      deposit_status: m.deposit_status,
      wallet_id: m.wallet_id,
    };
  }
}
