// WP22 / T098 : jeton de personne au guichet. Règle normale, tolérance nominale d'un jeton expiré
// (une ligne d'audit dans la transaction de l'opération), clés d'identité, refus de forme.
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { GatewayTx } from '../../src/db/gateway-tx';
import { IdentityKeys, acceptableJwk } from '../../src/staff/identity-keys.service';
import { pendingStaffTokenAudit } from '../../src/queue/staff-audit-feed';
import {
  ISSUER,
  opCount,
  postTopup,
  readyBench,
  seedMedia,
  staffToken,
  toleratedToken,
  type Bench,
  type SeedMedia,
  type TestDevice,
} from './_support/bench';

let bench: Bench;
let device: TestDevice;
let activatedAt: Date;
let media: SeedMedia;

beforeAll(async () => {
  ({ bench, device, activatedAt } = await readyBench({
    activatedAgoMs: 2 * 3_600_000,
    sessionOpenedAgoMs: 3_600_000,
  }));
  media = await seedMedia(bench);
}, 120_000);
afterAll(async () => bench.close());

const audit = () =>
  bench.q<{ edge_seq: string; detail: Record<string, unknown>; device_id: string }>(
    `SELECT edge_seq, detail, device_id FROM edge_audit WHERE kind = 'STAFF_TOKEN_TOLERATED'
      ORDER BY id`,
  );

describe('jeton non expiré : règle normale, aucune tolérance', () => {
  it('jeton valide : recharge servie, aucune ligne de tolérance', async () => {
    const before = (await audit()).length;
    const r = await postTopup(bench, device, media);
    expect(r.status).toBe(201);
    expect((await audit()).length).toBe(before);
  });

  it('personne inactive, sans rôle de guichet ou inconnue : 403 FORBIDDEN, rien d’écrit', async () => {
    const before = await opCount(bench);
    await bench.q(`UPDATE edge_staff SET status = 'SUSPENDED' WHERE sub = 'cashier-1'`);
    expect((await postTopup(bench, device, media)).status).toBe(403);
    await bench.q(`UPDATE edge_staff SET status = 'ACTIVE', roles = '{VENDOR}'`);
    expect((await postTopup(bench, device, media)).status).toBe(403);
    expect(
      (await postTopup(bench, device, media, { staff: await staffToken(bench, { sub: 'nobody' }) }))
        .status,
    ).toBe(403);
    await bench.q(`UPDATE edge_staff SET roles = '{CASHIER}'`);
    expect(await opCount(bench)).toBe(before);
  });

  it('le rôle SUPERVISOR suffit', async () => {
    await bench.q(`UPDATE edge_staff SET roles = '{SUPERVISOR}'`);
    expect((await postTopup(bench, device, media)).status).toBe(201);
    await bench.q(`UPDATE edge_staff SET roles = '{CASHIER}'`);
  });
});

describe('jeton expiré toléré, cas nominal', () => {
  it('servi, avec UNE ligne d’audit à la forme attendue par le versement au central', async () => {
    const before = (await audit()).length;
    const jti = randomUUID();
    const token = await toleratedToken(bench, activatedAt, { jti });
    const r = await postTopup(bench, device, media, { staff: token });
    expect(r.status).toBe(201);
    const lines = await audit();
    expect(lines.length).toBe(before + 1);
    const last = lines[lines.length - 1]!;
    expect(last.device_id).toBe(device.deviceId);
    expect(last.detail).toMatchObject({
      sub: 'cashier-1',
      iss: ISSUER,
      jti,
      route: 'createCashTopup',
      device_serial: device.serial,
    });
    expect(last.detail.seconds_past_expiry).toBeGreaterThanOrEqual(1);
    // L'entrée de file que ce jeton autorise porte le même numéro que la ligne d'audit.
    const op = await bench.q<{ edge_seq: string; type: string }>(
      'SELECT edge_seq, type FROM edge_op ORDER BY edge_seq DESC LIMIT 1',
    );
    expect(Number(last.edge_seq)).toBe(Number(op[0]!.edge_seq));
    // La forme est celle que le vidage verse au central (sinon la ligne serait « non versable »).
    const gw = new GatewayTx(bench.db.pool);
    const fed = await gw.run((tx) =>
      pendingStaffTokenAudit(tx, Number(last.edge_seq), Number(last.edge_seq)),
    );
    expect(fed).toHaveLength(1);
    expect(fed[0]).toMatchObject({
      subject: 'cashier-1',
      issuer: ISSUER,
      jti,
      route: 'createCashTopup',
    });
  });

  it('un rejeu de la même clé n’ajoute ni opération ni ligne d’audit', async () => {
    const token = await toleratedToken(bench, activatedAt);
    const key = `${device.serial}:777`;
    const body = {
      occurred_at: bench.clock.now().toISOString(),
      tap: { ...(await tapFor(media)) },
    };
    const first = await postTopup(bench, device, media, { staff: token, key, body });
    expect(first.status).toBe(201);
    const lines = (await audit()).length;
    const ops = await opCount(bench);
    const again = await postTopup(bench, device, media, { staff: token, key, body });
    expect(again.status).toBe(201);
    expect(await opCount(bench)).toBe(ops);
    expect((await audit()).length).toBe(lines);
  });

  it('la ligne d’audit ne survit pas à l’échec de l’opération, ni l’opération à celui de l’audit', async () => {
    // Échec au COMMIT (déclencheur différé) : tout a été écrit, rien ne doit rester.
    await bench.q(`CREATE FUNCTION fail_at_commit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'échec simulé au commit'; END $$`);
    await bench.q(`CREATE CONSTRAINT TRIGGER fail_at_commit AFTER INSERT ON edge_op
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fail_at_commit()`);
    const ops = await opCount(bench);
    const lines = (await audit()).length;
    const idem = (await bench.q('SELECT 1 FROM edge_idempotency')).length;
    const token = await toleratedToken(bench, activatedAt);
    const r = await postTopup(bench, device, media, { staff: token });
    expect(r.status).toBe(500);
    await bench.q('DROP TRIGGER fail_at_commit ON edge_op');
    await bench.q('DROP FUNCTION fail_at_commit()');
    expect(await opCount(bench)).toBe(ops);
    expect((await audit()).length).toBe(lines);
    expect((await bench.q('SELECT 1 FROM edge_idempotency')).length).toBe(idem);
  });

  it('refus de l’opération après le garde (plafond par recharge) : aucune ligne d’audit', async () => {
    const lines = (await audit()).length;
    const token = await toleratedToken(bench, activatedAt);
    const r = await postTopup(bench, device, media, { staff: token, amount: 500_001 });
    expect(r.status).toBe(422);
    expect((await audit()).length).toBe(lines);
  });

  it('jeton expiré sans jti : refusé (l’audit serait impossible)', async () => {
    const lines = (await audit()).length;
    const token = await toleratedToken(bench, activatedAt, { jti: null });
    expect((await postTopup(bench, device, media, { staff: token })).status).toBe(401);
    expect((await audit()).length).toBe(lines);
  });
});

async function tapFor(m: SeedMedia) {
  const { tapOf } = await import('./_support/bench');
  return tapOf(m, bench);
}

describe('condition 1 : signature, kid, émetteur, audience', () => {
  const refused = async (staff: string | null) => {
    const before = await opCount(bench);
    const r = await postTopup(bench, device, media, { staff });
    expect(r.status).toBe(401);
    expect(r.json).toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(await opCount(bench)).toBe(before);
  };

  it('en-tête absent, mal formé ou sans « Bearer »', async () => {
    await refused(null);
    await refused('pas-un-jeton');
  });
  it('kid inconnu', async () => refused(await staffToken(bench, { kid: 'autre' })));
  it('signé par une autre clé que celle de la copie', async () => {
    const stranger = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
    await refused(await staffToken(bench, { key: stranger }));
  });
  it('iss faux', async () => refused(await staffToken(bench, { iss: 'https://pirate.test' })));
  it('aud fausse', async () => refused(await staffToken(bench, { aud: 'autre-audience' })));
  it('jeton expiré mais bien signé d’une mauvaise audience : aucune tolérance', async () =>
    refused(await toleratedToken(bench, activatedAt, { aud: 'autre-audience' })));
  it('algorithme non admis (HS256 / none)', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', kid: bench.identity.kid })).toString(
      'base64url',
    );
    const payload = Buffer.from(
      JSON.stringify({ sub: 'cashier-1', iss: ISSUER, aud: 'cashless-edge-test', exp: 9999999999 }),
    ).toString('base64url');
    await refused(`${header}.${payload}.AAAA`);
  });
  it('émetteur de la clé différent de l’émetteur attendu', async () => {
    await bench.q(`UPDATE edge_identity_key SET issuer = 'https://autre.test'`);
    await refused(await staffToken(bench));
    await bench.q(`UPDATE edge_identity_key SET issuer = $1`, [ISSUER]);
  });
  it('aucune configuration d’identité : aucun jeton de personne n’est accepté', async () => {
    const saved = [bench.config.identityIssuer, bench.config.identityAudience];
    bench.config.identityIssuer = null;
    await refused(await staffToken(bench));
    [bench.config.identityIssuer, bench.config.identityAudience] = saved as [string, string];
  });
});

describe('copie des clés d’identité (identity-keys.service)', () => {
  let server: Server;
  let url: string;
  let reply: { status: number; body: string; redirect?: string } = { status: 200, body: '{}' };
  let hits = 0;

  beforeAll(async () => {
    server = createServer((req, res) => {
      hits += 1;
      if (reply.redirect) {
        res.writeHead(302, { location: reply.redirect }).end();
        return;
      }
      res.writeHead(reply.status, { 'content-type': 'application/json' }).end(reply.body);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/jwks`;
  });
  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const service = () =>
    new IdentityKeys(new GatewayTx(bench.db.pool), {
      ...bench.config,
      identityJwksUrl: url,
    });
  const jwkFor = (kid?: string, extra: Record<string, unknown> = {}) => ({
    ...generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ format: 'jwk' }),
    ...(kid ? { kid } : {}),
    ...extra,
  });
  const kids = async () =>
    (await bench.q<{ kid: string }>('SELECT kid FROM edge_identity_key ORDER BY kid')).map(
      (r) => r.kid,
    );

  it('range les clés valides avec l’émetteur configuré', async () => {
    reply = { status: 200, body: JSON.stringify({ keys: [jwkFor('rot-1'), jwkFor('rot-2')] }) };
    expect(await service().refresh()).toBe(2);
    expect(await kids()).toEqual(expect.arrayContaining(['rot-1', 'rot-2']));
    const row = await bench.q<{ issuer: string }>(
      `SELECT issuer FROM edge_identity_key WHERE kid = 'rot-1'`,
    );
    expect(row[0]!.issuer).toBe(ISSUER);
  });

  it('refuse une clé sans kid, une clé privée, une clé non signature ou d’un type inconnu', async () => {
    reply = {
      status: 200,
      body: JSON.stringify({
        keys: [
          jwkFor(),
          jwkFor('prive', { d: 'AAAA' }),
          jwkFor('enc', { use: 'enc' }),
          { kty: 'oct', kid: 'hmac', k: 'AAAA' },
          jwkFor('alg-faible', { alg: 'HS256' }),
        ],
      }),
    };
    const before = await kids();
    expect(await service().refresh()).toBe(0);
    expect(await kids()).toEqual(before);
    expect(acceptableJwk(jwkFor('ok'))).not.toBeNull();
  });

  it('une erreur réseau ou une réponse illisible ne supprime aucune clé connue', async () => {
    const before = await kids();
    reply = { status: 500, body: 'erreur' };
    expect(await service().refresh()).toBe(0);
    reply = { status: 200, body: 'pas du json' };
    expect(await service().refresh()).toBe(0);
    reply = { status: 200, body: JSON.stringify({ keys: [] }) };
    expect(await service().refresh()).toBe(0);
    expect(await kids()).toEqual(before);
    const down = new IdentityKeys(new GatewayTx(bench.db.pool), {
      ...bench.config,
      identityJwksUrl: 'http://127.0.0.1:1/jwks',
    });
    expect(await down.refresh()).toBe(0);
    expect(await kids()).toEqual(before);
  });

  it('ne suit aucune redirection : une clé n’est acceptée que de l’URL configurée', async () => {
    reply = { status: 200, body: '', redirect: 'http://127.0.0.1:1/ailleurs' };
    const before = await kids();
    expect(await service().refresh()).toBe(0);
    expect(await kids()).toEqual(before);
  });

  it('sans émetteur configuré ou sans URL : rien n’est rangé', async () => {
    reply = { status: 200, body: JSON.stringify({ keys: [jwkFor('sans-emetteur')] }) };
    const noIssuer = new IdentityKeys(new GatewayTx(bench.db.pool), {
      ...bench.config,
      identityJwksUrl: url,
      identityIssuer: null,
    });
    expect(await noIssuer.refresh()).toBe(0);
    const noUrl = new IdentityKeys(new GatewayTx(bench.db.pool), {
      ...bench.config,
      identityJwksUrl: null,
    });
    const hitsBefore = hits;
    expect(await noUrl.refresh()).toBe(0);
    expect(hits).toBe(hitsBefore);
    expect(await kids()).not.toContain('sans-emetteur');
  });

  it('un kid inconnu rencontré provoque un rafraîchissement (rotation), au plus un par 30 s', async () => {
    const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    reply = {
      status: 200,
      body: JSON.stringify({
        keys: [{ ...pair.publicKey.export({ format: 'jwk' }), kid: 'rotation-live', alg: 'ES256' }],
      }),
    };
    const refreshing = new IdentityKeys(new GatewayTx(bench.db.pool), {
      ...bench.config,
      identityJwksUrl: url,
    });
    await refreshing.refreshIfStale(1_000_000);
    const hitsAfterFirst = hits;
    await refreshing.refreshIfStale(1_000_000 + 10_000);
    expect(hits).toBe(hitsAfterFirst);
    await refreshing.refreshIfStale(1_000_000 + 31_000);
    expect(hits).toBe(hitsAfterFirst + 1);
    expect(await kids()).toContain('rotation-live');
  });
});

describe('production : pas de clés d’identité en mémoire', () => {
  it('le vérificateur de test fait refuser le démarrage (règle enregistrée)', () => {
    jest.isolateModules(() => {
      const guard = jest.requireActual('../../src/processes/startup-guard');
      jest.requireActual('../../src/staff/identity-keys.service');
      const config = (production: boolean, identityVerifier: string | null) =>
        ({
          production,
          hardwareKeystore: 'hardware',
          edgeCa: null,
          identityVerifier,
          failpoint: null,
          allowFailpoints: null,
          tlsCertFile: '/c',
          tlsKeyFile: '/k',
          requestAuthority: 'a.test:1',
          databaseUrl: 'postgres://u:Zx9-long-secret-Qw7@h/d',
          centralUrl: 'https://c.test',
          identityJwksUrl: null,
          devKeyFile: null,
        }) as never;
      const out = guard.evaluateConfigRules({ config: config(true, 'test'), env: {} });
      expect(out.join('\n')).toMatch(/edge_identity_key/);
      expect(guard.evaluateConfigRules({ config: config(false, 'test'), env: {} })).toEqual([]);
      expect(
        guard.evaluateConfigRules({ config: config(true, null), env: {} }).join('\n'),
      ).not.toMatch(/edge_identity_key/);
    });
  });
});
