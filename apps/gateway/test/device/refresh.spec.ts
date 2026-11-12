// WP19 / T085, T088 (ii)(iii) : renouvellement SANS rotation (décision 11, OP-N102). Le test (iv)
// (rotation forcée au retour, détection de réutilisation) relève du central et du banc de WP25.
import { createHash, randomBytes, sign as nodeSign, type KeyObject } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { decodeJwt } from 'jose';
import { refreshProofMessage } from '../../src/device/dto';
import { makeBench, newKeyPair, type Bench, type TestDevice } from './_support/harness';

let b: Bench;
let d: TestDevice;

beforeAll(async () => {
  b = await makeBench({ failureFloorMs: 5 });
  d = await b.newDevice();
});
afterAll(async () => b.close());

const ROUTE = '/v1/device-tokens/refresh';

function body(
  device: TestDevice,
  over: { token?: string; nonce?: string; serial?: string; signer?: KeyObject } = {},
): Record<string, string> {
  const token = over.token ?? device.refreshToken;
  const nonce = over.nonce ?? randomBytes(18).toString('base64url');
  const serial = over.serial ?? device.serial;
  const signature = nodeSign('sha256', refreshProofMessage(nonce, serial, token), {
    key: over.signer ?? device.signing.privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  return { serial, refresh_token: token, nonce, signature: signature.toString('base64') };
}

const post = (device: TestDevice, payload: unknown, cert: TestDevice['cert'] | null = device.cert) =>
  b.raw({ method: 'POST', path: ROUTE, body: payload, cert });

const fingerprint = async (device: TestDevice): Promise<string> =>
  (
    await b.q<{ h: string }>(
      'SELECT encode(refresh_token_sha256_current, \'hex\') AS h FROM edge_device_token_family WHERE fid = $1',
      [device.fid],
    )
  )[0]!.h;

describe('émission', () => {
  it('200 : jeton d’accès court de la passerelle, forme exacte de TokenResponse', async () => {
    const r = await post(d, body(d));
    expect(r.status).toBe(200);
    expect(Object.keys(r.json!).sort()).toEqual(['access_token', 'expires_in', 'refresh_token', 'token_type']);
    expect(r.json!.token_type).toBe('Bearer');
    expect(r.json!.expires_in).toBeLessThanOrEqual(900);
    const claims = decodeJwt(r.json!.access_token as string);
    expect(claims.aud).toBe(`cashless-edge/${b.gatewayId}`);
    expect(claims.fid).toBe(d.fid);
    // Le jeton émis ouvre une route de terminal.
    const next = await b.request(d, { path: '/v1/device/seq-status', token: r.json!.access_token as string });
    expect(next.status).toBe(200);
  });

  it('émission auditée (edge_audit) sans jeton ni empreinte', async () => {
    const before = await b.q<{ n: string }>("SELECT count(*) AS n FROM edge_audit WHERE kind = 'DEVICE_TOKEN_ISSUED'");
    const r = await post(d, body(d));
    expect(r.status).toBe(200);
    const rows = await b.q<{ detail: Record<string, unknown> }>(
      "SELECT detail FROM edge_audit WHERE kind = 'DEVICE_TOKEN_ISSUED' ORDER BY id DESC LIMIT 1",
    );
    expect(Number((await b.q<{ n: string }>("SELECT count(*) AS n FROM edge_audit WHERE kind = 'DEVICE_TOKEN_ISSUED'"))[0]!.n)).toBe(Number(before[0]!.n) + 1);
    const text = JSON.stringify(rows[0]!.detail);
    expect(text).not.toContain(r.json!.access_token as string);
    expect(text).not.toContain(d.refreshToken);
    expect(text).not.toContain(createHash('sha256').update(d.refreshToken).digest('hex'));
    expect(Object.keys(rows[0]!.detail).sort()).toEqual(['exp', 'fid', 'jti', 'kid']);
  });
});

describe('(ii) empreinte courante', () => {
  it('jeton de rafraîchissement d’une autre empreinte (celui de la veille) : 401 REFRESH_TOKEN_INVALID', async () => {
    const yesterday = `drt_${randomBytes(32).toString('base64url')}`;
    const r = await post(d, body(d, { token: yesterday }));
    expect(r.status).toBe(401);
    expect(r.json?.code).toBe('REFRESH_TOKEN_INVALID');
    expect(r.json).not.toHaveProperty('detail');
  });

  it('refus identique pour toute preuve fausse : possession, certificat, serial, famille', async () => {
    const other = await b.newDevice();
    const revoked = await b.newDevice({ revokeFamily: true });
    const cases: Array<[string, Awaited<ReturnType<typeof post>>]> = [
      ['signature d’une autre clé', await post(d, body(d, { signer: newKeyPair().privateKey }))],
      ['certificat d’un autre terminal', await post(d, body(d), other.cert)],
      ['sans certificat', await post(d, body(d), null)],
      ['serial inconnu', await post(d, body(d, { serial: 'INCONNU-123' }))],
      ['famille révoquée', await post(revoked, body(revoked))],
    ];
    for (const [name, r] of cases) {
      expect({ name, status: r.status, code: r.json?.code }).toEqual({
        name,
        status: 401,
        code: 'REFRESH_TOKEN_INVALID',
      });
    }
  });

  it('même demande signée rejouée (même nonce) : refusée', async () => {
    const request = body(d);
    expect((await post(d, request)).status).toBe(200);
    expect((await post(d, request)).status).toBe(401);
  });

  it('signature qui n’est pas du base64 : 400 ; d’une autre longueur : 401', async () => {
    const bad = await post(d, { ...body(d), signature: '***' });
    expect(bad.status).toBe(400);
    expect(bad.json?.code).toBe('VALIDATION_FAILED');
    const short = await post(d, { ...body(d), signature: Buffer.alloc(10).toString('base64') });
    expect(short.status).toBe(401);
    expect((await post(d, { serial: 'x' })).status).toBe(400);
  });
});

describe('(iii) sans rotation', () => {
  it('rejoué 100 fois : toujours valable, jamais un autre jeton de rafraîchissement, empreinte intacte', async () => {
    const before = await fingerprint(d);
    const families = await b.q('SELECT fid FROM edge_device_token_family WHERE device_id = $1', [d.deviceId]);
    for (let i = 0; i < 100; i += 1) {
      const r = await post(d, body(d));
      expect(r.status).toBe(200);
      expect(r.json!.refresh_token).toBe(d.refreshToken);
      expect(Object.keys(r.json!)).not.toContain('next_refresh_token');
    }
    expect(await fingerprint(d)).toBe(before);
    expect(before).toBe(createHash('sha256').update(d.refreshToken).digest('hex'));
    expect(await b.q('SELECT fid FROM edge_device_token_family WHERE device_id = $1', [d.deviceId])).toEqual(families);
  });

  it('la réponse ne porte aucun jeton de rafraîchissement différent du présenté', async () => {
    const r = await post(d, body(d));
    const values = Object.values(r.json!).map(String);
    const refreshLike = values.filter((v) => v.startsWith('drt_'));
    expect(refreshLike).toEqual([d.refreshToken]);
  });

  it('famille révoquée après coup (réplication) : refusée dès l’appel suivant', async () => {
    const dev = await b.newDevice();
    expect((await post(dev, body(dev))).status).toBe(200);
    await b.q("UPDATE edge_device_token_family SET status = 'REVOKED' WHERE fid = $1", [dev.fid]);
    expect((await post(dev, body(dev))).status).toBe(401);
  });

  it('passerelle sans famille répliquée (STANDBY) : 401, aucun jeton émis', async () => {
    const dev = await b.newDevice();
    await b.q('DELETE FROM edge_device_token_family WHERE fid = $1', [dev.fid]);
    expect((await post(dev, body(dev))).status).toBe(401);
  });

  it('une empreinte absente (NULL) ne correspond à rien', async () => {
    const dev = await b.newDevice();
    await b.q('UPDATE edge_device_token_family SET refresh_token_sha256_current = NULL WHERE fid = $1', [dev.fid]);
    expect((await post(dev, body(dev))).status).toBe(401);
  });
});

describe('statut du terminal, révélé seulement après la preuve de possession', () => {
  it('SUSPENDED : 403 DEVICE_SUSPENDED ; REVOKED : 403 DEVICE_REVOKED', async () => {
    const suspended = await b.newDevice({ status: 'SUSPENDED' });
    const revoked = await b.newDevice({ status: 'REVOKED' });
    const s = await post(suspended, body(suspended));
    const r = await post(revoked, body(revoked));
    expect([s.status, s.json?.code]).toEqual([403, 'DEVICE_SUSPENDED']);
    expect([r.status, r.json?.code]).toEqual([403, 'DEVICE_REVOKED']);
  });

  it('sans preuve de possession, un terminal révoqué ne l’apprend pas : 401', async () => {
    const revoked = await b.newDevice({ status: 'REVOKED' });
    const r = await post(revoked, body(revoked, { signer: newKeyPair().privateKey }));
    expect([r.status, r.json?.code]).toEqual([401, 'REFRESH_TOKEN_INVALID']);
  });
});

describe('confidentialité', () => {
  it('ni jeton de rafraîchissement, ni empreinte, ni jeton d’accès dans les journaux', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const good = await post(d, body(d));
    await post(d, body(d, { token: `drt_${randomBytes(32).toString('base64url')}` }));
    await post(d, body(d, { signer: newKeyPair().privateKey }));
    const logged = JSON.stringify(warn.mock.calls);
    warn.mockRestore();
    expect(logged).toContain('device_token_refresh_refused');
    for (const secret of [
      d.refreshToken,
      createHash('sha256').update(d.refreshToken).digest('hex'),
      createHash('sha256').update(d.refreshToken).digest('base64'),
      good.json!.access_token as string,
    ])
      expect(logged).not.toContain(secret);
  });
});
