// Révocation d'une identification à deux personnes (mission 10a, WP06 ; FR-005, FR-006, C-002 ;
// ADR-74 ; openapi `revokeKycVerification`). Une PERSONNE du back-office demande, une AUTRE
// approuve : à l'exécution, `revoke_kyc_verification` passe l'identification à `REVOKED` ; le
// niveau du client retombe à `NONE` (FR-006). `revoked_by` est l'auteur de la DEMANDE (acteur
// authentifié, tel qu'enregistré par le service d'approbation, jamais une valeur du corps) ; le
// valideur est tracé par l'audit `APPROVAL_EXECUTED` (`approver_id`). La base ne contrôle pas
// `p_by` : seule cette chaîne le garantit.
//
// CONTRADICTION LEVÉE (23/11/2026) : SPECIFICATION §6.3 point 5 disait « un administrateur PEUT
// révoquer », alors que `openapi.yaml` (`revokeKycVerification`) exige deux personnes ; le contrat
// primait (§0.3, C-002, ADR-74). Le porteur a tranché : `SPECIFICATION.md` a été amendée le
// 23/11/2026 (§6.3 point 5, ADR-227) pour dire deux personnes, et OP-N164 est levé. Plus aucune
// contradiction à signaler.
// Écart de `research.md` R-03 : il fait vérifier l'état par `guardDecision`, alors que
// `contracts/kyc.md` veut une demande `FAILED` (et non `PENDING`) quand l'identification est déjà
// révoquée à l'exécution : on suit le contrat, `guardDecision` ne teste pas `REVOKED`.
// Limite : une identification posée par client (`wallet_id` nul) prend la portée `OPERATOR` : seul
// `OPERATOR_ADMIN` peut alors demander et approuver.
import { Injectable } from '@nestjs/common';
import { ApprovalActionRegistry, type ApprovalActionDefinition } from '../approval/action-registry';
import type { ApprovalRequestDto } from '../approval/approval.mapper';
import { ApprovalService, type ApprovalActor } from '../approval/approval.service';
import type { TxClient } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';
import type { ScopeRef } from '../identity/scope-resolver';
import type { StaffRole } from '../identity/roles.decorator';
import { isUuid, notFound, unprocessable } from '../organization/platform/platform.dto';
import { toKycVerification } from './kyc.service';

/** Rôles qui demandent et approuvent : ces deux-là, jamais d'autres (test de bornage). */
export const KYC_REVOCATION_ROLES: readonly StaffRole[] = ['OPERATOR_ADMIN', 'ORGANIZER_ADMIN'];

/** Motif : 10 caractères au moins après `trim` (même borne que la base, CL062). */
export const KYC_REVOCATION_REASON_MIN = 10;

/** Charge figée : jamais de `id_last4` ni de numéro de pièce. */
export interface KycRevocationPayload {
  kyc_verification_id: string;
  wallet_id: string | null;
  reason: string;
  scope_type: 'EVENT' | 'OPERATOR';
  scope_id: string;
}

const FIELDS = ['kyc_verification_id', 'wallet_id', 'reason', 'scope_type', 'scope_id'] as const;

/**
 * Corps de la route : `reason` (10 caractères au moins après `trim`). Une autre clé est sans effet
 * (le schéma n'interdit pas les clés en plus) : l'auteur de la révocation vient de l'acteur
 * authentifié, jamais du corps.
 */
export function parseKycRevocationBody(raw: unknown): { reason: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    throw unprocessable('Corps JSON attendu.');
  return { reason: checkReason((raw as Record<string, unknown>).reason) };
}

function checkReason(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length < KYC_REVOCATION_REASON_MIN)
    throw unprocessable(
      `reason : texte de ${KYC_REVOCATION_REASON_MIN} caractères au moins attendu.`,
    );
  return value.trim();
}

interface KycTarget {
  id: string;
  status: string;
  wallet_id: string | null;
  event_id: string | null;
}

@Injectable()
export class KycRevocationActions {
  constructor(
    registry: ApprovalActionRegistry,
    private readonly approvals: ApprovalService,
  ) {
    registry.register(this.definition() as ApprovalActionDefinition);
  }

  /**
   * Demande de révocation : lecture sous RLS (autre prestataire : 404), déjà révoquée : 409, une
   * seule demande ouverte par identification, puis `ApprovalService.request` (rôle de l'auteur sur
   * la portée). Rien n'est écrit sur l'identification. À appeler dans l'`IdempotentTx.run` de la
   * route ; l'auteur est `actor.principal`, jamais une valeur du corps.
   */
  async request(
    client: TxClient,
    operatorId: string,
    input: { kycVerificationId: string; reason: string },
    actor: ApprovalActor,
  ): Promise<ApprovalRequestDto> {
    const id = input.kycVerificationId;
    if (!isUuid(id)) throw notFound();
    const target = await this.readTarget(client, id);
    if (!target) throw notFound();
    if (target.status === 'REVOKED')
      throw new ProblemException('CONFLICT_STATE', {
        detail: 'Cette identification est déjà révoquée.',
      });
    const open = await client.query(
      `SELECT 1 FROM approval_request
        WHERE action = 'KYC_REVOCATION' AND target_id = $1
          AND (status = 'APPROVED' OR (status = 'PENDING' AND expires_at > now()))
        LIMIT 1`,
      [id],
    );
    if (open.rowCount !== 0)
      throw new ProblemException('CONFLICT_STATE', {
        detail: 'Une révocation est déjà en cours pour cette identification.',
      });
    const payload: KycRevocationPayload = {
      kyc_verification_id: id,
      wallet_id: target.wallet_id,
      reason: checkReason(input.reason),
      scope_type: target.event_id ? 'EVENT' : 'OPERATOR',
      scope_id: target.event_id ?? operatorId,
    };
    return this.approvals.request(
      client,
      operatorId,
      { action: 'KYC_REVOCATION', targetId: id, payload },
      actor,
    );
  }

  /** Identification et événement de son portefeuille, sous la RLS du prestataire. */
  private async readTarget(client: TxClient, id: string): Promise<KycTarget | undefined> {
    const withEvent = await client.query<KycTarget>(
      `SELECT k.id, k.status, k.wallet_id, l.scope_id AS event_id
         FROM kyc_verification k
         JOIN wallet w ON w.id = k.wallet_id
         JOIN ledger l ON l.id = w.ledger_id AND l.scope_type = 'EVENT'
        WHERE k.id = $1`,
      [id],
    );
    if (withEvent.rows[0]) return withEvent.rows[0];
    // Identification posée par client (wallet_id nul) : portée du prestataire.
    const bare = await client.query<KycTarget>(
      `SELECT id, status, wallet_id, NULL::uuid AS event_id FROM kyc_verification
        WHERE id = $1 AND wallet_id IS NULL`,
      [id],
    );
    return bare.rows[0];
  }

  private definition(): ApprovalActionDefinition<KycRevocationPayload> {
    return {
      action: 'KYC_REVOCATION',
      requiredRole: KYC_REVOCATION_ROLES,
      scopeOf: (p) => ({ type: p.scope_type, id: p.scope_id }) as ScopeRef,
      validate: validateShape,
      // Défense en profondeur, avant `decide` (approuver comme refuser). L'état `REVOKED` n'est PAS
      // testé ici : à l'exécution, la demande passe FAILED (contrat).
      guardDecision: async ({ client, request, payload }) => {
        if (request.target_id !== payload.kyc_verification_id)
          throw new ProblemException('APPROVAL_INVALID', {
            detail: 'L’identification visée par la demande n’est pas celle de sa charge utile.',
          });
        const seen = await client.query('SELECT 1 FROM kyc_verification WHERE id = $1', [
          payload.kyc_verification_id,
        ]);
        if (seen.rowCount !== 1) throw new ProblemException('NOT_FOUND');
      },
      execute: async (client, { request, payload, requestedBy }) => {
        // Charge relue de la base : revalidée (champ ajouté ou valeur modifiée : refus, rien
        // d'écrit).
        const checked = validateShape(payload);
        if (request.target_id !== checked.kyc_verification_id)
          throw new ProblemException('APPROVAL_INVALID', {
            detail: 'L’identification visée par la demande n’est pas celle de sa charge utile.',
          });
        // `requestedBy` (auteur de la demande), jamais `approvedBy` ; le valideur est à l'audit.
        const { rows } = await client.query('SELECT * FROM revoke_kyc_verification($1, $2, $3)', [
          checked.kyc_verification_id,
          requestedBy,
          checked.reason,
        ]);
        return { result: toKycVerification(rows[0]) as unknown as Record<string, unknown> };
      },
    };
  }
}

function validateShape(raw: unknown): KycRevocationPayload {
  const p = (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {}) as Record<
    string,
    unknown
  >;
  const foreign = Object.keys(p).filter((key) => !(FIELDS as readonly string[]).includes(key));
  if (foreign.length > 0) throw unprocessable(`Champ hors de l’action : ${foreign.join(', ')}.`);
  if (
    !isUuid(p.kyc_verification_id) ||
    !isUuid(p.scope_id) ||
    (p.scope_type !== 'EVENT' && p.scope_type !== 'OPERATOR') ||
    !(p.wallet_id === null || isUuid(p.wallet_id))
  )
    throw unprocessable('kyc_verification_id, wallet_id, scope_type et scope_id attendus.');
  return {
    kyc_verification_id: p.kyc_verification_id,
    wallet_id: p.wallet_id,
    reason: checkReason(p.reason),
    scope_type: p.scope_type,
    scope_id: p.scope_id,
  };
}
