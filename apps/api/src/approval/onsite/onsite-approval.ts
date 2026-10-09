// Jeton d'approbation sur place (`X-Approval-Token`, ADR-74, contracts/approvals.md) : la seconde personne
// s'authentifie sur le même terminal ; son jeton (5 min, usage unique, lié à l'action et à la requête exacte) fait
// d'elle le valideur. La garde vérifie le jeton ; la consommation se fait DANS la transaction métier
// (`consumeOnsiteApproval`), pour qu'un jeton ne soit consommé que si le travail est validé.
import {
  applyDecorators,
  Inject,
  Injectable,
  Logger,
  SetMetadata,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { auditContext } from '../../audit/audit-context';
import type { AuditService } from '../../audit/audit.service';
import { TenantTx, type TxClient } from '../../db/tenant-tx';
import { ProblemException } from '../../errors/problem';
import { isSqlError } from '../../errors/sqlstate-map';
import { IDENTITY_VERIFIER, IdentityError, type IdentityVerifier, type VerifiedApprovalToken } from '../../identity/oidc-verifier';
import { requestPrincipal, type Principal, type Role, type ScopeType } from '../../identity/principal';
import type { StaffRole } from '../../identity/roles.decorator';
import { exercisedRole, resolveChain, type ScopeRef } from '../../identity/scope-resolver';
import { TENANT_CONTEXT, type TenantContextProvider } from '../../tenancy/tenant-context';
import { requestActHash, sameHash } from './act-hash';

export const APPROVAL_TOKEN_HEADER = 'X-Approval-Token';
const ONSITE = 'approval:onsite';

export interface OnsiteApprovalOptions {
  /** operationId du contrat, attendu dans le claim `act`. */
  operationId: string;
  /** Rôle exigé du valideur, sur la portée de l'opération (ou une portée englobante). */
  role: StaffRole;
  /** Portée de l'opération ; par défaut, le prestataire de la transaction. */
  scope?: (req: Request) => ScopeRef;
}

export interface OnsiteApproval {
  approverId: string;
  jti: string;
  operationId: string;
  expiresAt: Date;
}

export type OnsiteRequest = Request & { onsiteApproval?: OnsiteApproval };

const invalid = (): ProblemException => new ProblemException('APPROVAL_INVALID', { status: 403 });

@Injectable()
export class OnsiteApprovalGuard implements CanActivate {
  private readonly logger = new Logger('OnsiteApproval');

  constructor(
    private readonly reflector: Reflector,
    @Inject(IDENTITY_VERIFIER) private readonly verifier: IdentityVerifier,
    private readonly tx: TenantTx,
    @Inject(TENANT_CONTEXT) private readonly tenant: TenantContextProvider,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.get<OnsiteApprovalOptions | undefined>(ONSITE, context.getHandler());
    if (!options) return true;
    const req = context.switchToHttp().getRequest<OnsiteRequest>();
    req.onsiteApproval = await this.verify(req, requestPrincipal(req), options);
    return true;
  }

  /** Toute anomalie → 403 APPROVAL_INVALID ; la raison exacte n'est écrite que dans le journal serveur. */
  private async verify(req: Request, caller: Principal, options: OnsiteApprovalOptions): Promise<OnsiteApproval> {
    const token = req.header(APPROVAL_TOKEN_HEADER);
    if (!token) throw new ProblemException('APPROVAL_REQUIRED', { status: 403 });
    const reject = (reason: string): never => {
      this.logger.warn(`jeton d'approbation refusé (${options.operationId}) : ${reason}`);
      throw invalid();
    };

    let verified: VerifiedApprovalToken;
    try {
      verified = await this.verifier.verifyApproval(token);
    } catch (error) {
      if (error instanceof IdentityError && error.kind === 'UNAVAILABLE') throw new ProblemException('SERVICE_UNAVAILABLE');
      return reject('signature, émetteur, audience ou durée');
    }
    if (verified.act !== options.operationId) return reject(`act ${verified.act}`);
    if (!sameHash(verified.actHash, requestActHash(req))) return reject('act_hash différent de la requête');

    const person = await this.tx.identify(verified.issuer, verified.subject);
    if (!person || person.status !== 'ACTIVE') return reject('valideur inconnu ou désactivé');
    if (person.user_id === caller.userId) return reject('valideur = appelant');
    const { operatorId } = this.tenant.current(req);
    if (person.operator_id !== operatorId) return reject("valideur d'un autre prestataire");

    const approver: Principal = {
      userId: person.user_id,
      operatorId: person.operator_id,
      issuer: verified.issuer,
      subject: verified.subject,
      assignments: person.assignments.map((a) => ({
        role: a.role as Role,
        scopeType: a.scope_type as ScopeType,
        scopeId: a.scope_id,
      })),
    };
    const target = options.scope?.(req) ?? { type: 'OPERATOR', id: operatorId };
    const chain = await this.tx.run(operatorId, (client) => resolveChain(client, target));
    if (!exercisedRole(approver, [options.role], chain)) return reject(`valideur sans le rôle ${options.role}`);

    return { approverId: person.user_id, jti: verified.jti, operationId: verified.act, expiresAt: verified.expiresAt };
  }
}

/** Route qui exige une seconde personne sur place (`X-Approval-Token`). */
export const RequiresOnsiteApproval = (options: OnsiteApprovalOptions): MethodDecorator =>
  applyDecorators(SetMetadata(ONSITE, options), UseGuards(OnsiteApprovalGuard));

/**
 * Consomme le jeton vérifié par la garde, dans la transaction métier (`IdempotentTx.run`) ; rend le valideur à
 * transmettre à la base (jamais lu dans le corps). Jeton déjà consommé → 403 APPROVAL_INVALID, travail annulé.
 */
export async function consumeOnsiteApproval(client: TxClient, req: Request, audit: AuditService): Promise<string> {
  const approval = (req as OnsiteRequest).onsiteApproval;
  if (!approval) throw new Error('consumeOnsiteApproval : route sans @RequiresOnsiteApproval');
  const caller = requestPrincipal(req);
  const { rows } = await client.query<{ id: string }>("SELECT current_setting('app.operator_id') AS id");
  const operatorId = rows[0]!.id;
  let consumed: number;
  try {
    const inserted = await client.query(
      `INSERT INTO approval_token_use (jti, operator_id, operation_id, approver_id, caller_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (jti) DO NOTHING`,
      [approval.jti, operatorId, approval.operationId, approval.approverId, caller.userId, approval.expiresAt],
    );
    consumed = inserted.rowCount ?? 0;
  } catch (error) {
    // Échéance passée entre la garde et la transaction (contrainte expires_at > used_at).
    if (isSqlError(error) && error.code === '23514') throw invalid();
    throw error;
  }
  if (consumed !== 1) throw invalid();
  await audit.record(client, {
    ...auditContext(req),
    operatorId,
    action: 'APPROVAL_TOKEN_USED',
    objectType: 'approval_token_use',
    objectId: approval.jti,
    approverId: approval.approverId,
    after: { operation_id: approval.operationId, approver_id: approval.approverId },
  });
  return approval.approverId;
}
