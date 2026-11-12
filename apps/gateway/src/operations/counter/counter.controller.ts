// Routes de guichet servies par la passerelle (WP22) : `activateMedia`, `takeDeposit`,
// `createCashTopup`. Chemins et formats du contrat (`/v1`), aucune route ajoutée : chacune porte
// `@ServedOperation`. Trois preuves de terminal (nonce laissé à l'opération), puis jeton de
// personne (`StaffTokenGuard`, R-20).
import {
  Body,
  Controller,
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
import { DeviceProofs, DeviceProofsGuard } from '../../device-proofs/device-proofs.guard';
import { ProblemFilter } from '../../device-proofs/problem';
import { ServedOperation } from '../../processes/served-operations';
import { StaffTokenGuard } from '../../staff/staff-token.guard';
import { CashTopupService } from './cash-topup.service';
import { DepositService } from './deposit.service';
import { MediaActivationService } from './media-activation.service';

@Controller('v1')
@UseFilters(ProblemFilter)
export class CounterController {
  constructor(
    @Inject(CashTopupService) private readonly topups: CashTopupService,
    @Inject(MediaActivationService) private readonly activations: MediaActivationService,
    @Inject(DepositService) private readonly deposits: DepositService,
  ) {}

  @Post('topups/cash')
  @HttpCode(201)
  @UseGuards(DeviceProofsGuard, StaffTokenGuard)
  @DeviceProofs({ nonce: 'operation' })
  @ServedOperation('createCashTopup')
  createCashTopup(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ) {
    return this.topups.create(req, res, body);
  }

  @Post('media/activations')
  @HttpCode(201)
  @UseGuards(DeviceProofsGuard, StaffTokenGuard)
  @DeviceProofs({ nonce: 'operation' })
  @ServedOperation('activateMedia')
  activateMedia(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ) {
    return this.activations.activate(req, res, body);
  }

  @Post('media/:media_id/deposit')
  @HttpCode(200)
  @UseGuards(DeviceProofsGuard, StaffTokenGuard)
  @DeviceProofs({ nonce: 'operation' })
  @ServedOperation('takeDeposit')
  takeDeposit(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('media_id') mediaId: string,
    @Body() body: unknown,
  ) {
    return this.deposits.take(req, res, mediaId, body);
  }
}
