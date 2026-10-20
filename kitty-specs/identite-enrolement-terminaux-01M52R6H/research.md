# Research — mission identite-enrolement-terminaux-01M52R6H

Date : 2026-10-19. Chaque point donne la décision, sa raison et les options écartées. Les décisions du porteur sont
dans le dossier `decisions/` (identifiants `DM-…`) ; celles qui touchent à la sécurité sont signalées.

## R-01 — Trois preuves sur chaque requête de terminal

- **Decision** : toute route de terminal exige ensemble un certificat client valide, un jeton d'appareil valide et une
  signature valide de la requête, les trois liées au même terminal (même `device_id`, même clé de signature).
- **Rationale** : décision du porteur au specify (`DM-01M52R88ZPZEA0NXVSDY9PBXW5`) ; condition de levée d'OP-N42.
  Chaque preuve couvre un vol différent : le jeton seul se rejoue s'il fuit d'un journal ; le certificat seul ne lie pas
  le contenu ; la signature lie le contenu et empêche le rejeu.
- **Alternatives considered** : jeton seul ou mTLS seul (§10.3, contrat) — une défense en moins.

## R-02 — Contradiction avec §10.3 et le contrat

- **Decision** : le contrat est modifié (`security` des routes de terminal = une seule entrée qui combine `deviceMtls`,
  `deviceToken` et un nouveau schéma `deviceSignature` ; le texte « l'un OU l'autre » est remplacé) ; ADR-107 consigne
  le renforcement et la contradiction avec §10.3, signalée au porteur (règle §0.3).
- **Rationale** : renforcement de sécurité, fait puis consigné (règle 1 de `CLAUDE.md`). En OpenAPI, deux entrées dans
  `security` signifient « ou » : le contrat actuel permet littéralement l'un ou l'autre.
- **Alternatives considered** : laisser le contrat permissif et durcir dans le code — le contrat ne décrirait plus
  l'API servie (C-008).

## R-03 — mTLS vérifié dans les processus

- **Decision** : les processus HTTP (API publique, clés de bracelet) écoutent en HTTPS (`node:https`) avec
  `requestCert: true` et `rejectUnauthorized: false`, l'autorité des terminaux comme seule autorité cliente (`ca`).
  La garde exige `socket.authorized === true` **et** l'empreinte SHA-256 du certificat égale à `device.cert_sha256`.
  En production, le répartiteur est en passage TCP ; aucune écoute en clair.
- **Rationale** : décision du porteur au plan (`DM-01M59SAEYDXFK29HMMFBTJ96KS`) : aucun en-tête de répartiteur n'est
  cru. `rejectUnauthorized: false` est nécessaire parce que les personnes et la route d'enrôlement n'ont pas de
  certificat ; le refus est fait par la garde, route par route, et une route de terminal ne peut pas être servie sans.
- **Révocation** : pas de CRL ni d'OCSP. Le terminal est relu en base à chaque requête (statut, empreinte) : un
  terminal révoqué est refusé à la requête suivante (NFR-003).
- **Alternatives considered** : terminaison au répartiteur avec en-tête (écartée par le porteur) ;
  `rejectUnauthorized: true` sur un port séparé pour les terminaux (deux ports, deux aiguillages ; gardé comme option
  d'exploitation, sans changement de code de la garde).
- **Réglages TLS** : `minVersion: 'TLSv1.3'` (pas de renégociation) ; certificat lu par `getPeerX509Certificate()` ;
  `validTo` revérifié à chaque requête (une session reprise ne revérifie pas l'expiration) ; l'autorité des terminaux
  est distincte de celle de la passerelle (`edgeMtls`).
- **Adresse du client** : en passage TCP, aucun répartiteur n'ajoute `X-Forwarded-For` ; la garde de démarrage refuse
  la production si TLS est servi par le processus et `TRUST_PROXY_HOPS > 0` (sinon Express croirait un en-tête forgé
  par le client, OP-N53). Le protocole PROXY v2 reste une option d'exploitation ultérieure.
- **Conséquence** : le certificat serveur des processus est un réglage de déploiement (`TLS_CERT_FILE`,
  `TLS_KEY_FILE`) ; en test, il est produit par le terminal de test.

## R-04 — Profil de signature des requêtes

- **Decision** : profil restreint de RFC 9421 (HTTP Message Signatures) :
  - algorithme `ecdsa-p256-sha256`, `keyid` = `device_id` ;
  - composants couverts, dans cet ordre et tous obligatoires : `"@method"`, `"@authority"`, `"@path"`, `"@query"`,
    `"content-digest"` (RFC 9530, `sha-256` seul, présent même pour un corps vide, calculé sur les octets bruts du
    corps : `rawBody: true` dans `NestFactory.create`), `"x-request-id"`, et `"idempotency-key"` sur toute route
    d'écriture (obligatoire sur ces routes) ; `@authority` empêche de rejouer au central une requête signée pour la
    passerelle locale (routes `x-edge-available`, table de nonces distincte) ;
  - paramètres obligatoires : `created` (secondes Unix), `nonce` (128 bits au moins, base64url), `keyid`, `alg` ;
    `expires` refusé ;
  - un seul libellé de signature, `dev` ; toute autre signature est ignorée.
- **Encodage** : signature ECDSA au format brut `r ‖ s` (`dsaEncoding: 'ieee-p1363'` de `node:crypto`).
- **Analyse** : `Signature-Input` et `Signature` sont des Structured Fields (RFC 8941) analysés par
  `structured-headers@2.1.0` (2026-09-11, sans dépendance ni script) plutôt qu'à la main.
- **Rejeu** : une seule source d'heure, celle de la base (`now()` lu dans la transaction de consommation du nonce),
  pour la fenêtre comme pour la purge. `created` dans `[now − tolérance, now + tolérance]` ; `clock_tolerance_seconds`
  borné à 300 s au plus (contrôle de la base sur le réglage). Le nonce n'est inséré qu'**après** vérification du
  certificat, du jeton et de la signature (aucune écriture pour une requête non authentifiée). `expires_at = created +
  2 × tolérance` (marge) ; purge par lots des lignes expirées. RLS forcée sur `device_request_nonce`.
- **Horloge hors tolérance** : après vérification du certificat et du jeton, réponse `400 CLOCK_SKEW_TOO_LARGE`
  (code existant au contrat) avec l'heure serveur en en-tête `Date`, pour que le terminal se recale ; contradiction
  avec « sans dire quel élément a échoué » tranchée ainsi (§0.3 : le contrat a le code).
- **Rationale** : un format normalisé a des implémentations de référence en Dart et en Kotlin pour l'app (mission 12) ;
  couvrir `@path` et `@query` empêche de rejouer une signature sur une autre route ; `content-digest` lie le corps.
- **Alternatives considered** : format maison (en-tête unique sur méthode, chemin, empreinte du corps) — plus court,
  mais à spécifier et à porter sans référence ; JWS détaché du corps — ne couvre pas la méthode ni le chemin.
- **Refus** : `401 DEVICE_SIGNATURE_INVALID` (code nouveau au contrat), sans dire quel élément a échoué.

## R-05 — Attestation Android

- **Decision** : la chaîne `key_attestation_chain` (feuille en premier) est vérifiée avec `node:crypto`
  (`X509Certificate.verify`) jusqu'à une racine de `ANDROID_ATTESTATION_ROOTS` (racines Google) ; chaque certificat de
  la chaîne est absent de la liste de révocation Google (`android.googleapis.com/attestation/status`, mise en cache,
  rafraîchie toutes les heures ; plus de 24 h sans rafraîchissement → enrôlement Android refusé). L'extension
  KeyDescription (OID `1.3.6.1.4.1.11129.2.1.17`) de la feuille est analysée par `@peculiar/asn1-android` et doit
  donner :
  - `attestationChallenge` = défi Android (R-08) ;
  - `attestationVersion` ≥ 100 (Keymint, Android 12+) ; `attestationSecurityLevel` et `keymasterSecurityLevel` ∈
    {`TrustedEnvironment`, `StrongBox`} ;
  - lus dans la liste matérielle (`teeEnforced`/`hardwareEnforced`), jamais dans `softwareEnforced` : `origin =
    GENERATED` (une clé importée est connue hors du Keystore : c'est le vrai contrôle de non-exportabilité), `purpose`
    ⊇ {`SIGN`}, `algorithm = EC`, `ecCurve = P-256`, `rootOfTrust` (`deviceLocked = true`, `verifiedBootState =
    Verified`) ;
  - `osPatchLevel`, `vendorPatchLevel`, `bootPatchLevel` ≥ seuil réglable (`ANDROID_MIN_PATCH_LEVEL`) ;
  - `attestationApplicationId` : un seul paquet, le paquet attendu, et **toutes** ses empreintes de signature dans
    l'ensemble autorisé ; **seul champ lu dans `softwareEnforced`** (le Keystore l'y écrit sur les vrais appareils ;
    valeur matérielle prioritaire si présente) — écart accepté par le porteur le 19/10/2026, OP-N67, ADR-110 ;
  - extension KeyDescription présente dans la feuille seulement ;
  - chaînage explicite (émetteur = sujet du suivant, dates de chaque certificat, contraintes de base des
    intermédiaires) en plus de `X509Certificate.verify` ;
  - liste de révocation : statut `REVOKED` **ou** `SUSPENDED` refusé, numéro de série comparé en hexadécimal
    minuscule ;
  - clé publique de la feuille = `signing_public_key` annoncée.
- **Android 12 minimum** (décision du porteur, `DM-01M59WNTT06K1SY81HBK6PT4E8`) : la clé d'accord ECDH n'est
  matérielle qu'à partir de l'API 31 (`PURPOSE_AGREE_KEY`). L'enrôlement exige donc aussi une **seconde chaîne
  d'attestation**, celle de la clé d'accord (`agreement_attestation_chain`, ajoutée au contrat), avec les mêmes
  contrôles et `purpose` ⊇ {`AGREE_KEY`}. Sous Android 12, `422 ATTESTATION_FAILED`.
- **Racines Google** : la liste à jour (rotation de racine annoncée par Google) est vérifiée au moment de configurer
  `ANDROID_ATTESTATION_ROOTS`.
- **Rationale** : exigences du contrat (`enrollDevice`) et de §13.4 ; décision du porteur (`DM-01M59RR2KCM2NMTGNR62HXJD76`).
- **Alternatives considered** : Play Integrity (appel à Google à chaque enrôlement, jeton opaque, ne lie pas la clé) —
  écarté ; vérification sans liste de révocation — une racine Google compromise ou un appareil connu volé passerait.
- **Clé d'accord** : attestée par sa propre chaîne (Android 12+) et liée à l'enrôlement par le défi de la clé de
  signature (R-08).

## R-06 — Attestation iOS et limite consignée (écart de sécurité accepté)

- **Decision** : l'objet App Attest (`key_attestation_chain[0]`, CBOR décodé par `cbor2`) est vérifié selon la
  procédure d'Apple : `fmt = apple-appattest` ; chaîne `x5c` jusqu'à la racine Apple App Attestation
  (`IOS_APP_ATTEST_ROOT`) ; nonce = SHA-256(`authData` ‖ SHA-256(défi)) égal à l'extension
  `1.2.840.113635.100.8.2` ; `rpIdHash` = SHA-256(`<team_id>.<bundle_id>`) ; compteur = 0 ; `aaguid` =
  `appattest` (la valeur `appattestdevelop` est refusée en production, garde de démarrage) ; `credentialId` =
  identifiant de clé = SHA-256 de la clé publique attestée.
- **Limite** (décision du porteur au plan, `DM-01M59SD0YNWKK8R4EKT2T7THJK`) : App Attest atteste sa propre clé, pas la
  clé de signature ECDSA du terminal. Le défi couvre les clés publiques de signature et d'accord (R-08) : un tiers ne
  peut pas substituer ses clés à celles de l'instance attestée, mais on ne prouve pas que la clé de signature iOS est
  non exportable.
- **Consignation** : OP-N64 et ADR-106 (risque, raison, mission qui le réexamine : mission 12, app terminal ; condition
  de levée : signer les requêtes iOS par assertion App Attest ou preuve équivalente) ; test de borne : un terminal iOS
  n'a jamais `nfc_enabled` (contrainte de `device`) et `POST /media/auth-keys` refuse un terminal iOS ; report dans
  `PROMPTS-A-ENVOYER.md` et `PRD.md` (mission 12).
- **Alternatives considered** : assertion App Attest sur chaque requête iOS (deux formats de signature ; écartée par le
  porteur pour cette mission).

## R-07 — Jeton d'appareil et rafraîchissement

- **Decision** :
  - jeton d'appareil : JWT ES256, claims du contrat : `sub` = `device_id`, `operator_id`, `serial`, `event_id`, `cnf`
    (`jkt` = empreinte JWK, RFC 7638, de la clé de signature) ; plus `iss`, `aud` = `cashless-device`, `typ` =
    `device+jwt`, `fid` (famille de jetons), `exp` = 15 min, `jti`. Vérification : ES256 seul, `typ`, `iss`, `aud`.
    `operator_id` et `event_id` du jeton ne sont jamais crus : relus en base. La famille `fid` est vérifiée non révoquée
    à chaque requête (même lecture que le terminal) : une famille révoquée invalide aussitôt ses jetons d'appareil ;
  - jeton de rafraîchissement : 256 bits aléatoires (`drt_` + base64url), seule son empreinte SHA-256 est gardée (pas
    de secret de hachage : entropie de 256 bits) ; durée 30 jours ; famille par enrôlement ; usage unique ;
  - échange en cours sur le même jeton (verrou pris) : `409`, à réessayer ; ce n'est pas une réutilisation ;
  - **grâce de 60 s** (décision du porteur, `DM-01M59WNZSSTN4YP1W38GPTHMMP`, écart consigné OP-N65, ADR-108) : le jeton
    consommé représenté une seule fois dans les 60 s par le même terminal, avec mTLS et preuve de possession valides,
    donne une nouvelle paire et révoque la paire émise et jamais utilisée ; au-delà (seconde représentation, plus de
    60 s, autre certificat) : toute la famille est révoquée, ligne d'audit `DEVICE_TOKEN_REUSE`, refus `401` ; le
    terminal doit être ré-enrôlé ;
  - preuve de possession du contrat, avec séparateur de domaine : signature de `"cashless-refresh-v1" ‖ 0x00 ‖ nonce ‖
    0x00 ‖ serial ‖ 0x00 ‖ refresh_token` ; **et** mTLS sur cette route
    (renforcement : le contrat la déclare `security: []`) ; la route n'exige pas le jeton d'appareil (il peut être
    expiré).
- **Rationale** : contrat (`deviceToken`, `refreshDeviceToken`) ; §13.2 (clés de signature hors du code et de
  l'environnement : port, adaptateur KMS après OP-N11).
- **Alternatives considered** : jeton opaque en base au lieu d'un JWT (plus simple, mais contraire au contrat) ;
  HMAC (HS256) par le port MAC existant (clé partagée entre processus).

## R-08 — Défi d'enrôlement

- **Decision** : sur Android, le défi d'attestation est fixé à la génération de la clé (`setAttestationChallenge`) :
  il ne peut pas contenir la clé qu'il atteste. Ordre imposé : le terminal scanne le code, **puis** génère ses clés.
  - Android : clé d'accord générée avec le défi `A = SHA-256("cashless-enroll-v1/agree" ‖ code normalisé ‖ serial)` ;
    puis clé de signature avec le défi `S = SHA-256("cashless-enroll-v1/sign" ‖ code normalisé ‖ serial ‖ SPKI de la
    clé d'accord)`. Chaque clé est liée par la feuille de sa chaîne ; la clé de signature lie la clé d'accord.
  - iOS : `clientDataHash = SHA-256("cashless-enroll-v1/ios" ‖ code ‖ serial ‖ SPKI signature ‖ SPKI accord)` (la
    clé App Attest est distincte).
  Les champs sont de longueur fixe ou préfixés par leur longueur (pas d'ambiguïté de concaténation).
- **Rationale** : le code est à usage unique et secret : il apporte la fraîcheur sans aller-retour supplémentaire ;
  inclure les clés publiques et le `serial` lie l'attestation à ce qui est enregistré (et sur iOS, à la clé non
  attestée, R-06). Un code qui fuit (QR photographié) ne permet que d'enrôler un appareil réellement attesté de l'app
  attendue, une seule fois ; les essais sont limités (R-16).
- **Alternatives considered** : route de défi servi par le serveur (un aller-retour et une table de plus, sans gain :
  le code joue ce rôle).

## R-09 — CSR et certificat client

- **Decision** : `csr_pem` devient obligatoire. Le CSR (PKCS#10, analysé par `@peculiar/x509`) doit porter la clé
  publique `signing_public_key` et être signé par elle. L'autorité émet un certificat : sujet `CN=<device_id>`,
  `O=<operator_id>`, extensions `basicConstraints CA:false` (critique), `keyUsage digitalSignature` (critique),
  `extendedKeyUsage = clientAuth`, durée 365 jours (réglable, 1 à 730), numéro de série
  aléatoire de 128 bits. Le sujet demandé par le CSR est ignoré. L'empreinte SHA-256 du certificat va dans
  `device.cert_sha256` ; le certificat n'est pas conservé.
- **Rationale** : le certificat lie le transport à la clé du terminal (même clé que les signatures) ; une seule clé à
  protéger dans le Keystore.
- **Alternatives considered** : certificat court (90 jours) avec route de renouvellement — non retenu par le porteur à
  l'alignement ; à l'expiration, le terminal est ré-enrôlé.

## R-10 — Configuration servie

- **Decision** : `DeviceConfig` est servi conforme au schéma requis du contrat : affectation, mode, `terminal_settings`
  (réglages de l'événement), `offline_policy` = `effective_offline_policy(terminal)` (téléphone personnel :
  `offline_enabled = false`), `seq.next_seq_floor`, `server_time`, `clock_tolerance_seconds` ; `snapshot_keys` = liste
  vide, `debit_authority` = `CENTRAL` d'époque 0 tant que la mission 8 n'existe pas, catalogue absent ou vide (mission
  5b). `config_id` = empreinte stable du contenu ; ETag = `config_id`.
- **Rationale** : servir un contenu valide et vide plutôt qu'inventé ; un terminal ne peut rien faire hors ligne sans
  clé de snapshot (refus par défaut, §9).
- **Alternatives considered** : refuser la route jusqu'aux missions ultérieures — le terminal ne pourrait pas lire ses
  réglages.

## R-11 — Dettes de la base

- **OP-N59** : migration `0021` qui, pour chaque fonction de `pg_proc` avec `prosecdef` dans le schéma `public`, fait
  `ALTER FUNCTION … SET search_path = public, pg_temp` ; et `REVOKE TEMPORARY ON DATABASE <base> FROM PUBLIC` dans
  `post-roles.sql`, en SQL dynamique sur `current_database()` (les rôles `cashless_*` n'en ont plus). Les deux, par
  défense en profondeur. Un `CREATE OR REPLACE` postérieur efface le `SET search_path` : le test qui parcourt le
  catalogue tourne après toutes les migrations et `post-roles.sql`, et toute migration future qui crée une fonction
  `SECURITY DEFINER` doit fixer `search_path`. La suite de référence
  (`gen_tests.py`) crée ses tables temporaires comme propriétaire : à vérifier au premier lot ; si elle les crée sous
  `app_test`, le droit est accordé à ce seul rôle de test. Test : table temporaire de même nom sans effet sur chaque
  `tenant_of_*`, création refusée pour chaque `cashless_*`, et aucune fonction `SECURITY DEFINER` sans `pg_temp` en
  dernier (empêche une régression future).
- **OP-N44** : `gen_tests.py` accorde explicitement `EXECUTE` à `app_probe` au lieu de compter sur `PUBLIC` (la
  vérification « fonctions de bascule exposées » est conservée) ; `post-roles.sql` fait `REVOKE EXECUTE ON ALL
  FUNCTIONS IN SCHEMA public FROM PUBLIC` puis accorde à chaque rôle (`cashless_app`, `cashless_platform`,
  `cashless_tagkeys`, `cashless_perso`, `cashless_tagcheck`, `cashless_keyadmin`) la liste de ses fonctions. Comme
  `roles.sql` accorde `EXECUTE` à `cashless_app` directement, `post-roles.sql` fait d'abord `REVOKE ALL ON ALL
  ROUTINES … FROM cashless_app` puis l'accorde fonction par fonction. `ALTER DEFAULT PRIVILEGES … REVOKE EXECUTE ON
  FUNCTIONS FROM PUBLIC` pour les fonctions des migrations futures. La liste de `cashless_app` est dérivée des appels
  réels du code (test d'architecture). Extensions installées dans `public` (`pgcrypto`, `pgtap` en test) : vérifier
  qu'aucun rôle applicatif n'en a besoin (aucun appel trouvé dans le schéma), sinon les accorder nommément.
- **OP-N50** : `consume_tap` refuse une lecture dont l'identifiant est `media_claim.confirmed_tap_id` (migration
  `0024`) ; `tests_media_claim_tap.sql` passe de la borne à un test de refus.
- **OP-N54** : R-13.
- **OP-N62** : `retire_dedicated_key` n'est plus exécutable par `cashless_perso` ; une fonction
  `retire_dedicated_key_for_job(job)` exige un travail `RETIRE_KEY` `RUNNING` issu d'une demande `EXECUTED` ;
  `enqueue_tag_key_job` refuse une demande dont `expires_at` est passé (`CL023`) ; sections 6 et 7 de
  `tests_tag_key_job_approval.sql` inversées.
- **OP-N63 et droits sur les tables des terminaux** : `roles.sql` redonne à chaque rejeu `INSERT, UPDATE` sur toutes
  les tables à `cashless_app`, et des `UPDATE` par colonne sur `device`. `post-roles.sql` retire donc à
  `cashless_app` : `INSERT` sur `device` ; `UPDATE` de `status`, `public_key`, `agreement_public_key`, `cert_sha256`,
  `serial`, `os`, `operator_id` de `device` ; toute écriture sur `device_enrollment_code`, `device_refresh_token`,
  `device_status_history`, `device_request_nonce`. Ces écritures passent par les fonctions `SECURITY DEFINER` de
  `data-model.md` (un terminal révoqué ne peut pas redevenir actif par écriture directe, un code ou un jeton ne peut
  pas être remis à neuf). Tests de borne colonne par colonne, rejoués après un rejeu complet de `roles.sql` puis
  `post-roles.sql`. Les fixtures de test passent par les fonctions ou par le propriétaire.
- **`serial` par prestataire** (décision du porteur, `DM-01M59WP3HZ99VBEM3SPTQDYJSQ`) : migration `0022` remplace
  l'index `device_serial_active (serial)` du schéma de référence par un index unique `(operator_id, serial)` parmi
  les non révoqués ; `max_seen_seq` est calculé dans le prestataire. Écart au schéma de référence signalé (§0.3),
  renforcement du cloisonnement, consigné ADR-109 ; le test de référence « serial déjà utilisé par un terminal actif
  refusé » (même prestataire) reste vert. Test à deux prestataires : même `serial`, deux terminaux, aucune fuite.

## R-12 — Dépendances nouvelles (chaîne d'approvisionnement)

- **Decision** :

  | Paquet | Version | Publiée | Rôle | Scripts d'installation |
  |---|---|---|---|---|
  | `@peculiar/x509` | 2.1.0 | 2026-09-04 | CSR, émission et analyse de certificats | aucun |
  | `@peculiar/asn1-android` | 2.10.0 | 2026-09-27 | KeyDescription | aucun |
  | `@peculiar/asn1-*` (dépendances) | 2.10.0, par `overrides` nommant chaque paquet | 2026-09-27 | ASN.1 | aucun |
  | `asn1js` (transitive) | 3.0.10, par `overrides` (3.1.0 du 2026-10-16 écartée) | — | ASN.1 | aucun |
  | `cbor2` | 2.3.0 | 2026-03-05 | objet App Attest | aucun |
  | `structured-headers` | 2.1.0 | 2026-09-11 | Structured Fields (RFC 8941) | aucun |

  `overrides` nomme chaque `@peculiar/asn1-*` tiré par `@peculiar/x509` (`asn1-cms`, `-csr`, `-ecc`, `-rsa`, `-x509`,
  `-pkcs9`, `-schema`, `-x509-post-quantum`, `-x509-attr`, `-pfx`, `-pkcs8`, `-asym-key`) — npm n'accepte pas de joker ;
  `@peculiar/utils` et `tsyringe` épinglés à une version de plus de deux semaines, vérifiée au premier lot.

  Version 2.11.0 des `@peculiar/asn1-*` (2026-10-12) et `cbor-x` (dépendance native facultative `cbor-extract`, qui
  compile à l'installation) écartées. Toutes épinglées à la version exacte ; registre npm officiel ; `package-lock.json`
  committé ; `.npmrc` reçoit `ignore-scripts=true` (renforcement). Paquets existants qui ont un script
  d'installation : `esbuild`, `@swc/core`, `unrs-resolver`, `@parcel/watcher`, `fsevents` ; leurs binaires viennent
  des `optionalDependencies` : vérifier en CI et au poste que les outils fonctionnent sans ces scripts, sinon le
  signaler au porteur avant de continuer. Node : la cible est Node 22 (LTS active,
  `engines` du dépôt).
- **Rationale** : analyser à la main de l'ASN.1 et du CBOR dans du code de sécurité est plus risqué qu'une bibliothèque
  maintenue et répandue ; `node:crypto` fait toute la cryptographie (vérification des signatures et des chaînes).
- **Adversarial evidence** : passe contradictoire faite par un sous-agent relecteur sur les choix cryptographiques et
  les dépendances, avant de déclarer le plan prêt ; constats et suites données en R-15.

## R-13 — Empreinte de requête à clé (OP-N54)

- **Decision** : `requestHash` devient `HMAC-SHA256(IDEMPOTENCY_HMAC_KEY, METHOD ‖ "\n" ‖ route ‖ "\n" ‖ JCS(corps))`,
  en hexadécimal sur 64 caractères, sans préfixe (la contrainte `api_idempotency_hash_hex` de 0002 l'impose ; décision
  du porteur du 20/10/2026, qui remplace le préfixe `h1:` prévu au plan). Clé de 32 octets au moins, hors de la base, obligatoire en production (démarrage refusé sinon), même
  mécanique que `CLAIM_CODE_HMAC_KEY`. Test : l'empreinte ne se recalcule pas sans la clé, et deux clés différentes
  donnent deux empreintes.
- **Rationale** : garde la détection `IDEMPOTENCY_KEY_REUSED` sur tous les champs (l'exclusion des champs secrets la
  perdrait pour ces champs).
- **Alternatives considered** : exclusion des champs secrets par route (liste à tenir à jour, oubli possible) ; MAC par
  le KMS (un appel réseau par écriture).
- **Code d'enrôlement** : même principe, `code_hash = HMAC-SHA256(ENROLLMENT_CODE_HMAC_KEY, code normalisé)` (un code
  de 60 bits en SHA-256 simple se forcerait hors ligne pendant sa durée de validité après une fuite de la base).
- **Note** : `request_hash` de `journal_transaction` (schéma de référence) n'est pas concerné : il ne contient pas de
  secret et sert au rejeu du scénario de référence.

## R-14 — Suspension : ce qui reste permis

- **Decision** : `@DeviceAuth()` garde son comportement (suspendu → `403 DEVICE_SUSPENDED`) ; une option
  `@DeviceAuth({ allowSuspended: true })` est posée sur la configuration, le battement de cœur et, plus tard, les lots
  hors ligne et l'état de séquence. Révoqué : refusé partout.
- **Rationale** : §8.2 (un suspendu remonte ses lots mais n'autorise rien) ; le défaut reste le plus strict, une route
  oubliée est donc fermée.
- **Écart entre la garde et l'écriture** : la garde lit le statut dans sa propre transaction ; une révocation validée
  entre la garde et l'écriture métier la laisserait passer. Chaque écriture faite pour un terminal relit son statut
  dans la transaction métier (`SELECT status … FROM device … FOR SHARE`, ou contrôle dans la fonction de base qui
  écrit) ; `set_device_status` prend `FOR UPDATE`. Test : révocation pendant une requête en cours, aucune écriture
  acceptée après la révocation.

## R-15 — Passe contradictoire (19/10/2026)

Relecture indépendante par un sous-agent (lecture seule) du plan, de la recherche et des sources. Aucun constat écarté
en silence.

| # | Gravité | Constat | Suite |
|---|---|---|---|
| 1 | Bloquant | Défi Android impossible : il contenait la clé qu'il atteste | `changed` — R-08 : défi par plateforme, clés générées après le scan |
| 2 | Bloquant | Clé d'accord logicielle sous Android 12 | `changed` — porteur : Android 12 minimum, seconde chaîne d'attestation (R-05) |
| 3 | Bloquant | `serial` unique entre prestataires (fuite, blocage, `next_seq` d'autrui) | `changed` — porteur : unicité par prestataire (R-11, ADR-109) |
| 4 | Important | `roles.sql` redonne les écritures directes sur `device` et les tables S5 | `changed` — R-11 : retraits et tests de borne |
| 5 | Important | Révocation entre la garde et l'écriture | `changed` — R-14 |
| 6 | Important | Rotation stricte : un terminal légitime perd sa famille ; famille révoquée sans effet sur les jetons émis | `changed` — porteur : grâce de 60 s (OP-N65, ADR-108) ; claim `fid` vérifié (R-07) |
| 7 | Important | Composants signés : `idempotency-key`, `@authority`, octets bruts, encodage, analyseur | `changed` — R-04 |
| 8 | Important | Refus d'horloge muet | `changed` — R-04 : `400 CLOCK_SKEW_TOO_LARGE` après certificat et jeton |
| 9 | Important | Nonces : deux horloges, insertion avant authentification, tolérance non bornée, RLS | `changed` — R-04 |
| 10 | Important | Contrôles Android manquants (`origin`, listes matérielles, niveaux de correctifs…) | `changed` — R-05 |
| 11 | Important | Enrôlement sans limite de débit ; adresse du client en passage TCP | `changed` — R-03, R-16 |
| 12 | Important | Empreinte du code d'enrôlement non précisée | `accepted` — R-13 (HMAC à clé hors base) |
| 13 | Important | `personal_phone` sans source | `changed` — R-17 |
| 14 | Mineur | Épinglage des dépendances transitives incomplet | `changed` — R-12 |
| 15 | Mineur | Effets de bord des retraits de droits (droits par défaut, `cashless_app` direct, `CREATE OR REPLACE`) | `changed` — R-11 |
| — | Mineur | Certificat client : `basicConstraints`, `keyUsage`, autorité distincte | `changed` — R-03, R-09 |
| — | Mineur | Claims du jeton à aligner sur le contrat ; `typ`, `aud`, ES256 seul | `changed` — R-07 |
| — | Mineur | Preuve de possession sans séparateur de domaine | `changed` — R-07 |
| — | Mineur | TLS : `getPeerX509Certificate`, reprise de session, TLS 1.3 | `changed` — R-03 |
| — | Mineur | App Attest : `appattestdevelop`, `credentialId` | `changed` — R-06 |
| — | Mineur | mTLS en Flutter avec une clé non exportable demande un canal natif | `deferred_with_rationale` — faisabilité de la mission 12, reportée dans `PROMPTS-A-ENVOYER.md` |

## R-16 — Limites de débit de l'enrôlement

- **Decision** : `enrollDevice` répond `429` (déjà au contrat) au-delà de 10 essais par code et par heure et de 30
  essais par adresse et par heure ; compteurs en base (table `device_enrollment_attempt`, purge à 24 h), écrits dans
  une transaction distincte de l'enrôlement (un refus annulé laisse sa trace). Les lignes d'audit des refus sont
  écrites de la même façon.
- **Rationale** : un échec ne consomme pas le code (FR-004) ; sans limite, un code qui fuit permet des essais
  illimités et chaque essai coûte une vérification d'attestation.

## R-17 — Téléphone personnel

- **Decision** : `personal_phone` est un champ **obligatoire, sans défaut**, du code d'enrôlement (décision de
  l'administrateur à l'émission) ; le terminal ne le déclare pas. `true` impose `KEYPAD_TPE` et une politique effective
  sans hors ligne, sans recharge, remboursement ni caution (§8.2).
- **Rationale** : un défaut `false` donnerait le hors ligne à un téléphone personnel par oubli ; un défaut `true`
  priverait par erreur un terminal dédié. L'obligation de choisir évite les deux.
