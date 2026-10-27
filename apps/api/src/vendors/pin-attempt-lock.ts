// Un essai de PIN à la fois par terminal (mission 5b, lot WP09, T041 ; contracts/vendors.md ;
// arbitrage du 22/10 : mécanisme EN BASE, jamais en mémoire du processus).
//
// Mécanisme : verrou consultatif de session PostgreSQL, pris SANS ATTENTE, sur une clé dérivée du
// terminal (`SessionLock`, db/session-lock.ts : connexion dédiée, hors du pool principal), tenu
// pendant toute la requête (cycle 3, ADR-126 : pris par `RequestLockInterceptor`, AVANT le calcul du
// dérivé argon2 de l'empreinte d'idempotence, puis transaction A → argon2 → transaction B → audit C)
// et relâché à la fin de la requête, quelle qu'en soit l'issue. Déjà pris : `429 RATE_LIMITED` (`Retry-After: 1`), rien n'est lu ni écrit. Vaut
// pour tous les processus de l'API, puisque le verrou vit dans la base. La connexion du verrou ne
// tient ni transaction ni verrou de ligne.
//
// Le blocage d'un vendeur (NFR-003) ne dépend pas de ce verrou : il est tenu par la base
// (`begin_vendor_pin_check`, vendeur FOR UPDATE, compteur borné à 5).
import type { Request } from 'express';
import { requestDevice } from '../device-identity/device-identity.port';
import { ProblemException } from '../errors/problem';
import type { RequestLockOptions } from '../idempotency/request-lock';

/** Espace de noms du verrou (clé : `hashtextextended('vendor-pin-attempt:' || device_id, 0)`). */
export const PIN_ATTEMPT_LOCK_NAMESPACE = 'vendor-pin-attempt';
/** Même clé, pour les tests qui tiennent le verrou ($1 : identifiant du terminal). */
export const PIN_ATTEMPT_LOCK_KEY = `hashtextextended('${PIN_ATTEMPT_LOCK_NAMESPACE}:' || $1::text, 0)`;

/** Refus d'un second essai simultané du même terminal (contrat : `429 RATE_LIMITED`). */
export const attemptInProgress = (): ProblemException =>
  new ProblemException('RATE_LIMITED', { headers: { 'Retry-After': '1' } });

/** Verrou de requête de la route d'ouverture : le terminal authentifié, pris avant l'idempotence. */
export const PIN_ATTEMPT_REQUEST_LOCK: RequestLockOptions = {
  namespace: PIN_ATTEMPT_LOCK_NAMESPACE,
  id: (req: Request) => requestDevice(req).deviceId,
  busy: attemptInProgress,
};
