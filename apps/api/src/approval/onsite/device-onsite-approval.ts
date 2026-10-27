// Jeton d'approbation sur place pour un APPELANT TERMINAL (mission 5b, lot WP12, T056 ; décision du porteur
// DM-01M5HRNBX5CTP7CAKN4JRCY3F9 ; contracts/payments.md « reversePayment » ; research R-11 A8) : un `SUPERVISOR`
// de l'événement de la vente s'authentifie sur le terminal ; son jeton (`X-Approval-Token`, usage unique) lève les
// contrôles de vendeur et de fenêtre d'une annulation, pas ceux du terminal.
//
// La variante ne relâche AUCUN contrôle de `OnsiteApprovalGuard` : elle appelle la MÊME vérification
// (`verifyOnsiteApproval`, onsite-approval.ts) — signature, émetteur, audience, durée ; `act` ; `act_hash` = requête
// exacte, corps compris ; valideur connu, ACTIVE, du même prestataire ; rôle exercé sur la portée — et la MÊME
// consommation (`recordApprovalUse`). Seuls changent l'appelant (un terminal et sa session de vendeur : aucune
// personne, donc pas de « valideur ≠ appelant » à contrôler) et la portée, qui dépend de la vente (asynchrone).
//
// Un jeton présenté et refusé n'est pas jeté par la garde : le refus (4xx) est posé sur la requête et rejeté par
// la transaction de la route (`DeviceOnsiteState`), pour que le numéro du terminal soit enregistré avec le refus
// (T057). Un refus 5xx (identité indisponible) part tout de suite : rien n'est enregistré. Sans en-tête, la garde
// laisse passer SANS valideur : la route applique alors la règle du vendeur de la vente.
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
import type { AuditService } from '../../audit/audit.service';
import { TenantTx, type TxClient } from '../../db/tenant-tx';
import { requestDevice, type DeviceRequest } from '../../device-identity/device-identity.port';
import { ProblemException } from '../../errors/problem';
import { IDENTITY_VERIFIER, type IdentityVerifier } from '../../identity/oidc-verifier';
import type { StaffRole } from '../../identity/roles.decorator';
import type { ScopeRef } from '../../identity/scope-resolver';
import { requestActHash } from './act-hash';
import {
  APPROVAL_TOKEN_HEADER,
  recordApprovalUse,
  verifyOnsiteApproval,
  type OnsiteApproval,
} from './onsite-approval';

const DEVICE_ONSITE = 'approval:device-onsite';

export interface DeviceOnsiteApprovalOptions {
  /** operationId du contrat, attendu dans le claim `act`. */
  operationId: string;
  /** Rôle exigé du valideur, sur la portée de l'opération (ou une portée englobante). */
  role: StaffRole;
  /**
   * Portée de l'opération, lue dans une transaction du prestataire du terminal (ex. l'événement de la vente).
   * Objet introuvable : `404`, jamais une portée vide.
   */
  scope: (req: Request, client: TxClient) => Promise<ScopeRef>;
}

/** Ce que la garde a décidé, lu par la route : aucun jeton, jeton valide, ou refus à rejeter dans la transaction. */
export type DeviceOnsiteState =
  | { kind: 'none' }
  | { kind: 'valid'; approval: OnsiteApproval }
  | { kind: 'refused'; error: ProblemException };

export type DeviceOnsiteRequest = Request & { deviceOnsite?: DeviceOnsiteState };

/** État posé par la garde ; une route non gardée par la variante n'a jamais de jeton (`none`). */
export function deviceOnsiteState(req: Request): DeviceOnsiteState {
  return (req as DeviceOnsiteRequest).deviceOnsite ?? { kind: 'none' };
}

@Injectable()
export class DeviceOnsiteApprovalGuard implements CanActivate {
  private readonly logger = new Logger('DeviceOnsiteApproval');

  constructor(
    private readonly reflector: Reflector,
    @Inject(IDENTITY_VERIFIER) private readonly verifier: IdentityVerifier,
    private readonly tx: TenantTx,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.get<DeviceOnsiteApprovalOptions | undefined>(
      DEVICE_ONSITE,
      context.getHandler(),
    );
    // Route mal déclarée : refus (jamais un passage sans contrôle).
    if (!options) throw new ProblemException('UNAUTHENTICATED');
    const req = context.switchToHttp().getRequest<DeviceOnsiteRequest>();
    // Route exclusive « terminal ou personne » : le chemin de la personne n'a ni terminal ni jeton sur place (la
    // seconde personne approuve la demande SALE_REVERSAL) ; l'en-tête n'y est pas lu.
    if (!(req as DeviceRequest).device) {
      req.deviceOnsite = { kind: 'none' };
      return true;
    }
    const device = requestDevice(req);
    const token = req.header(APPROVAL_TOKEN_HEADER);
    if (!token) {
      req.deviceOnsite = { kind: 'none' };
      return true;
    }
    try {
      const approval = await verifyOnsiteApproval(
        { verifier: this.verifier, tx: this.tx, logger: this.logger },
        {
          token,
          operationId: options.operationId,
          role: options.role,
          actHash: requestActHash(req),
          operatorId: () => device.operatorId,
          scope: (operatorId) => this.tx.run(operatorId, (client) => options.scope(req, client)),
        },
      );
      req.deviceOnsite = { kind: 'valid', approval };
    } catch (error) {
      // 4xx (jeton invalide, objet introuvable) : rejeté par la route, numéro enregistré. 5xx : tout de suite.
      if (!(error instanceof ProblemException) || error.status >= 500) throw error;
      req.deviceOnsite = { kind: 'refused', error };
    }
    return true;
  }
}

/**
 * Route de terminal qui accepte, en plus de la règle ordinaire, le jeton d'un valideur sur place
 * (`X-Approval-Token`). À placer AU-DESSUS de la garde de terminal (décorateurs appliqués de bas en haut).
 */
export const RequiresDeviceOnsiteApproval = (
  options: DeviceOnsiteApprovalOptions,
): MethodDecorator =>
  applyDecorators(SetMetadata(DEVICE_ONSITE, options), UseGuards(DeviceOnsiteApprovalGuard));

/**
 * Consomme le jeton vérifié par la garde, dans la transaction métier : insère `approval_token_use` avec l'appelant
 * terminal (`caller_device_id`, `caller_vendor_session_id`, `caller_id` NULL) et la vente visée (`target_id`, relue
 * par `assert_reversible`). `ON CONFLICT (jti) DO NOTHING` sans ligne, ou échéance passée → 403 APPROVAL_INVALID,
 * travail annulé. À appeler AVANT `assert_reversible`. Rend le valideur à transmettre au moteur.
 */
export async function consumeDeviceOnsiteApproval(
  client: TxClient,
  req: Request,
  audit: AuditService,
  target: { vendorSessionId: string; targetId: string },
): Promise<string> {
  const state = deviceOnsiteState(req);
  if (state.kind === 'refused') throw state.error;
  if (state.kind !== 'valid')
    throw new Error('consumeDeviceOnsiteApproval : requête sans jeton sur place');
  return recordApprovalUse(client, req, audit, state.approval, {
    deviceId: requestDevice(req).deviceId,
    vendorSessionId: target.vendorSessionId,
    targetId: target.targetId,
  });
}
