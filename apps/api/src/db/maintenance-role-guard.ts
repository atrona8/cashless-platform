// Garde de démarrage du processus `maintenance` (mission hors-ligne-snapshots-lots, WP21, OP-N95
// point 3, décision du porteur du 04/11/2026) : en production, la connexion de `DATABASE_URL_MAINT`
// doit être celle du rôle `cashless_maint` (ou d'un membre), jamais celle du propriétaire de la
// base
// ni d'un superutilisateur : la purge réussirait avec un droit bien plus large que prévu.
import type { Pool } from 'pg';

export class MaintenanceRoleError extends Error {}

interface RoleRow {
  who: string;
  is_super: boolean;
  bypass_rls: boolean;
  owns_database: boolean;
  is_maint_member: boolean;
}

/**
 * Contrôle le plus strict qui tient en CI : (1) pas superutilisateur, (2) pas `BYPASSRLS`, (3) pas
 * propriétaire de la base courante, (4) membre de `cashless_maint` (rôle créé par `roles.sql`).
 * Hors production, aucun contrôle (le poste local peut pointer vers le propriétaire). Lève
 * `MaintenanceRoleError` : le processus ne démarre pas.
 */
export async function assertMaintenanceRole(pool: Pool, production: boolean): Promise<void> {
  if (!production) return;
  const { rows } = await pool.query<RoleRow>(
    `SELECT r.rolname AS who, r.rolsuper AS is_super, r.rolbypassrls AS bypass_rls,
            (d.datdba = r.oid) AS owns_database,
            COALESCE(pg_has_role(r.oid, 'cashless_maint', 'MEMBER'), false) AS is_maint_member
       FROM pg_roles r, pg_database d
      WHERE r.rolname = current_user AND d.datname = current_database()`,
  );
  const row = rows[0];
  const problem = !row
    ? 'rôle introuvable'
    : row.is_super
      ? `${row.who} est superutilisateur`
      : row.bypass_rls
        ? `${row.who} contourne la sécurité par ligne`
        : row.owns_database
          ? `${row.who} est propriétaire de la base`
          : !row.is_maint_member
            ? `${row.who} n’est pas membre de cashless_maint`
            : null;
  if (problem)
    throw new MaintenanceRoleError(
      `DATABASE_URL_MAINT refusé en production : ${problem} (rôle cashless_maint exigé, OP-N95)`,
    );
}
