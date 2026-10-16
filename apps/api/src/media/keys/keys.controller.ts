// Routes back-office des clés de bracelet (contrat, tag Bracelets, `x-process: public`) : lecture des clés, des
// travaux et des comptes rendus du contrôle quotidien ; demandes à deux de création, de rotation et de retrait.
// Rôle : OPERATOR_ADMIN du prestataire du chemin (un PLATFORM_ADMIN ne gère pas les clés d'un prestataire).
import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApprovalService, respondAccepted } from '../../approval/approval.service';
import { Idempotent, IdempotentTransaction, type IdempotentTx } from '../../idempotency/idempotent.decorator';
import type { Role } from '../../identity/principal';
import { pageOf, pageRequest, requireUuid } from '../../organization/platform/platform.dto';
import { TenantAccess } from '../../organization/tenant/tenant-access';
import { parseKeyIndex, parseTagKeyRequest, tagKeyCheckRunDto, tagKeyDto, tagKeyJobDto } from './keys.dto';
import { KeysService } from './keys.service';

const KEY_ADMINS: readonly Role[] = ['OPERATOR_ADMIN'];

@Controller('operators/:operator_id')
export class KeysController {
  constructor(
    private readonly access: TenantAccess,
    private readonly keys: KeysService,
    private readonly approvals: ApprovalService,
  ) {}

  @Get('tag-keys')
  list(@Req() req: Request, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    const actor = this.access.actor(req, KEY_ADMINS);
    const page = pageRequest(cursor, limit);
    return this.access.read(actor, async (client) => pageOf(await this.keys.list(client, page), page, tagKeyDto));
  }

  @Post('tag-keys')
  @HttpCode(202)
  @Idempotent({ scope: 'bo:' })
  requestKey(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: unknown, @IdempotentTransaction() tx: IdempotentTx) {
    const actor = this.access.actor(req, KEY_ADMINS);
    const input = parseTagKeyRequest(body);
    return tx.run(async (client) => {
      await this.keys.assertCreatable(client, input);
      const request = await this.approvals.request(
        client,
        actor.operatorId,
        { action: 'TAG_KEY_CREATE', targetId: null, payload: { operator_id: actor.operatorId, ...input } },
        { principal: actor.principal, audit: actor.audit },
      );
      return respondAccepted(res, request);
    });
  }

  @Get('tag-keys/:key_index')
  get(@Req() req: Request, @Param('key_index') rawIndex: string) {
    const actor = this.access.actor(req, KEY_ADMINS);
    const keyIndex = parseKeyIndex(rawIndex);
    return this.access.read(actor, async (client) => ({
      ...tagKeyDto(await this.keys.row(client, keyIndex)),
      data_key_versions: (await this.keys.dataKeyVersions(client, keyIndex)).map((v) => ({ version: v.version, status: v.status, created_at: v.created_at.toISOString() })),
      jobs: (await this.keys.jobs(client, { offset: 0, limit: 50 }, { keyIndex, openOnly: true })).map(tagKeyJobDto),
    }));
  }

  @Post('tag-keys/:key_index/dek-rotations')
  @HttpCode(202)
  @Idempotent({ scope: 'bo:' })
  requestRotation(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('key_index') rawIndex: string, @IdempotentTransaction() tx: IdempotentTx) {
    return this.requestOnKey(req, res, rawIndex, tx, 'TAG_DEK_ROTATE', (client, index) => this.keys.assertRotatable(client, index));
  }

  @Post('tag-keys/:key_index/retirement')
  @HttpCode(202)
  @Idempotent({ scope: 'bo:' })
  requestRetirement(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('key_index') rawIndex: string, @IdempotentTransaction() tx: IdempotentTx) {
    return this.requestOnKey(req, res, rawIndex, tx, 'TAG_KEY_RETIRE', (client, index) => this.keys.assertRetirable(client, index));
  }

  @Get('tag-key-jobs')
  jobs(@Req() req: Request, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    const actor = this.access.actor(req, KEY_ADMINS);
    const page = pageRequest(cursor, limit);
    return this.access.read(actor, async (client) => pageOf(await this.keys.jobs(client, page), page, tagKeyJobDto));
  }

  @Post('tag-key-jobs/:job_id/retry')
  @HttpCode(200)
  @Idempotent({ scope: 'bo:' })
  retry(@Req() req: Request, @Param('job_id') jobId: string, @IdempotentTransaction() tx: IdempotentTx) {
    this.access.actor(req, KEY_ADMINS);
    return tx.run(async (client) => tagKeyJobDto(await this.keys.retry(client, requireUuid(jobId))));
  }

  @Get('tag-key-check-runs')
  checkRuns(@Req() req: Request, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    const actor = this.access.actor(req, KEY_ADMINS);
    const page = pageRequest(cursor, limit);
    return this.access.read(actor, async (client) => pageOf(await this.keys.checkRuns(client, page), page, tagKeyCheckRunDto));
  }

  private requestOnKey(
    req: Request,
    res: Response,
    rawIndex: string,
    tx: IdempotentTx,
    action: 'TAG_DEK_ROTATE' | 'TAG_KEY_RETIRE',
    assert: (client: Parameters<Parameters<IdempotentTx['run']>[0]>[0], keyIndex: number) => Promise<void>,
  ) {
    const actor = this.access.actor(req, KEY_ADMINS);
    const keyIndex = parseKeyIndex(rawIndex);
    return tx.run(async (client) => {
      await assert(client, keyIndex);
      const request = await this.approvals.request(
        client,
        actor.operatorId,
        { action, targetId: null, payload: { operator_id: actor.operatorId, key_index: keyIndex } },
        { principal: actor.principal, audit: actor.audit },
      );
      return respondAccepted(res, request);
    });
  }
}
