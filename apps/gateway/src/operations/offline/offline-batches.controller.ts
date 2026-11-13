// Routes de terminal des lots hors ligne et de la clé de bracelet (WP23) : submitOfflineBatch,
// getOfflineBatchResult, getMediaAuthKey. Chemins du contrat (serveur `https://edge.local:8443/v1`), mêmes
// formats et mêmes erreurs qu'au central. Aucune route ajoutée : chacune porte `@ServedOperation`.
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { GATEWAY_CLOCK, type GatewayClock } from '../../clock/gateway-clock';
import {
  DeviceProofs,
  DeviceProofsGuard,
  requestDevice,
  type DeviceRequest,
} from '../../device-proofs/device-proofs.guard';
import { ProblemException, ProblemFilter } from '../../device-proofs/problem';
import { ServedOperation } from '../../processes/served-operations';
import { MediaAuthKeyService } from './media-auth-key.service';
import { OfflineBatchesService } from './offline-batches.service';

@Controller('v1')
@UseFilters(ProblemFilter)
export class OfflineBatchesController {
  constructor(
    @Inject(OfflineBatchesService) private readonly batches: OfflineBatchesService,
    @Inject(MediaAuthKeyService) private readonly authKeys: MediaAuthKeyService,
    @Inject(GATEWAY_CLOCK) private readonly clock: GatewayClock,
  ) {}

  /** Le nonce est consommé par l'opération, dans SA transaction (`DeviceProofs({ nonce: 'operation' })`). */
  @Post('offline-batches')
  @HttpCode(200)
  @UseGuards(DeviceProofsGuard)
  @DeviceProofs({ nonce: 'operation' })
  @ServedOperation('submitOfflineBatch')
  async submit(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Headers('x-authority-epoch') epoch?: string,
    @Headers('x-device-serial') serial?: string,
  ) {
    const raw = (req as DeviceRequest).rawBody;
    res.setHeader('Date', this.clock.now().toUTCString());
    return this.batches.submit(requestDevice(req), {
      body,
      rawBodyLength: Buffer.isBuffer(raw) ? raw.length : 0,
      idempotencyKey,
      epochHeader: epoch,
      serialHeader: serial,
      path: '/v1/offline-batches',
    });
  }

  @Get('offline-batches/:batch_id')
  @UseGuards(DeviceProofsGuard)
  @DeviceProofs()
  @ServedOperation('getOfflineBatchResult')
  async result(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('batch_id') batchId: string,
  ) {
    res.setHeader('Date', this.clock.now().toUTCString());
    const found = await this.batches.result(requestDevice(req), batchId);
    if (found === null) throw new ProblemException('NOT_FOUND');
    if ('inProgress' in found) {
      res.status(202);
      return { batch_id: batchId.toLowerCase(), status: 'PROCESSING' };
    }
    return found;
  }

  @Post('media/auth-keys')
  @HttpCode(200)
  @UseGuards(DeviceProofsGuard)
  @DeviceProofs()
  @ServedOperation('getMediaAuthKey')
  async mediaAuthKey(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Date', this.clock.now().toUTCString());
    return this.authKeys.get(requestDevice(req), body);
  }
}
