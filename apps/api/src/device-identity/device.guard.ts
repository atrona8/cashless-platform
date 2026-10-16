// Garde des routes de terminal : identité prouvée par le port, puis terminal relu en base (jamais cru sur parole).
// Refus : aucune identité (401), terminal inconnu du prestataire annoncé (401), révoqué (`DEVICE_REVOKED`), suspendu
// (`DEVICE_SUSPENDED`). Pose `req.device` ; le prestataire de la transaction est celui du terminal.
// `@DeviceAuth()` remplace la garde des personnes sur la route (une route de terminal ne porte pas de jeton humain).
import { applyDecorators, Inject, Injectable, UseGuards, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { ProblemException } from '../errors/problem';
import { Public } from '../identity/public.decorator';
import { DEVICE_DIRECTORY, DEVICE_IDENTITY, type DeviceDirectory, type DeviceIdentityPort, type DeviceRequest } from './device-identity.port';

@Injectable()
export class DeviceGuard implements CanActivate {
  constructor(
    @Inject(DEVICE_IDENTITY) private readonly identity: DeviceIdentityPort,
    @Inject(DEVICE_DIRECTORY) private readonly directory: DeviceDirectory,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<DeviceRequest>();
    const claims = await this.identity.identify(req);
    if (!claims) throw new ProblemException('UNAUTHENTICATED');
    const device = await this.directory.find(claims.operatorId, claims.deviceId);
    if (!device) throw new ProblemException('UNAUTHENTICATED');
    if (device.status === 'REVOKED') throw new ProblemException('DEVICE_REVOKED');
    if (device.status === 'SUSPENDED') throw new ProblemException('DEVICE_SUSPENDED');
    req.device = {
      deviceId: device.deviceId,
      operatorId: device.operatorId,
      eventId: device.eventId,
      posId: device.posId,
      agreementPublicKey: device.agreementPublicKey,
    };
    return true;
  }
}

/** Route appelée par un terminal : pas de jeton de personne, identité du terminal obligatoire. */
export const DeviceAuth = (): MethodDecorator & ClassDecorator => applyDecorators(Public(), UseGuards(DeviceGuard));
