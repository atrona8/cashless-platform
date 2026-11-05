// WP13, T056 : aucune clé ACTIVE, panne du service de clés, référence de clé fausse : rien n'est publié, code 3.
import { Pool } from 'pg';
import { FakeKms } from '../../../src/kms/fake-kms';
import { OWNER_URL } from '../../support/db';
import {
  clearDrafts,
  draftStatus,
  harness,
  newWorld,
  publishedVersions,
  revokeKeys,
  seedDraft,
  seedOperators,
  type Harness,
} from './support';

jest.setTimeout(120_000);

describe('snapshot-signer : clé absente ou service de clés en panne', () => {
  let owner: Pool;
  let h: Harness;
  const ref = `fake-kms:ecc:${'k'.repeat(8)}`;
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
    kms.resetCalls();
  });
  afterEach(async () => {
    await h.close();
  });

  it('aucune clé ACTIVE : rien n’est publié, brouillon jeté, code 3', async () => {
    const world = await newWorld(owner, kms, ref);
    const id = await seedDraft(owner, world);
    await revokeKeys(owner, world.operatorId);
    h = harness(ref, kms);
    expect(await h.signer.runOnce()).toBe(1);
    expect(await publishedVersions(owner, world.ledgerId)).toHaveLength(0);
    expect(await draftStatus(owner, id)).toBe('DISCARDED');
    expect(h.signer.alarm()).toBe(3);
  });

  it('panne du port (failNext) : code 3 puis reprise sans doublon', async () => {
    const world = await newWorld(owner, kms, ref);
    await seedDraft(owner, world);
    h = harness(ref, kms);
    kms.failNext('sign');
    expect(await h.signer.runOnce()).toBe(0);
    expect(h.signer.alarm()).toBe(3);
    expect(await publishedVersions(owner, world.ledgerId)).toHaveLength(0);
    expect(await h.signer.runOnce()).toBe(1);
    expect(await h.signer.runOnce()).toBe(0);
    expect(await publishedVersions(owner, world.ledgerId)).toHaveLength(1);
  });

  it('panne de la clé publique : rien n’est publié (la signature n’est pas vérifiable)', async () => {
    const world = await newWorld(owner, kms, ref);
    await seedDraft(owner, world);
    h = harness(ref, kms);
    kms.failNext('publicKey');
    expect(await h.signer.runOnce()).toBe(0);
    expect(h.signer.alarm()).toBe(3);
    expect(await publishedVersions(owner, world.ledgerId)).toHaveLength(0);
  });

  it('référence de clé fausse ou clé désactivée : rien n’est publié', async () => {
    const world = await newWorld(owner, kms, ref);
    await seedDraft(owner, world);
    h = harness('fake-kms:hmac:pas-une-cle-de-signature', kms);
    expect(await h.signer.runOnce()).toBe(0);
    expect(h.signer.alarm()).toBe(3);
    expect(await publishedVersions(owner, world.ledgerId)).toHaveLength(0);
    await h.close();
    const disabled = `fake-kms:ecc:${'d'.repeat(8)}`;
    await kms.disableKey(disabled);
    h = harness(disabled, kms);
    expect(await h.signer.runOnce()).toBe(0);
    expect(await publishedVersions(owner, world.ledgerId)).toHaveLength(0);
  });

  const reasonOf = async (id: bigint) =>
    (
      await owner.query('SELECT status, discard_reason FROM offline_snapshot_draft WHERE id = $1', [
        id.toString(),
      ])
    ).rows[0] as { status: string; discard_reason: string };

  it('référence d’une autre clé que celle du key_id (décision du porteur 02/11) : refusée, jetée', async () => {
    const world = await newWorld(owner, kms, ref);
    const id = await seedDraft(owner, world);
    h = harness(`fake-kms:ecc:${'z'.repeat(8)}`, kms);
    expect(await h.signer.runOnce()).toBe(1);
    expect(await reasonOf(id)).toEqual({
      status: 'DISCARDED',
      discard_reason: 'SIGNATURE_VS_PUBLISHED_KEY',
    });
    expect(await publishedVersions(owner, world.ledgerId)).toHaveLength(0);
    expect(h.signer.alarm()).toBe(3);
  });

  it('clé du key_id retirée ou révoquée entre le brouillon et la signature : jeté, rien publié', async () => {
    const world = await newWorld(owner, kms, ref);
    const keyId = world.keyId;
    const retired = await seedDraft(owner, world);
    await owner.query("UPDATE snapshot_signing_key SET status = 'RETIRED' WHERE key_id = $1", [
      keyId,
    ]);
    // Rotation : une nouvelle clé ACTIVE du prestataire ; l'ancienne reste publiée comme RETIRED.
    await owner.query(
      `INSERT INTO snapshot_signing_key (key_id, operator_id, owner, algorithm, public_key, kms_key_ref, status)
       VALUES ($1, $2, 'CENTRAL', 'ECDSA_P256_SHA256', $3, $4, 'ACTIVE')`,
      [`${keyId}-n`, world.operatorId, await kms.publicKey(ref), ref],
    );
    h = harness(ref, kms);
    expect(await h.signer.runOnce()).toBe(1);
    expect((await reasonOf(retired)).discard_reason).toBe('KEY_NOT_ACTIVE');
    await h.close();

    const world2 = await newWorld(owner, kms, ref);
    const second = world2.keyId;
    const revoked = await seedDraft(owner, world2);
    await owner.query("UPDATE snapshot_signing_key SET status = 'REVOKED' WHERE key_id = $1", [
      second,
    ]);
    h = harness(ref, kms);
    expect(await h.signer.runOnce()).toBe(1);
    expect((await reasonOf(revoked)).discard_reason).toBe('KEY_NOT_PUBLISHED');
    expect(await publishedVersions(owner, world2.ledgerId)).toHaveLength(0);
    expect(h.signer.alarm()).toBe(3);
  });

  it('signature qui ne se vérifie pas avec la clé publique de la référence : rien n’est publié', async () => {
    const world = await newWorld(owner, kms, ref);
    await seedDraft(owner, world);
    const other = `fake-kms:ecc:${'o'.repeat(8)}`;
    const lying = {
      sign: (_ref: string, message: Uint8Array) => kms.sign(other, message),
      publicKey: (keyRef: string) => kms.publicKey(keyRef),
    };
    h = harness(ref, lying as never);
    expect(await h.signer.runOnce()).toBe(0);
    expect(h.signer.alarm()).toBe(3);
    expect(await publishedVersions(owner, world.ledgerId)).toHaveLength(0);
  });

  it('constructeur : référence de clé vide refusée', () => {
    h = harness(ref, kms);
    expect(() => harness('', kms)).toThrow(/SNAPSHOT_SIGNING_KEY_REF/);
  });
});
