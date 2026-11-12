// Routes de terminal des snapshots (WP23) : getOfflineSnapshot, ackOfflineSnapshot. Mêmes chemins, mêmes
// formats et mêmes erreurs qu'au central (`snapshots.md`). `DeviceProofs` sans option : un terminal suspendu
// reçoit `403 DEVICE_SUSPENDED` avant tout `304`.
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Post,
  Query,
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
import { ProblemException, ProblemFilter } from '../device-proofs/problem';
import { etagMatches } from '../device/device-config.service';
import { ServedOperation } from '../processes/served-operations';
import { SnapshotsService } from './snapshots.service';

const gzipAsync = promisify(gzip);
const HEX32 = /^[0-9a-fA-F]{64}$/;

@Controller('v1')
@UseFilters(ProblemFilter)
export class SnapshotsController {
  constructor(
    @Inject(GatewayTx) private readonly gatewayTx: GatewayTx,
    @Inject(SnapshotsService) private readonly snapshots: SnapshotsService,
    @Inject(GATEWAY_CLOCK) private readonly clock: GatewayClock,
  ) {}

  @Get('offline-snapshots/current')
  @UseGuards(DeviceProofsGuard)
  @DeviceProofs()
  @ServedOperation('getOfflineSnapshot')
  async current(
    @Req() req: Request,
    @Res() res: Response,
    @Query('since_version') sinceVersion?: unknown,
    @Headers('if-none-match') ifNoneMatch?: string,
  ): Promise<void> {
    const device = requestDevice(req);
    let since: number | null = null;
    if (sinceVersion !== undefined) {
      if (typeof sinceVersion !== 'string' || !/^\d{1,15}$/.test(sinceVersion))
        throw new ProblemException('VALIDATION_FAILED', { status: 400 });
      since = Number(sinceVersion);
    }
    const served = await this.gatewayTx.run((tx) => this.snapshots.get(tx, device, since));
    res.setHeader('Date', this.clock.now().toUTCString());
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Snapshot-Latest', String(served.latestVersion));
    res.setHeader('ETag', served.etag);
    if (etagMatches(ifNoneMatch, served.etag)) {
      res.status(304).end();
      return;
    }
    const json = Buffer.from(JSON.stringify(served.body), 'utf8');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Vary', 'Accept-Encoding');
    if (/\bgzip\b/i.test(req.header('Accept-Encoding') ?? '')) {
      res.setHeader('Content-Encoding', 'gzip');
      res.status(200).end(await gzipAsync(json));
      return;
    }
    res.status(200).end(json);
  }

  @Post('offline-snapshots/ack')
  @HttpCode(204)
  @UseGuards(DeviceProofsGuard)
  @DeviceProofs()
  @ServedOperation('ackOfflineSnapshot')
  async ack(@Req() req: Request, @Body() body: unknown): Promise<void> {
    const device = requestDevice(req);
    const o =
      typeof body === 'object' && body !== null && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : null;
    if (
      !o ||
      Object.keys(o).some((k) => k !== 'version' && k !== 'content_sha256') ||
      typeof o.version !== 'number' ||
      !Number.isSafeInteger(o.version) ||
      o.version < 1 ||
      typeof o.content_sha256 !== 'string' ||
      !HEX32.test(o.content_sha256)
    )
      throw new ProblemException('VALIDATION_FAILED', { status: 400 });
    const input = { version: o.version, contentSha256: Buffer.from(o.content_sha256, 'hex') };
    await this.gatewayTx.run((tx) => this.snapshots.ack(tx, device, input));
  }
}
