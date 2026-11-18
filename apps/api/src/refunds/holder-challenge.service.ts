// Codes du titulaire d'une demande de remboursement (mission 9a, WP03 ; FR-011, FR-012, FR-013, NFR-005, ADR-76).
// `startHolderChallenge` envoie le code au numéro vérifié du titulaire ; `decide` sert la route publique
// `decideRefundRequestAsHolder`. Ordre de `decide` (il fixe ce que la route peut révéler) : identifiant, demande et
// numéro du titulaire, CODE, puis seulement l'état. Aucun code ni numéro dans un journal.
import { Injectable } from '@nestjs/common';
import type { components } from '@cashless/contracts';
import { AuditService, type AuditContext } from '../audit/audit.service';
import { CustomerAuthService } from '../customer-auth/customer-auth.service';
import { TenantTx, type TxClient } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';

type RefundRequest = components['schemas']['RefundRequest'];
export type HolderDecision = 'CONFIRM' | 'BLOCK';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Réponse unique pour demande inconnue, numéro absent ou code faux : la route ne révèle rien sans code valide. */
const otpInvalid = () => new ProblemException('OTP_INVALID', { status: 422 });

interface RequestRow {
  id: string;
  wallet_id: string;
  status: RefundRequest['status'];
  estimated_amount: string;
  fee: string;
  currency: string;
  method: string;
  msisdn: string | null;
  transaction_id: string | null;
  approved_by: string | null;
  new_number: boolean;
  hold_until: Date | null;
  extra_check_required: boolean;
  external_reference: string | null;
  failure_reason: string | null;
  reversal_transaction_id: string | null;
  created_at: Date;
  reject_reason: string | null;
}

/** `RefundRequest` du contrat (montants par `Number`, comme `me.service.ts`) ; l'IBAN n'est jamais rendu ici. */
function toContract(row: RequestRow): RefundRequest {
  return {
    refund_request_id: row.id,
    wallet_id: row.wallet_id,
    status: row.status,
    estimated_amount: Number(row.estimated_amount),
    fee: Number(row.fee),
    currency: row.currency.trim() as RefundRequest['currency'],
    destination: {
      method: row.method,
      ...(row.msisdn ? { msisdn: row.msisdn } : {}),
    },
    transaction_id: row.transaction_id,
    approved_by: row.approved_by,
    new_number: row.new_number,
    hold_until: row.hold_until ? row.hold_until.toISOString() : null,
    extra_check_required: row.extra_check_required,
    external_reference: row.external_reference,
    failure_reason: row.failure_reason,
    reversal_transaction_id: row.reversal_transaction_id,
    created_at: row.created_at.toISOString(),
    ...(row.reject_reason ? { reject_reason: row.reject_reason } : {}),
  };
}

@Injectable()
export class HolderChallengeService {
  constructor(
    private readonly auth: CustomerAuthService,
    private readonly tx: TenantTx,
    private readonly audit: AuditService,
  ) {}

  /**
   * Envoie au titulaire un code lié à la demande (usage `REFUND_HOLDER`). La demande vient d'être insérée dans la
   * transaction de l'appelant (même `client`, RLS). Le défi se valide dans sa transaction propre ; un `429` lève et
   * fait annuler la création de la demande (comportement voulu du contrat).
   */
  async startHolderChallenge(
    client: TxClient,
    refundRequestId: string,
    holderPhone: string,
  ): Promise<void> {
    const { rows } = await client.query<{ operator_id: string }>(
      'SELECT operator_id FROM refund_request WHERE id = $1',
      [refundRequestId],
    );
    const operatorId = rows[0]?.operator_id;
    if (!operatorId) throw new ProblemException('INTERNAL_ERROR');
    await this.auth.issueChallenge({
      operatorId,
      phone: holderPhone,
      purpose: 'REFUND_HOLDER',
      subjectId: refundRequestId,
    });
  }

  async decide(
    refundRequestId: string,
    input: { decision: HolderDecision; otpRequestId: string; code: string },
    audit: AuditContext,
  ): Promise<RefundRequest> {
    // 1. Identifiant non conforme ou demande inconnue : même 422 qu'un code faux.
    if (!UUID.test(refundRequestId)) throw otpInvalid();
    const operatorId = await this.tx.withoutTenant(async (client) => {
      const { rows } = await client.query<{ id: string | null }>(
        'SELECT refund_request_operator($1) AS id',
        [refundRequestId],
      );
      return rows[0]?.id ?? null;
    });
    if (!operatorId) throw otpInvalid();
    // 2. Numéro vérifié du titulaire ; absent : même 422.
    const holderPhone = await this.tx.run(operatorId, async (client) => {
      const { rows } = await client.query<{ phone: string | null }>(
        `SELECT ci.phone FROM refund_request r
           JOIN customer_identity ci ON ci.customer_id = r.customer_id
          WHERE r.id = $1`,
        [refundRequestId],
      );
      return rows[0]?.phone ? rows[0].phone : null;
    });
    if (!holderPhone) throw otpInvalid();
    // 3. Le code est VÉRIFIÉ sans être consommé (OP-N124) : les essais et le blocage survivent à l'erreur ; la
    // consommation se fait dans la transaction de la décision, avec l'`UPDATE` de la demande.
    await this.auth.verifyChallengeOnly({
      otpRequestId: input.otpRequestId,
      code: input.code,
      expectedPhone: holderPhone,
      purpose: 'REFUND_HOLDER',
      subjectId: refundRequestId,
      operatorId,
    });
    // 4. Seulement ensuite l'état, à l'horloge de la base ; 5. audit dans la même transaction.
    return this.tx.run(operatorId, async (client) => {
      const { rows } = await client.query<RequestRow>(
        `UPDATE refund_request
            SET status = CASE $2 WHEN 'CONFIRM' THEN 'REQUESTED' ELSE 'BLOCKED' END,
                holder_decision = $2, holder_decided_at = clock_timestamp(), updated_at = clock_timestamp()
          WHERE id = $1 AND status = 'AWAITING_HOLDER' AND hold_until > clock_timestamp()
      RETURNING id, wallet_id, status, estimated_amount::text, fee::text, currency, method, msisdn,
                transaction_id, approved_by, new_number, hold_until, extra_check_required,
                external_reference, failure_reason, reversal_transaction_id, created_at, reject_reason`,
        [refundRequestId, input.decision],
      );
      const row = rows[0];
      // Rien à écrire (échu, déjà décidé) : la transaction s'annule, le code reste utilisable.
      if (!row) throw new ProblemException('CONFLICT_STATE');
      await this.auth.consumeChallenge(client, {
        otpRequestId: input.otpRequestId,
        expectedPhone: holderPhone,
        purpose: 'REFUND_HOLDER',
        subjectId: refundRequestId,
        operatorId,
      });
      // `BLOCK` : c'est l'alerte du contrat pour le back-office (aucune autre infrastructure d'alerte).
      await this.audit.record(client, {
        ...audit,
        actorId: null,
        actorRole: 'HOLDER',
        operatorId,
        action: 'REFUND_HOLDER_DECIDED',
        objectType: 'refund_request',
        objectId: refundRequestId,
        after: { decision: input.decision, status: row.status },
      });
      return toContract(row);
    });
  }
}
