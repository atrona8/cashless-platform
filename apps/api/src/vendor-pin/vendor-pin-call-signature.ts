// Signature de l'appel interne API → processus `vendor-pin` (mission 11a, lot WP06 ; FR-005, C-006).
// Fonctions pures, partagées par le serveur (garde) et par le client de l'API (WP07 importe `signCall`).
//
// HMAC-SHA256(clé, ts + "\n" + méthode + " " + chemin + "\n" + corps), en hexadécimal minuscule.
// - `ts` : millisecondes depuis l'epoch, en chiffres décimaux (en-tête `x-pin-ts`) ;
// - `méthode` : en majuscules ; `chemin` : la cible de la requête telle qu'envoyée (`originalUrl`,
//   préfixe `/v1` et requête compris) ;
// - `corps` : les OCTETS bruts du corps, jamais une re-sérialisation ;
// - fenêtre de 30 s de part et d'autre de l'heure du serveur ; comparaison en temps constant.
// Aucune erreur ne dit quel contrôle a échoué.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const PIN_TS_HEADER = 'x-pin-ts';
export const PIN_SIG_HEADER = 'x-pin-sig';
/** Fenêtre d'horodatage acceptée, de part et d'autre de l'heure du serveur. */
export const PIN_CALL_WINDOW_MS = 30_000;

const TS_PATTERN = /^[0-9]{1,15}$/;
const SIG_PATTERN = /^[0-9a-f]{64}$/;

/** Signature hexadécimale d'un appel ; `ts` en millisecondes (chaîne ou entier). */
export function signCall(
  key: Buffer,
  ts: string | number,
  method: string,
  path: string,
  body: Uint8Array | string,
): string {
  const head = Buffer.from(`${ts}\n${method.toUpperCase()} ${path}\n`, 'utf8');
  const raw = typeof body === 'string' ? Buffer.from(body, 'utf8') : Buffer.from(body);
  return createHmac('sha256', key).update(head).update(raw).digest('hex');
}

export interface VerifyCallInput {
  key: Buffer;
  /** Valeurs brutes des en-têtes `x-pin-ts` et `x-pin-sig` (absentes ou répétées : refus). */
  ts: unknown;
  sig: unknown;
  method: string;
  path: string;
  body: Uint8Array;
  /** Heure du serveur en ms (défaut : maintenant) ; injectable pour les tests. */
  now?: number;
}

/**
 * Vrai seulement si la signature est celle de la clé sur cet appel ET l'horodatage est dans la
 * fenêtre. La signature est toujours recalculée et comparée (temps constant), même si l'horodatage
 * est hors fenêtre : le refus ne coûte pas moins cher qu'une acceptation.
 */
export function verifyCall(input: VerifyCallInput): boolean {
  const ts = typeof input.ts === 'string' && TS_PATTERN.test(input.ts) ? input.ts : null;
  const sig = typeof input.sig === 'string' && SIG_PATTERN.test(input.sig) ? input.sig : null;
  const expected = Buffer.from(
    signCall(input.key, ts ?? '0', input.method, input.path, input.body),
    'hex',
  );
  const given = Buffer.from(sig ?? '0'.repeat(64), 'hex');
  const equal = timingSafeEqual(expected, given);
  const now = input.now ?? Date.now();
  const fresh = ts !== null && Math.abs(now - Number(ts)) <= PIN_CALL_WINDOW_MS;
  return equal && sig !== null && fresh;
}
