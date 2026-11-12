// Toute route du processus `edge`, hors `/v1/health`, refuse une requête sans certificat de passerelle valide (WP10,
// cycle 2). Les routes sont lues dans la table de routes d'Express (celle que Nest remplit), jamais d'une liste écrite
// à la main : une route ajoutée par WP12 ou après est couverte sans toucher ce test.
import 'reflect-metadata';
import { request } from 'node:https';
import { edgeTls, startEdge, type RunningEdge } from '../../../support/edge-fixtures';

interface RouteLayer {
  route?: { path: string; methods: Record<string, boolean> };
  handle?: { stack?: RouteLayer[] };
}

function registeredRoutes(edge: RunningEdge): { method: string; path: string }[] {
  const express = edge.app.getHttpAdapter().getInstance() as {
    router?: { stack: RouteLayer[] };
    _router?: { stack: RouteLayer[] };
  };
  const stack = express.router?.stack ?? express._router?.stack ?? [];
  const found: { method: string; path: string }[] = [];
  for (const layer of stack) {
    if (!layer.route) continue;
    for (const method of Object.keys(layer.route.methods))
      found.push({ method: method.toUpperCase(), path: layer.route.path });
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
    const paths = registeredRoutes(edge).map((r) => r.path);
    expect(paths.some((p) => p.endsWith('/edge/handovers/current'))).toBe(true);
    expect(paths.some((p) => p.includes('/debit-authority'))).toBe(true);
    expect(paths.some((p) => p.endsWith('/health'))).toBe(true);
  });

  it('chaque route enregistrée hors /health répond 401 (ou refus TLS) sans certificat', async () => {
    const routes = registeredRoutes(edge).filter((r) => !r.path.endsWith('/v1/health'));
    expect(routes.length).toBeGreaterThanOrEqual(2);
    const offenders: string[] = [];
    for (const { method, path } of routes) {
      const outcome = await call(method, path);
      if (outcome !== 401 && outcome !== 'tls-refused')
        offenders.push(`${method} ${path} -> ${outcome}`);
    }
    expect(offenders).toEqual([]);
  });
});
