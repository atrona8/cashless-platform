// Garde d'authentification globale (contracts/identity.md, FR-003, NFR-002) : toute route non `@Public()` exige un
// jeton d'accès vérifié et une personne ACTIVE retrouvée en base ; pose `req.principal`. Une requête SQL par requête
// HTTP (NFR-005) ; les clés publiques sont mises en cache par `jose`.
import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantTx } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';
import { IDENTITY_VERIFIER, IdentityError, type IdentityVerifier, type VerifiedToken } from './oidc-verifier';
import type { Assignment, PrincipalRequest, Role, ScopeType } from './principal';
import { IS_PUBLIC } from './public.decorator';

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
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) return true;
    const req = context.switchToHttp().getRequest<PrincipalRequest>();

    const token = BEARER.exec(req.header('authorization') ?? '')?.[1];
    if (!token) throw new ProblemException('UNAUTHENTICATED');
    const verified = await this.verify(token);

    const person = await this.tx.identify(verified.issuer, verified.subject);
    if (!person || person.status !== 'ACTIVE') throw new ProblemException('UNAUTHENTICATED');
    if (verified.operatorClaim !== undefined && verified.operatorClaim !== person.operator_id) {
      throw new ProblemException('UNAUTHENTICATED');
    }
    req.principal = {
      userId: person.user_id,
      operatorId: person.operator_id,
      assignments: person.assignments.map(
        (a): Assignment => ({ role: a.role as Role, scopeType: a.scope_type as ScopeType, scopeId: a.scope_id }),
      ),
      issuer: verified.issuer,
      subject: verified.subject,
    };
    return true;
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
