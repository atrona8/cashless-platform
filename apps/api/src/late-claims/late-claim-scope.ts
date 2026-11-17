// Portée commune des réclamations tardives (mission 9b, WP10 ; FR-016 ; ADR-67, ADR-75) : le grand
// livre visé, son événement, et les précontrôles de la demande comme de l'exécution (même ordre,
// mêmes refus). Les bornes sont celles de la base (`check_late_claim`, CL024) ; l'API ne fait que
// les précontrôler pour répondre avant d'écrire.
import type { TxClient } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';
import { refuseUnderEdge } from '../refunds/wallet-refund-action';

export interface LateLedger {
  id: string;
  operatorId: string;
  currency: string;
  status: string;
  lateClaimsUntil: Date | null;
  lockedUntil: Date | null;
  eventId: string;
  organizerId: string;
}

interface LedgerRow {
  id: string;
  operator_id: string;
  currency: string;
  status: string;
  late_claims_until: Date | null;
  locked_until: Date | null;
  event_id: string;
  organizer_id: string;
}

/**
 * Grand livre d'un événement, lu sous RLS : inconnu ou d'un autre prestataire, `404` ; hors
 * événement, `409`.
 */
export async function readLateLedger(client: TxClient, ledgerId: string): Promise<LateLedger> {
  const { rows } = await client.query<LedgerRow>(
    `SELECT l.id, l.operator_id, trim(l.currency) AS currency, l.status, l.late_claims_until,
            l.locked_until, e.id AS event_id, e.organizer_id
       FROM ledger l JOIN event e ON l.scope_type = 'EVENT' AND e.id = l.scope_id
      WHERE l.id = $1`,
    [ledgerId],
  );
  const row = rows[0];
  if (!row) throw new ProblemException('NOT_FOUND');
  return {
    id: row.id,
    operatorId: row.operator_id,
    currency: row.currency,
    status: row.status,
    lateClaimsUntil: row.late_claims_until,
    lockedUntil: row.locked_until,
    eventId: row.event_id,
    organizerId: row.organizer_id,
  };
}

/**
 * Précontrôle de portée : grand livre `LOCKED` (sinon `409 CONFLICT_STATE`, circuit normal), délai
 * non dépassé (`409 LEDGER_LOCKED`), autorité de débit centrale (`409 DEBIT_AUTHORITY_EDGE`, avant
 * toute écriture).
 */
export async function checkLateScope(client: TxClient, ledger: LateLedger): Promise<void> {
  const { rows } = await client.query<{ status: string; late: boolean }>(
    `SELECT status, coalesce(clock_timestamp() <= late_claims_until, false) AS late
       FROM ledger WHERE id = $1`,
    [ledger.id],
  );
  const now = rows[0];
  if (!now || now.status !== 'LOCKED')
    throw new ProblemException('CONFLICT_STATE', {
      detail: 'Le grand livre n’est pas verrouillé : utiliser le circuit normal de remboursement.',
    });
  if (!now.late)
    throw new ProblemException('LEDGER_LOCKED', {
      detail: 'Le délai des réclamations tardives est dépassé.',
    });
  await refuseUnderEdge(client, ledger.id);
}

/**
 * Verrou consultatif de la ressource visée (relecture sous verrou, ordre des verrous de
 * `interfaces.md`).
 */
export async function lockKey(client: TxClient, key: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
}

/** Comptes de casse (identiques à `check_late_claim`). */
export const CASSE_PURPOSES = ['ORG_CASSE', 'OPE_CASSE', 'LEGAL_BREAKAGE'] as const;
