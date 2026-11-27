// Faux serveur HTTP local (127.0.0.1, port libre, sans TLS) : les tests des adaptateurs de PSP vérifient ce que
// l'adaptateur envoie (méthode, chemin, en-têtes, corps brut) sans jamais joindre un hôte externe.
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
} from 'node:http';
import type { ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

export interface RecordedRequest {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

export type FakeHandler = (req: RecordedRequest, res: ServerResponse) => void | Promise<void>;

export interface FakeServer {
  /** `http://127.0.0.1:<port>` (sans barre finale). */
  url: string;
  requests: RecordedRequest[];
  close(): Promise<void>;
}

export async function startFakeServer(handler: FakeHandler): Promise<FakeServer> {
  const requests: RecordedRequest[] = [];
  const sockets = new Set<Socket>();
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const recorded: RecordedRequest = {
        method: req.method ?? '',
        path: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks),
      };
      requests.push(recorded);
      Promise.resolve(handler(recorded, res)).catch(() => {
        if (!res.headersSent) res.statusCode = 500;
        res.end();
      });
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
