// Garde de `classifyAnomaly` : rôle (403) et portée de l'anomalie (404, identique à une anomalie inexistante ou d'un
// autre prestataire) AVANT l'intercepteur d'idempotence. Une personne qui n'a pas le droit n'atteint donc ni la
// vérification de la clé, ni sa réservation. Le service refait le même contrôle dans la transaction du classement
// (la garde n'est pas la seule défense : elle ne verrouille rien).
import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { TenantTx } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';
import { requireAnomalyId } from './anomalies.dto';
import { AnomaliesService } from './anomalies.service';

@Injectable()
export class AnomalyScopeGuard implements CanActivate {
  constructor(
    private readonly anomalies: AnomaliesService,
    private readonly tenantTx: TenantTx,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const visibility = this.anomalies.visibility(req);
    const id = requireAnomalyId(String(req.params.anomaly_id));
    const found = await this.tenantTx.run(visibility.operatorId, (client) =>
      this.anomalies.find(client, visibility, id),
    );
    if (!found) throw new ProblemException('NOT_FOUND');
    return true;
  }
}
