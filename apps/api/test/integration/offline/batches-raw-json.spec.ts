// Lecture JSON brute d'un lot (lot WP18, T072, contrôles 1 et 2) : numéros lus sur le texte source, sans base.
import { parseWithSafeIntegers } from '../../../src/offline/batches/raw-json';
import { batchBodyMiddleware } from '../../../src/offline/batches/batch-body';
import { SEQ_FIELDS } from '../../../src/offline/batches/batch.types';
import { createTestApp } from '../../support/app';
import request from 'supertest';

const parse = (text: string) => parseWithSafeIntegers(text, SEQ_FIELDS);
const refusal = (text: string): { status: number; detail: string } => {
  try {
    parse(text);
  } catch (e) {
    return e as { status: number; detail: string };
  }
  throw new Error('aucun refus');
};

describe('parseWithSafeIntegers (contrôle 2)', () => {
  it('2^53 - 1 passe', () => {
    expect(parse('{"seq":9007199254740991}')).toEqual({ seq: 9007199254740991 });
  });
  it('2^53 est refusé, sans la valeur dans le message', () => {
    const e = refusal('{"seq":9007199254740992}');
    expect(e.status).toBe(400);
    expect(e.detail).toContain('/seq');
    expect(e.detail).not.toContain('9007199254740992');
  });
  it('17 chiffres refusé avec pointeur de l’opération', () => {
    const e = refusal(
      '{"header":{},"operations":[{"seq":1},{"seq":2},{"seq":3},{"seq":12345678901234567}]}',
    );
    expect(e.detail).toContain('/operations/3/seq');
    expect(e.detail).not.toContain('12345678901234567');
  });
  it.each(['seq_to', 'seq_from', 'reverses_seq'])('%s aussi', (field) => {
    expect(refusal(`{"header":{"${field}":9007199254740993}}`).status).toBe(400);
  });
  it.each(['1.5', '1e3', '-4', '1.0'])('fractionnaire, exposant, négatif (%s)', (lit) => {
    expect(refusal(`{"seq":${lit}}`).status).toBe(400);
  });
  it('JSON invalide : 400', () => {
    expect(refusal('{"seq":').status).toBe(400);
  });
  it('un autre champ n’est pas contrôlé', () => {
    expect(parse('{"amount":9007199254740993}')).toBeDefined();
  });
});

describe('limite de corps propre à la route', () => {
  it('une autre route refuse toujours un corps de 200 ko', async () => {
    const app = await createTestApp();
    try {
      const res = await request(app.getHttpServer())
        .post('/v1/device/heartbeat')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ pad: 'x'.repeat(200_000) }));
      expect(res.status).toBeGreaterThanOrEqual(400); // 500 aujourd’hui (statut du body-parser non traduit, préexistant)
    } finally {
      await app.close();
    }
  });
  it('le middleware ignore les autres routes', () => {
    const next = jest.fn();
    batchBodyMiddleware({ method: 'POST', path: '/v1/other' } as never, {} as never, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
