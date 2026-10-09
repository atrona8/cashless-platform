// Contexte d'audit d'une requête (FR-008) : acteur (personne authentifiée), rôle exercé (posé par RolesGuard),
// origine et identifiant de requête (X-Request-Id).
//
// Origine : le terminal s'il est connu (`principal.deviceId`, missions des terminaux), sinon l'adresse IP du client
// (`req.ip`). Derrière un répartiteur de charge, `req.ip` n'est l'adresse du client que si Express est réglé en
// conséquence (`app.set('trust proxy', …)` au démarrage) ; sans ce réglage, c'est l'adresse du répartiteur.
import type { Request } from 'express';
import { requestIdOf } from '../http/request-id.middleware';
import type { RolesRequest } from '../identity/roles.guard';
import type { AuditContext } from './audit.service';

export function auditContext(req: Request): AuditContext {
  const { principal, exercisedRole } = req as RolesRequest;
  const deviceId = (principal as { deviceId?: string } | undefined)?.deviceId;
  return {
    actorId: principal?.userId ?? null,
    actorRole: exercisedRole ?? null,
    origin: deviceId ? `device:${deviceId}` : (req.ip ?? null),
    requestId: requestIdOf(req) || null,
  };
}
