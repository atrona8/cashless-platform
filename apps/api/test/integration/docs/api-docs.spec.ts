// Documentation interactive (décision du porteur, 05/11/2026) : Swagger UI affiche le contrat tel quel, hors
// production seulement. En production les routes ne sont pas montées (404), et rien n'est affaibli ailleurs.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loadConfig } from '../../../src/config/config';
import {
  DOCS_CONTENT_SECURITY_POLICY,
  SWAGGER_UI_BUNDLE,
  SWAGGER_UI_CSS,
} from '../../../src/docs/api-docs';
import { createTestApp } from '../../support/app';
import { DEVICE_PRODUCTION } from '../../support/tls';

const CONTRACT = join(__dirname, '../../../../../packages/contracts/openapi.yaml');

// Même configuration de production que test/unit/config.spec.ts.
const PRODUCTION = {
  NODE_ENV: 'production',
  DATABASE_URL_APP: 'postgres://cashless_app:secret@db.internal:5432/cashless',
  DATABASE_URL_PLATFORM: 'postgres://cashless_platform:secret@db.internal:5432/cashless',
  OIDC_ISSUER: 'https://id.cashless.example',
  OIDC_AUDIENCE: 'cashless-api',
  OIDC_APPROVAL_AUDIENCE: 'cashless-approval',
  OIDC_JWKS_URI: 'https://id.cashless.example/.well-known/jwks.json',
  CLAIM_CODE_HMAC_KEY: 'ab'.repeat(32),
  TAG_WRAPPING_KEY_REF: 'arn:aws:kms:eu-west-3:1:key/wrap',
  CLAIM_CODE_DOMAIN: 'pay.example.org',
  TRUST_PROXY_HOPS: '1',
  ...DEVICE_PRODUCTION,
};

const ROUTES = ['/docs', '/docs/openapi.yaml', '/docs/init.js'];

describe('documentation interactive hors production', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp({ apiDocs: loadConfig({ NODE_ENV: 'test' }) });
  });
  afterAll(async () => {
    await app.close();
  });

  it('GET /docs : page HTML, Swagger UI du CDN épinglé avec SRI, aucun script en ligne', async () => {
    const res = await request(app.getHttpServer()).get('/docs');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    expect(res.text).toContain(SWAGGER_UI_CSS.url);
    expect(res.text).toContain(`integrity="${SWAGGER_UI_CSS.integrity}"`);
    expect(res.text).toContain(SWAGGER_UI_BUNDLE.url);
    expect(res.text).toContain(`integrity="${SWAGGER_UI_BUNDLE.integrity}"`);
    expect(SWAGGER_UI_CSS.url).toBe(
      'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.34.0/swagger-ui.css',
    );
    expect(SWAGGER_UI_CSS.integrity).toBe(
      'sha384-4c3vsE5f+trhFyHrFrLM1fFGUn531NIaC7dcqEWIJdoRQJ5CkJbSuSCwXLpaS1KF',
    );
    expect(SWAGGER_UI_BUNDLE.url).toBe(
      'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.34.0/swagger-ui-bundle.js',
    );
    expect(SWAGGER_UI_BUNDLE.integrity).toBe(
      'sha384-9Td7MKiIr2S83E1kZyyVi8KdJw/S8CpAvu0llLyMeg0xq/hDGiZJfVn0fV4llCmK',
    );
    expect(res.text).toContain('crossorigin="anonymous"');
    const scripts = [...res.text.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0]);
    expect(scripts.length).toBeGreaterThan(0);
    for (const tag of scripts) expect(tag).toMatch(/\bsrc="/);
  });

  it('GET /docs/openapi.yaml : les octets du contrat, type YAML', async () => {
    const res = await request(app.getHttpServer())
      .get('/docs/openapi.yaml')
      .buffer(true)
      .parse((r, done) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => done(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/yaml/);
    expect((res.body as Buffer).equals(readFileSync(CONTRACT))).toBe(true);
  });

  it('GET /docs/init.js : JavaScript qui charge le contrat servi', async () => {
    const res = await request(app.getHttpServer()).get('/docs/init.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/javascript/);
    expect(res.text).toContain("url: '/docs/openapi.yaml'");
    expect(res.text).toContain("dom_id: '#swagger-ui'");
  });

  it('CSP propre aux routes /docs, sans script en ligne ni origine inattendue ; rien de global', async () => {
    for (const path of ROUTES) {
      const res = await request(app.getHttpServer()).get(path);
      expect(res.headers['content-security-policy']).toBe(DOCS_CONTENT_SECURITY_POLICY);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    }
    const script = DOCS_CONTENT_SECURITY_POLICY.split('; ').find((d) => d.startsWith('script-src'));
    expect(script).toBe("script-src 'self' https://cdn.jsdelivr.net");
    const health = await request(app.getHttpServer()).get('/v1/health');
    expect(health.status).toBe(200);
    expect(health.headers['content-security-policy']).toBeUndefined();
  });
});

describe('documentation interactive en production', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const config = loadConfig(PRODUCTION);
    expect(config.production).toBe(true);
    app = await createTestApp({ apiDocs: config });
  });
  afterAll(async () => {
    await app.close();
  });

  it.each(ROUTES)(
    'GET %s : 404 comme toute route inconnue, sans CSP de documentation',
    async (path) => {
      const res = await request(app.getHttpServer()).get(path);
      expect(res.status).toBe(404);
      expect(res.headers['content-security-policy']).toBeUndefined();
      expect(res.text).not.toContain('swagger');
      const unknown = await request(app.getHttpServer()).get('/nulle-part');
      expect(res.status).toBe(unknown.status);
      expect(res.headers['content-type']).toBe(unknown.headers['content-type']);
    },
  );

  it('les autres routes gardent leurs en-têtes (aucune CSP posée, health inchangé)', async () => {
    const res = await request(app.getHttpServer()).get('/v1/health');
    expect(res.status).toBe(200);
    expect(res.headers['content-security-policy']).toBeUndefined();
  });
});

describe('documentation interactive : processus', () => {
  it('seul le point d’entrée de l’API publique la demande à serve', () => {
    const src = join(__dirname, '../../../src');
    const askers = readdirSync(src)
      .filter((f) => /^main.*\.ts$/.test(f))
      .filter((f) => /apiDocs:\s*true/.test(readFileSync(join(src, f), 'utf8')));
    expect(askers).toEqual(['main.ts']);
  });
});
