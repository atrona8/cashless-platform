// Monde commun des suites App Attest (WP13) : serveur HTTPS avec le vérificateur d'attestation RÉEL
// (racines de test générées à l'exécution, aucun réseau), terminal iOS qui GARDE la clé privée App
// Attest (le terminal de test la jette), enrôlement par la route, accès à la base sous un
// prestataire.
import 'reflect-metadata';
import { randomInt, webcrypto } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAttestationVerifier } from '../../../src/attestation/attestation.module';
import { iosClientDataHash } from '../../../src/attestation/enrollment-challenge';
import { loadConfig } from '../../../src/config/config';
import { ATTESTATION_VERIFIER } from '../../../src/security/port-tokens';
import { startHttpsApp, type HttpsTestApp } from '../../support/app';
import { createAndroidTestPki, type AndroidTestPki } from '../../support/attestation/android';
import { appAttestObject, createIosTestPki, type IosTestPki } from '../../support/attestation/ios';
import { APP_URL, connect } from '../../support/db';
import { createMediaWorld, type MediaWorld } from '../../support/media-fixtures';
import {
  createEnrollmentCode,
  postJson,
  TestTerminal,
  type RouteServer,
} from '../../support/test-terminal';

type CryptoKeyPair = webcrypto.CryptoKeyPair;

/** Terminal iOS de test qui conserve la clé App Attest générée à l'enrôlement. */
export class IosTestTerminal extends TestTerminal {
  appAttestKeys!: CryptoKeyPair;

  constructor(serial?: string) {
    super('IOS', serial);
  }

  override async iosAttestation(
    code: string,
    pki?: IosTestPki,
  ): Promise<{ keyChain: Buffer[]; pki: IosTestPki }> {
    const authority = pki ?? (await createIosTestPki());
    this.appAttestKeys = await webcrypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify'],
    );
    const object = await appAttestObject({
      publicKey: this.appAttestKeys.publicKey,
      clientDataHash: iosClientDataHash(code, this.serial, this.signing.spki, this.agreement.spki),
      pki: authority,
    });
    return { keyChain: [object], pki: authority };
  }
}

export interface AttestationWorld {
  w: MediaWorld;
  api: HttpsTestApp;
  server: RouteServer;
  iosPki: IosTestPki;
  androidPki: AndroidTestPki;
  /** Enrôle par la route (201 attendu) et rend le terminal adopté. */
  enroll<T extends TestTerminal>(terminal: T, eventId?: string): Promise<T>;
  /** Enrôlement brut : réponse de la route. */
  enrollRaw(terminal: TestTerminal, code?: string): ReturnType<typeof postJson>;
  close(): Promise<void>;
}

/** `real` : vérificateur réel ; sinon le faux par défaut des essais (hors production). */
export async function startAttestationWorld(real = true): Promise<AttestationWorld> {
  const w = await createMediaWorld();
  const androidPki = await createAndroidTestPki();
  const iosPki = await createIosTestPki();
  const dir = mkdtempSync(join(tmpdir(), 'cashless-app-attest-'));
  const overrides = [];
  if (real) {
    const androidRoots = join(dir, 'android.pem');
    const iosRoot = join(dir, 'ios.pem');
    writeFileSync(androidRoots, androidPki.rootPem);
    writeFileSync(iosRoot, iosPki.rootPem);
    const verifier = createAttestationVerifier(
      {
        ...loadConfig(),
        androidAttestationRoots: androidRoots,
        iosAppAttestRoot: iosRoot,
        iosAppAttestEnvironment: 'production',
      },
      { revocationSource: async () => ({ entries: {} }) },
    );
    overrides.push({ provide: ATTESTATION_VERIFIER, useValue: verifier });
  }
  const api = await startHttpsApp(undefined, { identity: w.idp, overrides, trustProxyHops: 1 });
  const server: RouteServer = { baseUrl: api.baseUrl, serverCaPem: api.tls.serverCaPem };
  // Une adresse par monde, dans 198.18.0.0/15 (réservé aux essais) : limites R-16 sans collision.
  const address = `198.${18 + randomInt(2)}.${randomInt(256)}.${randomInt(1, 255)}`;
  const newCode = (eventId: string) =>
    createEnrollmentCode(server, w.operatorAdminA.token, { event_id: eventId });
  const enrollRaw = async (terminal: TestTerminal, code?: string) => {
    const body = await terminal.enrollmentBody(code ?? (await newCode(w.ids.eventA)), {
      androidPki,
      iosPki,
    });
    return postJson(server, '/device-enrollments', body, { 'x-forwarded-for': address });
  };
  return {
    w,
    api,
    server,
    iosPki,
    androidPki,
    enrollRaw,
    async enroll(terminal, eventId = w.ids.eventA) {
      const body = await terminal.enrollmentBody(await newCode(eventId), { androidPki, iosPki });
      const res = await postJson(server, '/device-enrollments', body, {
        'x-forwarded-for': address,
      });
      if (res.status !== 201) throw new Error(`enrôlement refusé : ${res.status} ${res.text}`);
      terminal.adopt(res.body);
      return terminal;
    },
    async close() {
      await api.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Transaction du rôle applicatif sous un prestataire (comme `TenantTx.run`), client à fermer. */
export async function openTenantClient(operatorId: string) {
  const client = await connect(APP_URL);
  await client.query('BEGIN');
  await client.query("SELECT set_config('app.operator_id', $1, true)", [operatorId]);
  return {
    client,
    async commit() {
      await client.query('COMMIT');
      await client.end();
    },
    async rollback() {
      await client.query('ROLLBACK').catch(() => undefined);
      await client.end();
    },
  };
}
