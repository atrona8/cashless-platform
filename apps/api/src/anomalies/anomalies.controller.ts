// `GET /anomalies` (`listAnomalies`) et `POST /anomalies/{anomaly_id}/classification` (`classifyAnomaly`),
// mission 11b WP07. Rôles : OPERATOR_ADMIN, ORGANIZER_ADMIN (contrôlés par le service, qui connaît la portée).
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  Idempotent,
  IdempotentTransaction,
  type IdempotentTx,
} from '../idempotency/idempotent.decorator';
import { parseClassification, parseListQuery, requireAnomalyId } from './anomalies.dto';
import { AnomaliesService } from './anomalies.service';
import { AnomalyScopeGuard } from './anomaly-scope.guard';

@Controller('anomalies')
export class AnomaliesController {
  constructor(private readonly anomalies: AnomaliesService) {}

  @Get()
  list(@Req() req: Request, @Query() query: Record<string, unknown>) {
    return this.anomalies.list(req, parseListQuery(query));
  }

  @Post(':anomaly_id/classification')
  @HttpCode(200)
  @UseGuards(AnomalyScopeGuard) // rôle et portée avant la clé d'idempotence (voir la garde)
  @Idempotent({ scope: 'bo:' })
  classify(
    @Req() req: Request,
    @Param('anomaly_id') anomalyId: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const input = parseClassification(body);
    const id = requireAnomalyId(anomalyId);
    return tx.run((client) => this.anomalies.classify(req, client, id, input.reason));
  }
}
