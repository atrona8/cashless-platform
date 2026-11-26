// Limite de débit de la recherche par numéro (mission routes-backoffice, WP08 ; NFR-004, research D8) : au plus
// `limit` recherches `STAFF_CUSTOMER_SEARCH` par personne sur 60 secondes glissantes, comptées en base (jamais en
// mémoire : plusieurs instances de l'API). Le compte se fait dans la transaction de la recherche, sous un verrou
// consultatif propre à la personne : deux appels simultanés ne passent pas ensemble sous le seuil. Seules les lignes
// `STAFF_CUSTOMER_SEARCH` comptent : les refus de débit ne se comptent pas eux-mêmes.
import type { TxClient } from '../db/tenant-tx';

export const SEARCH_WINDOW_SECONDS = 60;

export interface SearchLimitState {
  /** Vrai : la personne a déjà fait `limit` recherches dans la fenêtre. */
  exceeded: boolean;
  /** Secondes avant que la plus ancienne recherche sorte de la fenêtre (au moins 1) ; 0 si non dépassée. */
  retryAfterSeconds: number;
}

export async function checkSearchLimit(
  client: TxClient,
  actorId: string,
  limit: number,
): Promise<SearchLimitState> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    `staff-customer-search:${actorId}`,
  ]);
  const { rows } = await client.query<{ n: number; wait: number | null }>(
    `SELECT count(*)::int AS n,
            ceil(extract(epoch FROM (min(occurred_at) + make_interval(secs => $2)
                                     - clock_timestamp())))::int AS wait
       FROM audit_log
      WHERE actor_id = $1 AND action = 'STAFF_CUSTOMER_SEARCH'
        AND occurred_at > clock_timestamp() - make_interval(secs => $2)`,
    [actorId, SEARCH_WINDOW_SECONDS],
  );
  const { n, wait } = rows[0]!;
  const exceeded = n >= limit;
  return { exceeded, retryAfterSeconds: exceeded ? Math.max(1, wait ?? 1) : 0 };
}
