// Profil de la personne du personnel authentifiée (mission routes-backoffice, WP05 ; contrat `StaffProfile`).
// Les attributions viennent de la personne posée par la garde d'authentification, relues en base à chaque requête :
// aucun cache. Le nom affiché est lu sous le prestataire de la personne (`TenantTx`). Aucune autre donnée de
// `app_user` n'est lue : ni courriel, ni téléphone (NFR-006).
// Personne de la plateforme (`operator_id` nul) : sa ligne est invisible sous la RLS d'un prestataire, et la
// transaction de plateforme n'est pas atteignable d'ici (`IdentityModule` est aussi chargé par le processus de
// personnalisation : test d'architecture « processus des clés »). Son nom affiché est donc le libellé fixe
// `PLATFORM_DISPLAY_NAME` (écart signalé au porteur dans la note de lane).
import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { TenantTx } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';
import { requestPrincipal, type Role } from '../identity/principal';

/** Rôles du personnel du contrat (`StaffAssignment.role`) ; VENDOR et CUSTOMER n'en font pas partie. */
const STAFF_ROLES: ReadonlySet<Role> = new Set<Role>([
  'PLATFORM_ADMIN',
  'OPERATOR_ADMIN',
  'ORGANIZER_ADMIN',
  'MERCHANT_ADMIN',
  'SUPERVISOR',
  'CASHIER',
  'PERSONALIZER',
]);

export interface StaffProfile {
  user_id: string;
  display_name: string;
  operator_id: string | null;
  assignments: Array<{ role: string; scope_type: string; scope_id: string | null }>;
}

/** Nom affiché d'une personne de la plateforme (sa ligne n'est pas lisible d'ici). */
export const PLATFORM_DISPLAY_NAME = 'Administration de la plateforme';

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

@Injectable()
export class StaffProfileService {
  constructor(private readonly tenantTx: TenantTx) {}

  async get(req: Request): Promise<StaffProfile> {
    const principal = requestPrincipal(req);
    const displayName =
      principal.operatorId === null
        ? PLATFORM_DISPLAY_NAME
        : await this.displayName(principal.operatorId, principal.userId);
    const assignments = principal.assignments
      .filter((a) => STAFF_ROLES.has(a.role))
      .map((a) => ({ role: a.role, scope_type: a.scopeType, scope_id: a.scopeId }))
      .sort(
        (x, y) =>
          compare(x.role, y.role) ||
          compare(x.scope_type, y.scope_type) ||
          compare(x.scope_id ?? '', y.scope_id ?? ''),
      );
    return {
      user_id: principal.userId,
      display_name: displayName,
      operator_id: principal.operatorId,
      assignments,
    };
  }

  private async displayName(operatorId: string, userId: string): Promise<string> {
    const { rows } = await this.tenantTx.run(operatorId, (client) =>
      client.query<{ display_name: string }>('SELECT display_name FROM app_user WHERE id = $1', [
        userId,
      ]),
    );
    if (!rows[0]) throw new ProblemException('NOT_FOUND');
    return rows[0].display_name;
  }
}
