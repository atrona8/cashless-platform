# Data model — mission 12b-1

Aucune table nouvelle prévue (R-07). Les structures ci-dessous sont en mémoire ou dans le coffre.

## Identifiants d'un PSP (`PspSecrets`, révisé)

```ts
interface PspSecrets {
  credentials: WaveCredentials | PayDunyaCredentials | StripeCredentials | FakeCredentials; // remplace `adapter`
  notification: { current: Secret; previous: Secret | null; previousValidUntil: Date | null };
}
interface WaveCredentials     { provider: 'WAVE';     apiKey: Secret; requestSigningSecret: Secret | null }
interface PayDunyaCredentials { provider: 'PAYDUNYA'; masterKey: Secret; privateKey: Secret; token: Secret }
interface StripeCredentials   { provider: 'STRIPE';   secretKey: Secret }
```

- Wave : `notification` = secret de webhook (`wave_sn_WHS_…`). Stripe : `whsec_…`. PayDunya : `notification.current`
  = clé maître (la preuve d'origine est son SHA-512) ; `previous` toujours `null`.
- Invariant : le fournisseur des identifiants est celui de la configuration ; sinon `REF_INVALID` avant tout appel.
- `Secret` garde son contrat (jamais sérialisé, jamais journalisé).

### Valeur JSON dans Secrets Manager (`psp/<holder_party_id>/<nom>`)

```json
{ "provider": "WAVE",
  "credentials": { "api_key": "…", "request_signing_secret": null },
  "notification": "…", "previous_valid_until": null }
```
Version `AWSPREVIOUS` : seul son champ `notification` est lu (secret précédent), valable jusqu'à
`previous_valid_until` de la version courante.

## Verdict de notification (`PspVerification`, révisé)

| Verdict | Champs | Effet à la réception |
|---|---|---|
| `NOTIFICATION` | `notification` (normalisée), `signedAt`, `secretUsed`, `confirmationRequired` | conservée ; traitée si `confirmationRequired=false`, sinon sans effet + relecture |
| `SIGNAL` | `notificationId`, `reference { merchantReference \| null, providerPaymentRef }`, `secretUsed` | conservé, sans effet + relecture |
| refus | `reason` (motifs actuels) | rien n'est conservé (journal et compteur, comme aujourd'hui) |

Invariant : un crédit n'a lieu que sur une notification `confirmationRequired=false` vérifiée ou sur un `getStatus`
authentifié ; jamais sur un signal.

## Relecture d'une recharge

État inchangé (`PENDING`). Relecture asynchrone demandée par la réception après réponse, au plus une par recharge
et par minute (borne d'un signal forgé, R-05) ; filet : interrogation des recharges `PENDING` de plus de 2 min.

## Services externes

```ts
type ExternalService = 'psp.wave' | 'psp.paydunya' | 'psp.stripe' | 'psp.secrets' | 'kms' | 'seal-copy';
const PRODUCTION_ENABLED_SERVICES: readonly ExternalService[] = []; // D6
```

| Réglage | Valeurs | Défaut hors production | Production |
|---|---|---|---|
| `PSP_ADAPTERS` | `fake` \| `real` | `fake` | `real` exigé ; PSP hors liste indisponible |
| `PSP_SECRET_STORE` | `fake` \| `real` | `fake` | `real` et `psp.secrets` dans la liste, sinon coffre indisponible (comportement actuel) |
| `KMS_BACKEND` | `fake` \| `real` | `fake` | `real` et `kms` dans la liste, sinon refus de démarrer |
| `SEAL_COPY` | `fake` \| `real` | `fake` | `real` et `seal-copy` dans la liste, sinon refus de démarrer |

Paramètres de configuration nouveaux (aucun secret) : `AWS_REGION`, `SEAL_COPY_BUCKET`, `SEAL_COPY_RETENTION_DAYS`
(3 650), `PSP_HTTP_TIMEOUT_MS` (10 000), `WAVE_API_BASE`, `PAYDUNYA_API_BASE`, `STRIPE_API_BASE` (défauts :
adresses de production documentées), `WAVE_DEFAULT_SUCCESS_URL`, `WAVE_DEFAULT_ERROR_URL`.

## Compte rendu d'essai

`{ service, startedAt, steps: [{ name, ok, httpStatus?, durationMs }], ok }` — aucun identifiant, clé, corps ni
référence de secret.
