// Restitution d'un bracelet au guichet de retour (SPECIFICATION §7.8, §7.9 ; FR-025, FR-015 à FR-017 ; contrat
// `releaseMedia`, `reassignPoolMedia`). Sans `settle_balance` ni `refund_deposit_by`, l'ordre du guichet est tenu par les
// refus de `release_media` : l'API lit ce qui reste à faire pour le nommer (caution détenue, espèces dues, solde d'un
// portefeuille) ; la règle reste celle de la base, qui refuse de toute façon. Avec l'un des deux, le serveur enchaîne
// dans la transaction de l'appel, dans l'ordre de §7.9 : caution, crédits offerts, solde payé en espèces, espèces dues,
// puis `release_media`. Chaque étape a sa clé ; un refus à n'importe quelle étape annule tout.
import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { AuditService } from '../../audit/audit.service';
import type { TxClient } from '../../db/tenant-tx';
import { ProblemException } from '../../errors/problem';
import { isSqlError } from '../../errors/sqlstate-map';
import type { Language } from '../../http/language';
import { lockWalletPaidBalance } from '../../ledger/db/ledger-queries';
import { LedgerEngineService } from '../../ledger/ledger-engine.service';
import type { CashDueService } from './cash-due.service';
import { requireCashSession, type CounterActor } from './counter-access';
import { DepositService } from './deposit.service';
import { counterRefusal, type Payment } from './lifecycle.dto';

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

/** Enchaînement demandé par le corps (`settle_balance`, `refund_deposit_by`) et ce que la route sait de la requête. */
export interface ReleaseChain {
  settleBalance: Payment | null;
  refundDepositBy: Payment | null;
  /** Consomme le jeton d'approbation sur place présenté et rend le valideur ; `null` : aucun jeton présenté. */
  approve: ((client: TxClient) => Promise<string>) | null;
  /** `cash_session_id` du corps, s'il y en a un : doit être la session ouverte du terminal. */
  cashSessionId: string | null;
}

export interface ReleaseResult {
  media_id: string;
  media_status: string;
  deposit_refund_transaction_id: string | null;
  promo_expiry_transaction_id: string | null;
  balance_refund_transaction_id: string | null;
  cash_to_hand_back: number;
  cash_session_id?: string;
}

interface WalletRow {
  wallet_id: string;
  currency: string;
  ledger_id: string;
  spendable: bigint;
  debit_authority: string;
}

@Injectable()
export class ReleaseService {
  constructor(
    private readonly audit: AuditService,
    private readonly engine: LedgerEngineService,
    private readonly deposits: DepositService,
    private readonly modules: ModuleRef,
  ) {}

  private async mediaRow(client: TxClient, mediaId: string) {
    const { rows } = await client.query<{
      status: string;
      deposit_status: string;
      deposit_held: bigint;
      cash_due: bigint;
      assignments: number;
    }>(
      `SELECT m.status, m.deposit_status, m.deposit_held,
              (SELECT coalesce(sum(a.amount), 0) FROM anomaly a WHERE a.media_id = m.id AND a.kind = 'CASH_TOPUP_OVER_LIMIT' AND a.status = 'OPEN')::bigint AS cash_due,
              (SELECT count(*)::int FROM media_assignment x WHERE x.media_id = m.id) AS assignments
         FROM media m WHERE m.id = $1`,
      [mediaId],
    );
    return rows[0]!;
  }

  private async wallets(client: TxClient, mediaId: string): Promise<WalletRow[]> {
    const { rows } = await client.query<WalletRow>(
      `SELECT ma.wallet_id, ma.currency, w.ledger_id, wallet_spendable(ma.wallet_id) AS spendable, l.debit_authority
         FROM media_assignment ma JOIN wallet w ON w.id = ma.wallet_id JOIN ledger l ON l.id = w.ledger_id
        WHERE ma.media_id = $1 AND ma.released_at IS NULL ORDER BY ma.currency`,
      [mediaId],
    );
    return rows;
  }

  async release(
    client: TxClient,
    actor: CounterActor,
    mediaId: string,
    language: Language,
    chain: ReleaseChain | null = null,
  ): Promise<ReleaseResult> {
    // Avec enchaînement : la session de caisse d'abord (FR-004), avant toute lecture ou écriture.
    const session = chain ? requireCashSession(actor, language, chain.cashSessionId) : null;
    await lockCounterMedia(client, actor, mediaId);
    let media = await this.mediaRow(client, mediaId);
    const done: ReleaseResult = {
      media_id: mediaId,
      media_status: 'RELEASED',
      deposit_refund_transaction_id: null,
      promo_expiry_transaction_id: null,
      balance_refund_transaction_id: null,
      cash_to_hand_back: 0,
      ...(session ? { cash_session_id: session.id } : {}),
    };
    if (media.status === 'RELEASED') return done;

    if (chain && session) {
      // Pendant que la passerelle a l'autorité, le solde central n'est pas sûr : avant toute écriture.
      const before = await this.wallets(client, mediaId);
      if (before.some((w) => w.debit_authority === 'EDGE'))
        throw new ProblemException('DEBIT_AUTHORITY_EDGE');
      if (media.status !== 'ACTIVE')
        throw counterRefusal('release.media_blocked', language, 'MEDIA_STATE_INVALID', 409, {
          media_status: media.status,
        });
      await this.chained(client, actor, mediaId, media, before, session, chain, done, language);
      media = await this.mediaRow(client, mediaId);
    }

    if (media.deposit_status === 'HELD')
      throw counterRefusal('release.deposit_held', language, 'DEPOSIT_OUTSTANDING', 409, {
        deposit_held: Number(media.deposit_held),
      });
    if (media.cash_due > 0n)
      throw counterRefusal('release.cash_due', language, 'MEDIA_STATE_INVALID', 409, {
        cash_due: Number(media.cash_due),
      });
    const wallets = await this.wallets(client, mediaId);
    // Pendant que la passerelle a l'autorité, le solde central n'est pas sûr (contrat ; sync_protocol.md §9.6).
    if (wallets.some((w) => w.debit_authority === 'EDGE'))
      throw new ProblemException('DEBIT_AUTHORITY_EDGE');
    const unsettled = wallets.filter((w) => w.spendable !== 0n);
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
        wallets: wallets.map((w) => w.wallet_id),
      },
      after: {
        status: 'RELEASED',
        ...(chain
          ? {
              deposit_refund_transaction_id: done.deposit_refund_transaction_id,
              promo_expiry_transaction_id: done.promo_expiry_transaction_id,
              balance_refund_transaction_id: done.balance_refund_transaction_id,
              cash_to_hand_back: done.cash_to_hand_back,
              cash_session_id: session!.id,
            }
          : {}),
      },
    });
    return done;
  }

  /**
   * Étapes 2 à 5 de SPECIFICATION §7.9. Les identifiants et le montant à remettre sont inscrits dans `done`. Une
   * étape sans objet est sautée (jamais d'écriture de montant nul). Tout refus lève : la transaction est annulée.
   */
  private async chained(
    client: TxClient,
    actor: CounterActor,
    mediaId: string,
    media: { deposit_status: string; deposit_held: bigint; assignments: number },
    wallets: WalletRow[],
    session: { id: string; code: string },
    chain: ReleaseChain,
    done: ReleaseResult,
    language: Language,
  ): Promise<void> {
    // Jeton consommé au plus une fois, et seulement si une étape l'exige (valideur partagé par les étapes).
    let approver: string | null = null;
    const approverFor = async (): Promise<string> => {
      if (approver) return approver;
      if (!chain.approve) throw new ProblemException('APPROVAL_REQUIRED', { status: 403 });
      approver = await chain.approve(client);
      return approver;
    };
    const rank = media.assignments;
    let cash = 0n;
    const settleable = wallets.filter((w) => w.ledger_id === actor.ledgerId);
    // OP-N128 (b) : le solde payé de chaque portefeuille est verrouillé AVANT la lecture du cumul, dans l'ordre
    // des identifiants et après le verrou du bracelet (ordre : bracelet puis portefeuilles) : une dépense
    // concurrente est attendue, puis le cumul lu est le cumul réel.
    for (const w of [...settleable].sort((a, b) => (a.wallet_id < b.wallet_id ? -1 : 1)))
      await lockWalletPaidBalance(client, {
        occurredAt: new Date(),
        payload: { walletId: w.wallet_id },
      });

    // Seuil de la seconde personne sur le CUMUL des espèces qui sortent de la caisse pour cette restitution (décision
    // du porteur, 16/11/2026) : caution rendue en espèces + montant brut du solde payé + espèces dues. Calculé et
    // contrôlé avant la première écriture ; au-delà (comparaison `>`), un jeton est exigé.
    const plan = await client.query<{
      mode: string | null;
      paid: bigint;
      due: bigint;
      single_max: bigint | null;
    }>(
      `SELECT b.deposit_mode AS mode,
              coalesce((SELECT -sum(ab.balance) FROM account a JOIN account_balance ab ON ab.account_id = a.id WHERE a.wallet_id = ANY($2::uuid[]) AND a.purpose = 'WALLET_PAID'), 0)::bigint AS paid,
              coalesce((SELECT sum(x.amount) FROM anomaly x WHERE x.media_id = m.id AND x.kind = 'CASH_TOPUP_OVER_LIMIT' AND x.status = 'OPEN'), 0)::bigint AS due,
              (SELECT e.cash_refund_single_max FROM ledger l JOIN event e ON l.scope_type = 'EVENT' AND e.id = l.scope_id WHERE l.id = $3) AS single_max
         FROM media m LEFT JOIN media_batch b ON b.id = m.batch_id WHERE m.id = $1`,
      [mediaId, settleable.map((w) => w.wallet_id), actor.ledgerId],
    );
    const p = plan.rows[0]!;
    const held = media.deposit_status === 'HELD' ? media.deposit_held : 0n;
    const depositCash = p.mode === 'SEPARATE' ? held : 0n;
    // Caution `FROM_BALANCE` : rendue au portefeuille, elle grossit le solde payé rendu.
    const depositToBalance = p.mode === 'FROM_BALANCE' ? held : 0n;
    const predicted = chain.settleBalance
      ? depositCash + p.paid + depositToBalance + p.due
      : depositCash;
    const limit = BigInt(p.single_max ?? 0);
    if (predicted > limit) await approverFor();

    // 2. Caution détenue. `refund_deposit_by` d'abord, sinon le moyen de `settle_balance` (espèces dans les deux cas).
    if (media.deposit_status === 'HELD') {
      const refunded = await this.deposits.refund(
        client,
        {
          operatorId: actor.operatorId,
          cashSessionId: session.id,
          deviceId: actor.device.deviceId,
          audit: actor.audit,
          language,
        },
        mediaId,
        chain.refundDepositBy ?? chain.settleBalance,
        new Date(),
        // OP-N128 : l'auteur et, au-delà du seuil, le valideur du jeton vont jusqu'à `DEPOSIT_REFUNDED`.
        { actor: actor.userId, approver },
      );
      done.deposit_refund_transaction_id = refunded.transactionId;
      if (refunded.state.mode === 'SEPARATE') cash += BigInt(refunded.state.amount);
    }
    if (!chain.settleBalance) {
      done.cash_to_hand_back = Number(cash);
      return;
    }

    // Seuls les portefeuilles du grand livre du terminal se soldent ; les autres gardent le refus `release.balance`.
    for (const wallet of settleable) {
      // Soldes lus APRÈS la caution (une caution `FROM_BALANCE` grossit le solde payé).
      const { rows } = await client.query<{
        paid: bigint;
        promo: bigint;
        single_max: bigint | null;
      }>(
        `SELECT coalesce((SELECT -sum(ab.balance) FROM account a JOIN account_balance ab ON ab.account_id = a.id WHERE a.wallet_id = $1 AND a.purpose = 'WALLET_PAID'), 0)::bigint AS paid,
                coalesce((SELECT -sum(ab.balance) FROM account a JOIN account_balance ab ON ab.account_id = a.id WHERE a.wallet_id = $1 AND a.purpose = 'WALLET_PROMO'), 0)::bigint AS promo,
                (SELECT e.cash_refund_single_max FROM ledger l JOIN event e ON l.scope_type = 'EVENT' AND e.id = l.scope_id WHERE l.id = $2) AS single_max`,
        [wallet.wallet_id, actor.ledgerId],
      );
      const { paid, promo, single_max: singleMax } = rows[0]!;
      const base = {
        source: 'ONLINE' as const,
        ledgerId: actor.ledgerId,
        eventId: actor.eventId,
        currency: actor.currency,
        mediaId,
        createdBy: actor.userId,
        occurredAt: new Date(),
      };

      // 3. Crédits offerts restants (jamais de montant nul : le constructeur le refuse).
      if (promo > 0n) {
        const expiry = await this.engine.execute(client, {
          ...base,
          type: 'PROMO_EXPIRY',
          idempotencyKey: `promo-expiry:${wallet.wallet_id}:${rank}`,
          payload: { walletId: wallet.wallet_id },
        });
        done.promo_expiry_transaction_id = expiry.transactionId ?? null;
      }

      // 4. Solde payé, frais compris, en espèces depuis la caisse de la session. Au-delà du maximum de
      // l'événement (même lecture que le rendu des espèces dues, montant brut) : seconde personne.
      if (paid > 0n) {
        // Contrôle de repli sur les soldes réellement lus (même cumul, plus strict si la prévision était basse).
        const actual = cash + paid + p.due;
        const approvedBy = actual > BigInt(singleMax ?? 0) ? await approverFor() : undefined;
        const refund = await this.engine.execute(client, {
          ...base,
          type: 'WALLET_REFUND',
          idempotencyKey: `release-refund:${mediaId}:${rank}`,
          deviceId: actor.device.deviceId,
          ...(approvedBy ? { approvedBy } : {}),
          payload: { walletId: wallet.wallet_id, amount: paid, moneyAccount: session.code },
          metadata: { cash_session_id: session.id },
        });
        const transactionId = refund.transactionId;
        if (!transactionId) throw new Error('restitution : remboursement du solde non écrit');
        await client.query('SELECT attach_cash_tx($1, $2)', [session.id, transactionId]);
        done.balance_refund_transaction_id = transactionId;
        // Espèces réellement sorties de la caisse : le montant net des frais, lu sur la ligne de la caisse.
        const out = await client.query<{ out: bigint }>(
          `SELECT coalesce(abs(sum(p.amount)), 0)::bigint AS out FROM posting p
            JOIN account a ON a.id = p.account_id WHERE p.transaction_id = $1 AND a.code = $2`,
          [transactionId, session.code],
        );
        cash += BigInt(out.rows[0]!.out);
      }
    }

    // 5. Espèces dues ouvertes : même chemin que le rendu seul (bracelet actif, grand livre du terminal, seuil).
    const due = await client.query<{ n: bigint }>(
      `SELECT coalesce(sum(amount), 0)::bigint AS n FROM anomaly WHERE media_id = $1 AND kind = 'CASH_TOPUP_OVER_LIMIT' AND status = 'OPEN'`,
      [mediaId],
    );
    if (due.rows[0]!.n > 0n) {
      // Résolu à l'appel : `cash-due.service` importe ce fichier (`lockCounterMedia`), un import direct ferait un cycle.
      const { CashDueService: Provider } = await import('./cash-due.service');
      const cashDue = this.modules.get<CashDueService>(Provider, { strict: false });
      const handed = await cashDue.refund(
        client,
        actor,
        mediaId,
        {
          idempotencyKey: `release-cash-due:${mediaId}:${rank}`,
          approve: chain.approve ? approverFor : null,
          cashSessionId: session.id,
        },
        language,
      );
      cash += BigInt(handed.result.amount);
    }
    done.cash_to_hand_back = Number(cash);
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
