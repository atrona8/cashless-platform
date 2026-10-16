// Liste noire d'un bracelet (SPECIFICATION §3.2, §7.8 ; FR-029, FR-035, SC-007). Entrée :
// `blacklist_media`, décidée par une personne avec un motif. Sortie : jamais ici, seulement par
// l'action à deux `REINSTATE_MEDIA` (blacklist-approval-actions.ts), qui appelle
// `reinstate_media` ; la base refuse auteur = valideur. Portée : l'événement du bracelet s'il en
// a un (un SUPERVISOR de l'organisateur la couvre), sinon l'organisateur de son lot.
import { Injectable } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import type { TxClient } from '../../db/tenant-tx';
import { ProblemException } from '../../errors/problem';
import { exercisedRole, resolveChain, type ScopeRef } from '../../identity/scope-resolver';
import type { TenantActor } from '../../organization/tenant/tenant-access';

export const BLACKLIST_ROLE = 'SUPERVISOR' as const;

interface SummaryRow {
  media_id: string;
  status: string;
  kind: string;
  key_index: number;
  personalized_at: Date | null;
  batch_id: string | null;
  batch_kind: string | null;
  batch_status: string | null;
  organizer_id: string | null;
  event_id: string | null;
  deposit_status: string;
  deposit_held: bigint;
  has_claim_code: boolean;
  claim_code_used_at: Date | null;
  wallets: Array<{
    wallet_id: string;
    currency: string;
    spendable: number;
    attached_to_account: boolean;
  }>;
}

@Injectable()
export class BlacklistService {
  constructor(private readonly audit: AuditService) {}

  /** Portée d'un bracelet du prestataire (404 s'il n'existe pas pour lui), verrouillé. */
  async scopeOf(client: TxClient, mediaId: string): Promise<{ scope: ScopeRef; status: string }> {
    const { rows } = await client.query<{
      status: string;
      organizer_id: string | null;
      event_id: string | null;
    }>(
      `SELECT m.status, b.organizer_id, media_event(m.id) AS event_id
         FROM media m LEFT JOIN media_batch b ON b.id = m.batch_id
        WHERE m.id = $1 FOR UPDATE OF m`,
      [mediaId],
    );
    const media = rows[0];
    if (!media || (!media.event_id && !media.organizer_id)) throw new ProblemException('NOT_FOUND');
    const scope: ScopeRef = media.event_id
      ? { type: 'EVENT', id: media.event_id }
      : { type: 'ORGANIZER', id: media.organizer_id! };
    return { scope, status: media.status };
  }

  /**
   *  La personne tient SUPERVISOR sur la portée du bracelet (ou une portée englobante) ; 403
   *  sinon.
   */
  async authorize(client: TxClient, actor: TenantActor, scope: ScopeRef): Promise<void> {
    const chain = await resolveChain(client, scope);
    if (!exercisedRole(actor.principal, [BLACKLIST_ROLE], chain))
      throw new ProblemException('FORBIDDEN');
  }

  async blacklist(client: TxClient, actor: TenantActor, mediaId: string, reason: string) {
    const { scope, status } = await this.scopeOf(client, mediaId);
    await this.authorize(client, actor, scope);
    // Passage non permis (bracelet remplacé, retiré, détruit) : refus de la base, CL020 →
    // 409.
    await client.query('SELECT blacklist_media($1, $2, $3)', [
      mediaId,
      reason,
      actor.principal.userId,
    ]);
    // Tracé même si le bracelet était déjà en liste noire (la base ne change rien) : l'acte d'une
    // seconde personne, et son motif, doivent rester au journal.
    await this.audit.record(client, {
      ...actor.audit,
      operatorId: actor.operatorId,
      action: 'MEDIA_BLACKLISTED',
      objectType: 'media',
      objectId: mediaId,
      before: { status },
      after: { status: 'BLACKLISTED', reason },
    });
    return this.detail(client, mediaId);
  }

  /**
   * Préalables d'une demande de sortie (`REINSTATE_MEDIA`) : droit de l'auteur sur la portée du
   * bracelet (403), bracelet en liste noire (409 `MEDIA_STATE_INVALID`), aucune autre demande de
   * sortie en attente pour lui (409 `CONFLICT_STATE`). Rend la portée et l'épisode de liste noire
   * levé (dernière ligne de l'historique vers BLACKLISTED), à figer dans la demande. Le verrou
   * du bracelet (`scopeOf`) sérialise deux demandes simultanées.
   */
  async reinstatable(
    client: TxClient,
    actor: TenantActor,
    mediaId: string,
  ): Promise<{ scope: { type: 'EVENT' | 'ORGANIZER'; id: string }; blacklistHistoryId: string }> {
    const { scope, status } = await this.scopeOf(client, mediaId);
    await this.authorize(client, actor, scope);
    if (scope.type !== 'EVENT' && scope.type !== 'ORGANIZER') throw new Error('portée inattendue');
    const blacklistHistoryId =
      status === 'BLACKLISTED' ? await lastBlacklisting(client, mediaId) : null;
    if (!blacklistHistoryId) {
      throw new ProblemException('MEDIA_STATE_INVALID', {
        status: 409,
        detail: `Le bracelet n’est pas en liste noire (${status}) : aucune sortie à demander.`,
      });
    }
    const pending = await client.query(
      `SELECT 1 FROM approval_request
        WHERE action = 'REINSTATE_MEDIA' AND target_id = $1 AND status = 'PENDING'
          AND expires_at >= clock_timestamp()
        LIMIT 1`,
      [mediaId],
    );
    if ((pending.rowCount ?? 0) > 0) {
      throw new ProblemException('CONFLICT_STATE', {
        status: 409,
        detail: 'Une demande de sortie de liste noire est déjà en attente pour ce bracelet.',
      });
    }
    return { scope: { type: scope.type, id: scope.id }, blacklistHistoryId };
  }

  /**
   * Bracelet vu du back-office (contrat `MediaAdmin`, avec son historique). Même lecture que
   * `MediaReadService.detail` (WP15, autre lane) : à fusionner avec elle à la fusion de la
   * mission.
   */
  async detail(client: TxClient, mediaId: string) {
    const { rows } = await client.query<SummaryRow>(
      `SELECT s.media_id, s.status, s.kind, s.key_index, s.personalized_at, s.batch_id,
              s.batch_kind, s.batch_status, s.organizer_id, s.event_id, s.deposit_status,
              s.deposit_held,
              s.has_claim_code, s.claim_code_used_at, s.wallets
         FROM media_summary($1) s`,
      [mediaId],
    );
    const m = rows[0];
    if (!m) throw new ProblemException('NOT_FOUND');
    const history = await client.query<{
      from_status: string | null;
      to_status: string;
      reason: string | null;
      actor_id: string | null;
      approved_by: string | null;
      at: Date;
    }>(
      'SELECT from_status, to_status, reason, actor_id, approved_by, at FROM media_status_log($1)',
      [mediaId],
    );
    return {
      media_id: m.media_id,
      status: m.status,
      kind: m.kind,
      key_index: m.key_index,
      personalized_at: m.personalized_at?.toISOString() ?? null,
      batch_id: m.batch_id,
      batch_kind: m.batch_kind,
      batch_status: m.batch_status,
      organizer_id: m.organizer_id,
      event_id: m.event_id,
      deposit_status: m.deposit_status,
      deposit_held: Number(m.deposit_held),
      has_claim_code: m.has_claim_code,
      claim_code_used_at: m.claim_code_used_at?.toISOString() ?? null,
      wallets: m.wallets.map((w) => ({
        wallet_id: w.wallet_id,
        currency: String(w.currency).trim(),
        spendable: Number(w.spendable),
        attached_to_account: w.attached_to_account,
      })),
      status_history: history.rows.map((h) => ({ ...h, at: h.at.toISOString() })),
    };
  }
}

/**
 * Identifiant (texte) de la dernière ligne de `media_status_history` vers BLACKLISTED du
 * bracelet : l'épisode de liste noire en cours ; `null` s'il n'y en a aucune.
 */
export async function lastBlacklisting(client: TxClient, mediaId: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT id::text AS id FROM media_status_history
      WHERE media_id = $1 AND to_status = 'BLACKLISTED'
      ORDER BY id DESC LIMIT 1`,
    [mediaId],
  );
  return rows[0]?.id ?? null;
}
