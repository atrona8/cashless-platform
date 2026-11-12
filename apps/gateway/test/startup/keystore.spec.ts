import { createPublicKey, createVerify } from 'node:crypto';
import { FakeHardwareKeystore } from '../../src/key-store/fake-hardware-keystore';
import { KEY_USES, KeystoreError } from '../../src/key-store/hardware-keystore.port';
import { createHardwareKeystore } from '../../src/key-store/hardware-keystore.factory';
import { createTestDb, type TestDb } from './_support/db';

describe('port matériel (faux)', () => {
  it('est un faux déclaré, signe en ES256 vérifiable, accorde en ECDH', async () => {
    const a = new FakeHardwareKeystore();
    const b = new FakeHardwareKeystore();
    expect(a.isFake).toBe(true);
    const data = Buffer.from('lot');
    const signature = await a.sign('batch', data);
    expect(signature).toHaveLength(64);
    const key = createPublicKey({ key: await a.publicKey('batch'), format: 'der', type: 'spki' });
    expect(
      createVerify('sha256').update(data).verify({ key, dsaEncoding: 'ieee-p1363' }, signature),
    ).toBe(true);
    const s1 = await a.agree(await b.publicKey('agreement'));
    const s2 = await b.agree(await a.publicKey('agreement'));
    expect(s1.equals(s2)).toBe(true);
  });

  it.each(KEY_USES)(
    'après destroy(%s), sign, agree et publicKey refusent (KEY_DESTROYED)',
    async (use) => {
      const ks = new FakeHardwareKeystore();
      const peer = await new FakeHardwareKeystore().publicKey('agreement');
      await ks.publicKey(use);
      await ks.destroy(use);
      await expect(ks.publicKey(use)).rejects.toMatchObject({ code: 'KEY_DESTROYED' });
      if (use === 'agreement')
        await expect(ks.agree(peer)).rejects.toMatchObject({ code: 'KEY_DESTROYED' });
      else
        await expect(ks.sign(use, Buffer.from('x'))).rejects.toMatchObject({
          code: 'KEY_DESTROYED',
        });
      await expect(ks.publicKey(use)).rejects.toBeInstanceOf(KeystoreError);
    },
  );

  it('destroy est définitif : la clé ne se régénère pas', async () => {
    const ks = new FakeHardwareKeystore();
    await ks.publicKey('token');
    await ks.destroy('token');
    await expect(ks.sign('token', Buffer.from('x'))).rejects.toMatchObject({
      code: 'KEY_DESTROYED',
    });
  });

  it('aucune méthode d’export, aucune clé privée atteignable par réflexion', async () => {
    const ks = new FakeHardwareKeystore();
    await ks.publicKey('snapshot');
    const names = new Set<string>();
    for (let o: object | null = ks; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
      Object.getOwnPropertyNames(o).forEach((n) => names.add(n));
    }
    expect(
      [...names].filter((n) => /export|private|secret|dump|key$/i.test(n) && n !== 'publicKey'),
    ).toEqual([]);
    expect(Object.getOwnPropertySymbols(ks)).toEqual([]);
    expect(JSON.stringify(ks)).toBe('{"isFake":true}');
  });

  it('la clé privée ne figure ni dans la base ni dans la sortie du processus', async () => {
    const db: TestDb = await createTestDb();
    const writes: string[] = [];
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    });
    try {
      const ks = new FakeHardwareKeystore();
      await ks.sign('batch', Buffer.from('x'));
      const { rows } = await db.pool.query(
        `SELECT table_name, column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND data_type IN ('text', 'bytea', 'jsonb')`,
      );
      let dump = '';
      for (const r of rows as { table_name: string; column_name: string }[]) {
        const res = await db.pool.query(
          `SELECT "${r.column_name}"::text AS v FROM "${r.table_name}"`,
        );
        dump += res.rows.map((x: { v: string | null }) => x.v).join('\n');
      }
      expect(dump).not.toMatch(/PRIVATE KEY/);
      expect(writes.join('')).not.toMatch(/PRIVATE KEY/);
    } finally {
      spy.mockRestore();
      await db.drop();
    }
  });

  it('la fabrique refuse hardware sans adaptateur (pas de repli sur le faux)', () => {
    expect(() => createHardwareKeystore({ hardwareKeystore: 'hardware' })).toThrow(/adaptateur/);
  });
});
