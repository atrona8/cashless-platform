// `POST /v1/device/heartbeat` (openapi.yaml : postDeviceHeartbeat ; contracts/device-lifecycle.md ;
// FR-019) : route de terminal permise à un terminal suspendu (R-14). Dans une même transaction :
// `record_device_heartbeat` (dernière présence, version de l'app ; statut relu FOR UPDATE, révoqué
// refusé), puis la configuration courante pour son ETag et l'autorité de débit. Aucun numéro de
// séquence consommé. `latest_snapshot_version` : `null` (aucun snapshot avant la mission des
// snapshots) ; `sync_requested` : faux (aucun lot hors ligne avant la mission 7).
import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { components } from '@cashless/contracts';
import type { Request } from 'express';
import { TenantTx } from '../../db/tenant-tx';
import { DeviceAuth } from '../../device-identity/device.guard';
import { requestDevice } from '../../device-identity/device-identity.port';
import { pickLanguage } from '../../http/language';
import { DeviceConfigService } from '../config/device-config.service';
import { parseHeartbeat } from './heartbeat.dto';

type HeartbeatResponse = components['schemas']['HeartbeatResponse'];

@Controller('device/heartbeat')
export class HeartbeatController {
  constructor(
    private readonly tx: TenantTx,
    private readonly configs: DeviceConfigService,
  ) {}

  @Post()
  @HttpCode(200)
  @DeviceAuth({ allowSuspended: true })
  beat(@Req() req: Request, @Body() body: unknown): Promise<HeartbeatResponse> {
    const device = requestDevice(req);
    const input = parseHeartbeat(body);
    // Même langue que `GET /device/config` : l'ETag couvre le catalogue servi, donc sa langue.
    const language = pickLanguage(req.header('Accept-Language'));
    return this.tx.run(device.operatorId, async (client) => {
      await client.query('SELECT record_device_heartbeat($1, $2, $3)', [
        device.deviceId,
        input.appVersion,
        input.deviceTime,
      ]);
      const served = await this.configs.build(client, device, language);
      return {
        server_time: served.body.server_time,
        config_etag: served.etag,
        latest_snapshot_version: null,
        debit_authority: served.body.debit_authority,
        sync_requested: false,
      };
    });
  }
}
