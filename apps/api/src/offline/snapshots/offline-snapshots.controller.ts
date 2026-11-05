// `GET /v1/offline-snapshots/current` et `POST /v1/offline-snapshots/ack` (openapi.yaml :
// getOfflineSnapshot, ackOfflineSnapshot ; contracts/snapshots.md). `@DeviceAuth()` sans option : un
// terminal suspendu est refusé (`403 DEVICE_SUSPENDED`, avant tout `304`) ; ses lots restent traités
// ailleurs. L'identité du terminal vient du jeton, jamais d'un paramètre.
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { Body, Controller, Get, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { TenantTx } from '../../db/tenant-tx';
import { DeviceAuth } from '../../device-identity/device.guard';
import { requestDevice } from '../../device-identity/device-identity.port';
import { etagMatches } from '../../devices/config/device-config.service';
import { parseAck, parseSinceVersion } from './offline-snapshots.dto';
import { OfflineSnapshotsService } from './offline-snapshots.service';

const gzipAsync = promisify(gzip);

@Controller('offline-snapshots')
export class OfflineSnapshotsController {
  constructor(
    private readonly tx: TenantTx,
    private readonly snapshots: OfflineSnapshotsService,
  ) {}

  @Get('current')
  @DeviceAuth()
  async current(
    @Req() req: Request,
    @Res() res: Response,
    @Query('since_version') sinceVersion?: unknown,
  ): Promise<void> {
    const device = requestDevice(req);
    const since = parseSinceVersion(sinceVersion);
    const served = await this.tx.run(device.operatorId, (client) =>
      this.snapshots.get(client, device, since),
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Snapshot-Latest', served.latestVersion);
    // ETag posé AVANT le 304.
    res.setHeader('ETag', served.etag);
    if (etagMatches(req.header('If-None-Match'), served.etag)) {
      res.status(304).end();
      return;
    }
    const json = Buffer.from(JSON.stringify(served.body), 'utf8');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Vary', 'Accept-Encoding');
    // La signature porte sur l'en-tête, pas sur les octets de transport : la compression n'y touche pas.
    if (/\bgzip\b/i.test(req.header('Accept-Encoding') ?? '')) {
      const packed = await gzipAsync(json);
      res.setHeader('Content-Encoding', 'gzip');
      res.status(200).end(packed);
      return;
    }
    res.status(200).end(json);
  }

  @Post('ack')
  @HttpCode(204)
  @DeviceAuth()
  async ack(@Req() req: Request, @Body() body: unknown): Promise<void> {
    const device = requestDevice(req);
    const input = parseAck(body);
    await this.tx.run(device.operatorId, (client) => this.snapshots.ack(client, device, input));
  }
}
