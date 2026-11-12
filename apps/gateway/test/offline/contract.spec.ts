// Schémas des réponses des cinq opérations servies par WP23, contre `openapi.yaml` lu à l'exécution
// (réutilise le contrôle de WP19), et chemins/méthodes identiques au contrat.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { SERVED_OPERATION_IDS } from '../../src/processes/served-operations';
import { contractViolations } from '../device/_support/contract-schema';
import { buildDeviceBatch, makeBench, readySnapshot, submit, type Bench } from './_support/bench';
import type { OfflineDevice, SeedMediaResult } from './_support/bench';

const openapi = parse(
  readFileSync(join(__dirname, '../../../../packages/contracts/openapi.yaml'), 'utf8'),
) as {
  paths: Record<string, Record<string, { operationId: string; 'x-edge-available'?: boolean }>>;
};

const OURS: Array<[string, string, string]> = [
  ['submitOfflineBatch', 'post', '/offline-batches'],
  ['getOfflineBatchResult', 'get', '/offline-batches/{batch_id}'],
  ['getOfflineSnapshot', 'get', '/offline-snapshots/current'],
  ['ackOfflineSnapshot', 'post', '/offline-snapshots/ack'],
  ['getMediaAuthKey', 'post', '/media/auth-keys'],
];

let b: Bench;
let dev: OfflineDevice;
let media: SeedMediaResult;
let version: number;
beforeAll(async () => {
  b = await makeBench({ media: { floorMs: 0, perMinute: 100 } });
  dev = await b.newDevice();
  media = await b.seedMedia({ balancePaid: 10000, pwdPack: Buffer.from('PWD1PK') });
  version = await readySnapshot(b);
});
afterAll(async () => b.close());

describe('mêmes chemins et méthodes que le contrat', () => {
  it.each(OURS)('%s %s %s est une opération x-edge-available servie', (id, method, path) => {
    expect(openapi.paths[path]?.[method]?.operationId).toBe(id);
    expect(openapi.paths[path]?.[method]?.['x-edge-available']).toBe(true);
    expect(SERVED_OPERATION_IDS as readonly string[]).toContain(id);
  });
});

describe('réponses conformes aux schémas', () => {
  it('submitOfflineBatch et getOfflineBatchResult : OfflineBatchResult', async () => {
    const built = buildDeviceBatch(b, dev, [{ media }, { type: 'TOPUP_CASH' }], {
      snapshotVersion: version,
    });
    const res = await submit(b, dev, built);
    expect(res.status).toBe(200);
    expect(contractViolations('OfflineBatchResult', res.json)).toEqual([]);
    const again = await b.request(dev, { path: `/v1/offline-batches/${built.batchId}` });
    expect(again.status).toBe(200);
    expect(contractViolations('OfflineBatchResult', again.json)).toEqual([]);
  });

  it('getOfflineSnapshot : OfflineSnapshot ; ack : 204', async () => {
    const res = await b.request(dev, { path: '/v1/offline-snapshots/current' });
    expect(res.status).toBe(200);
    expect(contractViolations('OfflineSnapshot', res.json)).toEqual([]);
    const sha = (res.json as any).header.content_sha256;
    const ack = await b.request(dev, {
      method: 'POST',
      path: '/v1/offline-snapshots/ack',
      body: { version, content_sha256: sha },
    });
    expect(ack.status).toBe(204);
  });

  it('getMediaAuthKey : MediaAuthKey', async () => {
    const res = await b.request(dev, {
      method: 'POST',
      path: '/v1/media/auth-keys',
      body: { nfc_uid: media.uid.toString('hex'), key_index: 0 },
    });
    expect(res.status).toBe(200);
    expect(contractViolations('MediaAuthKey', res.json)).toEqual([]);
  });

  it('erreurs : Problem', async () => {
    const res = await b.request(dev, {
      path: `/v1/offline-batches/${'0'.repeat(8)}-0000-4000-8000-000000000000`,
    });
    expect(res.status).toBe(404);
    expect(contractViolations('Problem', res.json)).toEqual([]);
  });
});
