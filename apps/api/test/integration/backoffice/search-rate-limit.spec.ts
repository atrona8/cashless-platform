// Limite de débit de la recherche par numéro (mission routes-backoffice, WP08 ; NFR-004, research D8) : 20 par
// personne et par minute, comptées en base, refus audités sans numéro.
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loadConfig } from '../../../src/config/config';
import { maskPhone } from '../../../src/search/phone-mask';
import { createTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import type { TestPerson } from '../../support/fake-idp';
import { createMediaWorld, ownerRows, type MediaWorld } from '../../support/media-fixtures';
import { phoneNumber } from './search-fixtures';

describe('limite de débit de la recherche par numéro', () => {
  let w: MediaWorld;
  let apps: INestApplication[];
  let p1: TestPerson;
  let p2: TestPerson;
  let p3: TestPerson;
  const number = phoneNumber();

  const search = (app: INestApplication, person: TestPerson) =>
    request(app.getHttpServer())
      .post('/v1/search/customers')
      .set('Authorization', `Bearer ${person.token}`)
      .send({ phone: number });
  const count = (actor: string, action: string) =>
    ownerRows<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_log WHERE actor_id = $1 AND action = $2`,
      [actor, action],
    ).then((r) => r[0]!.n);

  beforeAll(async () => {
    w = await createMediaWorld();
    apps = [await createTestApp({ identity: w.idp }), await createTestApp({ identity: w.idp })];
    await withOwner(async (db) => {
      const make = () =>
        w.idp.createPerson(db, {
          operatorId: w.ops.a,
          roles: [{ role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: w.ops.a }],
        });
      p1 = await make();
      p2 = await make();
      p3 = await make();
    });
  });

  afterAll(async () => {
    await Promise.all(apps.map((a) => a.close()));
  });

  it('20 recherches passent, la 21e rend 429 avec Retry-After et une ligne de refus ; une autre personne passe', async () => {
    // Deux instances de l'API qui se partagent la base : le compte n'est pas en mémoire.
    for (let i = 0; i < 20; i += 1) {
      const res = await search(apps[i % 2]!, p1);
      expect({ i, status: res.status }).toEqual({ i, status: 200 });
    }
    const refused = await search(apps[0]!, p1);
    expect(refused.status).toBe(429);
    expect(refused.body.code).toBe('RATE_LIMITED');
    const retry = Number(refused.headers['retry-after']);
    expect(Number.isInteger(retry)).toBe(true);
    expect(retry).toBeGreaterThanOrEqual(1);
    expect(retry).toBeLessThanOrEqual(60);
    expect(await count(p1.userId, 'STAFF_CUSTOMER_SEARCH')).toBe(20);
    expect(await count(p1.userId, 'STAFF_CUSTOMER_SEARCH_RATE_LIMITED')).toBe(1);
    // Le refus ne compte pas : un second refus, même instance ou l'autre, le même décompte de recherches.
    expect((await search(apps[1]!, p1)).status).toBe(429);
    expect(await count(p1.userId, 'STAFF_CUSTOMER_SEARCH')).toBe(20);
    expect(await count(p1.userId, 'STAFF_CUSTOMER_SEARCH_RATE_LIMITED')).toBe(2);
    // Une autre personne du même prestataire passe encore (limite par personne, pas par prestataire).
    expect((await search(apps[0]!, p2)).status).toBe(200);
    // Les lignes de refus ne portent aucun numéro.
    const rows = JSON.stringify(
      await ownerRows(`SELECT to_jsonb(a) AS row FROM audit_log a WHERE actor_id = $1`, [
        p1.userId,
      ]),
    );
    for (const needle of [number, number.slice(1), maskPhone(number), number.slice(-6)])
      expect(rows).not.toContain(needle);
    expect(rows).toContain('STAFF_CUSTOMER_SEARCH_RATE_LIMITED');
  });

  it('la limite vaut aussi pour des appels simultanés', async () => {
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) => search(apps[i % 2]!, p3)),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(20);
    expect(results.filter((r) => r.status === 429)).toHaveLength(10);
    expect(await count(p3.userId, 'STAFF_CUSTOMER_SEARCH')).toBe(20);
  });

  it('une recherche refusée pour droit ou pour format ne compte pas dans la limite', async () => {
    const res = await request(apps[0]!.getHttpServer())
      .post('/v1/search/customers')
      .set('Authorization', `Bearer ${p2.token}`)
      .send({ phone: '+22177' });
    expect(res.status).toBe(422);
    expect(await count(p2.userId, 'STAFF_CUSTOMER_SEARCH')).toBe(1);
  });
});

describe('STAFF_PHONE_SEARCH_PER_MINUTE', () => {
  const load = (value?: string) =>
    loadConfig({
      NODE_ENV: 'test',
      ...(value === undefined ? {} : { STAFF_PHONE_SEARCH_PER_MINUTE: value }),
    });

  it('20 par défaut ; réglable par un entier de 1 à 1000', () => {
    expect(load().staffPhoneSearchPerMinute).toBe(20);
    expect(load('5').staffPhoneSearchPerMinute).toBe(5);
    expect(load('1000').staffPhoneSearchPerMinute).toBe(1000);
  });

  it.each(['0', '-1', '1.5', 'abc', '1001', '20 '])('refuse « %s »', (value) => {
    expect(() => load(value)).toThrow(/STAFF_PHONE_SEARCH_PER_MINUTE/);
  });
});
