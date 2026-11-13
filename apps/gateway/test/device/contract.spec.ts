// WP19 / T087 : les routes de terminal servies par la passerelle reprennent EXACTEMENT le contrat
// existant (openapi.yaml, opérations `x-edge-available`), et chaque réponse valide le schéma :
// 200, 304, 400, 401, 403, 409. Aucune route ajoutée.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { ProblemException, problemBody } from '../../src/device-proofs/problem';
import { SERVED_OPERATION_IDS } from '../../src/processes/served-operations';
import { contractViolations } from './_support/contract-schema';
import { makeBench, newKeyPair, type Bench, type TestDevice } from './_support/harness';

interface Operation {
  operationId: string;
  'x-edge-available'?: boolean;
  security?: Array<Record<string, unknown>>;
}
const openapi = parse(
  readFileSync(join(__dirname, '../../../../packages/contracts/openapi.yaml'), 'utf8'),
) as { paths: Record<string, Record<string, Operation>> };

let b: Bench;
let d: TestDevice;
beforeAll(async () => {
  b = await makeBench({ failureFloorMs: 5, withKeys: true });
  d = await b.newDevice();
});
afterAll(async () => b.close());

const BASE = '/v1';
const OURS: Array<[string, string, string]> = [
  ['refreshDeviceToken', 'post', '/device-tokens/refresh'],
  ['getDeviceConfig', 'get', '/device/config'],
  ['postDeviceHeartbeat', 'post', '/device/heartbeat'],
  ['getDeviceSeqStatus', 'get', '/device/seq-status'],
];

describe('mêmes chemins, mêmes méthodes, mêmes preuves que le contrat', () => {
  it.each(OURS)('%s %s %s est une opération x-edge-available du contrat', (id, method, path) => {
    const operation = openapi.paths[path]?.[method];
    expect(operation?.operationId).toBe(id);
    expect(operation?.['x-edge-available']).toBe(true);
    expect(SERVED_OPERATION_IDS as readonly string[]).toContain(id);
  });

  it('les preuves du contrat : refresh = deviceMtls seul ; lectures = les trois', () => {
    expect(Object.keys(openapi.paths['/device-tokens/refresh']!.post!.security![0]!)).toEqual([
      'deviceMtls',
    ]);
    for (const [, method, path] of OURS.slice(1))
      expect(Object.keys(openapi.paths[path]![method]!.security![0]!).sort()).toEqual([
        'deviceMtls',
        'deviceSignature',
        'deviceToken',
      ]);
  });

  it('aucune route ajoutée : une route hors des 16 répond 404 (et sans preuve exigée)', async () => {
    for (const path of ['/v1/cash-sessions', '/v1/admin', '/v1/device/secret', '/health']) {
      const r = await b.request(d, { path });
      expect(r.status).toBe(404);
    }
  });
});

describe('chaque réponse valide le schéma du contrat', () => {
  it('200 getDeviceConfig : DeviceConfig', async () => {
    const r = await b.request(d, { path: `${BASE}/device/config` });
    expect(r.status).toBe(200);
    expect(contractViolations('DeviceConfig', r.json)).toEqual([]);
  });

  it('200 avec catalogue et clé de snapshot : DeviceConfig', async () => {
    const dev = await b.newDevice();
    const pos = (
      await b.q<{ pos_id: string }>('SELECT pos_id FROM edge_device WHERE device_id = $1', [
        dev.deviceId,
      ])
    )[0]!.pos_id;
    await b.q(
      'INSERT INTO edge_catalog_item (pos_id, item_id, version, price, lines) VALUES ($1, gen_random_uuid(), 2, 500, $2)',
      [
        pos,
        JSON.stringify({
          name_fr: 'Eau',
          name_en: 'Water',
          category_fr: null,
          category_en: null,
          vat_rate_bps: 0,
        }),
      ],
    );
    b.snapshotKeys.push({
      key_id: 'edge-snap-1',
      algorithm: 'ECDSA_P256_SHA256',
      public_key: Buffer.alloc(91, 1).toString('base64'),
      not_after: null,
    });
    try {
      const r = await b.request(dev, { path: `${BASE}/device/config` });
      expect(contractViolations('DeviceConfig', r.json)).toEqual([]);
    } finally {
      b.snapshotKeys.length = 0;
    }
  });

  it('304 getDeviceConfig : sans corps, avec ETag', async () => {
    const first = await b.request(d, { path: `${BASE}/device/config` });
    const r = await b.request(d, {
      path: `${BASE}/device/config`,
      headers: { 'if-none-match': first.headers.etag as string },
    });
    expect(r.status).toBe(304);
    expect(r.text).toBe('');
    expect(r.headers.etag).toBe(first.headers.etag);
  });

  it('200 postDeviceHeartbeat : HeartbeatResponse', async () => {
    const r = await b.request(d, {
      method: 'POST',
      path: `${BASE}/device/heartbeat`,
      body: { device_time: new Date().toISOString(), last_local_seq: 0, pending_operations: 0 },
    });
    expect(r.status).toBe(200);
    expect(contractViolations('HeartbeatResponse', r.json)).toEqual([]);
  });

  it('200 getDeviceSeqStatus : SeqStatus', async () => {
    const r = await b.request(d, { path: `${BASE}/device/seq-status` });
    expect(r.status).toBe(200);
    expect(contractViolations('SeqStatus', r.json)).toEqual([]);
  });

  it('200 refreshDeviceToken : TokenResponse', async () => {
    const { sign } = await import('node:crypto');
    const { refreshProofMessage } = await import('../../src/device/dto');
    const nonce = Buffer.from('0123456789abcdef0123').toString('base64url');
    const signature = sign('sha256', refreshProofMessage(nonce, d.serial, d.refreshToken), {
      key: d.signing.privateKey,
      dsaEncoding: 'ieee-p1363',
    });
    const r = await b.raw({
      method: 'POST',
      path: `${BASE}/device-tokens/refresh`,
      cert: d.cert,
      body: {
        serial: d.serial,
        refresh_token: d.refreshToken,
        nonce,
        signature: signature.toString('base64'),
      },
    });
    expect(r.status).toBe(200);
    expect(contractViolations('TokenResponse', r.json)).toEqual([]);
  });

  it('400 : Problem (VALIDATION_FAILED)', async () => {
    const r = await b.request(d, { method: 'POST', path: `${BASE}/device/heartbeat`, body: {} });
    expect(r.status).toBe(400);
    expect(r.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(contractViolations('Problem', r.json)).toEqual([]);
  });

  it('401 : Problem, pour un terminal (UNAUTHENTICATED / DEVICE_SIGNATURE_INVALID) et pour le refresh', async () => {
    const bad = [
      await b.request(d, { path: `${BASE}/device/seq-status`, token: null }),
      await b.request(d, { path: `${BASE}/device/seq-status`, signer: newKeyPair().privateKey }),
      await b.raw({
        method: 'POST',
        path: `${BASE}/device-tokens/refresh`,
        cert: null,
        body: {
          serial: d.serial,
          refresh_token: 'drt_aaaaaaaaaaaaaaaaaaaa',
          nonce: 'aaaaaaaaaaaaaaaa',
          signature: Buffer.alloc(64).toString('base64'),
        },
      }),
    ];
    for (const r of bad) {
      expect(r.status).toBe(401);
      expect(r.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(contractViolations('Problem', r.json)).toEqual([]);
    }
  });

  it('403 : Problem (DEVICE_REVOKED)', async () => {
    const revoked = await b.newDevice({ status: 'REVOKED' });
    const r = await b.request(revoked, { path: `${BASE}/device/seq-status` });
    expect(r.status).toBe(403);
    expect(contractViolations('Problem', r.json)).toEqual([]);
  });

  it('409 : Problem (CONFLICT_STATE, copie incomplète)', async () => {
    const dev = await b.newDevice({ os: null });
    const r = await b.request(dev, { path: `${BASE}/device/config` });
    expect(r.status).toBe(409);
    expect(contractViolations('Problem', r.json)).toEqual([]);
  });

  it('IDEMPOTENCY_KEY_REUSED : Problem au statut du contrat', () => {
    const problem = new ProblemException('IDEMPOTENCY_KEY_REUSED');
    const body = problemBody(problem, { header: () => undefined });
    expect(problem.status).toBe(409);
    expect(contractViolations('Problem', body)).toEqual([]);
  });

  it('CLOCK_SKEW_TOO_LARGE : Problem 400 avec Date', async () => {
    const r = await b.request(d, {
      path: `${BASE}/device/seq-status`,
      created: Math.floor(Date.now() / 1000) - 900,
    });
    expect(r.status).toBe(400);
    expect(contractViolations('Problem', r.json)).toEqual([]);
    expect(r.headers.date).toBeDefined();
  });
});

describe('erreurs internes', () => {
  it('500 : INTERNAL_ERROR sans cause (pas de message SQL ni de pile)', async () => {
    const dev = await b.newDevice();
    await b.q('ALTER TABLE edge_event_setting RENAME TO edge_event_setting_x');
    try {
      const r = await b.request(dev, { path: `${BASE}/device/config` });
      expect(r.status).toBe(500);
      expect(r.json?.code).toBe('INTERNAL_ERROR');
      expect(r.text).not.toMatch(/relation|edge_event_setting|SELECT|at \w+/);
      expect(contractViolations('Problem', r.json)).toEqual([]);
    } finally {
      await b.q('ALTER TABLE edge_event_setting_x RENAME TO edge_event_setting');
    }
  });
});
