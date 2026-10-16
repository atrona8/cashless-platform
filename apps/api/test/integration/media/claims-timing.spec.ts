// Pas d'énumération des codes imprimés (NFR-007) : 200 essais d'un code inconnu et 200 d'un code
// déjà utilisé reçoivent le même statut, le même corps, les mêmes en-têtes (noms, et valeurs
// hors celles propres à chaque requête), et l'écart des temps de réponse
// médians reste sous 20 ms. Mesure sensible à la charge : écartée de la passe parallèle
// (`SKIP_LATENCY=1`) et lancée seule ensuite, comme la latence (NFR-003). Chaque essai vient
// d'un compte et d'un appareil neufs : les limites d'essais ne doivent pas entrer dans la
// mesure.
import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { generateClaimCode } from '@cashless/tag-format';
import request from 'supertest';
import { ClaimHasher } from '../../../src/kms/claim-hash';
import { createTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { createTestCustomer, type TestCustomer } from '../../support/fake-customer';
import {
  activateMedia,
  createBatch,
  createMediaWorld,
  goLive,
  seedPersonalizedMedia,
  type MediaWorld,
} from '../../support/media-fixtures';

const TRIES = 200;
const MAX_MEDIAN_GAP_MS = 20;

/**
 * En-têtes dont la VALEUR change d'une requête à l'autre, quel que soit le code : exclus de la
 * comparaison des valeurs, jamais de celle des noms (leur présence doit rester la même).
 * - `x-request-id` : identifiant propre à chaque requête ;
 * - `date` : heure de la réponse ;
 * - `etag` : empreinte du corps, qui contient `instance` (l'identifiant de requête) ;
 * - `content-length` : longueur de ce même corps, `instance` compris.
 */
const PER_REQUEST_HEADERS = new Set(['x-request-id', 'date', 'etag', 'content-length']);

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return (sorted[(sorted.length - 1) >> 1]! + sorted[sorted.length >> 1]!) / 2;
};

describe('rattachement : pas d’énumération des codes (NFR-007)', () => {
  let w: MediaWorld;
  let app: INestApplication;
  let usedCode: string;
  let customers: TestCustomer[];

  beforeAll(async () => {
    w = await createMediaWorld();
    app = await createTestApp({ identity: w.idp });
    const hasher = app.get(ClaimHasher, { strict: false });
    usedCode = generateClaimCode(randomBytes);
    customers = await withOwner(async (db) => {
      await goLive(db, w.ops.a, w.ids.eventA, w.operatorAdminA.userId);
      const batch = await createBatch(db, {
        operatorId: w.ops.a,
        organizerId: w.ids.organizerA,
        eventId: w.ids.eventA,
        status: 'ACTIVE',
      });
      const [m] = await seedPersonalizedMedia(db, {
        operatorId: w.ops.a,
        batchId: batch,
        kmsKeyRef: w.keyRef.a,
        count: 1,
      });
      const hash = hasher.claimCodeHash(usedCode);
      await db.query(
        `INSERT INTO claim_code (operator_id, batch_id, code_hash, media_id, associated_at)
         VALUES ($1, $2, $3, $4, now())`,
        [w.ops.a, batch, hash, m!.id],
      );
      await db.query('UPDATE media SET claim_code_hash = $2 WHERE id = $1', [m!.id, hash]);
      await activateMedia(db, {
        operatorId: w.ops.a,
        eventId: w.ids.eventA,
        walletId: w.ids.walletA,
        mediaIds: [m!.id],
      });
      await db.query('UPDATE media SET claim_code_used_at = now() WHERE id = $1', [m!.id]);
      const all: TestCustomer[] = [];
      for (let i = 0; i < 2 * TRIES + 2; i += 1)
        all.push(await createTestCustomer(db, w.ops.a, `timing-${randomUUID()}`));
      return all;
    });
  }, 120_000);

  afterAll(async () => {
    await app.close();
  });

  it('même statut, même corps, mêmes en-têtes, écart des médianes < 20 ms', async () => {
    const attempt = async (who: TestCustomer, code: string) => {
      const started = process.hrtime.bigint();
      const res = await request(app.getHttpServer())
        .post('/v1/me/media')
        .set(who.headers)
        .set('Idempotency-Key', randomUUID())
        .send({ claim_code: code });
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      const { instance: _instance, ...body } = res.body as Record<string, unknown>;
      const headers = res.headers as Record<string, unknown>;
      const names = Object.keys(headers).sort();
      const values = names
        .filter((name) => !PER_REQUEST_HEADERS.has(name))
        .map((name) => `${name}: ${String(headers[name])}`);
      return {
        ms,
        status: res.status,
        body: JSON.stringify(body),
        headerNames: names.join(', '),
        headerValues: values.join('\n'),
      };
    };
    // Mise en route (connexions, compilation) hors mesure.
    await attempt(customers[2 * TRIES]!, generateClaimCode(randomBytes));
    await attempt(customers[2 * TRIES + 1]!, usedCode);

    const unknown: Awaited<ReturnType<typeof attempt>>[] = [];
    const used: Awaited<ReturnType<typeof attempt>>[] = [];
    // Essais alternés : une dérive de la machine pèse autant sur les deux sortes.
    for (let i = 0; i < TRIES; i += 1) {
      unknown.push(await attempt(customers[2 * i]!, generateClaimCode(randomBytes)));
      used.push(await attempt(customers[2 * i + 1]!, usedCode));
    }
    const outcomes = new Set([...unknown, ...used].map((r) => `${r.status} ${r.body}`));
    expect(outcomes.size).toBe(1);
    expect(unknown[0]!.status).toBe(422);
    // Mêmes noms d'en-têtes (sans exclusion) et mêmes valeurs, hors valeurs propres à la requête.
    expect(new Set([...unknown, ...used].map((r) => r.headerNames))).toEqual(
      new Set([unknown[0]!.headerNames]),
    );
    expect(new Set([...unknown, ...used].map((r) => r.headerValues))).toEqual(
      new Set([unknown[0]!.headerValues]),
    );
    const gap = Math.abs(median(unknown.map((r) => r.ms)) - median(used.map((r) => r.ms)));
    const [a, b] = [median(unknown.map((r) => r.ms)), median(used.map((r) => r.ms))];
    process.stdout.write(
      `NFR-007 : médianes inconnu ${a.toFixed(1)} ms, utilisé ${b.toFixed(1)} ms, ` +
        `écart ${gap.toFixed(1)} ms\n`,
    );
    expect(gap).toBeLessThan(MAX_MEDIAN_GAP_MS);
  }, 300_000);
});
