// Support des tests de WP12 : chiffreur sans base (TenantTx et dépôt des clés de données simulés),
// lignes de source avec un vrai mot de passe chiffré sous une clé de données du faux service de
// clés.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { pwdPackAad, sealPwdPack } from '@cashless/tag-format';
import { DekCache } from '../../src/media/keys/dek-cache';
import { FakeKms, TEST_WRAPPING_KEY_REF } from '../../src/kms/fake-kms';
import type { DataKeyRepository } from '../../src/media/keys/data-key.repository';
import type { TenantTx } from '../../src/db/tenant-tx';
import { SnapshotEntryEncryptor } from '../../src/snapshots-content/crypto/snapshot-entry-encryptor';
import type { LiveRow } from '../../src/snapshots-content/entry-encryptor';

export const OPERATOR = '11111111-1111-4111-8111-111111111111';
export const LEDGER = '22222222-2222-4222-8222-222222222222';

export interface StoredDek {
  wrappingKeyRef: string;
  encrypted: Buffer;
  status: string;
  plaintext: Buffer;
}

export async function newDek(kms: FakeKms, status = 'ACTIVE'): Promise<StoredDek> {
  const key = await kms.generateDataKey(TEST_WRAPPING_KEY_REF);
  return {
    wrappingKeyRef: TEST_WRAPPING_KEY_REF,
    encrypted: key.encrypted,
    status,
    plaintext: key.plaintext,
  };
}

/** Ligne de source dont le mot de passe est chiffré sous `dek` (stockage des bracelets). */
export function liveRow(
  dek: StoredDek,
  dekId: string,
  pwdPack: Buffer | null,
  extra: Partial<LiveRow> = {},
): LiveRow {
  const mediaId = randomUUID();
  const nfcUid = randomBytes(7);
  const tokenHash = createHash('sha256').update(mediaId).digest();
  const keyIndex = 1;
  const pwdPackEnc =
    pwdPack === null
      ? null
      : sealPwdPack({
          dek: dek.plaintext,
          nonce: randomBytes(12),
          pwdPack,
          aad: pwdPackAad({ mediaId, operatorId: OPERATOR, keyIndex, uid: nfcUid }),
        });
  return {
    tokenHash,
    mediaId,
    entry: {
      token_hash: tokenHash.toString('hex'),
      nfc_uid: nfcUid.toString('hex'),
      key_index: keyIndex,
      originality_sig_sha256: null,
      status: 'ACTIVE',
      batch_event_id: null,
      batch_status: 'ACTIVE',
      wallet_status: 'ACTIVE',
      spendable: 0,
      last_counter: null,
      pwd_pack_sha256: null,
    },
    pwdPackEnc,
    pwdPackDekId: pwdPack === null ? null : dekId,
    keyIndex,
    nfcUid,
    ...extra,
  };
}

export function makeEncryptor(
  kms: FakeKms,
  deks: Map<string, StoredDek>,
  cacheSeconds = 0,
): { encryptor: SnapshotEntryEncryptor; cache: DekCache } {
  const tx = { run: (_op: string, fn: (c: never) => unknown) => fn({} as never) };
  const keys = {
    encrypted: (_client: unknown, id: string) => {
      const dek = deks.get(id);
      return Promise.resolve(
        dek
          ? { wrappingKeyRef: dek.wrappingKeyRef, encrypted: dek.encrypted, status: dek.status }
          : null,
      );
    },
  };
  const cache = new DekCache({ tagDekCacheSeconds: cacheSeconds });
  const encryptor = new SnapshotEntryEncryptor(
    kms,
    kms,
    tx as unknown as TenantTx,
    keys as unknown as DataKeyRepository,
    cache,
    { tagWrappingKeyRef: TEST_WRAPPING_KEY_REF },
  );
  return { encryptor, cache };
}
