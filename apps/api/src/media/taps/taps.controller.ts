// `POST /taps` (contrat `createTap`) : route de terminal de l'API publique. Le résultat de la base est rendu tel quel,
// en 200 : un bracelet refusé est une information pour le terminal, pas une erreur HTTP.
import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { DeviceAuth } from '../../device-identity/device.guard';
import { requestDevice } from '../../device-identity/device-identity.port';
import { TapService } from './tap.service';
import { parseTap } from './taps.dto';

@Controller('taps')
export class TapsController {
  constructor(private readonly taps: TapService) {}

  @Post()
  @HttpCode(200)
  @DeviceAuth()
  create(@Req() req: Request, @Body() body: unknown) {
    return this.taps.register(requestDevice(req), parseTap(body));
  }
}
