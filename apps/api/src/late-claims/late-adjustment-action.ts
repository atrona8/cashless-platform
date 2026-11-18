// Action à deux personnes `ADJUSTMENT` (mission 9b, WP10 ; FR-016, FR-024 ; ADR-75 ; route 14
// `postLateAdjustment`). Après une réclamation tardive, un bénéficiaire de la casse (`ORGANIZER` ou
// `OPERATOR`) rapporte sa part : une écriture `ADJUSTMENT` (compte d'argent débité, compte de casse
// du bénéficiaire crédité), source `BACKOFFICE`, sur grand livre `LOCKED`. La base borne l'apport à
// ce qui a été annulé sur son compte de casse depuis le verrouillage (`check_late_claim`, CL024) ;
// l'API le précontrôle. Une personne demande, une AUTRE approuve.
import { Injectable } from '@nestjs/common';
import { ApprovalActionRegistry, type ApprovalActionDefinition } from '../approval/action-registry';
import type { ApprovalRequestDto } from '../approval/approval.mapper';
import { ApprovalService, type ApprovalActor } from '../approval/approval.service';
import { AuditService } from '../audit/audit.service';
import type { TxClient } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';
import { resolveProblem } from '../errors/problem.filter';
import { isSqlError } from '../errors/sqlstate-map';
import type { StaffRole } from '../identity/roles.decorator';
import type { AdjustmentPayload } from '../ledger/builders/closing/backoffice';
import { moneyAccountFor } from '../ledger/builders/festival/refund';
import { LedgerEngineService } from '../ledger/ledger-engine.service';
import { isUuid, notFound, unprocessable } from '../organization/platform/platform.dto';
import { checkLateScope, lockKey, readLateLedger, type LateLedger } from './late-claim-scope';
import { parseLateAdjustmentBody, type LateAdjustmentInput } from './late-claims.dto';

/** Rôles qui demandent et approuvent : jamais d'autres (test de bornage). */
export const LATE_ADJUSTMENT_ROLES: readonly StaffRole[] = ['ORGANIZER_ADMIN', 'OPERATOR_ADMIN'];

export interface LateAdjustmentPayload {
  ledger_id: string;
  beneficiary_party_id: string;
  amount: number;
  currency: string;
  reason: string;
  /** `bo:` + clé d'idempotence de l'appel : l'apport n'est écrit qu'une fois. */
  idempotency_key: string;
  scope_type: 'EVENT';
  scope_id: string;
}

const FIELDS = [
  'ledger_id',
  'beneficiary_party_id',
  'amount',
  'currency',
  'reason',
  'idempotency_key',
  'scope_type',
  'scope_id',
] as const;

const SQL_FAILURES: Readonly<Record<string, string>> = {
  CL024: 'Apport hors des bornes permises : au plus ce qui a été annulé sur le compte de casse.',
  CL003: 'Date limite des réclamations tardives dépassée (grand livre verrouillé).',
  CL006: 'Apport refusé : le débit des portefeuilles est sous l’autorité de la passerelle locale.',
  CL005: 'Période close : écriture datée avant la clôture.',
};

interface Beneficiary {
  accountId: string;
  purpose: 'ORG_CASSE' | 'OPE_CASSE';
}

/**
 * Compte de casse du bénéficiaire : l'organisateur ou le prestataire de l'événement, jamais un
 * compte légal.
 */
async function beneficiaryAccount(
  client: TxClient,
  ledger: LateLedger,
  partyId: string,
): Promise<Beneficiary> {
  const purpose =
    partyId === ledger.organizerId
      ? 'ORG_CASSE'
      : partyId === ledger.operatorId
        ? 'OPE_CASSE'
        : undefined;
  if (!purpose) {
    const legal = await client.query(
      `SELECT 1 FROM account
        WHERE ledger_id = $1 AND purpose = 'LEGAL_BREAKAGE' AND owner_party_id = $2`,
      [ledger.id, partyId],
    );
    throw unprocessable(
      legal.rowCount === 1
        ? 'Casse versée à un compte légal : aucun apport par cette opération.'
        : 'beneficiary_party_id : ni l’organisateur ni le prestataire de l’événement.',
    );
  }
  const { rows } = await client.query<{ id: string }>(
    'SELECT id FROM account WHERE ledger_id = $1 AND purpose = $2 AND owner_party_id = $3',
    [ledger.id, purpose, partyId],
  );
  if (!rows[0]) throw unprocessable('Compte de casse du bénéficiaire absent du grand livre.');
  return { accountId: rows[0].id, purpose };
}

/**
 * `409 LATE_CLAIM_INVALID` : apport au-delà de ce qui a été annulé sur le compte, moins les apports
 * déjà faits.
 */
async function checkBound(
  client: TxClient,
  ledger: LateLedger,
  accountId: string,
  amount: bigint,
): Promise<void> {
  const { rows } = await client.query<{ reversed: string; adjusted: string }>(
    `SELECT coalesce(sum(p.amount) FILTER (WHERE t.type = 'BREAKAGE_REVERSAL'), 0)::text
              AS reversed,
            coalesce(-sum(p.amount) FILTER (
              WHERE t.type = 'ADJUSTMENT' AND t.recorded_at > $2), 0)::text AS adjusted
       FROM posting p JOIN journal_transaction t ON t.id = p.transaction_id
      WHERE p.account_id = $1`,
    [accountId, ledger.lockedUntil],
  );
  const room = BigInt(rows[0]!.reversed) - BigInt(rows[0]!.adjusted);
  if (room <= 0n || amount > room)
    throw new ProblemException('LATE_CLAIM_INVALID', {
      detail: 'L’apport dépasse ce qui a été annulé sur le compte de casse du bénéficiaire.',
    });
}

async function bankAccountId(client: TxClient, ledgerId: string): Promise<string> {
  const code = moneyAccountFor('BANK_TRANSFER');
  const { rows } = await client.query<{ code: string }>(
    'SELECT code FROM account WHERE ledger_id = $1 AND code = $2 AND is_active',
    [ledgerId, code],
  );
  if (!rows[0])
    throw new ProblemException('VALIDATION_FAILED', {
      status: 422,
      detail: `Compte d’argent ${code} absent du grand livre.`,
    });
  return code;
}

@Injectable()
export class LateAdjustmentActions {
  constructor(
    registry: ApprovalActionRegistry,
    private readonly engine: LedgerEngineService,
    private readonly approvals: ApprovalService,
    private readonly audit: AuditService,
  ) {
    registry.register(this.definition() as ApprovalActionDefinition);
  }

  /**
   * Demande d'apport : précontrôle de portée et de bornes, charge figée, `ApprovalService.request`.
   */
  async request(
    client: TxClient,
    operatorId: string,
    input: { ledgerId: string; adjustment: LateAdjustmentInput; idempotencyKey: string },
    actor: ApprovalActor,
  ): Promise<ApprovalRequestDto> {
    const { ledgerId, adjustment } = input;
    if (!isUuid(ledgerId)) throw notFound();
    await lockKey(client, `late-adjustment:${ledgerId}:${adjustment.beneficiaryPartyId}`);
    const ledger = await readLateLedger(client, ledgerId);
    if (adjustment.currency !== ledger.currency)
      throw unprocessable('currency : ce n’est pas la devise du grand livre.');
    await checkLateScope(client, ledger);
    const beneficiary = await beneficiaryAccount(client, ledger, adjustment.beneficiaryPartyId);
    await checkBound(client, ledger, beneficiary.accountId, adjustment.amount);
    await bankAccountId(client, ledgerId);
    const payload: LateAdjustmentPayload = {
      ledger_id: ledgerId,
      beneficiary_party_id: adjustment.beneficiaryPartyId,
      amount: Number(adjustment.amount),
      currency: adjustment.currency,
      reason: adjustment.reason,
      idempotency_key: `bo:${input.idempotencyKey}`,
      scope_type: 'EVENT',
      scope_id: ledger.eventId,
    };
    const dto = await this.approvals.request(
      client,
      operatorId,
      { action: 'ADJUSTMENT', targetId: ledgerId, payload },
      actor,
    );
    await this.audit.record(client, {
      ...actor.audit,
      operatorId,
      action: 'LATE_ADJUSTMENT_REQUESTED',
      objectType: 'ledger',
      objectId: ledgerId,
      after: {
        approval_request_id: dto.approval_request_id,
        beneficiary_party_id: payload.beneficiary_party_id,
        amount: payload.amount,
      },
    });
    return dto;
  }

  private definition(): ApprovalActionDefinition<LateAdjustmentPayload> {
    return {
      action: 'ADJUSTMENT',
      requiredRole: LATE_ADJUSTMENT_ROLES,
      scopeOf: (payload) => ({ type: 'EVENT', id: payload.scope_id }),
      validate: validatePayload,
      execute: async (client, { request, payload, requestedBy, approvedBy }) => {
        if (request.target_id !== payload.ledger_id)
          throw new ProblemException('APPROVAL_INVALID', {
            detail: 'Le grand livre visé par la demande n’est pas celui de sa charge utile.',
          });
        try {
          // Charge relue de la base : revalidée à l'exécution (champ ajouté ou valeur modifiée :
          // refus, rien d'écrit).
          validatePayload(payload);
          const amount = BigInt(payload.amount);
          await lockKey(
            client,
            `late-adjustment:${payload.ledger_id}:${payload.beneficiary_party_id}`,
          );
          const ledger = await readLateLedger(client, payload.ledger_id);
          if (ledger.eventId !== payload.scope_id || payload.currency !== ledger.currency)
            throw new ProblemException('APPROVAL_INVALID', {
              detail: 'La charge utile ne correspond plus au grand livre.',
            });
          await checkLateScope(client, ledger);
          const beneficiary = await beneficiaryAccount(
            client,
            ledger,
            payload.beneficiary_party_id,
          );
          await checkBound(client, ledger, beneficiary.accountId, amount);
          const bank = await bankAccountId(client, payload.ledger_id);
          const clock = await client.query<{ now: Date }>('SELECT clock_timestamp() AS now');
          const written = await this.engine.execute(client, {
            type: 'ADJUSTMENT',
            source: 'BACKOFFICE',
            idempotencyKey: payload.idempotency_key,
            occurredAt: clock.rows[0]!.now,
            ledgerId: payload.ledger_id,
            eventId: ledger.eventId,
            currency: ledger.currency,
            createdBy: requestedBy,
            approvedBy,
            payload: {
              lines: [
                { account: { code: bank }, amount },
                {
                  account: {
                    purpose: beneficiary.purpose,
                    ownerPartyId: payload.beneficiary_party_id,
                  },
                  amount: -amount,
                },
              ],
            } satisfies AdjustmentPayload,
            metadata: { approval_request_id: request.id, reason: payload.reason },
          });
          if (!written.transactionId || written.replayed)
            throw new ProblemException('IDEMPOTENCY_KEY_REUSED', {
              detail: 'Cette clé a déjà écrit un apport.',
            });
          return {
            result: {
              ledger_id: payload.ledger_id,
              beneficiary_party_id: payload.beneficiary_party_id,
              amount: payload.amount,
              currency: payload.currency,
              transaction_id: written.transactionId,
              approved_by: approvedBy,
            },
            executedTxId: written.transactionId,
          };
        } catch (error) {
          throw failure(error);
        }
      },
    };
  }
}

function failure(error: unknown): unknown {
  if (!isSqlError(error) || !(error.code in SQL_FAILURES)) return error;
  const problem = resolveProblem(error);
  return new ProblemException(problem.code, {
    status: problem.status,
    detail: SQL_FAILURES[error.code]!,
  });
}

function validatePayload(raw: unknown): LateAdjustmentPayload {
  const p = (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {}) as Record<
    string,
    unknown
  >;
  const foreign = Object.keys(p).filter((key) => !(FIELDS as readonly string[]).includes(key));
  if (foreign.length > 0) throw unprocessable(`Champ hors de l’action : ${foreign.join(', ')}.`);
  if (
    !isUuid(p.ledger_id) ||
    !isUuid(p.scope_id) ||
    p.scope_type !== 'EVENT' ||
    typeof p.idempotency_key !== 'string' ||
    !p.idempotency_key.startsWith('bo:')
  )
    throw unprocessable('ledger_id, scope_type (EVENT), scope_id et idempotency_key attendus.');
  const adjustment = parseLateAdjustmentBody({
    beneficiary_party_id: p.beneficiary_party_id,
    amount: p.amount,
    currency: p.currency,
    reason: p.reason,
  });
  return {
    ledger_id: p.ledger_id,
    beneficiary_party_id: adjustment.beneficiaryPartyId,
    amount: Number(adjustment.amount),
    currency: adjustment.currency,
    reason: adjustment.reason,
    idempotency_key: p.idempotency_key,
    scope_type: 'EVENT',
    scope_id: p.scope_id,
  };
}
