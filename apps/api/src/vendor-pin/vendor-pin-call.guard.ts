// Garde des routes internes du processus `vendor-pin` (mission 11a, lot WP06 ; FR-005, C-006) :
// vérifie `x-pin-ts` et `x-pin-sig` sur le corps BRUT reçu (`req.rawBody`, octets du fil), avant
// tout accès à la base. Tout refus rend le même `401 UNAUTHENTICATED`, sans dire quel contrôle a
// échoué. Aucun mode dégradé : sans clé configurée, le processus ne démarre pas.
//
// Mission 11a, WP07 (décision du porteur, 19/11/2026) : un appel signé n'est accepté qu'UNE fois.
// Chaque signature acceptée est gardée en mémoire du processus pendant la fenêtre (30 s de part et
// d'autre, soit 60 s de validité possible) plus une marge ; une signature déjà vue est refusée comme
// une fausse. Cache borné : purge des entrées expirées, taille maximale ; plein après purge → refus
// (échec sûr), jamais d'acceptation sans contrôle. Un appel qui porte un corps mais dont les octets
// bruts sont absents est refusé (jamais signé « comme vide »).
import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { ProblemException } from '../errors/problem';
import {
  PIN_CALL_WINDOW_MS,
  PIN_SIG_HEADER,
  PIN_TS_HEADER,
  verifyCall,
} from './vendor-pin-call-signature';
import { VENDOR_PIN_CALL_KEY } from './vendor-pin.tokens';

type RawBodyRequest = Request & { rawBody?: Buffer };

/** Durée de garde d'une signature acceptée : deux fenêtres (avance et retard) plus une marge. */
export const REPLAY_TTL_MS = 2 * PIN_CALL_WINDOW_MS + 10_000;
/** Taille maximale du cache (les appels réels sont de l'ordre de quelques dizaines par seconde). */
export const REPLAY_CACHE_MAX = 20_000;

/** Vrai si la requête porte un corps (en-tête de longueur ou corps déjà analysé non vide). */
function hasBody(req: Request): boolean {
  if (Number(req.headers['content-length'] ?? 0) > 0) return true;
  if (req.headers['transfer-encoding'] !== undefined) return true;
  const body: unknown = req.body;
  return typeof body === 'object' && body !== null && Object.keys(body).length > 0;
}

@Injectable()
export class VendorPinCallGuard implements CanActivate {
  /** Signature (hex) → fin de validité en ms. En mémoire du processus : un redémarrage la vide. */
  private readonly seen = new Map<string, number>();

  constructor(@Inject(VENDOR_PIN_CALL_KEY) private readonly key: Buffer) {}

  /** Enregistre la signature ; faux si déjà vue ou si le cache est plein (échec sûr). */
  private remember(signature: string, now: number): boolean {
    if (this.seen.has(signature) && this.seen.get(signature)! > now) return false;
    if (this.seen.size >= REPLAY_CACHE_MAX) {
      for (const [sig, until] of this.seen) if (until <= now) this.seen.delete(sig);
      if (this.seen.size >= REPLAY_CACHE_MAX) return false;
    }
    this.seen.set(signature, now + REPLAY_TTL_MS);
    return true;
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RawBodyRequest>();
    // Corps annoncé mais octets bruts absents : jamais signé « comme vide ».
    if (req.rawBody === undefined && hasBody(req)) throw new ProblemException('UNAUTHENTICATED');
    const now = Date.now();
    const ok = verifyCall({
      key: this.key,
      ts: req.headers[PIN_TS_HEADER],
      sig: req.headers[PIN_SIG_HEADER],
      method: req.method,
      path: req.originalUrl,
      // Sans corps analysé, rawBody est absent : corps vide, signé comme tel.
      body: req.rawBody ?? Buffer.alloc(0),
      now,
    });
    // Signature valide : acceptée une seule fois (même réponse qu'une signature fausse sinon).
    if (!ok || !this.remember(String(req.headers[PIN_SIG_HEADER]), now))
      throw new ProblemException('UNAUTHENTICATED');
    return true;
  }
}
