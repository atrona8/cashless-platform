/* eslint-disable @typescript-eslint/no-explicit-any -- corps JSON du contrat lus champ par champ */
// Snapshots servis au terminal (lot WP15 ; T060, T061, T063 ; FR-005, FR-011 ; R-30.5, R-30.9 ;
// contracts/snapshots.md). Versions publiées par les fonctions SQL de la mission (propriétaire), jamais
// par insertion directe. Terminaux enrôlés en propriétaire (`TestTerminal.enroll`).
import 'reflect-metadata';
import { request as httpsRequest } from 'node:https';
import { gunzipSync } from 'node:zlib';
import type { Client } from 'pg';
import { FakeDeviceCa } from '../../../src/device-ca/fake-device-ca';
import type { DeviceCaPort } from '../../../src/device-ca/device-ca.port';
import { DeviceTokenService } from '../../../src/device-tokens/device-token.service';
import { startHttpsApp, type HttpsTestApp } from '../../support/app';
import { contractViolations } from '../../support/contract-schema';
import { withOwner } from '../../support/db';
import { createMediaWorld, ownerRows, type MediaWorld } from '../../support/media-fixtures';
import {
  TestTerminal,
  type EnrollmentInput,
  type TerminalResponse,
} from '../../support/test-terminal';
import {
  platformKeyExists,
  publishVersion,
  rotateOwnKey,
  seedEntry,
  wrapFor,
} from './snapshots-seed';

jest.setTimeout(120_000);

const E1 = seedEntry(1, true);
const E2 = seedEntry(2, true);
const E3 = seedEntry(3, false);

describe('snapshots hors ligne servis (T060, T061, T063)', () => {
  let w: MediaWorld;
  let api: HttpsTestApp;
  let ca: DeviceCaPort;
  let tokens: DeviceTokenService;
  let ledger: string;

  const enrolled = async (input: Partial<Omit<EnrollmentInput, 'ca'>> = {}) => {
    const t = await withOwner((db) =>
      new TestTerminal('ANDROID').enroll(db, {
        operatorId: w.ops.a,
        eventId: w.ids.eventA,
        ...input,
        ca,
      }),
    );
    await t.issueToken(tokens);
    return t;
  };
  const get = (t: TestTerminal, query = '', headers: Record<string, string> = {}) =>
    t.request(
      api.baseUrl,
      api.tls.serverCaPem,
      { method: 'GET', path: `/offline-snapshots/current${query}` },
      { headers },
    );
  const rawGet = (t: TestTerminal, headers: Record<string, string>) =>
    new Promise<{ status: number; headers: Record<string, unknown>; raw: Buffer }>(
      (resolve, reject) => {
        const p = t.prepare(
          api.baseUrl,
          { method: 'GET', path: '/offline-snapshots/current' },
          { headers },
        );
        const req = httpsRequest(
          {
            host: p.url.hostname,
            port: p.url.port,
            path: p.url.pathname + p.url.search,
            method: 'GET',
            headers: { ...p.headers, 'content-length': 0 },
            ca: api.tls.serverCaPem,
            servername: p.url.hostname,
            agent: false,
            cert: p.cert ?? undefined,
            key: p.key ?? undefined,
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () =>
              resolve({
                status: res.statusCode ?? 0,
                headers: res.headers,
                raw: Buffer.concat(chunks),
              }),
            );
          },
        );
        req.on('error', reject);
        req.end();
      },
    );
  const ack = (t: TestTerminal, body: unknown) =>
    t.request(api.baseUrl, api.tls.serverCaPem, {
      method: 'POST',
      path: '/offline-snapshots/ack',
      body,
    });
  const publish = (
    db: Client,
    kind: 'FULL' | 'DELTA',
    entries = [E1, E2, E3],
    removed: string[] = [],
  ) => publishVersion(db, { operatorId: w.ops.a, ledgerId: ledger, kind, entries, removed });
  const wrap = (db: Client, version: string, t: TestTerminal, tag: string) =>
    wrapFor(db, w.ops.a, ledger, version, t.deviceId, tag);

  beforeAll(async () => {
    noPlatformKey = !(await withOwner(platformKeyExists));
    w = await createMediaWorld();
    ledger = w.ids.ledgerA;
    api = await startHttpsApp(undefined, { identity: w.idp });
    ca = await FakeDeviceCa.fromFiles({
      certFile: api.tls.deviceCaCertFile,
      keyFile: api.tls.deviceCaFakeKeyFile,
    });
    tokens = api.app.get(DeviceTokenService, { strict: false });
    await withOwner((db) =>
      db.query(
        `INSERT INTO offline_policy (operator_id, scope_type, scope_id, offline_enabled,
           max_per_sale, max_per_media_per_device, max_total_per_device)
         VALUES ($1, 'EVENT', $2, true, 5000, 20000, 300000)`,
        [w.ops.a, w.ids.eventA],
      ),
    );
  });
  afterAll(async () => {
    await api?.close();
  });

  let noPlatformKey = true;
  let ta: TestTerminal;
  let tb: TestTerminal;

  it('sans clé de signature ACTIVE : 403 OFFLINE_NOT_ALLOWED, détail SNAPSHOTS_UNAVAILABLE', async () => {
    ta = await enrolled();
    tb = await enrolled();
    // Même clé d'accord que A : seul l'identifiant du terminal distingue alors leurs ETag.
    await withOwner((db) =>
      db.query(
        'UPDATE device SET agreement_public_key = (SELECT agreement_public_key FROM device WHERE id = $1) WHERE id = $2',
        [ta.deviceId, tb.deviceId],
      ),
    );
    if (!noPlatformKey) return; // une clé de la plateforme existe : état « sans clé » inobservable
    const res = await get(ta);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('OFFLINE_NOT_ALLOWED');
    expect(res.body.detail).toBe('SNAPSHOTS_UNAVAILABLE');
  });

  it('aucune version produite : 409 CONFLICT_STATE avec Retry-After: 2', async () => {
    await withOwner((db) => rotateOwnKey(db, w.ops.a, 'a'));
    const res = await get(ta);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CONFLICT_STATE');
    expect(res.headers['retry-after']).toBe('2');
  });

  it('version publiée mais enveloppe pas prête : 409 + Retry-After ; puis FULL conforme', async () => {
    const v1 = await withOwner((db) => publish(db, 'FULL'));
    expect(v1.version).toBe('1');
    const early = await get(ta);
    expect(early.status).toBe(409);
    expect(early.headers['retry-after']).toBe('2');
    await withOwner(async (db) => {
      await wrap(db, '1', ta, 'ta1');
      await wrap(db, '1', tb, 'tb1');
    });
    const res = await get(ta);
    expect(res.status).toBe(200);
    expect(contractViolations('OfflineSnapshot', res.body)).toEqual([]);
    const body = res.body as any;
    expect(body.header).toMatchObject({ kind: 'FULL', version: 1, base_version: null });
    expect(body.header.content_sha256).toBe(v1.contentSha256);
    expect(body.removed_token_hashes).toEqual([]);
    expect(body.entries).toHaveLength(3);
    const withPwd = body.entries.filter((e: any) => e.pwd_pack_enc !== null);
    expect(withPwd).toHaveLength(2);
    for (const e of withPwd) {
      // Blob de 34 octets découpé : nonce 12, chiffré 6, tag 16.
      expect(Buffer.from(e.pwd_pack_enc.nonce, 'base64')).toHaveLength(12);
      expect(Buffer.from(e.pwd_pack_enc.ciphertext, 'base64')).toHaveLength(6);
      expect(Buffer.from(e.pwd_pack_enc.tag, 'base64')).toHaveLength(16);
    }
    expect(body.entries.find((e: any) => e.pwd_pack_sha256 === null).pwd_pack_enc).toBeNull();
    expect(body.pwd_pack_key).toEqual({
      alg: 'ECDH-ES+HKDF-SHA256+A256GCM',
      epk: 'epk-ta1',
      iv: 'iv-ta1',
      wrapped_key: 'wk-ta1',
    });
    expect(res.headers['x-snapshot-latest']).toBe('1');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(String(res.headers.etag)).toMatch(
      new RegExp(`^"${ledger}:1:${ta.deviceId}:[0-9a-f]{64}"$`),
    );
    // Le terminal B reçoit SA propre enveloppe, jamais celle de A.
    const other = (await get(tb)).body as any;
    expect(other.pwd_pack_key.epk).toBe('epk-tb1');
    expect((await get(tb)).headers.etag).not.toBe(res.headers.etag);
  });

  it('304 sur If-None-Match ; l’ETag d’un autre terminal ne donne pas 304', async () => {
    const first = await get(ta);
    const etag = String(first.headers.etag);
    const again = await get(ta, '', { 'if-none-match': etag });
    expect(again.status).toBe(304);
    expect(again.headers.etag).toBe(etag);
    expect(again.text).toBe('');
    const crossed = await get(tb, '', { 'if-none-match': etag });
    expect(crossed.status).toBe(200);
    expect(String(crossed.headers.etag)).not.toBe(etag);
    expect(String(crossed.headers.etag)).toContain(tb.deviceId);
    expect(JSON.stringify(crossed.body)).not.toContain('epk-ta1');
  });

  it('gzip : corps décompressé identique à celui sans compression', async () => {
    const plain = await rawGet(ta, {});
    const packed = await rawGet(ta, { 'accept-encoding': 'gzip' });
    expect(packed.headers['content-encoding']).toBe('gzip');
    expect(packed.headers.vary).toMatch(/Accept-Encoding/i);
    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(gunzipSync(packed.raw).toString('utf8')).toBe(plain.raw.toString('utf8'));
  });

  it('chaîne de versions : DELTA suivant, dernière, rattrapage après plus de 5 pas, FULL récent', async () => {
    const versionOf = async (since: string) =>
      ((await get(ta, since === '' ? '' : `?since_version=${since}`)).body as any).header.version;
    await withOwner(async (db) => {
      const v2 = await publish(db, 'DELTA', [E1]);
      await wrap(db, v2.version, ta, 'ta2');
    });
    expect(await versionOf('1')).toBe(2);
    const delta = (await get(ta, '?since_version=1')).body as any;
    expect(delta.header).toMatchObject({ kind: 'DELTA', base_version: 1 });
    expect(await versionOf('2')).toBe(2); // = dernière
    expect(await versionOf('')).toBe(1); // sans base : dernier FULL
    expect(await versionOf('0')).toBe(1);
    expect(await versionOf('999')).toBe(1); // inconnue (supérieure à la dernière)
    expect((await get(ta, '?since_version=999')).headers['x-snapshot-latest']).toBe('2');
    // Plus de 5 pas entre 1 et la dernière (7) : dernier FULL.
    await withOwner(async (db) => {
      for (let i = 3; i <= 7; i += 1) {
        const v = await publish(db, 'DELTA', [E2]);
        await wrap(db, v.version, ta, `ta${i}`);
      }
    });
    expect(await versionOf('1')).toBe(1);
    expect(await versionOf('2')).toBe(3); // 5 pas : encore un DELTA
    // FULL plus récent que la base : le FULL.
    await withOwner(async (db) => {
      const v8 = await publish(db, 'FULL');
      await wrap(db, v8.version, ta, 'ta8');
    });
    expect(await versionOf('5')).toBe(8);
    expect((await get(ta, '?since_version=5')).headers['x-snapshot-latest']).toBe('8');
  });

  it('since_version invalide : 400 VALIDATION_FAILED ; entier 64 bits exact accepté sans perte', async () => {
    for (const bad of ['abc', '-1', '1.5', '1e3', '', '9223372036854775808'])
      expect((await get(ta, `?since_version=${bad}`)).status).toBe(400);
    expect((await get(ta, '?since_version=1&since_version=2')).status).toBe(400);
    const big = await get(ta, '?since_version=9007199254740993');
    expect(big.status).toBe(200);
    expect((big.body as any).header.version).toBe(8); // traité comme « dernière »
  });

  it('clé d’accord changée : 409 puis nouvelle enveloppe', async () => {
    const t = await enrolled();
    await withOwner((db) => wrap(db, '8', t, 'old'));
    expect((await get(t)).status).toBe(200);
    const fresh = new TestTerminal('ANDROID');
    await withOwner((db) =>
      db.query('UPDATE device SET agreement_public_key = $2 WHERE id = $1', [
        t.deviceId,
        fresh.agreement.point,
      ]),
    );
    const res = await get(t);
    expect(res.status).toBe(409);
    expect(res.headers['retry-after']).toBe('2');
    await withOwner((db) => wrap(db, '8', t, 'new'));
    const ok = (await get(t)).body as any;
    expect(ok.pwd_pack_key.epk).toBe('epk-new');
  });

  it('suspendu : 403 DEVICE_SUSPENDED même avec un If-None-Match valide ; révoqué : DEVICE_REVOKED', async () => {
    const etag = String((await get(ta)).headers.etag);
    const s = await enrolled();
    await withOwner((db) => wrap(db, '8', s, 'sus'));
    const served = String((await get(s)).headers.etag);
    await withOwner((db) => s.setStatus(db, 'SUSPENDED'));
    const sus = await get(s, '', { 'if-none-match': served });
    expect(sus.status).toBe(403);
    expect(sus.body.code).toBe('DEVICE_SUSPENDED');
    await withOwner((db) => s.setStatus(db, 'REVOKED'));
    const rev = await get(s, '', { 'if-none-match': etag });
    expect(rev.status).toBe(403);
    expect(rev.body.code).toBe('DEVICE_REVOKED');
  });

  it('téléphone personnel, hors ligne interdit, sans événement : 403 OFFLINE_NOT_ALLOWED', async () => {
    const phone = await enrolled({ mode: 'KEYPAD_TPE', personalPhone: true });
    const p = await get(phone);
    expect(p.status).toBe(403);
    expect([p.body.code, p.body.detail]).toEqual(['OFFLINE_NOT_ALLOWED', 'PERSONAL_PHONE']);
    const off = await enrolled();
    await withOwner((db) =>
      db.query(
        `INSERT INTO offline_policy (operator_id, scope_type, scope_id, offline_enabled,
           max_per_sale, max_per_media_per_device, max_total_per_device)
         VALUES ($1, 'DEVICE', $2, false, 5000, 20000, 300000)`,
        [w.ops.a, off.deviceId],
      ),
    );
    const o = await get(off);
    expect([o.status, o.body.code, o.body.detail]).toEqual([
      403,
      'OFFLINE_NOT_ALLOWED',
      'OFFLINE_DISABLED',
    ]);
  });

  describe('accusé', () => {
    let t: TestTerminal;
    let sha8: string;
    beforeAll(async () => {
      t = await enrolled();
      await withOwner(async (db) => {
        await wrap(db, '8', t, 'ack8');
        const v9 = await publish(db, 'DELTA', [E1]);
        await wrap(db, v9.version, t, 'ack9');
      });
      sha8 = String(
        (
          await ownerRows<{ h: string }>(
            "SELECT encode(content_sha256, 'hex') AS h FROM offline_snapshot WHERE ledger_id = $1 AND version = 8",
            [ledger],
          )
        )[0]!.h,
      );
    });
    const lastVersion = async () =>
      (
        await ownerRows<{ v: string | null }>(
          'SELECT last_snapshot_version::text AS v FROM device WHERE id = $1',
          [t.deviceId],
        )
      )[0]!.v;
    const shaOf = async (v: number) =>
      (
        await ownerRows<{ h: string }>(
          "SELECT encode(content_sha256, 'hex') AS h FROM offline_snapshot WHERE ledger_id = $1 AND version = $2",
          [ledger, v],
        )
      )[0]!.h;

    it('juste : 204, idempotent ; last_snapshot_version ne recule jamais ; une ligne par version', async () => {
      expect((await ack(t, { version: 9, content_sha256: await shaOf(9) })).status).toBe(204);
      expect(await lastVersion()).toBe('9');
      expect((await ack(t, { version: 9, content_sha256: await shaOf(9) })).status).toBe(204);
      expect((await ack(t, { version: 8, content_sha256: sha8 })).status).toBe(204);
      expect(await lastVersion()).toBe('9');
      const rows = await ownerRows<{ version: string }>(
        'SELECT version::text FROM offline_snapshot_ack WHERE device_id = $1 ORDER BY version',
        [t.deviceId],
      );
      expect(rows.map((r) => r.version)).toEqual(['8', '9']);
    });

    it('fausse empreinte, version non enveloppée pour ce terminal ou inconnue : 409, rien d’écrit', async () => {
      const before = await lastVersion();
      const wrong = await ack(t, { version: 8, content_sha256: 'ab'.repeat(32) });
      expect([wrong.status, wrong.body.code]).toEqual([409, 'SNAPSHOT_VERSION_UNKNOWN']);
      // Version 3 : publiée mais jamais enveloppée pour ce terminal.
      const unwrapped = await ack(t, { version: 3, content_sha256: await shaOf(3) });
      expect([unwrapped.status, unwrapped.body.code]).toEqual([409, 'SNAPSHOT_VERSION_UNKNOWN']);
      const unknown = await ack(t, { version: 500, content_sha256: sha8 });
      expect(unknown.status).toBe(409);
      expect(await lastVersion()).toBe(before);
    });

    it('validation : champ inconnu 422 ; version ou empreinte mal formée 400', async () => {
      expect((await ack(t, { version: 8, content_sha256: sha8, extra: 1 })).status).toBe(422);
      for (const body of [
        { version: 0, content_sha256: sha8 },
        { version: '8', content_sha256: sha8 },
        { version: Number.MAX_SAFE_INTEGER + 2, content_sha256: sha8 },
        { version: 8, content_sha256: 'zz' },
        { version: 8 },
        [],
      ])
        expect((await ack(t, body)).status).toBe(400);
    });

    it('terminal suspendu : l’accusé est refusé (DEVICE_SUSPENDED)', async () => {
      const s = await enrolled();
      await withOwner((db) => wrap(db, '8', s, 'sus8'));
      await withOwner((db) => s.setStatus(db, 'SUSPENDED'));
      const res = await ack(s, { version: 8, content_sha256: sha8 });
      expect([res.status, res.body.code]).toEqual([403, 'DEVICE_SUSPENDED']);
    });
  });

  it('aucun mot de passe chiffré en clair dans les journaux de l’application', async () => {
    const spy = jest.spyOn(process.stderr, 'write');
    await get(ta);
    await get(ta, '?since_version=zzz');
    const logged = spy.mock.calls.map((c) => String(c[0])).join('');
    spy.mockRestore();
    expect(logged).not.toContain('pwd_pack_enc');
  });
});

export type { TerminalResponse };
