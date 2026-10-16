// Rendu au guichet des espèces dues à un détenteur (ADR-63 ; FR-026 ; contrat `refundCashDue`) :
// `refund_cash_due` calcule le montant (anomalies `CASH_TOPUP_OVER_LIMIT` ouvertes du bracelet),
// passe l'écriture `WALLET_REFUND` (débit `L-ESP-A-RENDRE`, crédit caisse) et clôt les anomalies.
// Au-delà de `event.cash_refund_single_max`, une seconde personne valide sur place (jeton consommé
// dans cette transaction, ADR-74) ; la base refuse de toute façon un rendu au-delà du maximum sans
// valideur distinct de l'auteur, et ce service ne double pas la règle. Le compte crédité est la
// caisse du terminal (décision du porteur n° 10) : sans caisse ouverte, refus.
// Deux contrôles que la base ne fait pas (`refund_cash_due` ne lit ni l'état du bracelet ni
// l'événement du terminal) : le bracelet doit être `ACTIVE` (une lecture citée par `tap_id` peut
// avoir été enregistrée `BLOCKED`, ou avant la déclaration de perte : on ne rend rien au porteur
// d'un bracelet perdu ou sur liste noire), et les espèces dues doivent être inscrites au grand
// livre de l'événement du terminal.
import { Injectable } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import type { TxClient } from '../../db/tenant-tx';
import { ProblemException } from '../../errors/problem';
import type { Language } from '../../http/language';
import { conflict } from '../../organization/platform/platform.dto';
import type { CounterActor } from './counter-access';
import { counterRefusal } from './lifecycle.dto';
import { lockCounterMedia } from './release.service';

export interface CashDueContext {
  idempotencyKey: string;
  /**
   * Consomme le jeton d'approbation sur place présenté, et rend le valideur ; `null` : aucun jeton
   * présenté.
   */
  approve: ((client: TxClient) => Promise<string>) | null;
}

@Injectable()
export class CashDueService {
  constructor(private readonly audit: AuditService) {}

  async refund(
    client: TxClient,
    actor: CounterActor,
    mediaId: string,
    context: CashDueContext,
    language: Language,
  ) {
    await lockCounterMedia(client, actor, mediaId);
    const media = await client.query<{ status: string }>('SELECT status FROM media WHERE id = $1', [
      mediaId,
    ]);
    const status = media.rows[0]!.status;
    if (status !== 'ACTIVE') {
      throw counterRefusal('cash_due.media_blocked', language, 'MEDIA_STATE_INVALID', 409, {
        media_status: status,
      });
    }
    const due = await client.query<{ id: string; amount: bigint; ledger_id: string }>(
      `SELECT id, amount, ledger_id FROM anomaly WHERE media_id = $1 AND kind = 'CASH_TOPUP_OVER_LIMIT' AND status = 'OPEN' ORDER BY id FOR UPDATE`,
      [mediaId],
    );
    if (due.rows.length === 0)
      throw counterRefusal('cash_due.nothing', language, 'MEDIA_STATE_INVALID', 409);
    const amount = due.rows.reduce((sum, row) => sum + BigInt(row.amount), 0n);
    // Toutes les anomalies, pas seulement la première : la base additionne celles de tous les
    // grands livres.
    if (due.rows.some((row) => row.ledger_id !== actor.ledgerId)) {
      throw counterRefusal('cash_due.other_ledger', language, 'CONFLICT_STATE', 409);
    }
    const ledgerId = actor.ledgerId;
    const { rows } = await client.query<{
      currency: string;
      single_max: bigint | null;
      cash_account: string | null;
    }>(
      `SELECT l.currency, e.cash_refund_single_max AS single_max,
              (SELECT a.id FROM account a WHERE a.ledger_id = l.id AND a.purpose = 'CASH_DESK' AND a.is_active AND a.code = $2) AS cash_account
         FROM ledger l LEFT JOIN event e ON l.scope_type = 'EVENT' AND e.id = l.scope_id WHERE l.id = $1`,
      [ledgerId, actor.cashDeskCode],
    );
    const ledger = rows[0]!;
    if (!ledger.cash_account)
      throw conflict(
        'Aucune caisse ouverte pour ce terminal au grand livre de ces espèces : elles ne peuvent pas être rendues ici.',
      );

    // Seuil de l'événement (même lecture que la base) : au-delà, seconde personne obligatoire.
    const approverId =
      amount > BigInt(ledger.single_max ?? 0) ? await this.approver(client, context) : null;
    const tx = await client.query<{ id: string }>(
      'SELECT refund_cash_due($1, $2, $3, $4, $5, $6) AS id',
      [
        mediaId,
        ledger.cash_account,
        context.idempotencyKey,
        actor.userId,
        approverId,
        actor.device.deviceId,
      ],
    );
    const transactionId = tx.rows[0]!.id;
    const result = {
      transaction_id: transactionId,
      idempotency_key: context.idempotencyKey,
      media_id: mediaId,
      amount: Number(amount),
      currency: ledger.currency.trim(),
      resolved_anomaly_ids: due.rows.map((row) => row.id),
      approved_by: approverId,
    };
    await this.audit.record(client, {
      ...actor.audit,
      operatorId: actor.operatorId,
      action: 'MEDIA_CASH_DUE_REFUNDED',
      objectType: 'media',
      objectId: mediaId,
      approverId,
      after: {
        transaction_id: transactionId,
        amount: result.amount,
        currency: result.currency,
        resolved_anomaly_ids: result.resolved_anomaly_ids,
      },
    });
    return { result, transactionId };
  }

  private async approver(client: TxClient, context: CashDueContext): Promise<string> {
    if (!context.approve) throw new ProblemException('APPROVAL_REQUIRED', { status: 403 });
    return context.approve(client);
  }
}
