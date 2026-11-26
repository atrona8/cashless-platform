# Implementation Plan: Adaptateurs conformes aux documentations des fournisseurs choisis (mission 12b-1)

**Branch**: `feat/adaptateurs-fournisseurs-choisis` | **Date**: 2026-11-26 | **Spec**: [spec.md](spec.md)
**Input**: Mission specification from `kitty-specs/adaptateurs-fournisseurs-choisis-01M8BXJA/spec.md`

## Summary

Écrire, derrière les ports existants, les adaptateurs réels des fournisseurs déjà choisis : Wave, PayDunya et Stripe
(`PspAdapter`), AWS Secrets Manager (`PspSecretStore`), AWS KMS (cinq ports de clés) et S3 Object Lock
(`SealExternalCopy`), chacun conforme à sa documentation publique (lue le 26/11/2026, `research.md`). Le port des PSP
évolue pour que chaque fournisseur vérifie sa notification selon son propre mécanisme, et pour qu'une notification
puisse n'être qu'un **signal** (PayDunya) ou ne pas porter les données de la carte (Stripe) : le crédit vient alors
d'une **relecture du paiement** auprès du fournisseur, faite hors de la réception, par le chemin d'interrogation qui
existe déjà. Les faux restent le défaut hors production ; en production, un adaptateur réel n'est construit que si son
service figure dans une **liste unique, dans le code, des services essayés**, vide au départ ; chaque service a une
commande d'essai contre le vrai service. Aucun appel réseau dans les tests : de faux serveurs HTTP locaux rejouent les
réponses documentées, et les clients AWS visent ces serveurs.

### Décisions du porteur (26/11/2026)

| # | Décision | Source |
|---|---|---|
| D1 | Orange Money hors périmètre (documentation derrière un compte Sonatel) | specify |
| D2 | PayDunya : notification = signal, crédit après `checkout-invoice/confirm/{token}` ; écart consigné | specify |
| D3 | Refus en production jusqu'à l'essai réel ; levée service par service | specify |
| D4 | Stripe inclus ; éligibilité Sénégal/XOF à vérifier par le porteur | specify, DM `01M8BXK56G…` |
| D5 | Remboursement au payeur (OP-N82) hors plateforme | specify, DM `01M8BXKCKV…` |
| D6 | Levée de la garde : **liste dans le code**, modifiée par une PR relue jointe au compte rendu d'essai | plan, DM `01M8BYCPEC…` |
| D7 | Carte PayDunya : **règle ADR-77 gardée** ; sans preuve 3-D Secure, « reçu, non crédité » + anomalie ; réexamen après l'essai en bac à sable | plan, DM `01M8BYCXPD…` |
| D8 | Rétention des copies de scellement : **10 ans**, mode conformité, réglable | plan, DM `01M8BYD519…` |
| D9 | Contrat : ajout rétrocompatible à `receivePspWebhook` (corps en formulaire, description par fournisseur) | plan, DM `01M8BYDCHF…` |

## Technical Context

**Language/Version**: TypeScript 5.9.3 sur Node.js 22 LTS (existant, `docs/08-pile-logicielle.md`)
**Primary Dependencies**: NestJS 11.2.7 (existant) ; **nouvelles**, épinglées à la version exacte après vérification
(R-01) : `axios` (cible déjà fixée par la pile pour le HTTP sortant des PSP), `@aws-sdk/client-kms`,
`@aws-sdk/client-secrets-manager`, `@aws-sdk/client-s3` (même version pour les trois)
**Storage**: PostgreSQL 17 existant ; aucune migration prévue (R-07 : le signal réutilise `psp_event` et l'état
`PENDING` de la recharge) ; S3 Object Lock pour la copie des scellements
**Testing**: Jest (unitaires + intégration sur base locale), serveurs HTTP locaux rejouant les réponses documentées ;
garde « aucun appel réseau » (NFR-001) ; pgTAP inchangé
**Target Platform**: processus Node.js de l'API (public, `psp-poller`, `tag-keys`, `personalization`, `tag-check`,
`key-admin`, `snapshot-content`, `snapshot-signer`, `maintenance`) sur AWS, région par configuration (`eu-west-3`
provisoire, OP-N11)
**Project Type**: monorepo existant (`apps/api`, `packages/*`)
**Performance Goals**: réponse à une notification inchangée (< 2 s, contrat) ; aucun appel sortant pendant la réception
**Constraints**: délai par appel sortant 10 s (réglable), au plus 2 nouveaux essais sur 429/5xx, jamais sur une
création non idempotente (NFR-004) ; aucun secret journalisé (NFR-003) ; contrat stable sauf D9 (C-001)
**Scale/Scope**: 6 services, 3 PSP, 5 ports KMS ; environ 9 lots

## Charter Check

Charte absente (`.kittify/charter/charter.yaml` introuvable) : contrôle sauté. Règles du porteur appliquées à la place
(CLAUDE.md) : écart de sécurité soumis avant code (D2, D7 consignés en OP/ADR), aucun faux en production (C-002),
dette nommée (OP, ADR, test de borne, report dans PROMPTS et PRD), fichiers à relire par une personne listés à la revue.

## Project Structure

### Documentation (this mission)

```
kitty-specs/adaptateurs-fournisseurs-choisis-01M8BXJA/
├── plan.md
├── research.md          # sources lues, décisions techniques R-01..R-14
├── data-model.md        # secrets par fournisseur, verdicts de notification, liste des services essayés
├── quickstart.md        # poser identifiants et clés, lancer l'essai, lever la garde
├── contracts/
│   ├── psp-port.md               # port PspAdapter révisé (verdicts, relecture)
│   ├── psp-fournisseurs.md       # Wave, PayDunya (écart D2), Stripe ↔ port
│   ├── aws.md                    # Secrets Manager, KMS, S3 Object Lock ↔ ports
│   ├── production-guard.md       # liste des services essayés, sélection, commande d'essai
│   └── openapi-receivePspWebhook.md  # ajout rétrocompatible D9
└── tasks.md             # /spec-kitty.tasks
```

### Source Code (repository root)

```
apps/api/src/
├── psp/
│   ├── psp-adapter.port.ts          # verdicts NOTIFICATION | SIGNAL, besoin de relecture (IC-01)
│   ├── psp-secret-store.port.ts     # identifiants par fournisseur (IC-01)
│   ├── hmac-signature.ts            # paramétré : séparateur, entrées inconnues tolérées (IC-01)
│   ├── http/psp-http.ts             # client axios commun : délai, nouveaux essais bornés, journal sans secret (IC-02)
│   ├── wave/wave-adapter.ts         # (IC-03)
│   ├── paydunya/paydunya-adapter.ts # (IC-04)
│   ├── stripe/stripe-adapter.ts     # (IC-05)
│   ├── aws/secrets-manager-store.ts # (IC-06)
│   └── psp.providers.ts             # sélection faux / réel / indisponible (IC-08)
├── webhooks/                        # vérifieur et réception : signal, formulaire (IC-01)
├── topups/poller/                   # relecture des signaux (IC-01)
├── kms/aws-kms.ts, kms.module.ts    # (IC-07)
├── sealing/s3-seal-copy.ts          # (IC-07)
├── attestation/                     # comparaison aux documentations, correctifs seulement si écart (IC-09)
├── external-services/
│   ├── production-enabled.ts        # liste unique des services essayés, vide (IC-08)
│   └── trial/                       # commandes d'essai par service (IC-08)
└── kms/production-guard.ts          # « non essayé » refusé comme un faux (IC-08)
apps/api/test/support/fake-servers/  # serveurs HTTP locaux Wave, PayDunya, Stripe, KMS, Secrets Manager, S3
packages/contracts/openapi.yaml       # D9 (IC-01)
docs/SERVICES-EXTERNES.md             # paramètres à poser par service (IC-10)
```

## Complexity Tracking

| Écart | Pourquoi | Alternative plus simple écartée |
|---|---|---|
| Port PSP à deux verdicts (notification / signal) | PayDunya ne signe pas son contenu (D2) ; Stripe ne porte pas la carte dans la notification | Croire la notification PayDunya : écarté par le porteur |
| Serveurs locaux simulant AWS | Prouver la sérialisation réelle du SDK sans réseau | Moquer `client.send` : ne teste pas ce que le SDK envoie |

## Implementation Concern Map

### IC-01 — Port PSP révisé, réception et relecture

- `verifyNotification` rend `{ kind: 'NOTIFICATION', notification, signedAt, secretUsed }` ou
  `{ kind: 'SIGNAL', notificationId, reference, secretUsed }` ; une notification peut porter
  `confirmationRequired: true` (Stripe : carte absente). Contrat : `contracts/psp-port.md`.
- `verifyHmacSignature` paramétré par fournisseur : séparateur (`'.'` Stripe, `''` Wave), entrées inconnues tolérées
  (Stripe `v0`, métadonnées) ou refusées (Wave), tolérance d'horodatage par fournisseur (300 s pour les deux).
- `webhook-verifier.ts` : la tolérance rejouée en défense en profondeur ne s'applique qu'à un verdict horodaté ; un
  signal n'a pas d'horodatage et ne porte aucun montant.
- Réception : corps `application/x-www-form-urlencoded` accepté pour `paydunya` seulement (taille contrôlée avant
  lecture, comme aujourd'hui) ; un signal ou une notification à relire est **conservé** puis marqué traité **sans
  effet** ; aucun crédit pendant la réception, aucun appel sortant.
- Relecture : le travailleur d'interrogation (`psp-topup-poller`) interroge en priorité les recharges qui ont reçu un
  signal (délai 0 au lieu de 2 min), lit le statut complet par `getStatus` (montant, devise, carte), puis le processeur
  existant applique. Une recharge sans signal garde le délai actuel.
- Contrat `openapi.yaml` (D9) : `application/x-www-form-urlencoded` ajouté à `receivePspWebhook`, description par
  fournisseur ; `contract-baseline.json` mis à jour.

### IC-02 — Client HTTP sortant commun

- `axios` épinglé ; une instance par appel d'adaptateur ; délai 10 s (`PSP_HTTP_TIMEOUT_MS`), 2 nouveaux essais sur
  429/5xx/réseau pour GET et pour les POST idempotents seulement (clé d'idempotence Stripe ; Wave : recherche par
  `client_reference` avant tout nouvel essai de création) ; adresse de base imposée par configuration (bac à sable ou
  production) ; aucun en-tête, corps ou secret dans les journaux (une ligne : fournisseur, opération, statut, durée).
- Garde de test : en test, toute adresse qui n'est pas `127.0.0.1`/`localhost` lève (NFR-001).

### IC-03 — Adaptateur Wave

Checkout API (`POST /v1/checkout/sessions`, `GET /v1/checkout/sessions/:id`, `…/search?client_reference=`,
`POST …/:id/expire`), relevé `GET /v1/transactions?date=` paginé, notification `Wave-Signature` (HMAC-SHA256 hex sur
`t + corps` sans séparateur, plusieurs `v1`, 5 min), événements `checkout.session.completed` /
`checkout.session.payment_failed`. Détail : `contracts/psp-fournisseurs.md`.

### IC-04 — Adaptateur PayDunya

`checkout-invoice/create`, `checkout-invoice/confirm/{token}`, IPN en formulaire `data[hash] === sha512(MASTER-KEY)`
comparé à temps constant → **signal** ; aucun relevé ni annulation documentés (`readStatement` rend une liste vide
signalée, `cancel` rend `cancelled: false`). Carte sans preuve 3-D Secure : `threeDs: 'NOT_PERFORMED'` → non crédité
(D7). Détail et écart : `contracts/psp-fournisseurs.md`.

### IC-05 — Adaptateur Stripe

Checkout Session hébergée (`mode=payment`, `price_data` XOF, `payment_method_types[]=card`,
`payment_method_options[card][request_three_d_secure]=any`, `client_reference_id`, `expires_at` 30 min,
`Idempotency-Key`), `POST …/expire`, statut par la session puis le PaymentIntent et sa `latest_charge` (résultat
3-D Secure, empreinte), relevé `GET /v1/balance_transactions` paginé, notification `Stripe-Signature` (`t.corps`,
plusieurs `v1`, `v0` et entrées inconnues ignorées, 300 s) ; une notification de succès est **à relire** (carte).
Détail : `contracts/psp-fournisseurs.md`.

### IC-06 — Coffre AWS Secrets Manager

`GetSecretValue` (`AWSCURRENT`, puis `AWSPREVIOUS` pour le secret de notification précédent et son échéance), secret
JSON par configuration sous `psp/<holder_party_id>/<nom>` ; refus `HOLDER_MISMATCH` avant tout appel si la référence ne
porte pas le détenteur ; erreurs AWS → `UNAVAILABLE` / `NOT_FOUND` sans valeur ni référence. Cache court (60 s) en
mémoire, jamais journalisé. Détail : `contracts/aws.md`.

### IC-07 — AWS KMS et S3 Object Lock

- KMS : `GenerateMac` (`HMAC_SHA_256`), `GenerateDataKey` (`AES_256`), `Decrypt`, `Sign` (`ECDSA_SHA_256`,
  `MessageType RAW`, DER ; message > 4 096 octets refusé), `GetPublicKey` (SPKI DER), `CreateKey`
  (`HMAC_256`/`SYMMETRIC_DEFAULT`/`ECC_NIST_P256` avec l'usage correspondant), `DisableKey`. Un client par processus,
  qui n'expose que les ports de son rôle (C-005) ; tampons en clair mis à zéro comme aujourd'hui.
- S3 : `PutObject` avec `ObjectLockMode=COMPLIANCE`, `ObjectLockRetainUntilDate` = maintenant + 10 ans
  (`SEAL_COPY_RETENTION_DAYS`, D8), somme de contrôle SHA-256, `If-None-Match: *` (jamais d'écrasement) ;
  `GetObject` pour relire. Détail : `contracts/aws.md`.

### IC-08 — Garde de production, sélection et commandes d'essai

- `external-services/production-enabled.ts` : `PRODUCTION_ENABLED_SERVICES: readonly ExternalService[] = []` ; un test
  échoue si la liste change sans que le compte rendu d'essai du service ne soit cité dans la PR (convention vérifiée à
  la revue) et si un service hors périmètre y apparaît.
- Sélection par service : `PSP_ADAPTERS`, `PSP_SECRET_STORE`, `KMS_BACKEND`, `SEAL_COPY` = `fake` (défaut hors
  production) | `real`. En production : `fake` refusé ; `real` refusé si le service n'est pas dans la liste ; message
  qui nomme le service (C-002, FR-013).
- Commande d'essai `npm run essai -w @cashless/api -- <service>` : parcours minimal documenté contre le vrai service,
  hors production, compte rendu sans secret (FR-014). Détail : `contracts/production-guard.md`.

### IC-09 — Attestations Android et Apple

Comparer `android-key-attestation.ts`, `google-revocation-cache.ts`, `ios-app-attest*.ts` à la documentation de Google
(Key Attestation, liste de révocation) et d'Apple (App Attest : vérification de l'attestation et des assertions) ;
consigner la comparaison point par point ; corriger seulement un écart, sinon rien (FR-012, no-op permis).

### IC-10 — Paramètres à poser, consignation, preuves

`docs/SERVICES-EXTERNES.md` : par service, identifiants et clés, emplacement, commande d'essai (FR-015) ; OP et ADR des
écarts D2 et D7 ; report dans PROMPTS et PRD ; preuves de la mission ; `COVERAGE` des faux de
`production-refusals.spec.ts` à jour.
