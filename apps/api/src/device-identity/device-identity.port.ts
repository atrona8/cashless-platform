// Identité du terminal (mission bracelets-nfc, research R-07, contracts/identity-ports.md).
// Les routes appelées par un terminal reçoivent son identité d'un fournisseur remplaçable. Depuis
// la mission 5a (lot WP12, OP-N42), le fournisseur est `RealDeviceIdentity` : certificat client,
// jeton d'appareil lié et signature de la requête, liés au même terminal
// (contracts/device-authentication.md). Le faux (en-têtes de test) ne se construit plus que hors
// production et sur demande explicite (`DEVICE_IDENTITY_FAKE=1`) ; jamais de faux en production
// (NFR-010).
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
  /** Posé par `DeviceGuard` (lu en base) ; facultatif pour les contextes construits à la main. */
  os?: 'ANDROID' | 'IOS';
  /** Faux pour un terminal iOS (contrainte de `device`) ou dont le NFC est coupé. */
  nfcEnabled?: boolean;
}

export type DeviceStatus = 'ACTIVE' | 'SUSPENDED' | 'REVOKED';

/** Terminal lu en base, et ce qui sert aux preuves (clé de signature, empreinte du certificat). */
export interface DeviceRecord extends DeviceContext {
  status: DeviceStatus;
  os: 'ANDROID' | 'IOS';
  nfcEnabled: boolean;
  /** Clé publique de signature (SPKI DER, P-256) ; `null` pour un terminal d'avant l'enrôlement. */
  publicKey: Buffer | null;
  /** SHA-256 du certificat client (DER) ; `null` pour un terminal d'avant l'enrôlement. */
  certSha256: Buffer | null;
}

/** Lecture du terminal en base, sous le rôle du processus qui sert la route. */
export interface DeviceDirectory {
  find(operatorId: string, deviceId: string): Promise<DeviceRecord | null>;
  /**
   * Terminal ET état de la famille de jetons `familyId` (claim `fid`), lus dans une même
   * transaction sous le prestataire annoncé (contracts/device-authentication.md, étape 3).
   */
  findForAuthentication(
    operatorId: string,
    deviceId: string,
    familyId: string,
  ): Promise<{ device: DeviceRecord; familyActive: boolean } | null>;
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
