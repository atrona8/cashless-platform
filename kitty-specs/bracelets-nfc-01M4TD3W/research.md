# Research — mission bracelets-nfc-01M4TD3W

Date : 2026-10-13. Chaque point donne la décision, sa raison et les options écartées. Les points qui touchent à la
sécurité et que la spécification ne tranche pas sont en R-12 ; ils sont soumis au porteur (C-011).

## R-01 — Quatre processus, un seul code

- **Decision** : `apps/api` garde un seul code et reçoit quatre points d'entrée (`main.ts`, `main.tag-keys.ts`,
  `main.personalization.ts`, `main.tag-check.ts`). Chacun démarre un module racine différent, avec son propre pool de
  base et ses seules capacités KMS.
- **Rationale** : §3.2 et §13.2 imposent des droits KMS séparés par service ; décision du porteur (plan, question 1).
  NestJS permet plusieurs modules racines sans dupliquer le code commun (base, erreurs, audit, identité).
- **Alternatives considered** : un seul processus avec séparation logique (écart qui affaiblit la sécurité, refusé) ;
  quatre applications séparées (duplication ou extraction du code commun, trop lourd pour la mission).
- **Conséquence** : devant les processus, un aiguillage par chemin envoie `POST /media/auth-keys` au processus des
  clés et `/media/personalizations*` au processus de personnalisation. Cet aiguillage relève de l'exploitation ; il
  est consigné dans `docs/POINTS_OUVERTS.md`.

## R-02 — Rôles de base distincts et suite de référence

- **Decision** : trois rôles de plus dans `post-roles.sql` : `cashless_tagkeys`, `cashless_perso`, `cashless_tagcheck`.
  `cashless_app` perd la lecture de `media.pwd_pack_enc`, `media.pwd_pack_dek_id`, `tag_data_key.encrypted_dek` et de
  la vue `offline_snapshot_rows` ; il perd l'insertion dans `media`, `tag_key` et `tag_data_key`.
- **Rationale** : décision du porteur (plan, question 2). Vérifié dans le kit :
  - la suite de référence écrit dans ces colonnes comme propriétaire de la base, jamais sous le rôle applicatif (elle
    n'utilise que `app_test` pour ses tests d'isolation) ; elle ne contraint donc pas les droits de `cashless_app` ;
  - les fonctions du schéma qui lisent une ligne entière de `media` (`register_tap`, `activate_media`, `release_media`,
    `replace_media`, `recover_media`, `attach_wallet`, `reassign_pool_media`, `preload_media`) sont `SECURITY DEFINER` :
    un retrait par colonne à `cashless_app` ne les casse pas ;
  - `roles.sql` (kit, non modifiable) redonne `SELECT`, `INSERT`, `UPDATE` sur toutes les tables à chaque rejeu ; les
    retraits se font donc dans `post-roles.sql`, appliqué après, comme pour `cashless_platform` en mission 3.
- **Mécanique** : `REVOKE SELECT, INSERT, UPDATE ON media FROM cashless_app`, puis `GRANT SELECT (colonnes non
  secrètes)` et `GRANT UPDATE (colonnes non secrètes)`. Le code de l'API publique ne fait donc jamais `SELECT *` sur
  `media` ; un test d'architecture le vérifie.
- **Alternatives considered** : rôle unique (une défense en moins) ; vue sans secrets pour l'API publique (les
  fonctions et les écritures viseraient encore la table).
- **Risque résiduel** : l'héritage d'`EXECUTE` par `PUBLIC` (ADR-80) vaut aussi pour les nouveaux rôles ; les fonctions
  commencent par `assert_tenant` et les politiques RLS bornent chaque rôle à ses tables.

## R-03 — Port KMS découpé par capacité

- **Decision** : quatre interfaces, une par droit : `MacPort` (`generateMac`), `DataKeyPort` (`generateDataKey`),
  `DecryptPort` (`decrypt`), `KeyAdminPort` (création et désactivation d'une clé). Un module par processus n'exporte
  que les siennes. Le faux KMS garde ses clés en mémoire, reproduit les vecteurs du kit, et compte ses appels.
- **Rationale** : la séparation des droits devient vérifiable par le graphe d'injection (test d'architecture), sans
  attendre AWS. Le compteur d'appels sert à NFR-003.
- **Alternatives considered** : une interface unique (rien n'empêche un module d'appeler une opération qui n'est pas
  la sienne).

## R-04 — Travaux de clé

- **Decision** : table `tag_key_job` (prestataire, sorte, état, charge utile, tentatives, erreur). Une demande à deux
  approuvée dans l'API publique insère un travail ; le processus qui a le droit l'exécute par tranches et de façon
  rejouable. Sortes : `CREATE_KEY`, `ROTATE_DEK`, `REENCRYPT`, `RETIRE_KEY`, `DISABLE_KMS_KEY`.
- **Rationale** : l'API publique n'a aucun droit KMS ; elle ne peut pas exécuter l'action qu'elle fait approuver.
- **Répartition** : clé de données de session et nouvelle version de rotation → personnalisation (`GenerateDataKey`, voir R-05 bis) ;
  rechiffrement → clés de bracelet (`Decrypt` des deux clés de données) ; retrait en base → `retire_dedicated_key` ;
  création et désactivation d'une clé du KMS → commande d'administration `main.key-admin.ts`, lancée à la demande par
  l'exploitant, sans route, avec son rôle de base `cashless_keyadmin` (décision du porteur, question 6). Aucun processus
  qui tourne en permanence ne peut créer ni désactiver une clé.
- **Alternatives considered** : appel HTTP interne entre processus (un canal de plus à authentifier) ; file de messages
  externe (aucune n'existe dans la pile, `08-pile-logicielle.md`).

## R-05 — Clé de données en mémoire

- **Decision** : le processus des clés de bracelet garde une clé de données déchiffrée en mémoire **5 minutes au plus**
  (`TAG_DEK_CACHE_SECONDS`, 0 à 300, défaut 300 ; 0 = aucun cache). Le tampon est mis à zéro à l'expiration et à
  l'arrêt du processus. Une entrée par (prestataire, index, version). Seule autre clé de données gardée en mémoire : la clé de session de
  la personnalisation (R-05 bis), sous la même durée.
- **Rationale** : décision du porteur (plan, question 5). Le contrat (`getMediaAuthKey`) prévoit un cache mémoire et
  prime sur la spécification (§0.3) ; §7.4 dit aussi que le KMS n'est pas appelé bracelet par bracelet. Une clé volée
  en mémoire ne vaut que pour un index et quelques minutes.
- **Alternatives considered** : aucun cache (un appel KMS par passage en caisse, et un KMS lent bloque les caisses) ;
  cache à vie du processus (écart qui affaiblit la sécurité).
- **Conséquence sur NFR-003** : « au plus un déchiffrement par requête » reste vrai ; l'effacement « avant la fin de la
  requête » vaut pour le mot de passe, la clé de données suivant la règle du cache. La spec est corrigée en ce sens.

## R-05 bis — Clé de données de session de la personnalisation

- **Constat (découvert au découpage, analyse U1)** : le tableau des services (§3.2) donne à la personnalisation
  `GenerateMac` et `GenerateDataKey`, pas `Decrypt`. Elle ne peut donc pas rouvrir une clé de données existante pour
  sceller le mot de passe d'un nouveau bracelet.
- **Decision** : une clé de données **par session de personnalisation**. Au premier bracelet d'une série, le processus
  appelle `GenerateDataKey`, enregistre une nouvelle version `ACTIVE` (la précédente passe en `DECRYPT_ONLY`) et garde
  le clair en mémoire tant que la série dure : effacé après 5 minutes sans utilisation (même réglage que R-05), à
  l'arrêt, et dès que la version n'est plus active en base.
- **Rationale** : décision du porteur n° 7 (13/10/2026). Aucun droit ajouté : c'est la lecture stricte de §3.2. Le
  schéma le permet (versions, une seule active).
- **Alternatives considered** : donner `Decrypt` à la personnalisation (droit de plus sur le processus exposé aux
  postes d'atelier : écart qui affaiblit la sécurité) ; faire sceller par le processus des clés (un canal de plus
  entre processus pour un mot de passe).
- **Conséquences** : une clé de données en clair vit aussi dans le processus de personnalisation, ce qui amende la
  décision 5 (R-05) ; les versions se multiplient, une par série, et la rotation les ramène à une seule ; le travail
  `CREATE_DEK` disparaît, une clé est utilisable dès sa création.

## R-06 — Empreinte des codes

- **Decision** : empreinte à clé, `HMAC-SHA256(secret, "CASHLESS/CLAIM/v1" || code normalisé)` pour le code de
  rattachement et `HMAC-SHA256(secret, "CASHLESS/CLAIM-CONFIRM/v1" || demande || code)` pour le code de confirmation.
  Le secret (`CLAIM_CODE_HMAC_KEY`, 32 octets) est hors de la base, obligatoire en production.
- **Rationale** : un code fait 50 bits et un code de confirmation 20 bits ; une empreinte simple se retrouve par essais
  si la base fuit. La spécification dit « empreinte » sans préciser : c'est un renforcement, confirmé par le porteur
  (alignement technique) et consigné en ADR.
- **Alternatives considered** : SHA-256 simple (retrouvable hors ligne) ; argon2 (impossible : la recherche d'un
  bracelet par son code exige une empreinte déterministe et indexable).
- **Limite** : la rotation de ce secret invalide les empreintes existantes ; elle est documentée, pas outillée.

## R-07 — Identité du terminal et du festivalier

- **Decision** : ports `DeviceIdentityPort` (rend terminal, prestataire, événement, point de vente) et
  `CustomerIdentityPort` (rend compte et appareil). Le faux lit des en-têtes de test. Le terminal désigné doit exister
  dans la table `device` et être `ACTIVE` : c'est ce que vérifient `register_tap` et la clé publique d'accord
  (`agreement_public_key`) sert à lui chiffrer le mot de passe.
- **Rationale** : décisions du porteur (spécification, questions 1 et 4). La mission 5 remplace le faux par la
  vérification du jeton et de la signature de la requête sans toucher aux routes (SC-008).
- **Dettes** (C-012) : faux terminal, faux festivalier, requêtes de terminal non signées.

## R-08 — Mot de passe jamais transmis en clair

- **Decision** : pour un terminal, l'enveloppe du contrat : ECDH-ES P-256 avec la clé d'accord de l'appareil,
  HKDF-SHA256, AES-256-GCM, AAD `"CASHLESS/PWDPACK/DEV/v1" || device_id || nfc_uid`. Pour le poste de personnalisation,
  la même construction avec une clé publique à usage unique fournie dans la requête et l'AAD
  `"CASHLESS/PWDPACK/PERSO/v1" || media_id || nfc_uid`.
- **Rationale** : règle du contrat pour le terminal ; décision du porteur pour le poste (plan, question 4).
- **Conséquence** : une réponse qui porte une enveloppe n'est pas conservée par le registre d'idempotence. Au rejeu,
  le bracelet existe déjà : le service rend l'état et une enveloppe recalculée pour la clé présentée.

## R-09 — Effets de sécurité durables

- **Decision** : pour une lecture embarquée dans une opération, l'API ouvre la transaction, appelle `register_tap` ;
  si le résultat est `UID_MISMATCH`, `SIGNATURE_MISMATCH` ou `CLONE_SUSPECTED`, elle annule cette transaction puis
  rejoue `register_tap` seul dans une transaction validée, avant de répondre l'erreur `MEDIA_*`.
- **Rationale** : §7.6, frontière 3. `register_tap` porte lui-même la liste noire et l'anomalie ; il suffit de le
  valider à part.
- **Alternatives considered** : connexion autonome dans la même requête (deux connexions tenues à la fois, risque de
  verrou croisé sur la ligne du bracelet).

## R-10 — Types Dart générés

- **Decision** : génération par un outil Dart natif épinglé (`swagger_parser`), lancé par un script du workspace
  `@cashless/contracts` ; sortie dans `packages/contracts/dart/`, vérifiée en CI comme les types TypeScript
  (régénérer puis comparer).
- **Rationale** : pas de Java dans la pile ; le SDK Dart est déjà requis par la bibliothèque.
- **Alternatives considered** : `openapi-generator` (JVM à installer en CI et sur les postes) ; types écrits à la main
  (interdit par C-008).
- **Réserve** : si l'outil ne couvre pas OpenAPI 3.1 du contrat, le repli est `openapi-generator` en CI seulement ; le
  choix final est confirmé par un essai au début du lot concerné.

## R-11 — Dépendances ajoutées et chaîne d'approvisionnement

| Dépendance | Écosystème | Usage | Contrôle |
|---|---|---|---|
| aucune | npm | la bibliothèque TypeScript n'utilise que `node:crypto` et `node:zlib` | — |
| `pointycastle` | pub.dev | AES-GCM, HMAC, SHA-256 en Dart | éditeur vérifié (bouncycastle.org), version épinglée dans `pubspec.lock`, pur Dart, sans script d'installation |
| `test` | pub.dev | tests Dart | éditeur `dart.dev` |
| `swagger_parser` | pub.dev | génération des types | outil de développement seulement, version épinglée, sortie relue et commitée |

- Registre : pub.dev seulement ; `pubspec.lock` commité ; `dart pub get --enforce-lockfile` en CI.
- Node : la CI reste sur Node 22 (LTS active, `engines` du dépôt). Le poste local est en Node 24 : écart déjà présent,
  sans effet sur `node:crypto`.
- Passe contradictoire (adversarial squad) : **reportée, avec raison**. Le projet n'autorise pas le lancement d'agents
  sans demande du porteur ; la seule dépendance de sécurité ajoutée est `pointycastle`, bibliothèque de référence, et
  ses sorties sont vérifiées octet par octet contre les vecteurs du kit et contre l'implémentation TypeScript
  (SC-001). Disposition : `deferred_with_rationale`.

## R-12 — Points où la spécification est muette ou contradictoire

| # | Sujet | Constat | Traitement |
|---|---|---|---|
| a | Clé de données en mémoire | Le contrat (`getMediaAuthKey`) parle d'un déchiffrement « mis en cache mémoire » ; §7.4 demande l'effacement à la fin et §7.4 dit aussi que le KMS n'est pas appelé bracelet par bracelet | **Décidé par le porteur** : voir « Décisions du porteur au plan » |
| b | Droit de créer et de désactiver une clé du KMS | Le tableau des services (§3.2) ne l'attribue à aucun service | **Décidé par le porteur** : voir « Décisions du porteur au plan » |
| c | Transport du mot de passe vers le poste | §7.5 dit « obtenir » sans préciser | Tranché : jamais en clair (R-08) |
| d | Empreinte des codes | « empreinte » sans algorithme | Tranché : empreinte à clé (R-06) |
| e | Identité du poste de personnalisation | Aucun rôle prévu | Tranché : rôle `PERSONALIZER` |
| f | Vérification de la signature d'originalité | Le serveur reçoit la signature ; rien ne dit qu'il la vérifie lui-même à la personnalisation | Non retenu ici : le poste vérifie (§7.5) et le serveur garde l'empreinte, comparée à chaque lecture. Une vérification par le serveur serait un renforcement, mais le kit ne fournit aucun vecteur de signature NXP pour la prouver ; consigné dans les points ouverts |

## Décisions du porteur au plan

| # | Question | Décision (13/10/2026) |
|---|---|---|
| 1 | Séparation des droits sur les clés | Un seul code, quatre processus |
| 2 | Rôles de base | Distincts ; l'API publique perd la lecture des secrets chiffrés |
| 3 | Identité du poste de personnalisation | Nouveau rôle `PERSONALIZER`, portée prestataire |
| 4 | Transport du mot de passe vers le poste | Jamais en clair : chiffré pour une clé à usage unique du poste |
| 5 | Clé de données en mémoire (R-12 a) | Cache court : 5 minutes au plus, réglable, effacé à l'expiration et à l'arrêt (R-05) |
| 6 | Droit de créer et de désactiver une clé du KMS (R-12 b) | Commande d'administration séparée, lancée à la demande, hors des quatre processus (R-04) |
| 7 | Comment la personnalisation scelle un nouveau mot de passe sans droit de déchiffrement | Une clé de données par session de personnalisation, en mémoire 5 minutes au plus sans activité (R-05 bis) |

Choix proposés au porteur le 13/10/2026 avec la question 7, appliqués faute d'objection (à rouvrir sur simple demande) :
un écart du contrôle quotidien est tracé par l'audit et le compte rendu, sans nouvelle sorte d'anomalie ; les routes
`listMyMedia` et `reportMyMediaLost` restent à la mission 10.
