// Garde exclusive « terminal ou personne » / « terminal ou festivalier » (mission 5b, lot WP08 ;
// A13 ; FR-016, FR-025 ; contracts/payments.md, « GET /payments/{transaction_id} »).
//
// Marqueurs de terminal : certificat client présenté sur la connexion TLS, ou en-tête `Signature`
// ou `Signature-Input`. UN marqueur présent → chemin terminal complet (`DeviceGuard` : trois
// preuves), SANS repli : un échec du terminal est un refus, jamais un passage par le chemin de la
// personne. Aucun marqueur → chemin de la personne (`AuthenticationGuard`) ou du festivalier
// (`CustomerGuard`) seul, selon la route. `X-Staff-Authorization` : refusé (pas une route de
// guichet ; la garde globale le refuse déjà, refusé ici aussi).
//
// Les gardes de personne et de festivalier sont appelées comme objets : la route est `@Public()`
// pour la garde globale (qui la laisse passer), et la garde des personnes est construite ici avec
// un lecteur de métadonnées qui ne voit PAS cette marque publique, de sorte qu'elle exige un jeton
// valide comme sur toute route de personne.
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
import type { TLSSocket } from 'node:tls';
import type { Request } from 'express';
import {
  CUSTOMER_DIRECTORY,
  CUSTOMER_IDENTITY,
  type CustomerDirectory,
  type CustomerIdentityPort,
} from '../customer-identity/customer-identity.port';
import { CustomerGuard } from '../customer-identity/customer.guard';
import { TenantTx } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';
import { AuthenticationGuard } from '../identity/authentication.guard';
import { IDENTITY_VERIFIER, type IdentityVerifier } from '../identity/oidc-verifier';
import { IS_PUBLIC, Public } from '../identity/public.decorator';
import { STAFF_AUTHORIZATION_HEADER, STAFF_TOKEN_ROUTE } from '../identity/staff-token.decorator';
import {
  DEVICE_DIRECTORY,
  DEVICE_IDENTITY,
  type DeviceDirectory,
  type DeviceIdentityPort,
} from './device-identity.port';
import { DEVICE_AUTH_OPTIONS, DeviceGuard, type DeviceAuthOptions } from './device.guard';

export interface DeviceOrCallerOptions {
  /** Autre appelant admis sans marqueur de terminal. */
  other: 'person' | 'customer';
  /** Options du chemin terminal (comme `@DeviceAuth`). */
  device?: DeviceAuthOptions;
}

export const DEVICE_OR_CALLER_OPTIONS = 'cashless:device-or-caller-options';

/** Vrai si la requête porte un marqueur de terminal (certificat TLS présenté, en-tête de signature). */
export function hasDeviceMarker(req: Request): boolean {
  if (req.header('signature') !== undefined || req.header('signature-input') !== undefined)
    return true;
  const socket = req.socket as Partial<TLSSocket> | undefined;
  if (typeof socket?.getPeerX509Certificate === 'function')
    return socket.getPeerX509Certificate() !== undefined;
  return false;
}

/** Lecteur de métadonnées qui ignore la marque `@Public()` (et la marque de guichet). */
class StrictReflector extends Reflector {
  override getAllAndOverride<T = unknown>(key: unknown, targets: unknown[]): T {
    if (key === IS_PUBLIC || key === STAFF_TOKEN_ROUTE) return undefined as T;
    return super.getAllAndOverride<T>(key as string, targets as never);
  }
}

@Injectable()
export class DeviceOrCallerGuard implements CanActivate {
  private readonly device: DeviceGuard;
  private readonly person: AuthenticationGuard;
  private readonly customer: CustomerGuard;

  constructor(
    @Inject(DEVICE_IDENTITY) deviceIdentity: DeviceIdentityPort,
    @Inject(DEVICE_DIRECTORY) deviceDirectory: DeviceDirectory,
    @Inject(IDENTITY_VERIFIER) verifier: IdentityVerifier,
    tx: TenantTx,
    @Inject(CUSTOMER_IDENTITY) customerIdentity: CustomerIdentityPort,
    @Inject(CUSTOMER_DIRECTORY) customerDirectory: CustomerDirectory,
    private readonly reflector: Reflector = new Reflector(),
  ) {
    this.device = new DeviceGuard(deviceIdentity, deviceDirectory, reflector);
    this.person = new AuthenticationGuard(new StrictReflector(), verifier, tx);
    this.customer = new CustomerGuard(customerIdentity, customerDirectory);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.options(context);
    const req = context.switchToHttp().getRequest<Request>();
    if (req.header(STAFF_AUTHORIZATION_HEADER) !== undefined)
      throw new ProblemException('UNAUTHENTICATED');
    if (hasDeviceMarker(req)) {
      // Chemin terminal complet, sans repli : son refus est la réponse.
      return this.device.canActivate(context);
    }
    if (options.other === 'person') return this.person.canActivate(context);
    return this.customer.canActivate(context);
  }

  private options(context: ExecutionContext): DeviceOrCallerOptions {
    const targets = [context.getHandler?.(), context.getClass?.()].filter(
      (target): target is NonNullable<typeof target> => target != null,
    );
    const options = this.reflector.getAllAndOverride<DeviceOrCallerOptions | undefined>(
      DEVICE_OR_CALLER_OPTIONS,
      targets,
    );
    // Route mal déclarée : refus (jamais un appelant par défaut).
    if (!options || (options.other !== 'person' && options.other !== 'customer'))
      throw new ProblemException('UNAUTHENTICATED');
    return options;
  }
}

/**
 * Route « terminal ou personne » (`other: 'person'`) ou « terminal ou festivalier »
 * (`other: 'customer'`) : garde exclusive, sans repli (A13).
 */
export const DeviceOrCallerAuth = (
  options: DeviceOrCallerOptions,
): MethodDecorator & ClassDecorator =>
  applyDecorators(
    Public(),
    SetMetadata(DEVICE_OR_CALLER_OPTIONS, Object.freeze({ other: options.other })),
    // Lues par `DeviceGuard` sur le chemin terminal (comme `@DeviceAuth(options)`).
    SetMetadata(DEVICE_AUTH_OPTIONS, Object.freeze({ ...options.device })),
    UseGuards(DeviceOrCallerGuard),
  );
