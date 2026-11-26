// Modèles de téléphone (mission 11b, WP09 ; contrat `listPhoneModels`, `upsertPhoneModel`,
// `deletePhoneModel`). Écriture : `PLATFORM_ADMIN` seul, transaction de la plateforme, par les
// fonctions de la base (D9). Lecture : `PLATFORM_ADMIN`, `OPERATOR_ADMIN`, `ORGANIZER_ADMIN` ; tout
// autre rôle (SUPERVISOR, CASHIER...) : 403.
import { Body, Controller, Delete, Get, HttpCode, Param, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { auditContext } from '../../audit/audit-context';
import { PlatformAccess } from '../../organization/platform/platform-access';
import { pageOf } from '../../organization/platform/platform.dto';
import { parsePage, parseUpsert, pathName, phoneModelDto } from './phone-models.dto';
import { PhoneModelsService } from './phone-models.service';

const READERS = ['OPERATOR_ADMIN', 'ORGANIZER_ADMIN'] as const;

@Controller('phone-models')
export class PhoneModelsController {
  constructor(
    private readonly models: PhoneModelsService,
    private readonly access: PlatformAccess,
  ) {}

  @Get()
  async list(
    @Req() req: Request,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    // Contrôle du rôle (et rôle exercé de l'audit) ; la lecture elle-même passe par le pool
    // applicatif.
    this.access.reader(req, READERS);
    const page = parsePage(cursor, limit);
    return pageOf(await this.models.list(page), page, phoneModelDto);
  }

  @Put(':manufacturer/:model')
  upsert(
    @Req() req: Request,
    @Param('manufacturer') manufacturer: string,
    @Param('model') model: string,
    @Body() body: unknown,
  ) {
    const write = this.access.platform(req);
    pathName(manufacturer, 'manufacturer');
    pathName(model, 'model');
    const input = parseUpsert(body);
    return write((client) =>
      this.models.upsert(client, manufacturer, model, input, auditContext(req)),
    );
  }

  @Delete(':manufacturer/:model')
  @HttpCode(204)
  async remove(
    @Req() req: Request,
    @Param('manufacturer') manufacturer: string,
    @Param('model') model: string,
  ): Promise<void> {
    const write = this.access.platform(req);
    pathName(manufacturer, 'manufacturer');
    pathName(model, 'model');
    const previous = await this.models.current(manufacturer, model);
    await write((client) =>
      this.models.remove(client, manufacturer, model, auditContext(req), previous),
    );
  }
}
