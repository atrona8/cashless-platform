// `POST /v1/edge/sync-batches` (`submitEdgeSyncBatch`, garde `edgeMtls`, rôle de base
// `cashless_edge`). Le corps est lu
// brut par `edge-sync-body.ts` (limite propre à la route, 1 Mio). Réponse `200`
// `OfflineBatchResult` ; un lot rejoué
// à l'identique répond les mêmes résultats (`Idempotency-Replayed: true`).
import { Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { OfflineBatchResult } from '../../offline/batches/batch.types';
import { EdgeAuth } from '../auth/edge-mtls.guard';
import { edgeGatewayOf } from '../auth/edge-gateway';
import type { EdgeSyncBodyRequest } from './edge-sync-body';
import { EdgeSyncService } from './edge-sync.service';

@Controller('edge/sync-batches')
export class EdgeSyncController {
  constructor(private readonly sync: EdgeSyncService) {}

  @Post()
  @HttpCode(200)
  @EdgeAuth()
  async submit(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OfflineBatchResult> {
    const raw = req as EdgeSyncBodyRequest;
    const outcome = await this.sync.submit(edgeGatewayOf(req), {
      rawBody: Buffer.isBuffer(raw.edgeSyncRaw) ? raw.edgeSyncRaw : undefined,
      tooLarge: raw.edgeSyncTooLarge === true,
      idempotencyKey: req.header('Idempotency-Key'),
    });
    if (outcome.replayed) res.setHeader('Idempotency-Replayed', 'true');
    return outcome.body;
  }
}
