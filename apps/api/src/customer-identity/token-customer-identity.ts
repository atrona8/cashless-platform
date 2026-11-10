// Identité réelle du festivalier : jeton d'accès `Authorization: Bearer` (customer-access-token.ts).
// Décision du porteur (10/11/2026) : hors production, les en-têtes de test `X-Test-*` restent admis EN L'ABSENCE de
// l'en-tête `Authorization` ; dès qu'il est présent, seul le jeton compte (un jeton invalide donne 401, jamais un
// repli sur les en-têtes). En production, `fallback` est nul : les en-têtes `X-Test-*` sont ignorés.
import type { Request } from 'express';
import type { CustomerAccessTokens } from './customer-access-token';
import type { CustomerClaims, CustomerIdentityPort } from './customer-identity.port';
import type { FakeCustomerIdentity } from './fake-customer-identity';

const BEARER = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/;

export class TokenCustomerIdentity implements CustomerIdentityPort {
  // Un fournisseur réel : aucun marqueur de faux (la garde de démarrage ne le refuse pas).
  constructor(
    private readonly tokens: CustomerAccessTokens,
    private readonly fallback: FakeCustomerIdentity | null,
  ) {}

  async identify(req: Request): Promise<CustomerClaims | null> {
    const authorization = req.header('authorization');
    if (authorization !== undefined) {
      const match = BEARER.exec(authorization);
      return match ? this.tokens.verify(match[1]!) : null;
    }
    return this.fallback ? this.fallback.identify(req) : null;
  }
}
