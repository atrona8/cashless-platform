// POST /platform-admins (contrat, tag Personnes) : réservé à un PLATFORM_ADMIN ; contrôle, création et audit faits
// en base par create_platform_admin (migration 0006). Sans Idempotency-Key : une personne de la plateforme n'a pas
// de prestataire, auquel toute clé est rattachée ; (émetteur, sujet) unique rend le rejeu sans effet (409).
import { Body, Controller, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { auditContext } from '../../audit/audit-context';
import { requestPrincipal } from '../principal';
import type { RolesRequest } from '../roles.guard';
import { staffAdminRole } from './role-rules';
import { parseStaffUserCreate } from './users.dto';
import { UsersService } from './users.service';

@Controller('platform-admins')
export class PlatformAdminsController {
  constructor(private readonly users: UsersService) {}

  @Post()
  create(@Req() req: Request, @Body() body: unknown) {
    const principal = requestPrincipal(req);
    (req as RolesRequest).exercisedRole = staffAdminRole(principal, ['PLATFORM_ADMIN']);
    const input = parseStaffUserCreate(body);
    return this.users.createPlatformAdmin(input, { principal, audit: auditContext(req) });
  }
}
