// Intégration : protocole d'idempotence S21 (US4 n° 1 à 4, SPECIFICATION §10.2, contracts/idempotency.md).
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Client } from 'pg';
import request from 'supertest';
import { requestHash } from '../../../src/idempotency/request-hash';
import { createTestApp, TEST_OPERATOR_HEADER } from '../../support/app';
import { connect, OWNER_URL, withOwner } from '../../support/db';
import { createOperators, type Operators } from './fixtures';
import { faults, TestRouteModule } from './test-route.module';

const NOTES = '/v1/__test/notes';

describe('idempotence applicative (S21)', () => {
  let app: INestApplication;
  let ops: Operators;

  beforeAll(async () => {
    ops = await createOperators();
    app = await createTestApp({ imports: [TestRouteModule] });
  });

  afterAll(async () => {
    await app.close();
  });

  const post = (operatorId: string, key: string | undefined, body: object) => {
    const req = request(app.getHttpServer()).post(NOTES).set(TEST_OPERATOR_HEADER, operatorId);
    return (key === undefined ? req : req.set('Idempotency-Key', key)).send(body);
  };

  const noteCount = (operatorId: string, note: string) =>
    withOwner(async (client) => {
      const { rows } = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM config_version WHERE operator_id = $1 AND settings->>'note' = $2`,
        [operatorId, note],
      );
      return rows[0]!.n;
    });

  const keyRow = (operatorId: string, key: string) =>
    withOwner(async (client) => {
      const { rows } = await client.query<{ status: string; response_status: number | null }>(
        `SELECT status, response_status FROM api_idempotency WHERE operator_id = $1 AND idempotency_key = $2`,
        [operatorId, key],
      );
      return rows[0];
    });

  it('sans Idempotency-Key : 400 IDEMPOTENCY_KEY_REQUIRED, rien n’est écrit', async () => {
    const res = await post(ops.a, undefined, { note: 'sans-clé' });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.text).code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(await noteCount(ops.a, 'sans-clé')).toBe(0);
  });

  it('clé de plus de 255 caractères : 400 VALIDATION_FAILED', async () => {
    const res = await post(ops.a, 'k'.repeat(256), { note: 'clé-longue' });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.text).code).toBe('VALIDATION_FAILED');
  });

  it('sans prestataire authentifié : 401, aucune clé réservée', async () => {
    const key = randomUUID();
    const res = await request(app.getHttpServer()).post(NOTES).set('Idempotency-Key', key).send({ note: 'anonyme' });
    expect(res.status).toBe(401);
    expect(JSON.parse(res.text).code).toBe('UNAUTHENTICATED');
  });

  it('rejeu identique : même statut et même corps, Idempotency-Replayed: true, une seule écriture', async () => {
    const key = randomUUID();
    const first = await post(ops.a, key, { note: 'rejeu' });
    expect(first.status).toBe(201);
    expect(first.headers['idempotency-replayed']).toBeUndefined();
    expect(first.body).toEqual({ id: expect.any(String), note: 'rejeu' });

    const replay = await post(ops.a, key, { note: 'rejeu' });
    expect(replay.status).toBe(201);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body).toEqual(first.body);
    expect(await noteCount(ops.a, 'rejeu')).toBe(1);
    expect(await keyRow(ops.a, key)).toEqual({ status: 'COMPLETED', response_status: 201 });
  });

  it('même clé, autre corps : 409 IDEMPOTENCY_KEY_REUSED', async () => {
    const key = randomUUID();
    expect((await post(ops.a, key, { note: 'original' })).status).toBe(201);
    const res = await post(ops.a, key, { note: 'modifié' });
    expect(res.status).toBe(409);
    expect(JSON.parse(res.text).code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await noteCount(ops.a, 'modifié')).toBe(0);
  });

  it('l’ordre des propriétés du corps ne change pas l’empreinte (JCS)', async () => {
    const key = randomUUID();
    expect((await post(ops.a, key, { note: 'ordre', holdLock: 1 })).status).toBe(201);
    const replay = await post(ops.a, key, { holdLock: 1, note: 'ordre' });
    expect(replay.status).toBe(201);
    expect(replay.headers['idempotency-replayed']).toBe('true');
  });

  it('deux requêtes en vol avec la même clé : la seconde reçoit 409 IDEMPOTENCY_KEY_IN_PROGRESS', async () => {
    const key = randomUUID();
    const lock = Math.floor(Math.random() * 1_000_000_000);
    const owner: Client = await connect(OWNER_URL);
    try {
      await owner.query('SELECT pg_advisory_lock($1)', [lock]);
      const body = { note: 'concurrence', holdLock: lock };
      const first = post(ops.a, key, body).then((res) => res);
      // La première requête a réservé la clé et attend le verrou dans sa transaction métier.
      await waitFor(async () => {
        const { rows } = await owner.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND objid = $1`,
          [lock],
        );
        return rows[0]!.n > 0;
      });
      const second = await post(ops.a, key, body);
      expect(second.status).toBe(409);
      expect(JSON.parse(second.text).code).toBe('IDEMPOTENCY_KEY_IN_PROGRESS');

      await owner.query('SELECT pg_advisory_unlock($1)', [lock]);
      const done = await first;
      expect(done.status).toBe(201);
      const replay = await post(ops.a, key, body);
      expect(replay.headers['idempotency-replayed']).toBe('true');
      expect(replay.body).toEqual(done.body);
      expect(await noteCount(ops.a, 'concurrence')).toBe(1);
    } finally {
      await owner.query('SELECT pg_advisory_unlock_all()');
      await owner.end();
    }
  });

  it('bail expiré d’une exécution interrompue : la clé est reprise et la requête exécutée', async () => {
    const key = randomUUID();
    const body = { note: 'reprise' };
    await withOwner((client) =>
      client.query(
        `INSERT INTO api_idempotency (operator_id, scope, idempotency_key, request_hash, status, lease_until, expires_at)
         VALUES ($1, 'app:', $2, $3, 'IN_PROGRESS', now() - interval '1 second', now() + interval '1 day')`,
        [ops.a, key, requestHash('POST', NOTES, body)],
      ),
    );
    const res = await post(ops.a, key, body);
    expect(res.status).toBe(201);
    expect(res.headers['idempotency-replayed']).toBeUndefined();
    expect(await keyRow(ops.a, key)).toEqual({ status: 'COMPLETED', response_status: 201 });
  });

  it('erreur 5xx : rien n’est validé, la clé est relâchée et la même requête peut être rejouée', async () => {
    const key = randomUUID();
    const body = { note: 'panne' };
    faults.failNext = true;
    const failed = await post(ops.a, key, body);
    expect(failed.status).toBe(500);
    expect(JSON.parse(failed.text).code).toBe('INTERNAL_ERROR');
    expect(await noteCount(ops.a, 'panne')).toBe(0);
    expect((await keyRow(ops.a, key))?.status).toBe('IN_PROGRESS');

    const retried = await post(ops.a, key, body);
    expect(retried.status).toBe(201);
    expect(retried.headers['idempotency-replayed']).toBeUndefined();
    expect(await noteCount(ops.a, 'panne')).toBe(1);
  });

  it('erreur 4xx métier : réponse définitive, rejouée à l’identique, écriture annulée', async () => {
    const key = randomUUID();
    const first = await post(ops.a, key, { note: 'insolvable' });
    expect(first.status).toBe(422);
    expect(first.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(JSON.parse(first.text).code).toBe('INSUFFICIENT_FUNDS');

    const replay = await post(ops.a, key, { note: 'insolvable' });
    expect(replay.status).toBe(422);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(JSON.parse(replay.text)).toEqual(JSON.parse(first.text));
    expect(await noteCount(ops.a, 'insolvable')).toBe(0);
  });

  it('même clé chez un autre prestataire : clés indépendantes', async () => {
    const key = randomUUID();
    const a = await post(ops.a, key, { note: 'partagée' });
    const b = await post(ops.b, key, { note: 'partagée' });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.headers['idempotency-replayed']).toBeUndefined();
    expect(b.body.id).not.toBe(a.body.id);
  });
});

async function waitFor(condition: () => Promise<boolean>, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('condition non atteinte à temps');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
