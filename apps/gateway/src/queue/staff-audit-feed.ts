// Audit des jetons de personne expirés tolérés (R-20, décision 18), joint au lot sortant.
//
// Les lignes `edge_audit` `STAFF_TOKEN_TOLERATED` (écrites par WP22 dans la transaction de
// l'opération) partent au central dans `EdgeSyncBatch.staff_token_audit`, couvertes par la
// signature du lot. `sent_in_batch` n'est posé qu'à la FIN du lot (`DONE`) : tant que le central
// n'a pas rendu ses résultats, la ligne reste à verser (un lot renvoyé la porte encore).
//
// Forme attendue de `detail` (à respecter par WP22) : `sub`, `iss`, `jti`, `seconds_past_expiry`
// (entier >= 1), `route` (`activateMedia`, `takeDeposit` ou `createCashTopup`), `device_serial`,
// et `cash_session_id` (facultatif). `edge_audit.edge_seq` = l'opération autorisée,
// `edge_audit.at` = l'instant de l'usage. Une ligne qui ne respecte pas cette forme n'est PAS
// versée (le central refuserait tout le lot, `400`) : une ligne d'alerte `STAFF_AUDIT_UNSENDABLE`
// la signale, la ligne locale reste.
//
// LIMITE (à soumettre au porteur) : les ordres locaux `LOCAL_UNSTALE` ne sont PAS versés ici.
// `EdgeStaffTokenAudit` du contrat n'a ni champ ni valeur de `route` pour eux, et un ajout au
// contrat n'appartient qu'à WP01 : les joindre à ce tableau ferait refuser le lot (`400`).
import type { TxClient } from '../db/gateway-tx';

export interface StaffTokenAuditLine {
  edge_seq: number;
  at: string;
  subject: string;
  issuer: string;
  jti: string;
  seconds_past_expiry: number;
  route: 'activateMedia' | 'takeDeposit' | 'createCashTopup';
  device_serial: string;
  cash_session_id?: string;
}

const ROUTES = new Set(['activateMedia', 'takeDeposit', 'createCashTopup']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AuditRow {
  id: string;
  at: Date;
  edge_seq: string | null;
  detail: Record<string, unknown>;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function toLine(row: AuditRow): StaffTokenAuditLine | null {
  const d = row.detail ?? {};
  const subject = str(d.sub) ?? str(d.subject);
  const issuer = str(d.iss) ?? str(d.issuer);
  const jti = str(d.jti);
  const route = str(d.route);
  const serial = str(d.device_serial);
  const past = d.seconds_past_expiry;
  if (row.edge_seq === null || !subject || !issuer || !jti || !serial) return null;
  if (route === null || !ROUTES.has(route)) return null;
  if (typeof past !== 'number' || !Number.isSafeInteger(past) || past < 1) return null;
  const session = str(d.cash_session_id);
  if (session !== null && !UUID.test(session)) return null;
  return {
    edge_seq: Number(row.edge_seq),
    at: row.at.toISOString(),
    subject,
    issuer,
    jti,
    seconds_past_expiry: past,
    route: route as StaffTokenAuditLine['route'],
    device_serial: serial,
    ...(session !== null ? { cash_session_id: session } : {}),
  };
}

/** Lignes encore à verser pour les opérations `from..to`, dans l'ordre d'écriture. */
export async function pendingStaffTokenAudit(
  tx: TxClient,
  from: number,
  to: number,
): Promise<StaffTokenAuditLine[]> {
  const { rows } = await tx.query<AuditRow>(
    `SELECT id, at, edge_seq, detail FROM edge_audit
      WHERE kind = 'STAFF_TOKEN_TOLERATED' AND sent_in_batch IS NULL
        AND edge_seq BETWEEN $1 AND $2
      ORDER BY id`,
    [from, to],
  );
  const lines: StaffTokenAuditLine[] = [];
  for (const row of rows) {
    const line = toLine(row);
    if (line !== null) {
      lines.push(line);
      continue;
    }
    const seen = await tx.query(
      `SELECT 1 FROM edge_audit WHERE kind = 'STAFF_AUDIT_UNSENDABLE'
                                  AND detail->>'audit_id' = $1`,
      [row.id],
    );
    if (seen.rowCount === 0) {
      await tx.query(
        `INSERT INTO edge_audit (kind, actor, edge_seq, detail)
         VALUES ('STAFF_AUDIT_UNSENDABLE', 'gateway', $1, $2)`,
        [row.edge_seq, JSON.stringify({ audit_id: row.id })],
      );
    }
  }
  return lines;
}

/** À la fin d'un lot `DONE` : les lignes VALIDES des opérations `from..resolvedTo` sont versées. */
export async function markStaffTokenAuditSent(
  tx: TxClient,
  batchId: string,
  from: number,
  resolvedTo: number,
): Promise<void> {
  if (resolvedTo < from) return;
  const { rows } = await tx.query<AuditRow>(
    `SELECT id, at, edge_seq, detail FROM edge_audit
      WHERE kind = 'STAFF_TOKEN_TOLERATED' AND sent_in_batch IS NULL
        AND edge_seq BETWEEN $1 AND $2`,
    [from, resolvedTo],
  );
  const ids = rows.filter((row) => toLine(row) !== null).map((row) => row.id);
  if (ids.length === 0) return;
  await tx.query('UPDATE edge_audit SET sent_in_batch = $1 WHERE id = ANY($2::bigint[])', [
    batchId,
    ids,
  ]);
}
