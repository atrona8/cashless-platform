// Remplaçabilité des ports d'identité (SC-008, FR-034 ; WP20, T082 ; contracts/identity-ports.md).
// Terminal (mission 5a, lot WP12, SC-007, OP-N42) : le faux fournisseur de la mission 4 est
// remplacé par l'identité RÉELLE (certificat client, jeton d'appareil lié, signature de la
// requête). Les routes `POST /v1/taps` (API publique) et `POST /v1/media/auth-keys` (processus des
// clés de bracelet) sont servies en HTTPS par le terminal de test, sans changement de leurs
// contrôleurs (vérifié par `git diff`), hormis la borne iOS de `/media/auth-keys` (OP-N64,
// ADR-106). Matrice de NFR-002 (preuve absente, fausse, expirée, d'un autre terminal), rejeu
// (NFR-004), horloge, révocation entre deux requêtes (NFR-003), aucune écriture de nonce sans
// authentification. Festivalier : le fournisseur `CUSTOMER_IDENTITY` (en-têtes de test) est
// remplacé par un jeton de compte signé ; le rattachement `POST /v1/me/media` est rejoué sans
// toucher au contrôleur ni à la garde, qui continue de vérifier le compte en base
// (`CUSTOMER_DIRECTORY`).
//
// Écritures directes en base : amorçage seulement (jeu d'essai, lot actif et bracelet personnalisé
// puis activé par les fonctions du schéma), comme les suites de media/ ; terminaux enrôlés par les
// fonctions de la base (test-terminal.ts).
import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import type { Request } from 'express';
import { generateClaimCode } from '@cashless/tag-format';
import request from 'supertest';
import {
  CUSTOMER_IDENTITY,
  type CustomerClaims,
  type CustomerIdentityPort,
} from '../../../src/customer-identity/customer-identity.port';
import type { DeviceCaPort } from '../../../src/device-ca/device-ca.port';
import { FakeDeviceCa } from '../../../src/device-ca/fake-device-ca';
import { DEVICE_IDENTITY } from '../../../src/device-identity/device-identity.port';
import { RealDeviceIdentity } from '../../../src/device-identity/real-device-identity';
import { DeviceTokenService } from '../../../src/device-tokens/device-token.service';
import { ClaimHasher } from '../../../src/kms/claim-hash';
import { DataKeyRepository } from '../../../src/media/keys/data-key.repository';
import { TagKeysProcessModule } from '../../../src/processes/tag-keys.module';
import { WorkerRegistry } from '../../../src/processes/worker';
import { createTestApp, startHttpsApp, type HttpsTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { createTestCustomer, type TestCustomer } from '../../support/fake-customer';
import {
  activateMedia,
  createBatch,
  createMediaWorld,
  goLive,
  MEDIA_KEY_INDEX,
  ownerRows as rows,
  seedPersonalizedMedia,
  tapBody,
  type MediaWorld,
  type SeededMedia,
} from '../../support/media-fixtures';
import { send, TestTerminal, type ProofOptions } from '../../support/test-terminal';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REPO_ROOT = join(__dirname, '../../../../..');

/** Contrôleurs des routes de terminal de la mission 4 (SC-007). */
const MISSION_4_CONTROLLERS = 'apps/api/src/media';
/** Seule ligne changée permise : la borne iOS (T061, OP-N64). */
const ALLOWED_CHANGE = {
  file: 'apps/api/src/media/auth-keys/auth-keys.controller.ts',
  removed: ['  @DeviceAuth()'],
  added: ['  @DeviceAuth({ nfcOnly: true })'],
};

/**
 * Contrôleurs de la mission 4 modifiés par la mission 6 (lot WP09 : rattachement de la session de
 * caisse aux espèces dues, à la caution et à la libération avec espèces, prévu par le plan de la
 * mission 6, FR-006 ; décision du porteur du 29/10/2026). Liste fermée : tout autre contrôleur
 * modifié fait échouer le test.
 */
const MISSION_6_CONTROLLERS = [
  'apps/api/src/media/lifecycle/cash-due.controller.ts',
  'apps/api/src/media/lifecycle/deposit.controller.ts',
  'apps/api/src/media/lifecycle/release.controller.ts',
];

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
}

/**
 * Base de comparaison : la fin de la mission 4, fusion de la PR #3 dans main. Une base calculée
 * (merge-base avec main) devenait le commit courant une fois la mission 5a fusionnée dans main, et le
 * test échouait sur main et sur les branches qui en partent (CI de main, 22/10/2026).
 */
const MISSION_4_END = '89d46518ba19957351e12a4905e4fb9a4855f56d';

function mainBase(): string {
  try {
    return git('rev-parse', '--verify', `${MISSION_4_END}^{commit}`).trim();
  } catch {
    throw new Error('fin de la mission 4 introuvable : historique git complet exigé par ce test');
  }
}

describe('SC-007 : les routes de terminal de la mission 4 servies par l’identité réelle', () => {
  let w: MediaWorld;
  let api: HttpsTestApp;
  let keys: HttpsTestApp;
  let ca: DeviceCaPort;
  let tokens: DeviceTokenService;
  let terminal: TestTerminal;
  let other: TestTerminal;
  let media: SeededMedia;
  let counter = 0;
  const next = () => (counter += 1);
  const tap = (who: TestTerminal, proofs: ProofOptions = {}, m: SeededMedia = media) =>
    who.request(
      api.baseUrl,
      api.tls.serverCaPem,
      { method: 'POST', path: '/taps', body: tapBody(m, next()) },
      proofs,
    );
  // Nonces des deux terminaux de la suite seulement : les autres suites en écrivent en parallèle.
  const nonces = async (): Promise<number> =>
    (
      await rows<{ n: number }>(
        'SELECT count(*)::int AS n FROM device_request_nonce WHERE device_id = ANY($1)',
        [[terminal.deviceId, other.deviceId]],
      )
    )[0]!.n;
  const enrolled = async (os: 'ANDROID' | 'IOS' = 'ANDROID'): Promise<TestTerminal> => {
    const t = await withOwner((db) =>
      new TestTerminal(os).enroll(db, { operatorId: w.ops.a, eventId: w.ids.eventA, ca }),
    );
    await t.issueToken(tokens);
    return t;
  };

  beforeAll(async () => {
    w = await createMediaWorld();
    api = await startHttpsApp(undefined, { identity: w.idp });
    keys = await startHttpsApp(TagKeysProcessModule);
    ca = await FakeDeviceCa.fromFiles({
      certFile: api.tls.deviceCaCertFile,
      keyFile: api.tls.deviceCaFakeKeyFile,
    });
    tokens = api.app.get(DeviceTokenService, { strict: false });
    await withOwner(async (db) => {
      const batch = await createBatch(db, {
        operatorId: w.ops.a,
        organizerId: w.ids.organizerA,
        eventId: w.ids.eventA,
        status: 'ACTIVE',
      });
      [media] = (await seedPersonalizedMedia(db, {
        operatorId: w.ops.a,
        batchId: batch,
        kmsKeyRef: w.keyRef.a,
        count: 1,
      })) as [SeededMedia];
      await activateMedia(db, {
        operatorId: w.ops.a,
        eventId: w.ids.eventA,
        walletId: w.ids.walletA,
        mediaIds: [media.id],
      });
    });
    terminal = await enrolled();
    other = await enrolled();
  });

  afterAll(async () => {
    await api?.close();
    await keys?.close();
  });

  it('les deux processus portent l’identité réelle (aucun faux)', () => {
    for (const app of [api.app, keys.app])
      expect(app.get(DEVICE_IDENTITY, { strict: false })).toBeInstanceOf(RealDeviceIdentity);
  });

  it('POST /v1/taps : trois preuves, même réponse qu’avec le faux d’origine ; un nonce écrit', async () => {
    const before = await nonces();
    const res = await tap(terminal);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      tap_id: expect.any(Number),
      result: 'OK',
      media: { media_id: media.id, status: 'ACTIVE' },
      wallet: { wallet_id: w.ids.walletA },
    });
    expect(await nonces()).toBe(before + 1);
  });

  it('POST /v1/media/auth-keys (processus des clés) : le terminal ouvre l’enveloppe', async () => {
    const res = await terminal.request(keys.baseUrl, keys.tls.serverCaPem, {
      method: 'POST',
      path: '/media/auth-keys',
      body: { nfc_uid: media.uid, key_index: MEDIA_KEY_INDEX },
    });
    expect(res.status).toBe(200);
    const opened = terminal.open(res.body.enc as never, Buffer.from(media.uid, 'hex'));
    expect(opened.equals(media.pwdPack)).toBe(true);
  });

  it('NFR-002 : chaque preuve absente, fausse, expirée ou d’un autre terminal est refusée, sans écrire de nonce', async () => {
    const expired = (
      await tokens.issue(
        {
          deviceId: terminal.deviceId,
          operatorId: w.ops.a,
          serial: terminal.serial,
          eventId: w.ids.eventA,
          signingSpki: terminal.signing.spki,
          familyId: terminal.familyId,
        },
        new Date(Date.now() - 3600_000),
      )
    ).token;
    const cases: Array<[string, ProofOptions, string]> = [
      ['certificat absent', { certificate: 'none' }, 'UNAUTHENTICATED'],
      ['certificat d’un autre terminal', { certificate: other }, 'UNAUTHENTICATED'],
      ['jeton absent', { token: null }, 'UNAUTHENTICATED'],
      ['jeton d’un autre terminal', { token: other.token }, 'UNAUTHENTICATED'],
      ['jeton expiré', { token: expired }, 'UNAUTHENTICATED'],
      ['jeton falsifié', { token: `${terminal.token.slice(0, -4)}AAAA` }, 'UNAUTHENTICATED'],
      ['signature absente', { signature: 'none' }, 'DEVICE_SIGNATURE_INVALID'],
      [
        'signature d’un autre terminal',
        { signature: { privateKey: other.signing.privateKey } },
        'DEVICE_SIGNATURE_INVALID',
      ],
      [
        'signée pour une autre autorité',
        { signedAuthority: 'edge.cashless.example' },
        'DEVICE_SIGNATURE_INVALID',
      ],
      [
        'adressée à une autorité non servie',
        { headers: { host: 'edge.cashless.example' }, signedAuthority: 'edge.cashless.example' },
        'DEVICE_SIGNATURE_INVALID',
      ],
      ['corps changé après signature', { sentBody: '{"x":1}' }, 'DEVICE_SIGNATURE_INVALID'],
    ];
    const before = await nonces();
    const refused: Array<[string, number, unknown]> = [];
    const bodies = new Map<unknown, Set<string>>();
    for (const [name, proofs, code] of cases) {
      const res = await tap(terminal, proofs);
      if (res.status !== 401 || res.body.code !== code)
        refused.push([name, res.status, res.body.code]);
      // Le refus ne dit pas quelle preuve a échoué : même corps pour tous les refus d'un code.
      const { instance: _instance, ...problem } = res.body;
      bodies.set(code, (bodies.get(code) ?? new Set()).add(JSON.stringify(problem)));
    }
    expect(refused).toEqual([]);
    expect([...bodies.values()].map((set) => set.size)).toEqual([1, 1]);
    expect(await nonces()).toBe(before);
  });

  it('NFR-004 : rejeu exact d’une requête signée refusé', async () => {
    const prepared = terminal.prepare(api.baseUrl, {
      method: 'POST',
      path: '/taps',
      body: tapBody(media, next()),
    });
    expect((await send(prepared, api.tls.serverCaPem)).status).toBe(200);
    const replay = await send(prepared, api.tls.serverCaPem);
    expect([replay.status, replay.body.code]).toEqual([401, 'DEVICE_SIGNATURE_INVALID']);
  });

  it('horloge du terminal hors tolérance : 400 CLOCK_SKEW_TOO_LARGE avec l’heure du serveur', async () => {
    const res = await tap(terminal, { created: Math.floor(Date.now() / 1000) - 3600 });
    expect([res.status, res.body.code]).toEqual([400, 'CLOCK_SKEW_TOO_LARGE']);
    expect(Number.isNaN(Date.parse(String(res.headers.date)))).toBe(false);
  });

  it('NFR-003 : révocation entre deux requêtes, la seconde refusée avec un jeton encore valide', async () => {
    const victim = await enrolled();
    expect((await tap(victim)).status).toBe(200);
    await withOwner((db) => victim.setStatus(db, 'REVOKED'));
    // Étape 6 bis (ADR-115) : 403 DEVICE_REVOKED au vrai terminal, sans nonce consommé.
    const own = async (): Promise<number> =>
      (
        await rows<{ n: number }>(
          'SELECT count(*)::int AS n FROM device_request_nonce WHERE device_id = $1',
          [victim.deviceId],
        )
      )[0]!.n;
    const before = await own();
    const revoked = await tap(victim);
    expect([revoked.status, revoked.body.code]).toEqual([403, 'DEVICE_REVOKED']);
    expect(await own()).toBe(before);
    const suspended = await enrolled();
    await withOwner((db) => suspended.setStatus(db, 'SUSPENDED'));
    const res = await tap(suspended);
    expect([res.status, res.body.code]).toEqual([403, 'DEVICE_SUSPENDED']);
  });

  it('borne iOS (OP-N64) : /media/auth-keys refuse un terminal iOS, /taps le sert', async () => {
    const ios = await enrolled('IOS');
    const res = await ios.request(keys.baseUrl, keys.tls.serverCaPem, {
      method: 'POST',
      path: '/media/auth-keys',
      body: { nfc_uid: media.uid, key_index: MEDIA_KEY_INDEX },
    });
    expect([res.status, res.body.code]).toEqual([422, 'DEVICE_MODE_NOT_ALLOWED']);
    expect(res.body.enc).toBeUndefined();
    expect((await tap(ios)).status).toBe(200);
  });

  it('purge des nonces expirés : travailleur device-purge de l’API publique, sous cashless_app', async () => {
    const workers = api.app.get(WorkerRegistry, { strict: false });
    expect(workers.names()).toContain('device-purge');
    const stale = randomBytes(16);
    await withOwner((db) =>
      db.query(
        `INSERT INTO device_request_nonce (operator_id, device_id, nonce, expires_at)
         VALUES ($1, $2, $3, now() - interval '1 hour')`,
        [w.ops.a, terminal.deviceId, stale],
      ),
    );
    await workers.drain();
    expect(await rows('SELECT 1 FROM device_request_nonce WHERE nonce = $1', [stale])).toEqual([]);
    // Les nonces encore dans la fenêtre restent : le rejeu reste détecté.
    expect(await nonces()).toBeGreaterThan(0);
  });

  // Route de guichet (décision du porteur du 20/10/2026, contrat `staffBearer`) : jeton d'appareil
  // dans Authorization avec les deux autres preuves, jeton de la personne dans X-Staff-Authorization.
  const counterRead = (who: TestTerminal, staff: string | null, proofs: ProofOptions = {}) =>
    who.request(
      api.baseUrl,
      api.tls.serverCaPem,
      { method: 'GET', path: `/media/${media.id}` },
      {
        ...proofs,
        headers: {
          ...(staff === null ? {} : { 'X-Staff-Authorization': `Bearer ${staff}` }),
          ...(proofs.headers ?? {}),
        },
      },
    );

  it('guichet : trois preuves du terminal et X-Staff-Authorization de la personne servis', async () => {
    const res = await counterRead(terminal, w.cashierA.token);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ media_id: media.id });
  });

  it('guichet : sans X-Staff-Authorization, jeton de personne invalide ou rôle non autorisé : refus', async () => {
    const without = await counterRead(terminal, null);
    expect([without.status, without.body.code]).toEqual([401, 'UNAUTHENTICATED']);
    const forged = await counterRead(terminal, `${w.cashierA.token.slice(0, -4)}AAAA`);
    expect([forged.status, forged.body.code]).toEqual([401, 'UNAUTHENTICATED']);
    const wrongRole = await counterRead(terminal, w.organizerAdminA.token);
    expect([wrongRole.status, wrongRole.body.code]).toEqual([403, 'FORBIDDEN']);
  });

  it('guichet : jeton de la personne dans Authorization à la place du jeton d’appareil : refus', async () => {
    const swapped = await counterRead(terminal, null, { token: w.cashierA.token });
    expect([swapped.status, swapped.body.code]).toEqual([401, 'UNAUTHENTICATED']);
    // Les deux en-têtes portent le jeton de la personne : toujours aucun jeton d'appareil.
    const both = await counterRead(terminal, w.cashierA.token, { token: w.cashierA.token });
    expect(both.status).toBe(401);
  });

  it('X-Staff-Authorization hors d’une route de guichet : refusé, sans nonce écrit', async () => {
    const before = await nonces();
    const res = await tap(terminal, {
      headers: { 'X-Staff-Authorization': `Bearer ${w.cashierA.token}` },
    });
    expect([res.status, res.body.code]).toEqual([401, 'UNAUTHENTICATED']);
    const keysRes = await terminal.request(
      keys.baseUrl,
      keys.tls.serverCaPem,
      {
        method: 'POST',
        path: '/media/auth-keys',
        body: { nfc_uid: media.uid, key_index: MEDIA_KEY_INDEX },
      },
      { headers: { 'X-Staff-Authorization': `Bearer ${w.cashierA.token}` } },
    );
    expect([keysRes.status, keysRes.body.code]).toEqual([401, 'UNAUTHENTICATED']);
    expect(await nonces()).toBe(before);
  });

  it('auth-keys : terminal révoqué entre la garde et la remise, aucun mot de passe ne part', async () => {
    const victim = await enrolled();
    // Double du dépôt des clés de données : la révocation est validée pendant le traitement de la
    // requête, après la garde (point d'arrêt injecté au chargement de la clé de données).
    const real = new DataKeyRepository();
    const revoking = Object.create(real) as DataKeyRepository;
    revoking.encrypted = async (client, dekId) => {
      await withOwner((db) => victim.setStatus(db, 'REVOKED'));
      return real.encrypted(client, dekId);
    };
    const process = await startHttpsApp(TagKeysProcessModule, {
      overrides: [{ provide: DataKeyRepository, useValue: revoking }],
    });
    try {
      const res = await victim.request(process.baseUrl, process.tls.serverCaPem, {
        method: 'POST',
        path: '/media/auth-keys',
        body: { nfc_uid: media.uid, key_index: MEDIA_KEY_INDEX },
      });
      expect([res.status, res.body.code]).toEqual([403, 'DEVICE_REVOKED']);
      expect(res.body.enc).toBeUndefined();
    } finally {
      await process.close();
    }
  });

  it('SC-007 : aucune ligne des contrôleurs de la mission 4 n’a bougé, hormis la borne iOS', () => {
    const base = mainBase();
    const changed = git('diff', '--name-only', base, '--', MISSION_4_CONTROLLERS)
      .split('\n')
      .filter((file) => file.endsWith('.controller.ts'));
    expect(
      changed.filter(
        (file) => file !== ALLOWED_CHANGE.file && !MISSION_6_CONTROLLERS.includes(file),
      ),
    ).toEqual([]);
    const diff = git('diff', '-U0', base, '--', ALLOWED_CHANGE.file).split('\n');
    const lines = (sign: '+' | '-') =>
      diff.filter((l) => l.startsWith(sign) && !l.startsWith(`${sign}${sign}${sign}`));
    expect(lines('-').map((l) => l.slice(1))).toEqual(ALLOWED_CHANGE.removed);
    expect(lines('+').map((l) => l.slice(1))).toEqual(ALLOWED_CHANGE.added);
  });
});

/**
 * Autre implémentation du port du festivalier : `Authorization: Customer
 * <compte>.<prestataire>.<signature>`, HMAC-SHA256 sous un secret partagé. Réservée à ce test.
 */
class SignedTokenCustomerIdentity implements CustomerIdentityPort {
  calls = 0;

  constructor(private readonly secret: Buffer) {}

  static sign(secret: Buffer, customerId: string, operatorId: string): string {
    const mac = createHmac('sha256', secret)
      .update(`${customerId}.${operatorId}`)
      .digest('base64url');
    return `Customer ${customerId}.${operatorId}.${mac}`;
  }

  async identify(req: Request): Promise<CustomerClaims | null> {
    this.calls += 1;
    const header = req.header('authorization') ?? '';
    const match = /^Customer ([^.]+)\.([^.]+)\.([A-Za-z0-9_-]+)$/.exec(header);
    if (!match) return null;
    const [, customerId, operatorId, mac] = match as unknown as [string, string, string, string];
    if (!UUID.test(customerId) || !UUID.test(operatorId)) return null;
    const expected = createHmac('sha256', this.secret)
      .update(`${customerId}.${operatorId}`)
      .digest();
    const given = Buffer.from(mac, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    return {
      customerId: customerId.toLowerCase(),
      operatorId: operatorId.toLowerCase(),
      deviceRef: `jeton-${customerId.slice(0, 8)}`,
    };
  }
}

describe('SC-008 : le port d’identité du festivalier se remplace sans toucher aux routes', () => {
  const secret = Buffer.from(randomUUID());
  const identity = new SignedTokenCustomerIdentity(secret);
  let w: MediaWorld;
  let app: INestApplication;
  let batch: string;
  const token = (c: { customerId: string; operatorId: string }) =>
    SignedTokenCustomerIdentity.sign(secret, c.customerId, c.operatorId);
  const claim = (headers: Record<string, string>, code: string) =>
    request(app.getHttpServer())
      .post('/v1/me/media')
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send({ claim_code: code });
  const customer = () => withOwner((db) => createTestCustomer(db, w.ops.a));

  /** Bracelet actif sur un portefeuille anonyme à solde nul, avec son code imprimé associé. */
  const bracelet = async (hasher: ClaimHasher) =>
    withOwner(async (db) => {
      const [m] = (await seedPersonalizedMedia(db, {
        operatorId: w.ops.a,
        batchId: batch,
        kmsKeyRef: w.keyRef.a,
        count: 1,
      })) as [SeededMedia];
      const code = generateClaimCode(randomBytes);
      const hash = hasher.claimCodeHash(code);
      await db.query(
        `INSERT INTO claim_code (operator_id, batch_id, code_hash, media_id, associated_at)
         VALUES ($1, $2, $3, $4, now())`,
        [w.ops.a, batch, hash, m.id],
      );
      await db.query('UPDATE media SET claim_code_hash = $2 WHERE id = $1', [m.id, hash]);
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [w.ops.a]);
      const walletId = (
        await db.query<{ id: string }>('SELECT open_event_wallet($1) AS id', [w.ids.eventA])
      ).rows[0]!.id;
      await activateMedia(db, {
        operatorId: w.ops.a,
        eventId: w.ids.eventA,
        walletId,
        mediaIds: [m.id],
      });
      return { media: m, code, walletId };
    });

  beforeAll(async () => {
    w = await createMediaWorld();
    await withOwner(async (db) => {
      await goLive(db, w.ops.a, w.ids.eventA, w.operatorAdminA.userId);
      batch = await createBatch(db, {
        operatorId: w.ops.a,
        organizerId: w.ids.organizerA,
        eventId: w.ids.eventA,
        status: 'ACTIVE',
      });
    });
    app = await createTestApp({
      identity: w.idp,
      overrides: [{ provide: CUSTOMER_IDENTITY, useValue: identity }],
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('l’application porte bien l’autre implémentation', () => {
    expect(app.get(CUSTOMER_IDENTITY, { strict: false })).toBe(identity);
  });

  it('rattachement rejoué avec le jeton de compte : 201, portefeuille au festivalier', async () => {
    const b = await bracelet(app.get(ClaimHasher, { strict: false }));
    const me: TestCustomer = await customer();
    const before = identity.calls;
    const res = await claim({ Authorization: token(me) }, b.code);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ media_id: b.media.id, wallet_id: b.walletId });
    expect(identity.calls).toBe(before + 1);
    expect(await rows('SELECT customer_id FROM wallet WHERE id = $1', [b.walletId])).toEqual([
      { customer_id: me.customerId },
    ]);
  });

  it('les en-têtes du faux d’origine ne valent plus rien : 401', async () => {
    const me = await customer();
    expect((await claim(me.headers, generateClaimCode(randomBytes))).status).toBe(401);
  });

  it('jeton falsifié : 401 ; la garde vérifie le compte en base : compte inconnu refusé malgré un jeton valide', async () => {
    const me = await customer();
    const forged = SignedTokenCustomerIdentity.sign(
      Buffer.from('autre secret'),
      me.customerId,
      w.ops.a,
    );
    expect((await claim({ Authorization: forged }, generateClaimCode(randomBytes))).status).toBe(
      401,
    );
    const ghost = { customerId: randomUUID(), operatorId: w.ops.a };
    expect(
      (await claim({ Authorization: token(ghost) }, generateClaimCode(randomBytes))).status,
    ).toBe(401);
    // Festivalier d'un autre prestataire annoncé sous le prestataire A : inconnu de A.
    const foreign = await withOwner((db) => createTestCustomer(db, w.ops.b));
    expect(
      (
        await claim(
          { Authorization: token({ customerId: foreign.customerId, operatorId: w.ops.a }) },
          generateClaimCode(randomBytes),
        )
      ).status,
    ).toBe(401);
  });
});
