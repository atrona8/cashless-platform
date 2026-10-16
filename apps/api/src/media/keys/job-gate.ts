// Revérification d'un travail de clé par le processus qui l'exécute (correctif post-fusion n° 1,
// constat SEC-1 ; ADR-102). La base n'accepte plus un travail sans demande approuvée à deux
// concordante (migration 0020) ; chaque exécutant le revérifie quand même, juste après l'avoir pris
// et avant tout appel au service de clés : un travail planté par une autre voie (connexion du
// propriétaire, droit rétabli par erreur) n'est jamais exécuté. Refus : le travail passe en échec
// avec son motif, une ligne d'audit `TAG_KEY_JOB_REFUSED` est écrite dans la même transaction et le
// processus lève son code d'alerte (`--once` le rend comme code de sortie).
import { Injectable } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import { TenantTx } from '../../db/tenant-tx';
import type { TagKeyJobRow } from './keys.dto';

/** Code d'alerte d'un processus qui a refusé au moins un travail de clé. */
export const ALARM_JOB_REFUSED = 4;

export type JobOrigin = 'key-admin' | 'personalization' | 'tag-keys';

@Injectable()
export class TagKeyJobGate {
  private refused = 0;

  constructor(
    private readonly tx: TenantTx,
    private readonly audit: AuditService,
  ) {}

  /** Vrai si le travail peut être exécuté ; sinon il est refusé (échec, audit, alerte). */
  async admit(job: TagKeyJobRow, origin: JobOrigin): Promise<boolean> {
    const reason = await this.tx.run(job.operator_id, async (client) => {
      const { rows } = await client.query<{ refusal: string | null }>(
        'SELECT tag_key_job_refusal($1) AS refusal',
        [job.id],
      );
      // Une ligne attendue : NULL = travail admis ; aucune ligne = revérification impossible, donc
      // refus.
      return rows.length === 1 ? rows[0]!.refusal : 'revérification impossible';
    });
    if (reason === null) return true;
    await this.refuse(job, origin, reason);
    return false;
  }

  /** Refuse un travail pris : échec avec motif, audit, alerte. Il n'est jamais exécuté. */
  async refuse(job: TagKeyJobRow, origin: JobOrigin, reason: string): Promise<void> {
    await this.tx.run(job.operator_id, async (client) => {
      await this.audit.record(client, {
        operatorId: job.operator_id,
        actorId: null,
        actorRole: null,
        origin,
        requestId: null,
        action: 'TAG_KEY_JOB_REFUSED',
        objectType: 'tag_key_job',
        objectId: job.id,
        after: { kind: job.kind, key_index: job.key_index, reason },
      });
      await client.query("SELECT finish_tag_key_job($1, 'FAILED', $2)", [
        job.id,
        `Travail refusé : ${reason}`,
      ]);
    });
    this.refused += 1;
    console.error(
      `[travaux] travail ${job.kind} ${job.id} refusé (prestataire ${job.operator_id}) : ${reason}`,
    );
  }

  alarm(): number {
    return this.refused > 0 ? ALARM_JOB_REFUSED : 0;
  }
}
