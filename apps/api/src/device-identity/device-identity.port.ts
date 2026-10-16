// Identité du terminal (mission bracelets-nfc, research R-07, contracts/identity-ports.md).
// Les routes appelées par un terminal reçoivent son identité d'un fournisseur remplaçable. Cette mission ne livre
// qu'un FAUX (lecture d'en-têtes de test) : l'enrôlement, le jeton d'appareil, le mTLS et la signature des requêtes
// arrivent avec la mission des terminaux, qui branchera sa propre implémentation de `DeviceIdentityPort` sans toucher
// aux routes. Dettes consignées dans docs/POINTS_OUVERTS.md ; jamais de faux en production (NFR-010).
import type { Request } from 'express';
import { ProblemException } from '../errors/problem';

/** Ce que prouve l'identité présentée : quel terminal, de quel prestataire. Le reste se lit en base. */
export interface DeviceClaims {
  deviceId: string;
  operatorId: string;
}

export interface DeviceIdentityPort {
  /** Marqueur lu par la garde de production. */
  readonly isFake?: boolean;
  /** Rend l'identité prouvée par la requête, ou `null` si elle n'en porte aucune de valide. */
  identify(req: Request): Promise<DeviceClaims | null>;
}

/** Terminal de la requête, tel que la base le connaît (jamais tel que la requête le déclare). */
export interface DeviceContext {
  deviceId: string;
  operatorId: string;
  eventId: string | null;
  posId: string | null;
  /** Clé publique d'accord ECDH P-256 (65 octets) : sert à lui chiffrer un mot de passe de bracelet. */
  agreementPublicKey: Buffer | null;
}

/** Lecture du terminal en base, sous le rôle du processus qui sert la route. */
export interface DeviceDirectory {
  find(operatorId: string, deviceId: string): Promise<(DeviceContext & { status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED' }) | null>;
}

export const DEVICE_IDENTITY = Symbol('DEVICE_IDENTITY');
export const DEVICE_DIRECTORY = Symbol('DEVICE_DIRECTORY');

export type DeviceRequest = Request & { device?: DeviceContext };

/** Terminal posé par `DeviceGuard` ; absent → 401 (route mal déclarée ou garde contournée). */
export function requestDevice(req: Request): DeviceContext {
  const device = (req as DeviceRequest).device;
  if (!device) throw new ProblemException('UNAUTHENTICATED');
  return device;
}
