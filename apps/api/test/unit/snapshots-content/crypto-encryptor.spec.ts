// Chiffreur d'entrées de snapshot (WP12, T050) : AAD liée à la version et au bracelet, nonces
// distincts, empreinte, entrée sans mot de passe, clé de données retirée.
import { createHash, randomUUID } from 'node:crypto';
import { openPwdPack, snapshotPwdAad, TagFormatError } from '@cashless/tag-format';
import { FakeKms } from '../../../src/kms/fake-kms';
import { KmsUnavailableError } from '../../../src/kms/kms.ports';
import {
  OPERATOR,
  LEDGER,
  liveRow,
  makeEncryptor,
  newDek,
  type StoredDek,
} from '../../support/snapshot-crypto-fixtures';

const PWD_A = Buffer.from('c4a55e7f0199', 'hex');
const PWD_B = Buffer.from('0102030405ff', 'hex');

describe('SnapshotEntryEncryptor', () => {
  let kms: FakeKms;
  let dek: StoredDek;
  let deks: Map<string, StoredDek>;
  const DEK_ID = randomUUID();

  beforeEach(async () => {
    kms = new FakeKms();
    dek = await newDek(kms);
    deks = new Map([[DEK_ID, dek]]);
  });

  async function run(version: number, rows = [liveRow(dek, DEK_ID, PWD_A)]) {
    const { encryptor } = makeEncryptor(kms, deks);
    const out = await encryptor.encrypt({ operatorId: OPERATOR, ledgerId: LEDGER, version, rows });
    return { out, rows };
  }

  /** Rouvre un chiffré avec K_v (rouverte par le faux service de clés) et l'AAD de snapshot. */
  async function open(
    contentKeyWrapped: Buffer,
    enc: string,
    version: bigint,
    row: ReturnType<typeof liveRow>,
  ): Promise<Buffer> {
    const kv = await kms.decrypt('fake-kms:wrap:test', contentKeyWrapped);
    try {
      return openPwdPack({
        dek: kv,
        blob: Buffer.from(enc, 'hex'),
        aad: snapshotPwdAad(LEDGER, version, row.tokenHash, row.nfcUid!),
      });
    } finally {
      kv.fill(0);
    }
  }

  it('un mot de passe chiffré se rouvre avec K_v et l’AAD, jamais sans', async () => {
    const { out, rows } = await run(7);
    const enc = out.entries[0]!.pwdPackEncHex!;
    expect(enc).toHaveLength(68);
    expect((await open(out.contentKeyWrapped, enc, 7n, rows[0]!)).equals(PWD_A)).toBe(true);
    // Le chiffré ne contient pas le mot de passe en clair.
    expect(enc).not.toContain(PWD_A.toString('hex'));
    // Sans la bonne clé de contenu : refus.
    expect(() =>
      openPwdPack({
        dek: dek.plaintext,
        blob: Buffer.from(enc, 'hex'),
        aad: snapshotPwdAad(LEDGER, 7n, rows[0]!.tokenHash, rows[0]!.nfcUid!),
      }),
    ).toThrow(TagFormatError);
  });

  it('l’AAD lie version et bracelet : un octet de changé casse l’ouverture', async () => {
    const { out, rows } = await run(7);
    const enc = out.entries[0]!.pwdPackEncHex!;
    await expect(open(out.contentKeyWrapped, enc, 8n, rows[0]!)).rejects.toThrow(TagFormatError);
    await expect(open(out.contentKeyWrapped, enc, 6n, rows[0]!)).rejects.toThrow(TagFormatError);
    const other = liveRow(dek, DEK_ID, PWD_A);
    await expect(open(out.contentKeyWrapped, enc, 7n, other)).rejects.toThrow(TagFormatError);
    // Même version, même bracelet mais autre uid : refus aussi.
    const moved = { ...rows[0]!, nfcUid: Buffer.from(rows[0]!.nfcUid!.map((b) => b ^ 1)) };
    await expect(open(out.contentKeyWrapped, enc, 7n, moved)).rejects.toThrow(TagFormatError);
  });

  it('nonces distincts entre bracelets, et K_v neuve à chaque version', async () => {
    const rows = [liveRow(dek, DEK_ID, PWD_A), liveRow(dek, DEK_ID, PWD_A)];
    const first = await run(3, rows);
    const nonces = first.out.entries.map((e) => e.pwdPackEncHex!.slice(0, 24));
    expect(new Set(nonces).size).toBe(2);
    const second = await run(4, rows);
    expect(second.out.contentKeyWrapped.equals(first.out.contentKeyWrapped)).toBe(false);
    expect(second.out.entries[0]!.pwdPackEncHex).not.toBe(first.out.entries[0]!.pwdPackEncHex);
  });

  it('pwd_pack_sha256 = SHA-256 du chiffré (34 octets) ; sans mot de passe : nuls', async () => {
    const withPwd = liveRow(dek, DEK_ID, PWD_B);
    const without = liveRow(dek, DEK_ID, null);
    const { out } = await run(2, [withPwd, without]);
    const [a, b] = out.entries;
    const bytes = Buffer.from(a!.pwdPackEncHex!, 'hex');
    expect(bytes).toHaveLength(34);
    expect(a!.entry.pwd_pack_sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(b).toMatchObject({ pwdPackEncHex: null, entry: { pwd_pack_sha256: null } });
    expect(out.skipped).toEqual([]);
  });

  it('clé de données RETIRED : entrée sans mot de passe, erreur nommée, aucun clair', async () => {
    deks.set(DEK_ID, { ...dek, status: 'RETIRED' });
    const { out, rows } = await run(2);
    expect(out.entries[0]).toMatchObject({ pwdPackEncHex: null });
    expect(out.entries[0]!.entry.pwd_pack_sha256).toBeNull();
    expect(out.skipped).toEqual([{ tokenHash: rows[0]!.tokenHash, code: 'PWD_DEK_RETIRED' }]);
    expect(JSON.stringify(out)).not.toContain(PWD_A.toString('hex'));
  });

  it('clé de données absente, chiffré corrompu, ligne incomplète : causes nommées', async () => {
    const corrupted = liveRow(dek, DEK_ID, PWD_A);
    corrupted.pwdPackEnc![20] = corrupted.pwdPackEnc![20]! ^ 1;
    const missing = liveRow(dek, randomUUID(), PWD_A);
    const incomplete = liveRow(dek, DEK_ID, PWD_A, { nfcUid: null });
    const ok = liveRow(dek, DEK_ID, PWD_B);
    const { out } = await run(2, [corrupted, missing, incomplete, ok]);
    const codes = new Map(out.skipped.map((s) => [s.tokenHash.toString('hex'), s.code]));
    expect(codes.get(corrupted.tokenHash.toString('hex'))).toBe('PWD_OPEN_FAILED');
    expect(codes.get(missing.tokenHash.toString('hex'))).toBe('PWD_DEK_MISSING');
    expect(codes.get(incomplete.tokenHash.toString('hex'))).toBe('PWD_INCOMPLETE_ROW');
    expect(codes.has(ok.tokenHash.toString('hex'))).toBe(false);
    expect(out.entries[3]!.pwdPackEncHex).toHaveLength(68);
  });

  it('un seul déchiffrement du service de clés par clé de données, pas par bracelet', async () => {
    const rows = Array.from({ length: 5 }, () => liveRow(dek, DEK_ID, PWD_A));
    kms.resetCalls();
    await run(2, rows);
    expect(kms.calls.decrypt).toBe(1);
    expect(kms.calls.generateDataKey).toBe(1);
  });

  it('service de clés indisponible : l’erreur remonte telle quelle, rien n’est rendu', async () => {
    kms.failNext('decrypt');
    await expect(run(2)).rejects.toBeInstanceOf(KmsUnavailableError);
    kms.failNext('generateDataKey');
    await expect(run(2)).rejects.toBeInstanceOf(KmsUnavailableError);
  });

  it('refuse une version invalide', async () => {
    await expect(run(0)).rejects.toThrow(/Version/);
  });
});
