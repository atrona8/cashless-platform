// Action à deux personnes `LATE_CLAIM` (mission 9b, WP10 ; FR-016, FR-024 ; ADR-67, ADR-74, ADR-75
// ; openapi `postLateClaim`). Un festivalier réclame son solde après la casse, grand livre
// `LOCKED`, jusqu'à `late_claims_until`. Une PERSONNE du back-office demande, une AUTRE approuve ;
// l'exécution écrit, sous le MÊME point de sauvegarde de l'approbation (tout ou rien) :
// `BREAKAGE_REVERSAL` (clé `bo:<clé>:reversal`) puis `WALLET_REFUND` (clé `bo:<clé>:refund`), en
// source `BACKOFFICE`. Les bornes sont celles de la base (`check_late_claim`, CL024) ; l'API les
// précontrôle. Modèle : `chargebacks/late-chargeback-action.ts`.
import { Injectable } from '@nestjs/common';
import { ApprovalActionRegistry, type ApprovalActionDefinition } from '../approval/action-registry';
import type { ApprovalRequestDto } from '../approval/approval.mapper';
import { ApprovalService, type ApprovalActor } from '../approval/approval.service';
import { AuditService } from '../audit/audit.service';
import { IbanVault, IbanVaultError } from '../common/iban-vault';
import { maskIban } from '../common/iban';
import type { TxClient } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';
import { resolveProblem } from '../errors/problem.filter';
import { isSqlError } from '../errors/sqlstate-map';
import type { StaffRole } from '../identity/roles.decorator';
import { moneyAccountFor } from '../ledger/builders/festival/refund';
import type { BreakageReversalPayload } from '../ledger/builders/closing/backoffice';
import { lockWalletPaidBalance } from '../ledger/db/ledger-queries';
import { LedgerEngineService } from '../ledger/ledger-engine.service';
import { isUuid, notFound, unprocessable } from '../organization/platform/platform.dto';
import { CASSE_PURPOSES, checkLateScope, lockKey, readLateLedger } from './late-claim-scope';
import { verifyLateClaimProof } from './late-claim-proof';
import { parseLateClaimBody, type LateClaimInput } from './late-claims.dto';

/**
 * Rôles qui demandent et approuvent : « rôle de l'opération (back-office) », jamais d'autres (test
 * de bornage).
 */
export const LATE_CLAIM_ROLES: readonly StaffRole[] = ['ORGANIZER_ADMIN', 'OPERATOR_ADMIN'];

/**
 * Charge figée de la demande : ledger, portefeuille et événement lus en base, jamais d'un autre
 * corps.
 */
export interface LateClaimPayload {
  ledger_id: string;
  wallet_id: string;
  amount: number;
  currency: string;
  proof: { kind: 'MEDIA_TAP'; tap_id: number } | { kind: 'CUSTOMER_ACCOUNT' };
  /** `iban` : enveloppe `enc:v1:` du coffre (jamais le clair) ; `iban_mask` : `maskIban`. */
  destination: { method: string; msisdn?: string; iban?: string; iban_mask?: string };
  reason: string;
  /** `bo:` + clé d'idempotence de l'appel : la paire d'écritures n'est écrite qu'une fois. */
  idempotency_key: string;
  scope_type: 'EVENT';
  scope_id: string;
}

const FIELDS = [
  'ledger_id',
  'wallet_id',
  'amount',
  'currency',
  'proof',
  'destination',
  'reason',
  'idempotency_key',
  'scope_type',
  'scope_id',
] as const;

/** Refus de l'exécution : la demande passe FAILED avec ce motif ; rien n'est écrit. */
const SQL_FAILURES: Readonly<Record<string, string>> = {
  CL024: 'Réclamation tardive hors des bornes permises sur un grand livre verrouillé.',
  CL003: 'Date limite des réclamations tardives dépassée (grand livre verrouillé).',
  CL006:
    'Réclamation refusée : le débit du portefeuille est sous l’autorité de la passerelle locale.',
  CL005: 'Période close : écriture datée avant la clôture.',
};

interface Figures {
  paidAccountId: string;
  taken: bigint;
  reversed: bigint;
  shares: BreakageReversalPayload['originalShares'] | undefined;
}

/**
 * Casse prise et déjà annulée sur le portefeuille, et parts d'origine (même calcul que
 * `check_late_claim`).
 */
async function readFigures(client: TxClient, walletId: string): Promise<Figures> {
  const account = await client.query<{ id: string }>(
    `SELECT id FROM account WHERE wallet_id = $1 AND purpose = 'WALLET_PAID'`,
    [walletId],
  );
  const paidAccountId = account.rows[0]?.id;
  if (!paidAccountId) throw notFound();
  const sums = await client.query<{ taken: string; reversed: string }>(
    `SELECT coalesce(sum(p.amount) FILTER (WHERE t.type = 'BREAKAGE' AND p.amount > 0), 0)::text
              AS taken,
            coalesce(-sum(p.amount) FILTER (WHERE t.type = 'BREAKAGE_REVERSAL'), 0)::text
              AS reversed
       FROM posting p JOIN journal_transaction t ON t.id = p.transaction_id
      WHERE p.account_id = $1`,
    [paidAccountId],
  );
  const parts = await client.query<{ purpose: string; credit: string }>(
    `SELECT a.purpose, (-sum(p.amount))::text AS credit
       FROM posting p JOIN account a ON a.id = p.account_id AND a.purpose = ANY($2::text[])
      WHERE p.amount < 0
        AND p.transaction_id IN (
              SELECT p2.transaction_id FROM posting p2
                JOIN journal_transaction t2
                  ON t2.id = p2.transaction_id AND t2.type = 'BREAKAGE'
               WHERE p2.account_id = $1)
      GROUP BY a.purpose`,
    [paidAccountId, [...CASSE_PURPOSES]],
  );
  const credit = (purpose: string): bigint =>
    BigInt(parts.rows.find((row) => row.purpose === purpose)?.credit ?? '0');
  let shares: Figures['shares'];
  if (credit('LEGAL_BREAKAGE') > 0n) shares = { legal: credit('LEGAL_BREAKAGE') };
  else if (credit('ORG_CASSE') + credit('OPE_CASSE') > 0n)
    shares = { organizer: credit('ORG_CASSE'), operator: credit('OPE_CASSE') };
  return {
    paidAccountId,
    taken: BigInt(sums.rows[0]!.taken),
    reversed: BigInt(sums.rows[0]!.reversed),
    shares,
  };
}

/** `409 LATE_CLAIM_INVALID` : annulation au-delà de la casse prise moins la casse déjà annulée. */
function checkBound(figures: Figures, amount: bigint): void {
  if (figures.taken === 0n || figures.shares === undefined)
    throw new ProblemException('LATE_CLAIM_INVALID', {
      detail: 'Aucune casse n’a été prise sur ce portefeuille.',
    });
  if (figures.reversed + amount > figures.taken)
    throw new ProblemException('LATE_CLAIM_INVALID', {
      detail: 'Le montant dépasse la casse prise sur ce portefeuille, moins la casse déjà annulée.',
    });
}

/**
 * Compte de caisse d'une session `OPEN` du grand livre ouverte par `userId` ; aucune : `422
 * REFUND_NOT_ALLOWED`.
 */
async function cashAccountOf(client: TxClient, ledgerId: string, userId: string): Promise<string> {
  const { rows } = await client.query<{ code: string }>(
    `SELECT a.code FROM cash_session s
       JOIN account a ON a.ledger_id = s.ledger_id AND a.id = s.cash_account_id
      WHERE s.ledger_id = $1 AND s.status = 'OPEN' AND s.opened_by = $2
      ORDER BY s.opened_at LIMIT 1`,
    [ledgerId, userId],
  );
  if (!rows[0])
    throw new ProblemException('REFUND_NOT_ALLOWED', {
      detail:
        'Remboursement en espèces : aucune session de caisse ouverte par l’auteur de la demande.',
    });
  return rows[0].code;
}

/**
 * Compte d'argent de sortie du moyen choisi, ouvert dans ce grand livre (sinon `422`, message
 * exact).
 */
async function moneyAccountOf(
  client: TxClient,
  ledgerId: string,
  method: string,
  userId: string,
): Promise<string> {
  const cash = method === 'CASH' ? await cashAccountOf(client, ledgerId, userId) : undefined;
  const code = moneyAccountFor(method, cash);
  const { rowCount } = await client.query(
    'SELECT 1 FROM account WHERE ledger_id = $1 AND code = $2 AND is_active',
    [ledgerId, code],
  );
  if (rowCount !== 1)
    throw new ProblemException('VALIDATION_FAILED', {
      status: 422,
      detail: `Compte d’argent ${code} absent du grand livre : moyen de sortie non ouvert.`,
    });
  return code;
}

@Injectable()
export class LateClaimActions {
  constructor(
    registry: ApprovalActionRegistry,
    private readonly engine: LedgerEngineService,
    private readonly approvals: ApprovalService,
    private readonly audit: AuditService,
    private readonly vault: IbanVault,
  ) {
    registry.register(this.definition() as ApprovalActionDefinition);
  }

  /**
   * Demande de réclamation tardive : précontrôle (portée, preuve, bornes, une seule demande ouverte
   * par portefeuille), fige la charge, puis `ApprovalService.request` (rôle de l'auteur sur
   * l'événement). Rien n'est écrit au grand livre. À appeler dans l'`IdempotentTx.run` de la route.
   */
  async request(
    client: TxClient,
    operatorId: string,
    input: { ledgerId: string; claim: LateClaimInput; idempotencyKey: string },
    actor: ApprovalActor,
  ): Promise<ApprovalRequestDto> {
    const { ledgerId, claim } = input;
    if (!isUuid(ledgerId)) throw notFound();
    await lockKey(client, `late-claim:${claim.walletId}`);
    const ledger = await readLateLedger(client, ledgerId);
    const walletRow = await client.query<{ operator_id: string }>(
      'SELECT operator_id FROM wallet WHERE id = $1 AND ledger_id = $2',
      [claim.walletId, ledgerId],
    );
    if (walletRow.rowCount !== 1) throw notFound();
    if (claim.currency !== ledger.currency)
      throw unprocessable('currency : ce n’est pas la devise du grand livre.');
    await checkLateScope(client, ledger);
    await verifyLateClaimProof(client, {
      operatorId: ledger.operatorId,
      walletId: claim.walletId,
      proof: claim.proof,
    });
    checkBound(await readFigures(client, claim.walletId), claim.amount);
    const open = await client.query(
      `SELECT 1 FROM approval_request
        WHERE action = 'LATE_CLAIM' AND target_id = $1
          AND (status = 'APPROVED' OR (status = 'PENDING' AND expires_at > now()))
        LIMIT 1`,
      [claim.walletId],
    );
    if (open.rowCount !== 0)
      throw new ProblemException('CONFLICT_STATE', {
        detail: 'Une réclamation tardive est déjà en cours pour ce portefeuille.',
      });
    // Moyen de sortie : refusé dès la demande quand il ne peut pas être servi (caisse, compte
    // d'argent).
    await moneyAccountOf(client, ledgerId, claim.destination.method, actor.principal.userId);
    const payload: LateClaimPayload = {
      ledger_id: ledgerId,
      wallet_id: claim.walletId,
      amount: Number(claim.amount),
      currency: claim.currency,
      proof: claim.proof,
      destination: this.sealDestination(claim.destination, operatorId),
      reason: claim.reason,
      idempotency_key: `bo:${input.idempotencyKey}`,
      scope_type: 'EVENT',
      scope_id: ledger.eventId,
    };
    const dto = await this.approvals.request(
      client,
      operatorId,
      { action: 'LATE_CLAIM', targetId: claim.walletId, payload },
      actor,
    );
    // Audit : jamais d'IBAN ni de numéro (le moyen seul).
    await this.audit.record(client, {
      ...actor.audit,
      operatorId,
      action: 'LATE_CLAIM_REQUESTED',
      objectType: 'wallet',
      objectId: claim.walletId,
      after: {
        approval_request_id: dto.approval_request_id,
        ledger_id: ledgerId,
        amount: payload.amount,
        method: claim.destination.method,
        proof: claim.proof.kind,
      },
    });
    return dto;
  }

  /** IBAN chiffré + masque dans la charge ; Wave et Orange Money : inchangés (aucun `iban`). */
  private sealDestination(
    destination: LateClaimInput['destination'],
    operatorId: string,
  ): LateClaimPayload['destination'] {
    if (destination.method !== 'BANK_TRANSFER' || destination.iban === undefined)
      return destination;
    return {
      method: destination.method,
      iban: this.vault.seal(destination.iban, operatorId),
      iban_mask: maskIban(destination.iban),
    };
  }

  /**
   * Forme de la charge (création et exécution, sans prestataire) : un IBAN en clair, un
   * `iban_mask` hors virement ou un champ en trop sont refusés, sans écho de la valeur.
   */
  private validatePayload = (raw: unknown): LateClaimPayload => {
    const payload = validateShape(raw);
    const d = payload.destination;
    if (d.method === 'BANK_TRANSFER') {
      if (
        typeof d.iban !== 'string' ||
        !this.vault.isSealed(d.iban) ||
        typeof d.iban_mask !== 'string'
      )
        throw unprocessable('destination.iban : enveloppe chiffrée et iban_mask attendus.');
    } else if (d.iban !== undefined || d.iban_mask !== undefined)
      throw unprocessable('destination : ni iban ni iban_mask pour ce moyen.');
    return payload;
  };

  /** À l'exécution : enveloppe ouverte pour le prestataire de la demande, sans réécriture. */
  private openClaim(payload: LateClaimPayload, operatorId: string): LateClaimInput {
    const d = payload.destination;
    let destination: Record<string, unknown> = { ...d };
    if (d.method === 'BANK_TRANSFER') {
      try {
        const iban = this.vault.open(d.iban!, operatorId);
        // Masque falsifié : refus (le masque affiché doit être celui de l'IBAN chiffré).
        if (d.iban_mask !== maskIban(iban)) throw new IbanVaultError('IBAN_VAULT_OPEN_FAILED');
        destination = { method: d.method, iban };
      } catch (error) {
        if (!(error instanceof IbanVaultError)) throw error;
        throw new ProblemException('APPROVAL_INVALID', {
          detail: 'IBAN de la charge utile illisible pour ce prestataire.',
        });
      }
    }
    return parseLateClaimBody({ ...claimBody(payload), destination });
  }

  private definition(): ApprovalActionDefinition<LateClaimPayload> {
    return {
      action: 'LATE_CLAIM',
      requiredRole: LATE_CLAIM_ROLES,
      scopeOf: (payload) => ({ type: 'EVENT', id: payload.scope_id }),
      validate: this.validatePayload,
      execute: async (client, { request, payload, requestedBy, approvedBy }) => {
        if (request.target_id !== payload.wallet_id)
          throw new ProblemException('APPROVAL_INVALID', {
            detail: 'Le portefeuille visé par la demande n’est pas celui de sa charge utile.',
          });
        try {
          // Charge relue de la base : revalidée à l'exécution (champ ajouté ou valeur modifiée :
          // refus, rien d'écrit).
          this.validatePayload(payload);
          const claim = this.openClaim(payload, request.operator_id);
          // Verrous (ordre de `interfaces.md`) : réclamation du portefeuille, puis solde payé du
          // portefeuille.
          await lockKey(client, `late-claim:${payload.wallet_id}`);
          const clock = await client.query<{ now: Date }>('SELECT clock_timestamp() AS now');
          const now = clock.rows[0]!.now;
          await lockWalletPaidBalance(client, {
            occurredAt: now,
            payload: { walletId: payload.wallet_id },
          });
          const ledger = await readLateLedger(client, payload.ledger_id);
          if (ledger.eventId !== payload.scope_id || claim.currency !== ledger.currency)
            throw new ProblemException('APPROVAL_INVALID', {
              detail: 'La charge utile ne correspond plus au grand livre.',
            });
          const owner = await client.query(
            'SELECT 1 FROM wallet WHERE id = $1 AND ledger_id = $2',
            [payload.wallet_id, payload.ledger_id],
          );
          if (owner.rowCount !== 1) throw new ProblemException('NOT_FOUND');
          await checkLateScope(client, ledger);
          await verifyLateClaimProof(client, {
            operatorId: ledger.operatorId,
            walletId: payload.wallet_id,
            proof: claim.proof,
          });
          const figures = await readFigures(client, payload.wallet_id);
          checkBound(figures, claim.amount);
          const base = {
            occurredAt: now,
            ledgerId: payload.ledger_id,
            eventId: ledger.eventId,
            currency: ledger.currency,
            source: 'BACKOFFICE' as const,
            createdBy: requestedBy,
            approvedBy,
            metadata: { approval_request_id: request.id, reason: claim.reason },
          };
          const reversal = await this.engine.execute(client, {
            ...base,
            type: 'BREAKAGE_REVERSAL',
            idempotencyKey: `${payload.idempotency_key}:reversal`,
            payload: {
              walletId: payload.wallet_id,
              amount: claim.amount,
              originalShares: figures.shares!,
            } satisfies BreakageReversalPayload,
          });
          if (!reversal.transactionId || reversal.replayed)
            throw new ProblemException('IDEMPOTENCY_KEY_REUSED', {
              detail: 'Cette clé a déjà écrit une annulation de casse.',
            });
          // Moyen de sortie résolu APRÈS l'annulation : un échec ici annule les deux écritures
          // (point de sauvegarde).
          const moneyAccount = await moneyAccountOf(
            client,
            payload.ledger_id,
            claim.destination.method,
            requestedBy,
          );
          const refund = await this.engine.execute(client, {
            ...base,
            type: 'WALLET_REFUND',
            idempotencyKey: `${payload.idempotency_key}:refund`,
            payload: {
              walletId: payload.wallet_id,
              amount: claim.amount,
              moneyAccount,
              waiveFee: true,
            },
          });
          if (!refund.transactionId || refund.replayed)
            throw new ProblemException('IDEMPOTENCY_KEY_REUSED', {
              detail: 'Cette clé a déjà écrit un remboursement.',
            });
          return {
            result: {
              ledger_id: payload.ledger_id,
              wallet_id: payload.wallet_id,
              amount: payload.amount,
              currency: payload.currency,
              breakage_reversal_transaction_id: reversal.transactionId,
              wallet_refund_transaction_id: refund.transactionId,
              approved_by: approvedBy,
            },
            executedTxId: refund.transactionId,
          };
        } catch (error) {
          throw failure(error);
        }
      },
    };
  }
}

/** Corps `LateClaimRequest` d'une charge utile (revalidation à l'exécution). */
function claimBody(payload: LateClaimPayload): Record<string, unknown> {
  return {
    wallet_id: payload.wallet_id,
    amount: payload.amount,
    currency: payload.currency,
    proof: payload.proof,
    destination: payload.destination,
    reason: payload.reason,
  };
}

/**
 * Refus SQL connu → erreur métier avec un motif lisible (la demande passe FAILED) ; le reste repart
 * tel quel.
 */
function failure(error: unknown): unknown {
  if (!isSqlError(error) || !(error.code in SQL_FAILURES)) return error;
  const problem = resolveProblem(error);
  return new ProblemException(problem.code, {
    status: problem.status,
    detail: SQL_FAILURES[error.code]!,
  });
}

function validateShape(raw: unknown): LateClaimPayload {
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
  // Forme chiffrée : l'IBAN n'est jamais revalidé ici (clair seulement à l'ouverture, à
  // l'exécution). Les autres champs passent par `parseLateClaimBody` avec un moyen neutre.
  const dest = (
    typeof p.destination === 'object' && p.destination !== null ? p.destination : {}
  ) as Record<string, unknown>;
  let destination: LateClaimPayload['destination'] | undefined;
  if (dest.method === 'BANK_TRANSFER') {
    const extra = Object.keys(dest).filter((k) => !['method', 'iban', 'iban_mask'].includes(k));
    if (extra.length > 0) throw unprocessable('destination : champ hors de l’action.');
    destination = {
      method: 'BANK_TRANSFER',
      iban: typeof dest.iban === 'string' ? dest.iban : undefined,
      iban_mask: typeof dest.iban_mask === 'string' ? dest.iban_mask : undefined,
    };
  } else if (dest.iban !== undefined || dest.iban_mask !== undefined) {
    throw unprocessable('destination : ni iban ni iban_mask pour ce moyen.');
  }
  const claim = parseLateClaimBody({
    wallet_id: p.wallet_id,
    amount: p.amount,
    currency: p.currency,
    proof: p.proof,
    destination: dest.method === 'BANK_TRANSFER' ? { method: 'CASH' } : p.destination,
    reason: p.reason,
  });
  destination ??= claim.destination;
  return {
    ledger_id: p.ledger_id,
    wallet_id: claim.walletId,
    amount: Number(claim.amount),
    currency: claim.currency,
    proof: claim.proof,
    destination,
    reason: claim.reason,
    idempotency_key: p.idempotency_key,
    scope_type: 'EVENT',
    scope_id: p.scope_id,
  };
}
