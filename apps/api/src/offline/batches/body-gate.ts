// Filtre d'identité AVANT la lecture d'un gros corps (mission 7, lot WP20, cycle 2 ; décision du porteur du
// 03/11/2026). `POST /offline-batches` (4 Mio) et `POST /devices/{id}/journal-imports` (21 Mio) lisent leur corps
// avant les gardes de Nest (le corps brut sert au `Content-Digest` et au texte source des numéros) : sans filtre,
// un inconnu faisait lire jusqu'à 21 Mio. Le filtre vérifie d'abord l'identité (jeton du terminal, étapes 1 à 4 de
// la garde des terminaux ; jeton de la personne et rôle `SUPERVISOR` pour l'import). Échec : le corps n'est PAS lu
// (aucun écouteur `data`), `content-type` est retiré pour que l'analyseur global ne le lise pas non plus, et la
// requête poursuit : la garde habituelle répond 401 (ou le contrôleur 403). Le filtre n'accorde rien : les gardes
// refont tous les contrôles. Un filtre indisponible (erreur) refuse la lecture (fermé).
import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import {
  DEVICE_IDENTITY,
  type DeviceIdentityPort,
} from '../../device-identity/device-identity.port';
import { AuthenticationGuard } from '../../identity/authentication.guard';
import type { Role } from '../../identity/principal';

/** Vrai si le corps peut être lu. */
export type BodyGate = (req: Request) => Promise<boolean>;

/** Enveloppe `read` : le corps n'est lu que si `gate` l'admet ; sans `gate`, comportement d'avant. */
export function gatedBody(
  read: RequestHandler,
  matches: (req: Request) => boolean,
  gate: BodyGate | undefined,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!gate || !matches(req)) {
      read(req, res, next);
      return;
    }
    gate(req).then(
      (ok) => {
        if (ok) read(req, res, next);
        else skipBody(req, next);
      },
      () => skipBody(req, next),
    );
  };
}

/** Corps non lu : rien n'est attaché au flux, et l'analyseur global (qui lit `content-type`) est écarté. */
function skipBody(req: Request, next: NextFunction): void {
  req.body = {};
  delete req.headers['content-type'];
  next();
}

function provider<T>(app: INestApplication, token: unknown): T | undefined {
  try {
    return app.get<T>(token as never, { strict: false });
  } catch {
    return undefined;
  }
}

/** Filtre des terminaux (`POST /offline-batches`) ; `undefined` si l'identité en place ne sait pas filtrer. */
export function deviceBodyGate(app: INestApplication): BodyGate | undefined {
  const identity = provider<DeviceIdentityPort>(app, DEVICE_IDENTITY);
  return identity?.preAuthenticate ? (req) => identity.preAuthenticate!(req) : undefined;
}

/** Filtre des personnes : jeton valide, personne ACTIVE, l'un des `roles` quelque part. */
export function staffBodyGate(app: INestApplication, roles: readonly Role[]): BodyGate | undefined {
  const guard = provider<AuthenticationGuard>(app, AuthenticationGuard);
  return typeof guard?.preAuthenticate === 'function'
    ? (req) => guard.preAuthenticate(req, roles)
    : undefined;
}
