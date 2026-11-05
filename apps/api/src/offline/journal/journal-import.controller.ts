// `POST /v1/devices/{device_id}/journal-imports` (`importDeviceJournal`) et `GET
// /v1/devices/{device_id}/journal-imports/{import_id}` (`getDeviceJournalImport`) ; mission 7, lot WP20, T084.
// La demande vérifie tout de suite (400) et crée l'import `PENDING` + la demande `DEVICE_JOURNAL_IMPORT` (`202`).
// Le corps est lu brut par `journal-body.ts` (limite propre à la route, texte source des numéros).
import { Controller, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { respondAccepted } from '../../approval/approval.service';
import {
  Idempotent,
  IdempotentTransaction,
  type IdempotentTx,
} from '../../idempotency/idempotent.decorator';
import { requireUuid } from '../../organization/platform/platform.dto';
import { TenantAccess } from '../../organization/tenant/tenant-access';
import type { JournalBodyRequest } from './journal-body';
import { JOURNAL_IMPORT_ROLES } from './journal-import.action';
import { JournalImportService } from './journal-import.service';

@Controller('devices')
export class JournalImportController {
  constructor(
    private readonly access: TenantAccess,
    private readonly imports: JournalImportService,
  ) {}

  @Post(':device_id/journal-imports')
  @HttpCode(202)
  @Idempotent({ scope: 'bo:' })
  async create(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('device_id') deviceId: string,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const actor = this.access.actor(req, JOURNAL_IMPORT_ROLES);
    const id = requireUuid(deviceId);
    const raw = req as JournalBodyRequest;
    const prepared = this.imports.prepare(
      Buffer.isBuffer(raw.rawBody) ? raw.rawBody : undefined,
      raw.journalBodyTooLarge === true,
    );
    const checked = await this.imports.check(
      (fn) => this.access.read(actor, fn),
      actor,
      id,
      prepared,
    );
    return tx.run(async (client) =>
      respondAccepted(
        res,
        await this.imports.request(
          client,
          { principal: actor.principal, audit: actor.audit },
          checked,
        ),
      ),
    );
  }

  @Get(':device_id/journal-imports/:import_id')
  get(
    @Req() req: Request,
    @Param('device_id') deviceId: string,
    @Param('import_id') importId: string,
  ) {
    const actor = this.access.actor(req, ['SUPERVISOR', 'ORGANIZER_ADMIN']);
    return this.access.read(actor, (client) =>
      this.imports.view(client, actor, requireUuid(deviceId), requireUuid(importId)),
    );
  }
}
