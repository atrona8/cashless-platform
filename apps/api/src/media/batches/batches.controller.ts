// Routes des lots de bracelets (contrat, tag Bracelets), sous `/operators/{operator_id}/media-batches`.
// Lecture : OPERATOR_ADMIN ; ORGANIZER_ADMIN, SUPERVISOR et CASHIER pour les lots de leur organisateur.
// Écriture : ORGANIZER_ADMIN de l'organisateur du lot, et lui seul. Écritures idempotentes (`bo:`), travail et audit
// dans IdempotentTx.run. Le fichier de commande des codes est `transient` : sa réponse n'est jamais conservée.
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { TxClient } from '../../db/tenant-tx';
import { ProblemException } from '../../errors/problem';
import { pickLanguage } from '../../http/language';
import {
  Idempotent,
  IdempotentTransaction,
  type IdempotentTx,
} from '../../idempotency/idempotent.decorator';
import type { Role } from '../../identity/principal';
import {
  invalid,
  isUuid,
  pageOf,
  pageRequest,
  requireUuid,
} from '../../organization/platform/platform.dto';
import { PartiesService } from '../../organization/tenant/parties.service';
import {
  assertOrganizerScope,
  scopesHeld,
  TenantAccess,
  type TenantActor,
} from '../../organization/tenant/tenant-access';
import {
  BATCH_STATUSES,
  batchDto,
  parseBatchCreate,
  parseBatchUpdate,
  parseStatusChange,
  type MediaBatchRow,
} from './batches.dto';
import { BatchesService } from './batches.service';
import { ClaimCodesService } from './claim-codes.service';
import type { CsvRequest } from './csv-body.middleware';

const READERS: readonly Role[] = ['OPERATOR_ADMIN', 'ORGANIZER_ADMIN', 'SUPERVISOR', 'CASHIER'];
const WRITERS: readonly Role[] = ['ORGANIZER_ADMIN'];

@Controller('operators/:operator_id/media-batches')
export class BatchesController {
  constructor(
    private readonly access: TenantAccess,
    private readonly batches: BatchesService,
    private readonly claimCodes: ClaimCodesService,
    private readonly parties: PartiesService,
  ) {}

  @Get()
  async list(
    @Req() req: Request,
    @Query('organizer_id') organizerId?: string,
    @Query('event_id') eventId?: string,
    @Query('status') status?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const actor = this.access.actor(req, READERS);
    if (organizerId !== undefined && !isUuid(organizerId))
      throw invalid('organizer_id : identifiant attendu.');
    if (eventId !== undefined && !isUuid(eventId)) throw invalid('event_id : identifiant attendu.');
    if (status !== undefined && !(BATCH_STATUSES as readonly string[]).includes(status))
      throw invalid('status : valeur inconnue.');
    const page = pageRequest(cursor, limit);
    return this.access.read(actor, async (client) => {
      const organizers = await this.readableOrganizers(client, actor);
      return pageOf(
        await this.batches.list(
          client,
          { organizerId, eventId, status, organizers },
          page.offset,
          page.limit + 1,
        ),
        page,
        batchDto,
      );
    });
  }

  @Post()
  @Idempotent({ scope: 'bo:' })
  create(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const actor = this.access.actor(req, WRITERS);
    const input = parseBatchCreate(body);
    return tx.run(async (client) => {
      // Organisateur du prestataire (404 sinon), que la personne administre (403 sinon).
      await this.parties.row(client, 'ORGANIZER', input.organizer_id);
      assertOrganizerScope(actor, input.organizer_id);
      const created = await this.batches.create(
        client,
        actor.operatorId,
        input,
        actor.audit,
        pickLanguage(req.header('Accept-Language')),
      );
      res.setHeader(
        'Location',
        `/v1/operators/${actor.operatorId}/media-batches/${created.batch_id}`,
      );
      return created;
    });
  }

  @Get(':batch_id')
  get(@Req() req: Request, @Param('batch_id') batchId: string) {
    const actor = this.access.actor(req, READERS);
    return this.access.read(actor, async (client) =>
      batchDto(await this.readable(client, actor, batchId)),
    );
  }

  @Patch(':batch_id')
  @Idempotent({ scope: 'bo:' })
  update(
    @Req() req: Request,
    @Param('batch_id') batchId: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const actor = this.access.actor(req, WRITERS);
    const changes = parseBatchUpdate(body);
    return tx.run(async (client) =>
      this.batches.update(
        client,
        await this.writable(client, actor, batchId),
        changes,
        actor.audit,
        pickLanguage(req.header('Accept-Language')),
      ),
    );
  }

  @Post(':batch_id/status')
  @HttpCode(200)
  @Idempotent({ scope: 'bo:' })
  setStatus(
    @Req() req: Request,
    @Param('batch_id') batchId: string,
    @Body() body: unknown,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const actor = this.access.actor(req, WRITERS);
    const change = parseStatusChange(body);
    return tx.run(async (client) =>
      this.batches.setStatus(
        client,
        await this.writable(client, actor, batchId),
        change.status,
        change.reason,
        actor.audit,
        pickLanguage(req.header('Accept-Language')),
      ),
    );
  }

  @Get(':batch_id/inventory')
  inventory(@Req() req: Request, @Param('batch_id') batchId: string) {
    const actor = this.access.actor(req, READERS);
    return this.access.read(actor, async (client) =>
      this.batches.inventory(client, (await this.readable(client, actor, batchId)).id),
    );
  }

  @Post(':batch_id/claim-code-order')
  @HttpCode(200)
  @Idempotent({ scope: 'bo:', transient: true })
  issueClaimCodeOrder(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('batch_id') batchId: string,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const actor = this.access.actor(req, WRITERS);
    return tx.run(async (client) => {
      const batch = await this.writable(client, actor, batchId);
      const csv = await this.claimCodes.issueOrder(client, batch, actor.audit);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="claim-codes-${batch.id}.csv"`);
      // Le fichier porte tous les codes du lot : aucun intermédiaire ne doit le garder.
      res.setHeader('Cache-Control', 'no-store');
      return csv;
    });
  }

  @Post(':batch_id/claim-code-associations')
  @HttpCode(200)
  @Idempotent({ scope: 'bo:' })
  importAssociations(
    @Req() req: CsvRequest,
    @Param('batch_id') batchId: string,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const actor = this.access.actor(req, WRITERS);
    if (req.csvTooLarge) throw invalid('Fichier trop volumineux : 1 Mo au plus par envoi.');
    const csv: unknown = req.body;
    if (typeof csv !== 'string') throw invalid('Corps text/csv attendu : lignes « code,uid ».');
    return tx.run(async (client) =>
      this.claimCodes.importAssociations(
        client,
        await this.writable(client, actor, batchId),
        csv,
        actor.audit,
      ),
    );
  }

  @Post(':batch_id/closure')
  @HttpCode(200)
  @Idempotent({ scope: 'bo:' })
  close(
    @Req() req: Request,
    @Param('batch_id') batchId: string,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const actor = this.access.actor(req, WRITERS);
    return tx.run(async (client) =>
      this.batches.close(client, await this.writable(client, actor, batchId), actor.audit),
    );
  }

  @Post(':batch_id/preload-catchup')
  @HttpCode(200)
  @Idempotent({ scope: 'bo:' })
  catchUpPreload(
    @Req() req: Request,
    @Param('batch_id') batchId: string,
    @IdempotentTransaction() tx: IdempotentTx,
  ) {
    const actor = this.access.actor(req, WRITERS);
    return tx.run(async (client) =>
      this.batches.catchUpPreload(client, await this.writable(client, actor, batchId), actor.audit),
    );
  }

  /** Organisateurs dont la personne voit les lots (`null` : tous ceux du prestataire). */
  private async readableOrganizers(client: TxClient, actor: TenantActor): Promise<string[] | null> {
    const { principal } = actor;
    if (principal.assignments.some((a) => a.role === 'OPERATOR_ADMIN')) return null;
    const direct = (['ORGANIZER_ADMIN', 'SUPERVISOR', 'CASHIER'] as const).flatMap((role) =>
      scopesHeld(principal, role, 'ORGANIZER'),
    );
    const events = (['SUPERVISOR', 'CASHIER'] as const).flatMap((role) =>
      scopesHeld(principal, role, 'EVENT'),
    );
    return [...new Set([...direct, ...(await this.batches.organizersOfEvents(client, events))])];
  }

  /** Lot du prestataire (404 sinon) dans la portée de lecture de la personne (403 sinon). */
  private async readable(
    client: TxClient,
    actor: TenantActor,
    batchId: string,
  ): Promise<MediaBatchRow> {
    const row = await this.batches.row(client, requireUuid(batchId));
    const organizers = await this.readableOrganizers(client, actor);
    if (organizers !== null && !organizers.includes(row.organizer_id))
      throw new ProblemException('FORBIDDEN');
    return row;
  }

  /** Lot du prestataire (404 sinon), verrouillé, dont la personne administre l'organisateur (403 sinon). */
  private async writable(
    client: TxClient,
    actor: TenantActor,
    batchId: string,
  ): Promise<MediaBatchRow> {
    const row = await this.batches.row(client, requireUuid(batchId), true);
    assertOrganizerScope(actor, row.organizer_id);
    return row;
  }
}
