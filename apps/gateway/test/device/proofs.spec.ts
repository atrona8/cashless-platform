// WP19 / T088 : les trois preuves, chacune seule fausse ou absente, sur un garde qui ne devrait en
// vérifier que deux sur trois. Vraie base, vrai TLS, vraie autorité des terminaux de test.
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { p256Thumbprint } from '../../src/device/device-token.service';
import { GatewayTx } from '../../src/db/gateway-tx';
import { NonceStore } from '../../src/device-proofs/nonce-store';
import { makeBench, newKeyPair, type Bench, type TestDevice } from './_support/harness';
import { makeRealCa } from './_support/pki';

let b: Bench;
let d: TestDevice;
const READ = { path: '/v1/probe/strict' };

beforeAll(async () => {
  b = await makeBench({ failureFloorMs: 60 });
  d = await b.newDevice();
});
afterAll(async () => b.close());

/** 401 sans cause : seuls les membres du contrat, aucun `detail`, aucun nom de preuve. */
function expectOpaque401(r: {
  status: number;
  json: Record<string, unknown> | null;
  text: string;
}) {
  expect(r.status).toBe(401);
  expect(['UNAUTHENTICATED', 'DEVICE_SIGNATURE_INVALID']).toContain(r.json?.code);
  expect(Object.keys(r.json!).sort()).toEqual(['code', 'request_id', 'status', 'title', 'type']);
  expect(r.json).not.toHaveProperty('detail');
}

async function forgedToken(
  device: TestDevice,
  over: Record<string, unknown> = {},
  kid?: string,
): Promise<string> {
  await b.tokenFor(device); // garantit une clé active
  const active = (
    await b.q<{ kid: string }>("SELECT kid FROM edge_token_key WHERE status = 'ACTIVE'")
  )[0]!;
  const iat = Math.floor(b.clock.now().getTime() / 1000);
  const claims = {
    iss: b.gatewayId,
    aud: `cashless-edge/${b.gatewayId}`,
    sub: device.deviceId,
    operator_id: b.ids.operator,
    serial: device.serial,
    event_id: b.ids.event,
    cnf: { jkt: await p256Thumbprint(device.signing.spki) },
    fid: device.fid,
    iat,
    exp: iat + 900,
    jti: randomBytes(8).toString('base64url'),
    ...over,
  };
  const header = { alg: 'ES256', typ: 'device+jwt', kid: kid ?? active.kid };
  const input = `${Buffer.from(JSON.stringify(header)).toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
  const signature = await b.keystore.sign('token', Buffer.from(input));
  return `${input}.${signature.toString('base64url')}`;
}

describe('référence : une requête entièrement valide passe', () => {
  it('200 avec les trois preuves, et le nonce est consommé', async () => {
    const r = await b.request(d, READ);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true, device: d.deviceId });
    const rows = await b.q(
      'SELECT count(*)::int AS n FROM edge_device_nonce WHERE device_id = $1',
      [d.deviceId],
    );
    expect(rows[0]!.n).toBeGreaterThanOrEqual(1);
  });
});

describe('preuve 1 : certificat, chacune des autres preuves valides', () => {
  it('certificat d’un autre terminal (même autorité) : 401', async () => {
    const other = await b.newDevice();
    expectOpaque401(await b.request(d, { ...READ, cert: other.cert }));
  });

  it('certificat d’une autre autorité (passerelle / hors chaîne) : 401', async () => {
    const foreign = await makeRealCa('CN=gateway-ca-test');
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const certPem = await foreign.sign(
      'CN=passerelle',
      publicKey.export({ type: 'spki', format: 'der' }),
    );
    const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    expectOpaque401(await b.request(d, { ...READ, cert: { certPem, keyPem } }));
  });

  it('même clé et même sujet que le terminal, signés par une autre autorité : 401', async () => {
    const foreign = await makeRealCa('CN=device-ca-test'); // même nom, autre clé
    const certPem = await foreign.sign(`CN=${d.serial}`, d.signing.spki);
    // La clé privée du certificat est celle du terminal : seule la chaîne diffère.
    const keyPem = d.signing.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    // La couche TLS peut couper la connexion elle-même (alerte), ce qui vaut refus ; sinon 401.
    const outcome = await b
      .request(d, { ...READ, cert: { certPem, keyPem } })
      .catch((error: Error) => error);
    if ('status' in outcome) expectOpaque401(outcome);
    else expect(outcome.message).toMatch(/hang up|ECONNRESET|alert/i);
  });

  it('certificat expiré : 401', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const certPem = await b.deviceCa.sign(
      'CN=vieux',
      publicKey.export({ type: 'spki', format: 'der' }),
      {
        notBefore: new Date(Date.now() - 7_200_000),
        notAfter: new Date(Date.now() - 3_600_000),
      },
    );
    const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    expectOpaque401(await b.request(d, { ...READ, cert: { certPem, keyPem } }));
  });

  it('aucun certificat : 401', async () => {
    expectOpaque401(await b.request(d, { ...READ, cert: null }));
  });

  it('autorité des terminaux dont la validité est échue au regard de l’horloge de la passerelle : 401', async () => {
    b.clock.advance(3 * 86_400_000);
    try {
      expectOpaque401(
        await b.request(d, {
          ...READ,
          token: await forgedToken(d, {
            iat: Math.floor(b.clock.now().getTime() / 1000),
            exp: Math.floor(b.clock.now().getTime() / 1000) + 900,
          }),
        }),
      );
    } finally {
      b.clock.advance(-3 * 86_400_000);
    }
  });
});

describe('preuve 2 : jeton d’appareil, certificat et signature valides', () => {
  it('jeton absent : 401', async () => {
    expectOpaque401(await b.request(d, { ...READ, token: null }));
  });

  it('jeton altéré (une charge utile modifiée) : 401', async () => {
    const token = await b.tokenFor(d);
    const [h, p, s] = token.split('.');
    const claims = JSON.parse(Buffer.from(p!, 'base64url').toString());
    claims.sub = randomUUID();
    const tampered = `${h}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${s}`;
    expectOpaque401(await b.request(d, { ...READ, token: tampered }));
  });

  it('jeton expiré : 401', async () => {
    const iat = Math.floor(b.clock.now().getTime() / 1000) - 2000;
    expectOpaque401(
      await b.request(d, { ...READ, token: await forgedToken(d, { iat, exp: iat + 900 }) }),
    );
  });

  it('jeton émis par la passerelle pour une autre audience : 401', async () => {
    expectOpaque401(
      await b.request(d, { ...READ, token: await forgedToken(d, { aud: 'cashless-device' }) }),
    );
    expectOpaque401(
      await b.request(d, {
        ...READ,
        token: await forgedToken(d, { aud: `cashless-edge/${randomUUID()}` }),
      }),
    );
  });

  it('jeton lié à une autre clé de signature (cnf.jkt) : 401', async () => {
    const other = newKeyPair();
    expectOpaque401(
      await b.request(d, {
        ...READ,
        token: await forgedToken(d, { cnf: { jkt: await p256Thumbprint(other.spki) } }),
      }),
    );
  });

  it('durée de vie au-delà de 900 s : 401', async () => {
    const iat = Math.floor(b.clock.now().getTime() / 1000);
    expectOpaque401(
      await b.request(d, { ...READ, token: await forgedToken(d, { iat, exp: iat + 3600 }) }),
    );
  });

  it('jeton du central (autre kid, aud du central) : 401, avant toute cryptographie', async () => {
    const central = new SignJWT({ sub: d.deviceId, aud: 'cashless-device' })
      .setProtectedHeader({ alg: 'ES256', typ: 'device+jwt', kid: 'central-kid-1' })
      .setExpirationTime('10m');
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    expectOpaque401(await b.request(d, { ...READ, token: await central.sign(privateKey) }));
  });

  it('jeton d’un autre terminal avec le certificat de celui-ci : 401', async () => {
    const other = await b.newDevice();
    expectOpaque401(await b.request(d, { ...READ, token: await b.tokenFor(other) }));
  });

  it('famille de jetons révoquée : 401', async () => {
    const revoked = await b.newDevice({ revokeFamily: true });
    expectOpaque401(await b.request(revoked, READ));
  });
});

describe('preuve 3 : signature de requête, certificat et jeton valides', () => {
  it('signature d’une autre clé : 401', async () => {
    expectOpaque401(await b.request(d, { ...READ, signer: newKeyPair().privateKey }));
  });

  it('signature absente : 401', async () => {
    expectOpaque401(await b.request(d, { ...READ, noSignature: true }));
  });

  it('requête rejouée à l’identique (même nonce) : 401, une seule exécution', async () => {
    const nonce = randomBytes(16).toString('base64url');
    const created = Math.floor(b.clock.now().getTime() / 1000);
    const first = await b.request(d, { ...READ, nonce, created });
    expect(first.status).toBe(200);
    const again = await b.request(d, { ...READ, nonce, created });
    expectOpaque401(again);
    expect(again.json?.code).toBe('DEVICE_SIGNATURE_INVALID');
  });

  it('created hors tolérance : 400 CLOCK_SKEW_TOO_LARGE avec l’heure de la passerelle', async () => {
    const created = Math.floor(b.clock.now().getTime() / 1000) - 600;
    const r = await b.request(d, { ...READ, created });
    expect(r.status).toBe(400);
    expect(r.json?.code).toBe('CLOCK_SKEW_TOO_LARGE');
    expect(typeof r.headers.date).toBe('string');
    const future = await b.request(d, { ...READ, created: created + 1300 });
    expect(future.status).toBe(400);
  });

  it('created mesuré sur l’horloge de la passerelle, pas sur l’heure système', async () => {
    b.clock.advance(-86_400_000 * 0 + 1_000_000); // la passerelle avance de ~16 min
    try {
      const wrong = await b.request(d, { ...READ, created: Math.floor(Date.now() / 1000) });
      expect(wrong.status).toBe(400);
    } finally {
      b.clock.advance(-1_000_000);
    }
  });

  it('@authority différente d’un caractère : 401', async () => {
    const forged = `${b.authority}0`;
    expectOpaque401(await b.request(d, { ...READ, authority: forged, hostHeader: forged }));
    expectOpaque401(
      await b.request(d, {
        ...READ,
        authority: 'api.cashless.test',
        hostHeader: 'api.cashless.test',
      }),
    );
  });

  it('signé pour une autre @authority que celle de l’en-tête Host : 401', async () => {
    expectOpaque401(await b.request(d, { ...READ, authority: 'api.cashless.test' }));
  });

  it('Content-Digest absent, ou différent du corps : 401', async () => {
    expectOpaque401(await b.request(d, { ...READ, headers: { 'content-digest': '' } }));
    expectOpaque401(
      await b.request(d, {
        method: 'POST',
        path: '/v1/probe/operation',
        body: { a: 1 },
        headers: { 'content-digest': 'sha-256=:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=:' },
      }),
    );
  });

  it('corps modifié après signature (digest signé, corps changé) : 401', async () => {
    const token = await b.tokenFor(d);
    // Le digest couvert est celui de `{"a":1}` ; le corps envoyé est autre.
    const ok = await b.raw({
      device: d,
      token,
      method: 'POST',
      path: '/v1/probe/operation',
      body: { a: 1 },
    });
    expect(ok.status).toBe(201);
    const { contentDigest } = await import('../../src/device-proofs/request-signature');
    const r = await b.raw({
      device: d,
      token,
      method: 'POST',
      path: '/v1/probe/operation',
      rawBody: '{"a":2}',
      headers: { 'content-digest': contentDigest(Buffer.from('{"a":1}')) },
    });
    expectOpaque401(r);
  });

  it('en-tête répété ou X-Request-Id qui n’est pas un UUID : 401', async () => {
    expectOpaque401(await b.request(d, { ...READ, requestId: 'pas-un-uuid' }));
    const id = randomUUID();
    expectOpaque401(await b.request(d, { ...READ, headers: { 'x-request-id': `${id}, ${id}` } }));
  });

  it('keyid différent du terminal : 401', async () => {
    const other = await b.newDevice();
    // Signature faite pour le keyid d'un autre terminal, avec la clé de celui-ci.
    const token = await b.tokenFor(d);
    const r = await b.raw({
      device: { ...d, deviceId: other.deviceId } as TestDevice,
      token,
      cert: d.cert,
      ...READ,
    });
    expectOpaque401(r);
  });
});

describe('statut du terminal, relu dans la copie après les trois preuves', () => {
  it('SUSPENDED : 403 DEVICE_SUSPENDED sur une route stricte, servi sur les lectures permises', async () => {
    const suspended = await b.newDevice({ status: 'SUSPENDED' });
    const strict = await b.request(suspended, READ);
    expect(strict.status).toBe(403);
    expect(strict.json?.code).toBe('DEVICE_SUSPENDED');
    expect((await b.request(suspended, { path: '/v1/device/config' })).status).toBe(200);
    expect((await b.request(suspended, { path: '/v1/device/seq-status' })).status).toBe(200);
  });

  it('REVOKED : 403 DEVICE_REVOKED partout, y compris les lectures permises au suspendu', async () => {
    const revoked = await b.newDevice({ status: 'REVOKED' });
    for (const path of ['/v1/probe/strict', '/v1/device/config', '/v1/device/seq-status']) {
      const r = await b.request(revoked, { path });
      expect(r.status).toBe(403);
      expect(r.json?.code).toBe('DEVICE_REVOKED');
    }
  });

  it('REVOKED n’est révélé qu’à celui qui prouve ses trois preuves : sinon 401', async () => {
    const revoked = await b.newDevice({ status: 'REVOKED' });
    expectOpaque401(await b.request(revoked, { ...READ, signer: newKeyPair().privateKey }));
  });

  it('la révocation répliquée est effective à la requête suivante', async () => {
    const dev = await b.newDevice();
    expect((await b.request(dev, READ)).status).toBe(200);
    await b.q("UPDATE edge_device SET status = 'REVOKED' WHERE device_id = $1", [dev.deviceId]);
    expect((await b.request(dev, READ)).json?.code).toBe('DEVICE_REVOKED');
  });
});

describe('nonce : persistant et transactionnel', () => {
  it('un nonce déjà vu reste refusé après un « redémarrage » (nouvelle instance, même base)', async () => {
    const tx = new GatewayTx(b.db.pool);
    const first = new NonceStore(tx, b.clock);
    const nonce = randomBytes(16);
    const created = b.clock.now();
    expect(await first.consumeAlone(d.deviceId, nonce, created)).toBe('OK');
    const restarted = new NonceStore(tx, b.clock);
    expect(await restarted.consumeAlone(d.deviceId, nonce, created)).toBe('REPLAY');
  });

  it('le même nonce pour un autre terminal n’est pas un rejeu', async () => {
    const other = await b.newDevice();
    const nonce = randomBytes(16);
    const store = new NonceStore(new GatewayTx(b.db.pool), b.clock);
    expect(await store.consumeAlone(d.deviceId, nonce, b.clock.now())).toBe('OK');
    expect(await store.consumeAlone(other.deviceId, nonce, b.clock.now())).toBe('OK');
  });

  it('écriture : nonce consommé dans la transaction de l’opération, annulé avec elle', async () => {
    const token = await b.tokenFor(d);
    const nonce = randomBytes(16).toString('base64url');
    const created = Math.floor(b.clock.now().getTime() / 1000);
    const failing = await b.raw({
      device: d,
      token,
      method: 'POST',
      path: '/v1/probe/operation',
      query: 'fail=1',
      nonce,
      created,
    });
    expect(failing.status).toBe(500);
    const before = await b.q(
      'SELECT 1 FROM edge_device_nonce WHERE device_id = $1 AND nonce = $2',
      [d.deviceId, nonce],
    );
    expect(before).toHaveLength(0); // annulé avec l'opération
    const ok = await b.raw({
      device: d,
      token,
      method: 'POST',
      path: '/v1/probe/operation',
      query: 'fail=1',
      nonce,
      created,
    });
    expect(ok.status).toBe(500); // rejouable : rien n'avait été consommé
    const good = await b.raw({
      device: d,
      token,
      method: 'POST',
      path: '/v1/probe/operation',
      nonce,
      created,
    });
    expect(good.status).toBe(201);
    const replay = await b.raw({
      device: d,
      token,
      method: 'POST',
      path: '/v1/probe/operation',
      nonce,
      created,
    });
    expectOpaque401(replay);
  });

  it('les nonces échus sont purgés, jamais ceux de la fenêtre', async () => {
    const store = new NonceStore(new GatewayTx(b.db.pool), b.clock);
    await b.q("INSERT INTO edge_device_nonce VALUES ($1, 'vieux', now() - interval '1 hour')", [
      d.deviceId,
    ]);
    b.clock.advance(120_000); // franchit l'intervalle de purge
    await store.consumeAlone(d.deviceId, randomBytes(16), b.clock.now());
    b.clock.advance(-120_000);
    expect(await b.q("SELECT 1 FROM edge_device_nonce WHERE nonce = 'vieux'")).toHaveLength(0);
  });
});

describe('le temps de réponse d’un 401 ne révèle pas la preuve en cause', () => {
  async function median(
    make: () => Promise<{ elapsedMs: number; status: number }>,
  ): Promise<number> {
    const samples: number[] = [];
    for (let i = 0; i < 9; i += 1) {
      const r = await make();
      expect(r.status).toBe(401);
      samples.push(r.elapsedMs);
    }
    return samples.sort((x, y) => x - y)[4]!;
  }

  it('certificat, jeton et signature fautifs : médianes proches', async () => {
    const other = await b.newDevice();
    const cert = await median(() => b.request(d, { ...READ, cert: other.cert }));
    const token = await median(async () =>
      b.request(d, { ...READ, token: await forgedToken(d, { aud: 'cashless-device' }) }),
    );
    const sig = await median(() => b.request(d, { ...READ, signer: newKeyPair().privateKey }));
    const all = [cert, token, sig];
    expect(Math.max(...all) - Math.min(...all)).toBeLessThan(30);
    for (const t of all) expect(t).toBeGreaterThanOrEqual(55);
  });
});
