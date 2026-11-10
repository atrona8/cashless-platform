// `POST /__dev/psp-topups/{topup_id}/outcome` : route de DÉVELOPPEMENT, hors contrat, absente en production
// (voir psp-simulation.module.ts). Le festivalier titulaire du portefeuille simule le résultat du paiement.
import { Body, Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { CustomerAuth } from '../customer-identity/customer.guard';
import { ProblemException } from '../errors/problem';
import { PspSimulationService, type SimulatedOutcome } from './psp-simulation.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function outcomeOf(body: unknown): SimulatedOutcome {
  const value = (body as { outcome?: unknown } | null)?.outcome;
  if (value === 'SUCCEEDED' || value === 'FAILED') return value;
  throw new ProblemException('VALIDATION_FAILED', {
    status: 400,
    detail: 'outcome : SUCCEEDED ou FAILED attendu.',
  });
}

@Controller('__dev/psp-topups')
export class PspSimulationController {
  constructor(private readonly simulation: PspSimulationService) {}

  @Post(':topup_id/outcome')
  @HttpCode(200)
  @CustomerAuth()
  simulate(@Req() req: Request, @Param('topup_id') topupId: string, @Body() body: unknown) {
    const outcome = outcomeOf(body);
    if (!UUID.test(topupId)) throw new ProblemException('NOT_FOUND');
    return this.simulation.simulate(req, topupId, outcome);
  }
}
