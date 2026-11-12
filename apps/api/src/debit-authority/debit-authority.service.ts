// Autorité de débit côté humains (mission passerelle-locale, lot WP11, T047 ; FR-003, FR-004, FR-007 ; edge-routes.md
// `getDebitAuthority` et `requestDebitAuthorityChange`). Processus public (`cashless_app`) : EXECUTE sur
// `edge_grant_authority`, `get_debit_authority`, `fail_edge_release`, `force_central_authority_approved`,
// `request_edge_release`, `fail_edge_grant` (WP09). Jamais `set_debit_authority` ni `force_central_authority` (C-003).
//
// Le `target` et l'état du handover choisissent la fonction (le contrat n'a pas de champ pour l'abandon, écart 2) :
//   EDGE                              → edge_grant_authority          (handover GRANTED)
//   CENTRAL, handover TO_EDGE GRANTED → fail_edge_grant               (bascule non accusée abandonnée)
//   CENTRAL, handover TO_CENTRAL      → fail_edge_release             (rendu RELEASE_REQUESTED/RELEASING abandonné)
//   CENTRAL, sinon                    → request_edge_release          (CL013 si aucune autorité de passerelle active)
//   CENTRAL + force                   → demande d'approbation FORCE_CENTRAL_AUTHORITY (rien n'est exécuté ici)
// Lecture des états : `get_debit_authority` pour l'autorité ; le handover ouvert par un SELECT en lecture seule
// sous RLS (aucune fonction publique ne le rend à `cashless_app`).
import { Injectable } from '@nestjs/common';
import type { ApprovalRequestDto } from '../approval/approval.mapper';
import { ApprovalService, type ApprovalActor } from '../approval/approval.service';
import { AuditService } from '../audit/audit.service';
import type { TxClient } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';
import type { Principal, Role } from '../identity/principal';
import { exercisedRole, resolveChain } from '../identity/scope-resolver';
import { isUuid, notFound, unprocessable } from '../organization/platform/platform.dto';
import {
  stateDto,
  type AuthorityRow,
  type DebitAuthorityStateDto,
  type HandoverRow,
} from './debit-authority.mapper';
import { FORCE_REASON_MAX, type ForceCentralPayload } from './force-central.approval';

/** Lecture : `OPERATOR_ADMIN` du prestataire ou `ORGANIZER_ADMIN` de l'événement (écart 1 d'edge-routes.md). */
export const READ_ROLES = ['OPERATOR_ADMIN', 'ORGANIZER_ADMIN'] as const satisfies readonly Role[];
/** Changement : `OPERATOR_ADMIN` seul. Aucun rôle de guichet. */
export const CHANGE_ROLES = ['OPERATOR_ADMIN'] as const satisfies readonly Role[];

export interface ChangeInput {
  target: 'EDGE' | 'CENTRAL';
  reason: string;
  edgeGatewayId: string | null;
  force: boolean;
  gatewayConfirmedOffline: boolean;
}

export type ChangeResult =
  | { kind: 'STATE'; state: DebitAuthorityStateDto }
  | { kind: 'APPROVAL'; request: ApprovalRequestDto };

interface LedgerRef {
  id: string;
  eventId: string;
}

const OPEN = `('GRANTED','ACTIVE','RELEASE_REQUESTED','RELEASING')`;

@Injectable()
export class DebitAuthorityService {
  constructor(
    private readonly approvals: ApprovalService,
    private readonly audit: AuditService,
  ) {}

  async read(
    client: TxClient,
    principal: Principal,
    ledgerId: string,
  ): Promise<DebitAuthorityStateDto> {
    const ledger = await this.ledger(client, ledgerId);
    await this.role(client, principal, ledger, READ_ROLES);
    return this.state(client, ledger.id, await this.openHandover(client, ledger.id));
  }

  async change(
    client: TxClient,
    operatorId: string,
    ledgerId: string,
    input: ChangeInput,
    actor: ApprovalActor,
  ): Promise<ChangeResult> {
    const ledger = await this.ledger(client, ledgerId);
    const role = await this.role(client, actor.principal, ledger, CHANGE_ROLES);
    const userId = actor.principal.userId;
    if (input.force) return this.requestForce(client, operatorId, ledger, input, actor);

    if (input.target === 'EDGE') {
      if (input.edgeGatewayId === null)
        throw unprocessable('edge_gateway_id : passerelle attendue.');
      // Passerelle d'un autre prestataire ou inconnue : 404 neutre (RLS), jamais une erreur de droit de la base.
      const gateway = await client.query('SELECT 1 FROM edge_gateway WHERE id = $1', [
        input.edgeGatewayId,
      ]);
      if (gateway.rows.length === 0) throw notFound();
      const { rows } = await client.query<HandoverRow>(
        'SELECT * FROM edge_grant_authority($1, $2, $3)',
        [ledger.id, input.edgeGatewayId, userId],
      );
      // Décision 23 : les jetons d'appareil de l'événement sont exposés à la passerelle dans la transaction de
      // l'octroi, donc avant la première page de réplication servie (WP12).
      await client.query('SELECT edge_expose_device_token_families($1)', [ledger.eventId]);
      return this.done(
        client,
        operatorId,
        role,
        actor,
        'EDGE_AUTHORITY_GRANTED',
        ledger,
        rows[0]!,
        input,
      );
    }

    const open = await this.openHandover(client, ledger.id);
    if (open?.direction === 'TO_CENTRAL') {
      const { rows } = await client.query<HandoverRow>('SELECT * FROM fail_edge_release($1, $2)', [
        open.id,
        userId,
      ]);
      return this.done(
        client,
        operatorId,
        role,
        actor,
        'EDGE_AUTHORITY_ABANDONED',
        ledger,
        rows[0]!,
        input,
      );
    }
    if (open?.direction === 'TO_EDGE' && open.status === 'GRANTED') {
      const { rows } = await client.query<HandoverRow>(
        'SELECT * FROM fail_edge_grant($1, $2, $3)',
        [open.id, userId, input.reason],
      );
      return this.done(
        client,
        operatorId,
        role,
        actor,
        'EDGE_AUTHORITY_ABANDONED',
        ledger,
        rows[0]!,
        input,
      );
    }
    const { rows } = await client.query<HandoverRow>('SELECT * FROM request_edge_release($1, $2)', [
      ledger.id,
      userId,
    ]);
    return this.done(
      client,
      operatorId,
      role,
      actor,
      'EDGE_AUTHORITY_RELEASE_REQUESTED',
      ledger,
      rows[0]!,
      input,
    );
  }

  /** Reprise forcée : demande d'approbation seulement ; `gateway_confirmed_offline` vrai est exigé ici. */
  private async requestForce(
    client: TxClient,
    operatorId: string,
    ledger: LedgerRef,
    input: ChangeInput,
    actor: ApprovalActor,
  ): Promise<ChangeResult> {
    if (input.target !== 'CENTRAL') throw unprocessable('force : cible CENTRAL exigée.');
    if (!input.gatewayConfirmedOffline)
      throw unprocessable('gateway_confirmed_offline : true exigé pour une reprise forcée.');
    const authority = await this.authority(client, ledger.id);
    if (authority.authority !== 'EDGE' || authority.edge_gateway_id === null)
      throw new ProblemException('HANDOVER_INVALID_STATE', {
        detail: 'Le grand livre n’est pas sous l’autorité d’une passerelle.',
      });
    const payload: ForceCentralPayload = {
      ledger_id: ledger.id,
      reason: input.reason,
      edge_gateway_id: authority.edge_gateway_id,
      scope_id: ledger.eventId,
      gateway_confirmed_offline: true,
    };
    const request = await this.approvals.request(
      client,
      operatorId,
      { action: 'FORCE_CENTRAL_AUTHORITY', targetId: ledger.id, payload },
      actor,
    );
    return { kind: 'APPROVAL', request };
  }

  private async done(
    client: TxClient,
    operatorId: string,
    role: Role,
    actor: ApprovalActor,
    action:
      | 'EDGE_AUTHORITY_GRANTED'
      | 'EDGE_AUTHORITY_RELEASE_REQUESTED'
      | 'EDGE_AUTHORITY_ABANDONED',
    ledger: LedgerRef,
    handover: HandoverRow,
    input: ChangeInput,
  ): Promise<ChangeResult> {
    const state = await this.state(client, ledger.id, handover);
    await this.audit.record(client, {
      ...actor.audit,
      actorRole: role,
      operatorId,
      action,
      objectType: 'debit_authority_handover',
      objectId: handover.id,
      after: {
        ledger_id: ledger.id,
        direction: handover.direction,
        state: handover.status,
        epoch: state.epoch,
        edge_gateway_id: handover.direction === 'TO_EDGE' ? (input.edgeGatewayId ?? null) : null,
        reason: input.reason,
      },
    });
    return { kind: 'STATE', state };
  }

  /** Grand livre visible sous RLS (sinon 404 neutre), d'un événement : seuls ceux-là ont une passerelle. */
  private async ledger(client: TxClient, ledgerId: string): Promise<LedgerRef> {
    if (!isUuid(ledgerId)) throw notFound();
    const { rows } = await client.query<{ id: string; scope_type: string; scope_id: string }>(
      'SELECT id, scope_type, scope_id FROM ledger WHERE id = $1',
      [ledgerId],
    );
    const row = rows[0];
    if (!row || row.scope_type !== 'EVENT') throw notFound();
    return { id: row.id, eventId: row.scope_id };
  }

  /** Rôle tenu sur l'événement du grand livre (ou une portée qui l'englobe) ; sinon 403. */
  private async role(
    client: TxClient,
    principal: Principal,
    ledger: LedgerRef,
    roles: readonly Role[],
  ): Promise<Role> {
    const chain = await resolveChain(client, { type: 'EVENT', id: ledger.eventId });
    const role = exercisedRole(principal, roles, chain);
    if (!role) throw new ProblemException('FORBIDDEN');
    return role;
  }

  private async authority(client: TxClient, ledgerId: string): Promise<AuthorityRow> {
    const { rows } = await client.query<AuthorityRow>('SELECT * FROM get_debit_authority($1)', [
      ledgerId,
    ]);
    if (!rows[0]) throw notFound();
    return rows[0];
  }

  /** Bascule ouverte : celle du rendu si elle existe, sinon celle de l'accord ; `null` sans bascule ouverte. */
  private async openHandover(client: TxClient, ledgerId: string): Promise<HandoverRow | null> {
    const { rows } = await client.query<HandoverRow>(
      `SELECT id, direction, status, epoch, watermark_posting_id, final_edge_seq, requested_at, completed_at
         FROM debit_authority_handover
        WHERE ledger_id = $1 AND status IN ${OPEN}
        ORDER BY (direction = 'TO_CENTRAL') DESC, requested_at DESC LIMIT 1`,
      [ledgerId],
    );
    return rows[0] ?? null;
  }

  private async state(
    client: TxClient,
    ledgerId: string,
    handover: HandoverRow | null,
  ): Promise<DebitAuthorityStateDto> {
    return stateDto(await this.authority(client, ledgerId), handover);
  }
}

/** Corps du `POST` : champs du contrat seulement, `reason` obligatoire (422 sinon, le contrat n'a pas de 400). */
export function parseChange(raw: unknown): ChangeInput {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    throw unprocessable('Corps JSON (objet) attendu.');
  const body = raw as Record<string, unknown>;
  const known = ['target', 'reason', 'edge_gateway_id', 'force', 'gateway_confirmed_offline'];
  const foreign = Object.keys(body).filter((key) => !known.includes(key));
  if (foreign.length > 0) throw unprocessable(`Champ inconnu : ${foreign.join(', ')}.`);
  if (body.target !== 'EDGE' && body.target !== 'CENTRAL')
    throw unprocessable('target : EDGE ou CENTRAL attendu.');
  const reason = body.reason;
  if (
    typeof reason !== 'string' ||
    reason.trim() === '' ||
    reason.length > FORCE_REASON_MAX ||
    /[\r\n]/.test(reason)
  )
    throw unprocessable(`reason : texte d’une ligne de 1 à ${FORCE_REASON_MAX} caractères.`);
  const gateway = body.edge_gateway_id;
  if (gateway !== undefined && gateway !== null && !isUuid(gateway))
    throw unprocessable('edge_gateway_id : UUID attendu.');
  for (const flag of ['force', 'gateway_confirmed_offline'] as const)
    if (body[flag] !== undefined && typeof body[flag] !== 'boolean')
      throw unprocessable(`${flag} : booléen attendu.`);
  return {
    target: body.target,
    reason: reason.trim(),
    edgeGatewayId: typeof gateway === 'string' ? gateway : null,
    force: body.force === true,
    gatewayConfirmedOffline: body.gateway_confirmed_offline === true,
  };
}
