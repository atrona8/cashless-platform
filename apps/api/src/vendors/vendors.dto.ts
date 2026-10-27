// Corps et réponses des routes des vendeurs (mission 5b, lot WP09 ; contrat : `Vendor`,
// `VendorPage`, `VendorCreate`, `VendorPinChange`, `VendorStatusChange`, `VendorSessionOpen`,
// `VendorSession`, `TerminalVendorList` ; contracts/vendors.md).
//
// Règles tenues ici :
// - le PIN fait exactement 6 chiffres (`PIN_PATTERN` du lot WP08) ; tout refus est rendu SANS
//   ÉCHO : ni la valeur reçue, ni un nom de champ inconnu (qui pourrait être la valeur) dans
//   `detail` ;
// - les réponses sont des listes blanches : jamais `pin`, `pin_hash`, `failed_attempts`,
//   `locked_at` (la vue `vendor_public` ne les expose d'ailleurs pas, A20).
import type { components } from '@cashless/contracts';
import { isUuid, objectBody, unprocessable } from '../organization/platform/platform.dto';
import { PIN_PATTERN } from '../vendor-pin/vendor-pin.hasher';

export type Vendor = components['schemas']['Vendor'];
export type VendorStatus = components['schemas']['VendorStatus'];
export type VendorSession = components['schemas']['VendorSession'];
export type TerminalVendor = components['schemas']['TerminalVendor'];
export type TerminalVendorList = components['schemas']['TerminalVendorList'];

export const VENDOR_STATUSES: readonly VendorStatus[] = ['ACTIVE', 'DISABLED'];
/** Longueur maximale du nom (contrat et contrainte `vendor_display_name`). */
export const DISPLAY_NAME_MAX = 80;

/** Colonnes de la vue `vendor_public` (alias `v`), et elles seules. */
export const VENDOR_COLUMNS = 'v.id, v.merchant_id, v.display_name, v.status, v.locked';

export interface VendorRow {
  id: string;
  merchant_id: string;
  display_name: string;
  status: VendorStatus;
  locked: boolean;
}

/** Ligne de `vendor_public` → `Vendor` : liste blanche des champs. */
export function vendorDto(row: VendorRow): Vendor {
  return {
    vendor_id: row.id,
    merchant_id: row.merchant_id,
    display_name: row.display_name,
    status: row.status,
    locked: row.locked,
  };
}

export interface TerminalVendorRow {
  id: string;
  display_name: string;
}

/** Vendeur de l'écran de connexion : identifiant et nom, rien d'autre (A22). */
export function terminalVendorDto(row: TerminalVendorRow): TerminalVendor {
  return { vendor_id: row.id, display_name: row.display_name };
}

export interface VendorSessionRow {
  vendor_session_id: string;
  vendor_id: string;
  vendor_display_name: string;
  expires_at: Date;
}

export function vendorSessionDto(row: VendorSessionRow): VendorSession {
  return {
    vendor_session_id: row.vendor_session_id,
    vendor_id: row.vendor_id,
    vendor_display_name: row.vendor_display_name,
    expires_at: row.expires_at.toISOString(),
  };
}

// ------------------------------------------------------------------ Corps

/** Champs inconnus refusés (`additionalProperties: false`), sans citer leur nom. */
function onlyFields(body: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(body).some((key) => !allowed.includes(key)))
    throw unprocessable('Champ inconnu dans le corps de la requête.');
}

/** PIN de 6 chiffres (chaîne) ; sinon `422 VALIDATION_FAILED`, sans écho de la valeur. */
export function pinField(body: Record<string, unknown>): string {
  const pin = body.pin;
  if (typeof pin !== 'string' || !PIN_PATTERN.test(pin))
    throw unprocessable('pin : exactement 6 chiffres attendus.');
  return pin;
}

function displayNameField(body: Record<string, unknown>): string {
  const value = body.display_name;
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed.length < 1 || trimmed.length > DISPLAY_NAME_MAX)
    throw unprocessable(`display_name : texte de 1 à ${DISPLAY_NAME_MAX} caractères.`);
  return trimmed;
}

export interface VendorCreateInput {
  displayName: string;
  pin: string;
}

/** Corps `VendorCreate`. */
export function parseVendorCreate(raw: unknown): VendorCreateInput {
  const body = objectBody(raw);
  onlyFields(body, ['display_name', 'pin']);
  return { displayName: displayNameField(body), pin: pinField(body) };
}

/** Corps `VendorPinChange` : rend le PIN. */
export function parseVendorPinChange(raw: unknown): string {
  const body = objectBody(raw);
  onlyFields(body, ['pin']);
  return pinField(body);
}

/** Corps `VendorStatusChange`. */
export function parseVendorStatusChange(raw: unknown): VendorStatus {
  const body = objectBody(raw);
  onlyFields(body, ['status']);
  const status = body.status;
  if (typeof status !== 'string' || !(VENDOR_STATUSES as readonly string[]).includes(status))
    throw unprocessable(`status : valeurs permises ${VENDOR_STATUSES.join(', ')}.`);
  return status as VendorStatus;
}

export interface VendorSessionOpenInput {
  vendorId: string;
  pin: string;
}

/**
 * Corps `VendorSessionOpen`. PIN mal formé : `422 VALIDATION_FAILED` sans écho (openapi.yaml,
 * `openVendorSession` et `VendorSessionOpen.pin`), contrôlé AVANT toute lecture : le refus ne dit
 * rien du vendeur, et aucun essai n'est compté.
 */
export function parseVendorSessionOpen(raw: unknown): VendorSessionOpenInput {
  const body = objectBody(raw);
  onlyFields(body, ['vendor_id', 'pin']);
  const vendorId = body.vendor_id;
  if (!isUuid(vendorId)) throw unprocessable('vendor_id : identifiant attendu.');
  return { vendorId: vendorId.toLowerCase(), pin: pinField(body) };
}

/** Filtre `status` de `listVendors` (400 sur une valeur inconnue). */
export function parseVendorStatusFilter(raw: string | undefined): VendorStatus | undefined {
  if (raw === undefined) return undefined;
  if (!(VENDOR_STATUSES as readonly string[]).includes(raw))
    throw unprocessable('status : valeur inconnue.');
  return raw as VendorStatus;
}
