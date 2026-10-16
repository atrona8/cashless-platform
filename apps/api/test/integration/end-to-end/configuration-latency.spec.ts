// Latence des routes de configuration (NFR-003) : sur une base peuplée (100 événements, 1 000 participations),
// lectures et écritures de configuration en 200 ms ou moins au 95e centile, création d'un événement avec son grand
// livre et ses comptes en 500 ms ou moins. Les durées sont celles de la requête HTTP complète, vues du client de test
// (donc au-dessus du temps serveur seul). Elles sont écrites dans la sortie du test (ligne « LATENCE ») et reportées
// dans .github/CI.md.
// Les suites Jest tournent en parallèle sur la même machine et la même base : une série mesurée pendant le démarrage
// des autres suites peut dépasser le seuil sans que le code y soit pour rien. Une série au-dessus du seuil est donc
// refaite, trois fois au plus ; le test échoue si aucune ne tient le seuil, et toutes les séries sont consignées.
// En CI (variable `CI`), la suite tourne seule, dans son propre pas, et sans nouvel essai : une seule série par
// mesure, le seuil s'applique tel quel.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { FakeIdp, type TestPerson } from '../../support/fake-idp';
import { createOperators } from '../transverse/fixtures';

const EVENTS = 100;
const MERCHANTS = 10;

jest.setTimeout(180_000);

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return Math.round(sorted[Math.ceil(sorted.length * 0.95) - 1]!);
}
const median = (samples: number[]): number =>
  Math.round([...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)]!);

describe('latence des routes de configuration', () => {
  let app: INestApplication;
  let operatorId: string;
  let organizerAdmin: TestPerson;
  const ids = { organizer: randomUUID(), profile: randomUUID(), contract: randomUUID() };
  let eventId: string;
  let participationId: string;

  beforeAll(async () => {
    const idp = await FakeIdp.create();
    operatorId = (await createOperators()).a;
    await withOwner(async (db) => {
      await db.query(
        `INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)' WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM')`,
      );
      await db.query(
        `INSERT INTO party (id, kind, operator_id, legal_name) VALUES ($1, 'ORGANIZER', $2, 'Organisateur de charge')`,
        [ids.organizer, operatorId],
      );
      await db.query(
        `INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination) VALUES ($1, 'SN', (1000000 + floor(random() * 1000000000))::int, '2026-01-01', 'ORGANIZER')`,
        [ids.profile],
      );
      await db.query(
        `INSERT INTO contract (id, operator_id, kind, counterparty_id, valid_from, offline_loss_bearer, cash_diff_bearer, breakage_organizer_bps)
         VALUES ($1, $2, 'OPERATOR_ORGANIZER', $3, '2026-01-01', 'ORGANIZER', 'ORGANIZER', 8000)`,
        [ids.contract, operatorId, ids.organizer],
      );
      // Base peuplée : 100 événements, 10 commerçants, 1 000 participations.
      await db.query(
        `INSERT INTO event (operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder)
         SELECT $1, $2, 'Événement de charge ' || n, 'XOF', 'Africa/Dakar', $3, 'ORGANIZER' FROM generate_series(1, $4) n`,
        [operatorId, ids.organizer, ids.profile, EVENTS],
      );
      await db.query(
        `INSERT INTO party (kind, operator_id, legal_name) SELECT 'MERCHANT', $1, 'Commerçant de charge ' || n FROM generate_series(1, $2) n`,
        [operatorId, MERCHANTS],
      );
      await db.query(
        `INSERT INTO merchant_participation (operator_id, event_id, merchant_id, link_type)
         SELECT $1, e.id, m.id, 'EXTERNAL' FROM event e, party m WHERE e.operator_id = $1 AND m.operator_id = $1 AND m.kind = 'MERCHANT'`,
        [operatorId],
      );
      organizerAdmin = await idp.createPerson(db, {
        operatorId,
        roles: [{ role: 'ORGANIZER_ADMIN', scopeType: 'ORGANIZER', scopeId: ids.organizer }],
      });
    });
    app = await createTestApp({ identity: idp });
  });

  afterAll(async () => {
    await app.close();
  });

  const O = () => `/v1/operators/${operatorId}`;
  const timed = async (send: () => request.Test, expected: number): Promise<number> => {
    const start = process.hrtime.bigint();
    const res = await send();
    const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
    if (res.status !== expected)
      throw new Error(`statut ${res.status} au lieu de ${expected} : ${res.text.slice(0, 300)}`);
    return elapsed;
  };
  const get = (path: string) => () =>
    request(app.getHttpServer())
      .get(`${O()}${path}`)
      .set('Authorization', `Bearer ${organizerAdmin.token}`);
  const write = (method: 'post' | 'patch', path: string, body: object) => () =>
    request(app.getHttpServer())
      [method](`${O()}${path}`)
      .set('Authorization', `Bearer ${organizerAdmin.token}`)
      .set('Idempotency-Key', randomUUID())
      .send(body);
  const newEvent = (n: number) =>
    write('post', '/events', {
      organizer_id: ids.organizer,
      name: `Création mesurée ${n} ${randomUUID()}`,
      currency: 'XOF',
      timezone: 'Africa/Dakar',
      jurisdiction_id: ids.profile,
      funds_holder: 'ORGANIZER',
      contract_id: ids.contract,
    });

  it('base peuplée : 100 événements et 1 000 participations', async () => {
    const [counts] = await withOwner(
      async (db) =>
        (
          await db.query(
            `SELECT (SELECT count(*)::int FROM event WHERE operator_id = $1) AS events, (SELECT count(*)::int FROM merchant_participation WHERE operator_id = $1) AS participations`,
            [operatorId],
          )
        ).rows,
    );
    expect(counts).toEqual({ events: EVENTS, participations: EVENTS * MERCHANTS });
  });

  it('30 créations d’événement (grand livre et comptes) : p95 ≤ 500 ms ; 200 lectures et 50 écritures de configuration : p95 ≤ 200 ms', async () => {
    // Mise en route (connexions, compilation des requêtes) hors mesure.
    const warm = await newEvent(0)();
    expect(warm.status).toBe(201);
    eventId = warm.body.event_id as string;
    const joined = await write('post', `/events/${eventId}/participations`, {
      merchant_id: await withOwner(
        async (db) =>
          (
            await db.query<{ id: string }>(
              `SELECT id FROM party WHERE operator_id = $1 AND kind = 'MERCHANT' LIMIT 1`,
              [operatorId],
            )
          ).rows[0]!.id,
      ),
      link_type: 'EXTERNAL',
    })();
    participationId = joined.body.participation_id as string;
    await get(`/events/${eventId}/config`)();
    // Écritures de configuration de mise en route, hors mesure elles aussi (première version de chaque niveau).
    expect(
      (
        await write('post', `/organizers/${ids.organizer}/config-versions`, {
          settings: { psp_fee_bearer: 'ORGANIZER' },
        })()
      ).status,
    ).toBe(201);
    expect(
      (await write('patch', `/events/${eventId}`, { reversal_window_minutes: 9 })()).status,
    ).toBe(200);

    const readers = [
      get(`/events/${eventId}`),
      get(`/events/${eventId}/config`),
      get('/events?limit=50'),
      get(`/events/${eventId}/participations`),
      get(`/participations/${participationId}`),
      get(`/events/${eventId}/status-conditions`),
      get(`/organizers/${ids.organizer}/config-versions`),
      get('/fee-rules?limit=50'),
    ];
    let created = 0;
    let written = 0;
    const series = {
      creations: async () => {
        const samples: number[] = [];
        for (let n = 0; n < 30; n += 1) samples.push(await timed(newEvent((created += 1)), 201));
        return samples;
      },
      lectures: async () => {
        const samples: number[] = [];
        for (let n = 0; n < 200; n += 1)
          samples.push(await timed(readers[n % readers.length]!, 200));
        return samples;
      },
      ecritures: async () => {
        const samples: number[] = [];
        for (let n = 0; n < 25; n += 1) {
          written += 1;
          samples.push(
            await timed(
              write('post', `/organizers/${ids.organizer}/config-versions`, {
                settings: { psp_fee_bearer: written % 2 ? 'ORGANIZER' : 'CUSTOMER' },
              }),
              201,
            ),
          );
          samples.push(
            await timed(
              write('patch', `/events/${eventId}`, {
                reversal_window_minutes: 10 + (written % 20),
              }),
              200,
            ),
          );
        }
        return samples;
      },
    };
    const thresholds = { creations: 500, lectures: 200, ecritures: 200 } as const;
    const maxSeries = process.env.CI ? 1 : 3;
    /** Meilleure série (p95 le plus bas) parmi `maxSeries` au plus ; s'arrête dès qu'une série tient le seuil. */
    const measure = async (name: keyof typeof series) => {
      const attempts: number[][] = [];
      do attempts.push(await series[name]());
      while (attempts.length < maxSeries && p95(attempts[attempts.length - 1]!) > thresholds[name]);
      const best = attempts.reduce((a, b) => (p95(b) < p95(a) ? b : a));
      return {
        n: best.length,
        median_ms: median(best),
        p95_ms: p95(best),
        max_ms: Math.round(Math.max(...best)),
        seuil_ms: thresholds[name],
        series_p95_ms: attempts.map(p95),
      };
    };

    const report = {
      creations: await measure('creations'),
      lectures: await measure('lectures'),
      ecritures: await measure('ecritures'),
    };
    process.stdout.write(`LATENCE ${JSON.stringify(report)}\n`);
    expect(report.creations.p95_ms).toBeLessThanOrEqual(500);
    expect(report.lectures.p95_ms).toBeLessThanOrEqual(200);
    expect(report.ecritures.p95_ms).toBeLessThanOrEqual(200);
  });
});
