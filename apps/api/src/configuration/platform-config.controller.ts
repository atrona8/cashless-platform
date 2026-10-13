// Routes /platform/config-versions (contrat, tag Configuration) : niveau PLATFORM de la cascade (§4.2). Réservé à
// PLATFORM_ADMIN, par la transaction de la plateforme. Chaque écriture est le contenu complet du niveau : clé
// inconnue, clé non réglable à ce niveau ou valeur hors bornes ⇒ 422 avec `violations`.
import { Body, Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { auditContext } from '../audit/audit-context';
import { pickLanguage } from '../http/language';
import { Idempotent, IdempotentTransaction, type IdempotentTx } from '../idempotency/idempotent.decorator';
import { Roles } from '../identity/roles.decorator';
import { platformParty } from '../organization/platform/operators.service';
import { PlatformAccess } from '../organization/platform/platform-access';
import { invalid, objectBody, pageOf, pageRequest } from '../organization/platform/platform.dto';
import { assertWithinBounds } from './bounds-validator';
import { CascadeService, type ConfigVersionDto } from './cascade.service';

const PLATFORM = () => ({ type: 'PLATFORM' as const });

interface VersionRow {
  id: string;
  operator_id: string | null;
  scope_type: ConfigVersionDto['scope_type'];
  scope_id: string;
  version: number;
  valid_from: Date;
  settings: Record<string, unknown>;
}

const versionDto = (row: VersionRow): ConfigVersionDto => ({
  config_version_id: row.id,
  operator_id: row.operator_id,
  scope_type: row.scope_type,
  scope_id: row.scope_id,
  version: row.version,
  valid_from: row.valid_from.toISOString(),
  settings: row.settings,
});

@Controller('platform/config-versions')
export class PlatformConfigController {
  constructor(
    private readonly cascade: CascadeService,
    private readonly access: PlatformAccess,
  ) {}

  @Get()
  @Roles(['PLATFORM_ADMIN'], PLATFORM)
  async list(@Req() req: Request, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    const page = pageRequest(cursor, limit);
    const rows = await this.access.platform(req)(async (client) => {
      const result = await client.query<VersionRow>(
        `SELECT id, operator_id, scope_type, scope_id, version, valid_from, settings FROM config_version
          WHERE scope_type = 'PLATFORM' AND operator_id IS NULL ORDER BY valid_from DESC, version DESC LIMIT $1 OFFSET $2`,
        [page.limit + 1, page.offset],
      );
      return result.rows;
    });
    return pageOf(rows, page, versionDto);
  }

  @Post()
  @Roles(['PLATFORM_ADMIN'], PLATFORM)
  @Idempotent({ scope: 'plt:', platform: true })
  create(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: unknown, @IdempotentTransaction() tx: IdempotentTx) {
    const settings = objectBody(body).settings;
    if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) throw invalid('Champ obligatoire : settings (objet).');
    assertWithinBounds(settings as Record<string, unknown>, { level: 'PLATFORM' }, pickLanguage(req.header('Accept-Language')));
    return tx.run(async (client) => {
      const scopeId = await platformParty(client);
      const created = await this.cascade.writeVersion(
        client,
        { level: 'PLATFORM', scopeId, operatorId: null },
        settings as Record<string, unknown>,
        auditContext(req),
      );
      res.setHeader('Location', '/v1/platform/config-versions');
      return created;
    });
  }
}
