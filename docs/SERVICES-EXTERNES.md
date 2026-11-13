# Services externes à gérer

État au 06/11/2026. Liste de tout ce qui vient de l'extérieur du dépôt : comptes à ouvrir, accès à obtenir, et comment
chaque service se branche dans le code. Sources : `docs/POINTS_OUVERTS.md` (§ 7, actions du porteur),
`docs/SPECIFICATION.md` (§ 10.3, § 11.1, § 13.2, § 13.7), `docs/08-pile-logicielle.md`, `PROMPTS-A-ENVOYER.md`
(missions 10a et 12b). Ce fichier résume, il ne remplace pas ces sources : en cas d'écart, elles font foi.

**Règle commune à tous les services** (CLAUDE.md, règle 2) : tant que l'adaptateur réel n'est pas écrit et essayé
contre le vrai service, le code utilise un faux, et la configuration de production **refuse de démarrer** avec ce
faux. Aucun secret (clé, identifiant, mot de passe) n'entre dans le dépôt, une variable d'environnement en clair ou un
message : les clés vont dans AWS KMS, les secrets applicatifs dans AWS Secrets Manager (SPEC § 13.2).

## 1. Vue d'ensemble

| # | Service | Sert à | État dans le code | Qui agit | Délai à prévoir | Débloque |
|---|---|---|---|---|---|---|
| 1 | Compte AWS (région) | Héberger tout le reste | Région `eu-west-3` provisoire (OP-N11, ADR-65) | Porteur | Après mesure de latence (action 3) et avis du juriste | Tous les services AWS |
| 2 | AWS RDS PostgreSQL 17 | Base centrale | PostgreSQL 17 local en Docker | Porteur + nous | Quelques jours | Mise en ligne |
| 3 | AWS KMS | Clés des bracelets, snapshots, autorité des terminaux, jetons d'appareil | Faux (`fake-kms`), refusés en production | Porteur (compte) + nous (mission 12b) | Après le compte AWS | Bracelets, hors ligne, terminaux en production |
| 4 | AWS Secrets Manager | Identifiants PSP et secrets de webhooks, par détenteur des fonds | Faux coffre, refusé en production | Nous (mission 12b) | Après le compte AWS | Paiements réels |
| 5 | AWS S3 Object Lock (compte distinct) | Copie du scellement du journal, en écriture unique | Non branché | Porteur (second compte) + nous | Après le compte AWS | Scellement hors base (SPEC § 13.7) |
| 6 | AWS CloudWatch (+ OpenTelemetry) | Journaux et mesures | Journal JSON local | Nous | À la mise en ligne | Exploitation |
| 7 | Wave Business | Recharges mobile money | Faux adaptateur | Porteur (compte) + nous | Quelques semaines | Recharges Wave |
| 8 | Orange Money (marchand) | Recharges mobile money | Faux adaptateur | Porteur (compte) + nous | **Plusieurs semaines** : à lancer maintenant | Recharges Orange Money |
| 9 | PayDunya | Carte, agrégateur local | Faux adaptateur | Porteur (accès de test) + nous | Quelques jours à semaines | Carte via agrégateur |
| 10 | Stripe | Carte, PSP international | Faux adaptateur | Porteur (vérifier XOF et Sénégal) + nous | Incertain : éligibilité à vérifier | Carte internationale |
| 11 | SMS principal local | Codes à usage unique (Orange, Free, Expresso) | Pas encore de code (mission 10a, faux) | Porteur (devis, nom d'expéditeur) + nous | 5 à 10 jours pour le nom d'expéditeur (RCCM) | Connexion festivalier |
| 12 | SMS de repli international | Repli des codes | Idem | Porteur (devis) + nous | Quelques jours | Fiabilité des codes |
| 13 | WhatsApp (fournisseur agréé Meta) | Premier canal des codes | Idem | Porteur (devis, modèle de message) + nous | Validation du modèle par Meta | Codes par WhatsApp |
| 14 | Serveur d'identité OIDC | Connexion des personnes (back-office, approbations) | Faux serveur en test seulement ; rien en local (`ACCES-API.md` § 3) | Porteur (choix) + nous | Selon le choix | Back-office, approbations réelles (OP-N56) |
| 15 | NXP (puce des bracelets) | Signature d'originalité des puces | Vérifiée par le poste seulement (OP-N46) | Porteur (bracelets réels, action 1) | Demi-journée de tests | Personnalisation et lecture réelles |
| 16 | Google, attestation Android (Key Attestation) | Prouver qu'un terminal Android est authentique | Branché, racines en configuration | Nous (configuration) | Aucun compte | Enrôlement Android |
| 17 | Apple App Attest | Prouver qu'un terminal iOS est authentique | Branché, racine en configuration | Porteur (compte développeur Apple) | Ouverture du compte | Enrôlement iOS |
| 18 | Matériel de clés de la passerelle | Clés non exportables du mini-PC | Faux en mémoire ; `hardware` refuse de démarrer faute d'adaptateur | Porteur (choix du matériel) + nous | Selon le matériel | Passerelle en production |
| 19 | GitHub | Dépôt et intégration continue | En place (`.github/workflows/ledger-tests.yml`) | — | — | — |
| 20 | jsDelivr (CDN) | Page `/docs` (Swagger UI) | En place, hors production seulement | — | — | — |
| 21 | ngrok | Partager l'API locale de test | En place (`demarrer-local.sh`) | Porteur (jeton ngrok) | — | Intégration par une équipe cliente |

## 2. Détail, service par service

### 2.1 AWS : compte, région, droits

- **À faire (porteur)** : ouvrir le compte AWS de production ; confirmer la région (`eu-west-3` provisoire) après la
  mesure de latence depuis Dakar (action 3 : Orange, Free, Expresso) et l'avis du juriste sur la localisation des
  données (action 8). Ouvrir un **second compte AWS** pour le stockage du scellement (§ 2.5).
- **Comment** : un rôle IAM **par processus** (SPEC § 3.2, § 13.2) : API publique (sans `kms:Decrypt` ni
  `kms:GenerateMac` sur les clés des bracelets), service des clés de bracelet, personnalisation, contrôle quotidien,
  signature des snapshots (`snapshot-signer` : `kms:Sign` seul), contenu des snapshots (`snapshot-content`). Aucune
  clé d'accès AWS longue durée sur un poste ; les processus prennent leur rôle.
- **Mission** : 12b (« Intégrations réelles »).

### 2.2 RDS PostgreSQL 17

- **À faire** : vérifier que PostgreSQL 17 est disponible sur RDS dans la région retenue (ADR-55, ADR-78) ; instance
  chiffrée, sauvegardes automatiques, accès réseau privé seulement.
- **Comment** : une URL de connexion par rôle de base (`DATABASE_URL_APP`, `_PLATFORM`, `_TAGKEYS`, `_PERSO`,
  `_TAGCHECK`, `_KEYADMIN`, `_MAINT`, `_SNAPCONTENT`, `_SNAPSIGN`, `_OWNER` pour les migrations). Les mots de passe des
  rôles vont dans Secrets Manager, jamais les valeurs de test de `tools/dev-db/env.sh`. Migrations :
  `npm run migrate -w @cashless/ledger-sql`.

### 2.3 AWS KMS

- **Sert à** : clés maîtres des bracelets (`MacPort`, `DataKeyPort`, `DecryptPort`, `KeyAdminPort`, OP-N41) ;
  signature des snapshots (`SignPort`, ECDSA P-256, signature DER) et chiffrement de leur contenu (OP-N89, ADR-138) ;
  autorité des terminaux et signataire des jetons d'appareil (OP-N73).
- **Aujourd'hui** : faux (`apps/api/src/kms/fake-kms.ts`, clés dérivées d'une graine écrite dans le code). La garde de
  démarrage refuse ce faux en production (`production-guard.spec.ts`).
- **Comment** : créer les clés dans KMS, donner leur référence à l'API (par exemple `SNAPSHOT_SIGNING_KEY_REF`), écrire
  les adaptateurs AWS derrière les ports existants (mission 12b), puis lever la garde de production **port par port**,
  seulement pour un adaptateur essayé contre le vrai KMS.
- **Exception** : la clé de signature des snapshots de la passerelle n'est pas dans KMS (SPEC § 9.4) ; voir § 2.18.

### 2.4 AWS Secrets Manager

- **Sert à** : identifiants PSP et secrets de webhooks, **rangés par détenteur des fonds**, jamais partagés entre
  détenteurs (SPEC § 11.1) ; secrets applicatifs (`VENDOR_PIN_SECRET`, `IDEMPOTENCY_HMAC_KEY`,
  `CLAIM_CODE_HMAC_KEY`, `ENROLLMENT_CODE_HMAC_KEY`…) et mots de passe des rôles de base.
- **Comment** : adaptateur AWS derrière le port du coffre (`PSP_SECRET_STORE`), mission 12b ; dépendance vérifiée et
  épinglée selon `docs/08-pile-logicielle.md`.

### 2.5 S3 Object Lock (compte distinct)

- **Sert à** : copier chaque scellement du journal (`ledger_seal`) hors de la base, en écriture unique (mode
  conformité), sous un compte AWS distinct de celui de la base (SPEC § 13.7).
- **Comment** : bucket avec Object Lock activé à la création ; un rôle qui peut seulement écrire.

### 2.6 Observabilité (CloudWatch, OpenTelemetry)

- **Comment** : `pino` / `nestjs-pino` puis export vers CloudWatch ; OpenTelemetry à fixer à l'introduction
  (`docs/08-pile-logicielle.md` § 1). Aucun secret ni donnée personnelle dans les journaux.

### 2.7 à 2.10 Prestataires de paiement (Wave, Orange Money, PayDunya, Stripe)

- **À faire (porteur, action 11, ADR-70)** : ouvrir un compte **Wave Business** et un compte **marchand Orange
  Money** (accès de test et documentation des API ; Orange Money prend plusieurs semaines) ; obtenir les accès de test
  **PayDunya** et **Stripe** ; vérifier pour Stripe l'ouverture de compte et le versement en XOF pour un marchand
  établi au Sénégal. Avant d'activer un PSP pour un organisateur : agrément BCEAO pour un acteur local (SPEC § 11.1).
- **Titulaire** : le **détenteur des fonds** de l'événement, pas la plateforme ; ses identifiants vont dans Secrets
  Manager sous son nom.
- **Comment** : un adaptateur par PSP derrière l'interface commune (`PspAdapter` : initier un paiement, vérifier un
  webhook, interroger un statut, lire un relevé). Webhooks entrants vérifiés par signature avant tout traitement,
  stockés bruts, traités de façon idempotente ; carte : 3-D Secure obligatoire (ADR-77). Configuration par organisateur
  (`psp_configuration`, `event_psp_selection`). Mission 12b (ex-6b), plus le remboursement des paiements non crédités
  (OP-N81, OP-N82). Tant que ce n'est pas fait : **aucune recharge en ligne en production**.
- **À transmettre à l'équipe** : seulement l'existence des accès de test ; les identifiants eux-mêmes sont posés
  directement dans Secrets Manager par le porteur.

### 2.11 à 2.13 Codes à usage unique (SMS principal, SMS de repli, WhatsApp)

- **À faire (porteur, action 10, ADR-66)** : demander les devis d'un **SMS principal local** couvrant Orange, Free et
  Expresso, d'un **SMS de repli international** et d'un **fournisseur WhatsApp agréé Meta** ; lancer la validation du
  **nom d'expéditeur SMS** (RCCM, 5 à 10 jours) et du **modèle de message WhatsApp**.
- **Comment** : port `OtpSender`, chaîne WhatsApp, puis SMS principal (bascule à 10 s, `otp_whatsapp_timeout_seconds`),
  puis SMS de repli (20 s, `otp_sms_failover_seconds`) ; limites `429 OTP_RATE_LIMITED`. Routes
  `/customer-auth/otp` et suivantes : déclarées dans `openapi.yaml`, **pas encore implémentées** (mission 10a, avec des
  faux fournisseurs) ; fournisseurs réels en mission 12b. D'ici là, le serveur simulé Prism (`ACCES-API.md`) répond à
  ces routes avec les exemples du contrat.

### 2.14 Serveur d'identité OIDC

- **Sert à** : connexion des personnes (back-office, app festivalier pour les jetons), authentification renforcée et
  jeton d'approbation de la seconde personne (SPEC § 3.2, § 10.3).
- **À faire (porteur)** : choisir le fournisseur (géré ou hébergé), l'ouvrir dans la région retenue.
- **Comment** : l'API vérifie les jetons (bibliothèque `jose`) avec `OIDC_ISSUER`, `OIDC_JWKS_URI`, `OIDC_AUDIENCE`,
  `OIDC_APPROVAL_AUDIENCE`. Aujourd'hui, seul un faux serveur existe dans les tests (`apps/api/test/support/fake-idp.ts`).
  Mission 12b (OP-N56 : preuve de la personne qui décide une approbation).

### 2.15 NXP (signature d'originalité des puces)

- **À faire (porteur, action 1)** : validation de la puce sur de vrais bracelets (demi-journée) ; fournir la **clé
  publique NXP** et des **signatures réelles** pour les vecteurs de test ; demander au fournisseur de bracelets le
  surcoût d'un QR différent par bracelet (action 4).
- **Comment** : le poste lit `READ_SIG` à chaque passage et vérifie la signature (clé NXP embarquée) ; vérification
  serveur à la personnalisation en mission 12b (OP-N46).

### 2.16 Attestation Android (Google)

- **Comment** : aucun compte ; configuration `ANDROID_ATTESTATION_ROOTS` (racines Google publiées),
  `ANDROID_APP_PACKAGE`, `ANDROID_APP_SIGNING_DIGESTS` (empreinte du certificat de signature de l'app terminal). Limite
  acceptée : OP-N67 (ADR-110). Play Integrity : décision en recette.

### 2.17 Apple App Attest

- **À faire (porteur)** : compte développeur Apple (identifiant d'équipe et identifiant d'app).
- **Comment** : `IOS_TEAM_ID`, `IOS_BUNDLE_ID`, `IOS_APP_ATTEST_ROOT`. Limite acceptée : OP-N64 (ADR-106), réexaminée
  par la mission 12.

### 2.18 Matériel de clés de la passerelle

- **Sert à** : garder les clés du mini-PC de la passerelle sans jamais pouvoir les exporter (R-27), et les détruire à
  la révocation (OP-N106).
- **Aujourd'hui** : port `HARDWARE_KEYSTORE` ; le faux garde les clés en mémoire ; `HARDWARE_KEYSTORE=hardware` refuse
  de démarrer faute d'adaptateur (WP16 de la mission 8). La passerelle ne peut donc pas tourner en production tant que
  l'adaptateur n'existe pas.
- **À faire (porteur)** : choisir le matériel (puce TPM du mini-PC ou clé matérielle) ; mission de l'adaptateur **à
  fixer** (proposée : 12b).

### 2.19 à 2.21 Outils de développement

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
| 1, 2, 4 | Fournisseur de bracelets, campagne de mesure des téléphones | Avant le code de l'app terminal | Lecture NFC, liste des téléphones |

## 4. Ordre conseillé

1. **Maintenant** : Orange Money et Wave (délais longs), devis OTP et nom d'expéditeur SMS, choix de l'auditeur et du
   juriste, questions à l'expert-comptable.
2. **Puis** : mesure de latence, confirmation de la région, compte AWS (et second compte pour le scellement), compte
   développeur Apple, choix du serveur d'identité et du matériel de clés de la passerelle.
3. **Mission 12b** : tous les adaptateurs réels, chacun essayé contre le bac à sable du service, puis levée de la garde
   de production port par port.
