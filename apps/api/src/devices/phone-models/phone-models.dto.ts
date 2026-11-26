// Modèles de téléphone (mission 11b, lot WP09 ; contrat PhoneModel, PhoneModelPage,
// PhoneModelUpsert, DeviceModel). Table de plateforme (D9) : sans prestataire ni donnée
// personnelle. Valeurs invalides d'une requête du back-office : 422 (D10, aucun code nouveau). Le
// modèle déclaré par un terminal, lui, n'est JAMAIS refusé (C-003) : `parseDeviceModel` rend `null`
// pour toute valeur inexploitable.
import type { components } from '@cashless/contracts';
import { ProblemException } from '../../errors/problem';
import {
  objectBody,
  pageRequest,
  unprocessable,
  type PageRequest,
} from '../../organization/platform/platform.dto';

export type PhoneModel = components['schemas']['PhoneModel'];
export type DeviceModel = components['schemas']['DeviceModel'];
export type NfcLevel = components['schemas']['NfcLevel'];
export type MeasuredNfcLevel = PhoneModel['nfc_level'];

const MEASURED_LEVELS: readonly string[] = ['RECOMMENDED', 'TOLERATED'];
export const MAX_NAME = 100;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface PhoneModelRow {
  manufacturer: string;
  model: string;
  nfc_level: MeasuredNfcLevel;
  measured_at: string;
  updated_at: Date;
}

export interface PhoneModelUpsertInput {
  nfcLevel: MeasuredNfcLevel;
  measuredAt: string;
}

/** Règle de `normalize_phone_model` (base) : minuscules, espaces réduits ; contrôles de taille. */
export function normalizedLength(value: string): number {
  return value.replace(/\s+/g, ' ').trim().toLowerCase().length;
}

/** Segment de chemin (décodé par Express) : 1 à 100 caractères normalisés, sinon 422. */
export function pathName(value: string, name: string): string {
  const length = normalizedLength(value);
  if (length < 1 || length > MAX_NAME)
    throw unprocessable(`${name} : texte de 1 à ${MAX_NAME} caractères.`);
  return value;
}

/** `YYYY-MM-DD` réel, pas dans le futur (UTC). */
function measuredDate(value: unknown): string {
  const match = typeof value === 'string' ? DATE.exec(value) : null;
  if (!match) throw unprocessable('measured_at : date AAAA-MM-JJ attendue.');
  const [, y, m, d] = match;
  const parsed = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (
    parsed.getUTCFullYear() !== Number(y) ||
    parsed.getUTCMonth() !== Number(m) - 1 ||
    parsed.getUTCDate() !== Number(d)
  )
    throw unprocessable('measured_at : date inexistante.');
  if (parsed.getTime() > Date.now()) throw unprocessable('measured_at : date dans le futur.');
  return value as string;
}

/** Corps `PhoneModelUpsert` : `nfc_level` et `measured_at`, aucun autre champ. */
export function parseUpsert(raw: unknown): PhoneModelUpsertInput {
  let body: Record<string, unknown>;
  try {
    body = objectBody(raw);
  } catch {
    throw unprocessable('Corps JSON attendu.');
  }
  const unknown = Object.keys(body).filter((key) => key !== 'nfc_level' && key !== 'measured_at');
  if (unknown.length > 0) throw unprocessable(`${unknown.join(', ')} : champ inconnu.`);
  if (typeof body.nfc_level !== 'string' || !MEASURED_LEVELS.includes(body.nfc_level))
    throw unprocessable('nfc_level : RECOMMENDED ou TOLERATED.');
  return {
    nfcLevel: body.nfc_level as MeasuredNfcLevel,
    measuredAt: measuredDate(body.measured_at),
  };
}

/** Pagination : curseur ou limite invalide → 422 (interfaces.md §4). */
export function parsePage(cursor: string | undefined, limit: string | undefined): PageRequest {
  try {
    return pageRequest(cursor, limit);
  } catch (error) {
    if (error instanceof ProblemException) throw unprocessable('cursor ou limit invalide.');
    throw error;
  }
}

/** `YYYY-MM-DD` d'une date lue par `pg` (colonne `date`, rendue en texte par le service). */
export function phoneModelDto(row: PhoneModelRow): PhoneModel {
  return {
    manufacturer: row.manufacturer,
    model: row.model,
    nfc_level: row.nfc_level,
    measured_at: row.measured_at,
    updated_at: row.updated_at.toISOString(),
  };
}

/**
 * `device_model` déclaré par un terminal (enrôlement, signal de vie) : facultatif, informatif (D2,
 * C-003). Toute valeur absente, de mauvais type, vide, trop longue ou incomplète rend `null` : le
 * terminal est servi sans modèle, jamais refusé.
 */
export function parseDeviceModel(body: Record<string, unknown>): DeviceModel | null {
  const value = body.device_model;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { manufacturer, model } = value as Record<string, unknown>;
  if (typeof manufacturer !== 'string' || typeof model !== 'string') return null;
  for (const text of [manufacturer, model]) {
    const length = normalizedLength(text);
    if (length < 1 || length > MAX_NAME) return null;
  }
  return { manufacturer, model };
}
