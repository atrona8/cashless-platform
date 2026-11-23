// Connexion de la commande d'exploitation `reissue-claim-codes` (mission serveur-app-festivalier, WP08), placée sous
// db/ pour que seul ce dossier touche `pg` (garde d'architecture, R-03). Une seule connexion dédiée, ouverte par la
// commande sur `DATABASE_URL_CLAIMADMIN` : aucun pool, aucun jeton partagé, aucun autre rôle que `cashless_claimadmin`.
import { Client } from 'pg';

/** Refus en production d'un rôle trop puissant ou qui n'est pas celui de la commande (modèle assertMaintenanceRole). */
export class RoleRefused extends Error {}

/** Le seul usage que la commande fait de la connexion : requêtes paramétrées et fermeture. */
export interface ClaimAdminConnection {
  query<R extends object = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[] }>;
  end(): Promise<void>;
}

async function assertClaimAdminRole(client: Client): Promise<void> {
  const { rows } = await client.query<{
    who: string;
    is_super: boolean;
    bypass_rls: boolean;
    owns_database: boolean;
    is_member: boolean;
  }>(
    `SELECT r.rolname AS who, r.rolsuper AS is_super, r.rolbypassrls AS bypass_rls,
            (d.datdba = r.oid) AS owns_database,
            COALESCE(pg_has_role(r.oid, 'cashless_claimadmin', 'MEMBER'), false) AS is_member
       FROM pg_roles r, pg_database d
      WHERE r.rolname = current_user AND d.datname = current_database()`,
  );
  const row = rows[0];
  if (!row || row.is_super || row.bypass_rls || row.owns_database || !row.is_member)
    throw new RoleRefused(
      'DATABASE_URL_CLAIMADMIN refusé en production : rôle cashless_claimadmin exigé',
    );
}

/**
 * Ouvre la connexion ; en production, refuse (et ferme) un rôle qui n'est pas membre de `cashless_claimadmin`
 * ou qui est superutilisateur, `BYPASSRLS` ou propriétaire de la base. La fermeture reste à l'appelant.
 */
export async function openClaimAdminConnection(
  connectionString: string,
  production: boolean,
): Promise<ClaimAdminConnection> {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    if (production) await assertClaimAdminRole(client);
  } catch (error) {
    await client.end().catch(() => undefined);
    throw error;
  }
  return client;
}
