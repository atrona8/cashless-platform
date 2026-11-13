// Base enrôlée : le fichier d'enrôlement est validé et appliqué par le vrai `EnrollmentService`.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GatewayTx } from '../../../src/db/gateway-tx';
import { EnrollmentService, type EnrollmentFile } from '../../../src/enrollment/enrollment.service';
import { FakeHardwareKeystore } from '../../../src/key-store/fake-hardware-keystore';
import type { TestDb } from './db';
import { makeEnrollmentFile } from './pki';

export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'gw-test-'));
}

export async function enrolledFixture(
  db: TestDb,
  overrides: Partial<EnrollmentFile> = {},
): Promise<{
  file: EnrollmentFile;
  path: string;
  service: EnrollmentService;
  keystore: FakeHardwareKeystore;
}> {
  const keystore = new FakeHardwareKeystore();
  const file = await makeEnrollmentFile(keystore, overrides);
  const path = join(tempDir(), 'enrollment.json');
  writeFileSync(path, JSON.stringify(file));
  const service = new EnrollmentService(new GatewayTx(db.pool), keystore);
  await service.enroll(path);
  return { file, path, service, keystore };
}
