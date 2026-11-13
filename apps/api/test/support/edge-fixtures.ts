// Fixtures du processus `edge` (mission passerelle-locale, WP10) : autorité de test des passerelles et certificats
// clients générés à l'exécution (rien n'est écrit dans le dépôt), démarrage réel du processus (vrai `NestFactory`,
// vrai écouteur TLS), requêtes HTTPS avec certificat client, et monde de base (prestataire, événements, grands livres,
// passerelles) posé par le propriétaire.
import 'reflect-metadata';
import { createHash, randomUUID, webcrypto } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import * as x509 from '@peculiar/x509';
import type { Client } from 'pg';
import { serve } from '../../src/processes/bootstrap';
import { EdgeProcessModule } from '../../src/processes/edge.module';
import { EDGE_URL } from './db';
import { testTls, type TestTls } from './tls';

x509.cryptoProvider.set(webcrypto as never);
const EC_P256 = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const ECDSA_SHA256 = { name: 'ECDSA', hash: 'SHA-256' } as const;
const DAY = 86_400_000;

export interface ClientCert {
  certPem: string;
  keyPem: string;
  sha256: Buffer;
}

export interface TestAuthority {
  certPem: string;
  /** Émet un certificat client signé par cette autorité. */
  issue(commonName: string, options?: { expired?: boolean }): Promise<ClientCert>;
}

async function authorityFrom(
  name: string,
  existing?: { certPem: string; keyPem: string },
): Promise<TestAuthority> {
  let cert: x509.X509Certificate;
  let signingKey: webcrypto.CryptoKey;
  if (existing) {
    cert = new x509.X509Certificate(existing.certPem);
    signingKey = await webcrypto.subtle.importKey(
      'pkcs8',
      x509.PemConverter.decodeFirst(existing.keyPem),
      EC_P256,
      false,
      ['sign'],
    );
  } else {
    const keys = await webcrypto.subtle.generateKey(EC_P256, true, ['sign', 'verify']);
    cert = await x509.X509CertificateGenerator.createSelfSigned({
      serialNumber: '01' + randomUUID().replace(/-/g, ''),
      name,
      notBefore: new Date(Date.now() - DAY),
      notAfter: new Date(Date.now() + 30 * DAY),
      signingAlgorithm: ECDSA_SHA256,
      keys,
      extensions: [
        new x509.BasicConstraintsExtension(true, 0, true),
        new x509.KeyUsagesExtension(
          x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign,
          true,
        ),
        await x509.SubjectKeyIdentifierExtension.create(keys.publicKey),
      ],
    });
    signingKey = keys.privateKey;
  }
  return {
    certPem: cert.toString('pem'),
    async issue(commonName, options = {}) {
      const keys = await webcrypto.subtle.generateKey(EC_P256, true, ['sign', 'verify']);
      const notAfter = options.expired
        ? new Date(Date.now() - DAY)
        : new Date(Date.now() + 7 * DAY);
      const issued = await x509.X509CertificateGenerator.create({
        serialNumber: '01' + randomUUID().replace(/-/g, ''),
        subject: `CN=${commonName}`,
        issuer: cert.subjectName,
        notBefore: new Date(Date.now() - 3 * DAY),
        notAfter,
        signingAlgorithm: ECDSA_SHA256,
        publicKey: keys.publicKey,
        signingKey,
        extensions: [
          new x509.BasicConstraintsExtension(false, undefined, true),
          new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true),
          new x509.ExtendedKeyUsageExtension([x509.ExtendedKeyUsage.clientAuth], false),
        ],
      });
      const pkcs8 = await webcrypto.subtle.exportKey('pkcs8', keys.privateKey);
      return {
        certPem: issued.toString('pem'),
        keyPem: x509.PemConverter.encode(pkcs8, 'PRIVATE KEY'),
        sha256: createHash('sha256').update(Buffer.from(issued.rawData)).digest(),
      };
    },
  };
}

export interface EdgeTls {
  tls: TestTls;
  /** Autorité de test des passerelles (distincte de celle des terminaux). */
  edgeCa: TestAuthority;
  /** Autorité de test des terminaux (celle de `tls.deviceCaCertFile`). */
  deviceCa: TestAuthority;
  edgeCaCertFile: string;
}

let pending: Promise<EdgeTls> | null = null;

/** Autorités de test de ce fichier de test (générées au premier appel). */
export function edgeTls(): Promise<EdgeTls> {
  pending ??= (async () => {
    const tls = await testTls();
    const edgeCa = await authorityFrom('CN=Autorite de test des passerelles Cashless');
    const deviceCa = await authorityFrom('CN=terminaux', {
      certPem: tls.deviceCaCertPem,
      keyPem: tls.deviceCaKeyPem,
    });
    const edgeCaCertFile = join(tls.dir, 'edge-ca.crt');
    writeFileSync(edgeCaCertFile, edgeCa.certPem, { mode: 0o600 });
    return { tls, edgeCa, deviceCa, edgeCaCertFile };
  })();
  return pending;
}

export interface RunningEdge {
  app: INestApplication;
  port: number;
  close(): Promise<void>;
}

const ENV_KEYS = [
  'EDGE_TLS_CERT_FILE',
  'EDGE_TLS_KEY_FILE',
  'EDGE_CA_CERT_FILE',
  'EDGE_LISTEN_PORT',
  'DATABASE_URL_EDGE',
] as const;

/**
 * Démarre le processus `edge` par `serve` (vrai `NestFactory`, vrai écouteur HTTPS de l'écouteur `edge`) sur un port
 * libre. Les réglages TLS des passerelles sont ceux de `edgeTls()`.
 */
export async function startEdge(
  env: Record<string, string | undefined> = {},
): Promise<RunningEdge> {
  const { tls, edgeCaCertFile } = await edgeTls();
  const saved = ENV_KEYS.map((key) => [key, process.env[key]] as const);
  process.env.EDGE_TLS_CERT_FILE = tls.tlsCertFile;
  process.env.EDGE_TLS_KEY_FILE = tls.tlsKeyFile;
  process.env.EDGE_CA_CERT_FILE = edgeCaCertFile;
  process.env.DATABASE_URL_EDGE = EDGE_URL;
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const create = jest.spyOn(NestFactory, 'create');
  try {
    await serve(EdgeProcessModule, 0, { listener: 'edge' });
    const app = (await create.mock.results[0]?.value) as INestApplication;
    return {
      app,
      port: (app.getHttpServer().address() as AddressInfo).port,
      close: async () => {
        await app.close();
      },
    };
  } catch (error) {
    // Refus après la création de l'application (garde de production) : on ferme ce qui a été créé.
    const app = (await create.mock.results[0]?.value.catch(() => undefined)) as
      | INestApplication
      | undefined;
    await app?.close().catch(() => undefined);
    throw error;
  } finally {
    create.mockRestore();
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

export interface Reply {
  status: number;
  body: string;
  json: Record<string, unknown> | null;
  elapsedMs: number;
}

/** GET HTTPS sur le processus `edge`, avec ou sans certificat client. */
export async function edgeGet(
  port: number,
  path: string,
  options: { client?: ClientCert; headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<Reply> {
  const { tls } = await edgeTls();
  const started = Date.now();
  return new Promise<Reply>((resolve, reject) => {
    const req = httpsRequest(
      {
        host: '127.0.0.1',
        port,
        path: `/v1${path}`,
        method: 'GET',
        ca: tls.serverCaPem,
        servername: 'localhost',
        ...(options.client ? { cert: options.client.certPem, key: options.client.keyPem } : {}),
        headers: options.headers,
        timeout: options.timeoutMs ?? 40_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          let json: Record<string, unknown> | null = null;
          try {
            json = JSON.parse(body) as Record<string, unknown>;
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode ?? 0, body, json, elapsedMs: Date.now() - started });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

export interface EdgeWorld {
  operatorId: string;
  otherOperatorId: string;
  eventId: string;
  ledgerId: string;
  otherEventId: string;
  otherLedgerId: string;
  foreignLedgerId: string;
}

/**
 * Monde de base posé par le propriétaire : un prestataire avec deux événements (donc deux grands livres) et un
 * second prestataire avec un événement. Aucun nettoyage (le grand livre est en ajout seul) : chaque suite a ses
 * propres identifiants.
 */
export async function seedEdgeWorld(owner: Client): Promise<EdgeWorld> {
  const operatorId = randomUUID();
  const otherOperatorId = randomUUID();
  const jurisdiction = randomUUID();
  await owner.query(
    `INSERT INTO party (kind, legal_name) SELECT 'PLATFORM', 'Plateforme (test)'
      WHERE NOT EXISTS (SELECT 1 FROM party WHERE kind = 'PLATFORM')`,
  );
  await owner.query(
    `INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination)
     VALUES ($1, 'SN', $2, '2026-01-01', 'ORGANIZER')`,
    [jurisdiction, 1_000_000 + Math.floor(Math.random() * 1_000_000_000)],
  );
  const events: Record<string, { event: string; ledger: string }> = {};
  for (const [key, operator] of [
    ['a', operatorId],
    ['b', operatorId],
    ['x', otherOperatorId],
  ] as const) {
    if (key !== 'b') {
      await owner.query(
        `INSERT INTO party (id, kind, legal_name, country_code) VALUES ($1, 'OPERATOR', 'Edge ' || $2, 'SN')`,
        [operator, key],
      );
    }
    const organizer = randomUUID();
    await owner.query(
      `INSERT INTO party (id, kind, operator_id, legal_name) VALUES ($1, 'ORGANIZER', $2, 'Org edge')`,
      [organizer, operator],
    );
    await owner.query(`SELECT set_config('app.operator_id', $1, false)`, [operator]);
    const event = randomUUID();
    await owner.query(
      `INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder, status)
       VALUES ($1, $2, $3, 'Edge', 'XOF', 'Africa/Dakar', $4, 'ORGANIZER', 'LIVE')`,
      [event, operator, organizer, jurisdiction],
    );
    const { rows } = await owner.query<{ open_event_ledger: string }>(
      `SELECT open_event_ledger($1)`,
      [event],
    );
    events[key] = { event, ledger: rows[0]!.open_event_ledger };
  }
  await owner.query(`SELECT set_config('app.operator_id', $1, false)`, [operatorId]);
  return {
    operatorId,
    otherOperatorId,
    eventId: events.a!.event,
    ledgerId: events.a!.ledger,
    otherEventId: events.b!.event,
    otherLedgerId: events.b!.ledger,
    foreignLedgerId: events.x!.ledger,
  };
}

/** Inscrit une passerelle (ligne posée par le propriétaire) avec l'empreinte donnée. */
export async function addGateway(
  owner: Client,
  world: Pick<EdgeWorld, 'operatorId'>,
  eventId: string,
  options: {
    sha256: Buffer | null;
    role?: 'PRIMARY' | 'STANDBY';
    status?: string;
    lanUrl?: string;
  },
): Promise<string> {
  const id = randomUUID();
  await owner.query(
    `INSERT INTO edge_gateway (id, operator_id, event_id, serial, role, status, cert_sha256, lan_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      world.operatorId,
      eventId,
      `GW-${id.slice(0, 8)}`,
      options.role ?? 'PRIMARY',
      options.status ?? 'ACTIVE',
      options.sha256,
      options.lanUrl ?? 'https://192.168.1.10:8443',
    ],
  );
  return id;
}

/** Nouvel événement (et son grand livre) du prestataire `world.operatorId`, pour une passerelle de plus. */
export async function newEvent(
  owner: Client,
  world: Pick<EdgeWorld, 'operatorId'>,
): Promise<{ eventId: string; ledgerId: string }> {
  const { rows } = await owner.query<{ organizer_id: string; jurisdiction_id: string }>(
    `SELECT organizer_id, jurisdiction_id FROM event WHERE operator_id = $1 LIMIT 1`,
    [world.operatorId],
  );
  const eventId = randomUUID();
  await owner.query(`SELECT set_config('app.operator_id', $1, false)`, [world.operatorId]);
  await owner.query(
    `INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id, funds_holder, status)
     VALUES ($1, $2, $3, 'Edge+', 'XOF', 'Africa/Dakar', $4, 'ORGANIZER', 'LIVE')`,
    [eventId, world.operatorId, rows[0]!.organizer_id, rows[0]!.jurisdiction_id],
  );
  const ledger = await owner.query<{ open_event_ledger: string }>(`SELECT open_event_ledger($1)`, [
    eventId,
  ]);
  return { eventId, ledgerId: ledger.rows[0]!.open_event_ledger };
}
