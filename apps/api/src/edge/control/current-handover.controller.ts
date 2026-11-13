// `GET /edge/handovers/current?wait=<0..25>` (getCurrentEdgeHandover, garde `edgeMtls`). 200 avec
// `DebitAuthorityState`, `handover: null` si rien d'ouvert (pas de 204). `wait` : entier de 0 à 25, sinon
// `VALIDATION_FAILED` (422).
import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ProblemException } from '../../errors/problem';
import { EdgeAuth } from '../auth/edge-mtls.guard';
import { clientGoneSignal } from '../auth/client-gone';
import { edgeGatewayOf } from '../auth/edge-gateway';
import type { DebitAuthorityState } from './debit-authority-reader';
import { CurrentHandoverService } from './current-handover.service';

export function parseWait(raw: unknown): number {
  if (raw === undefined || raw === '') return 0;
  if (typeof raw !== 'string' || !/^[0-9]{1,2}$/.test(raw) || Number(raw) > 25)
    throw new ProblemException('VALIDATION_FAILED', {
      status: 422,
      detail: 'wait : entier de 0 à 25 attendu.',
    });
  return Number(raw);
}

@Controller('edge/handovers')
export class CurrentHandoverController {
  constructor(private readonly service: CurrentHandoverService) {}

  @Get('current')
  @EdgeAuth()
  async current(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Query('wait') wait?: unknown,
  ): Promise<DebitAuthorityState> {
    const seconds = parseWait(wait);
    const gateway = edgeGatewayOf(req);
    // Signal posé par la garde dès l'entrée ; état de la socket retesté ici, à l'armement.
    const signal = clientGoneSignal(req, res);
    return this.service.current(gateway, seconds, signal);
  }
}
