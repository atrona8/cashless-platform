// Toute route du processus `edge`, hors `/v1/health`, refuse une requête sans certificat de passerelle valide (WP10,
// cycle 2). Les routes sont lues dans la table de routes d'Express (celle que Nest remplit), jamais d'une liste écrite
// à la main : une route ajoutée par WP12 ou après est couverte sans toucher ce test.
import 'reflect-metadata';
import { request } from 'node:https';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import { API_PREFIX } from '../../../../src/config/config';
import { edgeTls, startEdge, type RunningEdge } from '../../../support/edge-fixtures';

/**
 * Routes réelles : méthode HTTP + chemin déclarés par les contrôleurs de l'application (métadonnées Nest),
 * préfixées par le préfixe global. Le routeur Express n'est pas une source fiable : depuis
 * `@nestjs/platform-express` 11.2.9, le montage d'un middleware à chemin exact (préfixe global `/v1`) y est
 * enregistré par `router.all('/v1')`, soit 36 « routes » qui ne sont pas des routes de contrôleur.
 */
function controllerRoutes(edge: RunningEdge): { method: string; path: string }[] {
  const modules = edge.app.get(ModulesContainer, { strict: false });
  const join = (...parts: string[]): string =>
    '/' +
    parts
      .map((p) => p.replace(/^\/+|\/+$/g, ''))
      .filter(Boolean)
      .join('/');
  const asList = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : [String(v ?? '')]);
  const found: { method: string; path: string }[] = [];
  for (const mod of modules.values()) {
    for (const { metatype } of mod.controllers.values()) {
      if (!metatype) continue;
      const base = asList(Reflect.getMetadata(PATH_METADATA, metatype));
      const proto = metatype.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = proto[name];
        if (typeof handler !== 'function') continue;
        const verb = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
        if (verb === undefined) continue;
        const own = asList(Reflect.getMetadata(PATH_METADATA, handler));
        const method = verb === RequestMethod.ALL ? 'POST' : RequestMethod[verb]!;
        for (const b of base)
          for (const o of own) found.push({ method, path: join(API_PREFIX, b, o) });
      }
    }
  }
  return found;
}

describe('processus edge : aucune route sans certificat de passerelle', () => {
  let edge: RunningEdge;
  beforeAll(async () => {
    edge = await startEdge();
  });
  afterAll(async () => {
    await edge?.close();
  });

  const call = async (method: string, path: string): Promise<number | 'tls-refused'> => {
    const { tls } = await edgeTls();
    return new Promise((resolve) => {
      const req = request(
        {
          host: '127.0.0.1',
          port: edge.port,
          method,
          path: path.replace(/:[A-Za-z_]+/g, '00000000-0000-4000-8000-000000000000'),
          ca: tls.serverCaPem,
          servername: 'localhost',
          headers: { 'content-type': 'application/json', 'content-length': '2' },
          timeout: 10_000,
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode ?? 0));
        },
      );
      req.on('error', () => resolve('tls-refused'));
      req.end('{}');
    });
  };

  it('la table de routes n’est pas vide et contient les routes connues', () => {
    const paths = controllerRoutes(edge).map((r) => r.path);
    expect(paths.some((p) => p.endsWith('/edge/handovers/current'))).toBe(true);
    expect(paths.some((p) => p.includes('/debit-authority'))).toBe(true);
    expect(paths.some((p) => p.endsWith('/health'))).toBe(true);
  });

  it('chaque route enregistrée hors /health répond 401 (ou refus TLS) sans certificat', async () => {
    const routes = controllerRoutes(edge).filter((r) => !r.path.endsWith('/v1/health'));
    // Garde contre un test à vide : des routes `/edge/*` sont bien vues.
    expect(routes.filter((r) => r.path.includes('/edge/')).length).toBeGreaterThanOrEqual(2);
    const offenders: string[] = [];
    for (const { method, path } of routes) {
      const outcome = await call(method, path);
      if (outcome !== 401 && outcome !== 'tls-refused')
        offenders.push(`${method} ${path} -> ${outcome}`);
    }
    expect(offenders).toEqual([]);
  });
});
