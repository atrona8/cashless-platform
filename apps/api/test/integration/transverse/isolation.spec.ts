// Intégration : isolation entre prestataires (US4 n° 8, NFR-005) et durées imposées au rôle applicatif (NFR-008).
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'pg';
import request from 'supertest';
import { PG_POOL } from '../../../src/db/pool.token';
import { TenantTx } from '../../../src/db/tenant-tx';
import { createTestApp, TEST_OPERATOR_HEADER } from '../../support/app';
import { withOwner } from '../../support/db';
import { createOperators, type Operators } from './fixtures';
import { TestRouteModule } from './test-route.module';

const withoutInstance = (text: string) => {
  const { instance: _instance, ...rest } = JSON.parse(text) as Record<string, unknown>;
  return rest;
};

describe('isolation entre prestataires et durées du rôle', () => {
  let app: INestApplication;
  let ops: Operators;
  let noteOfA: string;

  beforeAll(async () => {
    ops = await createOperators();
    // Pool d'une seule connexion : A puis B passent par la même connexion physique.
    process.env.DB_POOL_SIZE = '1';
    try {
      app = await createTestApp({ imports: [TestRouteModule] });
    } finally {
      delete process.env.DB_POOL_SIZE;
    }
    const created = await request(app.getHttpServer())
      .post('/v1/__test/notes')
      .set(TEST_OPERATOR_HEADER, ops.a)
      .set('Idempotency-Key', randomUUID())
      .send({ note: 'secret de A' });
    expect(created.status).toBe(201);
    noteOfA = created.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  const read = (operatorId: string, id: string) =>
    request(app.getHttpServer()).get(`/v1/__test/notes/${id}`).set(TEST_OPERATOR_HEADER, operatorId);

  it('A relit son objet', async () => {
    const res = await read(ops.a, noteOfA);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: noteOfA, note: 'secret de A' });
  });

  it('objet de A lu par B : 404 identique à un objet inexistant (hors instance)', async () => {
    const foreign = await read(ops.b, noteOfA);
    const missing = await read(ops.b, randomUUID());
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(withoutInstance(foreign.text)).toEqual(withoutInstance(missing.text));
  });

  it('même connexion physique réutilisée par A puis B : aucun prestataire ne fuit', async () => {
    const tx = app.get(TenantTx);
    const pool = app.get<Pool>(PG_POOL);
    const seen = await tx.run(ops.a, async (client) => {
      const { rows } = await client.query<{ pid: number; n: number }>(
        `SELECT pg_backend_pid() AS pid, (SELECT count(*)::int FROM config_version WHERE id = $1) AS n`,
        [noteOfA],
      );
      return rows[0]!;
    });
    expect(seen.n).toBe(1);
    // Hors transaction, la connexion rendue au pool ne porte plus aucun prestataire (set_config local).
    const after = await pool.query<{ pid: number; operator: string | null }>(
      `SELECT pg_backend_pid() AS pid, nullif(current_setting('app.operator_id', true), '') AS operator`,
    );
    expect(after.rows[0]).toEqual({ pid: seen.pid, operator: null });
    const asB = await tx.run(ops.b, async (client) => {
      const { rows } = await client.query<{ pid: number; n: number }>(
        `SELECT pg_backend_pid() AS pid, (SELECT count(*)::int FROM config_version WHERE id = $1) AS n`,
        [noteOfA],
      );
      return rows[0]!;
    });
    expect(asB).toEqual({ pid: seen.pid, n: 0 });
  });

  it('requête sans set_config sous le rôle applicatif : aucune ligne visible', async () => {
    const counts = await withOwner(async (client) => {
      await client.query('BEGIN');
      try {
        await client.query('SET LOCAL ROLE cashless_app');
        const { rows } = await client.query<{ notes: number; keys: number }>(
          `SELECT (SELECT count(*)::int FROM config_version WHERE operator_id IS NOT NULL) AS notes,
                  (SELECT count(*)::int FROM api_idempotency) AS keys`,
        );
        return rows[0]!;
      } finally {
        await client.query('ROLLBACK');
      }
    });
    expect(counts).toEqual({ notes: 0, keys: 0 });
  });

  it('durées imposées sur les connexions du pool (NFR-008)', async () => {
    const pool = app.get<Pool>(PG_POOL);
    const show = async (name: string) => (await pool.query<Record<string, string>>(`SHOW ${name}`)).rows[0]![name];
    expect(await show('transaction_timeout')).toBe('1min');
    expect(await show('statement_timeout')).toBe('30s');
    expect(await show('idle_in_transaction_session_timeout')).toBe('10s');
  });
});
