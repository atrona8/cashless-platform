// Client HTTPS à certificat client pour les preuves de cloisonnement (NFR-011) : une requête
// avec le
// certificat voulu (passerelle, terminal, aucun), la réponse brute, et le refus au niveau TLS rendu
// comme un statut 0 (une coupure de la poignée de main est un refus comme un autre).
import { createHash, X509Certificate, webcrypto } from 'node:crypto';
import https from 'node:https';
import * as x509 from '@peculiar/x509';
import type { FakeEdgeCa } from '../../../api/src/edge/ca/fake-edge-ca';

x509.cryptoProvider.set(webcrypto as never);
const EC = { name: 'ECDSA', namedCurve: 'P-256' } as const;

export interface ClientCertificate {
  certPem: string;
  keyPem: string;
  sha256: Buffer;
}

export interface MtlsReply {
  status: number;
  text: string;
  json: Record<string, unknown> | null;
}

/** Certificat client signé par l'autorité des passerelles du banc (empreinte comprise). */
export async function issueGatewayCertificate(
  ca: FakeEdgeCa,
  serial: string,
): Promise<ClientCertificate> {
  const keys = await webcrypto.subtle.generateKey(EC, true, ['sign', 'verify']);
  const csr = await x509.Pkcs10CertificateRequestGenerator.create({
    name: `CN=${serial}`,
    keys,
    signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
  });
  const certPem = await ca.issue(csr.toString('pem'), serial);
  const pkcs8 = await webcrypto.subtle.exportKey('pkcs8', keys.privateKey);
  return {
    certPem,
    keyPem: x509.PemConverter.encode(pkcs8, 'PRIVATE KEY'),
    sha256: createHash('sha256').update(new X509Certificate(certPem).raw).digest(),
  };
}

export function mtlsRequest(
  url: string,
  method: 'GET' | 'POST',
  options: {
    ca: string;
    client?: { certPem: string; keyPem: string } | null;
    body?: unknown;
    headers?: Record<string, string>;
  },
): Promise<MtlsReply> {
  const target = new URL(url);
  const payload = options.body === undefined ? '' : JSON.stringify(options.body);
  return new Promise((resolve) => {
    const req = https.request(
      {
        host: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method,
        ca: options.ca,
        servername: 'localhost',
        ...(options.client ? { cert: options.client.certPem, key: options.client.keyPem } : {}),
        headers: {
          ...(method === 'POST'
            ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }
            : {}),
          ...options.headers,
        },
        timeout: 30_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json: Record<string, unknown> | null = null;
          try {
            json = JSON.parse(text) as Record<string, unknown>;
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode ?? 0, text, json });
        });
      },
    );
    req.on('error', () => resolve({ status: 0, text: '', json: null }));
    req.on('timeout', () => req.destroy());
    req.end(method === 'POST' ? payload : undefined);
  });
}
