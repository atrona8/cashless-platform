// Routes de vente servies par la passerelle (WP21) : createTap, createPayment, getPayment,
// reversePayment. Chemins, formats et erreurs du contrat (serveur `https://edge.local:8443/v1`).
// Aucune route ajoutée : chacune porte `@ServedOperation` (liste blanche des 16). Les écritures
// laissent la consommation du nonce à leur transaction (`nonce: 'operation'`).
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
} from '../../device-proofs/device-proofs.guard';
import { ProblemFilter } from '../../device-proofs/problem';
import { pickLanguage } from '../../device/device-config.service';
import { ServedOperation } from '../../processes/served-operations';
import { PaymentsService, type SaleResponse } from './payments.service';
import { ReversalsService } from './reversals.service';
import { TapsService } from './taps.service';

@Controller('v1')
@UseFilters(ProblemFilter)
export class SalesController {
  constructor(
    @Inject(TapsService) private readonly taps: TapsService,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(ReversalsService) private readonly reversals: ReversalsService,
    @Inject(GATEWAY_CLOCK) private readonly clock: GatewayClock,
  ) {}

  private reply(res: Response, result: SaleResponse): Record<string, unknown> {
    res.status(result.status);
    if (result.replayed) res.setHeader('Idempotency-Replayed', 'true');
    return result.body;
  }

  @Post('taps')
  @HttpCode(200)
  @UseGuards(DeviceProofsGuard)
  @DeviceProofs({ nonce: 'operation' })
  @ServedOperation('createTap')
  async createTap(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ) {
    res.setHeader('Date', this.clock.now().toUTCString());
    return this.taps.createTap(requestDevice(req), body);
  }

  @Post('payments')
  @HttpCode(201)
  @UseGuards(DeviceProofsGuard)
  @DeviceProofs({ nonce: 'operation' })
  @ServedOperation('createPayment')
  async createPayment(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Headers('x-authority-epoch') authorityEpoch?: string,
  ) {
    res.setHeader('Date', this.clock.now().toUTCString());
    const result = await this.payments.create(requestDevice(req), {
      body,
      idempotencyKey,
      authorityEpoch,
      language: pickLanguage(req.header('Accept-Language')),
    });
    return this.reply(res, result);
  }

  @Get('payments/:transaction_id')
  @UseGuards(DeviceProofsGuard)
  @DeviceProofs()
  @ServedOperation('getPayment')
  async getPayment(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('transaction_id') transactionId: string,
  ) {
    res.setHeader('Date', this.clock.now().toUTCString());
    return this.payments.get(requestDevice(req), transactionId);
  }

  @Post('payments/:transaction_id/reversal')
  @HttpCode(201)
  @UseGuards(DeviceProofsGuard)
  @DeviceProofs({ nonce: 'operation' })
  @ServedOperation('reversePayment')
  async reversePayment(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('transaction_id') transactionId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Headers('x-authority-epoch') authorityEpoch?: string,
    @Headers('x-approval-token') approvalToken?: string,
  ) {
    res.setHeader('Date', this.clock.now().toUTCString());
    const result = await this.reversals.reverse(requestDevice(req), {
      transactionId,
      body,
      idempotencyKey,
      authorityEpoch,
      approvalToken,
    });
    return this.reply(res, result);
  }
}
