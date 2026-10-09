// Contexte de prestataire de la requête (SPECIFICATION §2.2 règle 3). Implémentation de production :
// `IdentityTenantContext` (identity/), tirée de la personne authentifiée. `UnauthenticatedTenantContext` reste un
// repli non enregistré (refus systématique).
import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { ProblemException } from '../errors/problem';

export interface TenantContext {
  operatorId: string;
}

export interface TenantContextProvider {
  current(req: Request): TenantContext;
}

export const TENANT_CONTEXT = Symbol('TENANT_CONTEXT');

@Injectable()
export class UnauthenticatedTenantContext implements TenantContextProvider {
  current(_req: Request): TenantContext {
    throw new ProblemException('UNAUTHENTICATED');
  }
}
