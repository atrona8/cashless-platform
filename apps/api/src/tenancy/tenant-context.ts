// Contexte de prestataire de la requête (SPECIFICATION §2.2 règle 3). L'authentification réelle arrive en
// mission 2 : d'ici là, l'implémentation de production refuse toute requête qui en a besoin (401).
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
