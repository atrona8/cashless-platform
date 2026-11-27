# Interfaces communes — mission 12b-1 (adaptateurs des fournisseurs choisis)

Ce fichier fait foi, pour les noms, signatures, propriétaires et réglages, sur tout prompt de lot, `research.md`,
`data-model.md` et `contracts/`. Un manque ou une contradiction se signale dans la note de lane, jamais tranché en
silence. Décisions du porteur : `plan.md` D1 à D9 (26/11/2026). Sources des fournisseurs : `research.md` R-03 à R-10.
Chemins relatifs à `apps/api/` sauf mention.

## 1. Carte des propriétaires (aucun fichier partagé entre lots)

| Fichier ou dossier | Lot |
|---|---|
| `package.json` (de `apps/api`), `<racine>/package-lock.json`, `src/config/config.ts`, `test/unit/config.spec.ts`, `src/psp/http/**`, `test/support/fake-servers/http-fake.ts`, `test/support/no-external-network.ts`, `jest.config.*` (enregistrement de la garde réseau), `test/unit/psp/psp-http.spec.ts` | WP01 |
| `src/psp/psp-adapter.port.ts`, `src/psp/psp-secret-store.port.ts`, `src/psp/psp.types.ts`, `src/psp/hmac-signature.ts`, `src/psp/fake/**`, `src/psp/unavailable/**`, `test/unit/psp/{fake-psp-adapter,fake-secret-store,hmac-signature}.spec.ts` | WP02 |
| `src/webhooks/**`, `src/topups/psp/psp-status-confirmer.ts`, `src/topups/poller/**`, `src/topups/psp/psp-topups.module.ts`, `test/integration/webhooks/**`, `test/integration/topups/poller-status.spec.ts`, `test/integration/topups/signal-relecture.spec.ts` | WP03 |
| `<racine>/packages/contracts/openapi.yaml`, `<racine>/packages/contracts/generated/**`, `<racine>/packages/contracts/dart/lib/**`, `<racine>/tools/contract-stability/contract-baseline.json`, `test/unit/contracts/receive-psp-webhook-12b1.spec.ts` | WP04 |
| `src/psp/wave/**`, `test/unit/psp/wave/**`, `test/support/fake-servers/wave.ts` | WP05 |
| `src/psp/paydunya/**`, `test/unit/psp/paydunya/**`, `test/support/fake-servers/paydunya.ts` | WP06 |
| `src/psp/stripe/**`, `test/unit/psp/stripe/**`, `test/support/fake-servers/stripe.ts` | WP07 |
| `src/psp/aws/**`, `test/unit/psp/aws/**`, `test/support/fake-servers/secrets-manager.ts` | WP08 |
| `src/kms/aws/**`, `src/sealing/s3-seal-copy.ts`, `test/unit/kms/aws/**`, `test/unit/sealing/s3-seal-copy.spec.ts`, `test/support/fake-servers/{kms,s3}.ts` | WP09 |
| `src/external-services/{services,production-enabled}.ts`, `src/psp/psp.providers.ts`, `src/psp/psp.module.ts`, `src/kms/kms.module.ts`, `src/kms/production-guard.ts`, `src/sealing/sealing.module.ts`, `src/processes/bootstrap.ts`, `test/unit/production-guard.spec.ts`, `test/unit/external-services/production-enabled.spec.ts`, `test/unit/psp/psp-providers.spec.ts`, `test/unit/kms/kms-module.spec.ts`, `test/unit/architecture.spec.ts`, `test/integration/topups/real-adapters-credit.spec.ts`, `<racine>/apps/gateway/test/e2e/production-refusals.spec.ts`, `<racine>/docs/essais/README.md` | WP10 |
| `src/external-services/trial/**`, `test/unit/external-services/trial/**` | WP11 |
| `src/attestation/**` (seulement en cas d'écart), `test/unit/attestation/**`, `<racine>/docs/passation-12b-1/attestations-comparaison.md` | WP12 |
| `<racine>/docs/SERVICES-EXTERNES.md`, `<racine>/docs/POINTS_OUVERTS.md`, `<racine>/docs/DECISIONS_ADR.md`, `<racine>/PRD.md`, `<racine>/PROMPTS-A-ENVOYER.md`, `<racine>/docs/passation-12b-1/{preuves,note-equipes}.md`, `test/integration/invariants-cloture/consignation.spec.ts` | WP13 |

Retouche hors carte : permise seulement si un changement de signature d'un lot antérieur casse la compilation d'un
fichier non listé ; elle se limite à la compilation, et la note de lane la nomme.

## 2. Configuration (WP01, `src/config/config.ts`)

Aucun secret en configuration. **Défaut des quatre modes : `fake` hors production ; en production, en production, réglage **absent** = `real` ; `fake` posé explicitement → refus de démarrer ; `real` hors liste → PSP et coffre **indisponibles** (comportement actuel : 503/404, démarrage permis), KMS et copie des scellements **refusent de démarrer** (comportement actuel) (analyse I1).** Clés nouvelles de `AppConfig` (lues de l'environnement, validées au démarrage) :

| Clé `AppConfig` | Variable | Défaut | Règle |
|---|---|---|---|
| `externalModes.psp` | `PSP_ADAPTERS` | `fake` | `fake` \| `real` |
| `externalModes.pspSecrets` | `PSP_SECRET_STORE` | `fake` | `fake` \| `real` |
| `externalModes.kms` | `KMS_BACKEND` | `fake` | `fake` \| `real` |
| `externalModes.sealCopy` | `SEAL_COPY` | `fake` | `fake` \| `real` |
| `pspHttpTimeoutMs` | `PSP_HTTP_TIMEOUT_MS` | `10000` | 1 000 à 30 000 |
| `pspBases.wave` | `WAVE_API_BASE` | `https://api.wave.com` | https ; en test, `http://127.0.0.1:*` permis |
| `pspBases.paydunya` | `PAYDUNYA_API_BASE` | `https://app.paydunya.com/api/v1` | idem ; bac à sable `…/sandbox-api/v1` |
| `pspBases.stripe` | `STRIPE_API_BASE` | `https://api.stripe.com` | idem |
| `waveDefaultUrls` | `WAVE_DEFAULT_SUCCESS_URL`, `WAVE_DEFAULT_ERROR_URL` | vides | https si posées |
| `aws.region` | `AWS_REGION` | `eu-west-3` | — |
| `aws.endpoint` | `AWS_ENDPOINT_URL` | vide | hors production seulement (tests) ; refusé en production |
| `sealCopy.bucket` | `SEAL_COPY_BUCKET` | vide | exigé si `SEAL_COPY=real` |
| `sealCopy.retentionDays` | `SEAL_COPY_RETENTION_DAYS` | `3650` | 1 à 36 500 |

## 3. Client HTTP sortant (WP01, `src/psp/http/psp-http.ts`)

```ts
export interface PspHttpRequest {
  provider: PspProviderName; operation: string;            // pour le journal
  method: 'GET' | 'POST'; url: string;                     // absolue, construite depuis pspBases
  headers?: Record<string, string>;                        // jamais journalisés
  body?: string | Buffer;                                  // jamais journalisé
  idempotent: boolean;                                     // vrai : nouveaux essais permis
}
export interface PspHttpResponse { status: number; body: Buffer; headers: Record<string, string> }
export class PspHttpClient {
  constructor(config: Pick<AppConfig, 'pspHttpTimeoutMs'>);
  send(req: PspHttpRequest): Promise<PspHttpResponse>;      // ne lève pas sur 4xx/5xx ; lève PspHttpError (réseau, délai)
}
export class PspHttpError extends Error { readonly kind: 'TIMEOUT' | 'NETWORK' }  // message sans URL complète ni corps
```
Nouveaux essais : au plus 2, sur 429/5xx/réseau, seulement si `idempotent` ; attente 200 ms puis 800 ms (ou
`Retry-After` ≤ 5 s). Journal : une ligne `{provider, operation, status, durationMs, attempts}`.

## 4. Port PSP révisé (WP02)

```ts
// psp.types.ts
export type PspStatement = { supported: true; lines: PspStatementLine[] } | { supported: false };
export interface PspStatementLine { reference: string; providerPaymentRef: string | null; amount: bigint;
  fee: bigint; currency: string; date: Date; reversal: boolean }

// psp-secret-store.port.ts
export type PspCredentials =
  | { provider: 'WAVE'; apiKey: Secret; requestSigningSecret: Secret | null }
  | { provider: 'PAYDUNYA'; masterKey: Secret; privateKey: Secret; token: Secret }
  | { provider: 'STRIPE'; secretKey: Secret }
  | { provider: 'FAKE'; key: Secret | null };
export interface PspSecretBinding { configurationId: string; holderPartyId: string; secretRef: string;
  provider: PspProviderName }   // provider ajouté (analyse I2)
export interface PspSecrets { credentials: PspCredentials;
  notification: { current: Secret; previous: Secret | null; previousValidUntil: Date | null } }

// psp-adapter.port.ts
export type PspVerification =
  | { ok: true; kind: 'NOTIFICATION'; notification: NormalizedNotification; signedAt: Date;
      secretUsed: 'current' | 'previous'; confirmationRequired: boolean }
  | { ok: true; kind: 'SIGNAL'; notificationId: string;
      reference: { merchantReference: string | null; providerPaymentRef: string }; secretUsed: 'current' }
  | { ok: false; reason: PspRejectionReason };
export interface VerifyNotificationInput { rawBody: Buffer; contentType: 'json' | 'form';
  headers: Record<string, string | string[] | undefined>; secrets: PspSecrets; now: Date }
export interface PspAdapter {
  readonly provider: PspProviderName; readonly isFake?: boolean;
  initiate(r: PspInitiateRequest, s: PspSecrets): Promise<PspInitiateResult>;
  verifyNotification(i: VerifyNotificationInput): PspVerification;          // synchrone, sans réseau
  getStatus(q: PspStatusQuery, s: PspSecrets): Promise<PspStatusResult>;
  cancel(q: PspStatusQuery, s: PspSecrets): Promise<{ cancelled: boolean }>;
  readStatement(p: { from: Date; to: Date }, s: PspSecrets): Promise<PspStatement>;
}

// hmac-signature.ts
export interface HmacScheme { separator: '' | '.'; allowUnknownEntries: boolean; toleranceSeconds: number }
export const FAKE_SCHEME: HmacScheme   = { separator: '.', allowUnknownEntries: false, toleranceSeconds: 300 };
export const WAVE_SCHEME: HmacScheme   = { separator: '',  allowUnknownEntries: false, toleranceSeconds: 300 };
export const STRIPE_SCHEME: HmacScheme = { separator: '.', allowUnknownEntries: true,  toleranceSeconds: 300 };
export function verifyHmacSignature(input: { header: string | undefined; rawBody: Buffer; secrets: PspSecrets;
  now: Date; scheme: HmacScheme }): HmacVerification;
export function computeSignature(secret: Secret, timestamp: number, rawBody: Buffer, scheme: HmacScheme): string;
```
`WEBHOOK_TOLERANCE_SECONDS` (300) reste exporté pour `webhook-verifier.ts`. Le faux garde `FAKE_SCHEME` et rend
toujours `NOTIFICATION`, `confirmationRequired: false` ; `FakeSignalPspAdapter` (WP02, `src/psp/fake/`) rend un
`SIGNAL` pour les tests de WP03.

## 5. Réception et relecture (WP03)

```ts
// topups/psp/psp-status-confirmer.ts
@Injectable() export class PspStatusConfirmer {
  /** Lit le statut chez le PSP hors transaction, puis applique par le processeur existant. */
  confirm(topup: { pspTopupId: string; operatorId: string; pspConfigurationId: string;
    provider: PspProviderName; providerPaymentRef: string | null }): Promise<'APPLIED' | 'PENDING' | 'FAILED'>;
  /** Asynchrone, hors requête ; au plus une par recharge et par minute (mémoire du processus). */
  scheduleConfirmation(merchantReference: string, configurationId: string): void;
}
```
Réception : `contentType` déduit de `Content-Type` (`application/x-www-form-urlencoded` → `form`, permis pour
`paydunya` seulement, sinon `400 VALIDATION_FAILED`) ; `SIGNAL` et `NOTIFICATION` à relire : conservés par
`record_psp_event` (kind `UNKNOWN`, normalisé minimal sans montant), marqués traités sans effet, puis
`scheduleConfirmation` après l'envoi de la réponse. Clé d'idempotence d'un signal PayDunya :
`paydunya:<token>:<status>`.

## 6. Adaptateurs (WP05 à WP09)

| Lot | Classe | Fichier | Constructeur |
|---|---|---|---|
| WP05 | `WavePspAdapter` | `src/psp/wave/wave-adapter.ts` | `(http: PspHttpClient, config: Pick<AppConfig,'pspBases'\|'waveDefaultUrls'>)` |
| WP06 | `PayDunyaPspAdapter` | `src/psp/paydunya/paydunya-adapter.ts` | `(http, config: Pick<AppConfig,'pspBases'>)` |
| WP07 | `StripePspAdapter` | `src/psp/stripe/stripe-adapter.ts` | `(http, config: Pick<AppConfig,'pspBases'>)` |
| WP08 | `AwsSecretsManagerStore` | `src/psp/aws/secrets-manager-store.ts` | `(client: SecretsManagerClient, clock = () => new Date())` |
| WP09 | `AwsKms` | `src/kms/aws/aws-kms.ts` | `(client: KMSClient)` ; implémente les 5 ports ; `forCapabilities(caps)` rend un objet qui n'expose que les ports demandés |
| WP09 | `S3SealCopy` | `src/sealing/s3-seal-copy.ts` | `(client: S3Client, config: Pick<AppConfig,'sealCopy'>, clock)` |

Chaque classe réelle porte `readonly isFake = false` et `readonly service: ExternalService`.

## 7. Services externes et garde (WP10)

```ts
// external-services/services.ts
export const EXTERNAL_SERVICES = ['psp.wave','psp.paydunya','psp.stripe','psp.secrets','kms','seal-copy'] as const;
export type ExternalService = (typeof EXTERNAL_SERVICES)[number];
export const OUT_OF_SCOPE = ['psp.orange-money','otp.whatsapp','otp.sms','otp.sms-fallback','oidc',
  'edge.hardware-keystore','bank'] as const;
// external-services/production-enabled.ts
export const PRODUCTION_ENABLED_SERVICES: readonly ExternalService[] = [];
export function isEnabledInProduction(s: ExternalService): boolean;
// kms/production-guard.ts
export class UntriedInProductionError extends Error {}   // « Démarrage refusé : <service> n'a pas été essayé … »
```
Compte rendu d'essai attendu par le test de borne : `<racine>/docs/essais/<service>.json` =
`{ "service", "startedAt", "steps": [{ "name", "ok", "httpStatus"?, "durationMs" }], "ok": true }`.

## 8. Commande d'essai (WP11)

`npm run essai -w @cashless/api -- <service> [--sandbox]` → `src/external-services/trial/main.ts` (script `essai`
ajouté par WP01 dans `package.json`, pointant vers ce fichier). Sortie : le compte rendu JSON du §7 sur la sortie
standard ; code 0 si `ok`, 1 sinon ; refus si `NODE_ENV=production`.
