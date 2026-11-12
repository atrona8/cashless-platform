// Les trois routes de WP12 sont nommées (cycle 2) : `ackEdgeHandover`, `releaseEdgeHandover`, `getEdgeReplicationFeed`
// sont enregistrées sur le processus `edge` et refusent une requête sans certificat de passerelle. Le balayage
// dynamique de `process/edge-routes-auth.spec.ts` les couvre déjà ; ici une disparition ou un renommage échoue
// par son nom.
import 'reflect-metadata';
import { request } from 'node:https';
import { edgeTls, startEdge, type RunningEdge } from '../../../support/edge-fixtures';

interface RouteLayer {
  route?: { path: string; methods: Record<string, boolean> };
}

const NAMED = [
  { name: 'ackEdgeHandover', method: 'POST', suffix: '/edge/handovers/:handover_id/ack' },
  { name: 'releaseEdgeHandover', method: 'POST', suffix: '/edge/handovers/:handover_id/release' },
  { name: 'getEdgeReplicationFeed', method: 'GET', suffix: '/edge/replication-feed' },
] as const;

describe('routes de WP12 : présentes et fermées sans certificat', () => {
  let edge: RunningEdge;
  beforeAll(async () => {
    edge = await startEdge();
  });
  afterAll(async () => {
    await edge?.close();
  });

  const registered = (): { method: string; path: string }[] => {
    const express = edge.app.getHttpAdapter().getInstance() as {
      router?: { stack: RouteLayer[] };
      _router?: { stack: RouteLayer[] };
    };
    const stack = express.router?.stack ?? express._router?.stack ?? [];
    return stack.flatMap((layer) =>
      layer.route
        ? Object.keys(layer.route.methods).map((m) => ({
            method: m.toUpperCase(),
            path: layer.route!.path,
          }))
        : [],
    );
  };

  const withoutCert = async (method: string, path: string): Promise<number | 'tls-refused'> => {
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

  it.each(NAMED)('$name ($method $suffix) : enregistrée, 401 sans certificat', async (route) => {
    const found = registered().find(
      (r) => r.method === route.method && r.path.endsWith(route.suffix),
    );
    expect(found).toBeDefined();
    const outcome = await withoutCert(route.method, found!.path);
    expect([401, 'tls-refused']).toContain(outcome);
  });
});
