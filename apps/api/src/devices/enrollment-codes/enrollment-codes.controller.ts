// Routes des codes d'enrôlement (openapi.yaml : createDeviceEnrollmentCode,
// listDeviceEnrollmentCodes ; contracts/enrollment.md). Prestataire : celui de la personne.
// OPERATOR_ADMIN : tout le prestataire ; ORGANIZER_ADMIN : les événements de ses organisateurs (la
// création sur un autre événement rend 404, contrôlé par la base). Création idempotente et
// `transient` : le code part une seule fois, un rejeu de la clé reçoit 409 sans le code.
import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  Idempotent,
  IdempotentTransaction,
  type IdempotentTx,
} from '../../idempotency/idempotent.decorator';
import type { Role } from '../../identity/principal';
import { invalid, isUuid, pageOf, pageRequest } from '../../organization/platform/platform.dto';
import {
  scopesHeld,
  TenantAccess,
  type TenantActor,
} from '../../organization/tenant/tenant-access';
import { enrollmentCodeSummary, parseEnrollmentCodeCreate } from './enrollment-codes.dto';
import { EnrollmentCodesService } from './enrollment-codes.service';

const ADMINS: readonly Role[] = ['OPERATOR_ADMIN', 'ORGANIZER_ADMIN'];

/** Organisateurs dont la personne lit les codes ; `null` : tout le prestataire. */
function readableOrganizers(actor: TenantActor): string[] | null {
  if (actor.role === 'OPERATOR_ADMIN') return null;
  return scopesHeld(actor.principal, 'ORGANIZER_ADMIN', 'ORGANIZER');
}

@Controller('device-enrollment-codes')
export class EnrollmentCodesController {
  constructor(
    private readonly access: TenantAccess,
    private readonly codes: EnrollmentCodesService,
  ) {}

  @Post()
  @Idempotent({ scope: 'bo:', transient: true })
  create(@Req() req: Request, @Body() body: unknown, @IdempotentTransaction() tx: IdempotentTx) {
    const actor = this.access.actor(req, ADMINS);
    const input = parseEnrollmentCodeCreate(body);
    return tx.run((client) => this.codes.create(client, actor, input));
  }

  @Get()
  list(
    @Req() req: Request,
    @Query('event_id') eventId?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const actor = this.access.actor(req, ADMINS);
    if (eventId !== undefined && !isUuid(eventId)) throw invalid('event_id : identifiant attendu.');
    const page = pageRequest(cursor, limit);
    return this.access.read(actor, async (client) =>
      pageOf(
        await this.codes.list(
          client,
          { eventId, organizers: readableOrganizers(actor) },
          page.offset,
          page.limit + 1,
        ),
        page,
        enrollmentCodeSummary,
      ),
    );
  }
}
