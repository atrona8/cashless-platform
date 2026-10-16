// Travaux de clé préparés par le propriétaire, pour les suites qui exercent les exécutants sans
// passer par l'API. Depuis la migration 0020 (constat SEC-1), un exécutant refuse tout travail qui
// ne vient pas d'une demande approuvée à deux et exécutée dont le résultat le désigne : ce module
// reproduit exactement ce que fait l'API à l'approbation (demande PENDING, décision par une seconde
// personne, travail, demande EXECUTED avec son résultat).
import type { Client } from 'pg';

export type RootKeyJobKind = 'CREATE_KEY' | 'ROTATE_DEK' | 'RETIRE_KEY';

const ACTION: Record<RootKeyJobKind, string> = {
  CREATE_KEY: 'TAG_KEY_CREATE',
  ROTATE_DEK: 'TAG_DEK_ROTATE',
  RETIRE_KEY: 'TAG_KEY_RETIRE',
};

export interface ApprovedKeyJob {
  operatorId: string;
  keyIndex: number;
  kind: RootKeyJobKind;
  requestedBy: string;
  approvedBy: string;
}

/**
 * Inscrit un travail racine « comme l'API » ; rend son identifiant. `db` : connexion du
 * propriétaire.
 */
export async function plantApprovedKeyJob(db: Client, job: ApprovedKeyJob): Promise<string> {
  const params =
    job.kind === 'CREATE_KEY'
      ? { scope: 'SHARED', dedicated_event_id: null }
      : { key_index: job.keyIndex };
  await db.query('BEGIN');
  try {
    await db.query("SELECT set_config('app.operator_id', $1, true)", [job.operatorId]);
    const request = await db.query<{ id: string }>(
      `INSERT INTO approval_request (operator_id, action, payload, requested_by)
       VALUES ($1, $2, $3::jsonb, $4) RETURNING id`,
      [
        job.operatorId,
        ACTION[job.kind],
        JSON.stringify({ operator_id: job.operatorId, ...params }),
        job.requestedBy,
      ],
    );
    const requestId = request.rows[0]!.id;
    await db.query('SELECT decide_approval_request($1, $2, true, NULL)', [
      requestId,
      job.approvedBy,
    ]);
    const actors = { requested_by: job.requestedBy, approved_by: job.approvedBy };
    const payload = job.kind === 'CREATE_KEY' ? { ...params, ...actors } : actors;
    const inserted = await db.query<{ id: string }>(
      `INSERT INTO tag_key_job (operator_id, key_index, kind, payload, approval_request_id)
       VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING id`,
      [job.operatorId, job.keyIndex, job.kind, JSON.stringify(payload), requestId],
    );
    const jobId = inserted.rows[0]!.id;
    await db.query(
      `UPDATE approval_request
          SET status = 'EXECUTED',
              result = jsonb_build_object('job_id', $2::uuid, 'key_index', $3::int)
        WHERE id = $1`,
      [requestId, jobId, job.keyIndex],
    );
    await db.query('COMMIT');
    return jobId;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}
