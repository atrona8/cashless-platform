import {
  forceAuthority,
  makeHarness,
  authorityRow,
  type Harness,
} from '../authority/_support/harness';
import { makeRep, hex, uid, q, type Rep } from '../replication/_support/harness';

let h: Harness;
afterEach(async () => {
  const done = h;
  h = undefined as unknown as Harness;
  await done?.close();
});

describe('STANDBY (FR-030)', () => {
  it(
    'tout débit est refusé : 409 CONFLICT_STATE, GATEWAY_NOT_AUTHORITY, rien ' + 'd’écrit',
    async () => {
      h = await makeHarness();
      await forceAuthority(h.db, { state: 'STANDBY' });
      const ops = Number((await h.db.pool.query('SELECT count(*) AS n FROM edge_op')).rows[0].n);
      await expect(h.authority.assertCanDebit(null)).rejects.toMatchObject({
        code: 'CONFLICT_STATE',
        httpStatus: 409,
        detail: 'GATEWAY_NOT_AUTHORITY',
      });
      expect(Number((await h.db.pool.query('SELECT count(*) AS n FROM edge_op')).rows[0].n)).toBe(
        ops,
      );
    },
  );

  it('aucune écriture directe dans edge_authority ne mène STANDBY à ACTIVE', async () => {
    h = await makeHarness();
    await forceAuthority(h.db, { state: 'STANDBY' });
    await expect(h.db.pool.query(`UPDATE edge_authority SET state = 'ACTIVE'`)).rejects.toThrow();
    await expect(
      h.db.pool.query(`UPDATE edge_authority SET state = 'ARMED'`),
    ).resolves.toBeDefined();
    expect((await authorityRow(h.db)).state).toBe('ARMED');
  });

  it(
    'promotion par le rôle : ARMED (pas ACTIVE, pas de débit), copie complète ' + 'demandée',
    async () => {
      h = await makeHarness();
      await forceAuthority(h.db, { state: 'STANDBY' });
      await h.db.pool.query('UPDATE edge_replication_cursor SET last_change_seq = 42');
      await h.authority.onRoleChanged('PRIMARY');
      expect((await authorityRow(h.db)).state).toBe('ARMED');
      expect(
        Number(
          (await h.db.pool.query('SELECT last_change_seq FROM edge_replication_cursor')).rows[0]
            .last_change_seq,
        ),
      ).toBe(0);
      await expect(h.authority.assertCanDebit(null)).rejects.toMatchObject({
        detail: 'GATEWAY_NOT_AUTHORITY',
      });
    },
  );

  it(
    'rôle STANDBY répliqué : aucun colis, aucune clé, aucune empreinte de jeton ' + 'stockés',
    async () => {
      const r: Rep = await makeRep({ role: 'STANDBY' });
      try {
        r.feed.queue.push(
          r.page(
            {
              media: [
                {
                  token_hash: hex(3),
                  nfc_uid: '04aabbccddeeff',
                  key_index: 1,
                  status: 'ACTIVE',
                  pwd_pack_enc: {
                    nonce: Buffer.from('nonce-nonce1').toString('base64'),
                    ciphertext: Buffer.from('opaque').toString('base64'),
                    tag: Buffer.from('tag-tag-tag-tag-').toString('base64'),
                  },
                  pwd_pack_sha256: 'f'.repeat(64),
                },
              ],
              pwd_pack_key: {
                alg: 'ECDH-ES+HKDF-SHA256+A256GCM',
                epk: 'ZXBr',
                iv: 'aXZpdml2aXZpdg==',
                wrapped_key: 'd3JhcHBlZA==',
              },
            },
            {
              to_change_seq: 1,
              devices: [
                {
                  device_id: uid(),
                  serial: 'T',
                  kind: 'POS',
                  app_mode: null,
                  status: 'ACTIVE',
                  public_key: 'cHVi',
                  cert_sha256: 'a'.repeat(64),
                  token_family: {
                    fid: uid(),
                    status: 'ACTIVE',
                    refresh_token_sha256_current: 'b'.repeat(64),
                  },
                },
              ],
            },
          ),
        );
        await r.svc.pullOnce();
        expect(await q(r, 'SELECT 1 FROM edge_media WHERE pwd_pack_enc IS NOT NULL')).toHaveLength(
          0,
        );
        expect(await q(r, 'SELECT 1 FROM edge_pwd_pack_key')).toHaveLength(0);
        expect(await q(r, 'SELECT 1 FROM edge_device_token_family')).toHaveLength(0);
      } finally {
        await r.close();
      }
    },
  );
});
