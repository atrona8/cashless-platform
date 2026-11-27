# Services externes à gérer

État au 27/11/2026 (missions 1 à 10a, 11a et 9c livrées ; 11b consolidée, pas encore dans `main` ; **mission 12b-1 : adaptateurs écrits (lots WP01 à WP12), consignation par WP13 ; état « adaptateur conforme, à essayer » : aucun service n'est encore essayé contre le vrai service, aucun n'est autorisé en production**). Liste de tout ce qui vient de l'extérieur du dépôt : comptes à ouvrir, accès à obtenir, et comment
chaque service se branche dans le code. Sources : `docs/POINTS_OUVERTS.md` (§ 7, actions du porteur),
`docs/SPECIFICATION.md` (§ 10.3, § 11.1, § 13.2, § 13.7), `docs/08-pile-logicielle.md`, `PROMPTS-A-ENVOYER.md`
(missions 11b, 12b-1 et 12b). Ce fichier résume, il ne remplace pas ces sources : en cas d'écart, elles font foi.

**Règle commune à tous les services** (CLAUDE.md, règle 2) : tant que l'adaptateur réel n'est pas écrit et essayé
contre le vrai service, le code utilise un faux, et la configuration de production **refuse de démarrer** avec ce
faux. **Depuis la mission 12b-1 (« 12b-1 » : les six services ci-dessous marqués ainsi), l'adaptateur réel existe mais
reste refusé en production tant que son service n'est pas dans `PRODUCTION_ENABLED_SERVICES`**
(`apps/api/src/external-services/production-enabled.ts`, vide ; OP-N209). « 12b » (sans suffixe) désigne ce que la
12b-1 ne livre pas : Orange Money, OTP, OIDC, signature NXP, matériel de la passerelle, autorité des terminaux et
signataire des jetons d'appareil, banque. Aucun secret (clé, identifiant, mot de passe) n'entre dans le dépôt, une variable d'environnement en clair ou un
message : les clés vont dans AWS KMS, les secrets applicatifs dans AWS Secrets Manager (SPEC § 13.2).

## 1. Vue d'ensemble

| # | Service | Sert à | État dans le code | Qui agit | Délai à prévoir | Débloque |
|---|---|---|---|---|---|---|
| 1 | Compte AWS (région) | Héberger tout le reste | Région `eu-west-3` provisoire (OP-N11, ADR-65) | Porteur | Après mesure de latence (action 3) et avis du juriste | Tous les services AWS |
| 2 | AWS RDS PostgreSQL 17 | Base centrale | PostgreSQL 17 local en Docker | Porteur + nous | Quelques jours | Mise en ligne |
| 3 | AWS KMS | Clés des bracelets, snapshots, autorité des terminaux, jetons d'appareil | Faux (`fake-kms`), refusés en production ; **12b-1 : adaptateur `AwsKms` conforme, à essayer** (`-- kms`) ; autorité des terminaux et signataire des jetons d'appareil : toujours des faux (12b, OP-N73) | Porteur (compte, essai) + nous (12b-1 livrée côté code) | Après le compte AWS | Bracelets, hors ligne, terminaux en production |
| 4 | AWS Secrets Manager | Identifiants PSP et secrets de webhooks, par détenteur des fonds | Faux coffre, refusé en production ; **12b-1 : adaptateur `AwsSecretsManagerStore` conforme, à essayer** (`-- psp.secrets`) ; secrets applicatifs (PIN, HMAC, IBAN) : 12b | Porteur (secrets, essai) + nous (12b-1 livrée côté code) | Après le compte AWS | Paiements réels |
| 5 | AWS S3 Object Lock (compte distinct) | Copie du scellement du journal, en écriture unique | Faux (`sealing/fake-seal-copy.ts`), refusé en production ; **12b-1 : adaptateur `S3SealCopy` conforme, à essayer** (`-- seal-copy`) | Porteur (second compte, essai) + nous | Après le compte AWS | Scellement hors base (SPEC § 13.7) |
| 6 | AWS CloudWatch (+ OpenTelemetry) | Journaux et mesures | Journal JSON local | Nous | À la mise en ligne | Exploitation |
| 7 | Wave Business | Recharges mobile money | Faux adaptateur ; **12b-1 : adaptateur conforme, à essayer** (`-- psp.wave`) | Porteur (compte, essai) + nous | Quelques semaines | Recharges Wave |
| 8 | Orange Money (marchand) | Recharges mobile money | Faux adaptateur ; **documentation non publique, portail Sonatel par compte : hors périmètre de la mission 12b-1 (D1)** | Porteur (compte) + nous | **Plusieurs semaines** : à lancer maintenant | Recharges Orange Money |
| 9 | PayDunya | Carte, agrégateur local | Faux adaptateur ; **12b-1 : adaptateur conforme, à essayer** (`-- psp.paydunya`) ; notification traitée comme un signal (OP-N199), carte non créditée (OP-N200) | Porteur (accès de test, essai) + nous | Quelques jours à semaines | Carte via agrégateur |
| 10 | Stripe | Carte, PSP international | Faux adaptateur ; **12b-1 : adaptateur conforme, à essayer** (`-- psp.stripe`) | Porteur (vérifier XOF et Sénégal, essai) + nous | Incertain : éligibilité à vérifier | Carte internationale |
| 11 | SMS principal local | Codes à usage unique (Orange, Free, Expresso) | Chaîne livrée (mission 10a) avec faux fournisseurs, refusés en production | Porteur (devis, nom d'expéditeur) + nous | 5 à 10 jours pour le nom d'expéditeur (RCCM) | Connexion festivalier |
| 12 | SMS de repli international | Repli des codes | Idem (mission 10a) | Porteur (devis) + nous | Quelques jours | Fiabilité des codes |
| 13 | WhatsApp (fournisseur agréé Meta) | Premier canal des codes | Idem (mission 10a) | Porteur (devis, modèle de message) + nous | Validation du modèle par Meta | Codes par WhatsApp |
| 14 | Serveur d'identité OIDC | Connexion des personnes (back-office, approbations), invitation du personnel | Faux serveur en test seulement ; rien en local (`ACCES-API.md` § 3) | Porteur (choix) + nous | Selon le choix | Back-office, approbations réelles (OP-N56), invitation (OP-N171) |
| 15 | NXP (puce des bracelets) | Signature d'originalité des puces | Vérifiée par le poste seulement (OP-N46) | Porteur (bracelets réels, action 1) | Demi-journée de tests | Personnalisation et lecture réelles |
| 16 | Google, attestation Android (Key Attestation) | Prouver qu'un terminal Android est authentique | Branché, racines en configuration ; **12b-1 : comparé à la documentation de Google, exception des certificats d'usine expirés sous la racine `f92009e853b6b045` (OP-N202)** | Nous (configuration) | Aucun compte | Enrôlement Android |
| 17 | Apple App Attest | Prouver qu'un terminal iOS est authentique | Branché, racine en configuration ; **12b-1 : comparé à la documentation d'Apple, contrôle des extensions `apple_validation_category_01` et `apple_bundle_version_01` reporté en mission 12 (OP-N203)** | Porteur (compte développeur Apple) | Ouverture du compte | Enrôlement iOS |
| 18 | Matériel de clés de la passerelle | Clés non exportables du mini-PC | Faux en mémoire ; `hardware` refuse de démarrer faute d'adaptateur | Porteur (choix du matériel) + nous | Selon le matériel | Passerelle en production |
| 19 | Banque du détenteur des fonds | Versements (virements) et relevés à rapprocher | Import de relevés CSV et confirmation des versements livrés (mission 9b) ; aucun lien direct avec la banque | Porteur (banque, exemple de relevé) | Quelques jours | Rapprochement, versements réels |
| 20 | GitHub | Dépôt et intégration continue | En place (`.github/workflows/ledger-tests.yml`) | — | — | — |
| 21 | jsDelivr (CDN) | Page `/docs` (Swagger UI) | En place, hors production seulement | — | — | — |
| 22 | ngrok | Partager l'API locale de test | En place (`demarrer-local.sh`) | Porteur (jeton ngrok) | — | Intégration par une équipe cliente |

## 2. Détail, service par service

### 2.1 AWS : compte, région, droits

- **À faire (porteur)** : ouvrir le compte AWS de production ; confirmer la région (`eu-west-3` provisoire) après la
  mesure de latence depuis Dakar (action 3 : Orange, Free, Expresso) et l'avis du juriste sur la localisation des
  données (action 8). Ouvrir un **second compte AWS** pour le stockage du scellement (§ 2.5).
- **Comment** : un rôle IAM **par processus** (SPEC § 3.2, § 13.2) : API publique (sans `kms:Decrypt` ni
  `kms:GenerateMac` sur les clés des bracelets), service des clés de bracelet, personnalisation, contrôle quotidien,
  signature des snapshots (`snapshot-signer` : `kms:Sign` seul), contenu des snapshots (`snapshot-content`). Aucune
  clé d'accès AWS longue durée sur un poste ; les processus prennent leur rôle.
- **Mission** : 12b (« Intégrations réelles »). La 12b-1 ne crée aucun compte ni rôle : elle lit la région par `AWS_REGION` (`eu-west-3` par défaut, OP-N11) et prend les identifiants dans la chaîne par défaut du SDK (rôle du processus), jamais une clé d'accès en configuration ; `AWS_ENDPOINT_URL` (adresse de service de test) est refusée en production.

### 2.2 RDS PostgreSQL 17

- **À faire** : vérifier que PostgreSQL 17 est disponible sur RDS dans la région retenue (ADR-55, ADR-78) ; instance
  chiffrée, sauvegardes automatiques, accès réseau privé seulement.
- **Comment** : une URL de connexion par rôle de base (`DATABASE_URL_APP`, `_PLATFORM`, `_TAGKEYS`, `_PERSO`,
  `_TAGCHECK`, `_KEYADMIN`, `_MAINT`, `_SNAPCONTENT`, `_SNAPSIGN`, `_PIN` (rôle `cashless_pin`, processus `vendor-pin`), `_CLAIMADMIN` (rôle `cashless_claimadmin`, commande `reissue-claim-codes`), `_OWNER` pour les migrations). Les mots de passe des
  rôles vont dans Secrets Manager, jamais les valeurs de test de `tools/dev-db/env.sh`. Migrations :
  `npm run migrate -w @cashless/ledger-sql`.

### 2.3 AWS KMS

- **Sert à** : clés maîtres des bracelets (`MacPort`, `DataKeyPort`, `DecryptPort`, `KeyAdminPort`, OP-N41) ;
  signature des snapshots (`SignPort`, ECDSA P-256, signature DER) et chiffrement de leur contenu (OP-N89, ADR-138) ;
  autorité des terminaux et signataire des jetons d'appareil (OP-N73).
- **Aujourd'hui** : faux (`apps/api/src/kms/fake-kms.ts`, clés dérivées d'une graine écrite dans le code). La garde de
  démarrage refuse ce faux en production (`production-guard.spec.ts`).
- **Mission 12b-1 (27/11/2026) : adaptateur écrit (`apps/api/src/kms/aws/aws-kms.ts`), état « conforme à la documentation, à essayer ».** Cinq ports (MAC `HMAC_SHA_256`, clé de données `AES_256`, déchiffrement, signature `ECDSA_SHA_256` en DER, administration), un client par processus qui n'expose que les ports de son rôle ; message de plus de 4 096 octets refusé avant l'appel. **À poser (rien à coder)** : un rôle IAM par processus avec les seuls droits de son rôle (`kms:GenerateMac`, `kms:GenerateDataKey`, `kms:Decrypt`, `kms:Sign`, `kms:GetPublicKey`, `kms:CreateKey`, `kms:DisableKey` selon le processus), les clés créées par `key-admin`, `AWS_REGION`, et `KMS_BACKEND=real` (absent en production = `real`). **Essai** : `npm run essai -w @cashless/api -- kms` (crée des clés de test, MAC, clé de données aller-retour, signature vérifiée, désactive les clés ; les clés de test restent désactivées, jamais supprimées : décision humaine). **Levée de la garde (D6)** : ajouter `'kms'` à `PRODUCTION_ENABLED_SERVICES`, avec `docs/essais/kms.json`, dans une PR relue. Le faux reste refusé en production ; l'adaptateur aussi tant que `kms` n'est pas listé. Restent des faux (12b) : autorité des terminaux et signataire des jetons d'appareil (OP-N73).
- **Comment** : créer les clés dans KMS, donner leur référence à l'API (par exemple `SNAPSHOT_SIGNING_KEY_REF`), écrire
  les adaptateurs AWS derrière les ports existants (écrits par la mission 12b-1), puis lever la garde de production
  **service par service** (`kms`), seulement pour un adaptateur essayé contre le vrai KMS.
- **Exception** : la clé de signature des snapshots de la passerelle n'est pas dans KMS (SPEC § 9.4) ; voir § 2.18.

### 2.4 AWS Secrets Manager

- **Sert à** : identifiants PSP et secrets de webhooks, **rangés par détenteur des fonds**, jamais partagés entre
  détenteurs (SPEC § 11.1) ; secrets applicatifs (`VENDOR_PIN_SECRET`, `VENDOR_PIN_IDEMPOTENCY_SECRET`,
  `VENDOR_PIN_CALL_KEY`, `IDEMPOTENCY_HMAC_KEY`, `CLAIM_CODE_HMAC_KEY` et sa version `CLAIM_CODE_HMAC_KEY_VERSION`,
  `ENROLLMENT_CODE_HMAC_KEY`, `CUSTOMER_AUTH_HMAC_KEY` (mission 10a), trousseau de chiffrement des IBAN
  `IBAN_KEYRING` / `IBAN_ACTIVE_KID` (mission 9b)…) et mots de passe des rôles de base.
- **Mission 12b-1 (27/11/2026) : adaptateur écrit (`AwsSecretsManagerStore`, `apps/api/src/psp/aws/secrets-manager-store.ts`) pour les secrets des PSP, état « conforme à la documentation, à essayer ».** Un secret JSON par configuration PSP, **nom `psp/<holder_party_id>/<nom>`** (le segment après `psp/` est le détenteur des fonds ; un autre détenteur est refusé avant tout appel), valeur :
  `{ "provider": "WAVE" | "PAYDUNYA" | "STRIPE", "credentials": { … }, "notification": "<secret de notification>", "previous_valid_until": null | "<date ISO>" }`.
  `credentials` : Wave `{ "api_key", "request_signing_secret" (facultatif) }` ; PayDunya `{ "master_key", "private_key", "token" }` ; Stripe `{ "secret_key" }`. **PayDunya : `notification` doit être identique à `credentials.master_key`** (sinon `REF_INVALID`). Rotation : la version `AWSPREVIOUS` fournit le secret de notification précédent, valable jusqu'à `previous_valid_until` de la version courante (jamais pour PayDunya). Cache de 60 s en mémoire. **À poser** : ces secrets, un rôle IAM de lecture (`secretsmanager:GetSecretValue` sur `psp/*`), `PSP_SECRET_STORE=real` (absent en production = `real`). **Essai** : `npm run essai -w @cashless/api -- psp.secrets --secret-ref <référence> --provider <WAVE|PAYDUNYA|STRIPE>`. **Levée de la garde (D6)** : `'psp.secrets'` dans `PRODUCTION_ENABLED_SERVICES`.
- **Comment** : adaptateur AWS derrière le port du coffre (`PSP_SECRET_STORE`) ; dépendance épinglée (`@aws-sdk/client-secrets-manager` 3.1172.0, `docs/08-pile-logicielle.md`). Les secrets applicatifs listés ci-dessus restent à la 12b.

### 2.5 S3 Object Lock (compte distinct)

- **Sert à** : copier chaque scellement du journal (`ledger_seal`) hors de la base, en écriture unique (mode
  conformité), sous un compte AWS distinct de celui de la base (SPEC § 13.7).
- **Aujourd'hui** : port `SealExternalCopy` ; faux `sealing/fake-seal-copy.ts`, refusé en production ; le travailleur
  de scellement recopie les scellements manquants (`sealing/audit-seal.worker.ts`).
- **Comment** : bucket avec Object Lock activé à la création ; un rôle qui peut seulement écrire ; adaptateur S3
  derrière le port, **mission 12b-1 (27/11/2026) : écrit (`S3SealCopy`, `apps/api/src/sealing/s3-seal-copy.ts`), état « conforme à la documentation, à essayer »** : écriture en mode conformité (COMPLIANCE), rétention de 10 ans réglable (`SEAL_COPY_RETENTION_DAYS`, 3 650 par défaut), jamais d'écrasement (`If-None-Match: *` ; un 412 relit l'objet et compare l'empreinte) ; **à poser par le porteur** : `SEAL_COPY_BUCKET` (compartiment créé avec Object Lock, compte distinct), `AWS_REGION`, `SEAL_COPY=real` (absent en production = `real`), rôle d'écriture sans `s3:DeleteObject` ni `s3:BypassGovernanceRetention` ; **essai** : `npm run essai -w @cashless/api -- seal-copy [--retention-days N]` (l'objet de test reste verrouillé pour la rétention choisie : irrévocable, OP-N210) ; **levée de la garde (D6)** : `'seal-copy'` dans `PRODUCTION_ENABLED_SERVICES`.

### 2.6 Observabilité (CloudWatch, OpenTelemetry)

- **Comment** : `pino` / `nestjs-pino` puis export vers CloudWatch ; OpenTelemetry à fixer à l'introduction
  (`docs/08-pile-logicielle.md` § 1). Aucun secret ni donnée personnelle dans les journaux.

### 2.7 à 2.10 Prestataires de paiement (Wave, Orange Money, PayDunya, Stripe)

**Mission 12b-1 (27/11/2026) : état « adaptateur conforme à la documentation, à essayer » pour Wave, PayDunya et Stripe** (adaptateurs écrits ; aucun essai réel n'a eu lieu). Orange Money : documentation non publique (portail Sonatel par compte), hors périmètre jusqu'à ce que le porteur la fournisse (« 12b »). Chaque adaptateur reste refusé en production jusqu'à un essai réel réussi, puis levé service par service par une PR relue qui ajoute le service à la liste du code (`external-services/production-enabled.ts`, vide) avec son compte rendu `docs/essais/<service>.json`. **Rien d'autre à coder** : le porteur pose les identifiants dans le coffre (forme du secret : § 2.4) et déclare l'adresse de notification.

| Service | À poser (identifiants et clés, jamais dans le dépôt) | Particularité | Essai |
|---|---|---|---|
| Wave | clé d'API (`api_key`, `wave_sn_prod_…`), secret de webhook (`notification`, `wave_sn_WHS_…`), facultatif secret de signature des requêtes (`request_signing_secret`) ; adresses de retour par défaut `WAVE_DEFAULT_SUCCESS_URL` et `WAVE_DEFAULT_ERROR_URL` (https) ; déclarer chez Wave l'URL `https://<api>/v1/webhooks/wave/<psp_config_id>` | notification signée (`Wave-Signature`, `t=…,v1=…`, HMAC de `t` + corps sans séparateur, ±300 s) ; aucune clé d'idempotence : reprise par recherche (OP-N204) | `-- psp.wave` |
| PayDunya | clé maître (`master_key`, rangée aussi comme `notification`), clé privée (`private_key`), jeton (`token`) ; URL de notification transmise à chaque facture (rien à déclarer) ; bac à sable : `--sandbox` à l'essai (base bac à sable si `PAYDUNYA_API_BASE` n'est pas posée) | notification = signal (D2, OP-N199) : crédit seulement après relecture authentifiée ; carte sans preuve 3-D Secure : reçue, non créditée (D7, OP-N200) ; ni relevé ni annulation documentés (OP-N201) | `-- psp.paydunya` |
| Stripe | clé secrète (`secret_key`, `sk_…`), secret de webhook (`notification`, `whsec_…`) ; déclarer `https://<api>/v1/webhooks/stripe/<psp_config_id>` pour `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired` et `charge.dispute.created` | éligibilité d'un marchand établi au Sénégal et devise XOF sans décimale à vérifier par le porteur (D4, OP-N206) ; seul `authenticated` vaut un succès 3-D Secure | `-- psp.stripe` |

Commande d'essai : `npm run essai -w @cashless/api -- <service>` (hors production ; refus si `NODE_ENV=production`). Pour un PSP : `--secret-ref <référence du coffre>` **ou** `--credentials <fichier JSON local>` (l'un des deux), et facultativement `--return-url`, `--notification-url`, `--sandbox` (PayDunya). Aucun paiement n'est conclu : la session créée est relue puis expirée. Réglages communs (aucun secret) : `PSP_ADAPTERS` (`fake`, `real`), `PSP_HTTP_TIMEOUT_MS` (10 000 par défaut), `WAVE_API_BASE`, `PAYDUNYA_API_BASE`, `STRIPE_API_BASE` (adresses `https` ; `http://127.0.0.1` seulement hors production). Le compte rendu est gardé sous `docs/essais/<service>.json` (forme : `docs/essais/README.md`). Le remboursement d'un paiement non crédité reste hors plateforme (D5, OP-N82).

- **À faire (porteur, action 11, ADR-70)** : ouvrir un compte **Wave Business** et un compte **marchand Orange
  Money** (accès de test et documentation des API ; Orange Money prend plusieurs semaines) ; obtenir les accès de test
  **PayDunya** et **Stripe** ; vérifier pour Stripe l'ouverture de compte et le versement en XOF pour un marchand
  établi au Sénégal. Avant d'activer un PSP pour un organisateur : agrément BCEAO pour un acteur local (SPEC § 11.1).
- **Titulaire** : le **détenteur des fonds** de l'événement, pas la plateforme ; ses identifiants vont dans Secrets
  Manager sous son nom.
- **Comment** : un adaptateur par PSP derrière l'interface commune (`PspAdapter` : initier un paiement, vérifier une notification
  selon le mécanisme du fournisseur, interroger un statut, annuler, lire un relevé). Webhooks entrants vérifiés par signature avant tout traitement,
  stockés bruts, traités de façon idempotente ; carte : 3-D Secure obligatoire (ADR-77). Configuration par organisateur
  (`psp_configuration`, `event_psp_selection`). Mission 12b-1 pour Wave, PayDunya et Stripe (adaptateurs écrits, OP-N81 levé
  côté code) ; mission 12b pour Orange Money et le remboursement des paiements non crédités (OP-N82). Tant qu'aucun
  service n'est essayé et listé : **aucune recharge en ligne en production**.
- **À transmettre à l'équipe** : seulement l'existence des accès de test ; les identifiants eux-mêmes sont posés
  directement dans Secrets Manager par le porteur.

### 2.11 à 2.13 Codes à usage unique (SMS principal, SMS de repli, WhatsApp)

- **À faire (porteur, action 10, ADR-66)** : demander les devis d'un **SMS principal local** couvrant Orange, Free et
  Expresso, d'un **SMS de repli international** et d'un **fournisseur WhatsApp agréé Meta** ; lancer la validation du
  **nom d'expéditeur SMS** (RCCM, 5 à 10 jours) et du **modèle de message WhatsApp**.
- **Comment** : port `OtpSender`, chaîne WhatsApp, puis SMS principal (bascule à 10 s, `otp_whatsapp_timeout_seconds`),
  puis SMS de repli ; attentes réglables `OTP_WHATSAPP_TIMEOUT_MS` (10 s par défaut) et `OTP_SMS_PRIMARY_TIMEOUT_MS`
  (20 s par défaut), code gardé 35 s au plus (ADR-225) ; limites `429 OTP_RATE_LIMITED`, `CUSTOMER_OTP_IP_HOURLY_MAX`.
  Routes `/customer-auth/*` **livrées** par la mission 10a (dans `main` le 23/11/2026) avec de faux fournisseurs
  (`customer-auth/otp-providers.ts`), refusés en production ; fournisseurs réels en mission 12b.

### 2.14 Serveur d'identité OIDC

- **Sert à** : connexion des personnes (back-office, app festivalier pour les jetons), authentification renforcée et
  jeton d'approbation de la seconde personne (SPEC § 3.2, § 10.3).
- **À faire (porteur)** : choisir le fournisseur (géré ou hébergé), l'ouvrir dans la région retenue.
- **Comment** : l'API vérifie les jetons (bibliothèque `jose`) avec `OIDC_ISSUER`, `OIDC_JWKS_URI`, `OIDC_AUDIENCE`,
  `OIDC_APPROVAL_AUDIENCE`. Aujourd'hui, seul un faux serveur existe dans les tests (`apps/api/test/support/fake-idp.ts`).
  Mission 12b (OP-N56 : preuve de la personne qui décide une approbation ; OP-N171 : créer une personne exige
  aujourd'hui son `issuer` et son `subject`, le serveur retenu doit permettre un parcours d'invitation). Le back-office
  lit le profil et les rôles de la personne connectée par `GET /staff/me` (mission 11b).

### 2.15 NXP (signature d'originalité des puces)

- **À faire (porteur, action 1)** : validation de la puce sur de vrais bracelets (demi-journée) ; fournir la **clé
  publique NXP** et des **signatures réelles** pour les vecteurs de test ; demander au fournisseur de bracelets le
  surcoût d'un QR différent par bracelet (action 4).
- **Comment** : le poste lit `READ_SIG` à chaque passage et vérifie la signature (clé NXP embarquée) ; vérification
  serveur à la personnalisation en mission 12b (OP-N46).

### 2.16 Attestation Android (Google)

- **Comment** : aucun compte ; configuration `ANDROID_ATTESTATION_ROOTS` (racines Google publiées),
  `ANDROID_APP_PACKAGE`, `ANDROID_APP_SIGNING_DIGESTS` (empreinte du certificat de signature de l'app terminal). Limite
  acceptée : OP-N67 (ADR-110). Play Integrity : décision en recette. **12b-1** : comparé à la documentation de Google
  (`docs/passation-12b-1/attestations-comparaison.md`) ; exception limitée aux certificats d'usine expirés sous la racine
  `f92009e853b6b045` (OP-N202, ADR-239) ; à poser : les **deux** racines Google publiées dans `ANDROID_ATTESTATION_ROOTS`.

### 2.17 Apple App Attest

- **À faire (porteur)** : compte développeur Apple (identifiant d'équipe et identifiant d'app).
- **Comment** : `IOS_TEAM_ID`, `IOS_BUNDLE_ID`, `IOS_APP_ATTEST_ROOT`. Limite acceptée : OP-N64 (ADR-106), réexaminée
  par la mission 12. **12b-1** : comparé à la documentation d'Apple ; les extensions `apple_validation_category_01` et
  `apple_bundle_version_01` ne sont pas contrôlées, contrôle en mission 12 avec un vecteur réel (OP-N203, ADR-239).

### 2.18 Matériel de clés de la passerelle

- **Sert à** : garder les clés du mini-PC de la passerelle sans jamais pouvoir les exporter (R-27), et les détruire à
  la révocation (OP-N106).
- **Aujourd'hui** : port `HARDWARE_KEYSTORE` ; le faux garde les clés en mémoire ; `HARDWARE_KEYSTORE=hardware` refuse
  de démarrer faute d'adaptateur (WP16 de la mission 8). La passerelle ne peut donc pas tourner en production tant que
  l'adaptateur n'existe pas.
- **À faire (porteur)** : choisir le matériel (puce TPM du mini-PC ou clé matérielle) ; mission de l'adaptateur **à
  fixer** (proposée : 12b).

### 2.19 Banque du détenteur des fonds

- **Sert à** : recevoir les versements (organisateur, commerçants, prestataire, plateforme) et fournir les relevés
  rapprochés avec le grand livre (SPEC § 12.1, mission 9b).
- **Aujourd'hui** : aucun lien direct avec la banque. Les relevés s'importent en CSV (`importAccountStatement`) puis se
  rapprochent (`matchStatementLine`) ; un lot de versements validé à deux est payé par virement hors du système, puis
  confirmé (`confirmPayout`). Les IBAN des bénéficiaires sont chiffrés (trousseau `IBAN_KEYRING`, § 2.4).
- **À faire (porteur)** : banque retenue par détenteur des fonds ; un **exemple réel de relevé exporté** (format, séparateur,
  colonnes) pour caler l'import ; procédure de virement et délai de valeur.

### 2.20 à 2.22 Outils de développement

- **GitHub** : dépôt et intégration continue (`ledger-tests.yml`) ; aucune clé de service en clair dans les workflows.
- **jsDelivr** : Swagger UI 5.34.0, version épinglée avec intégrité SRI, page `/docs` absente en production (ADR-153).
- **ngrok** : `demarrer-local.sh` (archive « API ») expose l'API locale de test sur Internet. Elle tourne avec des
  faux et des valeurs de test publiques : URL limitée à l'équipe qui intègre ; jamais pour des données réelles.
  Jeton personnel du porteur (`ngrok config add-authtoken …`), jamais dans le dépôt.

## 3. Intervenants externes (pas des services techniques, mais bloquants)

| Action | Qui | Échéance | Débloque |
|---|---|---|---|
| 6, 7 | Auditeur de sécurité : revue de conception, puis test d'intrusion | Choix maintenant ; intrusion avant le premier pilote | Mise en production (ADR-44) |
| 8 | Juriste (droit bancaire UEMOA) : régime, plafonds, pièces KYC, conservation, localisation | Choix maintenant ; réponse écrite avant le premier événement réel | Région (OP-N11), plafonds, OP-N12, OP-N108 |
| 9 | Expert-comptable SYSCOHADA | Maintenant ; réponse avant la production | OP-N3 (casse, taxes, caution) |
| 1, 2, 4 | Fournisseur de bracelets, campagne de mesure des téléphones | Avant le code de l'app terminal | Lecture NFC, liste des modèles et de leur niveau (saisie par l'administrateur plateforme, mission 11b) |

## 4. Ordre conseillé

1. **Maintenant** : Orange Money et Wave (délais longs), devis OTP et nom d'expéditeur SMS, choix de l'auditeur et du
   juriste, questions à l'expert-comptable.
2. **Puis** : mesure de latence, confirmation de la région, compte AWS (et second compte pour le scellement), compte
   développeur Apple, choix du serveur d'identité (avec invitation du personnel) et du matériel de clés de la
   passerelle, banque et exemple de relevé de chaque détenteur des fonds.
3. **Mission 12b-1 (adaptateurs écrits le 27/11/2026)** : adaptateurs conformes de Wave, PayDunya, Stripe, Secrets Manager, KMS et S3, **à essayer par le porteur** (§ 5) ; puis, hors de cette mission, les fournisseurs non décidés (Orange Money, SMS, WhatsApp, OIDC, matériel de la passerelle, banque : « 12b »). Chaque adaptateur réel est essayé contre le bac à sable du service, puis la garde
   de production est levée service par service.

## 5. Passer un service de la 12b-1 en production (porteur, FR-015)

Pour chacun des six services (`psp.wave`, `psp.paydunya`, `psp.stripe`, `psp.secrets`, `kms`, `seal-copy`), il ne reste
que des identifiants, des clés et des références : aucune étape de code.

1. **Poser** les identifiants et les clés (§ 2.3 à 2.10) dans AWS Secrets Manager (PSP) ou le compte AWS (KMS, S3), un rôle
   IAM par processus.
2. **Essayer**, hors production : `npm run essai -w @cashless/api -- <service> …` (arguments : § 2.7 à 2.10, § 2.4, § 2.5).
   Garder le compte rendu sous `docs/essais/<service>.json`.
3. **Confirmer** les points « à confirmer à l'essai » du service (OP-N206) : les lever, ou les consigner dans
   `docs/POINTS_OUVERTS.md`.
4. **Autoriser** : une PR qui ajoute le service à `PRODUCTION_ENABLED_SERVICES`, avec le compte rendu, relue par une
   personne (D6) ; mettre à jour `production-enabled.spec.ts` dans la même PR.
5. **Déployer** : en production, un réglage absent vaut `real` ; `fake` est refusé. Un PSP ou le coffre non autorisés restent
   indisponibles (503 aux recharges, 404 aux notifications) ; le service de clés et la copie des scellements non autorisés
   refusent de démarrer.

Orange Money, SMS, WhatsApp, OIDC, matériel de la passerelle et banque ne figurent pas à cette liste : leurs faux restent
tels quels (D1, SC-004).
