// Routes de test des garanties transverses (jamais importées par AppModule ; montées par createTestApp).
//
// Table métier utilisée pour les « notes » : `config_version` (portée OPERATOR). C'est la plus simple des tables sous
// RLS que `cashless_app` peut écrire directement, sans aucun effet comptable ; la note est rangée dans `settings`.
import { Body, Controller, Get, HttpCode, Module, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { TenantTx } from '../../../src/db/tenant-tx';
import { ProblemException } from '../../../src/errors/problem';
import { Idempotent, IdempotentTransaction, type IdempotentTx } from '../../../src/idempotency/idempotent.decorator';
import { HeaderTenantContext } from '../../support/app';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tenant = new HeaderTenantContext();

/** Pannes commandées par les tests : la prochaine écriture échoue en 5xx après son INSERT. */
export const faults = { failNext: false };

export interface NoteBody {
  note: string;
  /** Verrou consultatif attendu pendant la transaction métier (le test le détient : requête « en vol »). */
  holdLock?: number;
}

export interface BackofficeBody {
  ledgerId: string;
  debitAccountId: string;
  creditAccountId: string;
  createdBy: string;
}

@Controller('__test')
export class TestRouteController {
  constructor(private readonly tx: TenantTx) {}

  @Post('notes')
  @Idempotent({ scope: 'app:' })
  createNote(@Body() body: NoteBody, @IdempotentTransaction() idempotent: IdempotentTx) {
    return idempotent.run(async (client) => {
      if (body.holdLock !== undefined) await client.query('SELECT pg_advisory_xact_lock($1)', [body.holdLock]);
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO config_version (operator_id, scope_type, scope_id, version, valid_from, settings)
         SELECT current_setting('app.operator_id')::uuid, 'OPERATOR', current_setting('app.operator_id')::uuid,
                coalesce(max(version), 0) + 1, now(), jsonb_build_object('note', $1::text)
           FROM config_version
          WHERE scope_type = 'OPERATOR' AND scope_id = current_setting('app.operator_id')::uuid
         RETURNING id`,
        [body.note],
      );
      if (faults.failNext) {
        faults.failNext = false;
        throw new Error('panne simulée après écriture');
      }
      if (body.note === 'insolvable') throw new ProblemException('INSUFFICIENT_FUNDS');
      return { id: rows[0]!.id, note: body.note };
    });
  }

  @Get('notes/:id')
  readNote(@Req() req: Request, @Param('id') id: string) {
    if (!UUID.test(id)) throw new ProblemException('NOT_FOUND');
    return this.tx.run(tenant.current(req).operatorId, async (client) => {
      const { rows } = await client.query<{ id: string; note: string }>(
        `SELECT id, settings->>'note' AS note FROM config_version WHERE id = $1 AND scope_type = 'OPERATOR'`,
        [id],
      );
      if (!rows[0]) throw new ProblemException('NOT_FOUND');
      return rows[0];
    });
  }

  /** Lève le SQLSTATE demandé avec un message sentinelle (fonction __test_raise créée par le test). */
  @Post('fail')
  @HttpCode(200)
  fail(@Req() req: Request, @Query('sqlstate') sqlstate: string) {
    return this.tx.run(tenant.current(req).operatorId, (client) => client.query('SELECT __test_raise($1)', [sqlstate]));
  }

  /** Écriture back-office sans second valideur : refusée par la contrainte de double validation (23514). */
  @Post('backoffice')
  backoffice(@Req() req: Request, @Body() body: BackofficeBody) {
    return this.tx.run(tenant.current(req).operatorId, async (client) => {
      const lines = [
        { account_id: body.debitAccountId, amount: 100 },
        { account_id: body.creditAccountId, amount: -100 },
      ];
      await client.query(
        `SELECT post_transaction($1, 'ADJUSTMENT', $2, now(), 'BACKOFFICE', $3::jsonb, NULL, NULL, $4, NULL)`,
        [body.ledgerId, `adj:${Date.now()}`, JSON.stringify(lines), body.createdBy],
      );
      return { posted: true };
    });
  }
}

@Module({ controllers: [TestRouteController] })
export class TestRouteModule {}
