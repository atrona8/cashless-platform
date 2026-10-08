// Santé (hors contrat OpenAPI, noté dans docs/07) : 200 si la base répond, sinon 503 SERVICE_UNAVAILABLE.
import { Controller, Get, Module } from '@nestjs/common';
import { TenantTx } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';

@Controller('health')
export class HealthController {
  constructor(private readonly tx: TenantTx) {}

  @Get()
  async health(): Promise<{ status: 'ok'; db: 'ok' }> {
    try {
      await this.tx.ping();
    } catch {
      throw new ProblemException('SERVICE_UNAVAILABLE');
    }
    return { status: 'ok', db: 'ok' };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
