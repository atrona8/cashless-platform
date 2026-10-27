// Garde des routes de terminal : identité prouvée par le port, puis terminal relu en base (jamais cru sur parole).
// Refus : aucune identité (401), terminal inconnu du prestataire annoncé (401), révoqué (`DEVICE_REVOKED`), suspendu
// (`DEVICE_SUSPENDED`, sauf route `allowSuspended`, research R-14). Pose `req.device` ; le
// prestataire de la transaction est celui du terminal.
// `@DeviceAuth()` remplace la garde des personnes sur la route (une route de terminal ne porte pas de jeton humain).
// Options (mission 5a, lot WP12) : `allowSuspended` (configuration, battement de cœur, lots hors
// ligne) ; `nfcOnly` : route réservée à un terminal Android au NFC actif (borne iOS d'OP-N64,
// ADR-106).
// Mission 5b (lot WP08) : recopie aussi le contexte enrichi (`serial`, mode, téléphone personnel,
// commerçant et participation) quand la lecture du processus le fournit ; le mode n'est PAS
// contrôlé ici (chaque route appelle `assertDeviceMode`).
import {
  applyDecorators,
  Inject,
  Injectable,
  SetMetadata,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ProblemException } from '../errors/problem';
import { Public } from '../identity/public.decorator';
import { STAFF_AUTHORIZATION_HEADER, STAFF_TOKEN_ROUTE } from '../identity/staff-token.decorator';
import {
  DEVICE_DIRECTORY,
  DEVICE_IDENTITY,
  type DeviceDirectory,
  type DeviceIdentityPort,
  type DeviceRequest,
} from './device-identity.port';

export interface DeviceAuthOptions {
  /** Terminal suspendu admis (R-14) ; défaut : refusé. Un terminal révoqué est refusé partout. */
  allowSuspended?: boolean;
  /** Terminal Android au NFC actif seulement (OP-N64) ; sinon `422 DEVICE_MODE_NOT_ALLOWED`. */
  nfcOnly?: boolean;
}

export const DEVICE_AUTH_OPTIONS = 'cashless:device-auth-options';

@Injectable()
export class DeviceGuard implements CanActivate {
  constructor(
    @Inject(DEVICE_IDENTITY) private readonly identity: DeviceIdentityPort,
    @Inject(DEVICE_DIRECTORY) private readonly directory: DeviceDirectory,
    // Facultatif hors de Nest (tests unitaires de la garde) : sans métadonnée, options par défaut.
    private readonly reflector: Reflector = new Reflector(),
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.options(context);
    const req = context.switchToHttp().getRequest<DeviceRequest>();
    // Jeton de personne hors d'une route de guichet (processus des clés compris, qui n'a pas de
    // garde des personnes) : refusé avant toute preuve, aucun nonce consommé.
    if (
      req.header(STAFF_AUTHORIZATION_HEADER) !== undefined &&
      this.metadata<boolean>(STAFF_TOKEN_ROUTE, context) !== true
    )
      throw new ProblemException('UNAUTHENTICATED');
    const claims = await this.identity.identify(req);
    if (!claims) throw new ProblemException('UNAUTHENTICATED');
    const device = await this.directory.find(claims.operatorId, claims.deviceId);
    if (!device) throw new ProblemException('UNAUTHENTICATED');
    if (device.status === 'REVOKED') throw new ProblemException('DEVICE_REVOKED');
    if (device.status === 'SUSPENDED' && !options.allowSuspended)
      throw new ProblemException('DEVICE_SUSPENDED');
    if (options.nfcOnly && (device.os !== 'ANDROID' || !device.nfcEnabled))
      throw new ProblemException('DEVICE_MODE_NOT_ALLOWED', {
        detail: 'Cette opération exige un terminal Android au NFC actif.',
      });
    req.device = {
      deviceId: device.deviceId,
      operatorId: device.operatorId,
      eventId: device.eventId,
      posId: device.posId,
      agreementPublicKey: device.agreementPublicKey,
      os: device.os,
      nfcEnabled: device.nfcEnabled,
      // Contexte enrichi (mission 5b, T034) : posé par la lecture de l'API publique seulement.
      ...(device.serial !== undefined ? { serial: device.serial } : {}),
      ...(device.appMode !== undefined ? { appMode: device.appMode } : {}),
      ...(device.personalPhone !== undefined ? { personalPhone: device.personalPhone } : {}),
      ...(device.merchantId !== undefined ? { merchantId: device.merchantId } : {}),
      ...(device.participationId !== undefined ? { participationId: device.participationId } : {}),
    };
    return true;
  }

  private options(context: ExecutionContext): DeviceAuthOptions {
    return this.metadata<DeviceAuthOptions>(DEVICE_AUTH_OPTIONS, context) ?? {};
  }

  private metadata<T>(key: string, context: ExecutionContext): T | undefined {
    const targets = [context.getHandler?.(), context.getClass?.()].filter(
      (target): target is NonNullable<typeof target> => target != null,
    );
    return this.reflector.getAllAndOverride<T | undefined>(key, targets);
  }
}

/**
 * Route appelée par un terminal : pas de jeton de personne, identité du terminal obligatoire. Sans
 * argument : terminal actif seulement (comportement de la mission 4).
 */
export const DeviceAuth = (options: DeviceAuthOptions = {}): MethodDecorator & ClassDecorator =>
  applyDecorators(
    Public(),
    SetMetadata(DEVICE_AUTH_OPTIONS, Object.freeze({ ...options })),
    UseGuards(DeviceGuard),
  );
