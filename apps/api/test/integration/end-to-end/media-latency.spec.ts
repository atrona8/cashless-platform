// Latence des routes des bracelets (NFR-006, T085) : sur une base de 100 000 bracelets d'un même
// prestataire, la demande de mot de passe d'un terminal (`POST /media/auth-keys`, processus des
// clés de bracelet) et la lecture (`POST /taps`, processus public) répondent en 200 ms ou moins
// au 95e centile et 500 ms ou moins au 99e ; l'activation au guichet (`POST /media/activations`)
// en 500 ms ou moins au 95e centile. Les durées sont celles de la requête HTTP complète, vues du
// client de test (donc au-dessus du temps serveur seul). Elles sont écrites dans la sortie du
// test (ligne « LATENCE »). Base : les bracelets mesurés sont posés par `seedPersonalizedMedia`
// (mot de passe réel scellé sous une clé de données ouverte par le faux service de clés, donc
// déchiffrable par le processus des clés) ; les autres, posés en SQL par `generate_series`, ne
// portent qu'un chiffré factice de la bonne longueur, jamais demandé : ils ne servent qu'à
// donner aux index et aux tables leur volume. Comme pour la latence de configuration : hors CI,
// une série au-dessus d'un seuil est refaite, trois fois au plus, et toutes les séries sont
// consignées ; en CI (variable `CI`), la suite tourne seule dans son propre pas, une seule série
// par mesure, le seuil s'applique tel quel.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createKeyProcess, createTestApp, type KeyProcessApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { createTestDevice, type TestDevice } from '../../support/fake-device';
import {
  activateMedia,
  createBatch,
  createMediaWorld,
  MEDIA_KEY_INDEX,
  seedPersonalizedMedia,
  tapBody,
  type MediaWorld,
  type SeededMedia,
} from '../../support/media-fixtures';

/** Bracelets du prestataire mesuré, bracelets mesurés compris. */
const TOTAL_MEDIA = 100_000;
/**
 * Bracelets mesurés : un jeu pour les mots de passe, un jeu activé pour les lectures, un
 * bracelet neuf par activation.
 */
const AUTH_KEY_MEDIA = 50;
const TAP_MEDIA = 50;
const AUTH_KEY_SAMPLES = 200;
const TAP_SAMPLES = 200;
const ACTIVATION_SAMPLES = 50;
const MAX_SERIES = process.env.CI ? 1 : 3;
/** Une activation consomme un bracelet : de quoi couvrir toutes les séries et la mise en route. */
const ACTIVATION_MEDIA = ACTIVATION_SAMPLES * MAX_SERIES + 5;
const MEASURED_MEDIA = AUTH_KEY_MEDIA + TAP_MEDIA + ACTIVATION_MEDIA;

jest.setTimeout(300_000);

function percentile(samples: number[], q: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return Math.round(sorted[Math.ceil(sorted.length * q) - 1]!);
}
const p95 = (samples: number[]) => percentile(samples, 0.95);
const p99 = (samples: number[]) => percentile(samples, 0.99);
const median = (samples: number[]): number =>
  Math.round([...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)]!);

describe('latence des routes des bracelets', () => {
  let w: MediaWorld;
  let app: INestApplication;
  let keys: KeyProcessApp;
  let device: TestDevice;
  let authKeyMedia: SeededMedia[];
  let tapMedia: SeededMedia[];
  let activationMedia: SeededMedia[];
  let counter = 1_000;
  const next = () => (counter += 1);

  beforeAll(async () => {
    w = await createMediaWorld();
    await withOwner(async (db) => {
      device = await createTestDevice(db, { operatorId: w.ops.a, eventId: w.ids.eventA });
      const batch = await createBatch(db, {
        operatorId: w.ops.a,
        organizerId: w.ids.organizerA,
        eventId: w.ids.eventA,
        status: 'ACTIVE',
        quantity: MEASURED_MEDIA,
      });
      // Un seul appel : une seule clé de données ACTIVE pour tous les bracelets mesurés.
      const measured = await seedPersonalizedMedia(db, {
        operatorId: w.ops.a,
        batchId: batch,
        kmsKeyRef: w.keyRef.a,
        count: MEASURED_MEDIA,
      });
      authKeyMedia = measured.slice(0, AUTH_KEY_MEDIA);
      tapMedia = measured.slice(AUTH_KEY_MEDIA, AUTH_KEY_MEDIA + TAP_MEDIA);
      activationMedia = measured.slice(AUTH_KEY_MEDIA + TAP_MEDIA);
      await activateMedia(db, {
        operatorId: w.ops.a,
        eventId: w.ids.eventA,
        walletId: w.ids.walletA,
        mediaIds: tapMedia.map((m) => m.id),
      });
      // Volume : le reste des 100 000 bracelets, en SQL. UID préfixé 0x05 (ceux du jeu
      // d'essai commencent par 0x04), donc sans collision avec les bracelets mesurés ;
      // chiffré factice de 34 octets rattaché à la même clé de données (la table l'exige
      // d'un bracelet personnalisé).
      const filler = TOTAL_MEDIA - MEASURED_MEDIA;
      const fillerBatch = await createBatch(db, {
        operatorId: w.ops.a,
        organizerId: w.ids.organizerA,
        quantity: filler,
      });
      await db.query(
        `INSERT INTO media (operator_id, kind, token_hash, nfc_uid, key_index, batch_id, status,
                            personalized_at, signature_ok, originality_sig_sha256, pwd_pack_enc,
                            pwd_pack_dek_id)
         SELECT $1, 'NFC_TAG', sha256(('volume:' || n)::bytea),
                '\\x05'::bytea || substring(int8send(n::bigint) FROM 3 FOR 6), $2, $3,
                'PERSONALIZED',
                clock_timestamp(), true, sha256(('signature:' || n)::bytea),
                sha256(('chiffre:' || n)::bytea) || '\\x0000'::bytea,
                (SELECT pwd_pack_dek_id FROM media WHERE id = $4)
           FROM generate_series(1, $5) n`,
        [w.ops.a, MEDIA_KEY_INDEX, fillerBatch, measured[0]!.id, filler],
      );
      await db.query('ANALYZE media');
    });
    app = await createTestApp({ identity: w.idp });
    keys = await createKeyProcess('tag-keys');
  });

  afterAll(async () => {
    await keys?.app.close();
    await app?.close();
  });

  /** Durée d'une requête ; échoue sur une réponse inattendue (une erreur rapide ne compte pas). */
  const timed = async (
    send: () => request.Test,
    expected: number,
    check: (body: Record<string, unknown>) => boolean = () => true,
  ): Promise<number> => {
    const start = process.hrtime.bigint();
    const res = await send();
    const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
    if (res.status !== expected || !check(res.body as Record<string, unknown>)) {
      throw new Error(`statut ${res.status} au lieu de ${expected} : ${res.text.slice(0, 300)}`);
    }
    return elapsed;
  };
  const askKey = (m: SeededMedia) => () =>
    request(keys.app.getHttpServer())
      .post('/v1/media/auth-keys')
      .set(device.headers)
      .send({ nfc_uid: m.uid, key_index: MEDIA_KEY_INDEX });
  const tap = (m: SeededMedia) => () =>
    request(app.getHttpServer()).post('/v1/taps').set(device.headers).send(tapBody(m, next()));
  const activate = (m: SeededMedia) => () =>
    request(app.getHttpServer())
      .post('/v1/media/activations')
      .set(device.headers)
      .set('X-Staff-Authorization', `Bearer ${w.cashierA.token}`)
      .set('Idempotency-Key', randomUUID())
      .send({ tap: tapBody(m, next()), channel: 'DESK', occurred_at: new Date().toISOString() });
  const tapOk = (body: Record<string, unknown>) => body.result === 'OK';

  it('base peuplée : 100 000 bracelets pour le prestataire', async () => {
    const [counts] = await withOwner(
      async (db) =>
        (
          await db.query(
            `SELECT count(*)::int AS media,
                    count(*) FILTER (WHERE pwd_pack_enc IS NOT NULL)::int AS sealed
               FROM media WHERE operator_id = $1`,
            [w.ops.a],
          )
        ).rows,
    );
    expect(counts).toEqual({ media: TOTAL_MEDIA, sealed: TOTAL_MEDIA });
  });

  it(
    `${AUTH_KEY_SAMPLES} mots de passe et ${TAP_SAMPLES} lectures : p95 ≤ 200 ms, ` +
      `p99 ≤ 500 ms ; ${ACTIVATION_SAMPLES} activations : p95 ≤ 500 ms`,
    async () => {
      // Mise en route (connexions, compilation des requêtes, clé de données en cache),
      // hors mesure.
      for (let n = 0; n < 5; n += 1) {
        await timed(askKey(authKeyMedia[n]!), 200);
        await timed(tap(tapMedia[n]!), 200, tapOk);
      }
      let fresh = 0;
      for (let n = 0; n < 5; n += 1) await timed(activate(activationMedia[(fresh += 1) - 1]!), 201);

      const series = {
        mots_de_passe: async () => {
          const samples: number[] = [];
          for (let n = 0; n < AUTH_KEY_SAMPLES; n += 1) {
            samples.push(await timed(askKey(authKeyMedia[n % authKeyMedia.length]!), 200));
          }
          return samples;
        },
        lectures: async () => {
          const samples: number[] = [];
          for (let n = 0; n < TAP_SAMPLES; n += 1) {
            samples.push(await timed(tap(tapMedia[n % tapMedia.length]!), 200, tapOk));
          }
          return samples;
        },
        activations: async () => {
          const samples: number[] = [];
          for (let n = 0; n < ACTIVATION_SAMPLES; n += 1) {
            samples.push(await timed(activate(activationMedia[(fresh += 1) - 1]!), 201));
          }
          return samples;
        },
      };
      const thresholds = {
        mots_de_passe: { p95: 200, p99: 500 },
        lectures: { p95: 200, p99: 500 },
        activations: { p95: 500, p99: Number.POSITIVE_INFINITY },
      } as const;
      const holds = (name: keyof typeof series, samples: number[]) =>
        p95(samples) <= thresholds[name].p95 && p99(samples) <= thresholds[name].p99;
      /** Meilleure série parmi `MAX_SERIES` au plus ; s'arrête dès qu'une série tient. */
      const measure = async (name: keyof typeof series) => {
        const attempts: number[][] = [];
        do attempts.push(await series[name]());
        while (attempts.length < MAX_SERIES && !holds(name, attempts[attempts.length - 1]!));
        const best =
          attempts.find((a) => holds(name, a)) ??
          attempts.reduce((a, b) => (p95(b) < p95(a) ? b : a));
        const limit = thresholds[name];
        return {
          n: best.length,
          median_ms: median(best),
          p95_ms: p95(best),
          p99_ms: p99(best),
          max_ms: Math.round(Math.max(...best)),
          seuil_p95_ms: limit.p95,
          ...(Number.isFinite(limit.p99) ? { seuil_p99_ms: limit.p99 } : {}),
          series_p95_ms: attempts.map(p95),
        };
      };

      const report = {
        bracelets: TOTAL_MEDIA,
        mots_de_passe: await measure('mots_de_passe'),
        lectures: await measure('lectures'),
        activations: await measure('activations'),
      };
      process.stdout.write(`LATENCE ${JSON.stringify(report)}\n`);
      expect(report.mots_de_passe.p95_ms).toBeLessThanOrEqual(200);
      expect(report.mots_de_passe.p99_ms).toBeLessThanOrEqual(500);
      expect(report.lectures.p95_ms).toBeLessThanOrEqual(200);
      expect(report.lectures.p99_ms).toBeLessThanOrEqual(500);
      expect(report.activations.p95_ms).toBeLessThanOrEqual(500);
    },
  );
});
