// Intégration (WP12, T051/T052) : enveloppes de K_v par terminal. Rôle cashless_snapcontent, base
// de lot ;
// la suite crée son prestataire et son grand livre et n'affirme rien de global.
import { Pool } from 'pg';
import {
  fromWrappedKey,
  openForRecipient,
  openPwdPack,
  snapshotKeyAad,
  snapshotPwdAad,
  TagFormatError,
  type WrappedKey,
} from '@cashless/tag-format';
import { FakeKms } from '../../../src/kms/fake-kms';
import { OWNER_URL } from '../../support/db';
import {
  addBracelet,
  addTerminal,
  CANARY,
  createFixture,
  dekPlaintext,
  makeWorkers,
  newTerminal,
  publishReady,
  SNAPCONTENT_URL,
  type Bracelet,
  type Fixture,
  type Terminal,
  type Workers,
} from '../../support/snapshot-secrets-db';

describe('snapshot-content : enveloppes par terminal (WP12)', () => {
  let owner: Pool;
  let content: Pool;
  let kms: FakeKms;
  let f: Fixture;
  let w: Workers;
  let bracelets: Bracelet[];
  const a = newTerminal();
  const b = newTerminal();
  const suspended = newTerminal();
  const revoked = newTerminal();
  const version = (): bigint => 1n;

  async function envelopes(): Promise<
    Array<{
      device_id: string;
      version: string;
      agreement_key_sha256: Buffer;
      envelope: WrappedKey;
    }>
  > {
    return (
      await owner.query(
        'SELECT device_id, version, agreement_key_sha256, envelope FROM offline_snapshot_key ' +
          'WHERE ledger_id = $1 ORDER BY version, device_id',
        [f.ledgerId],
      )
    ).rows;
  }

  beforeAll(async () => {
    owner = new Pool({ connectionString: OWNER_URL });
    content = new Pool({ connectionString: SNAPCONTENT_URL });
    kms = new FakeKms();
    f = await createFixture(owner, kms);
    const dek = await dekPlaintext(owner, kms, f);
    bracelets = [await addBracelet(owner, f, dek), await addBracelet(owner, f, dek)];
    dek.fill(0);
    await addTerminal(owner, f, a);
    await addTerminal(owner, f, b);
    await addTerminal(owner, f, suspended, 'SUSPENDED');
    await addTerminal(owner, f, revoked, 'REVOKED');
    w = makeWorkers(content, f, kms);
    expect(await w.content.runOnce()).toBe(1);
    expect(await publishReady(owner, f)).toBe(1);
  });
  afterAll(async () => {
    await w.close();
    await owner.end();
    await content.end();
  });

  function keyOf(t: Terminal, row: { envelope: WrappedKey }, v = version()): Buffer {
    return openForRecipient({
      recipientPrivateKey: t.privateKey,
      blob: fromWrappedKey(row.envelope),
      aad: snapshotKeyAad(f.ledgerId, v, t.id),
    });
  }

  it('terminal ACTIVE : enveloppe ouvrable, qui déchiffre le mot de passe', async () => {
    expect(await w.wrapping.runOnce()).toBe(2);
    const rows = await envelopes();
    expect(rows.map((r) => r.device_id).sort()).toEqual([a.id, b.id].sort());
    const mine = rows.find((r) => r.device_id === a.id)!;
    expect(Object.keys(mine.envelope).sort()).toEqual(['alg', 'epk', 'iv', 'wrapped_key']);
    const kv = keyOf(a, mine);
    expect(kv).toHaveLength(32);
    const { rows: entries } = await owner.query(
      'SELECT token_hash, pwd_pack_enc FROM offline_snapshot_entry WHERE ledger_id = $1',
      [f.ledgerId],
    );
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      const bracelet = bracelets.find((x) => x.tokenHash.equals(entry.token_hash))!;
      const pwd = openPwdPack({
        dek: kv,
        blob: entry.pwd_pack_enc,
        aad: snapshotPwdAad(f.ledgerId, version(), bracelet.tokenHash, bracelet.uid),
      });
      expect(pwd.equals(CANARY)).toBe(true);
    }
  });

  it('l’enveloppe d’un autre terminal ne s’ouvre pas (clé, device_id de l’AAD)', async () => {
    const rows = await envelopes();
    const forA = rows.find((r) => r.device_id === a.id)!;
    const forB = rows.find((r) => r.device_id === b.id)!;
    const attempt = (key: Terminal, row: typeof forA, deviceId: string): string => {
      try {
        openForRecipient({
          recipientPrivateKey: key.privateKey,
          blob: fromWrappedKey(row.envelope),
          aad: snapshotKeyAad(f.ledgerId, version(), deviceId),
        });
        return 'ouvert';
      } catch (error) {
        return error instanceof TagFormatError ? error.code : String(error);
      }
    };
    expect(attempt(b, forA, a.id)).toBe('AUTH_FAILED'); // clé de B sur l’enveloppe de A
    expect(attempt(a, forA, b.id)).toBe('AUTH_FAILED'); // bonne clé, mauvais device_id
    expect(attempt(a, forB, b.id)).toBe('AUTH_FAILED'); // enveloppe de B avec la clé de A
    expect(attempt(a, forA, a.id)).toBe('ouvert');
    expect(keyOf(a, forA).equals(keyOf(b, forB))).toBe(true); // même K_v, enveloppes distinctes
    expect(forA.envelope.epk).not.toBe(forB.envelope.epk);
  });

  it('terminal suspendu ou révoqué : aucune enveloppe, la file ne le rend jamais', async () => {
    const rows = await envelopes();
    expect(rows.some((r) => r.device_id === suspended.id || r.device_id === revoked.id)).toBe(
      false,
    );
    const queued = await w.wrappingRepo.toWrap(500);
    expect(queued.some((q) => q.deviceId === suspended.id || q.deviceId === revoked.id)).toBe(
      false,
    );
  });

  it('rejouer ne duplique rien (idempotent)', async () => {
    const before = await envelopes();
    expect(await w.wrapping.runOnce()).toBe(0);
    expect(await envelopes()).toHaveLength(before.length);
  });

  it('terminal devenu éligible plus tard : couvert, pour la version déjà publiée', async () => {
    const late = newTerminal();
    await addTerminal(owner, f, late);
    expect(await w.wrapping.runOnce()).toBe(1);
    const row = (await envelopes()).find((r) => r.device_id === late.id)!;
    expect(keyOf(late, row)).toHaveLength(32);
  });

  it('clé d’accord changée entre la file et l’écriture : refus, puis relue', async () => {
    const mover = newTerminal();
    await addTerminal(owner, f, mover);
    const queued = (await w.wrappingRepo.toWrap(500)).find((q) => q.deviceId === mover.id)!;
    const operators = await w.wrappingRepo.operators();
    // La clé du terminal change avant l'écriture.
    const fresh = newTerminal();
    await owner.query('UPDATE device SET agreement_public_key = $2 WHERE id = $1', [
      mover.id,
      fresh.publicKey,
    ]);
    const stale = {
      envelope: { alg: 'ECDH-ES+HKDF-SHA256+A256GCM', epk: 'x', iv: 'x', wrapped_key: 'x' },
    };
    expect(
      await w.wrappingRepo.store(operators.get(f.ledgerId)!, queued, stale.envelope as WrappedKey),
    ).toBe(false);
    expect((await envelopes()).some((r) => r.device_id === mover.id)).toBe(false);
    // Le passage suivant relit la file avec la nouvelle clé.
    expect(await w.wrapping.runOnce()).toBe(1);
    const row = (await envelopes()).find((r) => r.device_id === mover.id)!;
    const ok = openForRecipient({
      recipientPrivateKey: fresh.privateKey,
      blob: fromWrappedKey(row.envelope),
      aad: snapshotKeyAad(f.ledgerId, version(), mover.id),
    });
    expect(ok).toHaveLength(32);
  });

  it('panne de la base à mi-chemin : rien d’écrit à moitié, reprise ensuite', async () => {
    const t = newTerminal();
    await addTerminal(owner, f, t);
    w.wrappingRepo.failStore = true;
    await expect(w.wrapping.runOnce()).rejects.toThrow(/panne de base/);
    w.wrappingRepo.failStore = false;
    expect((await envelopes()).some((r) => r.device_id === t.id)).toBe(false);
    expect(await w.wrapping.runOnce()).toBe(1);
  });

  it('service de clés indisponible : alarme 3, rien d’écrit, reprise ensuite', async () => {
    const t = newTerminal();
    await addTerminal(owner, f, t);
    kms.failNext('decrypt');
    expect(await w.wrapping.runOnce()).toBe(0);
    expect(w.wrapping.alarm()).toBe(3);
    expect((await envelopes()).some((r) => r.device_id === t.id)).toBe(false);
    expect(await w.wrapping.runOnce()).toBe(1);
  });
});
