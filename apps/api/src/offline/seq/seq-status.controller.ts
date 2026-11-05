// `GET /v1/device/seq-status` (`getDeviceSeqStatus`, mission 7, lot WP21, partie D ; sync_protocol.md §6) :
// l'état des séquences du terminal vu par le serveur, pour la reprise après coupure. Lecture seule : la ligne
// `device` (colonnes déjà lisibles par `cashless_app`) et `device_missing_seqs` (fonction existante, qui contrôle
// elle-même le prestataire). L'identité du terminal vient du jeton, jamais d'un paramètre : un terminal ne lit que
// ses propres numéros. `allowSuspended` : un terminal suspendu doit pouvoir reprendre sa synchronisation (comme
// les lots).
import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import { TenantTx } from '../../db/tenant-tx';
import { DeviceAuth } from '../../device-identity/device.guard';
import { requestDevice } from '../../device-identity/device-identity.port';
import { notFound } from '../../organization/platform/platform.dto';

export interface SeqStatusDto {
  device_serial: string;
  contiguous_acked_seq: number;
  max_seen_seq: number;
  missing_seqs: number[];
  next_seq_floor: number;
}

/** Les numéros restent sous 2^53 - 1 (contrainte du contrat) ; au-delà, on refuse de mentir. */
function exact(value: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error('numéro de séquence hors des entiers sûrs');
  return n;
}

@Controller('device')
export class SeqStatusController {
  constructor(private readonly tx: TenantTx) {}

  @Get('seq-status')
  @DeviceAuth({ allowSuspended: true })
  async status(@Req() req: Request): Promise<SeqStatusDto> {
    const device = requestDevice(req);
    return this.tx.run(device.operatorId, async (client) => {
      const { rows } = await client.query<{
        serial: string;
        contiguous_acked_seq: string;
        last_seq: string;
        next_seq_floor: string;
      }>(
        'SELECT serial, contiguous_acked_seq, last_seq, next_seq_floor FROM device WHERE id = $1',
        [device.deviceId],
      );
      const row = rows[0];
      if (!row) throw notFound();
      const missing = await client.query<{ seq: string }>(
        'SELECT device_missing_seqs AS seq FROM device_missing_seqs($1, 1000)',
        [device.deviceId],
      );
      return {
        device_serial: row.serial,
        contiguous_acked_seq: exact(row.contiguous_acked_seq),
        max_seen_seq: exact(row.last_seq),
        missing_seqs: missing.rows.map((r) => exact(r.seq)),
        next_seq_floor: exact(row.next_seq_floor),
      };
    });
  }
}
