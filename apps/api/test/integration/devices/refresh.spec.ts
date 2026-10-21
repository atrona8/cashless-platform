// Rafraîchissement des jetons d'appareil en HTTPS (contracts/device-tokens.md, lot WP15, T074 ;
// FR-010, FR-011, NFR-008 ; OP-N65, ADR-108 ; ADR-115). Terminaux de test enrôlés par les fonctions
// de la base (`TestTerminal.enroll`, propriétaire : aucune trace d'enrôlement par la route), statut
// changé par `set_device_status` (la route de révocation du back-office, lot WP16, n'est pas dans
// les dépendances de ce lot ; elle appelle la même fonction).
//
// Ordre contrôlé, jamais une course au hasard (NFR-008 précisé par le porteur le 20/10/2026) : la
// rotation du premier rafraîchissement est TENUE ouverte (signature du jeton d'appareil, faite dans
// la transaction de l'échange, suspendue par le test) pendant que les 19 autres partent ; le test
// vérifie dans `pg_locks` que le verrou de famille est tenu. Tests à deux connexions du verrou de
// famille (report de la relecture de WP04) : sessions `cashless_app`, l'une tient l'échange ouvert.
import 'reflect-metadata';
import { randomBytes, randomUUID, sign, type KeyObject } from 'node:crypto';
import type { Client } from 'pg';
import { FakeDeviceCa } from '../../../src/device-ca/fake-device-ca';
import { DeviceTokenService } from '../../../src/device-tokens/device-token.service';
import type { TokenSignerPort } from '../../../src/device-tokens/token-signer.port';
import { refreshTokenHash } from '../../../src/devices/enrollment/refresh-token';
import { refreshProofMessage } from '../../../src/devices/tokens/refresh.dto';
import { TOKEN_SIGNER } from '../../../src/security/port-tokens';
import { startHttpsApp, type HttpsTestApp } from '../../support/app';
import { APP_URL, connect, withOwner } from '../../support/db';
import { createMediaWorld, ownerRows, type MediaWorld } from '../../support/media-fixtures';
import { send, TestTerminal, type TerminalResponse } from '../../support/test-terminal';

/** Options d'une requête de rafraîchissement : chaque preuve peut être retirée ou faussée. */
interface RefreshOptions {
  /** Jeton de rafraîchissement présenté (défaut : le sien). */
  token?: string;
  /** Certificat client : le sien, aucun, ou celui d'un autre terminal (avec sa clé TLS). */
  certificate?: 'own' | 'none' | TestTerminal;
  /** `serial` envoyé (défaut : le sien). */
  serial?: string;
  nonce?: string;
  /** Clé qui signe la preuve (défaut : la sienne). */
  signingKey?: KeyObject;
  /** Message signé à la place de celui du contrat. */
  message?: Buffer;
  /** Format de la signature (défaut : `ieee-p1363`). */
  dsaEncoding?: 'ieee-p1363' | 'der';
}

interface TokenRow {
  token_hash: Buffer;
  consumed_at: Date | null;
  revoked_at: Date | null;
  revoked_reason: string | null;
  grace_used_at: Date | null;
}

const PENDING_LIMIT_MS = 10_000;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('rafraîchissement des jetons d’appareil (T071 à T074)', () => {
  let w: MediaWorld;
  let api: HttpsTestApp;
  let ca: FakeDeviceCa;
  let tokens: DeviceTokenService;
  let signer: TokenSignerPort;
  let eventB: string;

  const enrolled = async (
    status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED' = 'ACTIVE',
    operatorId: string = w.ops.a,
    eventId: string = w.ids.eventA,
  ): Promise<TestTerminal> => {
    const t = await withOwner((db) =>
      new TestTerminal().enroll(db, { operatorId, eventId, ca, status }),
    );
    if (status === 'ACTIVE') await t.issueToken(tokens);
    return t;
  };

  const body = (t: TestTerminal, options: RefreshOptions = {}) => {
    const token = options.token ?? t.refreshToken;
    const serial = options.serial ?? t.serial;
    const nonce = options.nonce ?? randomBytes(16).toString('base64url');
    const message = options.message ?? refreshProofMessage(nonce, serial, token);
    const signature = sign('sha256', message, {
      key: options.signingKey ?? t.signing.privateKey,
      dsaEncoding: options.dsaEncoding ?? 'ieee-p1363',
    });
    return { serial, refresh_token: token, nonce, signature: signature.toString('base64') };
  };

  /** `X-Request-Id` du dernier échange envoyé : l'audit `DEVICE_TOKEN_REUSE` doit le porter. */
  let lastRequestId = '';
  const post = (t: TestTerminal, payload: unknown, certificate: RefreshOptions['certificate']) => {
    const holder =
      certificate === 'none' ? null : certificate instanceof TestTerminal ? certificate : t;
    lastRequestId = randomUUID();
    return send(
      {
        url: new URL(`${api.baseUrl}/device-tokens/refresh`),
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-request-id': lastRequestId },
        body: JSON.stringify(payload),
        cert: holder?.certificatePem ?? null,
        key: holder ? holder.signingPrivatePem : null,
      },
      api.tls.serverCaPem,
    );
  };

  const refresh = (t: TestTerminal, options: RefreshOptions = {}) =>
    post(t, body(t, options), options.certificate);

  /** Adopte la paire reçue (comme l'app du terminal). */
  const adopt = (t: TestTerminal, res: TerminalResponse) => {
    expect(res.status).toBe(200);
    t.refreshToken = String(res.body.refresh_token);
    t.token = String(res.body.access_token);
  };

  /** Requête de terminal gardée (`POST /taps`, corps vide) : 400 si les trois preuves passent. */
  const guarded = async (t: TestTerminal) =>
    (await t.request(api.baseUrl, api.tls.serverCaPem, { method: 'POST', path: '/taps', body: {} }))
      .status;

  const tokenRow = async (token: string) =>
    (
      await ownerRows<TokenRow>(
        `SELECT token_hash, consumed_at, revoked_at, revoked_reason, grace_used_at
           FROM device_refresh_token WHERE token_hash = $1`,
        [refreshTokenHash(token)],
      )
    )[0];
  const familyRows = (t: TestTerminal) =>
    ownerRows<TokenRow>(
      `SELECT token_hash, consumed_at, revoked_at, revoked_reason, grace_used_at
         FROM device_refresh_token WHERE device_id = $1 AND family_id = $2 ORDER BY created_at`,
      [t.deviceId, t.familyId],
    );
  const liveCount = async (t: TestTerminal) =>
    (await familyRows(t)).filter((r) => !r.consumed_at && !r.revoked_at).length;
  const nonceCount = async (t: TestTerminal) =>
    (
      await ownerRows<{ n: number }>(
        'SELECT count(*)::int AS n FROM device_request_nonce WHERE device_id = $1',
        [t.deviceId],
      )
    )[0]!.n;
  const reuseAudits = (t: TestTerminal) =>
    ownerRows<{
      operator_id: string;
      origin: string;
      request_id: string | null;
      after: Record<string, unknown>;
    }>(
      `SELECT operator_id, origin, request_id, after FROM audit_log
        WHERE action = 'DEVICE_TOKEN_REUSE' AND object_id = $1`,
      [t.deviceId],
    );
  const claimsOf = (jwt: string) =>
    JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;

  beforeAll(async () => {
    w = await createMediaWorld();
    api = await startHttpsApp(undefined, { identity: w.idp });
    ca = await FakeDeviceCa.fromFiles({
      certFile: api.tls.deviceCaCertFile,
      keyFile: api.tls.deviceCaFakeKeyFile,
    });
    tokens = api.app.get(DeviceTokenService, { strict: false });
    signer = api.app.get<TokenSignerPort>(TOKEN_SIGNER, { strict: false });
    eventB = randomUUID();
    await withOwner((db) =>
      db.query(
        `INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone,
                            jurisdiction_id, funds_holder)
         SELECT $1, $2, $3, 'Événement B', currency, timezone, jurisdiction_id, funds_holder
           FROM event WHERE id = $4`,
        [eventB, w.ops.b, w.ids.organizerB, w.ids.eventA],
      ),
    );
  }, 60_000);

  afterAll(async () => {
    await api?.close();
  });

  afterEach(() => jest.restoreAllMocks());

  // ----- T071, T073 : rotation -----

  it('rotation : nouvelle paire de la même famille, ancien jeton consommé', async () => {
    const t = await enrolled();
    const old = t.refreshToken;
    const res = await refresh(t);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual([
      'access_token',
      'expires_in',
      'refresh_token',
      'token_type',
    ]);
    expect(res.body.token_type).toBe('Bearer');
    expect(res.body.expires_in).toBe(900);
    expect(String(res.body.refresh_token)).toMatch(/^drt_[A-Za-z0-9_-]{43}$/);
    const claims = claimsOf(String(res.body.access_token));
    expect([claims.sub, claims.fid, claims.operator_id, claims.serial]).toEqual([
      t.deviceId,
      t.familyId,
      w.ops.a,
      t.serial,
    ]);
    adopt(t, res);
    expect((await tokenRow(old))!.consumed_at).not.toBeNull();
    expect(await liveCount(t)).toBe(1);
    // Le nouveau jeton d'appareil passe la garde (400 : corps de tap vide), et le nouveau jeton de
    // rafraîchissement s'échange à son tour.
    expect(await guarded(t)).toBe(400);
    expect((await refresh(t)).status).toBe(200);
    // Aucune ligne d'audit de réutilisation.
    expect(await reuseAudits(t)).toEqual([]);
  });

  // ----- OP-N65, ADR-108 : grâce et ses bornes -----

  it('réponse perdue : représentation sous 60 s → nouvelle paire, successeur refusé', async () => {
    const t = await enrolled();
    const old = t.refreshToken;
    const lost = await refresh(t);
    expect(lost.status).toBe(200);
    const again = await refresh(t, { token: old });
    expect(again.status).toBe(200);
    expect(again.body.refresh_token).not.toBe(lost.body.refresh_token);
    expect((await tokenRow(old))!.grace_used_at).not.toBeNull();
    expect((await tokenRow(String(lost.body.refresh_token)))!.revoked_reason).toBe(
      'GRACE_REPLACED',
    );
    // Successeur perdu : refusé, sans révoquer la famille.
    const stale = await refresh(t, { token: String(lost.body.refresh_token) });
    expect([stale.status, stale.body.code]).toEqual([401, 'REFRESH_TOKEN_INVALID']);
    expect(await liveCount(t)).toBe(1);
    adopt(t, again);
    expect(await guarded(t)).toBe(400);
    expect((await refresh(t)).status).toBe(200);
    expect(await reuseAudits(t)).toEqual([]);
  });

  /** Borne d'OP-N65 : famille révoquée, audit écrit, jeton d'appareil refusé ensuite. */
  const expectFamilyRevoked = async (t: TestTerminal, res: TerminalResponse, presenter = t) => {
    // Requête qui a présenté le jeton consommé (FR-025 : l'audit porte son `request_id`).
    const requestId = lastRequestId;
    expect(res.headers['x-request-id']).toBe(requestId);
    expect([res.status, res.body.code]).toEqual([401, 'REFRESH_TOKEN_INVALID']);
    expect(await liveCount(t)).toBe(0);
    expect((await familyRows(t)).some((r) => r.revoked_reason === 'REUSE')).toBe(true);
    const audits = await reuseAudits(t);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.operator_id).toBe(t.operatorId);
    expect(audits[0]!.origin).toBe(`device:${presenter.deviceId}`);
    expect(audits[0]!.request_id).toBe(requestId);
    expect(audits[0]!.after).toMatchObject({
      family_id: t.familyId,
      presented_by_device_id: presenter.deviceId,
    });
    expect(JSON.stringify(audits[0])).not.toContain(t.refreshToken);
    expect(await guarded(t)).toBe(401);
  };

  it('borne d’OP-N65 : seconde représentation → famille révoquée', async () => {
    const t = await enrolled();
    const old = t.refreshToken;
    adopt(t, await refresh(t));
    const grace = await refresh(t, { token: old });
    adopt(t, grace);
    expect(await guarded(t)).toBe(400);
    await expectFamilyRevoked(t, await refresh(t, { token: old }));
    // Le jeton de la famille révoquée ne s'échange plus (INVALID, aucune nouvelle ligne d'audit).
    const after = await refresh(t);
    expect(after.status).toBe(401);
    expect(await reuseAudits(t)).toHaveLength(1);
  });

  it('borne d’OP-N65 : représentation après 60 s → famille révoquée', async () => {
    const t = await enrolled();
    const old = t.refreshToken;
    adopt(t, await refresh(t));
    await withOwner((db) =>
      db.query(
        `UPDATE device_refresh_token SET consumed_at = now() - interval '61 seconds'
          WHERE token_hash = $1`,
        [refreshTokenHash(old)],
      ),
    );
    await expectFamilyRevoked(t, await refresh(t, { token: old }));
  });

  it('borne d’OP-N65 : jeton présenté par un autre terminal → famille révoquée', async () => {
    const victim = await enrolled();
    const thief = await enrolled();
    // Le voleur signe avec sa clé, présente son certificat et son serial : la preuve est la sienne,
    // le jeton est celui de la victime.
    const res = await refresh(thief, { token: victim.refreshToken });
    await expectFamilyRevoked(victim, res, thief);
    // La famille du voleur n'est pas touchée.
    expect(await liveCount(thief)).toBe(1);
  });

  it('jeton dans la grâce, autre certificat → famille révoquée (pas de grâce)', async () => {
    const victim = await enrolled();
    const thief = await enrolled();
    const old = victim.refreshToken;
    adopt(victim, await refresh(victim));
    await expectFamilyRevoked(victim, await refresh(thief, { token: old }), thief);
  });

  // ----- NFR-008 : échange tenu ouvert, ordre contrôlé -----

  it('NFR-008 : 20 échanges, le premier tenu ouvert → 1 succès, 19 × 409', async () => {
    const t = await enrolled();
    const old = t.refreshToken;
    let reached!: () => void;
    let release!: () => void;
    const atSignature = new Promise<void>((resolve) => (reached = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    const original = signer.sign.bind(signer);
    jest.spyOn(signer, 'sign').mockImplementationOnce(async (claims) => {
      reached();
      await gate;
      return original(claims);
    });
    const first = refresh(t);
    try {
      await Promise.race([
        atSignature,
        pause(PENDING_LIMIT_MS).then(() => {
          throw new Error('le premier échange n’a pas atteint la signature');
        }),
      ]);
      // L'échange du premier est validé en base mais pas encore commis : verrou de famille tenu.
      const locks = await ownerRows<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_locks
          WHERE locktype = 'advisory' AND granted
            AND (classid::bigint << 32 | objid::bigint) =
                hashtextextended('device-token-family:' || $1::text, 0)`,
        [t.familyId],
      );
      expect(locks[0]!.n).toBe(1);
      const others = await Promise.all(Array.from({ length: 19 }, () => refresh(t)));
      expect(others.map((r) => r.status)).toEqual(Array(19).fill(409));
      for (const r of others) {
        expect(r.body.code).toBe('CONFLICT_STATE');
        expect(r.body.retryable).toBe(true);
      }
      // Rien d'écrit par les 19 : l'ancien jeton est encore vivant pour les autres sessions.
      expect((await tokenRow(old))!.consumed_at).toBeNull();
    } finally {
      release();
    }
    const done = await first;
    expect(done.status).toBe(200);
    // Famille intacte : un seul jeton vivant (le successeur du premier), aucune réutilisation.
    const rows = await familyRows(t);
    expect(rows.filter((r) => r.revoked_at)).toEqual([]);
    expect(await liveCount(t)).toBe(1);
    expect(await reuseAudits(t)).toEqual([]);
    adopt(t, done);
    expect(await guarded(t)).toBe(400);
    // Le client qui a reçu 409 réessaie (nouveau nonce) : sous 60 s et avec le même certificat,
    // c'est la grâce d'ADR-108 (la paire du premier, jamais utilisée par lui, est remplacée).
    const retry = await refresh(t, { token: old });
    expect(retry.status).toBe(200);
    expect((await tokenRow(String(done.body.refresh_token)))!.revoked_reason).toBe(
      'GRACE_REPLACED',
    );
    expect(await liveCount(t)).toBe(1);
    expect(await reuseAudits(t)).toEqual([]);
  }, 30_000);

  // ----- Verrou de famille à deux connexions (report de la relecture de WP04) -----

  /** Session du rôle de l'API (`cashless_app`) sous le prestataire du terminal. */
  const appSession = async (t: TestTerminal): Promise<Client> => {
    const client = await connect(APP_URL);
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.operator_id', $1, true)", [t.operatorId]);
    return client;
  };
  const rotateSql = (client: Client, token: string, t: TestTerminal, next: string) =>
    client
      .query<{
        outcome: string;
      }>(
        `SELECT outcome FROM rotate_device_refresh_token($1, $2, $3, now() + interval '30 days')`,
        [refreshTokenHash(token), certSha256(t), refreshTokenHash(next)],
      )
      .then((r) => r.rows[0]!.outcome);
  /** Empreintes de certificat enregistrées à l'enrôlement, par terminal (`remember`). */
  const certs = new Map<string, Buffer>();
  const certSha256 = (t: TestTerminal) => certs.get(t.deviceId)!;
  const remember = async (t: TestTerminal) => {
    const rows = await ownerRows<{ cert_sha256: Buffer }>(
      'SELECT cert_sha256 FROM device WHERE id = $1',
      [t.deviceId],
    );
    certs.set(t.deviceId, rows[0]!.cert_sha256);
  };
  /** `t0` consommé, successeur `s` vivant (échange validé). */
  const consumedWithSuccessor = async (t: TestTerminal) => {
    await remember(t);
    const t0 = t.refreshToken;
    const s = `drt_${randomBytes(32).toString('base64url')}`;
    const c = await appSession(t);
    try {
      expect(await rotateSql(c, t0, t, s)).toBe('ROTATED');
      await c.query('COMMIT');
    } finally {
      await c.end();
    }
    return { t0, s };
  };
  const familyActive = async (t: TestTerminal) => {
    const c = await appSession(t);
    try {
      return (
        await c.query<{ active: boolean }>('SELECT device_token_family_active($1, $2) AS active', [
          t.deviceId,
          t.familyId,
        ])
      ).rows[0]!.active;
    } finally {
      await c.query('ROLLBACK');
      await c.end();
    }
  };

  it('deux connexions : échange tenu ouvert, ancien jeton → IN_PROGRESS puis REUSED', async () => {
    const t = await enrolled();
    const { t0, s } = await consumedWithSuccessor(t);
    const holder = await appSession(t);
    const other = await connect(APP_URL);
    try {
      expect(await rotateSql(holder, s, t, `drt_${randomUUID()}`)).toBe('ROTATED');
      // Pendant que l'échange de s est ouvert : t0 (dans la grâce) → IN_PROGRESS, rien d'écrit.
      await other.query('BEGIN');
      await other.query("SELECT set_config('app.operator_id', $1, true)", [t.operatorId]);
      const x = `drt_${randomUUID()}`;
      expect(await rotateSql(other, t0, t, x)).toBe('IN_PROGRESS');
      await other.query('COMMIT');
      expect(await tokenRow(x)).toBeUndefined();
      expect((await tokenRow(t0))!.grace_used_at).toBeNull();
      await holder.query('COMMIT');
      // Échange de s validé : t0 n'a plus de grâce (successeur utilisé) → réutilisation.
      await other.query('BEGIN');
      await other.query("SELECT set_config('app.operator_id', $1, true)", [t.operatorId]);
      expect(await rotateSql(other, t0, t, `drt_${randomUUID()}`)).toBe('REUSED');
      await other.query('COMMIT');
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      await other.query('ROLLBACK').catch(() => undefined);
      await holder.end();
      await other.end();
    }
    expect(await liveCount(t)).toBe(0);
    expect(await familyActive(t)).toBe(false);
  });

  it('deux connexions : la révocation attend l’échange et voit son successeur', async () => {
    const t = await enrolled();
    const { s } = await consumedWithSuccessor(t);
    const holder = await appSession(t);
    const revoker = await appSession(t);
    try {
      const s2 = `drt_${randomUUID()}`;
      expect(await rotateSql(holder, s, t, s2)).toBe('ROTATED');
      const pending = revoker.query<{ n: number }>(
        "SELECT revoke_device_token_family($1, $2, 'REUSE') AS n",
        [t.deviceId, t.familyId],
      );
      pending.catch(() => undefined);
      // La révocation attend le verrou de famille (ordre contrôlé, pas une course).
      for (let waited = 0; ; waited += 20) {
        const rows = await ownerRows<{ n: number }>(
          `SELECT count(*)::int AS n FROM pg_stat_activity
            WHERE usename = 'cashless_app' AND wait_event_type = 'Lock'
              AND position('revoke_device_token_family' in query) > 0`,
        );
        if (rows[0]!.n > 0) break;
        if (waited >= PENDING_LIMIT_MS) throw new Error('la révocation n’attend pas le verrou');
        await pause(20);
      }
      await holder.query('COMMIT');
      const revoked = (await pending).rows[0]!.n;
      await revoker.query('COMMIT');
      expect(revoked).toBeGreaterThanOrEqual(1);
      expect((await tokenRow(s2))!.revoked_reason).toBe('REUSE');
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      await revoker.query('ROLLBACK').catch(() => undefined);
      await holder.end();
      await revoker.end();
    }
    expect(await liveCount(t)).toBe(0);
    expect(await familyActive(t)).toBe(false);
  });

  it('REPEATABLE READ : échange refusé (25000), rien n’est écrit', async () => {
    const t = await enrolled();
    await remember(t);
    const c = await connect(APP_URL);
    try {
      await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      await c.query("SELECT set_config('app.operator_id', $1, true)", [t.operatorId]);
      const next = `drt_${randomUUID()}`;
      await expect(rotateSql(c, t.refreshToken, t, next)).rejects.toMatchObject({ code: '25000' });
      await c.query('ROLLBACK');
      expect(await tokenRow(next)).toBeUndefined();
    } finally {
      await c.query('ROLLBACK').catch(() => undefined);
      await c.end();
    }
    const row = (await tokenRow(t.refreshToken))!;
    expect([row.consumed_at, row.revoked_at]).toEqual([null, null]);
  });

  // ----- T072 : preuve de possession -----

  /** Refus sans aucune écriture : jeton intact, aucun nonce, aucun audit. */
  const expectRefusedUntouched = async (t: TestTerminal, res: TerminalResponse) => {
    expect([res.status, res.body.code]).toEqual([401, 'REFRESH_TOKEN_INVALID']);
    const row = (await tokenRow(t.refreshToken))!;
    expect([row.consumed_at, row.revoked_at]).toEqual([null, null]);
    expect(await nonceCount(t)).toBe(0);
    expect(await reuseAudits(t)).toEqual([]);
  };

  it('preuve fausse, sans séparateur, mal encodée, autre serial ou certificat : 401', async () => {
    const t = await enrolled();
    const other = await enrolled();
    const nonce = randomBytes(16).toString('base64url');
    const cases: Array<[string, RefreshOptions]> = [
      ['signée par une autre clé', { signingKey: other.signing.privateKey }],
      [
        'sans séparateur',
        {
          nonce,
          message: Buffer.from(`cashless-refresh-v1${nonce}${t.serial}${t.refreshToken}`, 'utf8'),
        },
      ],
      [
        'autre domaine',
        {
          nonce,
          message: Buffer.concat([
            Buffer.from('cashless-request-v1\0', 'utf8'),
            refreshProofMessage(nonce, t.serial, t.refreshToken).subarray(20),
          ]),
        },
      ],
      ['signature DER', { dsaEncoding: 'der' }],
      ['sans certificat client', { certificate: 'none' }],
      ['certificat d’un autre terminal', { certificate: other }],
      ['serial d’un autre terminal', { serial: other.serial }],
    ];
    for (const [label, options] of cases) {
      const res = await refresh(t, options);
      expect([label, res.status]).toEqual([label, 401]);
      await expectRefusedUntouched(t, res);
    }
    // Le terminal légitime s'échange toujours, et l'autre n'a rien perdu.
    expect((await refresh(t)).status).toBe(200);
    expect(await liveCount(other)).toBe(1);
  });

  it('corps mal formé : 400, rien n’est écrit', async () => {
    const t = await enrolled();
    const good = body(t);
    for (const bad of [
      { ...good, nonce: 'court' },
      { ...good, nonce: `${'a'.repeat(16)}\u0000` },
      { ...good, serial: 'a\u0000b' },
      { ...good, signature: '***' },
      { serial: good.serial, nonce: good.nonce, signature: good.signature },
    ]) {
      const res = await post(t, bad, 'own');
      expect([res.status, res.body.code]).toEqual([400, 'VALIDATION_FAILED']);
    }
    const row = (await tokenRow(t.refreshToken))!;
    expect([row.consumed_at, row.revoked_at]).toEqual([null, null]);
    expect(await nonceCount(t)).toBe(0);
  });

  it('preuve rejouée : refusée par le nonce, sans révoquer la famille', async () => {
    const t = await enrolled();
    const payload = body(t);
    const first = await post(t, payload, 'own');
    expect(first.status).toBe(200);
    const replay = await post(t, payload, 'own');
    expect([replay.status, replay.body.code]).toEqual([401, 'REFRESH_TOKEN_INVALID']);
    // Le rejeu n'a pas atteint l'échange : pas de réutilisation, la nouvelle paire reste valable.
    expect(await reuseAudits(t)).toEqual([]);
    expect(await liveCount(t)).toBe(1);
    adopt(t, first);
    expect(await guarded(t)).toBe(400);
  });

  it('jeton inconnu ou expiré : 401, famille intacte', async () => {
    const t = await enrolled();
    const unknown = await refresh(t, { token: `drt_${randomBytes(32).toString('base64url')}` });
    expect([unknown.status, unknown.body.code]).toEqual([401, 'REFRESH_TOKEN_INVALID']);
    await withOwner((db) =>
      db.query(
        `UPDATE device_refresh_token
            SET created_at = now() - interval '31 days', expires_at = now() - interval '1 day'
          WHERE token_hash = $1`,
        [refreshTokenHash(t.refreshToken)],
      ),
    );
    const expired = await refresh(t);
    expect([expired.status, expired.body.code]).toEqual([401, 'REFRESH_TOKEN_INVALID']);
    expect((await tokenRow(t.refreshToken))!.consumed_at).toBeNull();
    expect(await reuseAudits(t)).toEqual([]);
  });

  // ----- Statut du terminal -----

  it('terminal suspendu : 403 DEVICE_SUSPENDED, jeton intact ; réactivé : 200', async () => {
    const t = await enrolled('SUSPENDED');
    const res = await refresh(t);
    expect([res.status, res.body.code]).toEqual([403, 'DEVICE_SUSPENDED']);
    const row = (await tokenRow(t.refreshToken))!;
    expect([row.consumed_at, row.revoked_at]).toEqual([null, null]);
    await withOwner((db) => t.setStatus(db, 'ACTIVE'));
    expect((await refresh(t)).status).toBe(200);
  });

  it('ADR-115 : révoqué, preuves valides → 403 ; preuve fausse → 401 ; rien d’écrit', async () => {
    const t = await enrolled();
    const other = await enrolled();
    await withOwner((db) => t.setStatus(db, 'REVOKED'));
    const before = await familyRows(t);
    const valid = await refresh(t);
    expect([valid.status, valid.body.code]).toEqual([403, 'DEVICE_REVOKED']);
    const refusals: Array<[string, RefreshOptions]> = [
      ['signée par une autre clé', { signingKey: other.signing.privateKey }],
      ['jeton inconnu', { token: `drt_${randomBytes(32).toString('base64url')}` }],
      ['jeton d’un autre terminal', { token: other.refreshToken }],
      ['sans certificat client', { certificate: 'none' }],
    ];
    for (const [label, options] of refusals) {
      const res = await refresh(t, options);
      expect([label, res.status, res.body.code]).toEqual([label, 401, 'REFRESH_TOKEN_INVALID']);
    }
    expect(await familyRows(t)).toEqual(before);
    expect(await nonceCount(t)).toBe(0);
    expect(await reuseAudits(t)).toEqual([]);
    expect(await liveCount(other)).toBe(1);
  });

  it('ADR-115 : jeton vivant à la révocation → 403, jeton déjà consommé → 401', async () => {
    const t = await enrolled();
    const old = t.refreshToken;
    adopt(t, await refresh(t));
    await withOwner((db) => t.setStatus(db, 'REVOKED'));
    const consumed = await refresh(t, { token: old });
    expect([consumed.status, consumed.body.code]).toEqual([401, 'REFRESH_TOKEN_INVALID']);
    const live = await refresh(t);
    expect([live.status, live.body.code]).toEqual([403, 'DEVICE_REVOKED']);
    expect(await reuseAudits(t)).toEqual([]);
  });

  // ----- Isolation à deux prestataires -----

  it('isolation : jeton de A présenté par B → inconnu, famille de A intacte', async () => {
    const a = await enrolled();
    const b = await enrolled('ACTIVE', w.ops.b, eventB);
    const res = await refresh(b, { token: a.refreshToken });
    expect([res.status, res.body.code]).toEqual([401, 'REFRESH_TOKEN_INVALID']);
    expect(res.text).not.toContain(a.deviceId);
    expect(await liveCount(a)).toBe(1);
    expect(await reuseAudits(a)).toEqual([]);
    expect((await refresh(a)).status).toBe(200);
    expect((await refresh(b)).status).toBe(200);
  });
});
