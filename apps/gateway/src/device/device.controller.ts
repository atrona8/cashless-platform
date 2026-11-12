// Routes de terminal servies par la passerelle dans ce lot (WP19) : refreshDeviceToken,
// getDeviceConfig, postDeviceHeartbeat, getDeviceSeqStatus. Chemins du contrat (serveur
// `https://edge.local:8443/v1`), mêmes formats et mêmes erreurs qu'au central. Aucune route
// ajoutée : chacune porte `@ServedOperation` (liste blanche des 16).
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { GATEWAY_CLOCK, type GatewayClock } from '../clock/gateway-clock';
import { GatewayTx } from '../db/gateway-tx';
import {
  DeviceProofs,
  DeviceProofsGuard,
  requestDevice,
} from '../device-proofs/device-proofs.guard';
import { ProblemFilter } from '../device-proofs/problem';
import { ServedOperation } from '../processes/served-operations';
import { DeviceConfigService, etagMatches, pickLanguage } from './device-config.service';
import { parseHeartbeat, parseRefresh } from './dto';
import { DeviceRefreshService } from './refresh.service';

@Controller('v1')
@UseFilters(ProblemFilter)
export class DeviceController {
  constructor(
    @Inject(GatewayTx) private readonly gatewayTx: GatewayTx,
    @Inject(DeviceConfigService) private readonly configs: DeviceConfigService,
    @Inject(DeviceRefreshService) private readonly refreshes: DeviceRefreshService,
    @Inject(GATEWAY_CLOCK) private readonly clock: GatewayClock,
  ) {}

  /** Preuves : `deviceMtls` et preuve de possession seulement (le jeton peut être expiré). */
  @Post('device-tokens/refresh')
  @HttpCode(200)
  @ServedOperation('refreshDeviceToken')
  refresh(@Req() req: Request, @Body() body: unknown) {
    return this.refreshes.refresh(req, parseRefresh(body));
  }

  @Get('device/config')
  @UseGuards(DeviceProofsGuard)
  @DeviceProofs({ allowSuspended: true })
  @ServedOperation('getDeviceConfig')
  async config(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Headers('if-none-match') ifNoneMatch?: string,
  ) {
    const device = requestDevice(req);
    const served = await this.gatewayTx.run((tx) =>
      this.configs.build(tx, device, pickLanguage(req.header('Accept-Language'))),
    );
    res.setHeader('ETag', served.etag);
    res.setHeader('Date', this.clock.now().toUTCString());
    if (etagMatches(ifNoneMatch, served.etag)) {
      res.status(304);
      return undefined;
    }
    return served.body;
  }

  @Post('device/heartbeat')
  @HttpCode(200)
  @UseGuards(DeviceProofsGuard)
  @DeviceProofs({ allowSuspended: true })
  @ServedOperation('postDeviceHeartbeat')
  async heartbeat(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: unknown) {
    const device = requestDevice(req);
    const input = parseHeartbeat(body);
    res.setHeader('Date', this.clock.now().toUTCString());
    return this.gatewayTx.run(async (tx) => {
      await tx.query(
        `UPDATE edge_device SET last_heartbeat_at = $2, app_version = $3,
                reported_snapshot_version = $4, reported_local_seq = $5, pending_operations = $6
          WHERE device_id = $1`,
        [
          device.deviceId,
          this.clock.now(),
          input.appVersion,
          input.snapshotVersion,
          input.lastLocalSeq,
          input.pendingOperations,
        ],
      );
      const served = await this.configs.build(tx, device, pickLanguage(req.header('Accept-Language')));
      const state = await this.configs.heartbeatState(tx, device.deviceId);
      return {
        server_time: served.body.server_time,
        config_etag: served.etag,
        latest_snapshot_version: state.latestSnapshotVersion,
        debit_authority: served.body.debit_authority,
        sync_requested: state.syncRequested,
      };
    });
  }

  /** Servie à un terminal `SUSPENDED` ; `403 DEVICE_REVOKED` sinon (garde). Jamais un accusé local. */
  @Get('device/seq-status')
  @UseGuards(DeviceProofsGuard)
  @DeviceProofs({ allowSuspended: true })
  @ServedOperation('getDeviceSeqStatus')
  async seqStatus(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const device = requestDevice(req);
    res.setHeader('Date', this.clock.now().toUTCString());
    return this.gatewayTx.run((tx) => this.configs.seqStatus(tx, device));
  }
}
