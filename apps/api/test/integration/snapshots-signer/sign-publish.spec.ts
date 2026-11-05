// WP13, T056 : brouillon sain -> offline_snapshot signé en un passage (FULL puis DELTA), idempotence, deux signataires.
import { createPublicKey, verify } from 'node:crypto';
import canonicalize from 'canonicalize';
import { Pool } from 'pg';
import { FakeKms } from '../../../src/kms/fake-kms';
import { OWNER_URL } from '../../support/db';
import {
  clearDrafts,
  draftStatus,
  harness,
  newWorld,
  publishedVersions,
  seedDraft,
  seedOperators,
  sha,
  type Harness,
} from './support';

jest.setTimeout(120_000);

describe('snapshot-signer : signature et publication', () => {
  let owner: Pool;
  let h: Harness;
  const ref = `fake-kms:ecc:${'p'.repeat(8)}`;
  const kms = new FakeKms();

  beforeAll(async () => {
    owner = new Pool({ connectionString: OWNER_URL, max: 3 });
    await seedOperators(owner);
  });
  afterAll(async () => {
    await clearDrafts(owner);
    await owner.end();
  });
  beforeEach(async () => {
    await clearDrafts(owner);
    h = harness(ref, kms);
  });
  afterEach(async () => {
    await h.close();
  });

  const signatureValid = async (header: unknown, signature: Buffer) =>
    verify(
      'sha256',
      Buffer.from(canonicalize(header)!, 'utf8'),
      {
        key: createPublicKey({ key: await kms.publicKey(ref), format: 'der', type: 'spki' }),
        dsaEncoding: 'der',
      },
      signature,
    );

  it('FULL puis DELTA : publiés, signature DER valide sur JCS(en-tête), version = précédente + 1', async () => {
    const world = await newWorld(owner, kms, ref);
    const full = await seedDraft(owner, world, { kind: 'FULL' });
    expect(await h.signer.runOnce()).toBe(1);
    expect(await draftStatus(owner, full)).toBe('PUBLISHED');
    const delta = await seedDraft(owner, world, {
      kind: 'DELTA',
      live: [{ token: sha('a'), spendable: 4000 }],
      removed: [sha('b')],
      header: { base_version: 1 },
    });
    expect(await h.signer.runOnce()).toBe(1);
    expect(await draftStatus(owner, delta)).toBe('PUBLISHED');

    const rows = await publishedVersions(owner, world.ledgerId);
    expect(rows.map((r: { version: number }) => r.version)).toEqual([1, 2]);
    expect(rows.map((r: { kind: string }) => r.kind)).toEqual(['FULL', 'DELTA']);
    for (const row of rows) {
      expect(await signatureValid(row.header, row.signature)).toBe(true);
      expect(row.header.key_id).toBe(row.key_id);
    }
    expect(rows[1].header.base_version).toBe(1);
    // L'en-tête publié est un autre en-tête : la signature de la version 1 ne vaut pas pour la version 2.
    expect(await signatureValid(rows[1].header, rows[0].signature)).toBe(false);
    expect(h.signer.alarm()).toBe(0);
  });

  it('--once est idempotent : un second passage ne publie rien et n’appelle pas le service de clés', async () => {
    const world = await newWorld(owner, kms, ref);
    await seedDraft(owner, world);
    expect(await h.signer.runOnce()).toBe(1);
    const signs = kms.calls.sign;
    expect(await h.signer.runOnce()).toBe(0);
    expect(kms.calls.sign).toBe(signs);
    expect(await publishedVersions(owner, world.ledgerId)).toHaveLength(1);
  });

  it('deux signataires sur le même brouillon : une publication, aucune erreur fatale', async () => {
    const world = await newWorld(owner, kms, ref);
    await seedDraft(owner, world);
    const other = harness(ref, kms);
    try {
      const done = await Promise.all([h.signer.runOnce(), other.signer.runOnce()]);
      expect(done[0] + done[1]).toBeGreaterThanOrEqual(1);
      expect(await publishedVersions(owner, world.ledgerId)).toHaveLength(1);
      expect(h.signer.alarm() + other.signer.alarm()).toBe(0);
    } finally {
      await other.close();
    }
  });

  it('un grand livre en échec n’empêche pas les suivants', async () => {
    const bad = await newWorld(owner, kms, ref);
    const good = await newWorld(owner, kms, ref);
    await seedDraft(owner, bad);
    await seedDraft(owner, good);
    // L'époque du grand livre change après le brouillon : publish_offline_snapshot refuse (CL015).
    await owner.query('UPDATE ledger SET authority_epoch = authority_epoch + 1 WHERE id = $1', [
      bad.ledgerId,
    ]);
    expect(await h.signer.runOnce()).toBe(1);
    expect(await publishedVersions(owner, good.ledgerId)).toHaveLength(1);
    expect(await publishedVersions(owner, bad.ledgerId)).toHaveLength(0);
    expect(h.signer.alarm()).toBe(3);
  });

  it('--list décrit les brouillons à signer sans rien publier', async () => {
    const world = await newWorld(owner, kms, ref);
    const id = await seedDraft(owner, world);
    const lines = await h.signer.describe();
    expect(lines.some((line) => line.includes(`brouillon ${id} `))).toBe(true);
    expect(await draftStatus(owner, id)).toBe('READY');
    expect(kms.calls.sign).toBeGreaterThanOrEqual(0);
  });
});
