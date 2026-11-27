// S3SealCopy (mission 12b-1, WP09, T041-T042) : le client S3 du SDK pointe sur un faux S3 local qui applique
// l'écriture unique. Identifiants factices, aucun appel à AWS.
import { createHash, randomBytes } from 'node:crypto';
import { S3SealCopy } from '../../../src/sealing/s3-seal-copy';
import { s3ClientFor, startFakeS3, type FakeS3Server } from '../../support/fake-servers/s3';

const NOW = new Date('2026-11-26T12:00:00.000Z');
const DAY_MS = 86_400_000;
let server: FakeS3Server;
let copy: S3SealCopy;

beforeEach(async () => {
  server = await startFakeS3();
  copy = new S3SealCopy(
    s3ClientFor(server),
    { sealCopy: { bucket: server.bucket, retentionDays: 3650 } },
    () => NOW,
  );
});
afterEach(async () => {
  await server.close();
});

const SEAL = { kind: 'LEDGER', id: '0b2f3c1e-0000-4000-8000-000000000001', sealNo: 7 } as const;

describe('S3SealCopy.write', () => {
  it('écrit en mode COMPLIANCE, rétention +3 650 jours, somme SHA-256, If-None-Match *', async () => {
    const hash = randomBytes(32);
    const ref = await copy.write(SEAL, hash);
    expect(ref).toBe(`LEDGER/${SEAL.id}/7`);
    const put = server.requests.find((r) => r.method === 'PUT');
    expect(put?.path).toBe(`/${server.bucket}/LEDGER/${SEAL.id}/7?x-id=PutObject`);
    expect(put?.headers['x-amz-object-lock-mode']).toBe('COMPLIANCE');
    const until = new Date(String(put?.headers['x-amz-object-lock-retain-until-date']));
    expect(until.getTime() - NOW.getTime()).toBe(3650 * DAY_MS);
    expect(put?.headers['if-none-match']).toBe('*');
    expect(put?.headers['x-amz-sdk-checksum-algorithm']).toBe('SHA256');
    const stored = server.objects.get(`LEDGER/${SEAL.id}/7`);
    expect(stored?.body.equals(hash)).toBe(true);
    expect(stored?.checksumSha256).toBe(createHash('sha256').update(hash).digest('base64'));
    expect(stored?.lockMode).toBe('COMPLIANCE');
  });

  it('la rétention suit la configuration', async () => {
    const short = new S3SealCopy(
      s3ClientFor(server),
      { sealCopy: { bucket: server.bucket, retentionDays: 30 } },
      () => NOW,
    );
    await short.write(SEAL, randomBytes(32));
    const until = new Date(server.objects.get(`LEDGER/${SEAL.id}/7`)?.retainUntil ?? '');
    expect(until.getTime() - NOW.getTime()).toBe(30 * DAY_MS);
  });

  it('même scellement réécrit avec la même empreinte : référence rendue, objet intact', async () => {
    const hash = randomBytes(32);
    const first = await copy.write(SEAL, hash);
    const again = await copy.write(SEAL, Buffer.from(hash));
    expect(again).toBe(first);
    expect(server.requests.filter((r) => r.method === 'PUT')).toHaveLength(2);
    expect(server.requests.some((r) => r.method === 'GET')).toBe(true);
  });

  it('empreinte différente : refus (« divergente »), l’objet existant n’est pas écrasé', async () => {
    const hash = randomBytes(32);
    await copy.write(SEAL, hash);
    await expect(copy.write(SEAL, randomBytes(32))).rejects.toThrow(
      'copie de scellement divergente',
    );
    expect(server.objects.get(`LEDGER/${SEAL.id}/7`)?.body.equals(hash)).toBe(true);
  });

  it('une autre erreur de S3 : classe et code seulement, ni compartiment ni clé', async () => {
    server.objects.clear();
    const wrong = new S3SealCopy(
      s3ClientFor(server),
      { sealCopy: { bucket: 'compartiment-secret-inconnu', retentionDays: 3650 } },
      () => NOW,
    );
    const error = await wrong.write(SEAL, randomBytes(32)).catch((e: unknown) => e);
    expect((error as Error).message).toBe('copie des scellements (write) : NoSuchBucket');
    expect((error as Error).message).not.toContain(SEAL.id);
  });
});

describe('S3SealCopy.read', () => {
  it('relit l’empreinte copiée ; clé absente : null', async () => {
    const hash = randomBytes(32);
    const ref = await copy.write({ kind: 'AUDIT', id: 'chain-1', sealNo: 1 }, hash);
    expect((await copy.read(ref))?.equals(hash)).toBe(true);
    await expect(copy.read('AUDIT/chain-1/2')).resolves.toBeNull();
  });

  it('isFake vaut false', () => {
    expect(copy.isFake).toBe(false);
  });

  it('refuse de se construire sans compartiment', () => {
    expect(
      () =>
        new S3SealCopy(s3ClientFor(server), { sealCopy: { bucket: null, retentionDays: 3650 } }),
    ).toThrow('compartiment non configuré');
  });
});
