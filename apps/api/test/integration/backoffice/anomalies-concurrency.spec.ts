// Classements simultanés d'une même anomalie (mission routes-backoffice 11b, WP07 ; FR-009) : la base verrouille la
// ligne (`SELECT … FOR UPDATE` de `classify_anomaly`), un seul classement passe, les autres reçoivent 409, une seule
// ligne d'audit.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { createMediaWorld, type MediaWorld } from '../../support/media-fixtures';

jest.setTimeout(300_000);

describe('classements simultanés', () => {
  let w: MediaWorld;
  let app: INestApplication;

  beforeAll(async () => {
    w = await createMediaWorld();
    app = await createTestApp({ identity: w.idp });
  });

  afterAll(async () => {
    await app.close();
  });

  const make = async (): Promise<string> => {
    const id = randomUUID();
    await withOwner((db) =>
      db.query(
        `INSERT INTO anomaly (id, operator_id, ledger_id, kind, amount)
         VALUES ($1, $2, $3, 'CASH_DIFF', 800)`,
        [id, w.ops.a, w.ids.ledgerA],
      ),
    );
    return id;
  };

  const fire = (anomaly: string, count: number) =>
    Promise.all(
      Array.from({ length: count }, (_, i) =>
        request(app.getHttpServer())
          .post(`/v1/anomalies/${anomaly}/classification`)
          .set(
            'Authorization',
            `Bearer ${(i % 2 === 0 ? w.operatorAdminA : w.organizerAdminA).token}`,
          )
          .set('Idempotency-Key', randomUUID())
          .send({ reason: `Motif ${i}` }),
      ),
    );

  const audits = (anomaly: string) =>
    withOwner(
      async (db) =>
        (
          await db.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM audit_log WHERE action = 'ANOMALY_CLASSIFIED' AND object_id = $1`,
            [anomaly],
          )
        ).rows[0]!.n,
    );

  it('deux classements simultanés (clés différentes) : un 200, un 409, une ligne d’audit', async () => {
    const id = await make();
    const results = await fire(id, 2);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await audits(id)).toBe('1');
  });

  it('dix classements simultanés : un seul 200, neuf 409, un seul auteur et un seul motif retenus', async () => {
    const id = await make();
    const results = await fire(id, 10);
    const ok = results.filter((r) => r.status === 200);
    expect(ok).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(9);
    expect(await audits(id)).toBe('1');
    const stored = await withOwner(
      async (db) =>
        (
          await db.query<{ classification_reason: string }>(
            'SELECT classification_reason FROM anomaly WHERE id = $1',
            [id],
          )
        ).rows[0]!,
    );
    expect(stored.classification_reason).toBe(ok[0]!.body.classification.reason);
  });
});
