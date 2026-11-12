// Aides des suites de l'outil : demande de la passerelle, clés de site, dépendances simulées ou réelles.
import { createECDH, generateKeyPairSync, randomUUID, webcrypto } from 'node:crypto';
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as x509 from '@peculiar/x509';
import { FakeEdgeCa } from '../../../apps/api/src/edge/ca/fake-edge-ca';
import { realDeps } from '../src/main';
import type { Deps, Io } from '../src/commands';
import type { AdminDb, AdminFunction, AdminSession } from '../src/db';

x509.cryptoProvider.set(webcrypto as never);

export interface Captured {
  out: string[];
  err: string[];
}

export function capture(): { io: Io; got: Captured } {
  const got: Captured = { out: [], err: [] };
  return { io: { out: (l) => got.out.push(l), err: (l) => got.err.push(l) }, got };
}

export function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'edge-admin-'));
}

export function spki(curve: 'prime256v1' | 'secp384r1' = 'prime256v1'): Buffer {
  return generateKeyPairSync('ec', { namedCurve: curve }).publicKey.export({
    type: 'spki',
    format: 'der',
  }) as Buffer;
}

export function agreementPoint(): Buffer {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return ecdh.getPublicKey();
}

export async function csrPem(
  options: { curve?: 'P-256' | 'P-384'; canary?: string } = {},
): Promise<{
  pem: string;
  spki: Buffer;
}> {
  const curve = options.curve ?? 'P-256';
  const keys = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: curve }, true, [
    'sign',
    'verify',
  ]);
  const csr = await x509.Pkcs10CertificateRequestGenerator.create({
    name: 'CN=passerelle-test',
    keys,
    signingAlgorithm: { name: 'ECDSA', hash: curve === 'P-256' ? 'SHA-256' : 'SHA-384' },
    extensions: options.canary
      ? [new x509.Extension('1.3.6.1.4.1.99999.1', false, Buffer.from(options.canary))]
      : [],
  });
  return {
    pem: csr.toString('pem'),
    spki: Buffer.from(await webcrypto.subtle.exportKey('spki', keys.publicKey)),
  };
}

export interface RequestOverrides {
  serial?: string;
  role?: string;
  agreement?: Buffer;
  curve?: 'P-256' | 'P-384';
  canary?: string;
  extra?: Record<string, string>;
}

export async function requestJson(o: RequestOverrides = {}): Promise<string> {
  const csr = await csrPem({ curve: o.curve, canary: o.canary });
  return JSON.stringify({
    serial: o.serial ?? 'GW-001',
    role: o.role ?? 'PRIMARY',
    csr_pem: csr.pem,
    batch_public_key: csr.spki.toString('base64url'),
    snapshot_key_id: `snap-${randomUUID().slice(0, 12)}`,
    snapshot_public_key: spki().toString('base64url'),
    token_public_key: spki().toString('base64url'),
    agreement_public_key: (o.agreement ?? agreementPoint()).toString('base64url'),
    lan_url: 'https://192.168.1.10:8443',
    ...o.extra,
  });
}

export function siteKeyPem(): string {
  return generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({
    type: 'spki',
    format: 'pem',
  }) as string;
}

export interface Recorded {
  fn: AdminFunction;
  args: readonly unknown[];
  operator: string;
}

export function mockDb(calls: Recorded[], failWith?: { code: string; message: string }): AdminDb {
  return {
    async withOperator(operator, work) {
      const session: AdminSession = {
        async call(fn, args) {
          calls.push({ fn, args, operator });
          if (failWith) throw Object.assign(new Error(failWith.message), { code: failWith.code });
          return fn === 'register_edge_gateway' ? randomUUID() : undefined;
        },
      };
      return work(session);
    },
    async close() {},
  };
}

/** Dépendances réelles (fichiers) sauf la base (simulée) et l'autorité (faux en mémoire). */
export function fileDeps(env: NodeJS.ProcessEnv, io: Io, db: () => AdminDb): Deps {
  const real = realDeps(env, io);
  return { ...real, db, ca: async () => FakeEdgeCa.inMemory() };
}

export function readIfExists(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

function keyFile(dir: string, name: string): string {
  const path = join(dir, `site-${name}.pem`);
  writeFileSync(path, siteKeyPem());
  return path;
}

export const OPERATOR = '11111111-1111-4111-8111-111111111111';
export const EVENT = '22222222-2222-4222-8222-222222222222';
export const LEDGER = '33333333-3333-4333-8333-333333333333';

/** Fichiers et arguments d'un `register` valide ; `overrides` remplace ou ajoute des options. */
export async function registerArgv(
  dir: string,
  request: RequestOverrides = {},
  overrides: Record<string, string> = {},
): Promise<string[]> {
  const ca = (await FakeEdgeCa.inMemory()).caCertPem();
  writeFileSync(join(dir, 'request.json'), await requestJson(request));
  writeFileSync(join(dir, 'ca.pem'), ca);
  const options: Record<string, string> = {
    request: join(dir, 'request.json'),
    operator: OPERATOR,
    event: EVENT,
    ledger: LEDGER,
    serial: 'GW-001',
    role: 'PRIMARY',
    'lan-url': 'https://192.168.1.10:8443',
    by: 'Awa Diop',
    out: join(dir, 'enrolment.json'),
    'central-url': 'https://central.example.test',
    'central-ca-file': join(dir, 'ca.pem'),
    'device-ca-file': join(dir, 'ca.pem'),
    'site-key-a': keyFile(dir, 'a'),
    'site-holder-a': 'Moussa Ndiaye',
    'site-key-b': keyFile(dir, 'b'),
    'site-holder-b': 'Fatou Sow',
    ...overrides,
  };
  return ['register', ...Object.entries(options).flatMap(([k, v]) => [`--${k}`, v])];
}
