// `GET /v1/device/config` (openapi.yaml : getDeviceConfig ; contracts/device-lifecycle.md) :
// route de terminal permise à un terminal suspendu (R-14). `ETag` = empreinte du contenu servi ;
// `If-None-Match` égal → `304` sans corps. Langue du catalogue servi : `Accept-Language` (fr par
// défaut).
import { Controller, Get, Headers, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { TenantTx } from '../../db/tenant-tx';
import { DeviceAuth } from '../../device-identity/device.guard';
import { requestDevice } from '../../device-identity/device-identity.port';
import { pickLanguage } from '../../http/language';
import { DeviceConfigService, etagMatches } from './device-config.service';

@Controller('device/config')
export class DeviceConfigController {
  constructor(
    private readonly tx: TenantTx,
    private readonly configs: DeviceConfigService,
  ) {}

  @Get()
  @DeviceAuth({ allowSuspended: true })
  async get(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Headers('if-none-match') ifNoneMatch?: string,
  ) {
    const device = requestDevice(req);
    const language = pickLanguage(req.header('Accept-Language'));
    const served = await this.tx.run(device.operatorId, (client) =>
      this.configs.build(client, device, language, true),
    );
    res.setHeader('ETag', served.etag);
    if (etagMatches(ifNoneMatch, served.etag)) {
      res.status(304);
      return undefined;
    }
    return served.body;
  }
}
