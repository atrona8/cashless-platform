import { hex, makeRep, q, uid, type Rep } from './_support/harness';

let r: Rep | undefined;
afterEach(async () => {
  await r?.close();
  r = undefined;
});

const blob = { nonce: 'bm9uY2Vub25jZQ==', ciphertext: 'Y2lwaGVydGV4dA==', tag: 'dGFndGFndGFndGFn' };
const sealed = {
  alg: 'ECDH-ES+HKDF-SHA256+A256GCM',
  epk: 'ZXBr',
  iv: 'aXZpdml2aXZpdg==',
  wrapped_key: 'd3JhcHBlZA==',
};
const sha = (c: string) => c.repeat(64);
const device = (id: string, serial = 'T-1', status = 'ACTIVE') => ({
  device_id: id,
  serial,
  kind: 'POS',
  app_mode: null,
  status,
  public_key: 'cHVi',
  cert_sha256: sha('a'),
  token_family: { fid: uid(), status: 'ACTIVE', refresh_token_sha256_current: sha('b') },
});
const unassigned = (n: number) => ({
  media_id: uid(),
  nfc_uid: '04aabbccddeeff',
  token_hash: hex(n),
  key_index: 1,
  originality_sig_sha256: sha('c'),
  status: 'PERSONALIZED',
  batch_event_id: null,
  batch_status: 'PERSONALIZED',
  pwd_pack_enc: blob,
  pwd_pack_sha256: sha('d'),
});

describe('entités de référence', () => {
  it('politique hors ligne : max_snapshot_age lu en secondes par la passerelle', async () => {
    r = await makeRep();
    const d = uid();
    const policy = (age: unknown) => ({
      offline_enabled: true,
      max_per_sale: 100000,
      max_snapshot_age: age,
    });
    r.feed.queue.push(
      r.page(
        {},
        {
          to_change_seq: 1,
          devices: [device(d)],
          device_configs: [
            { config_id: 1, device_id: d, in_force: true, offline_policy: policy('00:15:00') },
            {
              config_id: 2,
              device_id: uid(),
              in_force: true,
              offline_policy: policy('1 day 01:00:00'),
            },
            { config_id: 3, device_id: uid(), in_force: true, offline_policy: policy('bientôt') },
          ],
        },
      ),
    );
    await r.svc.pullOnce();
    const rows = await q<{ s: number | null }>(
      r,
      `SELECT (c->'offline_policy'->>'max_snapshot_age_seconds')::int AS s
         FROM edge_event_setting, jsonb_array_elements(policy_in_force) c ORDER BY (c->>'config_id')::int`,
    );
    expect(rows.map((x) => x.s)).toEqual([900, 90000, null]);
  });

  it('remplacement en entier : le même terminal rapporté deux fois = une seule ligne, à jour', async () => {
    r = await makeRep();
    const d = uid();
    r.feed.queue.push(r.page({}, { to_change_seq: 1, devices: [device(d, 'T-1', 'ACTIVE')] }));
    r.feed.queue.push(
      r.page(
        {},
        { from_change_seq: 1, to_change_seq: 2, devices: [device(d, 'T-1', 'SUSPENDED')] },
      ),
    );
    await r.svc.pullOnce();
    await r.svc.pullOnce();
    const rows = await q<{ status: string }>(r, 'SELECT status FROM edge_device');
    expect(rows).toEqual([{ status: 'SUSPENDED' }]);
    // catalogue : remplacé en entier
    const pos = uid();
    const item = (n: string) => ({
      product_id: uid(),
      name_fr: n,
      name_en: n,
      unit_price: 100,
      vat_rate_bps: 0,
    });
    r.feed.queue.push(
      r.page(
        {},
        {
          from_change_seq: 2,
          to_change_seq: 3,
          catalogs: [{ pos_id: pos, version: 1, items: [item('a'), item('b')] }],
        },
      ),
    );
    r.feed.queue.push(
      r.page(
        {},
        {
          from_change_seq: 3,
          to_change_seq: 4,
          catalogs: [{ pos_id: pos, version: 2, items: [item('c')] }],
        },
      ),
    );
    await r.svc.pullOnce();
    await r.svc.pullOnce();
    expect(await q(r, 'SELECT version FROM edge_catalog_item')).toEqual([{ version: '2' }]);
  });

  it('media_refs prime sur media[] ; wallet_states prime sur wallets[].status', async () => {
    r = await makeRep();
    const w = uid();
    const mediaEntry = {
      token_hash: hex(7),
      nfc_uid: '04aabbccddeeff',
      key_index: 1,
      status: 'ACTIVE',
      batch_status: 'ACTIVE',
      last_counter: 3,
      pwd_pack_enc: null,
    };
    r.feed.queue.push(
      r.page(
        {
          to_posting_id: 1,
          wallets: [{ wallet_id: w, status: 'ACTIVE', paid: 10, promo: 0 }],
          media: [mediaEntry],
        },
        {
          to_change_seq: 5,
          media_refs: [{ media_id: uid(), token_hash: hex(7), wallet_id: w, status: 'SUSPENDED' }],
          wallet_states: [{ wallet_id: w, status: 'BLOCKED', kyc_verified: true }],
        },
      ),
    );
    await r.svc.pullOnce();
    expect((await q<{ status: string }>(r, 'SELECT status FROM edge_media'))[0]?.status).toBe(
      'SUSPENDED',
    );
    expect((await q<{ status: string }>(r, 'SELECT status FROM edge_wallet'))[0]?.status).toBe(
      'BLOCKED',
    );
    // une page de soldes ultérieure, plus ancienne dans le statut, ne réveille ni le
    // bracelet ni le portefeuille
    r.feed.queue.push(
      r.page(
        {
          from_posting_id: 1,
          to_posting_id: 2,
          wallets: [{ wallet_id: w, status: 'ACTIVE', paid: 10, promo: 0 }],
          media: [mediaEntry],
        },
        { from_change_seq: 5, to_change_seq: 5 },
      ),
    );
    await r.svc.pullOnce();
    expect((await q<{ status: string }>(r, 'SELECT status FROM edge_media'))[0]?.status).toBe(
      'SUSPENDED',
    );
    expect((await q<{ status: string }>(r, 'SELECT status FROM edge_wallet'))[0]?.status).toBe(
      'BLOCKED',
    );
    expect(
      (
        await q<{ identification_tier: string }>(
          r,
          'SELECT identification_tier FROM edge_wallet_state',
        )
      )[0]?.identification_tier,
    ).toBe('VERIFIED');
  });

  it('PRIMARY : empreinte du jeton, clé scellée et colis stockés tels quels', async () => {
    r = await makeRep({ role: 'PRIMARY' });
    r.feed.queue.push(
      r.page(
        { pwd_pack_key: sealed },
        { to_change_seq: 1, devices: [device(uid())], unassigned_media: [unassigned(1)] },
      ),
    );
    await r.svc.pullOnce();
    expect(await q(r, 'SELECT 1 FROM edge_device_token_family')).toHaveLength(1);
    expect(await q(r, 'SELECT 1 FROM edge_pwd_pack_key')).toHaveLength(1);
    expect(await q(r, 'SELECT 1 FROM edge_media WHERE pwd_pack_enc IS NOT NULL')).toHaveLength(1);
  });

  it('STANDBY : aucun colis, aucune clé, aucune empreinte de jeton stockés (A16), même servis', async () => {
    r = await makeRep({ role: 'STANDBY' });
    const media = {
      token_hash: hex(9),
      nfc_uid: '04aabbccddeeff',
      key_index: 1,
      status: 'ACTIVE',
      pwd_pack_enc: blob,
      pwd_pack_sha256: sha('e'),
    };
    r.feed.queue.push(
      r.page(
        { pwd_pack_key: sealed, media: [media] },
        { to_change_seq: 1, devices: [device(uid())], unassigned_media: [unassigned(2)] },
      ),
    );
    await r.svc.pullOnce();
    expect(await q(r, 'SELECT 1 FROM edge_device_token_family')).toHaveLength(0);
    expect(await q(r, 'SELECT 1 FROM edge_pwd_pack_key')).toHaveLength(0);
    expect(
      await q(
        r,
        'SELECT 1 FROM edge_media WHERE pwd_pack_enc IS NOT NULL OR pwd_pack_sha256 IS NOT NULL',
      ),
    ).toHaveLength(0);
    expect(await q(r, 'SELECT 1 FROM edge_media')).toHaveLength(2);
  });

  it('rôle changé : transmis à l’autorité et persisté ; promotion → colis stockés ensuite', async () => {
    r = await makeRep({ role: 'STANDBY' });
    r.feed.queue.push(
      r.page({}, { to_change_seq: 1, gateway: { gateway_id: r.ids.gateway, role: 'PRIMARY' } }),
    );
    await r.svc.pullOnce();
    expect(r.roles.calls).toEqual(['PRIMARY']);
    expect((await q<{ role: string }>(r, 'SELECT role FROM edge_meta'))[0]?.role).toBe('PRIMARY');
    r.feed.queue.push(r.page({ pwd_pack_key: sealed }, { from_change_seq: 1, to_change_seq: 2 }));
    await r.svc.pullOnce();
    expect(await q(r, 'SELECT 1 FROM edge_pwd_pack_key')).toHaveLength(1);
    r.feed.queue.push(
      r.page(
        {},
        { from_change_seq: 2, to_change_seq: 3, gateway: { gateway_id: uid(), role: 'PRIMARY' } },
      ),
    );
    await expect(r.svc.pullOnce()).rejects.toThrow(/autre passerelle/);
  });

  it('device_seq_acked : versé, jamais reculé ; session de caisse : identité de la personne, R-24', async () => {
    r = await makeRep();
    const d = uid();
    const user = uid();
    r.feed.queue.push(
      r.page(
        {
          device_seq_acked: [
            {
              device_id: d,
              contiguous_acked_seq: 7,
              max_seen_seq: 7,
              missing_seqs: [],
              next_seq_floor: 8,
              as_of: '2026-11-09T10:00:00Z',
            },
          ],
        },
        {
          to_change_seq: 1,
          devices: [device(d)],
          staff: [
            {
              user_id: user,
              issuer: 'iss',
              subject: 'sub',
              status: 'ACTIVE',
              roles: [{ role: 'CASHIER', scope_type: 'EVENT', scope_id: uid() }],
            },
          ],
          cash_sessions: [
            {
              cash_session_id: uid(),
              device_id: d,
              status: 'OPEN',
              opened_by: user,
              opened_at: '2026-11-09T09:00:00Z',
            },
          ],
        },
      ),
    );
    await r.svc.pullOnce();
    r.feed.queue.push(
      r.page(
        {
          device_seq_acked: [
            {
              device_id: d,
              contiguous_acked_seq: 3,
              max_seen_seq: 3,
              missing_seqs: [],
              next_seq_floor: 4,
              as_of: '2026-11-09T09:00:00Z',
            },
          ],
        },
        { from_change_seq: 1, to_change_seq: 1 },
      ),
    );
    await r.svc.pullOnce();
    expect(
      (
        await q<{ central_acked_seq: string; acked_known: boolean }>(
          r,
          'SELECT * FROM edge_device_seq',
        )
      )[0],
    ).toMatchObject({ central_acked_seq: '7', acked_known: true });
    expect(
      (
        await q<{ opened_by_iss: string; usable_on_edge: boolean }>(
          r,
          'SELECT * FROM edge_cash_session',
        )
      )[0],
    ).toMatchObject({ opened_by_iss: 'iss', usable_on_edge: false }); // activated_at NULL (M3)
  });

  it('session ouverte après la bascule : jamais utilisable hors central (R-24)', async () => {
    r = await makeRep();
    await r.db.pool.query('ALTER TABLE edge_authority DISABLE TRIGGER edge_authority_guard');
    await r.db.pool.query(`UPDATE edge_authority SET activated_at = '2026-11-09T10:00:00Z'`);
    const d = uid();
    r.feed.queue.push(
      r.page(
        {},
        {
          to_change_seq: 1,
          cash_sessions: [
            {
              cash_session_id: uid(),
              device_id: d,
              status: 'OPEN',
              opened_by: uid(),
              opened_at: '2026-11-09T11:00:00Z',
            },
          ],
        },
      ),
    );
    await r.svc.pullOnce();
    expect(
      (await q<{ usable_on_edge: boolean }>(r, 'SELECT usable_on_edge FROM edge_cash_session'))[0]
        ?.usable_on_edge,
    ).toBe(false);
  });

  it('M2 : perte du rôle PRIMARY -> clé scellée, colis et empreintes de jetons effacés', async () => {
    r = await makeRep({ role: 'PRIMARY' });
    r.feed.queue.push(
      r.page(
        { pwd_pack_key: sealed },
        { to_change_seq: 1, devices: [device(uid())], unassigned_media: [unassigned(1)] },
      ),
    );
    await r.svc.pullOnce();
    expect(await q(r, 'SELECT 1 FROM edge_pwd_pack_key')).toHaveLength(1);
    r.feed.queue.push(
      r.page(
        { pwd_pack_key: sealed },
        {
          from_change_seq: 1,
          to_change_seq: 2,
          gateway: { gateway_id: r.ids.gateway, role: 'STANDBY' },
        },
      ),
    );
    await r.svc.pullOnce();
    expect(r.roles.calls).toEqual(['STANDBY']);
    expect(await q(r, 'SELECT 1 FROM edge_pwd_pack_key')).toHaveLength(0);
    expect(await q(r, 'SELECT 1 FROM edge_device_token_family')).toHaveLength(0);
    expect(
      await q(
        r,
        'SELECT 1 FROM edge_media WHERE pwd_pack_enc IS NOT NULL OR pwd_pack_sha256 IS NOT NULL',
      ),
    ).toHaveLength(0);
    expect(await q(r, 'SELECT 1 FROM edge_media')).toHaveLength(1);
  });

  describe('R-24 : usable_on_edge', () => {
    const session = (d: string, user: string, openedAt: string) => ({
      cash_session_id: uid(),
      device_id: d,
      status: 'OPEN',
      opened_by: user,
      opened_at: openedAt,
    });
    const usable = async () =>
      (
        await q<{ usable_on_edge: boolean }>(
          r!,
          'SELECT usable_on_edge FROM edge_cash_session ORDER BY opened_at',
        )
      ).map((x) => x.usable_on_edge);

    it('M3 : faux tant que activated_at est NULL, réévalué quand il est posé', async () => {
      r = await makeRep();
      const d = uid();
      r.feed.queue.push(
        r.page(
          {},
          {
            to_change_seq: 1,
            devices: [device(d)],
            cash_sessions: [
              session(d, uid(), '2026-11-09T09:00:00Z'),
              session(d, uid(), '2026-11-09T11:00:00Z'),
            ],
          },
        ),
      );
      await r.svc.pullOnce();
      expect(await usable()).toEqual([false, false]);
      await r.db.pool.query('ALTER TABLE edge_authority DISABLE TRIGGER edge_authority_guard');
      await r.db.pool.query(`UPDATE edge_authority SET activated_at = '2026-11-09T10:00:00Z'`);
      expect(await usable()).toEqual([true, false]); // seule la session ouverte avant la bascule
    });
  });

  describe('R-24, second cycle (A05)', () => {
    it('une session ouverte entre deux bascules devient utilisable à la seconde activation', async () => {
      r = await makeRep();
      const d = uid();
      const row = (openedAt: string) => ({
        cash_session_id: uid(),
        device_id: d,
        status: 'OPEN',
        opened_by: uid(),
        opened_at: openedAt,
      });
      await r.db.pool.query('ALTER TABLE edge_authority DISABLE TRIGGER edge_authority_guard');
      await r.db.pool.query(`UPDATE edge_authority SET activated_at = '2026-11-09T10:00:00Z'`);
      r.feed.queue.push(
        r.page(
          {},
          {
            to_change_seq: 1,
            devices: [device(d)],
            cash_sessions: [row('2026-11-09T12:00:00Z'), row('2026-11-09T16:00:00Z')],
          },
        ),
      );
      await r.svc.pullOnce();
      const usable = async () =>
        (
          await q<{ usable_on_edge: boolean }>(
            r!,
            'SELECT usable_on_edge FROM edge_cash_session ORDER BY opened_at',
          )
        ).map((x) => x.usable_on_edge);
      // Cycle 1 (activé à 10 h) : aucune des deux n'était ouverte avant la bascule.
      expect(await usable()).toEqual([false, false]);
      // Cycle 2 : activation à 14 h, la valeur passe d'une date à une autre.
      await r.db.pool.query(`UPDATE edge_authority SET activated_at = '2026-11-09T14:00:00Z'`);
      expect(await usable()).toEqual([true, false]);
    });
  });

  it('M4 : une ligne de bracelet non liée ne peut pas porter de portefeuille', async () => {
    r = await makeRep();
    await expect(
      r.db.pool.query(
        `INSERT INTO edge_media (token_hash, media_id, wallet_id, status)
         VALUES ($1, NULL, $2, 'ACTIVE')`,
        [Buffer.alloc(32, 7), uid()],
      ),
    ).rejects.toThrow(/edge_media_wallet_needs_media/);
    await r.db.pool.query(
      `INSERT INTO edge_media (token_hash, media_id, wallet_id, status)
       VALUES ($1, NULL, NULL, 'ACTIVE')`,
      [Buffer.alloc(32, 8)],
    );
  });
});
