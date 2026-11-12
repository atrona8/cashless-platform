// Garde `edgeMtls` des routes du processus `edge` (research R-04, edge-routes.md). Un seul échec = `401
// UNAUTHENTICATED`, sans dire lequel des contrôles a échoué (NFR-011) ; aucun `403`. Pose `req.edgeGateway`. La garde
// n'écrit rien : `touch_edge_gateway` est appelé par `getCurrentEdgeHandover` seulement. Une passerelle `STANDBY`
// passe (elle surveille) ; les routes qui l'excluent le font elles-mêmes.
// `@EdgeAuth()` marque la route (`IS_PUBLIC` pour la garde globale qui refuse toute route non marquée) puis pose cette
// garde, sur le modèle de `@DeviceAuth()`. Un certificat de terminal n'arrive jamais ici : la chaîne TLS de
// l'écouteur `edge` ne connaît que l'autorité des passerelles.
import {
  applyDecorators,
  Injectable,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ProblemException } from '../../errors/problem';
import { Public } from '../../identity/public.decorator';
import { trackClientGone } from './client-gone';
import type { EdgeRequest } from './edge-gateway';
import { EdgeIdentityService } from './edge-identity.service';

@Injectable()
export class EdgeMtlsGuard implements CanActivate {
  constructor(private readonly identity: EdgeIdentityService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<EdgeRequest>();
    // Avant tout SQL : un client qui coupe pendant la garde doit arrêter l'attente de la route.
    trackClientGone(req as Request, http.getResponse<Response>());
    // Jamais lu de la requête : ni `X-Gateway-Id`, ni identifiant du corps ou de la route.
    const gateway = await this.identity.identify(req);
    if (!gateway) throw new ProblemException('UNAUTHENTICATED');
    req.edgeGateway = gateway;
    return true;
  }
}

/** Route appelée par une passerelle : certificat de l'autorité des passerelles obligatoire. */
export const EdgeAuth = (): MethodDecorator & ClassDecorator =>
  applyDecorators(Public(), UseGuards(EdgeMtlsGuard));
