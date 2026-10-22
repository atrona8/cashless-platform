// Câblage du vérificateur d'attestation (plan IC-09) sous ATTESTATION_VERIFIER.
// - Racines Android configurées (`ANDROID_ATTESTATION_ROOTS`, obligatoires en production) :
//   vérificateur réel, routé par système. iOS (WP11) : vérifié si `IOS_APP_ATTEST_ROOT` est posé
//   (obligatoire en production), refusé sinon.
// - Sans racines (hors production seulement) : faux vérificateur, que la garde de production refuse.
// - En production, une racine marquée « de test » fait refuser le démarrage (renforcement, plan
//   IC-09 « les racines de test ne doivent jamais être acceptées en production »), Android et iOS.
// - Contenu attendu de `ANDROID_ATTESTATION_ROOTS` et `IOS_APP_ATTEST_ROOT` (racines Google de la
//   rotation annoncée comprises, empreintes vérifiées au déploiement) : tools/dev-db/env.test.example.
import { readFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import { Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { FakeInProductionError } from '../kms/production-guard';
import { ATTESTATION_VERIFIER } from '../security/port-tokens';
import { AndroidKeyAttestationVerifier } from './android-key-attestation';
import {
  AttestationError,
  type AttestationInput,
  type AttestationResult,
  type AttestationVerifier,
} from './attestation.port';
import { FakeAttestation } from './fake-attestation';
import { IosAppAttestVerifier } from './ios-app-attest';
import {
  GoogleRevocationCache,
  httpRevocationSource,
  type RevocationSource,
} from './google-revocation-cache';

/** Marque du sujet des racines d'attestation DE TEST (test/support/attestation) : refusée en production. */
export const TEST_ATTESTATION_ROOT_MARKER = 'cashless-test-attestation-root';

/** Certificats d'un fichier PEM (DER), chacun lisible ; au moins un. */
export function readPemCertificates(pem: string, name: string): Buffer[] {
  const blocks = [
    ...pem.matchAll(/-----BEGIN CERTIFICATE-----([A-Za-z0-9+/=\s]+?)-----END CERTIFICATE-----/g),
  ];
  const ders = blocks.map((block) => Buffer.from(block[1]!.replace(/\s+/g, ''), 'base64'));
  if (ders.length === 0) throw new Error(`${name} : aucun certificat PEM`);
  for (const der of ders) new X509Certificate(der);
  return ders;
}

/** Route par système vers le vérificateur réel de chaque plateforme. */
export class AttestationRouter implements AttestationVerifier, OnModuleInit, OnModuleDestroy {
  constructor(
    private readonly android: AttestationVerifier,
    private readonly ios: AttestationVerifier | null,
    private readonly revocation: GoogleRevocationCache | null = null,
  ) {}

  /** Un faux rangé derrière le routeur reste visible de la garde de production (relecture WP10). */
  get isFake(): true | undefined {
    return this.android.isFake === true || this.ios?.isFake === true ? true : undefined;
  }

  verify(input: AttestationInput): Promise<AttestationResult> {
    if (input.os === 'ANDROID') return this.android.verify(input);
    if (input.os === 'IOS' && this.ios) return this.ios.verify(input);
    return Promise.reject(new AttestationError(`système ${String(input.os)} non pris en charge`));
  }

  onModuleInit(): void {
    this.revocation?.start();
  }

  onModuleDestroy(): void {
    this.revocation?.stop();
  }
}

export interface AttestationDependencies {
  /** Source de la liste de révocation (tests : injectée, sans réseau). */
  revocationSource?: RevocationSource;
}

export function createAttestationVerifier(
  config: Pick<
    AppConfig,
    | 'production'
    | 'androidAttestationRoots'
    | 'androidAppPackage'
    | 'androidAppSigningDigests'
    | 'androidMinPatchLevel'
    | 'iosAppAttestRoot'
    | 'iosTeamId'
    | 'iosBundleId'
    | 'iosAppAttestEnvironment'
  >,
  dependencies: AttestationDependencies = {},
): AttestationVerifier {
  if (config.androidAttestationRoots === null) {
    if (config.production) throw new FakeInProductionError(['le vérificateur d’attestation']);
    return new FakeAttestation();
  }
  const roots = readRoots(config.androidAttestationRoots, 'ANDROID_ATTESTATION_ROOTS', config);
  if (config.production && config.iosAppAttestRoot === null)
    throw new Error('IOS_APP_ATTEST_ROOT manquant : racine Apple obligatoire en production');
  const revocation = new GoogleRevocationCache({
    source: dependencies.revocationSource ?? httpRevocationSource(),
  });
  const android = new AndroidKeyAttestationVerifier({
    roots,
    packageName: config.androidAppPackage,
    signingDigests: config.androidAppSigningDigests,
    minPatchLevel: config.androidMinPatchLevel,
    revocation,
  });
  const ios =
    config.iosAppAttestRoot === null
      ? null
      : new IosAppAttestVerifier({
          roots: readRoots(config.iosAppAttestRoot, 'IOS_APP_ATTEST_ROOT', config),
          teamId: config.iosTeamId,
          bundleId: config.iosBundleId,
          environment: config.iosAppAttestEnvironment,
          production: config.production,
        });
  return new AttestationRouter(android, ios, revocation);
}

/** Racines d'un fichier PEM ; en production, une racine de test fait refuser le démarrage. */
function readRoots(path: string, name: string, config: Pick<AppConfig, 'production'>): Buffer[] {
  const roots = readPemCertificates(readFileSync(path, 'utf8'), name);
  if (
    config.production &&
    roots.some((root) =>
      new X509Certificate(root).subject.toLowerCase().includes(TEST_ATTESTATION_ROOT_MARKER),
    )
  )
    throw new Error(`${name} : racine d’attestation de test interdite en production`);
  return roots;
}

@Module({
  providers: [
    {
      provide: ATTESTATION_VERIFIER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createAttestationVerifier(config),
    },
  ],
  exports: [ATTESTATION_VERIFIER],
})
export class AttestationModule {}
