// Liste blanche des opérations que la passerelle sert aux terminaux
// (contracts/gateway-served-operations.md : les 16
// opérations de `openapi.yaml` marquées `x-edge-available: true`). AUCUNE route n'est ajoutée
// au-delà.
//
// Toute route d'un contrôleur du processus terminal porte `@ServedOperation('<operationId>')` avec
// un identifiant de
// cette liste ; la garde `ServedOperationGuard` (globale, branchée dans `gateway.module.ts`) répond
// `404` à toute route
// non marquée ou marquée d'un identifiant hors liste. Les lots 19 à 23 déclarent leurs routes en
// les marquant ; le test
// d'architecture (`test/startup/architecture.spec.ts`) échoue si une route est déclarée sans y
// figurer.
import {
  Inject,
  Injectable,
  NotFoundException,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const SERVED_OPERATION_IDS = [
  'refreshDeviceToken',
  'getDeviceConfig',
  'postDeviceHeartbeat',
  'getDeviceSeqStatus',
  'getMediaAuthKey',
  'createTap',
  'activateMedia',
  'takeDeposit',
  'createPayment',
  'getPayment',
  'reversePayment',
  'createCashTopup',
  'getOfflineSnapshot',
  'ackOfflineSnapshot',
  'submitOfflineBatch',
  'getOfflineBatchResult',
] as const;
export type ServedOperationId = (typeof SERVED_OPERATION_IDS)[number];

const SERVED = new Set<string>(SERVED_OPERATION_IDS);
export const SERVED_OPERATION_KEY = 'gateway:served-operation';

/** Marque une route comme l'une des 16 opérations servies. */
export const ServedOperation = (id: ServedOperationId): MethodDecorator =>
  SetMetadata(SERVED_OPERATION_KEY, id);

@Injectable()
export class ServedOperationGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const id = this.reflector.getAllAndOverride<string | undefined>(SERVED_OPERATION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (id === undefined || !SERVED.has(id)) throw new NotFoundException();
    return true;
  }
}
