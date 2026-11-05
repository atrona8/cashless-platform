// Levée d'un trou de séquence, côté demande (mission 7, lot WP20, T083 ; FR-032, FR-033). La demande n'écrit rien :
// elle lit le terminal sous la RLS du prestataire, contrôle le rôle de la personne SUR L'ÉVÉNEMENT du terminal (avant
// toute indication sur l'existence du trou), puis `check_seq_gap_waivable` (sans effet), et enfin crée la demande
// `WAIVE_SEQ_GAP`. Le numéro vient du chemin, lu comme TEXTE puis `BigInt` : jamais un `Number`.
import { Injectable } from '@nestjs/common';
import { ApprovalService, type ApprovalActor } from '../../approval/approval.service';
import type { ApprovalRequestDto } from '../../approval/approval.mapper';
import { AuditService } from '../../audit/audit.service';
import type { TxClient } from '../../db/tenant-tx';
import { exercisedRole, resolveChain } from '../../identity/scope-resolver';
import { notFound, unprocessable } from '../../organization/platform/platform.dto';
import type { WaiveSeqGapPayload } from './waive-seq-gap.action';

/** Plus grand numéro représentable sans perte côté clients (R-14, `maximum` du contrat). */
export const MAX_SEQ = 9_007_199_254_740_991n;
export const REASON_MIN = 10;

/** `{seq}` du chemin : entier décimal de 1 à 2^53 - 1, lu sur le texte (jamais `Number`). */
export function parseSeq(raw: string): bigint {
  if (!/^[1-9][0-9]{0,15}$/.test(raw)) throw unprocessable('seq : entier de 1 à 2^53 - 1 attendu.');
  const value = BigInt(raw);
  if (value > MAX_SEQ) throw unprocessable('seq : entier de 1 à 2^53 - 1 attendu.');
  return value;
}

/** Corps de la levée : `reason` seul (au moins 10 caractères une fois rogné). */
export function parseWaiveBody(raw: unknown): string {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    throw unprocessable('Corps JSON (objet) attendu.');
  const body = raw as Record<string, unknown>;
  const foreign = Object.keys(body).filter((key) => key !== 'reason');
  if (foreign.length > 0) throw unprocessable(`Champ inconnu : ${foreign.join(', ')}.`);
  if (typeof body.reason !== 'string' || body.reason.trim().length < REASON_MIN)
    throw unprocessable(`reason : au moins ${REASON_MIN} caractères attendus.`);
  return body.reason.trim();
}

@Injectable()
export class SeqGapService {
  constructor(
    private readonly approvals: ApprovalService,
    private readonly audit: AuditService,
  ) {}

  async request(
    client: TxClient,
    operatorId: string,
    input: { deviceId: string; seq: bigint; reason: string },
    actor: ApprovalActor,
  ): Promise<ApprovalRequestDto> {
    const { rows } = await client.query<{ event_id: string | null }>(
      'SELECT event_id FROM device WHERE id = $1',
      [input.deviceId],
    );
    if (rows.length === 0) throw notFound();
    const eventId = rows[0]!.event_id;
    // Le rôle d'abord, et SANS révéler l'existence du terminal (décision du porteur, 04/11/2026) :
    // sans rôle
    // sur l'événement, la réponse est celle d'un terminal inconnu (404 neutre). Un terminal sans événement
    // n'a pas d'étendue où tenir un rôle : même 404.
    if (eventId === null) throw notFound();
    const chain = await resolveChain(client, { type: 'EVENT', id: eventId });
    if (!exercisedRole(actor.principal, ['SUPERVISOR'], chain)) throw notFound();
    // Sans effet : CL012 -> 409 SEQ_GAP_NOT_FOUND, CL010 -> 409 BATCH_IN_PROGRESS (table des SQLSTATE).
    await client.query('SELECT check_seq_gap_waivable($1, $2::bigint)', [
      input.deviceId,
      input.seq.toString(),
    ]);
    const payload: WaiveSeqGapPayload = {
      device_id: input.deviceId,
      seq: input.seq.toString(),
      reason: input.reason,
      scope_type: 'EVENT',
      scope_id: eventId,
    };
    const request = await this.approvals.request(
      client,
      operatorId,
      { action: 'WAIVE_SEQ_GAP', targetId: input.deviceId, payload },
      actor,
    );
    await this.audit.record(client, {
      ...actor.audit,
      operatorId,
      action: 'SEQ_GAP_WAIVE_REQUESTED',
      objectType: 'device',
      objectId: input.deviceId,
      after: {
        device_id: input.deviceId,
        seq: input.seq.toString(),
        reason: input.reason,
        approval_request_id: request.approval_request_id,
      },
    });
    return request;
  }
}
