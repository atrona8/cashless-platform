// Snapshots locaux signés par la clé propre de la passerelle (WP23, T105/T107).
import { createPublicKey, verify } from 'node:crypto';
import canonicalize from 'canonicalize';
import {
  fromWrappedKey,
  openForRecipient,
  openPwdPack,
  snapshotKeyAad,
  snapshotPwdAad,
} from '@cashless/tag-format';
import { contentSha256Hex, type SnapshotEntry } from '../../src/snapshots/snapshot-builder';
import {
  makeBench,
  readySnapshot,
  type Bench,
  type OfflineDevice,
  type SeedMediaResult,
} from './_support/bench';

let b: Bench;
let dev: OfflineDevice;
let media: SeedMediaResult;

beforeEach(async () => {
  b = await makeBench();
  dev = await b.newDevice();
  media = await b.seedMedia({ balancePaid: 10000, pwdPack: Buffer.from('PWD1PK') });
});
afterEach(async () => {
  await b.close();
});

const get = (query?: string, headers?: Record<string, string>) =>
  b.request(dev, { path: '/v1/offline-snapshots/current', query, headers });
const config = async () =>
  (await b.request(dev, { path: '/v1/device/config' })).json as Record<string, any>;

describe('signature par la clé propre', () => {
  it('la signature se vérifie avec la clé publique du port et le key_id est celui de la passerelle', async () => {
    await readySnapshot(b);
    const body = (await get()).json as Record<string, any>;
    const spki = await b.keystore.publicKey('snapshot');
    const ok = verify(
      'sha256',
      Buffer.from(canonicalize(body.header)!, 'utf8'),
      { key: createPublicKey({ key: spki, format: 'der', type: 'spki' }), dsaEncoding: 'der' },
      Buffer.from(body.signature, 'base64'),
    );
    expect(ok).toBe(true);
    expect(body.header.key_id).toBe(`edge:${b.gatewayId}:snap:1`);
    expect(body.header.format).toBe('CASHLESS-SNAPSHOT/v1');
    const altered = { ...body.header, version: 99 };
    expect(
      verify(
        'sha256',
        Buffer.from(canonicalize(altered)!, 'utf8'),
        { key: createPublicKey({ key: spki, format: 'der', type: 'spki' }), dsaEncoding: 'der' },
        Buffer.from(body.signature, 'base64'),
      ),
    ).toBe(false);
  });

  it('clés publiées dans la configuration (owner EDGE), offline_enabled vrai', async () => {
    await readySnapshot(b);
    const cfg = await config();
    expect(cfg.offline_policy.offline_enabled).toBe(true);
    expect(cfg.snapshot_keys).toHaveLength(1);
    expect(cfg.snapshot_keys[0]).toMatchObject({
      key_id: `edge:${b.gatewayId}:snap:1`,
      algorithm: 'ECDSA_P256_SHA256',
    });
    expect(cfg.snapshot_keys[0].public_key).toBe(
      (await b.keystore.publicKey('snapshot')).toString('base64'),
    );
  });

  it('rotation : deux clés valides au plus, jamais trois', async () => {
    await readySnapshot(b);
    for (let i = 0; i < 3; i += 1) {
      b.keystore.rotate();
      await b.setPackKey();
      await b.q('UPDATE edge_wallet SET central_paid = central_paid + 1');
      b.clock.advance(61_000);
      expect(await b.worker.tick()).not.toBeNull();
    }
    expect(Number((await b.q('SELECT count(*) AS n FROM edge_snapshot_signing_key'))[0]!.n)).toBe(
      4,
    );
    expect(
      Number(
        (
          await b.q("SELECT count(*) AS n FROM edge_snapshot_signing_key WHERE status = 'ACTIVE'")
        )[0]!.n,
      ),
    ).toBe(1);
    const keys = (await config()).snapshot_keys as Array<Record<string, any>>;
    expect(keys).toHaveLength(2);
    expect(keys[0]!.not_after).toBeNull();
    expect(keys[1]!.not_after).not.toBeNull();
    expect(keys[0]!.key_id).toBe(`edge:${b.gatewayId}:snap:4`);
  });

  it('clé détruite : rien n’est signé, 403 OFFLINE_NOT_ALLOWED au terminal', async () => {
    const v = await readySnapshot(b);
    await b.keystore.destroy('snapshot');
    await b.q('UPDATE edge_wallet SET central_paid = central_paid + 1');
    b.clock.advance(61_000);
    expect(await b.worker.tick()).toBeNull();
    expect((await get()).status).toBe(403);
    expect(Number((await b.q('SELECT max(version) AS v FROM edge_snapshot'))[0]!.v)).toBe(v);
  });
});

describe('contenu au format de la mission 7', () => {
  it('empreinte de contenu recalculée, mots de passe jamais en clair, K_v enveloppée pour le terminal', async () => {
    const v = await readySnapshot(b);
    const res = await get();
    const body = res.json as Record<string, any>;
    const entries = body.entries as Array<Record<string, any>>;
    expect(entries).toHaveLength(1);
    const stripped = entries.map(
      ({ pwd_pack_enc: _p, ...rest }) => rest,
    ) as unknown as SnapshotEntry[];
    expect(contentSha256Hex(stripped, body.removed_token_hashes)).toBe(body.header.content_sha256);
    expect(res.text).not.toContain('PWD1PK');
    expect(res.text).not.toContain(Buffer.from('PWD1PK').toString('base64'));
    const kv = openForRecipient({
      recipientPrivateKey: dev.agreement.privateScalar,
      blob: fromWrappedKey(body.pwd_pack_key),
      aad: snapshotKeyAad(b.ids.ledger, BigInt(v), dev.deviceId),
    });
    const e = entries[0]!;
    expect(e).toMatchObject({ token_hash: media.tokenHex, spendable: 10000, status: 'ACTIVE' });
    const blob = Buffer.concat([
      Buffer.from(e.pwd_pack_enc.nonce, 'base64'),
      Buffer.from(e.pwd_pack_enc.ciphertext, 'base64'),
      Buffer.from(e.pwd_pack_enc.tag, 'base64'),
    ]);
    const clear = openPwdPack({
      dek: kv,
      blob,
      aad: snapshotPwdAad(b.ids.ledger, BigInt(v), media.tokenHash, media.uid),
    });
    expect(clear.toString()).toBe('PWD1PK');
  });

  it('FULL puis DELTA de la version précédente (changement non bloquant après 60 s)', async () => {
    for (let i = 0; i < 9; i += 1)
      await b.seedMedia({ balancePaid: 10000, pwdPack: Buffer.from('PWD1PK') });
    const v1 = await readySnapshot(b);
    expect(await b.worker.tick()).toBeNull();
    await b.q('UPDATE edge_wallet SET central_paid = 9000 WHERE wallet_id = $1', [media.walletId]);
    expect(await b.worker.tick()).toBeNull();
    b.clock.advance(61_000);
    const out = await b.worker.tick();
    expect(out).toMatchObject({ kind: 'DELTA', version: v1 + 1 });
    const delta = (await get(`since_version=${v1}`)).json as Record<string, any>;
    expect(delta.header).toMatchObject({ kind: 'DELTA', base_version: v1 });
    expect(delta.entries).toHaveLength(1);
    expect(delta.entries[0].spendable).toBe(9000);
  });

  it('5 s après un blocage : publié sans attendre les 60 s du régime courant', async () => {
    for (let i = 0; i < 9; i += 1)
      await b.seedMedia({ balancePaid: 10000, pwdPack: Buffer.from('PWD1PK') });
    const v1 = await readySnapshot(b);
    b.clock.advance(5_000);
    await b.q("UPDATE edge_media SET status = 'SUSPENDED' WHERE token_hash = $1", [
      media.tokenHash,
    ]);
    const out = await b.worker.tick();
    expect(out).toMatchObject({ kind: 'DELTA', version: v1 + 1 });
    const delta = (await get(`since_version=${v1}`)).json as Record<string, any>;
    expect(delta.entries[0].status).toBe('SUSPENDED');
  });
});

describe('service au terminal', () => {
  it('304 sur ETag identique', async () => {
    await readySnapshot(b);
    const first = await get();
    const again = await get(undefined, { 'if-none-match': String(first.headers.etag) });
    expect(again.status).toBe(304);
  });

  it('409 CONFLICT_STATE + Retry-After tant qu’aucun snapshot n’est enveloppé pour ce terminal', async () => {
    await readySnapshot(b);
    const late = await b.newDevice();
    const res = await b.request(late, { path: '/v1/offline-snapshots/current' });
    expect(res.status).toBe(409);
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('403 OFFLINE_NOT_ALLOWED hors ligne interdit ; 403 DEVICE_SUSPENDED terminal suspendu', async () => {
    await readySnapshot(b);
    const off = await b.newDevice({ policy: { offline_enabled: false } });
    const r1 = await b.request(off, { path: '/v1/offline-snapshots/current' });
    expect(r1.status).toBe(403);
    expect((r1.json as any).code).toBe('OFFLINE_NOT_ALLOWED');
    await b.q("UPDATE edge_device SET status = 'SUSPENDED' WHERE device_id = $1", [dev.deviceId]);
    const r2 = await get();
    expect(r2.status).toBe(403);
    expect((r2.json as any).code).toBe('DEVICE_SUSPENDED');
  });

  it('accusé : 204 idempotent ; version inconnue ou empreinte fausse : 409 SNAPSHOT_VERSION_UNKNOWN', async () => {
    const v = await readySnapshot(b);
    const body = (await get()).json as Record<string, any>;
    const ack = (version: number, sha: string) =>
      b.request(dev, {
        method: 'POST',
        path: '/v1/offline-snapshots/ack',
        body: { version, content_sha256: sha },
        idempotencyKey: undefined,
      });
    expect((await ack(v, body.header.content_sha256)).status).toBe(204);
    expect((await ack(v, body.header.content_sha256)).status).toBe(204);
    expect(Number((await b.q('SELECT count(*) AS n FROM edge_snapshot_ack'))[0]!.n)).toBe(1);
    const unknown = await ack(v + 50, body.header.content_sha256);
    expect(unknown.status).toBe(409);
    expect((unknown.json as any).code).toBe('SNAPSHOT_VERSION_UNKNOWN');
    expect((await ack(v, 'ab'.repeat(32))).status).toBe(409);
  });
});
