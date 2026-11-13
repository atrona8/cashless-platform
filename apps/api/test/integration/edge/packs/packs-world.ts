// Aides des suites des colis (WP15) : inscription par l'outil réel (`tools/edge-admin`, autorité de test en mémoire),
// dépôt d'une clé de contenu par le rôle des clés, lecture de la page de réplication par le rôle `edge`.
import { createHash, createECDH, generateKeyPairSync, randomUUID, webcrypto } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as x509 from '@peculiar/x509';
import type { Client } from 'pg';
import { FakeEdgeCa } from '../../../../src/edge/ca/fake-edge-ca';
import { main, realDeps } from '../../../../../../tools/edge-admin/src/main';
import { connect, EDGE_URL, EDGEADMIN_URL, TAGKEYS_URL } from '../../../support/db';
import type { EdgeWorld } from '../../../support/edge-fixtures';

x509.cryptoProvider.set(webcrypto as never);

export interface Registered {
  gatewayId: string;
  agreementKey: Buffer;
  out: string[];
  err: string[];
  code: number;
}

export async function runTool(argv: string[], extraEnv: NodeJS.ProcessEnv = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const env = { EDGE_CA: 'fake', DATABASE_URL_EDGEADMIN: EDGEADMIN_URL, ...extraEnv };
  const code = await main(
    argv,
    env,
    { out: (l) => out.push(l), err: (l) => err.push(l) },
    (e, i) => ({
      ...realDeps(e, i),
      ca: () => FakeEdgeCa.inMemory(),
    }),
  );
  return { code, out, err };
}

/** Inscrit une passerelle par l'outil (une personne, étiquette « Awa Diop »). */
export async function registerViaTool(
  world: Pick<EdgeWorld, 'operatorId'>,
  event: { eventId: string; ledgerId: string },
  role: 'PRIMARY' | 'STANDBY',
): Promise<Registered> {
  const dir = mkdtempSync(join(tmpdir(), 'wp15-'));
  const serial = `GW-${randomUUID().slice(0, 8)}`;
  const keys = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const csr = await x509.Pkcs10CertificateRequestGenerator.create({
    name: 'CN=passerelle-test',
    keys,
    signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
  });
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const agreementKey = ecdh.getPublicKey();
  const spki = (): string =>
    (
      generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({
        type: 'spki',
        format: 'der',
      }) as Buffer
    ).toString('base64url');
  const lanUrl = 'https://192.168.1.10:8443';
  writeFileSync(
    join(dir, 'request.json'),
    JSON.stringify({
      serial,
      role,
      csr_pem: csr.toString('pem'),
      batch_public_key: Buffer.from(
        await webcrypto.subtle.exportKey('spki', keys.publicKey),
      ).toString('base64url'),
      snapshot_key_id: `snap-${randomUUID().slice(0, 12)}`,
      snapshot_public_key: spki(),
      token_public_key: spki(),
      agreement_public_key: agreementKey.toString('base64url'),
      lan_url: lanUrl,
    }),
  );
  const ca = (await FakeEdgeCa.inMemory()).caCertPem();
  for (const name of ['ca.pem', 'site-a.pem', 'site-b.pem']) {
    writeFileSync(
      join(dir, name),
      name === 'ca.pem'
        ? ca
        : generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({
            type: 'spki',
            format: 'pem',
          }),
    );
  }
  const options: Record<string, string> = {
    request: join(dir, 'request.json'),
    operator: world.operatorId,
    event: event.eventId,
    ledger: event.ledgerId,
    serial,
    role,
    'lan-url': lanUrl,
    by: 'Awa Diop',
    out: join(dir, 'enrolment.json'),
    'central-url': 'https://central.example.test',
    'central-ca-file': join(dir, 'ca.pem'),
    'device-ca-file': join(dir, 'ca.pem'),
    'site-key-a': join(dir, 'site-a.pem'),
    'site-holder-a': 'Moussa Ndiaye',
    'site-key-b': join(dir, 'site-b.pem'),
    'site-holder-b': 'Fatou Sow',
  };
  const result = await runTool([
    'register',
    ...Object.entries(options).flatMap(([k, v]) => [`--${k}`, v]),
  ]);
  if (result.code !== 0) throw new Error(`inscription refusée : ${result.err.join(' ')}`);
  const gatewayId = (
    JSON.parse(readFileSync(join(dir, 'enrolment.json'), 'utf8')) as { gateway_id: string }
  ).gateway_id;
  return { gatewayId, agreementKey, out: result.out, err: result.err, code: result.code };
}

/** Passerelles qui attendent des colis, lues avec le rôle des clés. */
export async function awaiting(): Promise<string[]> {
  const client = await connect(TAGKEYS_URL);
  try {
    const { rows } = await client.query<{ gateway_id: string }>(
      'SELECT gateway_id FROM edge_gateways_awaiting_pack(1000)',
    );
    return rows.map((r) => r.gateway_id);
  } finally {
    await client.end();
  }
}

/** Date d'inscription ou de promotion reculée de `seconds` (le propriétaire pose l'horloge de test). */
export async function backdate(owner: Client, gatewayId: string, seconds: number): Promise<void> {
  await owner.query(
    `UPDATE edge_gateway SET role_changed_at = clock_timestamp() - make_interval(secs => $2) WHERE id = $1`,
    [gatewayId, seconds],
  );
}

/** Clé de contenu déposée par le rôle des clés (enveloppe factice : la base ne chiffre rien, C-009). */
export async function depositContentKey(
  world: Pick<EdgeWorld, 'operatorId'>,
  gatewayId: string,
  agreementKey: Buffer,
): Promise<void> {
  const client = await connect(TAGKEYS_URL);
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.operator_id', $1, true)`, [world.operatorId]);
    await client.query('SELECT deposit_edge_pwd_pack_key($1, $2, $3)', [
      gatewayId,
      createHash('sha256').update(agreementKey).digest(),
      JSON.stringify({
        alg: 'ECDH-ES+HKDF-SHA256+A256GCM',
        epk: Buffer.alloc(65, 4).toString('base64'),
        iv: Buffer.alloc(12, 1).toString('base64'),
        wrapped_key: Buffer.alloc(48, 2).toString('base64'),
      }),
    ]);
    await client.query('COMMIT');
  } finally {
    await client.end();
  }
}

/** `pwd_pack_key` de la page de réplication servie à la passerelle (null si non servi). */
export async function servedPackKey(
  world: Pick<EdgeWorld, 'operatorId'>,
  gatewayId: string,
): Promise<unknown> {
  const client = await connect(EDGE_URL);
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    await client.query(`SELECT set_config('app.operator_id', $1, true)`, [world.operatorId]);
    await client.query(`SELECT set_config('app.gateway_id', $1, true)`, [gatewayId]);
    const { rows } = await client.query<{ page: Record<string, unknown> }>(
      'SELECT edge_replication_page($1, 0, 0, 10) AS page',
      [gatewayId],
    );
    await client.query('ROLLBACK');
    return rows[0]!.page.pwd_pack_key ?? null;
  } finally {
    await client.end();
  }
}
