// Rôle et portée exigés d'une route (contracts/identity.md) : `@Roles(['OPERATOR_ADMIN'], (req) => portée)`.
// Sans résolveur, la portée est le prestataire de la transaction. Applique `RolesGuard` (après la garde globale
// d'authentification, qui s'exécute avant les gardes de méthode).
import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { Role } from './principal';
import { ROLES, RolesGuard } from './roles.guard';
import type { RoleCheckOptions, ScopeRef } from './scope-resolver';

/** Rôles du personnel (VENDOR et CUSTOMER ne protègent aucune route de gestion). */
export type StaffRole = Exclude<Role, 'VENDOR' | 'CUSTOMER'>;

export interface RolesMetadata extends RoleCheckOptions {
  roles: StaffRole[];
  scope?: (req: Request) => ScopeRef;
}

export const Roles = (
  roles: StaffRole[],
  scope?: (req: Request) => ScopeRef,
  options: RoleCheckOptions = {},
): MethodDecorator & ClassDecorator =>
  applyDecorators(SetMetadata(ROLES, { roles, scope, ...options } satisfies RolesMetadata), UseGuards(RolesGuard));
