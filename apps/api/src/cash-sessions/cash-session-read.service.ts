// Lecture des sessions de caisse (mission 6, lot WP08, T040 ; contrat `getCashSession`, `listCashSessions`).
// Lecture seule sous RLS sur `cash_session` et `cash_session_count`. AUCUNE lecture d'un solde de compte
// `CASH_DESK` ni de `posting` (A27) : `expected_amount` est la valeur figée à la fermeture, jamais un calcul.
//
// Vues par rôle, sur l'événement de la session (maillons EVENT et ORGANIZER de la chaîne seulement, comme la
// base : `cash_actor_allowed`) :
//  - MANAGER (`SUPERVISOR` ou `ORGANIZER_ADMIN`) : toutes les sessions de l'événement ;
//  - AGENT (`CASHIER`) : ses seules sessions (`opened_by`), jamais le théorique ni l'écart ;
//  - tout autre cas : la session n'existe pas pour lui (404, identique à une session inexistante).
import { Injectable } from '@nestjs/common';
import type { TxClient } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';
import type { Principal, Role } from '../identity/principal';
import { exercisedRole, resolveChain, type ScopeLink } from '../identity/scope-resolver';
import { isUuid, pageOf, type Page, type PageRequest } from '../organization/platform/platform.dto';
import {
  toDto,
  type CashSessionDto,
  type CashSessionRow,
  type CashSessionView,
} from './cash-sessions.dto';

export const MANAGER_ROLES: readonly Role[] = ['SUPERVISOR', 'ORGANIZER_ADMIN'];

const SELECT = `
  SELECT s.cash_session_id, s.cash_account_id, s.event_id, s.device_id, s.opened_by, s.opened_at,
         s.status, s.closed_by, s.closed_at, s.counted_amount::text AS counted_amount,
         s.expected_amount::text AS expected_amount, s.close_tx_id, s.cash_diff_anomaly_id,
         lc.counted_amount::text AS last_count_amount, lc.counted_at AS last_count_at,
         lc.counted_by AS last_count_by
    FROM cash_session s
    LEFT JOIN LATERAL (
      SELECT c.counted_amount, c.counted_at, c.counted_by FROM cash_session_count c
       WHERE c.cash_session_id = s.cash_session_id ORDER BY c.count_no DESC LIMIT 1) lc ON true`;

/**
 * Chaîne de droits d'un événement pour la caisse : l'événement et son organisateur seulement (une
 * attribution de portée prestataire ou plateforme n'est pas un rôle de caisse, la base la refuse aussi).
 */
export async function eventChain(client: TxClient, eventId: string): Promise<ScopeLink[]> {
  const chain = await resolveChain(client, { type: 'EVENT', id: eventId });
  return chain.slice(0, 2);
}

/** Vue de la personne sur les sessions de l'événement, ou `null` (aucun rôle de caisse sur celui-ci). */
export function viewOf(principal: Principal, chain: readonly ScopeLink[]): CashSessionView | null {
  if (exercisedRole(principal, MANAGER_ROLES, chain)) return 'MANAGER';
  if (exercisedRole(principal, ['CASHIER'], chain)) return 'AGENT';
  return null;
}

/** Session par identifiant (sous RLS : celle d'un autre prestataire n'existe pas), ou `null`. */
export async function loadSession(
  client: TxClient,
  sessionId: string,
): Promise<CashSessionRow | null> {
  if (!isUuid(sessionId)) return null;
  const { rows } = await client.query<CashSessionRow>(`${SELECT} WHERE s.cash_session_id = $1`, [
    sessionId,
  ]);
  return rows[0] ?? null;
}

@Injectable()
export class CashSessionReadService {
  /**
   * `getCashSession` : la session doit être dans la vue de la personne, sinon 404. Sur le chemin terminal,
   * un `CASHIER` ne lit que la session de CE terminal (`deviceId`).
   */
  async get(
    client: TxClient,
    principal: Principal,
    sessionId: string,
    deviceId: string | null,
  ): Promise<CashSessionDto> {
    const row = await loadSession(client, sessionId);
    if (!row) throw new ProblemException('NOT_FOUND');
    const view = viewOf(principal, await eventChain(client, row.event_id));
    if (view === null) throw new ProblemException('NOT_FOUND');
    if (view === 'AGENT' && (row.opened_by !== principal.userId || this.foreign(row, deviceId)))
      throw new ProblemException('NOT_FOUND');
    return toDto(row, view);
  }

  private foreign(row: CashSessionRow, deviceId: string | null): boolean {
    return deviceId !== null && row.device_id !== deviceId;
  }

  /** `listCashSessions` : `SUPERVISOR` ou `ORGANIZER_ADMIN` de l'événement (403 sinon), événement inconnu : 404. */
  async list(
    client: TxClient,
    principal: Principal,
    eventId: string,
    status: 'OPEN' | 'CLOSED' | null,
    page: PageRequest,
  ): Promise<Page<CashSessionDto>> {
    if (!isUuid(eventId)) throw new ProblemException('NOT_FOUND');
    // Événement absent ou d'un autre prestataire (RLS) : 404, avant tout calcul de droit.
    const known = await client.query('SELECT 1 FROM event WHERE id = $1', [eventId]);
    if (known.rows.length === 0) throw new ProblemException('NOT_FOUND');
    const chain = await eventChain(client, eventId);
    if (viewOf(principal, chain) !== 'MANAGER') throw new ProblemException('FORBIDDEN');
    const { rows } = await client.query<CashSessionRow>(
      `${SELECT}
        WHERE s.event_id = $1 AND ($2::text IS NULL OR s.status = ANY (
                CASE WHEN $2 = 'OPEN' THEN ARRAY['OPEN','CLOSING'] ELSE ARRAY['CLOSED'] END))
        ORDER BY s.opened_at DESC, s.cash_session_id
        LIMIT $3 OFFSET $4`,
      [eventId, status, page.limit + 1, page.offset],
    );
    return pageOf(rows, page, (row) => toDto(row, 'MANAGER'));
  }
}
