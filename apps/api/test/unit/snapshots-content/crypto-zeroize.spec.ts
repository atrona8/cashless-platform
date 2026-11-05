// Effacement des secrets (WP12, T050, T051) : un port espion garde les tampons rendus ; après
// l'appel ils sont entièrement à zéro, y compris quand une ligne échoue.
import { createECDH, randomUUID } from 'node:crypto';
import { FakeKms, TEST_WRAPPING_KEY_REF } from '../../../src/kms/fake-kms';
import { SnapshotKeyWrapper } from '../../../src/snapshots-content/crypto/snapshot-key-wrapper';
import { createHash } from 'node:crypto';
import {
  LEDGER,
  OPERATOR,
  liveRow,
  makeEncryptor,
  newDek,
} from '../../support/snapshot-crypto-fixtures';

const PWD = Buffer.from('c4a55e7f0199', 'hex');
const allZero = (b: Buffer): boolean => b.every((byte) => byte === 0);

/** Faux service de clés qui garde chaque tampon en clair qu'il rend. */
class SpyKms extends FakeKms {
  readonly handed: Buffer[] = [];
  override async generateDataKey(ref: string) {
    const out = await super.generateDataKey(ref);
    this.handed.push(out.plaintext);
    return out;
  }
  override async decrypt(ref: string, encrypted: Uint8Array) {
    const out = await super.decrypt(ref, encrypted);
    this.handed.push(out);
    return out;
  }
}

describe('effacement des secrets', () => {
  it('encrypt : K_v et clé de données à zéro après l’appel (cache à 0 s)', async () => {
    const kms = new SpyKms();
    const dek = await newDek(kms);
    kms.handed.length = 0;
    const id = randomUUID();
    const { encryptor } = makeEncryptor(kms, new Map([[id, dek]]), 0);
    await encryptor.encrypt({
      operatorId: OPERATOR,
      ledgerId: LEDGER,
      version: 3,
      rows: [liveRow(dek, id, PWD), liveRow(dek, id, PWD)],
    });
    // K_v (generateDataKey) + clé de données (decrypt)
    expect(kms.handed).toHaveLength(2);
    expect(kms.handed.every(allZero)).toBe(true);
  });

  it('encrypt : à zéro aussi si une ligne échoue ou si le service de clés tombe', async () => {
    const kms = new SpyKms();
    const dek = await newDek(kms);
    kms.handed.length = 0;
    const id = randomUUID();
    const { encryptor } = makeEncryptor(kms, new Map([[id, dek]]), 0);
    const broken = liveRow(dek, id, PWD);
    broken.pwdPackEnc![10] = broken.pwdPackEnc![10]! ^ 1;
    const out = await encryptor.encrypt({
      operatorId: OPERATOR,
      ledgerId: LEDGER,
      version: 3,
      rows: [broken, liveRow(dek, id, PWD)],
    });
    expect(out.skipped).toHaveLength(1);
    expect(kms.handed.every(allZero)).toBe(true);
    // Panne du déchiffrement de la clé de données : K_v déjà tirée est tout de même effacée.
    kms.failNext('decrypt');
    await expect(
      encryptor.encrypt({
        operatorId: OPERATOR,
        ledgerId: LEDGER,
        version: 4,
        rows: [liveRow(dek, id, PWD)],
      }),
    ).rejects.toThrow();
    expect(kms.handed.length).toBeGreaterThanOrEqual(3);
    expect(kms.handed.every(allZero)).toBe(true);
  });

  it('le cache garde la clé de données le temps réglé, K_v jamais', async () => {
    const kms = new SpyKms();
    const dek = await newDek(kms);
    kms.handed.length = 0;
    const id = randomUUID();
    const { encryptor, cache } = makeEncryptor(kms, new Map([[id, dek]]), 60);
    await encryptor.encrypt({
      operatorId: OPERATOR,
      ledgerId: LEDGER,
      version: 3,
      rows: [liveRow(dek, id, PWD)],
    });
    const [kv, cachedDek] = kms.handed as [Buffer, Buffer];
    expect(allZero(kv)).toBe(true);
    expect(allZero(cachedDek)).toBe(false);
    cache.onModuleDestroy();
    expect(allZero(cachedDek)).toBe(true);
  });

  it('enveloppes : K_v à zéro après le scellement, clé de terminal refusée aussi', async () => {
    const kms = new SpyKms();
    const wrapper = new SnapshotKeyWrapper(kms, { tagWrappingKeyRef: TEST_WRAPPING_KEY_REF });
    const content = await kms.generateDataKey(TEST_WRAPPING_KEY_REF);
    content.plaintext.fill(0);
    kms.handed.length = 0;
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    const good = ecdh.getPublicKey();
    const bad = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]);
    const sha = (key: Buffer): Buffer => createHash('sha256').update(key).digest();
    const outcomes = await wrapper.seal(
      { ledgerId: LEDGER, version: 5n, contentKeyWrapped: content.encrypted },
      [
        { deviceId: randomUUID(), agreementPublicKey: good, agreementKeySha256: sha(good) },
        { deviceId: randomUUID(), agreementPublicKey: bad, agreementKeySha256: sha(bad) },
        { deviceId: randomUUID(), agreementPublicKey: good, agreementKeySha256: Buffer.alloc(32) },
      ],
    );
    expect(outcomes.map((o) => ('error' in o ? o.error : 'ok'))).toEqual([
      'ok',
      'BAD_AGREEMENT_KEY',
      'KEY_FINGERPRINT_MISMATCH',
    ]);
    expect(kms.handed).toHaveLength(1);
    expect(kms.handed.every(allZero)).toBe(true);
  });

  it('enveloppes : K_v à zéro quand le scellement lève une erreur inattendue', async () => {
    const kms = new SpyKms();
    const wrapper = new SnapshotKeyWrapper(kms, { tagWrappingKeyRef: TEST_WRAPPING_KEY_REF });
    const content = await kms.generateDataKey(TEST_WRAPPING_KEY_REF);
    kms.handed.length = 0;
    const key = createECDH('prime256v1');
    key.generateKeys();
    const pub = key.getPublicKey();
    await expect(
      wrapper.seal({ ledgerId: 'pas-un-uuid', version: 1n, contentKeyWrapped: content.encrypted }, [
        {
          deviceId: randomUUID(),
          agreementPublicKey: pub,
          agreementKeySha256: createHash('sha256').update(pub).digest(),
        },
      ]),
    ).rejects.toThrow();
    expect(kms.handed).toHaveLength(1);
    expect(allZero(kms.handed[0]!)).toBe(true);
  });
});
