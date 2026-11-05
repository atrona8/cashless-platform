// Décor commun des tests de réception des lots (lot WP18) : API en HTTPS réel, faux processeur injecté (jamais en
// production), terminaux enrôlés en propriétaire.
import 'reflect-metadata';
import type { DeviceCaPort } from '../../src/device-ca/device-ca.port';
import { FakeDeviceCa } from '../../src/device-ca/fake-device-ca';
import { DeviceTokenService } from '../../src/device-tokens/device-token.service';
import { TenantTx } from '../../src/db/tenant-tx';
import { FakeOperationProcessor } from '../../src/offline/batches/fake-operation-processor';
import { OFFLINE_OPERATION_PROCESSOR } from '../../src/offline/batches/batch.types';
import { startHttpsApp, type HttpsTestApp } from './app';
import { withOwner } from './db';
import { createMediaWorld, ownerRows, type MediaWorld } from './media-fixtures';
import { TestTerminal, type JournalOpInput } from './test-terminal';

export interface BatchWorld {
  w: MediaWorld;
  api: HttpsTestApp;
  fake: FakeOperationProcessor;
  enrolled(operatorId?: string, eventId?: string): Promise<TestTerminal>;
  close(): Promise<void>;
}

export async function startBatchWorld(): Promise<BatchWorld> {
  const w = await createMediaWorld();
  const holder: { fake?: FakeOperationProcessor } = {};
  const delegate = {
    isFake: true,
    process: (...args: Parameters<FakeOperationProcessor['process']>) =>
      holder.fake!.process(...args),
  };
  const api = await startHttpsApp(undefined, {
    identity: w.idp,
    overrides: [{ provide: OFFLINE_OPERATION_PROCESSOR, useValue: delegate }],
  });
  const fake = new FakeOperationProcessor(api.app.get(TenantTx, { strict: false }));
  holder.fake = fake;
  const ca: DeviceCaPort = await FakeDeviceCa.fromFiles({
    certFile: api.tls.deviceCaCertFile,
    keyFile: api.tls.deviceCaFakeKeyFile,
  });
  const tokens = api.app.get(DeviceTokenService, { strict: false });
  return {
    w,
    api,
    fake,
    async enrolled(operatorId = w.ops.a, eventId = w.ids.eventA) {
      const t = await withOwner((db) => new TestTerminal().enroll(db, { operatorId, eventId, ca }));
      await t.issueToken(tokens);
      return t;
    },
    close: () => api.close(),
  };
}

export const purchase = (i: number): JournalOpInput => ({
  type: 'VOID',
  occurred_at: new Date(Date.UTC(2026, 11, 11, 19, 0, i % 60)).toISOString(),
  void_reason: 'ABORTED_BY_OPERATOR',
});

export const batchRow = async (batchId: string) =>
  (
    await ownerRows<{ status: string; reject_reason: string | null }>(
      'SELECT status, reject_reason FROM offline_batch WHERE id = $1',
      [batchId],
    )
  )[0];

export const countRows = async (table: string, batchId: string): Promise<number> =>
  Number(
    (
      await ownerRows<{ n: string }>(`SELECT count(*) AS n FROM ${table} WHERE batch_id = $1`, [
        batchId,
      ])
    )[0]!.n,
  );
