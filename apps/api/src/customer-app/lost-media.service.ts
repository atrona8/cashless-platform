// `reportMyMediaLost` : le festivalier déclare perdu un bracelet rattaché à l'un de SES portefeuilles. Le bracelet passe
// `SUSPENDED` (`suspend_media`, motif et auteur au journal des statuts) et l'action est auditée. Un bracelet d'un autre
// compte, non rattaché ou inconnu : même 404 (aucun oracle d'existence). Déjà suspendu : l'état courant, sans écriture.
import { Injectable } from '@nestjs/common';
import { AuditService, type AuditContext } from '../audit/audit.service';
import type { CustomerContext } from '../customer-identity/customer-identity.port';
import type { TxClient } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';
import type { CustomerMediaDto } from './me.service';

export const LOST_MEDIA_REASON = 'LOST_REPORTED_BY_CUSTOMER';

@Injectable()
export class LostMediaService {
  constructor(private readonly audit: AuditService) {}

  async reportLost(
    client: TxClient,
    customer: CustomerContext,
    mediaId: string,
    context: AuditContext,
  ): Promise<CustomerMediaDto> {
    const { rows } = await client.query<{ status: string }>(
      `SELECT m.status::text
         FROM media m
         JOIN media_assignment ma ON ma.media_id = m.id AND ma.released_at IS NULL
         JOIN wallet w ON w.id = ma.wallet_id
        WHERE m.id = $1 AND w.customer_id = $2
        FOR UPDATE OF m`,
      [mediaId, customer.customerId],
    );
    const before = rows[0]?.status;
    if (before === undefined) throw new ProblemException('NOT_FOUND');
    if (before !== 'SUSPENDED') {
      if (before !== 'ACTIVE')
        throw new ProblemException('CONFLICT_STATE', {
          detail: 'Ce bracelet ne peut pas être déclaré perdu dans son état actuel.',
        });
      await client.query('SELECT media_set_actor($1, $2)', [
        customer.customerId,
        LOST_MEDIA_REASON,
      ]);
      await client.query('SELECT suspend_media($1, $2, $3)', [
        mediaId,
        LOST_MEDIA_REASON,
        customer.customerId,
      ]);
      await this.audit.record(client, {
        ...context,
        operatorId: customer.operatorId,
        action: 'MEDIA_REPORTED_LOST',
        objectType: 'media',
        objectId: mediaId,
        before: { status: before },
        after: { status: 'SUSPENDED', reason: LOST_MEDIA_REASON },
      });
    }
    const current = await client.query<CustomerMediaDto>(
      `SELECT m.id AS media_id, NULL::text AS printed_number, m.status::text,
              m.deposit_status::text, ma.wallet_id
         FROM media m
         JOIN media_assignment ma ON ma.media_id = m.id AND ma.released_at IS NULL
        WHERE m.id = $1`,
      [mediaId],
    );
    return current.rows[0]!;
  }
}
