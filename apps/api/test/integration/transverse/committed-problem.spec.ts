// Intégration : extensions de l'idempotence (mission identite-roles, WP07) — problème validé avec le travail fait
// (`CommittedProblem`, research R-08) et route d'écriture sans transaction métier (garde `writes`, RISK-2).
import { randomUUID } from 'node:crypto';
import { Body, Controller, Module, Post, Req, type INestApplication } from '@nestjs/common';
import type { Request } from 'express';
import request from 'supertest';
import { TenantTx, type TxClient } from '../../../src/db/tenant-tx';
import { CommittedProblem } from '../../../src/idempotency/committed-problem';
import { Idempotent, IdempotentTransaction, type IdempotentTx } from '../../../src/idempotency/idempotent.decorator';
import { createTestApp, HeaderTenantContext, TEST_OPERATOR_HEADER } from '../../support/app';
import { withOwner } from '../../support/db';
import { createOperators, type Operators } from './fixtures';

const tenant = new HeaderTenantContext();

const insertNote = (client: TxClient, note: string) =>
  client.query(
    `INSERT INTO config_version (operator_id, scope_type, scope_id, version, valid_from, settings)
     SELECT current_setting('app.operator_id')::uuid, 'OPERATOR', current_setting('app.operator_id')::uuid,
            coalesce(max(version), 0) + 1, now(), jsonb_build_object('note', $1::text)
       FROM config_version
      WHERE scope_type = 'OPERATOR' AND scope_id = current_setting('app.operator_id')::uuid`,
    [note],
  );

/** Routes de test (jamais importées par AppModule). Le contrôleur fautif n'est pas sous src/ : hors du test RISK-2. */
@Controller('__committed')
class CommittedRouteController {
  constructor(private readonly tx: TenantTx) {}

  /** Écrit l'état voulu (« expirée ») puis refuse : 409 validé avec l'écriture. */
  @Post('expire')
  @Idempotent({ scope: 'app:' })
  expire(@Body() body: { note: string }, @IdempotentTransaction() idempotent: IdempotentTx) {
    return idempotent.run(async (client) => {
      await insertNote(client, body.note);
      throw new CommittedProblem('APPROVAL_INVALID', { status: 409, detail: 'Demande expirée.' });
    });
  }

  /** Erreur ordinaire après écriture : l'écriture est annulée (comportement de la mission 1 inchangé). */
  @Post('rollback')
  @Idempotent({ scope: 'app:' })
  rollback(@Body() body: { note: string }, @IdempotentTransaction() idempotent: IdempotentTx) {
    return idempotent.run(async (client) => {
      await insertNote(client, body.note);
      throw new Error('panne simulée après écriture');
    });
  }

  /** Route d'écriture (défaut `writes: true`) qui écrit par TenantTx, hors de la transaction métier. */
  @Post('rogue')
  @Idempotent({ scope: 'app:' })
  rogue(@Req() req: Request, @Body() body: { note: string }) {
    return this.tx.run(tenant.current(req).operatorId, async (client) => {
      await insertNote(client, body.note);
      return { note: body.note };
    });
  }

  /** Route déclarée sans écriture : réponse enregistrée seule (comportement de la mission 1). */
  @Post('pure')
  @Idempotent({ scope: 'app:', writes: false })
  pure(@Body() body: { note: string }) {
    return { echo: body.note };
  }
}

@Module({ controllers: [CommittedRouteController] })
class CommittedRouteModule {}

describe('idempotence : problème validé et garde writes', () => {
  let app: INestApplication;
  let ops: Operators;

  beforeAll(async () => {
    ops = await createOperators();
    app = await createTestApp({ imports: [CommittedRouteModule] });
  });

  afterAll(async () => {
    await app.close();
  });

  const post = (path: string, key: string, body: object) =>
    request(app.getHttpServer())
      .post(`/v1/__committed/${path}`)
      .set(TEST_OPERATOR_HEADER, ops.a)
      .set('Idempotency-Key', key)
      .send(body);

  const noteCount = (note: string) =>
    withOwner(async (client) => {
      const { rows } = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM config_version WHERE operator_id = $1 AND settings->>'note' = $2`,
        [ops.a, note],
      );
      return rows[0]!.n;
    });

  const keyRow = (key: string) =>
    withOwner(async (client) => {
      const { rows } = await client.query<{ status: string; response_status: number | null }>(
        `SELECT status, response_status FROM api_idempotency WHERE operator_id = $1 AND idempotency_key = $2`,
        [ops.a, key],
      );
      return rows[0];
    });

  it('CommittedProblem : 409 problem+json, écriture validée, clé COMPLETED (409), rejeu identique', async () => {
    const key = randomUUID();
    const note = `expire-${key}`;
    const first = await post('expire', key, { note });
    expect(first.status).toBe(409);
    expect(first.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(JSON.parse(first.text)).toMatchObject({ code: 'APPROVAL_INVALID', status: 409, detail: 'Demande expirée.' });
    expect(await noteCount(note)).toBe(1);
    expect(await keyRow(key)).toEqual({ status: 'COMPLETED', response_status: 409 });

    const replay = await post('expire', key, { note });
    expect(replay.status).toBe(409);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(JSON.parse(replay.text)).toEqual(JSON.parse(first.text));
    expect(await noteCount(note)).toBe(1);
  });

  it('erreur ordinaire dans la transaction métier : écriture annulée, clé relâchée (inchangé)', async () => {
    const key = randomUUID();
    const note = `rollback-${key}`;
    expect((await post('rollback', key, { note })).status).toBe(500);
    expect(await noteCount(note)).toBe(0);
    expect(await keyRow(key)).toMatchObject({ status: 'IN_PROGRESS', response_status: null });
  });

  it('route writes sans IdempotentTx : 500 INTERNAL_ERROR, rien enregistré, clé réutilisable', async () => {
    const key = randomUUID();
    const note = `rogue-${key}`;
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    let first: request.Response;
    let logged: string;
    try {
      first = await post('rogue', key, { note });
      logged = JSON.stringify(stderr.mock.calls);
    } finally {
      stderr.mockRestore();
    }
    expect(first.status).toBe(500);
    expect(JSON.parse(first.text).code).toBe('INTERNAL_ERROR');
    expect(logged).toContain('IDEMPOTENT_ROUTE_WITHOUT_TX');
    expect(await keyRow(key)).toMatchObject({ status: 'IN_PROGRESS', response_status: null });
    // Clé relâchée : la même requête est exécutée de nouveau (pas de rejeu, pas de 409 IN_PROGRESS).
    const again = await post('rogue', key, { note });
    expect(again.status).toBe(500);
    expect(again.headers['idempotency-replayed']).toBeUndefined();
  });

  it('route writes: false : réponse enregistrée seule et rejouée', async () => {
    const key = randomUUID();
    const first = await post('pure', key, { note: 'pur' });
    expect(first.status).toBe(201);
    expect(first.body).toEqual({ echo: 'pur' });
    const replay = await post('pure', key, { note: 'pur' });
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body).toEqual({ echo: 'pur' });
  });
});
