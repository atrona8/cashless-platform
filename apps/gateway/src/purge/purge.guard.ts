// Porte des terminaux après (ou pendant) une purge : `503` sans détail sur toute route, avant toute
// lecture de la base. Garde globale (`APP_GUARD`), fermée dès qu'un marqueur de purge existe.
import { HttpException, Inject, Injectable, type CanActivate } from '@nestjs/common';
import { PurgeGate } from './purge-marker';
import { PURGE_GATE } from './purge.service';

@Injectable()
export class PurgeGuard implements CanActivate {
  constructor(@Inject(PURGE_GATE) private readonly gate: PurgeGate) {}

  canActivate(): boolean {
    if (this.gate.engaged) throw new HttpException('', 503);
    return true;
  }
}
