// Identité du festivalier (mission bracelets-nfc, research R-07, contracts/identity-ports.md).
// Les routes de l'app festivalier reçoivent le compte d'un fournisseur remplaçable. Cette mission ne livre qu'un FAUX
// (en-têtes de test) : les comptes, l'authentification par téléphone et les jetons arrivent avec la mission de l'app
// festivalier. Dette consignée dans docs/POINTS_OUVERTS.md ; jamais de faux en production (NFR-010).
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
