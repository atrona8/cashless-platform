// Enrôlement des terminaux en HTTPS (contracts/enrollment.md, lot WP14, T068 à T070) : terminal
// de test (WP12) et vérificateur d'attestation RÉEL (Android : WP10 ; iOS : WP11), avec les racines
// de test générées à l'exécution et une liste de révocation vide injectée (aucun réseau). Les
// étapes 1 à 8 ne consomment pas le code ; l'étape 9 est la seule écriture. Code inconnu, utilisé
// ou expiré : toujours le refus du code, jamais 409, même avec un `serial` actif (le contrôle du
// `serial` ne précède jamais celui du code, décision du porteur du 19/10/2026). Limites R-16, refus
// tracés hors de la transaction annulée, aucun secret en clair, NFR-006 (écart des médianes),
// isolation à deux prestataires, et refus de démarrer en production avec un faux d'attestation.
// ADR-117 : audit de chaque refus (chaîne du prestataire du code ou de la plateforme), limite par
// code pour tout code bien formé, limite par adresse sur les seuls refus, une seule trace au-delà.
// Isolation (constat N1 de la relecture) : chaque test enrôle depuis sa propre adresse
// (`X-Forwarded-For`, un répartiteur de confiance pour cette suite seulement) et n'emploie que des
// codes neufs ; la suite n'efface que les essais de ses propres codes, jamais toute la table.
import 'reflect-metadata';
import {
  createHash,
  createHmac,
  randomInt,
  randomUUID,
  webcrypto,
  X509Certificate,
} from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as x509 from '@peculiar/x509';
import { Test } from '@nestjs/testing';
import { createAttestationVerifier } from '../../../src/attestation/attestation.module';
import { FakeAttestation } from '../../../src/attestation/fake-attestation';
import { APP_CONFIG, loadConfig, type AppConfig } from '../../../src/config/config';
import {
  CUSTOMER_IDENTITY,
  type CustomerIdentityPort,
} from '../../../src/customer-identity/customer-identity.port';
import { FakeInProductionError } from '../../../src/kms/production-guard';
import { assertProcessIsSafe } from '../../../src/processes/bootstrap';
import { PublicProcessModule } from '../../../src/processes/public.module';
import { ATTESTATION_VERIFIER, DEVICE_CA, TOKEN_SIGNER } from '../../../src/security/port-tokens';
import { startHttpsApp, type HttpsTestApp } from '../../support/app';
import {
  createAndroidTestPki,
  TEST_ANDROID_PACKAGE,
  TEST_ANDROID_SIGNING_DIGEST,
  type AndroidTestPki,
} from '../../support/attestation/android';
import {
  createIosTestPki,
  TEST_IOS_BUNDLE_ID,
  TEST_IOS_TEAM_ID,
  type IosTestPki,
} from '../../support/attestation/ios';
import { withOwner } from '../../support/db';
import type { TestPerson } from '../../support/fake-idp';
import { createMediaWorld, ownerRows, type MediaWorld } from '../../support/media-fixtures';
import {
  createEnrollmentCode,
  postJson,
  TestTerminal,
  type EnrollmentBodyOptions,
  type RouteServer,
  type TerminalResponse,
} from '../../support/test-terminal';

x509.cryptoProvider.set(webcrypto as never);

const RESPONSE_KEYS = [
  'access_token',
  'certificate_pem',
  'device_id',
  'expires_in',
  'next_seq',
  'refresh_token',
  'serial',
  'server_time',
  'token_type',
];
const KM_ORIGIN_IMPORTED = 2;
const TIMING_TRIES = 200;
const MAX_MEDIAN_GAP_MS = 20;

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return (sorted[(sorted.length - 1) >> 1]! + sorted[sorted.length >> 1]!) / 2;
};
/** Corps d'un problème sans l'identifiant propre à la requête. */
const problemOf = (res: TerminalResponse) => {
  const { instance: _instance, ...body } = res.body;
  return body;
};
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
/** Code bien formé tiré au hasard (60 bits) : inconnu, et neuf pour les limites par code. */
const unknownCode = () => {
  let code = '';
  for (let i = 0; i < 12; i += 1) code += ALPHABET[randomInt(32)];
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;
};
/** Adresse propre à un test, dans 198.18.0.0/15 (réservé aux essais) : aucune autre suite. */
const testAddress = () => `198.${18 + randomInt(2)}.${randomInt(256)}.${randomInt(1, 255)}`;

describe('enrôlement des terminaux (T068 à T070)', () => {
  let w: MediaWorld;
  let api: HttpsTestApp;
  let server: RouteServer;
  let androidPki: AndroidTestPki;
  let iosPki: IosTestPki;
  let dir: string;
  let eventB: string;
  let operatorAdminB: TestPerson;
  let codeKey: Buffer;
  let address: string;

  const newCode = (
    body: Record<string, unknown> = {},
    who: TestPerson = w.operatorAdminA,
    eventId: string = w.ids.eventA,
  ) => createEnrollmentCode(server, who.token, { event_id: eventId, ...body });
  /** `POST /device-enrollments` depuis l'adresse du test (ou une autre). */
  const post = (body: unknown, from: string = address) =>
    postJson(server, '/device-enrollments', body, { 'x-forwarded-for': from });
  /** Comme `TestTerminal.enrollByRoute`, depuis l'adresse du test. */
  const enroll = async (
    terminal: TestTerminal,
    code: string,
    options: EnrollmentBodyOptions & { body?: Record<string, unknown> } = {},
  ) => {
    const body = {
      ...(await terminal.enrollmentBody(code, { androidPki, iosPki, ...options })),
      ...options.body,
    };
    const res = await post(body);
    if (res.status === 201) terminal.adopt(res.body);
    return res;
  };
  const codeRow = async (code: string) =>
    (
      await ownerRows<{ id: string; used_at: Date | null; device_id: string | null }>(
        'SELECT id, used_at, device_id FROM device_enrollment_code WHERE code_hash = $1',
        [hashOf(code)],
      )
    )[0]!;
  // Même empreinte que le serveur : HMAC-SHA256 du code normalisé, clé de la configuration de test.
  const hashOf = (code: string) =>
    createHmac('sha256', codeKey).update(code.replace(/-/g, '')).digest();
  const expire = (code: string) =>
    withOwner((db) =>
      db.query(
        `UPDATE device_enrollment_code
            SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour'
          WHERE code_hash = $1`,
        [hashOf(code)],
      ),
    );

  beforeAll(async () => {
    w = await createMediaWorld();
    androidPki = await createAndroidTestPki();
    iosPki = await createIosTestPki();
    dir = mkdtempSync(join(tmpdir(), 'cashless-enrollment-'));
    const androidRoots = join(dir, 'android.pem');
    const iosRoot = join(dir, 'ios.pem');
    writeFileSync(androidRoots, androidPki.rootPem);
    writeFileSync(iosRoot, iosPki.rootPem);
    const config = loadConfig();
    codeKey = config.enrollmentCodeHmacKey;
    expect(config.androidAppPackage).toBe(TEST_ANDROID_PACKAGE);
    expect(config.androidAppSigningDigests).toContain(TEST_ANDROID_SIGNING_DIGEST.toString('hex'));
    expect([config.iosTeamId, config.iosBundleId]).toEqual([TEST_IOS_TEAM_ID, TEST_IOS_BUNDLE_ID]);
    // Vérificateur réel ; les objets App Attest de test portent l'AAGUID de production.
    const verifier = createAttestationVerifier(
      {
        ...config,
        androidAttestationRoots: androidRoots,
        iosAppAttestRoot: iosRoot,
        iosAppAttestEnvironment: 'production',
      },
      { revocationSource: async () => ({ entries: {} }) },
    );
    expect(verifier.isFake).toBeUndefined();
    api = await startHttpsApp(undefined, {
      identity: w.idp,
      overrides: [{ provide: ATTESTATION_VERIFIER, useValue: verifier }],
      trustProxyHops: 1,
    });
    server = { baseUrl: api.baseUrl, serverCaPem: api.tls.serverCaPem };
    eventB = randomUUID();
    await withOwner(async (db) => {
      await db.query(
        `INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone,
                            jurisdiction_id, funds_holder)
         SELECT $1, $2, $3, 'Événement B', currency, timezone, jurisdiction_id, funds_holder
           FROM event WHERE id = $4`,
        [eventB, w.ops.b, w.ids.organizerB, w.ids.eventA],
      );
      operatorAdminB = await w.idp.createPerson(db, {
        operatorId: w.ops.b,
        roles: [{ role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: w.ops.b }],
      });
    });
  }, 60_000);

  beforeEach(() => {
    address = testAddress();
  });

  afterAll(async () => {
    await api?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('nominal Android : 201, certificat, jetons, terminal en base, code consommé', async () => {
    const code = await newCode();
    const terminal = new TestTerminal('ANDROID');
    const res = await enroll(terminal, code);
    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(RESPONSE_KEYS);
    expect(res.body).toMatchObject({
      serial: terminal.serial,
      token_type: 'Bearer',
      expires_in: 900,
      next_seq: 1,
    });
    expect(String(res.body.refresh_token)).toMatch(/^drt_[A-Za-z0-9_-]{43}$/);
    // Certificat : sujet imposé, clé de signature, borné par la validité de l'autorité de test.
    const cert = new X509Certificate(String(res.body.certificate_pem));
    expect(cert.subject).toBe(`CN=${terminal.deviceId}\nO=${w.ops.a}`);
    expect(
      cert.publicKey.export({ format: 'der', type: 'spki' }).equals(terminal.signing.spki),
    ).toBe(true);
    const authorityEnd = Date.parse(new X509Certificate(api.tls.deviceCaCertPem).validTo);
    expect(Date.parse(cert.validTo)).toBe(authorityEnd);
    const [device] = await ownerRows<{
      operator_id: string;
      event_id: string;
      status: string;
      public_key: Buffer;
      agreement_public_key: Buffer;
      cert_sha256: Buffer;
      attestation_kind: string;
      attestation_security_level: string;
      app_version: string;
    }>('SELECT * FROM device WHERE id = $1', [terminal.deviceId]);
    expect(device).toMatchObject({
      operator_id: w.ops.a,
      event_id: w.ids.eventA,
      status: 'ACTIVE',
      attestation_kind: 'ANDROID_KEY_ATTESTATION',
      attestation_security_level: 'TRUSTED_ENVIRONMENT',
      app_version: '1.0.0-test',
    });
    expect(device!.public_key.equals(terminal.signing.spki)).toBe(true);
    // Format unique de la clé d'accord : point de 65 octets tiré du SPKI reçu (et haché tel quel).
    expect(device!.agreement_public_key.equals(terminal.agreement.point)).toBe(true);
    expect(device!.agreement_public_key.equals(terminal.agreement.spki.subarray(26))).toBe(true);
    expect(device!.cert_sha256.equals(createHash('sha256').update(cert.raw).digest())).toBe(true);
    const used = await codeRow(code);
    expect(used.used_at).not.toBeNull();
    expect(used.device_id).toBe(terminal.deviceId);
    const [refresh] = await ownerRows<{ token_hash: Buffer; family_id: string }>(
      'SELECT token_hash, family_id FROM device_refresh_token WHERE device_id = $1',
      [terminal.deviceId],
    );
    expect(
      refresh!.token_hash.equals(createHash('sha256').update(terminal.refreshToken).digest()),
    ).toBe(true);
    expect(refresh!.family_id).toBe(terminal.familyId);
    const audit = await ownerRows<{ operator_id: string; after: Record<string, unknown> }>(
      `SELECT operator_id, after FROM audit_log
        WHERE action = 'DEVICE_ENROLLED' AND object_id = $1`,
      [terminal.deviceId],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]!.after).toMatchObject({
      enrollment_code_id: used.id,
      serial: terminal.serial,
      os: 'ANDROID',
      attestation_security_level: 'TRUSTED_ENVIRONMENT',
    });
    const [attempt] = await ownerRows<{ result: string; operator_id: string }>(
      'SELECT result, operator_id FROM device_enrollment_attempt WHERE code_hash = $1',
      [hashOf(code)],
    );
    expect(attempt).toEqual({ result: 'ENROLLED', operator_id: w.ops.a });
    // Les trois preuves reçues à l'enrôlement sont acceptées par la garde des terminaux : la
    // requête passe l'authentification et n'échoue que sur son corps.
    const tap = await terminal.request(api.baseUrl, api.tls.serverCaPem, {
      method: 'POST',
      path: '/taps',
      body: {},
    });
    expect([400, 422]).toContain(tap.status);
  });

  it('nominal iOS : App Attest réel, aucun niveau de sécurité', async () => {
    const terminal = new TestTerminal('IOS');
    const res = await enroll(terminal, await newCode());
    expect(res.status).toBe(201);
    const [device] = await ownerRows<{
      attestation_kind: string;
      attestation_security_level: null;
    }>(
      'SELECT attestation_kind, attestation_security_level, nfc_enabled FROM device WHERE id = $1',
      [terminal.deviceId],
    );
    expect(device).toEqual({
      attestation_kind: 'IOS_APP_ATTEST',
      attestation_security_level: null,
      nfc_enabled: false,
    });
  });

  it('code inconnu ou utilisé : même refus ; expiré : ENROLLMENT_CODE_EXPIRED', async () => {
    const used = await newCode();
    expect((await enroll(new TestTerminal(), used)).status).toBe(201);
    const unknown = await enroll(new TestTerminal(), unknownCode());
    const again = await enroll(new TestTerminal(), used);
    const malformed = await enroll(new TestTerminal(), 'pas un code');
    for (const res of [unknown, again, malformed]) {
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('ENROLLMENT_CODE_INVALID');
    }
    expect(problemOf(again)).toEqual(problemOf(unknown));
    expect(problemOf(malformed)).toEqual(problemOf(unknown));
    const expired = await newCode();
    await expire(expired);
    const res = await enroll(new TestTerminal(), expired);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('ENROLLMENT_CODE_EXPIRED');
    expect((await codeRow(expired)).used_at).toBeNull();
  });

  it('attestation refusée : 422, code encore utilisable, refus audité sans le code', async () => {
    const code = await newCode();
    const terminal = new TestTerminal();
    // Défi d'un autre code : la feuille n'atteste pas ce code.
    const refused = await enroll(terminal, code, { challengeCode: 'ABCDEFGHJKLM' });
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe('ATTESTATION_FAILED');
    expect(refused.text).not.toMatch(/défi|challenge/i);
    expect((await codeRow(code)).used_at).toBeNull();
    const audit = await ownerRows<{ operator_id: string; text: string; after: { result: string } }>(
      `SELECT operator_id, a::text AS text, after FROM audit_log a
        WHERE action = 'DEVICE_ENROLLMENT_REFUSED' AND after->>'serial' = $1`,
      [terminal.serial],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]!.operator_id).toBe(w.ops.a);
    expect(audit[0]!.after.result).toBe('ATTESTATION_FAILED');
    expect(audit[0]!.text).not.toContain(code.replace(/-/g, ''));
    expect(audit[0]!.text).not.toContain(hashOf(code).toString('hex'));
    const ok = await enroll(terminal, code);
    expect(ok.status).toBe(201);
  });

  it.each([
    ['Android 11 (attestationVersion < 100)', { attestationVersion: 4 }],
    ['clé importée (origin ≠ GENERATED)', { origin: KM_ORIGIN_IMPORTED }],
  ])('%s : 422 ATTESTATION_FAILED, code non consommé', async (_label, fields) => {
    const code = await newCode();
    const res = await enroll(new TestTerminal(), code, { fields });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('ATTESTATION_FAILED');
    expect((await codeRow(code)).used_at).toBeNull();
  });

  it('CSR : ECDSA-SHA1 refusé, clé autre que signing_public_key refusée', async () => {
    const code = await newCode();
    const terminal = new TestTerminal();
    const signing = {
      privateKey: await webcrypto.subtle.importKey(
        'pkcs8',
        terminal.signing.privateKey.export({ format: 'der', type: 'pkcs8' }),
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['sign'],
      ),
      publicKey: await webcrypto.subtle.importKey(
        'spki',
        terminal.signing.spki,
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['verify'],
      ),
    };
    const sha1 = await x509.Pkcs10CertificateRequestGenerator.create({
      name: 'CN=sha1',
      keys: signing,
      signingAlgorithm: { name: 'ECDSA', hash: 'SHA-1' },
    });
    const sha1Res = await enroll(terminal, code, { csrPem: sha1.toString('pem') });
    expect(sha1Res.status).toBe(422);
    expect(sha1Res.body.code).toBe('ATTESTATION_FAILED');
    const otherKey = await new TestTerminal().csrPem();
    const otherRes = await enroll(terminal, code, { csrPem: otherKey });
    expect(otherRes.status).toBe(422);
    expect(otherRes.body.code).toBe('ATTESTATION_FAILED');
    expect((await codeRow(code)).used_at).toBeNull();
  });

  it('corps et clés : refus 400 / 422 VALIDATION_FAILED avant le code', async () => {
    const code = await newCode();
    const terminal = new TestTerminal();
    const body = await terminal.enrollmentBody(code, { androidPki });
    const { csr_pem: _csr, ...withoutCsr } = body;
    const { agreement_attestation_chain: _chain, ...withoutAgreementChain } = body;
    // Même clé d'accord en SPKI au point compressé (59 octets) : valide, mais pas canonique.
    const compressed = Buffer.concat([
      Buffer.from('3039301306072a8648ce3d020106082a8648ce3d030107032200', 'hex'),
      Buffer.from([0x02 + (terminal.agreement.point[64]! & 1)]),
      terminal.agreement.point.subarray(1, 33),
    ]);
    const cases: Array<[Record<string, unknown>, number]> = [
      [withoutCsr, 400],
      [withoutAgreementChain, 400],
      [{ ...body, serial: 'a b' }, 400],
      [{ ...body, signing_public_key: 'pas du base64 !' }, 400],
      [{ ...body, agreement_public_key: compressed.toString('base64') }, 422],
      [{ ...body, agreement_public_key: body.signing_public_key }, 422],
    ];
    for (const [sent, status] of cases) {
      const res = await post(sent);
      expect(res.status).toBe(status);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    }
    expect((await codeRow(code)).used_at).toBeNull();
    // Chaque essai compte pour le code (empreinte connue) : six essais VALIDATION_FAILED.
    const attempts = await ownerRows<{ result: string }>(
      'SELECT result FROM device_enrollment_attempt WHERE code_hash = $1',
      [hashOf(code)],
    );
    expect(attempts.map((a) => a.result)).toEqual(Array(6).fill('VALIDATION_FAILED'));
  });

  it('mode : TOPUP_DESK refusé sur iOS (DEVICE_MODE_NOT_ALLOWED), code intact', async () => {
    const code = await newCode({ app_mode: 'TOPUP_DESK', kind: 'TOPUP' });
    const res = await enroll(new TestTerminal('IOS'), code);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('DEVICE_MODE_NOT_ALLOWED');
    expect((await codeRow(code)).used_at).toBeNull();
    expect((await enroll(new TestTerminal('ANDROID'), code)).status).toBe(201);
  });

  it('NFR-008 : 20 enrôlements simultanés sur un code, exactement un 201', async () => {
    const code = await newCode();
    const terminals = Array.from({ length: 20 }, () => new TestTerminal());
    const bodies = await Promise.all(terminals.map((t) => t.enrollmentBody(code, { androidPki })));
    const results = await Promise.all(bodies.map((body) => post(body)));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    for (const r of results.filter((x) => x.status !== 201)) {
      expect([422, 429]).toContain(r.status);
      expect(['ENROLLMENT_CODE_INVALID', 'RATE_LIMITED']).toContain(r.body.code);
    }
    const devices = await ownerRows<{ n: number }>(
      `SELECT count(*)::int AS n FROM device d JOIN device_enrollment_code c
          ON c.id = d.enrollment_code_id WHERE c.code_hash = $1`,
      [hashOf(code)],
    );
    expect(devices[0]!.n).toBe(1);
  });

  it('même serial chez deux prestataires : deux terminaux, rien de l’autre', async () => {
    const serial = `SHARED-${randomUUID().slice(0, 8)}`;
    const a = new TestTerminal('ANDROID', serial);
    const b = new TestTerminal('ANDROID', serial);
    const resA = await enroll(a, await newCode());
    const resB = await enroll(b, await newCode({}, operatorAdminB, eventB));
    expect([resA.status, resB.status]).toEqual([201, 201]);
    expect([resA.body.next_seq, resB.body.next_seq]).toEqual([1, 1]);
    expect(a.deviceId).not.toBe(b.deviceId);
    expect(a.operatorId).toBe(w.ops.a);
    expect(b.operatorId).toBe(w.ops.b);
    expect(resB.text).not.toContain(w.ops.a);
    expect(resB.text).not.toContain(a.deviceId);
    expect(new X509Certificate(b.certificatePem).subject).toContain(`O=${w.ops.b}`);
  });

  it('même serial actif dans le prestataire : 409 DEVICE_SERIAL_IN_USE, code intact', async () => {
    const first = new TestTerminal();
    expect((await enroll(first, await newCode())).status).toBe(201);
    const code = await newCode();
    const res = await enroll(new TestTerminal('ANDROID', first.serial), code);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DEVICE_SERIAL_IN_USE');
    expect((await codeRow(code)).used_at).toBeNull();
  });

  it('code inconnu, utilisé ou expiré et serial actif : refus du code, jamais 409', async () => {
    const active = new TestTerminal();
    const used = await newCode();
    expect((await enroll(active, used)).status).toBe(201);
    const expired = await newCode();
    await expire(expired);
    const cases: Array<[string, string]> = [
      [unknownCode(), 'ENROLLMENT_CODE_INVALID'],
      [used, 'ENROLLMENT_CODE_INVALID'],
      [expired, 'ENROLLMENT_CODE_EXPIRED'],
    ];
    for (const [code, expected] of cases) {
      const res = await enroll(new TestTerminal('ANDROID', active.serial), code);
      expect(res.status).toBe(422);
      expect(res.body.code).toBe(expected);
    }
  });

  it('ré-enrôlement après révocation : next_seq = last_seq + 1 (88 → 89)', async () => {
    const old = new TestTerminal();
    expect((await enroll(old, await newCode())).status).toBe(201);
    await withOwner(async (db) => {
      await db.query('UPDATE device SET last_seq = 88 WHERE id = $1', [old.deviceId]);
      await old.setStatus(db, 'REVOKED');
    });
    const renewed = new TestTerminal('ANDROID', old.serial);
    const res = await enroll(renewed, await newCode());
    expect(res.status).toBe(201);
    expect(res.body.next_seq).toBe(89);
    expect(renewed.deviceId).not.toBe(old.deviceId);
  });

  it('R-16 : 11e essai d’un code dans l’heure → 429 avec Retry-After', async () => {
    const code = await newCode();
    const terminal = new TestTerminal();
    const body = await terminal.enrollmentBody(code, { androidPki });
    for (let i = 0; i < 10; i += 1) {
      const res = await post({ ...body, serial: 'x' });
      expect(res.status).toBe(400);
    }
    const limited = await post(body);
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe('RATE_LIMITED');
    expect(limited.headers['retry-after']).toBe('3600');
    expect((await codeRow(code)).used_at).toBeNull();
  });

  it('R-16 : 31e refus d’une adresse dans l’heure → 429', async () => {
    const terminal = new TestTerminal();
    const body = await terminal.enrollmentBody(unknownCode(), { androidPki });
    // Codes tous différents : seule la limite de l'adresse joue.
    for (let i = 0; i < 30; i += 1) {
      const res = await post({ ...body, enrollment_code: unknownCode() });
      expect(res.status).toBe(422);
    }
    const limited = await post({ ...body, enrollment_code: unknownCode() });
    expect(limited.status).toBe(429);
    // Une autre adresse n'est pas limitée.
    expect((await post(body, testAddress())).status).toBe(422);
  });

  /** Lignes d'audit des refus écrites depuis une adresse, dans l'ordre d'écriture. */
  const refusalAudits = (from: string) =>
    ownerRows<{ operator_id: string | null; text: string; after: Record<string, unknown> }>(
      `SELECT operator_id, a::text AS text, after FROM audit_log a
        WHERE action = 'DEVICE_ENROLLMENT_REFUSED' AND after->>'address' = $1 ORDER BY id`,
      [from],
    );
  const attemptsFrom = (from: string) =>
    ownerRows<{ result: string; operator_id: string | null; code_hash: Buffer | null }>(
      'SELECT result, operator_id, code_hash FROM device_enrollment_attempt WHERE address = $1',
      [from],
    );

  it('ADR-117 : chaque refus audité, chaîne du prestataire du code connu, sinon plateforme', async () => {
    const used = await newCode();
    expect((await enroll(new TestTerminal(), used)).status).toBe(201);
    const expired = await newCode();
    await expire(expired);
    const mode = await newCode({ app_mode: 'TOPUP_DESK', kind: 'TOPUP' });
    const known = await newCode();
    const unknown = unknownCode();
    const body = await new TestTerminal().enrollmentBody(known, { androidPki });
    const responses = [
      await enroll(new TestTerminal(), used),
      await enroll(new TestTerminal(), expired),
      await enroll(new TestTerminal('IOS'), mode),
      await post({ ...body, serial: 'x y' }),
      await enroll(new TestTerminal(), unknown),
      await post({ ...body, enrollment_code: 'pas un code', serial: 'x y' }),
    ];
    expect(responses.map((r) => r.body.code)).toEqual([
      'ENROLLMENT_CODE_INVALID',
      'ENROLLMENT_CODE_EXPIRED',
      'DEVICE_MODE_NOT_ALLOWED',
      'VALIDATION_FAILED',
      'ENROLLMENT_CODE_INVALID',
      'VALIDATION_FAILED',
    ]);
    const audits = await refusalAudits(address);
    expect(
      audits.map((a) => [a.operator_id, a.after.result, a.after.enrollment_code_id ?? null]),
    ).toEqual([
      [w.ops.a, 'CODE_INVALID', (await codeRow(used)).id],
      [w.ops.a, 'CODE_EXPIRED', (await codeRow(expired)).id],
      [w.ops.a, 'MODE_NOT_ALLOWED', (await codeRow(mode)).id],
      [w.ops.a, 'VALIDATION_FAILED', (await codeRow(known)).id],
      [null, 'CODE_INVALID', null],
      [null, 'VALIDATION_FAILED', null],
    ]);
    // Ni code ni empreinte dans l'audit.
    for (const code of [used, expired, mode, known, unknown]) {
      for (const audit of audits) {
        expect(audit.text).not.toContain(code.replace(/-/g, ''));
        expect(audit.text).not.toContain(hashOf(code).toString('hex'));
      }
    }
    // Un essai par refus (et la réussite), empreinte gardée pour tout code bien formé.
    const attempts = await attemptsFrom(address);
    expect(attempts.filter((a) => a.result !== 'ENROLLED')).toHaveLength(6);
    const unknownAttempt = attempts.find((a) => a.code_hash?.equals(hashOf(unknown)));
    expect(unknownAttempt).toMatchObject({ result: 'CODE_INVALID', operator_id: null });
  });

  it('ADR-117 : 11e essai d’un code inconnu → 429, même corps que pour un code existant', async () => {
    const unknown = unknownCode();
    const existing = await newCode();
    const body = await new TestTerminal().enrollmentBody(existing, { androidPki });
    for (let i = 0; i < 10; i += 1) {
      expect((await post({ ...body, enrollment_code: unknown, serial: 'x' })).status).toBe(400);
      expect((await post({ ...body, serial: 'x' })).status).toBe(400);
    }
    const limitedUnknown = await post({ ...body, enrollment_code: unknown });
    const limitedExisting = await post(body);
    for (const res of [limitedUnknown, limitedExisting]) {
      expect(res.status).toBe(429);
      expect(res.headers['retry-after']).toBe('3600');
    }
    expect(problemOf(limitedUnknown)).toEqual(problemOf(limitedExisting));
    expect((await codeRow(existing)).used_at).toBeNull();
  });

  it('ADR-117 : 31 enrôlements réussis depuis une adresse → aucun 429', async () => {
    for (let i = 0; i < 31; i += 1) {
      const res = await enroll(new TestTerminal(), await newCode());
      expect(res.status).toBe(201);
    }
    // Les réussites ne comptent pas : un refus reste un refus, pas une limite.
    expect((await enroll(new TestTerminal(), unknownCode())).status).toBe(422);
  }, 120_000);

  it('ADR-117 : au-delà d’une limite, un seul essai et un seul audit RATE_LIMITED', async () => {
    const body = await new TestTerminal().enrollmentBody(unknownCode(), { androidPki });
    // Limite de l'adresse (codes inconnus, chaîne de la plateforme).
    for (let i = 0; i < 30; i += 1)
      expect((await post({ ...body, enrollment_code: unknownCode(), serial: 'x' })).status).toBe(
        400,
      );
    for (let i = 0; i < 3; i += 1)
      expect((await post({ ...body, enrollment_code: unknownCode() })).status).toBe(429);
    // Même un corps invalide reçoit 429 au-delà de la limite, sans rien écrire.
    expect((await post({ ...body, serial: 'x' })).status).toBe(429);
    const fromAddress = await attemptsFrom(address);
    expect(fromAddress).toHaveLength(31);
    expect(fromAddress.filter((a) => a.result === 'RATE_LIMITED')).toHaveLength(1);
    const limitedAudits = (await refusalAudits(address)).filter(
      (a) => a.after.result === 'RATE_LIMITED',
    );
    expect(limitedAudits.map((a) => a.operator_id)).toEqual([null]);
    // Limite d'un code connu, depuis deux adresses neuves : une trace, chez son prestataire.
    const code = await newCode();
    const codeBody = { ...body, enrollment_code: code };
    const [first, second] = [testAddress(), testAddress()];
    for (let i = 0; i < 10; i += 1)
      expect((await post({ ...codeBody, serial: 'x' }, first)).status).toBe(400);
    for (const from of [first, second, first])
      expect((await post(codeBody, from)).status).toBe(429);
    const limited = await ownerRows<{ operator_id: string; after: Record<string, unknown> }>(
      `SELECT operator_id, after FROM audit_log
        WHERE action = 'DEVICE_ENROLLMENT_REFUSED' AND after->>'result' = 'RATE_LIMITED'
          AND after->>'enrollment_code_id' = $1`,
      [(await codeRow(code)).id],
    );
    expect(limited.map((a) => a.operator_id)).toEqual([w.ops.a]);
    const codeAttempts = await ownerRows<{ result: string }>(
      'SELECT result FROM device_enrollment_attempt WHERE code_hash = $1',
      [hashOf(code)],
    );
    expect(codeAttempts.filter((a) => a.result === 'RATE_LIMITED')).toHaveLength(1);
  });

  it('NFR-005 : ni code ni jeton en clair (base, audit, registre, journaux)', async () => {
    const written: string[] = [];
    const capture = (stream: NodeJS.WriteStream) =>
      jest.spyOn(stream, 'write').mockImplementation((chunk: unknown) => {
        written.push(String(chunk));
        return true;
      });
    const out = capture(process.stdout);
    const err = capture(process.stderr);
    let code: string;
    const terminal = new TestTerminal();
    try {
      code = await newCode();
      await enroll(new TestTerminal(), code, { challengeCode: 'ABCDEFGHJKLM' });
      expect((await enroll(terminal, code)).status).toBe(201);
      await enroll(new TestTerminal(), code);
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
    const secrets = [
      code,
      code.replace(/-/g, ''),
      terminal.refreshToken,
      terminal.refreshToken.slice(4),
      terminal.token,
      terminal.token.split('.')[2]!,
    ];
    const tables = [
      'device_enrollment_code',
      'device_enrollment_attempt',
      'device',
      'device_refresh_token',
      'device_status_history',
      'audit_log',
      'api_idempotency',
    ];
    const dump = (
      await Promise.all(
        tables.map((t) => ownerRows<{ text: string }>(`SELECT t::text AS text FROM ${t} t`)),
      )
    )
      .flat()
      .map((r) => r.text)
      .join('\n');
    const logs = written.join('');
    for (const secret of secrets) {
      expect(dump).not.toContain(secret);
      expect(logs).not.toContain(secret);
    }
    expect(dump).not.toContain(Buffer.from(code.replace(/-/g, '')).toString('hex'));
  });

  (process.env.SKIP_LATENCY ? it.skip : it)(
    'NFR-006 : code inconnu et code utilisé, même réponse, écart des médianes < 20 ms',
    async () => {
      const used = await newCode();
      expect((await enroll(new TestTerminal(), used)).status).toBe(201);
      const terminal = new TestTerminal();
      // Corps valide jusqu'à l'étape 3 : seul le code diffère.
      const body = await terminal.enrollmentBody(used, { androidPki });
      const attempt = async (code: string) => {
        const started = process.hrtime.bigint();
        const res = await post({
          ...body,
          enrollment_code: code,
        });
        return {
          ms: Number(process.hrtime.bigint() - started) / 1e6,
          outcome: `${res.status} ${JSON.stringify(problemOf(res))}`,
        };
      };
      // Essais du code utilisé effacés (ses lignes seulement, jamais celles d'une autre suite).
      const forgetUsed = () =>
        withOwner((db) =>
          db.query('DELETE FROM device_enrollment_attempt WHERE code_hash = $1', [hashOf(used)]),
        );
      await attempt(unknownCode());
      await attempt(used);
      const unknown: Array<Awaited<ReturnType<typeof attempt>>> = [];
      const again: Array<Awaited<ReturnType<typeof attempt>>> = [];
      for (let i = 0; i < TIMING_TRIES; i += 1) {
        // Les limites (10 refus par code, 30 par adresse) restent hors de la mesure : adresse
        // neuve et essais du code utilisé effacés tous les dix tours.
        if (i % 10 === 0) {
          address = testAddress();
          await forgetUsed();
        }
        unknown.push(await attempt(unknownCode()));
        again.push(await attempt(used));
      }
      const outcomes = new Set([...unknown, ...again].map((r) => r.outcome));
      expect(outcomes.size).toBe(1);
      expect([...outcomes][0]).toMatch(/^422 .*ENROLLMENT_CODE_INVALID/);
      const [a, b] = [median(unknown.map((r) => r.ms)), median(again.map((r) => r.ms))];
      process.stdout.write(
        `NFR-006 : médianes inconnu ${a.toFixed(1)} ms, utilisé ${b.toFixed(1)} ms, ` +
          `écart ${Math.abs(a - b).toFixed(1)} ms\n`,
      );
      expect(Math.abs(a - b)).toBeLessThan(MAX_MEDIAN_GAP_MS);
    },
    300_000,
  );
});

describe('aucun faux d’attestation en production (relecture WP10)', () => {
  /** Ports sans adaptateur réel dans la mission : fournisseurs « réels » neutres. */
  const realLike = {
    [DEVICE_CA]: {
      issue: () => Promise.reject(new Error('non appelé')),
      caCertificatesPem: () => [],
    },
    [TOKEN_SIGNER]: {
      kid: 'k',
      sign: () => Promise.reject(new Error('non appelé')),
      publicJwk: () => ({}),
    },
    [CUSTOMER_IDENTITY]: { verify: () => Promise.reject(new Error('non appelé')) },
  };
  const compile = (attestation?: object) => {
    const config: AppConfig = { ...loadConfig(), production: true, androidAttestationRoots: null };
    const builder = Test.createTestingModule({ imports: [PublicProcessModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(config)
      .overrideProvider(DEVICE_CA)
      .useValue(realLike[DEVICE_CA])
      .overrideProvider(TOKEN_SIGNER)
      .useValue(realLike[TOKEN_SIGNER])
      .overrideProvider(CUSTOMER_IDENTITY)
      .useValue(realLike[CUSTOMER_IDENTITY] as unknown as CustomerIdentityPort);
    if (attestation) builder.overrideProvider(ATTESTATION_VERIFIER).useValue(attestation);
    return builder.compile();
  };

  it('API publique : vérificateur dans son graphe ; sans racines, la fabrique refuse', async () => {
    await expect(compile()).rejects.toThrow(FakeInProductionError);
    await expect(compile()).rejects.toThrow(/vérificateur d’attestation/);
  });

  it('un faux d’attestation fait refuser le démarrage ; un réel passe la garde', async () => {
    const withFake = await compile(new FakeAttestation());
    try {
      expect(withFake.get(ATTESTATION_VERIFIER, { strict: false })).toBeInstanceOf(FakeAttestation);
      expect(() => assertProcessIsSafe(withFake)).toThrow(FakeInProductionError);
      try {
        assertProcessIsSafe(withFake);
      } catch (error) {
        expect((error as FakeInProductionError).names).toEqual(['le vérificateur d’attestation']);
      }
    } finally {
      await withFake.close();
    }
    const withReal = await compile({ verify: () => Promise.reject(new Error('non appelé')) });
    try {
      expect(() => assertProcessIsSafe(withReal)).not.toThrow();
    } finally {
      await withReal.close();
    }
  });
});
