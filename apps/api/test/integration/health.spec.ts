// Intégration : santé avec la base locale, X-Request-Id, erreurs problem+json et langue.
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../support/app';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('santé et garanties transverses', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /v1/health : 200 avec la base', async () => {
    const res = await request(app.getHttpServer()).get('/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: 'ok' });
  });

  it('X-Request-Id généré s’il est absent ou invalide, repris s’il est un UUID', async () => {
    const generated = await request(app.getHttpServer()).get('/v1/health');
    expect(generated.headers['x-request-id']).toMatch(UUID);
    const invalid = await request(app.getHttpServer()).get('/v1/health').set('X-Request-Id', 'pas-un-uuid');
    expect(invalid.headers['x-request-id']).toMatch(UUID);
    const id = '6f1c2b8e-3d4a-4f5b-8c9d-0e1f2a3b4c5d';
    const echoed = await request(app.getHttpServer()).get('/v1/health').set('X-Request-Id', id);
    expect(echoed.headers['x-request-id']).toBe(id);
  });

  it('route inconnue : 404 problem+json, titre en français par défaut', async () => {
    const id = '0b0c7a1e-1111-4222-8333-944455566677';
    const res = await request(app.getHttpServer()).get('/v1/nulle-part').set('X-Request-Id', id);
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(JSON.parse(res.text)).toEqual({
      type: 'https://errors.cashless/NOT_FOUND',
      title: 'Introuvable',
      status: 404,
      detail: "L'objet demandé n'existe pas.",
      code: 'NOT_FOUND',
      instance: id,
    });
  });

  it('Accept-Language: en → titre anglais, même code et même statut', async () => {
    const res = await request(app.getHttpServer()).get('/v1/nulle-part').set('Accept-Language', 'en');
    const body = JSON.parse(res.text);
    expect(res.status).toBe(404);
    expect(body.title).toBe('Not found');
    expect(body.code).toBe('NOT_FOUND');
  });
});
