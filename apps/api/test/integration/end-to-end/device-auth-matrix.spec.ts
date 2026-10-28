// Matrice des preuves du terminal (mission 5a, lot WP18, T083 ; NFR-002, NFR-003, NFR-004,
// SC-002, SC-003 ; OP-N70, ADR-113 ; contracts/device-authentication.md, « Tests imposés »).
//
// Liste des routes : celles du contrat dont la sécurité réunit les trois preuves (`deviceMtls`,
// `deviceToken`, `deviceSignature`), croisée avec celles que `DeviceGuard` protège réellement dans
// l'API publique et dans le processus des clés de bracelet (métadonnées de Nest). Une route de
// terminal servie sans cas dans ce fichier, un cas sans route gardée, une route gardée absente du
// contrat, ou une route du contrat servie sans la garde font échouer le premier test : aucune route
// de terminal ne peut échapper aux preuves en identité réelle (OP-N70).
//
// Chaque route est appelée en HTTPS réel par le terminal de test (certificat client, jeton
// d'appareil lié, requête signée) : acceptée avec les trois preuves (un nonce consommé : la garde
// réelle l'a servie, jamais un 404 du routeur), puis refusée pour chaque preuve absente, fausse,
// expirée, d'un autre terminal, rejouée ou signée pour une autre autorité, sans nonce écrit. Le
// terminal suspendu n'est servi que sur les routes `allowSuspended` (R-14) ; révoqué, il reçoit
// `403 DEVICE_REVOKED` sur chaque route avec des preuves valides et `401` avec une preuve fausse,
// sans rien écrire (ADR-115). La route de rafraîchissement (certificat client seul) a son propre
// cas.
//
// Écritures directes en base : amorçage seulement (jeu d'essai, bracelet personnalisé puis activé
// par les fonctions du schéma), terminaux enrôlés par les fonctions de la base (test-terminal.ts).
// Lectures bornées aux terminaux de la suite : aucune hypothèse sur les autres suites.
//
// Registre (mission 5b, lot WP08, T038) : les 13 cas ci-dessous sont les cas de base ; chaque lot de
// routes de terminal ajoute les siens dans `device-auth-cases/<nom>.cases.ts` (lu par
// `device-auth-cases/registry.ts`, sans index). Routes gardées : `DeviceGuard` et la garde exclusive
// `DeviceOrCallerGuard` (« terminal ou personne / festivalier », A13). Méthodes GET, POST, PUT,
// PATCH, DELETE ; variantes « avec corps » pour POST, PUT, PATCH.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { TerminalOrPersonGuard } from '../../../src/cash-sessions/terminal-or-person.guard';
import { FakeDeviceCa } from '../../../src/device-ca/fake-device-ca';
import { DEVICE_IDENTITY } from '../../../src/device-identity/device-identity.port';
import { DeviceOrCallerGuard } from '../../../src/device-identity/device-or-caller.guard';
import { DeviceGuard } from '../../../src/device-identity/device.guard';
import { RealDeviceIdentity } from '../../../src/device-identity/real-device-identity';
import { DeviceTokenService } from '../../../src/device-tokens/device-token.service';
import { TagKeysProcessModule } from '../../../src/processes/tag-keys.module';
import { startHttpsApp, type HttpsTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import {
  adoptRefresh,
  contractDeviceOperations,
  guardedRoutes,
  noncesOf,
  prepareRefresh,
  refresh,
  refusedCertificates,
} from '../../support/device-e2e';
import {
  activateMedia,
  createBatch,
  createMediaWorld,
  MEDIA_KEY_INDEX,
  seedPersonalizedMedia,
  tapBody,
  type MediaWorld,
  type SeededMedia,
} from '../../support/media-fixtures';
import {
  send,
  TestTerminal,
  type PreparedRequest,
  type ProofOptions,
  type TerminalResponse,
} from '../../support/test-terminal';
import {
  BODY_METHODS,
  loadCases,
  WRITE_METHODS,
  type CaseContext,
  type RouteCase,
  type RouteMethod,
} from './device-auth-cases/registry';

jest.setTimeout(180_000);

const THREE_PROOFS = ['deviceMtls', 'deviceToken', 'deviceSignature'];
/** Routes servies à un terminal suspendu (R-14 : configuration, battement de cœur). */
const ALLOW_SUSPENDED = new Set(['GET /device/config', 'POST /device/heartbeat']);
const REFRESH_ROUTE = 'POST /device-tokens/refresh';

/** Contrôleurs des cas de base (mission 4 et 5a). */
const BASE_CONTROLLERS = [
  'DeviceConfigController',
  'HeartbeatController',
  'TapsController',
  'AuthKeysController',
  'MediaReadController',
  'ActivationController',
  'DepositController',
  'ReleaseController',
  'ReplaceController',
  'CashDueController',
  'ClaimsController',
];

interface Variant {
  name: string;
  /** Statut et code attendus ; code `null` : statut seul (cause non garantie par le contrat). */
  expected: [number, string | null];
  /** Routes à corps (POST, PUT, PATCH) seulement. */
  bodyOnly?: boolean;
  build(route: string): PreparedRequest;
}

describe('NFR-002, SC-002, OP-N70 : chaque route de terminal, chaque preuve', () => {
  let w: MediaWorld;
  let api: HttpsTestApp;
  let keys: HttpsTestApp;
  let ca: FakeDeviceCa;
  let tokens: DeviceTokenService;
  let terminal: TestTerminal;
  let other: TestTerminal;
  let media: SeededMedia;
  let expiredToken: string;
  let certificates: { expired: string; foreign: string };
  let counter = 0;
  const next = () => (counter += 1);

  const heartbeatBody = () => ({
    device_time: new Date().toISOString(),
    snapshot_version: null,
    last_local_seq: 0,
    pending_operations: 0,
    pending_exposure: 0,
    battery_percent: 80,
    app_version: '1.0.0-test',
  });
  /** Bracelet inconnu : la route de guichet le cherche, la garde a déjà servi la requête. */
  const unknownMedia = () => `/media/${randomUUID()}`;

  const BASE_CASES: Record<string, RouteCase> = {
    'GET /device/config': { server: 'api', path: () => '/device/config', ok: 200 },
    'POST /device/heartbeat': {
      server: 'api',
      path: () => '/device/heartbeat',
      body: heartbeatBody,
      ok: 200,
    },
    'POST /taps': {
      server: 'api',
      path: () => '/taps',
      body: () => tapBody(media, next()),
      ok: 200,
    },
    'POST /media/auth-keys': {
      server: 'keys',
      path: () => '/media/auth-keys',
      body: () => ({ nfc_uid: media.uid, key_index: MEDIA_KEY_INDEX }),
      ok: 200,
    },
    'GET /media/{}': { server: 'api', counter: true, path: () => `/media/${media.id}`, ok: 200 },
    'POST /media/activations': { server: 'api', counter: true, path: () => '/media/activations' },
    'POST /media/{}/deposit': {
      server: 'api',
      counter: true,
      path: () => `${unknownMedia()}/deposit`,
    },
    'POST /media/{}/deposit/refund': {
      server: 'api',
      counter: true,
      path: () => `${unknownMedia()}/deposit/refund`,
    },
    'POST /media/{}/release': {
      server: 'api',
      counter: true,
      path: () => `${unknownMedia()}/release`,
    },
    'POST /media/{}/reassignment': {
      server: 'api',
      counter: true,
      path: () => `${unknownMedia()}/reassignment`,
    },
    'POST /media/{}/replace': {
      server: 'api',
      counter: true,
      path: () => `${unknownMedia()}/replace`,
    },
    'POST /media/{}/cash-due-refunds': {
      server: 'api',
      counter: true,
      path: () => `${unknownMedia()}/cash-due-refunds`,
    },
    'POST /media/claims/confirmations': {
      server: 'api',
      counter: true,
      path: () => '/media/claims/confirmations',
    },
  };
  /** Contexte des cas du registre : lu à l'appel, après le `beforeAll`. */
  const ctx: CaseContext = {
    get w() {
      return w;
    },
    get terminal() {
      return terminal;
    },
    get media() {
      return media;
    },
    get api() {
      return api;
    },
    get keys() {
      return keys;
    },
    next,
    seqKey: (t) => t.seqKey(),
  };
  const registry = loadCases(BASE_CASES, ctx);
  const CASES = registry.cases;
  const ROUTES = Object.keys(CASES);

  /** API publique, pour le rafraîchissement (certificat client seul). */
  const publicServer = () => ({ baseUrl: api.baseUrl, serverCaPem: api.tls.serverCaPem });
  const serverOf = (route: string): HttpsTestApp => (CASES[route]!.server === 'api' ? api : keys);
  const methodOf = (route: string) => route.split(' ')[0] as RouteMethod;

  /** Requête de `who` sur la route ; route de guichet : jeton du caissier (sauf `staff: null`). */
  const prepare = (
    route: string,
    who: TestTerminal,
    proofs: ProofOptions = {},
    staff: string | null = w.cashierA.token,
  ): PreparedRequest => {
    const c = CASES[route]!;
    const method = methodOf(route);
    const headers: Record<string, string | null> = {};
    if (c.counter && staff !== null) headers['x-staff-authorization'] = `Bearer ${staff}`;
    return who.prepare(
      serverOf(route).baseUrl,
      {
        method,
        path: c.path(),
        body: c.body?.() ?? (BODY_METHODS.has(method) ? {} : undefined),
        idempotencyKey: WRITE_METHODS.has(method)
          ? (c.idempotencyKey?.(ctx, who) ?? randomUUID())
          : undefined,
      },
      { ...proofs, headers: { ...c.headers?.(ctx, who), ...headers, ...proofs.headers } },
    );
  };
  const sendTo = (route: string, prepared: PreparedRequest): Promise<TerminalResponse> =>
    send(prepared, serverOf(route).tls.serverCaPem);
  const call = (route: string, who: TestTerminal, proofs: ProofOptions = {}) =>
    sendTo(route, prepare(route, who, proofs));

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
    expiredToken = (
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
    certificates = await refusedCertificates(terminal, {
      certPem: api.tls.deviceCaCertPem,
      keyPem: api.tls.deviceCaKeyPem,
    });
    // Amorçage propre à certains cas du registre (ex. session de vendeur).
    for (const route of ROUTES) await CASES[route]!.prepare?.(ctx);
  }, 120_000);

  afterAll(async () => {
    await api?.close();
    await keys?.close();
  });

  it('routes : contrat × processus, chaque route de terminal a son cas (OP-N70)', () => {
    for (const app of [api.app, keys.app])
      expect(app.get(DEVICE_IDENTITY, { strict: false })).toBeInstanceOf(RealDeviceIdentity);
    const contract = contractDeviceOperations();
    const threeProofs = contract.filter((op) =>
      op.security.some((schemes) => THREE_PROOFS.every((s) => schemes.includes(s))),
    );
    const guarded = new Map<string, { server: 'api' | 'keys'; controller: string }>();
    const exclusive = new Set<string>();
    for (const [server, app] of [
      ['api', api.app],
      ['keys', keys.app],
    ] as const) {
      for (const [route, controller] of guardedRoutes(app, DeviceGuard))
        guarded.set(route, { server, controller });
      for (const guard of [DeviceOrCallerGuard, TerminalOrPersonGuard])
        for (const [route, controller] of guardedRoutes(app, guard)) {
          guarded.set(route, { server, controller });
          exclusive.add(route);
        }
    }
    // Garde exclusive (A13) : exactement les cas marqués `exclusive`.
    expect([...exclusive].sort()).toEqual(ROUTES.filter((r) => CASES[r]!.exclusive).sort());
    // Non vide : la lecture des métadonnées marche (sinon les contrôles suivants seraient vides).
    expect(guarded.size).toBeGreaterThanOrEqual(ROUTES.length);
    // Chaque route gardée est au contrat avec les trois preuves.
    expect([...guarded.keys()].filter((r) => !threeProofs.some((op) => op.key === r))).toEqual([]);
    // Chaque route gardée a son cas, sur le processus qui la sert ; chaque cas est gardé.
    expect(
      [...guarded]
        .filter(([route, g]) => CASES[route]?.server !== g.server)
        .map(([route, g]) => `${route} (${g.controller}, ${g.server})`),
    ).toEqual([]);
    expect(ROUTES.filter((route) => !guarded.has(route))).toEqual([]);
    // Seule route du contrat à preuve de terminal partielle : le rafraîchissement (certificat).
    expect(contract.filter((op) => !threeProofs.includes(op)).map((op) => op.key)).toEqual([
      REFRESH_ROUTE,
    ]);
    // Contrôleurs de terminal : ceux de la mission 4 (src/media) et la configuration et le
    // battement de cœur (mission 5a) ; chacun a au moins une route gardée, donc un cas.
    // Lots de la mission 5b : leurs contrôleurs viennent des fichiers du registre.
    expect(new Set([...guarded.values()].map((g) => g.controller))).toEqual(
      new Set([...BASE_CONTROLLERS, ...registry.controllers]),
    );
  });

  // Mission 6, lot WP08 (relecture de WP01) : sens contrat → garde. Chaque opération de terminal des sessions
  // de caisse nommée au contrat est servie SOUS une garde de terminal, avec son cas dans le registre.
  it('contrat → garde : les opérations de session de caisse sont gardées et ont un cas', () => {
    const operations = contractDeviceOperations().filter((op) =>
      ['openCashSession', 'countCashSession', 'closeCashSession', 'getCashSession'].includes(
        op.operationId,
      ),
    );
    expect(operations.map((op) => op.operationId).sort()).toEqual([
      'closeCashSession',
      'countCashSession',
      'getCashSession',
      'openCashSession',
    ]);
    const guards = [DeviceGuard, DeviceOrCallerGuard, TerminalOrPersonGuard];
    const guarded = new Set(guards.flatMap((g) => [...guardedRoutes(api.app, g).keys()]));
    expect(operations.filter((op) => !guarded.has(op.key)).map((op) => op.key)).toEqual([]);
    expect(operations.filter((op) => !(op.key in CASES)).map((op) => op.key)).toEqual([]);
  });

  it('routes du contrat non servies : 404 sur les deux processus, aucun nonce', async () => {
    const pending = contractDeviceOperations().filter(
      (op) => !(op.key in CASES) && op.key !== REFRESH_ROUTE,
    );
    const before = await noncesOf(terminal.deviceId);
    const served: string[] = [];
    for (const op of pending)
      for (const server of [api, keys]) {
        const path = op.path.replace(/\{[^}]+\}/g, () => randomUUID());
        const method = op.method as RouteMethod;
        const res = await terminal.request(
          server.baseUrl,
          server.tls.serverCaPem,
          {
            method,
            path,
            body: BODY_METHODS.has(method) ? {} : undefined,
            idempotencyKey: WRITE_METHODS.has(method) ? randomUUID() : undefined,
          },
          { headers: { 'x-staff-authorization': `Bearer ${w.cashierA.token}` } },
        );
        // Une route du contrat servie sans la garde des terminaux répondrait autre chose
        // (401 de la garde des personnes, 2xx…) : elle doit recevoir un cas ci-dessus.
        if (res.status !== 404) served.push(`${op.key} : ${res.status}`);
      }
    expect(served).toEqual([]);
    expect(await noncesOf(terminal.deviceId)).toBe(before);
  });

  it('trois preuves : chaque route servie par l’identité réelle, un nonce consommé', async () => {
    const wrong: string[] = [];
    for (const route of ROUTES) {
      const before = await noncesOf(terminal.deviceId);
      const res = await call(route, terminal);
      const consumed = (await noncesOf(terminal.deviceId)) - before;
      const expected = CASES[route]!.ok;
      const accepted =
        expected === undefined ? res.status !== 401 && res.status < 500 : res.status === expected;
      if (!accepted || consumed !== 1)
        wrong.push(`${route} : ${res.status} ${String(res.body.code)}, ${consumed} nonce(s)`);
    }
    expect(wrong).toEqual([]);
  });

  const variants = (): Variant[] => {
    const UNAUTH: [number, string] = [401, 'UNAUTHENTICATED'];
    const SIG: [number, string] = [401, 'DEVICE_SIGNATURE_INVALID'];
    const withCert = (route: string, pem: string) => {
      const p = prepare(route, terminal);
      p.cert = pem;
      return p;
    };
    return [
      {
        name: 'certificat absent',
        expected: UNAUTH,
        build: (r) => prepare(r, terminal, { certificate: 'none' }),
      },
      {
        name: 'certificat d’un autre terminal',
        expected: UNAUTH,
        build: (r) => prepare(r, terminal, { certificate: other }),
      },
      {
        name: 'certificat expiré (même clé, même autorité)',
        expected: UNAUTH,
        build: (r) => withCert(r, certificates.expired),
      },
      {
        name: 'certificat hors de l’autorité des terminaux',
        expected: UNAUTH,
        build: (r) => withCert(r, certificates.foreign),
      },
      {
        name: 'jeton absent',
        expected: UNAUTH,
        build: (r) => prepare(r, terminal, { token: null }),
      },
      {
        name: 'jeton d’un autre terminal',
        expected: UNAUTH,
        build: (r) => prepare(r, terminal, { token: other.token }),
      },
      {
        name: 'jeton expiré',
        expected: UNAUTH,
        build: (r) => prepare(r, terminal, { token: expiredToken }),
      },
      {
        name: 'jeton falsifié',
        expected: UNAUTH,
        build: (r) => prepare(r, terminal, { token: `${terminal.token.slice(0, -4)}AAAA` }),
      },
      {
        name: 'jeton d’une personne à la place du jeton d’appareil',
        expected: [401, null],
        build: (r) => prepare(r, terminal, { token: w.cashierA.token }),
      },
      {
        name: 'signature absente',
        expected: SIG,
        build: (r) => prepare(r, terminal, { signature: 'none' }),
      },
      {
        name: 'signature d’un autre terminal',
        expected: SIG,
        build: (r) => prepare(r, terminal, { signature: { privateKey: other.signing.privateKey } }),
      },
      {
        name: 'signée pour une autre autorité',
        expected: SIG,
        build: (r) => prepare(r, terminal, { signedAuthority: 'edge.cashless.example' }),
      },
      {
        name: 'chaîne de requête ajoutée après la signature',
        expected: SIG,
        build: (r) => {
          const p = prepare(r, terminal);
          p.url.search = '?ajout=1';
          return p;
        },
      },
      {
        name: 'corps changé après la signature',
        expected: SIG,
        bodyOnly: true,
        build: (r) => prepare(r, terminal, { sentBody: '{"x":1}' }),
      },
      {
        name: 'horloge hors tolérance (une heure)',
        expected: [400, 'CLOCK_SKEW_TOO_LARGE'],
        build: (r) => prepare(r, terminal, { created: Math.floor(Date.now() / 1000) - 3600 }),
      },
      {
        name: 'en-têtes du faux de la mission 4, sans preuve',
        expected: UNAUTH,
        build: (r) =>
          prepare(r, terminal, {
            certificate: 'none',
            token: null,
            signature: 'none',
            headers: { 'x-test-device-id': terminal.deviceId, 'x-test-operator-id': w.ops.a },
          }),
      },
    ];
  };

  it('preuve absente, fausse, expirée ou d’un autre terminal : refusée, sans nonce', async () => {
    const wrong: string[] = [];
    const before = await noncesOf(terminal.deviceId);
    const othersBefore = await noncesOf(other.deviceId);
    for (const route of ROUTES)
      for (const variant of variants()) {
        if (variant.bodyOnly && !BODY_METHODS.has(methodOf(route))) continue;
        const res = await sendTo(route, variant.build(route));
        const [status, code] = variant.expected;
        if (res.status !== status || (code !== null && res.body.code !== code))
          wrong.push(`${route} / ${variant.name} : ${res.status} ${String(res.body.code)}`);
      }
    expect(wrong).toEqual([]);
    expect(await noncesOf(terminal.deviceId)).toBe(before);
    expect(await noncesOf(other.deviceId)).toBe(othersBefore);
  });

  it('le refus ne dit pas quelle preuve a échoué : un seul corps par code', async () => {
    const route = 'POST /taps';
    const bodies = new Map<string, Set<string>>();
    for (const variant of variants()) {
      const res = await sendTo(route, variant.build(route));
      const { instance: _instance, ...problem } = res.body;
      const code = String(res.body.code);
      bodies.set(code, (bodies.get(code) ?? new Set()).add(JSON.stringify(problem)));
    }
    expect([...bodies.entries()].map(([code, set]) => [code, set.size])).toEqual(
      [...bodies.keys()].map((code) => [code, 1]),
    );
  });

  it('X-Staff-Authorization : exigé au guichet, refusé ailleurs', async () => {
    const wrong: string[] = [];
    const before = await noncesOf(terminal.deviceId);
    for (const route of ROUTES) {
      const res = CASES[route]!.counter
        ? await sendTo(route, prepare(route, terminal, {}, null))
        : await call(route, terminal, {
            headers: { 'x-staff-authorization': `Bearer ${w.cashierA.token}` },
          });
      if (res.status !== 401 || res.body.code !== 'UNAUTHENTICATED')
        wrong.push(`${route} : ${res.status} ${String(res.body.code)}`);
    }
    expect(wrong).toEqual([]);
    expect(await noncesOf(terminal.deviceId)).toBe(before);
  });

  it('NFR-004 : rejeu exact d’une requête acceptée, refusé sur chaque route', async () => {
    const wrong: string[] = [];
    for (const route of ROUTES) {
      const prepared = prepare(route, terminal);
      const first = await sendTo(route, prepared);
      const replay = await sendTo(route, prepared);
      if (
        first.status === 401 ||
        replay.status !== 401 ||
        replay.body.code !== 'DEVICE_SIGNATURE_INVALID'
      )
        wrong.push(`${route} : ${first.status} puis ${replay.status} ${String(replay.body.code)}`);
    }
    expect(wrong).toEqual([]);
  });

  it('R-14 : suspendu, servi sur la configuration et le battement de cœur seulement', async () => {
    const t = await enrolled();
    await withOwner((db) => t.setStatus(db, 'SUSPENDED'));
    const wrong: string[] = [];
    for (const route of ROUTES) {
      const res = await call(route, t);
      const ok = ALLOW_SUSPENDED.has(route)
        ? res.status === 200
        : res.status === 403 && res.body.code === 'DEVICE_SUSPENDED';
      if (!ok) wrong.push(`${route} : ${res.status} ${String(res.body.code)}`);
    }
    const res = await refresh(publicServer(), t);
    if (res.status !== 403 || res.body.code !== 'DEVICE_SUSPENDED')
      wrong.push(`${REFRESH_ROUTE} : ${res.status} ${String(res.body.code)}`);
    expect(wrong).toEqual([]);
  });

  it('NFR-003, ADR-115 : révoqué, 403 partout ; preuve fausse, 401 ; rien écrit', async () => {
    const t = await enrolled();
    expect((await call('GET /device/config', t)).status).toBe(200);
    // Révocation entre deux requêtes, jeton d'appareil encore valide (fonction de la base).
    await withOwner((db) => t.setStatus(db, 'REVOKED'));
    const before = await noncesOf(t.deviceId);
    const wrong: string[] = [];
    for (const route of ROUTES) {
      const valid = await call(route, t);
      if (valid.status !== 403 || valid.body.code !== 'DEVICE_REVOKED')
        wrong.push(`${route} / preuves valides : ${valid.status} ${String(valid.body.code)}`);
      const forged = await call(route, t, { signature: { privateKey: other.signing.privateKey } });
      if (forged.status !== 401)
        wrong.push(`${route} / signature fausse : ${forged.status} ${String(forged.body.code)}`);
      const foreign = await call(route, t, { certificate: other });
      if (foreign.status !== 401)
        wrong.push(`${route} / certificat d’un autre : ${foreign.status}`);
    }
    const res = await refresh(publicServer(), t);
    if (res.status !== 403 || res.body.code !== 'DEVICE_REVOKED')
      wrong.push(`${REFRESH_ROUTE} : ${res.status} ${String(res.body.code)}`);
    expect(wrong).toEqual([]);
    expect(await noncesOf(t.deviceId)).toBe(before);
  });

  it('borne iOS (OP-N64) : seule /media/auth-keys refuse un terminal iOS', async () => {
    const ios = await enrolled('IOS');
    const res = await call('POST /media/auth-keys', ios);
    expect([res.status, res.body.code]).toEqual([422, 'DEVICE_MODE_NOT_ALLOWED']);
    expect(res.body.enc).toBeUndefined();
    expect((await call('POST /taps', ios)).status).toBe(200);
    expect((await call('GET /device/config', ios)).status).toBe(200);
  });

  it('rafraîchissement : accepté, puis chaque preuve fausse refusée', async () => {
    const t = await enrolled();
    const third = await enrolled();
    adoptRefresh(t, await refresh(publicServer(), t));
    const refusals: Array<[string, Parameters<typeof refresh>[2]]> = [
      ['certificat absent', { certificate: 'none' }],
      ['certificat d’un autre terminal', { certificate: third }],
      ['preuve signée par une autre clé', { signingKey: third.signing.privateKey }],
      ['jeton inconnu', { token: `drt_${'A'.repeat(43)}` }],
    ];
    const wrong: string[] = [];
    for (const [name, options] of refusals) {
      const res = await refresh(publicServer(), t, options);
      if (res.status !== 401 || res.body.code !== 'REFRESH_TOKEN_INVALID')
        wrong.push(`${name} : ${res.status} ${String(res.body.code)}`);
    }
    expect(wrong).toEqual([]);
    // Rejeu exact d'un échange accepté : refusé, sans révoquer la famille.
    const prepared = prepareRefresh(publicServer(), t);
    const first = await send(prepared, api.tls.serverCaPem);
    expect(first.status).toBe(200);
    const replay = await send(prepared, api.tls.serverCaPem);
    expect([replay.status, replay.body.code]).toEqual([401, 'REFRESH_TOKEN_INVALID']);
    adoptRefresh(t, first);
    expect((await call('GET /device/config', t)).status).toBe(200);
    expect((await call('GET /device/config', third)).status).toBe(200);
  });
});
