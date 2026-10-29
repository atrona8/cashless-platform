// Garde exclusive « terminal + personne » ou « personne seule » des routes de session de caisse
// (mission 6, lot WP08, T037 ; R-04, ADR-113 ; contrat `closeCashSession`, `getCashSession`).
//
// Deux chemins qui ne se mélangent jamais, modèle `DeviceOrCallerGuard` :
//  (a) un marqueur de terminal (certificat client présenté, ou en-tête `Signature`/`Signature-Input`)
//      → chemin terminal COMPLET et sans repli : `X-Staff-Authorization` exigé (sinon 401, avant toute
//      preuve : aucun nonce consommé), les trois preuves du terminal (`DeviceGuard`), puis la personne
//      lue dans `X-Staff-Authorization` (route de guichet) ;
//  (b) aucun marqueur → chemin de la personne seule : `X-Staff-Authorization` présent → 401 (un jeton
//      de personne ne se présente jamais à cet endroit), sinon jeton `Authorization` de la personne.
//
// Ordre de `AuthenticationGuard` (lu avant d'écrire ceci) : (1) en-tête de guichet sur une route non
// marquée `StaffToken` → 401 ; (2) route `@Public()` → laissée passer SANS lire de jeton ; (3) jeton lu
// dans l'en-tête de guichet (route marquée) ou `Authorization`. La route porte `@Public()` et
// `@StaffToken()` pour que la garde globale ne refuse pas l'en-tête de guichet avant celle-ci ; les
// gardes de personne sont donc construites ici avec un lecteur de métadonnées qui masque `@Public()`
// (étape 2), et, sur le chemin (b), aussi la marque de guichet (étape 1 puis source `Authorization`).
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
import { TenantTx } from '../db/tenant-tx';
import {
  DEVICE_DIRECTORY,
  DEVICE_IDENTITY,
  type DeviceDirectory,
  type DeviceIdentityPort,
} from '../device-identity/device-identity.port';
import { hasDeviceMarker } from '../device-identity/device-or-caller.guard';
import { DEVICE_AUTH_OPTIONS, DeviceGuard } from '../device-identity/device.guard';
import { ProblemException } from '../errors/problem';
import { AuthenticationGuard } from '../identity/authentication.guard';
import { IDENTITY_VERIFIER, type IdentityVerifier } from '../identity/oidc-verifier';
import { IS_PUBLIC, Public } from '../identity/public.decorator';
import {
  STAFF_AUTHORIZATION_HEADER,
  STAFF_TOKEN_ROUTE,
  StaffToken,
} from '../identity/staff-token.decorator';

/** Chemin terminal : route de guichet (jeton dans `X-Staff-Authorization`), `@Public()` masquée. */
class CounterReflector extends Reflector {
  override getAllAndOverride<T = unknown>(key: unknown, targets: unknown[]): T {
    if (key === IS_PUBLIC) return undefined as T;
    if (key === STAFF_TOKEN_ROUTE) return true as T;
    return super.getAllAndOverride<T>(key as string, targets as never);
  }
}

/** Chemin de la personne seule : ni `@Public()` ni marque de guichet. */
class PersonReflector extends Reflector {
  override getAllAndOverride<T = unknown>(key: unknown, targets: unknown[]): T {
    if (key === IS_PUBLIC || key === STAFF_TOKEN_ROUTE) return undefined as T;
    return super.getAllAndOverride<T>(key as string, targets as never);
  }
}

@Injectable()
export class TerminalOrPersonGuard implements CanActivate {
  private readonly device: DeviceGuard;
  private readonly counterPerson: AuthenticationGuard;
  private readonly person: AuthenticationGuard;

  constructor(
    @Inject(DEVICE_IDENTITY) deviceIdentity: DeviceIdentityPort,
    @Inject(DEVICE_DIRECTORY) deviceDirectory: DeviceDirectory,
    @Inject(IDENTITY_VERIFIER) verifier: IdentityVerifier,
    tx: TenantTx,
    reflector: Reflector = new Reflector(),
  ) {
    this.device = new DeviceGuard(deviceIdentity, deviceDirectory, reflector);
    this.counterPerson = new AuthenticationGuard(new CounterReflector(), verifier, tx);
    this.person = new AuthenticationGuard(new PersonReflector(), verifier, tx);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const staff = req.header(STAFF_AUTHORIZATION_HEADER) !== undefined;
    if (hasDeviceMarker(req)) {
      // Chemin terminal complet, sans repli : son refus est la réponse.
      if (!staff) throw new ProblemException('UNAUTHENTICATED');
      await this.device.canActivate(context);
      return this.counterPerson.canActivate(context);
    }
    if (staff) throw new ProblemException('UNAUTHENTICATED');
    return this.person.canActivate(context);
  }
}

/**
 * Route « terminal + personne » ou « personne seule » : garde exclusive, sans repli. `Public()` et
 * `StaffToken()` pour que la garde globale laisse passer l'en-tête de guichet ; `DEVICE_AUTH_OPTIONS`
 * est lue par `DeviceGuard` sur le chemin terminal (aucune option : terminal actif seulement).
 */
export const TerminalOrPersonAuth = (): MethodDecorator & ClassDecorator =>
  applyDecorators(
    Public(),
    StaffToken(),
    SetMetadata(DEVICE_AUTH_OPTIONS, Object.freeze({})),
    UseGuards(TerminalOrPersonGuard),
  );
