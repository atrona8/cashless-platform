// Intégration : traduction SQLSTATE → problem+json sans fuite du texte SQL (NFR-004, contracts/problem-mapping.md).
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DOUBLE_VALIDATION_CONSTRAINTS, SQLSTATE_MAP } from '../../../src/errors/sqlstate-map';
import { createTestApp, TEST_OPERATOR_HEADER } from '../../support/app';
import { withOwner } from '../../support/db';
import { createLedger, createOperators, type BackofficeFixture, type Operators } from './fixtures';
import { TestRouteModule } from './test-route.module';

const SENTINEL = 'SENTINELLE_SQL_42';

const CASES: [sqlstate: string, code: string, status: number][] = [
  ...Object.entries(SQLSTATE_MAP).map(([sqlstate, m]): [string, string, number] => [sqlstate, m.code, m.status]),
  ['23514', 'VALIDATION_FAILED', 422], // contrainte CHECK quelconque (pas de double validation)
  ['22012', 'INTERNAL_ERROR', 500], // SQLSTATE hors table
];

describe('erreurs SQL traduites sans fuite', () => {
  let app: INestApplication;
  let ops: Operators;
  let ledger: BackofficeFixture;

  beforeAll(async () => {
    ops = await createOperators();
    ledger = await createLedger(ops.a);
    await withOwner(async (client) => {
      await client.query(
        `CREATE OR REPLACE FUNCTION __test_raise(p_state text) RETURNS void LANGUAGE plpgsql AS $$
         BEGIN RAISE EXCEPTION '${SENTINEL}' USING ERRCODE = p_state, DETAIL = '${SENTINEL}', HINT = '${SENTINEL}'; END $$`,
      );
      await client.query('GRANT EXECUTE ON FUNCTION __test_raise(text) TO cashless_app');
    });
    app = await createTestApp({ imports: [TestRouteModule] });
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(CASES)('SQLSTATE %s → %s (%i), aucun fragment du message SQL', async (sqlstate, code, status) => {
    const res = await request(app.getHttpServer())
      .post(`/v1/__test/fail?sqlstate=${sqlstate}`)
      .set(TEST_OPERATOR_HEADER, ops.a)
      .set('Accept-Language', 'en');
    expect(res.status).toBe(status);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    const body = JSON.parse(res.text);
    expect(body).toMatchObject({ code, status, type: `https://errors.cashless/${code}` });
    expect(res.text).not.toContain(SENTINEL);
    expect(JSON.stringify(res.headers)).not.toContain(SENTINEL);
  });

  it('23514 de double validation (écriture BACKOFFICE sans valideur) → 403 FORBIDDEN', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/__test/backoffice')
      .set(TEST_OPERATOR_HEADER, ops.a)
      .send({ ...ledger, createdBy: randomUUID() });
    expect(res.status).toBe(403);
    const body = JSON.parse(res.text);
    expect(body.code).toBe('FORBIDDEN');
    expect(res.text).not.toMatch(/journal_transaction|check|BACKOFFICE/i);
  });

  it('noms des contraintes de double validation : identiques au schéma (pg_get_constraintdef)', async () => {
    const actual = await withOwner(async (client) => {
      const { rows } = await client.query<{ conname: string; def: string }>(
        `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ANY($1::text[])`,
        [Object.keys(DOUBLE_VALIDATION_CONSTRAINTS)],
      );
      return Object.fromEntries(rows.map((row) => [row.conname, row.def]));
    });
    expect(actual).toEqual(DOUBLE_VALIDATION_CONSTRAINTS);
  });
});
