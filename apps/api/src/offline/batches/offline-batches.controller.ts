// `POST /v1/offline-batches` (`submitOfflineBatch`) et `GET /v1/offline-batches/{batch_id}` (`getOfflineBatchResult`),
// mission 7, lot WP18. Route de terminal permise à un terminal suspendu (ses lots restent traités ; un terminal
// révoqué est refusé par la garde, `403 DEVICE_REVOKED`). PAS de `@Idempotent` : le rejeu se lit dans l'état du lot
// (R-10, R-11), pas dans la table d'idempotence. Le corps est lu brut par `batch-body.ts` (limite propre à la route).
import { Controller, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { auditContext } from '../../audit/audit-context';
import { DeviceAuth } from '../../device-identity/device.guard';
import { requestDevice } from '../../device-identity/device-identity.port';
import { ProblemException } from '../../errors/problem';
import type { BatchBodyRequest } from './batch-body';
import type { OfflineBatchResult } from './batch.types';
import { OfflineBatchesService } from './offline-batches.service';

@Controller('offline-batches')
export class OfflineBatchesController {
  constructor(private readonly batches: OfflineBatchesService) {}

  @Post()
  @HttpCode(200)
  @DeviceAuth({ allowSuspended: true })
  async submit(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OfflineBatchResult> {
    const raw = req as BatchBodyRequest;
    const outcome = await this.batches.submit({
      device: requestDevice(req),
      rawBody: Buffer.isBuffer(raw.rawBody) ? raw.rawBody : undefined,
      tooLarge: raw.batchBodyTooLarge === true,
      idempotencyKey: req.header('Idempotency-Key'),
      epochHeader: req.header('X-Authority-Epoch'),
      audit: auditContext(req),
    });
    if (outcome.replayed) res.setHeader('Idempotency-Replayed', 'true');
    return outcome.body;
  }

  @Get(':batch_id')
  @DeviceAuth({ allowSuspended: true })
  async result(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('batch_id') batchId: string,
  ): Promise<OfflineBatchResult | Record<string, never>> {
    const outcome = await this.batches.read(requestDevice(req), batchId);
    if (outcome.kind === 'UNKNOWN') throw new ProblemException('NOT_FOUND');
    if (outcome.kind === 'PROCESSING') {
      res.status(202).setHeader('Retry-After', '2');
      return {};
    }
    return outcome.body;
  }
}
