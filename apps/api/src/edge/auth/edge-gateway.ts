// Identité de la passerelle appelante (lue en base par la garde `edgeMtls`, jamais dans la requête) et aides communes
// aux routes du processus `edge`.
import type { Request } from 'express';
import { ProblemException } from '../../errors/problem';

/** Ligne de `identify_edge_gateway` (interfaces.md § 2). */
export interface EdgeGateway {
  gatewayId: string;
  operatorId: string;
  eventId: string | null;
  ledgerId: string | null;
  role: 'PRIMARY' | 'STANDBY';
  status: string;
  lanUrl: string | null;
  /** SPKI DER de la clé de signature des lots (`edge_gateway.public_key`), lue en base avec la ligne. */
  publicKey: Buffer | null;
}

export type EdgeRequest = Request & { edgeGateway?: EdgeGateway };

/** Passerelle authentifiée de la requête. Une route marquée `@EdgeAuth()` en a toujours une. */
export function edgeGatewayOf(req: Request): EdgeGateway {
  const gateway = (req as EdgeRequest).edgeGateway;
  if (!gateway) throw new ProblemException('UNAUTHENTICATED');
  return gateway;
}

/**
 * Un identifiant de la route ou du corps qui désigne autre chose que la passerelle appelante est traité comme absent
 * (NFR-011) : `refuse()` fournit l'erreur neutre de la route (404 pour `getDebitAuthority`, 409
 * `HANDOVER_INVALID_STATE` pour un handover étranger, WP12). Un identifiant absent (`null`, `undefined`) n'est pas
 * comparé.
 */
export function assertOwnGateway(
  req: Request,
  claimed: { ledgerId?: string | null; gatewayId?: string | null },
  refuse: () => Error,
): void {
  const own = edgeGatewayOf(req);
  if (claimed.gatewayId != null && claimed.gatewayId.toLowerCase() !== own.gatewayId)
    throw refuse();
  if (
    claimed.ledgerId != null &&
    (own.ledgerId === null || claimed.ledgerId.toLowerCase() !== own.ledgerId)
  )
    throw refuse();
}
