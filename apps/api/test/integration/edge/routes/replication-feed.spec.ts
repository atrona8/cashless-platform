// `getEdgeReplicationFeed` (WP12, T054 ; FR-021, NFR-010, A18, R-24) : forme du contrat, reprise sans trou ni doublon,
// horizon (une écriture d'id inférieur validée tard n'est jamais sautée), curseur de référence facultatif, bornes,
// canari (aucun secret de bracelet), passerelle de réserve sans colis, jetons d'appareil exposés (décision 23).
import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { contractViolations } from '../../../support/contract-schema';
import { connect, OWNER_URL } from '../../../support/db';
import {
  seedEdgeWorld,
  startEdge,
  type EdgeWorld,
  type RunningEdge,
} from '../../../support/edge-fixtures';
import { edgeSend, newGateway, promo, seedWallet, topup, type Gw } from './support';

jest.setTimeout(120_000);

type Page = {
  from_posting_id: number;
  to_posting_id: number;
  has_more: boolean;
  wallets: { wallet_id: string; paid: number; promo: number }[];
  reference?: { devices: { device_id: string; token_family: unknown }[] };
  pwd_pack_key?: unknown;
};

/**
 * Le contrôleur de contrat de test ne suit pas les `$ref` de propriété (`DeviceConfig/properties/...`) : le bloc
 * `reference` est vérifié par ses clés requises, le reste de la page par le schéma.
 */
function pageViolations(json: unknown): string[] {
  const { reference, ...rest } = json as Record<string, unknown>;
  const required = [
    'from_change_seq',
    'to_change_seq',
    'has_more',
    'gateway',
    'wallet_states',
    'devices',
  ];
  const missing = required.filter(
    (key) => (reference as Record<string, unknown> | undefined)?.[key] === undefined,
  );
  return [...contractViolations('ReplicationPage', rest), ...missing.map((k) => `reference.${k}`)];
}

describe('getEdgeReplicationFeed', () => {
  let owner: Client;
  let other: Client;
  let world: EdgeWorld;
  let edge: RunningEdge;

  beforeAll(async () => {
    owner = await connect(OWNER_URL);
    other = await connect(OWNER_URL);
    world = await seedEdgeWorld(owner);
    edge = await startEdge();
  });
  afterAll(async () => {
    await edge?.close();
    await other?.end();
    await owner?.end();
  });

  const feed = (gw: Gw, query: string) =>
    edgeSend(edge.port, 'GET', `/edge/replication-feed?${query}`, { client: gw.cert });
  const page = async (gw: Gw, query: string): Promise<Page> => {
    const reply = await feed(gw, query);
    if (reply.status !== 200) throw new Error(`flux : ${reply.status} ${reply.body}`);
    return reply.json as unknown as Page;
  };

  it('forme du schéma ReplicationPage, avec et sans after_change_seq (bloc reference)', async () => {
    const gw = await newGateway(owner, world);
    const wallet = await seedWallet(owner, world, gw);
    await topup(owner, world, gw, wallet, 1200);
    const bare = await feed(gw, 'after_posting_id=0');
    expect(bare.status).toBe(200);
    expect(contractViolations('ReplicationPage', bare.json)).toEqual([]);
    expect(bare.json).not.toHaveProperty('reference');
    const withRef = await feed(gw, 'after_posting_id=0&after_change_seq=0');
    expect(withRef.status).toBe(200);
    expect(pageViolations(withRef.json)).toEqual([]);
    expect(withRef.json).toHaveProperty('reference');
    const body = withRef.json as unknown as Page;
    expect(body.wallets.find((w) => w.wallet_id === wallet.walletId)?.paid).toBe(1200);
  });

  it('reprise sans trou ni doublon sur trois pages (limit 2)', async () => {
    const gw = await newGateway(owner, world);
    const wallets: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const wallet = await seedWallet(owner, world, gw);
      await topup(owner, world, gw, wallet, 100 + i);
      wallets.push(wallet.walletId);
    }
    const seen: string[] = [];
    let after = 0;
    let pages = 0;
    for (;;) {
      const current = await page(gw, `after_posting_id=${after}&limit=2`);
      expect(current.from_posting_id).toBe(after);
      seen.push(...current.wallets.map((w) => w.wallet_id));
      pages += 1;
      after = current.to_posting_id;
      if (!current.has_more) break;
      expect(pages).toBeLessThan(10);
    }
    expect(pages).toBe(3);
    expect([...seen].sort()).toEqual([...wallets].sort());
  });

  it('horizon : une écriture d’id inférieur validée tard n’est jamais sautée (A18)', async () => {
    const gw = await newGateway(owner, world);
    const w1 = await seedWallet(owner, world, gw);
    const w2 = await seedWallet(owner, world, gw);
    await topup(owner, world, gw, w1, 10);
    const first = await page(gw, 'after_posting_id=0&limit=200');
    // Session B : écriture d'id inférieur, validation retardée ; session A : écriture d'id supérieur validée.
    let cursor = 0;
    await other.query('BEGIN');
    try {
      await topup(other, world, gw, w2, 77);
      await promo(owner, world, gw, w1, 5);
      const during = await page(gw, `after_posting_id=${first.to_posting_id}&limit=200`);
      const flat = during.wallets.map((w) => w.wallet_id);
      // L'horizon n'a pas dépassé l'écriture en vol : ni elle ni la suivante ne sont livrées, rien n'est promis.
      expect(flat).not.toContain(w2.walletId);
      cursor = during.to_posting_id;
    } finally {
      await other.query('COMMIT');
    }
    const after = await page(gw, `after_posting_id=${cursor}&limit=200`);
    const got = new Map(after.wallets.map((w) => [w.wallet_id, w]));
    expect(got.get(w2.walletId)?.paid).toBe(77);
    expect(got.get(w1.walletId)).toMatchObject({ paid: 10, promo: 5 });
  });

  it('bornes : 422 VALIDATION_FAILED pour limit, after_posting_id, after_change_seq invalides', async () => {
    const gw = await newGateway(owner, world);
    for (const query of [
      'after_posting_id=0&limit=0',
      'after_posting_id=0&limit=201',
      'after_posting_id=0&limit=abc',
      'after_posting_id=-1',
      'after_posting_id=1.5',
      'after_posting_id=0&after_change_seq=-5',
      'limit=10',
    ]) {
      const reply = await feed(gw, query);
      expect([query, reply.status]).toEqual([query, 422]);
      expect(reply.json).toMatchObject({ code: 'VALIDATION_FAILED' });
    }
    expect((await feed(gw, 'after_posting_id=0&limit=200')).status).toBe(200);
    expect((await feed(gw, 'after_posting_id=0&limit=1')).status).toBe(200);
  });

  it('canari : aucun secret de bracelet dans la réponse (UTF-8, hexadécimal, base64)', async () => {
    const gw = await newGateway(owner, world);
    const secret = Buffer.from(`CANARI-${randomUUID().replace(/-/g, '').slice(0, 25)}`, 'utf8');
    const wallet = await seedWallet(owner, world, gw, { secret });
    await topup(owner, world, gw, wallet, 500);
    const reply = await feed(gw, 'after_posting_id=0&limit=200&after_change_seq=0');
    expect(reply.status).toBe(200);
    expect(reply.body).toContain(wallet.walletId);
    const forms = [
      secret.toString('utf8'),
      secret.toString('hex'),
      secret.toString('base64'),
      secret.toString('base64url'),
      'CANARI',
    ];
    for (const form of forms) expect(reply.body).not.toContain(form);
    expect(reply.body).not.toMatch(/master_key|pin_hash|argon2/i);
  });

  it('canari dans un colis réel (media.pwd_pack_enc, PRIMARY) : jamais servi sous aucune forme', async () => {
    const gw = await newGateway(owner, world);
    const pack = Buffer.from(`CANARIPACK-${randomUUID().replace(/-/g, '').slice(0, 23)}`, 'utf8');
    expect(pack.length).toBe(34);
    const wallet = await seedWallet(owner, world, gw, { pwdPackEnc: pack });
    await topup(owner, world, gw, wallet, 500);
    const stored = await owner.query(
      'SELECT count(*)::int AS n FROM media WHERE pwd_pack_enc = $1',
      [pack],
    );
    expect(stored.rows[0].n).toBe(1);
    const reply = await feed(gw, 'after_posting_id=0&limit=200&after_change_seq=0');
    expect(reply.status).toBe(200);
    expect(reply.body).toContain(wallet.walletId);
    for (const form of [
      pack.toString('utf8'),
      pack.toString('hex'),
      pack.toString('base64'),
      pack.toString('base64url'),
      pack.subarray(0, 12).toString('base64'),
      pack.subarray(12, 18).toString('base64'),
      'CANARIPACK',
    ])
      expect(reply.body).not.toContain(form);
  });

  it('edge_terms (décision 36) : sur la dernière page seulement, conditions de l’événement', async () => {
    const gw = await newGateway(owner, world);
    for (let i = 0; i < 3; i += 1)
      await topup(owner, world, gw, await seedWallet(owner, world, gw), 10 + i);
    const first = await feed(gw, 'after_posting_id=0&limit=2');
    expect((first.json as unknown as Page).has_more).toBe(true);
    expect(first.json).not.toHaveProperty('edge_terms');
    const last = await feed(
      gw,
      `after_posting_id=${(first.json as unknown as Page).to_posting_id}&limit=200`,
    );
    expect((last.json as unknown as Page).has_more).toBe(false);
    expect(contractViolations('ReplicationPage', last.json)).toEqual([]);
    const terms = (last.json as { edge_terms?: Record<string, unknown> }).edge_terms;
    expect(terms).toMatchObject({ max_cash_topup: 500000, activation_fee: 0 });
    expect(Array.isArray(terms?.deposit_batches)).toBe(true);
  });

  it('passerelle STANDBY : la page est servie sans colis ni clé de colis (A16)', async () => {
    const gw = await newGateway(owner, world, { role: 'STANDBY' });
    const reply = await feed(gw, 'after_posting_id=0&limit=10&after_change_seq=0');
    expect(reply.status).toBe(200);
    expect(reply.json).not.toHaveProperty('pwd_pack_key');
    expect(pageViolations(reply.json)).toEqual([]);
  });

  it('jetons d’appareil (décision 23) : token_family absent avant exposition, présent après', async () => {
    const gw = await newGateway(owner, world);
    await owner.query(`SELECT set_config('app.operator_id', $1, false)`, [world.operatorId]);
    const deviceId = randomUUID();
    await owner.query(
      `INSERT INTO device (id, operator_id, kind, app_mode, event_id, serial, public_key, cert_sha256)
       VALUES ($1, $2, 'POS', 'CATALOG_POS', $3, $4, $5, $6)`,
      [
        deviceId,
        world.operatorId,
        gw.eventId,
        `T-${deviceId.slice(0, 8)}`,
        Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]),
        createHash('sha256').update(deviceId).digest(),
      ],
    );
    const familyId = randomUUID();
    const tokenHash = createHash('sha256').update(`jeton-${deviceId}`).digest();
    await owner.query(
      `INSERT INTO device_refresh_token (id, operator_id, device_id, family_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + interval '1 day')`,
      [randomUUID(), world.operatorId, deviceId, familyId, tokenHash],
    );
    const find = (p: Page) => p.reference?.devices.find((d) => d.device_id === deviceId);
    const before = await page(gw, 'after_posting_id=0&after_change_seq=0&limit=200');
    expect(find(before)).toBeDefined();
    expect(find(before)!.token_family).toBeNull();
    await owner.query('SELECT edge_expose_device_token_families($1)', [gw.eventId]);
    const after = await page(gw, 'after_posting_id=0&after_change_seq=0&limit=200');
    expect(find(after)!.token_family).toMatchObject({
      fid: familyId,
      status: 'ACTIVE',
      refresh_token_sha256_current: tokenHash.toString('hex'),
    });
    // Le jeton lui-même n'est jamais servi : seulement son empreinte.
    expect(JSON.stringify(after)).not.toContain('"refresh_token":');
  });
});
