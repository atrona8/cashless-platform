// GET /staff/me (contrat `getStaffProfile`) : profil et attributions de la personne authentifiée. Lecture sans
// effet, donc sans ligne d'audit. Jeton du personnel seulement : la garde d'authentification globale refuse tout
// autre appelant (festivalier, terminal, sans jeton) avant ce contrôleur.
import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import { StaffProfileService } from './staff-profile.service';

@Controller('staff')
export class StaffProfileController {
  constructor(private readonly profile: StaffProfileService) {}

  @Get('me')
  me(@Req() req: Request) {
    return this.profile.get(req);
  }
}
