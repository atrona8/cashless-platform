// Route 16 `getPartyStatement` : relevé d'une partie pour un événement, JSON paginé ou CSV (mission 9b, WP13).
// Périmètre : `party-statement-scope.ts` (liste figée). Lecture seule ; `Idempotency-Key` sans objet.
import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ProblemException } from '../errors/problem';
import { invalid, isUuid, requireUuid } from '../organization/platform/platform.dto';
import { TenantAccess } from '../organization/tenant/tenant-access';
import {
  ALL_STATEMENT_ROLES,
  hasStatementRole,
  isPartyKind,
  statementAccess,
} from './party-statement-scope';
import { parseCursor, PartyStatementService } from './party-statement.service';

function parseLimit(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 50;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200)
    throw invalid('limit : entier de 1 à 200 attendu.');
  return limit;
}

@Controller('operators/:operator_id/events/:event_id/statements')
export class PartyStatementController {
  constructor(
    private readonly access: TenantAccess,
    private readonly statements: PartyStatementService,
  ) {}

  @Get(':party_kind')
  async get(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('event_id') eventId: string,
    @Param('party_kind') rawKind: string,
    @Query('party_id') rawPartyId?: string,
    @Query('format') format?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const actor = this.access.actor(req, ALL_STATEMENT_ROLES);
    // Nature inconnue : même réponse qu'un chemin inexistant.
    if (!isPartyKind(rawKind)) throw new ProblemException('NOT_FOUND');
    // Rôle insuffisant pour cette nature : 403 avant toute lecture (aucun oracle sur l'événement).
    if (!hasStatementRole(actor.principal, rawKind)) throw new ProblemException('FORBIDDEN');
    if (format !== undefined && format !== 'json' && format !== 'csv')
      throw invalid('format : json ou csv.');
    if (rawPartyId !== undefined && !isUuid(rawPartyId)) throw new ProblemException('NOT_FOUND');
    const page = { after: parseCursor(cursor), limit: parseLimit(limit) };
    const id = requireUuid(eventId);
    return this.access.read(actor, async (client) => {
      const event = await this.statements.event(client, id);
      const decision = statementAccess(
        actor.principal,
        actor.operatorId,
        rawKind,
        rawPartyId ?? null,
        event,
      );
      if (decision.verdict === 'FORBIDDEN') throw new ProblemException('FORBIDDEN');
      if (decision.verdict === 'NOT_FOUND') throw new ProblemException('NOT_FOUND');
      if (
        decision.checkParticipation &&
        !(await this.statements.participates(client, event.id, decision.partyId!))
      )
        throw new ProblemException('NOT_FOUND');
      if (format !== 'csv')
        return this.statements.page(client, rawKind, event, decision.partyId, page);
      const csv = await this.statements.csv(client, rawKind, event, decision.partyId);
      await this.statements.recordCsvExport(
        client,
        actor.audit,
        event,
        rawKind,
        decision.partyId,
        csv.lines,
      );
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="statement-${rawKind.toLowerCase()}-${event.id}.csv"`,
      );
      res.setHeader('Cache-Control', 'no-store');
      return csv.text;
    });
  }
}
