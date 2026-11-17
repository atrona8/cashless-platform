// `confirmRefundRequest` (mission 9a, WP05 ; FR-009, FR-019, FR-020, NFR-001 ; décision 3) : enregistre le résultat
// du paiement fait HORS système. `PAID` n'écrit rien au grand livre ; `FAILED` contre-passe le `WALLET_REFUND` (le
// solde payé est recrédité) ; `FAILED` est refusé en 403 à qui a proposé ou exécuté le remboursement (décision 13 :
// une seule personne habilitée suffit encore pour recréditer, dette consignée par WP07). La demande est verrouillée :
// deux confirmations simultanées ne passent pas ensemble, et l'index `journal_transaction_reverses_once` borne le
// `REVERSAL` à un seul.
import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { TxClient } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';
import { exercisedRole, resolveChain } from '../identity/scope-resolver';
import { LedgerEngineService } from '../ledger/ledger-engine.service';
import { isUuid, objectBody } from '../organization/platform/platform.dto';
import type { TenantActor } from '../organization/tenant/tenant-access';
import { refuseUnderEdge, WALLET_REFUND_ROLES } from './wallet-refund-action';
import {
  REFUND_COLUMNS,
  toRefundRequest,
  type RefundRequest,
  type RefundRow,
} from './refund-requests.dto';

export type ConfirmInput =
  | { outcome: 'PAID'; externalReference: string }
  | { outcome: 'FAILED'; failureReason: string };

const invalid = (detail: string) =>
  new ProblemException('VALIDATION_FAILED', { status: 400, detail });
const TEXT_MAX = 2000;

/** Corps du contrat (`oneOf`) : champ inconnu, texte vide après `trim` ou issue inconnue : `400`. */
export function parseConfirmBody(raw: unknown): ConfirmInput {
  const body = objectBody(raw);
  const unknown = Object.keys(body).filter(
    (k) => !['outcome', 'external_reference', 'failure_reason'].includes(k),
  );
  if (unknown.length > 0) throw invalid(`corps : champ inconnu (${unknown.join(', ')}).`);
  const text = (value: unknown, name: string): string => {
    const t = typeof value === 'string' ? value.trim() : '';
    if (t.length === 0 || t.length > TEXT_MAX)
      throw invalid(`${name} : texte de 1 à ${TEXT_MAX} caractères attendu.`);
    return t;
  };
  if (body.outcome === 'PAID') {
    if (body.failure_reason !== undefined) throw invalid('failure_reason : interdit pour PAID.');
    return {
      outcome: 'PAID',
      externalReference: text(body.external_reference, 'external_reference'),
    };
  }
  if (body.outcome === 'FAILED') {
    if (body.external_reference !== undefined)
      throw invalid('external_reference : interdit pour FAILED.');
    return { outcome: 'FAILED', failureReason: text(body.failure_reason, 'failure_reason') };
  }
  throw invalid('outcome : PAID ou FAILED attendu.');
}

interface Locked {
  event_id: string;
  ledger_id: string;
  status: string;
  transaction_id: string | null;
  approved_by: string | null;
  approval_request_id: string | null;
  external_reference: string | null;
}

@Injectable()
export class RefundConfirmService {
  constructor(
    private readonly engine: LedgerEngineService,
    private readonly audit: AuditService,
  ) {}

  /** Dans la transaction idempotente de l'appelant (clé `bo:`). */
  async confirm(
    client: TxClient,
    actor: TenantActor,
    id: string,
    input: ConfirmInput,
    idempotencyKey: string,
  ): Promise<RefundRequest> {
    if (!isUuid(id)) throw new ProblemException('NOT_FOUND');
    const found = await client.query<Locked>(
      `SELECT event_id, ledger_id, status, transaction_id, approved_by, approval_request_id,
            external_reference
         FROM refund_request WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const current = found.rows[0];
    if (!current) throw new ProblemException('NOT_FOUND');
    const chain = await resolveChain(client, { type: 'EVENT', id: current.event_id });
    if (!exercisedRole(actor.principal, WALLET_REFUND_ROLES, chain))
      throw new ProblemException('NOT_FOUND');
    if (current.status !== 'PROCESSING') throw new ProblemException('CONFLICT_STATE');
    const who = actor.principal.userId;
    // Décision 13 : un échec recrédite le portefeuille ; il n'est jamais confirmé par qui a proposé ou exécuté la
    // sortie d'argent (sinon une seule personne ferait sortir puis rentrer l'argent). `PAID` reste ouvert.
    if (input.outcome === 'FAILED' && (await this.tookPart(client, current, who)))
      throw new ProblemException('FORBIDDEN', {
        detail:
          'Un échec ne peut être confirmé par la personne qui a proposé ou exécuté le remboursement.',
      });
    let row: RefundRow;
    if (input.outcome === 'PAID') {
      // Aucune écriture au grand livre : l'argent est déjà sorti par le WALLET_REFUND.
      const { rows } = await client.query<RefundRow>(
        `UPDATE refund_request r
            SET status = 'PAID', external_reference = $2, confirmed_by = $3,
                confirmed_at = clock_timestamp(), updated_at = clock_timestamp()
          WHERE r.id = $1 AND r.status = 'PROCESSING'
      RETURNING ${REFUND_COLUMNS}`,
        [id, input.externalReference, who],
      );
      row = rows[0]!;
    } else {
      // Un crédit n'est pas refusé par CL006 : la garde de l'API est le seul rempart (409 avant le REVERSAL).
      await refuseUnderEdge(client, current.ledger_id);
      // OP-N126 : le paiement est visible à la banque (ligne de relevé rapprochée à cette sortie d'argent) :
      // aucun recrédit. Lu sous le verrou de la demande, dans la transaction de la confirmation.
      await this.refuseIfBankMatched(client, current);
      const approvedBy = await this.reversalApprover(client, current, who);
      const now = (
        await client.query<{ now: Date; currency: string }>(
          `SELECT clock_timestamp() AS now, trim(currency) AS currency FROM ledger WHERE id = $1`,
          [current.ledger_id],
        )
      ).rows[0]!;
      const written = await this.engine.execute(client, {
        type: 'REVERSAL',
        source: 'BACKOFFICE',
        idempotencyKey: `bo:${idempotencyKey}`,
        occurredAt: now.now,
        ledgerId: current.ledger_id,
        eventId: current.event_id,
        currency: now.currency,
        reversesId: current.transaction_id!,
        // Auteur : la personne qui confirme ; valideur : celui de l'approbation (ou son auteur, si c'est la même).
        createdBy: who,
        approvedBy,
        payload: {},
        metadata: { refund_request_id: id, failure_reason: input.failureReason },
      });
      if (!written.transactionId || written.replayed)
        throw new ProblemException('IDEMPOTENCY_KEY_REUSED', {
          detail: 'Cette clé a déjà écrit une contre-passation.',
        });
      const { rows } = await client.query<RefundRow>(
        `UPDATE refund_request r
            SET status = 'FAILED', failure_reason = $2, reversal_transaction_id = $3, confirmed_by = $4,
                confirmed_at = clock_timestamp(), updated_at = clock_timestamp()
          WHERE r.id = $1 AND r.status = 'PROCESSING'
      RETURNING ${REFUND_COLUMNS}`,
        [id, input.failureReason, written.transactionId, who],
      );
      row = rows[0]!;
    }
    await this.audit.record(client, {
      ...actor.audit,
      operatorId: actor.operatorId,
      action: input.outcome === 'PAID' ? 'REFUND_REQUEST_PAID' : 'REFUND_REQUEST_FAILED',
      objectType: 'refund_request',
      objectId: id,
      before: { status: 'PROCESSING' },
      after: {
        status: row.status,
        ...(input.outcome === 'PAID'
          ? { external_reference: input.externalReference }
          : {
              failure_reason: input.failureReason,
              reversal_transaction_id: row.reversal_transaction_id,
            }),
      },
    });
    return toRefundRequest(row);
  }

  /** `409` si une ligne de relevé est rapprochée à la transaction (ou à la référence) du remboursement. */
  private async refuseIfBankMatched(client: TxClient, current: Locked): Promise<void> {
    const { rows } = await client.query(
      `SELECT 1 FROM external_statement_line l
        WHERE l.matched_tx_id = $1
           OR ($2::text IS NOT NULL AND l.external_ref = $2
               AND (l.matched_tx_id IS NOT NULL OR l.matched_anomaly_id IS NOT NULL))
        LIMIT 1`,
      [current.transaction_id, current.external_reference],
    );
    if (rows.length > 0)
      throw new ProblemException('CONFLICT_STATE', {
        detail:
          'Le paiement apparaît rapproché sur un relevé bancaire : il ne peut plus être déclaré en échec.',
      });
  }

  /** L'appelant a-t-il proposé (auteur de l'approbation) ou exécuté (`approved_by`) le remboursement ? */
  private async tookPart(client: TxClient, current: Locked, who: string): Promise<boolean> {
    if (current.approved_by === who) return true;
    const { rows } = await client.query<{ requested_by: string }>(
      'SELECT requested_by FROM approval_request WHERE id = $1',
      [current.approval_request_id],
    );
    return rows[0]?.requested_by === who;
  }

  /** Valideur du `REVERSAL` : celui de l'approbation d'origine, ou son auteur si c'est la personne qui confirme. */
  private async reversalApprover(client: TxClient, current: Locked, who: string): Promise<string> {
    if (current.approved_by && current.approved_by !== who) return current.approved_by;
    const { rows } = await client.query<{ requested_by: string }>(
      'SELECT requested_by FROM approval_request WHERE id = $1',
      [current.approval_request_id],
    );
    const author = rows[0]?.requested_by;
    if (!author || author === who) throw new ProblemException('CONFLICT_STATE');
    return author;
  }
}
