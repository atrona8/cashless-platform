// Garde composée des routes de recharge PSP (mission 6, lot WP11, T054 point 2 ; arbitrage de l'orchestrateur du
// 27/10/2026 ; A13). Trois appelants, jamais mélangés :
//  (a) GUICHET : un marqueur de terminal (certificat client présenté, ou en-tête `Signature` / `Signature-Input`)
//      -> chemin terminal COMPLET et SANS repli : `X-Staff-Authorization` exigé (sinon 401, avant toute preuve :
//      aucun nonce consommé), les trois preuves du terminal (`DeviceGuard`), puis la personne lue dans
//      `X-Staff-Authorization` (`AuthenticationGuard` + lecteur qui voit la route comme « jeton de personne »,
//      comme `TerminalOrPersonGuard` de WP08, dont la lecture de l'en-tête est reprise) ;
//  (b) FESTIVALIER : aucun marqueur -> jeton du festivalier (`CustomerGuard`) ;
//  (c) PERSONNE (lecture seulement, `allowPerson`) : à défaut de festivalier, jeton `Authorization` d'une
//      personne (un `ORGANIZER_ADMIN` est contrôlé ensuite par le service).
// Un `X-Staff-Authorization` sans marqueur de terminal : 401, quel que soit le reste. Un terminal sans jeton de
// personne : 401. Route mal déclarée (aucune option) : 401. Pose `req.pspCaller` à côté de `req.device`,
// `req.customer` et `req.principal`.
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
import type { Request } from 'express';
import {
  CUSTOMER_DIRECTORY,
  CUSTOMER_IDENTITY,
  type CustomerDirectory,
  type CustomerIdentityPort,
} from '../../customer-identity/customer-identity.port';
import { CustomerGuard } from '../../customer-identity/customer.guard';
import { TenantTx } from '../../db/tenant-tx';
import {
  DEVICE_DIRECTORY,
  DEVICE_IDENTITY,
  type DeviceDirectory,
  type DeviceIdentityPort,
} from '../../device-identity/device-identity.port';
import { hasDeviceMarker } from '../../device-identity/device-or-caller.guard';
import { DEVICE_AUTH_OPTIONS, DeviceGuard } from '../../device-identity/device.guard';
import { ProblemException } from '../../errors/problem';
import { AuthenticationGuard } from '../../identity/authentication.guard';
import { IDENTITY_VERIFIER, type IdentityVerifier } from '../../identity/oidc-verifier';
import { IS_PUBLIC, Public } from '../../identity/public.decorator';
import {
  STAFF_AUTHORIZATION_HEADER,
  STAFF_TOKEN_ROUTE,
  StaffToken,
} from '../../identity/staff-token.decorator';

export type PspCallerKind = 'DESK' | 'CUSTOMER' | 'PERSON';
export type PspCallerRequest = Request & { pspCaller?: { kind: PspCallerKind } };

export const PSP_CALLER_OPTIONS = 'cashless:psp-topup-caller-options';

export interface PspCallerOptions {
  /** Lecture : une personne (jeton `Authorization`) est admise à défaut de festivalier. */
  allowPerson: boolean;
}

/** Chemin terminal : route de guichet (jeton de personne dans `X-Staff-Authorization`), `@Public()` masquée. */
class DeskReflector extends Reflector {
  override getAllAndOverride<T = unknown>(key: unknown, targets: unknown[]): T {
    if (key === IS_PUBLIC) return undefined as T;
    if (key === STAFF_TOKEN_ROUTE) return true as T;
    return super.getAllAndOverride<T>(key as string, targets as never);
  }
}

/** Chemin de la personne seule : ni `@Public()` ni marque de guichet (jeton lu dans `Authorization`). */
class PersonReflector extends Reflector {
  override getAllAndOverride<T = unknown>(key: unknown, targets: unknown[]): T {
    if (key === IS_PUBLIC || key === STAFF_TOKEN_ROUTE) return undefined as T;
    return super.getAllAndOverride<T>(key as string, targets as never);
  }
}

@Injectable()
export class PspTopupCallerGuard implements CanActivate {
  private readonly device: DeviceGuard;
  private readonly deskPerson: AuthenticationGuard;
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
    this.deskPerson = new AuthenticationGuard(new DeskReflector(), verifier, tx);
    this.person = new AuthenticationGuard(new PersonReflector(), verifier, tx);
    this.customer = new CustomerGuard(customerIdentity, customerDirectory);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.options(context);
    const req = context.switchToHttp().getRequest<PspCallerRequest>();
    const staff = req.header(STAFF_AUTHORIZATION_HEADER) !== undefined;
    if (hasDeviceMarker(req)) {
      // Chemin terminal complet, sans repli : son refus est la réponse.
      if (!staff) throw new ProblemException('UNAUTHENTICATED');
      await this.device.canActivate(context);
      await this.deskPerson.canActivate(context);
      req.pspCaller = { kind: 'DESK' };
      return true;
    }
    // Un jeton de personne ne se présente jamais sans terminal.
    if (staff) throw new ProblemException('UNAUTHENTICATED');
    if (!options.allowPerson) {
      await this.customer.canActivate(context);
      req.pspCaller = { kind: 'CUSTOMER' };
      return true;
    }
    try {
      await this.customer.canActivate(context);
      req.pspCaller = { kind: 'CUSTOMER' };
    } catch (error) {
      if (!(error instanceof ProblemException) || error.code !== 'UNAUTHENTICATED') throw error;
      await this.person.canActivate(context);
      req.pspCaller = { kind: 'PERSON' };
    }
    return true;
  }

  private options(context: ExecutionContext): PspCallerOptions {
    const targets = [context.getHandler?.(), context.getClass?.()].filter(
      (target): target is NonNullable<typeof target> => target != null,
    );
    const options = this.reflector.getAllAndOverride<PspCallerOptions | undefined>(
      PSP_CALLER_OPTIONS,
      targets,
    );
    // Route mal déclarée : refus (jamais un appelant par défaut).
    if (!options || typeof options.allowPerson !== 'boolean')
      throw new ProblemException('UNAUTHENTICATED');
    return options;
  }
}

/**
 * Route de recharge PSP : `@Public()` et `@StaffToken()` pour que la garde globale laisse passer l'en-tête de
 * guichet ; les gardes de personne sont construites avec un lecteur qui masque ces marques.
 */
export const PspTopupCallerAuth = (options: PspCallerOptions): MethodDecorator & ClassDecorator =>
  applyDecorators(
    Public(),
    StaffToken(),
    SetMetadata(PSP_CALLER_OPTIONS, Object.freeze({ allowPerson: options.allowPerson })),
    SetMetadata(DEVICE_AUTH_OPTIONS, Object.freeze({})),
    UseGuards(PspTopupCallerGuard),
  );

/** Appelant prouvé par la garde (absent : 401, route mal déclarée). */
export function requestPspCaller(req: Request): { kind: PspCallerKind } {
  const caller = (req as PspCallerRequest).pspCaller;
  if (!caller) throw new ProblemException('UNAUTHENTICATED');
  return caller;
}
