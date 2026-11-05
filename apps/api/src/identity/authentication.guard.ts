// Garde d'authentification globale (contracts/identity.md, FR-003, NFR-002) : toute route non `@Public()` exige un
// jeton d'accès vérifié et une personne ACTIVE retrouvée en base ; pose `req.principal`. Une requête SQL par requête
// HTTP (NFR-005) ; les clés publiques sont mises en cache par `jose`.
// Route de guichet (`@StaffToken()`, mission 5a) : le jeton de la personne est lu dans
// `X-Staff-Authorization` et nulle part ailleurs ; cet en-tête sur une autre route : 401.
import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantTx } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';
import {
  IDENTITY_VERIFIER,
  IdentityError,
  type IdentityVerifier,
  type VerifiedToken,
} from './oidc-verifier';
import type { Assignment, Principal, PrincipalRequest, Role, ScopeType } from './principal';
import { IS_PUBLIC } from './public.decorator';
import { STAFF_AUTHORIZATION_HEADER, STAFF_TOKEN_ROUTE } from './staff-token.decorator';

const BEARER = /^Bearer\s+(\S+)\s*$/i;

@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(IDENTITY_VERIFIER) private readonly verifier: IdentityVerifier,
    private readonly tx: TenantTx,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    const req = context.switchToHttp().getRequest<PrincipalRequest>();
    const staffRoute =
      this.reflector.getAllAndOverride<boolean>(STAFF_TOKEN_ROUTE, targets) === true;
    // Refus avant toute autre règle, routes publiques comprises.
    if (!staffRoute && req.header(STAFF_AUTHORIZATION_HEADER) !== undefined)
      throw new ProblemException('UNAUTHENTICATED');
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const source = staffRoute ? STAFF_AUTHORIZATION_HEADER : 'authorization';
    req.principal = await this.authenticate(req.header(source));
    return true;
  }

  /**
   * Contrôle PRÉALABLE à la lecture d'un gros corps (mission 7, WP20 : `batch-body.ts`, `journal-body.ts`) : le jeton
   * de `Authorization` est vérifié, la personne retrouvée ACTIVE, et (si `roles` est donné) elle tient l'un de ces
   * rôles quelque part. Aucune écriture ; la garde refait ces contrôles à la requête, ce n'est qu'un filtre qui
   * évite de lire 21 Mio pour un inconnu. `false` pour tout échec (la garde répondra 401 ou le contrôleur 403).
   */
  async preAuthenticate(req: PrincipalRequest, roles?: readonly Role[]): Promise<boolean> {
    if (req.header(STAFF_AUTHORIZATION_HEADER) !== undefined) return false;
    try {
      const principal = await this.authenticate(req.header('authorization'));
      return !roles || principal.assignments.some((a) => roles.includes(a.role));
    } catch {
      return false;
    }
  }

  private async authenticate(header: string | undefined): Promise<Principal> {
    const token = BEARER.exec(header ?? '')?.[1];
    if (!token) throw new ProblemException('UNAUTHENTICATED');
    const verified = await this.verify(token);

    const person = await this.tx.identify(verified.issuer, verified.subject);
    if (!person || person.status !== 'ACTIVE') throw new ProblemException('UNAUTHENTICATED');
    if (verified.operatorClaim !== undefined && verified.operatorClaim !== person.operator_id) {
      throw new ProblemException('UNAUTHENTICATED');
    }
    return {
      userId: person.user_id,
      operatorId: person.operator_id,
      assignments: person.assignments.map(
        (a): Assignment => ({
          role: a.role as Role,
          scopeType: a.scope_type as ScopeType,
          scopeId: a.scope_id,
        }),
      ),
      issuer: verified.issuer,
      subject: verified.subject,
    };
  }

  private async verify(token: string): Promise<VerifiedToken> {
    try {
      return await this.verifier.verifyAccess(token);
    } catch (error) {
      if (error instanceof IdentityError && error.kind === 'UNAVAILABLE') {
        throw new ProblemException('SERVICE_UNAVAILABLE');
      }
      throw new ProblemException('UNAUTHENTICATED');
    }
  }
}
