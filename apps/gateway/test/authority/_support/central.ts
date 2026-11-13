import 'reflect-metadata';
// Faux central de test : serveur HTTPS (mTLS demandé) qui enregistre les requêtes et répond selon
// un script. Ce n'est PAS le vrai central (WP10 à WP13).
import { webcrypto } from 'node:crypto';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import {
  BasicConstraintsExtension,
  SubjectAlternativeNameExtension,
  X509CertificateGenerator,
} from '@peculiar/x509';

const subtle = webcrypto.subtle;
const ALG = { name: 'ECDSA', namedCurve: 'P-256' } as const;

export interface TestCert {
  certPem: string;
  keyPem: string;
}

/** Certificat auto-signé P-256 avec SAN 127.0.0.1 / localhost : sert d'ancre épinglée. */
export async function selfSigned(cn: string): Promise<TestCert> {
  const keys = await subtle.generateKey(ALG, true, ['sign', 'verify']);
  const cert = await X509CertificateGenerator.createSelfSigned({
    name: `CN=${cn}`,
    keys,
    signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
    notBefore: new Date(Date.now() - 3_600_000),
    notAfter: new Date(Date.now() + 86_400_000),
    extensions: [
      new BasicConstraintsExtension(true, undefined, true),
      new SubjectAlternativeNameExtension([
        { type: 'ip', value: '127.0.0.1' },
        { type: 'dns', value: 'localhost' },
      ]),
    ],
  });
  const pkcs8 = Buffer.from(await subtle.exportKey('pkcs8', keys.privateKey));
  const b64 = (b: Buffer): string => (b.toString('base64').match(/.{1,64}/g) ?? []).join('\n');
  return {
    certPem: cert.toString('pem'),
    keyPem: `-----BEGIN PRIVATE KEY-----\n${b64(pkcs8)}\n-----END PRIVATE KEY-----\n`,
  };
}

export interface Recorded {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  clientCertPresent: boolean;
}

export interface Reply {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** Ne répond jamais (attente longue). */
  hold?: boolean;
  /** Coupe la connexion sans répondre. */
  destroy?: boolean;
  /** Annonce 200 octets puis coupe après quelques-uns. */
  truncate?: boolean;
}

export type Script = (request: Recorded, index: number) => Reply;

export class FakeCentral {
  readonly requests: Recorded[] = [];
  script: Script = () => ({ status: 200, body: emptyState() });
  private server!: Server;
  private readonly held: Array<() => void> = [];

  constructor(readonly cert: TestCert) {}

  static async start(cert?: TestCert): Promise<FakeCentral> {
    const central = new FakeCentral(cert ?? (await selfSigned('central-test')));
    central.server = createServer(
      {
        key: central.cert.keyPem,
        cert: central.cert.certPem,
        requestCert: true,
        rejectUnauthorized: false,
      },
      (req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          const url = new URL(req.url ?? '/', 'https://x');
          const text = Buffer.concat(chunks).toString('utf8');
          const recorded: Recorded = {
            method: req.method ?? '',
            path: url.pathname,
            query: url.searchParams,
            headers: req.headers,
            body: text === '' ? null : JSON.parse(text),
            clientCertPresent:
              Object.keys(
                (req.socket as unknown as { getPeerCertificate(): object }).getPeerCertificate(),
              ).length > 0,
          };
          central.requests.push(recorded);
          const reply = central.script(recorded, central.requests.length - 1);
          if (reply.destroy) return void req.socket.destroy();
          if (reply.hold) {
            central.held.push(() => res.end());
            return;
          }
          const payload = Buffer.from(JSON.stringify(reply.body ?? {}));
          if (reply.truncate) {
            res.writeHead(reply.status ?? 200, {
              'Content-Type': 'application/json',
              'Content-Length': payload.length + 200,
            });
            res.write(payload.subarray(0, 10));
            setTimeout(() => req.socket.destroy(), 20);
            return;
          }
          res.writeHead(reply.status ?? 200, {
            'Content-Type': 'application/json',
            'Content-Length': payload.length,
            ...(reply.headers ?? {}),
          });
          res.end(payload);
        });
      },
    );
    await new Promise<void>((resolve) => central.server.listen(0, '127.0.0.1', resolve));
    return central;
  }

  get url(): string {
    return `https://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  count(method: string, pathPart: string): number {
    return this.requests.filter((r) => r.method === method && r.path.includes(pathPart)).length;
  }

  async stop(): Promise<void> {
    for (const release of this.held) release();
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

export function emptyState(epoch = 0): Record<string, unknown> {
  return {
    ledger_id: '44444444-4444-4444-8444-444444444444',
    authority: 'CENTRAL',
    epoch,
    edge_gateway_id: null,
    edge_base_url: null,
    handover: null,
  };
}

export function stateWith(
  handover: Record<string, unknown> | null,
  authority: 'CENTRAL' | 'EDGE',
  epoch: number,
): Record<string, unknown> {
  return { ...emptyState(epoch), authority, handover };
}

export function handover(over: Record<string, unknown>): Record<string, unknown> {
  return {
    handover_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    direction: 'TO_EDGE',
    state: 'GRANTED',
    epoch: 5,
    central_watermark_posting_id: 100,
    requested_at: '2026-11-06T10:00:00Z',
    ...over,
  };
}
