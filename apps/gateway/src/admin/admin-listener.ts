// Écouteur d'administration local (interfaces.md § 12.9, § 13.3), `GATEWAY_ADMIN_PORT`.
//
// LIÉ À LA BOUCLE LOCALE SEULE. En production, toute autre adresse REFUSE le démarrage (avant
// d'ouvrir le moindre port) ; l'adresse réellement liée est revérifiée après `listen`. Ce n'est
// pas le serveur des terminaux : une seule route, `POST /local/orders`, corps JSON borné. Contrôles
// d'hygiène en plus de la signature : `Host` de boucle locale (anti-rebond DNS), pas d'en-tête
// `Origin` (un navigateur en envoie un sur tout appel inter-origine), `Content-Type` JSON.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createServer as createTlsServer, type Server as TlsServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { isIP } from 'node:net';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { GATEWAY_CONFIG, type GatewayConfig } from '../config/config';
import { ADMIN_TLS_VIOLATION, adminTlsOptions } from '../purge/admin-tls';
import { LocalOrdersController } from './local-orders.controller';

export const MAX_ORDER_BODY_BYTES = 16 * 1024;

export class AdminBindError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminBindError';
  }
}

/** Boucle locale : `127.0.0.0/8`, `::1` (ou `localhost`, résolu par le système sur la boucle). */
export function isLoopbackAddress(host: string): boolean {
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (bare === 'localhost') return true;
  if (isIP(bare) === 4) return bare.startsWith('127.');
  if (isIP(bare) === 6) return bare === '::1' || bare === '0:0:0:0:0:0:0:1';
  return false;
}

/** Refuse en production toute adresse hors boucle locale. */
export function assertLoopbackBind(host: string, production: boolean): void {
  if (production && !isLoopbackAddress(host)) {
    throw new AdminBindError(
      'GATEWAY_ADMIN_PORT : écouteur d’administration hors boucle locale, interdit en production',
    );
  }
}

const HOST_HEADER = /^(127(\.\d{1,3}){3}|localhost|\[::1\])(:\d{1,5})?$/i;

@Injectable()
export class AdminListener {
  private readonly logger = new Logger('AdminListener');
  private server: Server | TlsServer | null = null;

  constructor(
    @Inject(GATEWAY_CONFIG) private readonly config: GatewayConfig,
    @Inject(LocalOrdersController) private readonly orders: LocalOrdersController,
  ) {}

  /** `host` par défaut `127.0.0.1` ; un test peut passer un autre (refusé en production). */
  async start(options: { host?: string; port?: number } = {}): Promise<number> {
    const host = options.host ?? '127.0.0.1';
    assertLoopbackBind(host, this.config.production);
    if (this.server) throw new Error('écouteur d’administration déjà démarré');
    // Décision 47 : TLS sur le port d'administration ; en production, pas de repli en clair.
    const tls = adminTlsOptions(this.config);
    if (tls === undefined && this.config.production) throw new AdminBindError(ADMIN_TLS_VIOLATION);
    const handler = (req: IncomingMessage, res: ServerResponse): void =>
      void this.onRequest(req, res);
    const server: Server | TlsServer = tls ? createTlsServer(tls, handler) : createServer(handler);
    server.headersTimeout = 10_000;
    server.requestTimeout = 15_000;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(options.port ?? this.config.adminPort, host, () => {
        server.off('error', reject);
        resolve();
      });
    });
    const address = server.address() as AddressInfo;
    try {
      assertLoopbackBind(address.address, this.config.production);
    } catch (error) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      throw error;
    }
    this.server = server;
    this.logger.log(`écouteur d’administration sur ${address.address}:${address.port}`);
    return address.port;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private reply(res: ServerResponse, status: number, body: Record<string, unknown>): void {
    const text = JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(text),
      'Cache-Control': 'no-store',
    });
    res.end(text);
  }

  private async onRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', 'http://local');
      if (url.pathname !== '/local/orders') return this.reply(res, 404, { code: 'NOT_FOUND' });
      if (req.method !== 'POST') return this.reply(res, 405, { code: 'METHOD_NOT_ALLOWED' });
      if (!HOST_HEADER.test(req.headers.host ?? '') || req.headers.origin !== undefined) {
        return this.reply(res, 403, { code: 'FORBIDDEN' });
      }
      if (!/^application\/json(\s*;.*)?$/i.test(req.headers['content-type'] ?? '')) {
        return this.reply(res, 415, { code: 'UNSUPPORTED_MEDIA_TYPE' });
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += (chunk as Buffer).length;
        if (size > MAX_ORDER_BODY_BYTES) return this.reply(res, 413, { code: 'TOO_LARGE' });
        chunks.push(chunk as Buffer);
      }
      let body: unknown;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return this.reply(res, 400, { code: 'MALFORMED' });
      }
      const result = await this.orders.handle(body);
      this.reply(res, result.status, result.body);
    } catch {
      if (!res.headersSent) this.reply(res, 500, { code: 'INTERNAL' });
    }
  }
}
