// Perte et bracelet retrouvé (SPECIFICATION §7.8 ; FR-028 ; contrat `reportMediaLost`, `recoverMedia`). Perte :
// `suspend_media` (motif et auteur au journal des statuts). Retrouvé : `recover_media` applique le réglage
// `lost_media_policy` de l'événement — `ACTIVE` (`REACTIVATE`) ou `RETIRED` (`END_OF_LIFE`, défaut).
// Rôles `CASHIER` et `SUPERVISOR`, tenus sur l'organisateur du lot ou sur l'événement du bracelet.
import { Injectable } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import type { TxClient } from '../../db/tenant-tx';
import { ProblemException } from '../../errors/problem';
import type { TenantActor } from '../../organization/tenant/tenant-access';
import { MediaReadService } from './media-read.service';

export const LOSS_ROLES = ['SUPERVISOR', 'CASHIER'] as const;

@Injectable()
export class LossService {
  constructor(
    private readonly media: MediaReadService,
    private readonly audit: AuditService,
  ) {}

  async reportLost(client: TxClient, actor: TenantActor, mediaId: string, reason: string) {
    const before = await this.authorize(client, actor, mediaId);
    await client.query('SELECT suspend_media($1, $2, $3)', [mediaId, reason, actor.principal.userId]);
    if (before !== 'SUSPENDED') {
      await this.audit.record(client, {
        ...actor.audit,
        operatorId: actor.operatorId,
        action: 'MEDIA_REPORTED_LOST',
        objectType: 'media',
        objectId: mediaId,
        before: { status: before },
        after: { status: 'SUSPENDED', reason },
      });
    }
    return this.media.detail(client, mediaId);
  }

  async recover(client: TxClient, actor: TenantActor, mediaId: string) {
    const before = await this.authorize(client, actor, mediaId);
    const reason = 'LOST_MEDIA_RECOVERED';
    await client.query('SELECT media_set_actor($1, $2)', [actor.principal.userId, reason]);
    const { rows } = await client.query<{ status: string }>('SELECT recover_media($1) AS status', [mediaId]);
    await this.audit.record(client, {
      ...actor.audit,
      operatorId: actor.operatorId,
      action: 'MEDIA_RECOVERED',
      objectType: 'media',
      objectId: mediaId,
      before: { status: before },
      after: { status: rows[0]!.status, reason },
    });
    return this.media.detail(client, mediaId);
  }

  /**
   * Bracelet du prestataire (404 sinon), verrouillé ; la personne tient CASHIER ou SUPERVISOR sur l'organisateur de
   * son lot ou sur son événement (403 sinon). Rend le statut courant.
   */
  private async authorize(client: TxClient, actor: TenantActor, mediaId: string): Promise<string> {
    const { rows } = await client.query<{ status: string; organizer_id: string | null; event_id: string | null }>(
      `SELECT m.status, b.organizer_id, media_event(m.id) AS event_id
         FROM media m LEFT JOIN media_batch b ON b.id = m.batch_id WHERE m.id = $1 FOR UPDATE OF m`,
      [mediaId],
    );
    const media = rows[0];
    if (!media) throw new ProblemException('NOT_FOUND');
    const allowed = actor.principal.assignments.some(
      (a) =>
        (LOSS_ROLES as readonly string[]).includes(a.role) &&
        ((a.scopeType === 'ORGANIZER' && a.scopeId !== null && a.scopeId === media.organizer_id) || (a.scopeType === 'EVENT' && a.scopeId !== null && a.scopeId === media.event_id)),
    );
    if (!allowed) throw new ProblemException('FORBIDDEN');
    return media.status;
  }
}
