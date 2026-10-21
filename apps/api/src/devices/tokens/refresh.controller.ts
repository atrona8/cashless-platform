// `POST /v1/device-tokens/refresh` (openapi.yaml : refreshDeviceToken ;
// contracts/device-tokens.md).
// Ni compte ni jeton d'appareil (il peut être expiré) : `@Public()` écarte la garde des personnes,
// et le service exige lui-même le certificat client de la connexion (mTLS, renforcement R-07) et
// la preuve de possession du corps. Aucune clé d'idempotence : l'échange est à usage unique.
import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../../identity/public.decorator';
import { parseRefresh } from './refresh.dto';
import { DeviceTokenRefreshService } from './refresh.service';

@Controller('device-tokens')
export class DeviceTokenRefreshController {
  constructor(private readonly refreshes: DeviceTokenRefreshService) {}

  @Post('refresh')
  @HttpCode(200)
  @Public()
  refresh(@Req() req: Request, @Body() body: unknown) {
    return this.refreshes.refresh(req, parseRefresh(body));
  }
}
