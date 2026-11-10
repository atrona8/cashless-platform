// Identité du festivalier (mission bracelets-nfc, research R-07, contracts/identity-ports.md).
// Les routes de l'app festivalier reçoivent le compte d'un fournisseur remplaçable : le jeton d'accès (`Authorization:
// Bearer`, token-customer-identity.ts) et, hors production seulement, le faux par en-têtes de test (OP-N43).
// Jamais de faux en production (NFR-010).
import type { Request } from 'express';
import { ProblemException } from '../errors/problem';

export interface CustomerClaims {
  customerId: string;
  operatorId: string;
  /** Référence stable de l'appareil du festivalier : sert aux limites d'essais (jamais une donnée personnelle). */
  deviceRef: string;
}

export interface CustomerIdentityPort {
  readonly isFake?: boolean;
  identify(req: Request): Promise<CustomerClaims | null>;
}

export type CustomerContext = CustomerClaims;

export interface CustomerDirectory {
  /** Vrai si ce compte est bien un festivalier de ce prestataire. */
  exists(operatorId: string, customerId: string): Promise<boolean>;
}

export const CUSTOMER_IDENTITY = Symbol('CUSTOMER_IDENTITY');
export const CUSTOMER_DIRECTORY = Symbol('CUSTOMER_DIRECTORY');

export type CustomerRequest = Request & { customer?: CustomerContext };

export function requestCustomer(req: Request): CustomerContext {
  const customer = (req as CustomerRequest).customer;
  if (!customer) throw new ProblemException('UNAUTHENTICATED');
  return customer;
}
