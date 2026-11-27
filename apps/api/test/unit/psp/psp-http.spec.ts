// Client HTTP sortant des PSP (mission 12b-1, WP01) : essais, délais, redirections, journal, garde réseau.
import { Logger } from '@nestjs/common';
import net from 'node:net';
import dns from 'node:dns';
import { PspHttpClient, PspHttpError, type PspHttpRequest } from '../../../src/psp/http/psp-http';
import { startFakeServer, type FakeServer } from '../../support/fake-servers/http-fake';

const noSleep = (): Promise<void> => Promise.resolve();

function request(server: FakeServer, over: Partial<PspHttpRequest> = {}): PspHttpRequest {
  return {
    provider: 'WAVE',
    operation: 'checkout',
    method: 'GET',
    url: `${server.url}/v1/ping`,
    idempotent: true,
    ...over,
  };
}

describe('PspHttpClient', () => {
  let server: FakeServer | null = null;
  let logs: string[];

  beforeEach(() => {
    logs = [];
    jest.spyOn(Logger.prototype, 'log').mockImplementation((message: unknown) => {
      logs.push(String(message));
    });
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await server?.close();
    server = null;
  });

  it('succès : statut, corps brut et en-têtes en minuscules', async () => {
    server = await startFakeServer((_req, res) => {
      res.setHeader('X-Test', 'a');
      res.end('{"ok":true}');
    });
    const response = await new PspHttpClient({ pspHttpTimeoutMs: 2000 }).send(request(server));
    expect(response.status).toBe(200);
    expect(response.body.toString()).toBe('{"ok":true}');
    expect(response.headers['x-test']).toBe('a');
    expect(server.requests).toHaveLength(1);
  });

  it('GET idempotent : 503 puis 200, deux requêtes reçues', async () => {
    let n = 0;
    server = await startFakeServer((_req, res) => {
      n += 1;
      res.statusCode = n === 1 ? 503 : 200;
      res.end('x');
    });
    const sleeps: number[] = [];
    const client = new PspHttpClient({ pspHttpTimeoutMs: 2000 }, async (ms) => {
      sleeps.push(ms);
    });
    const response = await client.send(request(server));
    expect(response.status).toBe(200);
    expect(server.requests).toHaveLength(2);
    expect(sleeps).toEqual([200]);
  });

  it('GET idempotent : au plus 2 nouveaux essais (3 requêtes), attentes 200 ms puis 800 ms', async () => {
    server = await startFakeServer((_req, res) => {
      res.statusCode = 500;
      res.end();
    });
    const sleeps: number[] = [];
    const client = new PspHttpClient({ pspHttpTimeoutMs: 2000 }, async (ms) => {
      sleeps.push(ms);
    });
    const response = await client.send(request(server));
    expect(response.status).toBe(500);
    expect(server.requests).toHaveLength(3);
    expect(sleeps).toEqual([200, 800]);
    expect(JSON.parse(logs[0]!)).toMatchObject({ status: 500, attempts: 3 });
  });

  it('Retry-After ≤ 5 s respecté ; au-delà, attente par défaut', async () => {
    let n = 0;
    server = await startFakeServer((_req, res) => {
      n += 1;
      if (n === 1) {
        res.statusCode = 429;
        res.setHeader('Retry-After', '2');
      } else if (n === 2) {
        res.statusCode = 429;
        res.setHeader('Retry-After', '60');
      }
      res.end();
    });
    const sleeps: number[] = [];
    const client = new PspHttpClient({ pspHttpTimeoutMs: 2000 }, async (ms) => {
      sleeps.push(ms);
    });
    expect((await client.send(request(server))).status).toBe(200);
    expect(sleeps).toEqual([2000, 800]);
  });

  it('POST non idempotent : 503 rendu tel quel, une seule requête', async () => {
    server = await startFakeServer((_req, res) => {
      res.statusCode = 503;
      res.end();
    });
    const response = await new PspHttpClient({ pspHttpTimeoutMs: 2000 }, noSleep).send(
      request(server, { method: 'POST', idempotent: false, body: '{}' }),
    );
    expect(response.status).toBe(503);
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]!.body.toString()).toBe('{}');
  });

  it('POST non idempotent sans réponse : TIMEOUT, jamais renvoyé', async () => {
    server = await startFakeServer(() => {
      /* ne répond jamais */
    });
    const client = new PspHttpClient({ pspHttpTimeoutMs: 150 }, noSleep);
    const error = await client
      .send(request(server, { method: 'POST', idempotent: false, body: 'x' }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PspHttpError);
    expect((error as PspHttpError).kind).toBe('TIMEOUT');
    expect(server.requests).toHaveLength(1);
  });

  it('GET idempotent sans réponse : TIMEOUT après 3 envois', async () => {
    server = await startFakeServer(() => {
      /* ne répond jamais */
    });
    const client = new PspHttpClient({ pspHttpTimeoutMs: 100 }, noSleep);
    const error = await client.send(request(server)).catch((e: unknown) => e);
    expect((error as PspHttpError).kind).toBe('TIMEOUT');
    expect(server.requests).toHaveLength(3);
  });

  it('serveur injoignable : NETWORK, message sans URL complète', async () => {
    server = await startFakeServer((_req, res) => {
      res.end();
    });
    const url = `${server.url}/secret/chemin?token=abc`;
    await server.close();
    const client = new PspHttpClient({ pspHttpTimeoutMs: 500 }, noSleep);
    const error = (await client
      .send(request(server, { method: 'POST', idempotent: false, url }))
      .catch((e: unknown) => e)) as PspHttpError;
    server = null;
    expect(error.kind).toBe('NETWORK');
    expect(error.message).toContain('WAVE checkout (127.0.0.1:');
    expect(error.message).not.toContain('/secret');
    expect(error.message).not.toContain('token');
  });

  it('redirection 302 : non suivie, rendue telle quelle', async () => {
    server = await startFakeServer((req, res) => {
      if (req.path === '/v1/ping') {
        res.statusCode = 302;
        res.setHeader('Location', '/ailleurs');
      }
      res.end();
    });
    const response = await new PspHttpClient({ pspHttpTimeoutMs: 2000 }, noSleep).send(
      request(server),
    );
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/ailleurs');
    expect(server.requests.map((r) => r.path)).toEqual(['/v1/ping']);
  });

  it('réponse de plus de 1 Mio : refusée (NETWORK)', async () => {
    server = await startFakeServer((_req, res) => {
      res.end(Buffer.alloc(1024 * 1024 + 10, 1));
    });
    const error = (await new PspHttpClient({ pspHttpTimeoutMs: 2000 }, noSleep)
      .send(request(server, { idempotent: false }))
      .catch((e: unknown) => e)) as PspHttpError;
    expect(error.kind).toBe('NETWORK');
  });

  it('journal : une ligne par appel, ni en-tête ni corps ni URL', async () => {
    server = await startFakeServer((_req, res) => {
      res.end('réponse-sensible');
    });
    await new PspHttpClient({ pspHttpTimeoutMs: 2000 }, noSleep).send(
      request(server, {
        method: 'POST',
        idempotent: false,
        headers: { Authorization: 'Bearer sk_secret_123' },
        body: 'corps-sensible',
        url: `${server.url}/v1/chemin-sensible`,
      }),
    );
    expect(logs).toHaveLength(1);
    const line = JSON.parse(logs[0]!) as Record<string, unknown>;
    expect(Object.keys(line).sort()).toEqual(
      ['attempts', 'durationMs', 'operation', 'provider', 'status'].sort(),
    );
    expect(line).toMatchObject({
      provider: 'WAVE',
      operation: 'checkout',
      status: 200,
      attempts: 1,
    });
    const text = logs.join('\n');
    for (const secret of ['sk_secret_123', 'Authorization', 'corps-sensible', 'chemin-sensible'])
      expect(text).not.toContain(secret);
    // L'en-tête a bien été envoyé au serveur (le journal l'ignore, la requête non).
    expect(server.requests[0]!.headers.authorization).toBe('Bearer sk_secret_123');
  });

  it('garde réseau : https://example.com refusé en test (aucune connexion)', async () => {
    const client = new PspHttpClient({ pspHttpTimeoutMs: 3000 }, noSleep);
    const error = (await client
      .send({
        provider: 'STRIPE',
        operation: 'charge',
        method: 'POST',
        url: 'https://example.com/v1/charges',
        idempotent: false,
      })
      .catch((e: unknown) => e)) as PspHttpError;
    expect(error).toBeInstanceOf(PspHttpError);
    expect(error.kind).toBe('NETWORK');
    expect(error.code).toBe('ERR_EXTERNAL_NETWORK_FORBIDDEN');
  });
});

describe('garde « aucun réseau externe »', () => {
  it('résolution de nom externe refusée', async () => {
    const error = await new Promise<NodeJS.ErrnoException | null>((resolve) =>
      dns.lookup('example.com', (err) => resolve(err)),
    );
    expect(error?.message).toBe('réseau externe interdit en test');
    await expect(dns.promises.lookup('example.com')).rejects.toThrow(
      'réseau externe interdit en test',
    );
  });

  it.each([
    ['IPv4 externe', '203.0.113.7'],
    ['IPv6 externe', '2001:db8::1'],
    ['nom externe', 'example.com'],
  ])('connexion directe (%s) refusée', async (_name, host) => {
    const error = await new Promise<Error>((resolve) => {
      const socket = net.connect({ host, port: 443 });
      socket.on('error', resolve);
    });
    expect(error.message).toBe('réseau externe interdit en test');
    const positional = await new Promise<Error>((resolve) => {
      const socket = net.connect(443, host);
      socket.on('error', resolve);
    });
    expect(positional.message).toBe('réseau externe interdit en test');
  });

  it.each(['127.0.0.1', '::1', 'localhost'])('connexion locale (%s) permise', async (host) => {
    const server = net.createServer((socket) => socket.end('ok'));
    await new Promise<void>((resolve) => server.listen(0, host, resolve));
    const { port } = server.address() as net.AddressInfo;
    const received = await new Promise<string>((resolve, reject) => {
      const socket = net.connect({ host, port });
      socket.on('data', (data) => resolve(data.toString()));
      socket.on('error', reject);
    });
    expect(received).toBe('ok');
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
