# Relecture WP18, cycle 1 (preuves de bout en bout, CI, consignation)

Relecteur : claude (indépendant des implémenteurs A1, A2, B et de l'orchestrateur). Lane `lane-r`, diff = les 23
commits `feat(WP18)`/`fix(WP18)` de `b5663b1c` à `2181daf8` (hors `kitty-specs/` et hors fusions des lanes WP01-WP17) ;
consignation T086 sur `feat/identite-enrolement-terminaux` : `51b3bb4e`, `00e0911d`, `0e8096a0`. Prompt de relecture
obtenu par `spec-kitty agent action review WP18 --mission identite-enrolement-terminaux-01M52R6H --agent claude`
(lancé sans erreur ; verdict NON enregistré par le relecteur).

Exécuté par le relecteur, sans base : `npm run lint` (vert), `npm run typecheck` (vert), tests unitaires du lot
(`request-hash`, `personalization-hash`, `device-scope`, `config-device-authorities`, `identity/authentication-guard`,
`production-guard` : 6 suites, 52 tests, verts), décompte des lignes ajoutées de plus de 100 caractères. Suites sur
base : résultats de l'orchestrateur (pgTAP 2072 PASS, Jest 1704 OK / 0 échec, latences 17/17), non relancées.

## Verdict proposé

**APPROUVÉ pour le code et les tests ; consignation T086 à compléter par l'orchestrateur avant l'enregistrement
(constats M1 à M3, documents seulement, aucun nouveau cycle d'implémentation).** Aucun constat bloquant : pas d'écart
de sécurité codé en silence, pas d'écart affaiblissant hors des points ouverts (au sens de la règle 1 : M1 est une
dette prévue par C-004, pas un écart au plan). Si l'orchestrateur ne peut pas appliquer M1 à M3 avant `move-task`,
le verdict devient REJETÉ sur ces seuls points.

## Vérifications de sécurité (tenues)

- **Migration 0029** (`0029_config_served_guard.sql`) : corps identique au schéma de référence (diff vérifié) plus
  trois ajouts : `FOR SHARE` sur la ligne du terminal (conflit avec le `FOR UPDATE` de `set_device_status` ; sans
  conflit avec le `FOR NO KEY UPDATE` pris par la route dans la même transaction), `REVOKED` → `42501` avant toute
  écriture, `assert_tenant` sur le prestataire de `p_config_version` puis égalité avec celui du terminal (inconnue,
  autre prestataire, `PLATFORM` → `P0002`). `SECURITY DEFINER`, `search_path = public, pg_temp`, `REVOKE ALL FROM
  PUBLIC` ; signature inchangée, donc ni `post-roles.sql` (commentaire seul) ni `tests_execute_grants.sql` à changer.
  `tests_config_served_guard.sql` : chaque refus sous `cashless_app` et le compte des lignes écrites (0 pour chaque
  refus). Hors `gen_tests.py` : décision du porteur, appliquée et consignée dans ADR-118.
- **Migration 0030** : verrous consultatifs transactionnels de la clé d'adresse puis du code, pris AVANT les comptes,
  dans la fonction qui écrit ; ordre fixe (pas d'interblocage entre refus) ; chaque instruction plpgsql relit sous un
  nouvel instantané (READ COMMITTED, fonction VOLATILE), et le verrou n'est rendu qu'au COMMIT de l'écriture
  précédente : atomicité réelle. Au-delà d'une limite déjà tracée : `RETURN false`, rien écrit (vérifié §5 de
  `tests_enrollment_limits.sql` : 11 vrais puis 14 faux ; Jest à 40 requêtes simultanées : 11 essais, 11 audits, une
  trace `limit = code`). `enrollment_address_key` interne (aucun `EXECUTE`), colonne générée de même expression
  (testée égale), `cashless_app` sans droit sur la table. Codes HTTP d'origine gardés : décision du porteur, consignée
  dans ADR-117. Attentes de `tests_enrollment_refusal.sql` ajustées dans le sens du durcissement (pas d'attente
  relâchée).
- **ADR-116** (`request-hash.ts`, `idempotency.interceptor.ts`) : empreinte = METHOD, `baseUrl + path` (paramètres
  compris, chaîne de requête exclue), JCS de l'appelant lu sur ce que les gardes posent (`principal.userId`,
  `device.deviceId`, `customer.customerId`), corps. Les gardes Nest s'exécutent avant les intercepteurs : l'appelant
  est toujours posé. Les 22 contrôleurs `@Idempotent` sont tous gardés (personne, terminal ou festivalier) : aucune
  route idempotente réelle n'a un appelant vide (`{}` : routes de test seulement). Rejeu légitime : même personne,
  même chemin, même corps → même empreinte (test `idempotency.spec.ts` « la chaîne de requête n'entre pas dans
  l'empreinte (ADR-116) : rejeu »). Personnalisation : HMAC sous `IDEMPOTENCY_HMAC_KEY`, préfixe de domaine, personne
  liée ; `actorId` nul → 401. 409 au lieu de 422 : décision du porteur, appliquée dans ADR-116 et OP-N71.
- **`device-auth-matrix.spec.ts`** : la liste n'est pas codée en dur. Routes du contrat lues dans `openapi.yaml`
  (`security` contenant un schéma `device*`) croisées avec les routes que `DeviceGuard` protège dans les DEUX
  processus (métadonnées Nest, garde de classe ou de méthode). Échoue si : une route gardée n'a pas de cas, un cas n'est
  pas gardé, une route gardée n'est pas au contrat avec les trois preuves, une route du contrat est servie sans la
  garde (test « routes du contrat non servies : 404 »), une route n'est pas servie par l'identité réelle (nonce
  consommé exigé). Seul angle mort : une future route de terminal à la fois hors du contrat et sans `DeviceGuard`
  (elle ne serait alors pas une route de terminal au sens du contrat) ; acceptable.
- **`deviceScope`** : tout le prestataire seulement avec `OPERATOR_ADMIN` de portée `OPERATOR` sur ce prestataire
  (renforcement), test unitaire.
- **Garde de production (NFR-001)** : `device-latency.spec.ts` compile le vrai `PublicProcessModule` en production et
  vérifie un refus par faux (identité du terminal, autorité, signataire, attestation, festivalier), plus
  `DEVICE_IDENTITY_FAKE=1`, `DEVICE_CA_FAKE_KEY_FILE`, et l'absence d'import de `test/` depuis `src/`.
- **Secrets (NFR-005)** : balayage de toutes les tables `public` (liste attendue contrôlée), des journaux Nest et
  console et des corps d'erreur, sous chaque forme (texte, sans tirets, hex, octets base64url).
- **CI** : `fetch-depth: 0` ; `.npmrc` `ignore-scripts=true` vérifié puis `npm ci --ignore-scripts` ;
  `check:generated` puis `npm run generate` + `git diff --exit-code` ; ordre migrations → pgTAP (`tests/*.sql` lus
  par `test-pgtap.sh`, donc les nouvelles suites) → `reset-db` → Jest `SKIP_LATENCY=1` → mesures en série. Les clés
  HMAC de la CI sont exactement les secrets de test que `config.ts` refuse en production (décodage vérifié).

## Constats

### Bloquant

Aucun.

### Majeur

- **M1 — Dette non nommée : autorité des terminaux et signataire des jetons sans adaptateur réel.** OP-N42 est déclaré
  « levé » (`docs/POINTS_OUVERTS.md:23` et §5, ADR-88), mais `DEVICE_CA` et `TOKEN_SIGNER` n'ont que des faux
  (`device-ca/fake-device-ca.ts`, `device-tokens/fake-token-signer.ts` ; `device-latency.spec.ts:270` les remplace par
  des « réels neutres » faute d'adaptateur). Le démarrage en production est donc refusé (règle 2 tenue), comme le
  prévoit C-004 (`spec.md:256`), mais aucun point ouvert, aucun ADR et aucun report dans `PROMPTS-A-ENVOYER.md`/`PRD.md`
  ne nomme cette dette ni la mission qui la lève (seul OP-N41 couvre le KMS des bracelets). Une dette qui bloque la
  production devient invisible une fois OP-N42 fermé. **Correction attendue** : nouveau point (texte proposé
  ci-dessous), ligne dans la vue d'ensemble, report vers la mission retenue (proposition : mission 7, avec OP-N41,
  après OP-N11), et une phrase dans la levée d'OP-N42 et d'ADR-88 : « levée limitée au port d'identité ; autorité et
  signataire : OP-N73 ». Test qui borne : `device-latency.spec.ts` « faux de %s seul : démarrage refusé »
  (autorité, signataire) et `test/unit/production-guard.spec.ts`. Mission à confirmer par le porteur.
- **M2 — Report du 20/10 manquant : « Consigne aussi `DEVICE_REQUEST_AUTHORITIES` (renforcement de WP12) ».** Aucune
  mention dans `docs/DECISIONS_ADR.md`, `docs/POINTS_OUVERTS.md`, `PROMPTS-A-ENVOYER.md`, `PRD.md` (seuls les prompts
  WP12/WP18 la citent). Réglage obligatoire en production, joker refusé : un renforcement à consigner (ADR-113 ou
  nouvelle ligne d'ADR), et à reporter dans la consigne de mise en production (mission 13). Tests à citer :
  `test/unit/config-device-authorities.spec.ts` (« production : obligatoire… », « production : port joker refusé »).
- **M3 — Vue d'ensemble incomplète (T086 : « vue d'ensemble mise à jour »).** OP-N66 et OP-N67 ont leur fiche
  (`docs/POINTS_OUVERTS.md:530`, `:665`) mais aucune ligne dans le tableau d'ouverture (lignes 15-51). OP-N67 est un
  écart accepté qui affaiblit le plan (ADR-110) : il doit figurer dans la vue d'ensemble que lit la revue post-fusion.
  **Correction** : ajouter les deux lignes (OP-N67 : « Non / Non (limite acceptée le 19/10/2026) / Mission 13 »).

### Mineur

- **m1** — `docs/POINTS_OUVERTS.md`, levée d'OP-N71 : « liée à l'appelant (personne, terminal ou processus) » ; le
  code lie personne, terminal et **festivalier** (`request-hash.ts:63-72`), aucun « processus ». Aligner sur le
  contrat révisé (`idempotency.md` règle 3, exact).
- **m2** — `openapi.yaml` `DeviceTokenRefreshRequest.signature` : le motif accepte la chaîne vide, que
  `refresh.dto.ts:47` refuse (400). Ajouter `minLength: 4` (ou 88, longueur d'une signature `ieee-p1363`).
- **m3** — `.github/workflows/ledger-tests.yml:4` renvoie à `.github/CI.md` pour la répétition locale, que le lot n'a
  pas mis à jour (nouvelles variables des terminaux, `fetch-depth: 0`, dernière étape de mesures).
- **m4** — `migrate-lock.spec.ts` crée deux bases jetables sur le cluster partagé (pas sur `cashless_test`, même
  modèle que `migrate-rights.spec.ts` de WP07), alors que le partage demandait un cluster jetable du scratchpad ou un
  marquage « CI seulement ». A2 l'a vu échouer en passe parallèle (vert seul ; vert dans la batterie de
  l'orchestrateur). Risque d'instabilité en CI : consigner l'instabilité connue (mémoire du poste) ou l'exécuter seul
  en CI comme les mesures.
- **m5** — Retouches hors carte non listées une à une au compte rendu (« demandées par les reports ») :
  `refresh.spec.ts`, `admin.spec.ts`, `enrollment-codes.spec.ts`, `personalization.{dto,service,spec}.ts`,
  `idempotency.spec.ts`, `enrollment.service.ts` (commentaire), `device-admin.service.ts`, `post-roles.sql`
  (commentaire), `tests_enrollment_refusal.sql`, `openapi.yaml` et types générés. Toutes justifiées par un report ;
  une ligne chacune suffirait.
- **m6** — Lignes de plus de 100 caractères ajoutées (reformatage Prettier prévu à la fusion) : code
  `src/idempotency/request-hash.ts:1,5,9,62,74`, `src/media/personalization/personalization.dto.ts:75`,
  `personalization.service.ts:69`, `src/devices/admin/device-admin.service.ts:44` ; tests `admin.spec.ts:536,573`,
  `personalization.spec.ts:285,303,316,333`, `personalization-hash.spec.ts:2,37`, `migrate-lock.spec.ts:45,75`,
  `authentication-guard.spec.ts:2,66,67,103,112`, `config-device-authorities.spec.ts:2`,
  `device-journey.spec.ts:257` ; SQL `0030_enrollment_limit_atomic.sql:67,83`, `tests_device_purge_window.sql:5,73` ;
  `openapi.yaml:433,589,590,670,671,1221,1222,9606,10130,10131,10139,10156-10158` ; CI `ledger-tests.yml:62,63`
  (clés hexadécimales, inévitable).

## Reports des relectures (prompt) : fait / consigné / manquant

| Report | État |
|---|---|
| 20/10 `TAP_UNUSABLE` cite CL022 (lecture liée à une demande) | Fait (`c8c74660`) |
| 20/10 `@peculiar/asn1-android` 2.10.0 sur vrais appareils (mission 13) | Consigné (`PROMPTS` mission 13, `PRD.md`) |
| 20/10 Lever OP-N50, ADR-90, ADR-101 | Fait (`51b3bb4e`) |
| 20/10 Test Jest à deux connexions, verrou `media-tap-use:` | Fait (`tap-claim-race.spec.ts`, deux sens) |
| 20/10 Lever OP-N62, ADR-102 | Fait |
| 20/10 Purge `api_idempotency` / consigne ; lever OP-N54, ADR-99 | Fait (option a du porteur, T + 720 h, consignée OP-N54, ADR-99, PROMPTS, PRD) |
| 20/10 `personalizationHash` sous HMAC + test | Fait (`f9274b37`, unitaire et intégration) |
| 20/10 WP11 : `keyId` App Attest, `iosClientDataHash` (mission 12) ; App Attest réel (mission 13) | Consigné (OP-N64, PROMPTS, PRD) |
| 20/10 WP07 : lever OP-N44, OP-N59, OP-N63 ; OP-N68 à la revue | Fait ; OP-N68 listé |
| 20/10 WP07 : OP-N69 à la revue ; test du verrou de `migrate.ts` | Fait (`migrate-lock.spec.ts`, voir m4) |
| 20/10 WP12 : HTTPS réel par contrôleur + test de couverture ; lever OP-N70 | Fait (`device-auth-matrix.spec.ts`) |
| 20/10 WP12 : consigner `DEVICE_REQUEST_AUTHORITIES` | **Manquant** (M2) |
| 20/10 WP12 : historique git complet en CI | Fait (`fetch-depth: 0`) |
| 20/10 WP12 M1 (`X-Staff-Authorization`), M3 (`config.ts`) | Fait (`authentication-guard.spec.ts`, `config-device-authorities.spec.ts`) |
| 20/10 WP12 M4 (contrôle de 64 octets) | Consigné : laissé (borne indépendante de la clé), dit au compte rendu |
| 20/10 ADR-114 : test de borne des purges sous `cashless_app` ; à la revue | Fait (`tests_device_purge_window.sql`) ; listé |
| 21/10 ADR-116 / OP-N71 (chemin concret, appelant, règle 3, tests, consigne) | Fait (409 au lieu de 422 : décision du porteur, appliquée) |
| 21/10 WP16 : ré-enrôlement du `serial` après révocation back-office | Fait (`device-journey.spec.ts` étapes 7-8) |
| 21/10 WP16 : FR-025 adresse et `request_id` dans l'audit des transitions | Fait (`device-journey.spec.ts` étape 9) |
| 21/10 WP16 : `deviceScope` OPERATOR_ADMIN | Fait (`6bbfbf88`, renforcement) |
| 21/10 ADR-115 à la revue des écarts ; lignes > 100 de WP16 | Listé ; reformatage à la fusion |
| 21/10 WP14 N1 : isolation des suites qui enrôlent par la route | Tenu (`enrollment-limits.spec.ts` : /48 propre, efface ses seuls essais) |
| 21/10 ADR-117 N-a, N-b, N-c ; limite résiduelle ; écriture de `cashless_app` dans la chaîne de la plateforme | Fait (0030, tests) ; OP-N72 consigné (mission à confirmer) ; listé |
| 21/10 ADR-118 (1) 0029 + test pgTAP | Fait (hors `gen_tests.py` : décision du porteur, consignée) |
| 21/10 ADR-118 (2) `DeviceTokenRefreshRequest`, `409 CONFLICT_STATE` | Fait (409 déclaré, atteignable ; 403 ajouté au battement ; voir m2) |
| 21/10 ADR-118 (3) bout en bout révocation/suspension par le back-office ; suite complète sur la fusion | Fait (`device-journey.spec.ts` 5, 7 ; matrice R-14/ADR-115) ; suite complète verte (orchestrateur) |
| 21/10 ADR-118 (4) `request_id` dans `DEVICE_TOKEN_REUSE` | Fait (`798e7301`) |
| 21/10 ADR-118 (5) `enrollment-codes.spec.ts` par prestataire | Fait (`398c1e0b`) |

Décisions du porteur du 21/10 (409, purge option a, 0029 hors `gen_tests.py`, codes HTTP de la rafale, `PLATFORM`
refusée) : toutes appliquées et consignées (ADR-116, OP-N54, OP-N71, ADR-117, ADR-118).

Dettes déclarées levées : chaque test cité existe sous le nom donné (vérifié : « borne iOS (OP-N64) », « borne
d'OP-N65 » ×3, « requestHash (OP-N54) », « registre d'idempotence : empreinte à clé… (OP-N54) », deux tests
« ADR-116 » d'`admin.spec.ts`, « terminal : identité réelle par défaut… (OP-N42) », `device-isolation.spec.ts` « même
serial… » et « next_seq calculé… », `device-journey.spec.ts` étape 8). Tests qui échouaient avant la mission : suites
nouvelles de la mission (`tests_execute_grants`, `tests_consume_tap_claim`, `tests_tag_key_retire_guard`,
`tests_device_rights`, `device-auth-matrix`), témoin d'avant 0021 dans `tests_definer_search_path.sql`, bornes
inversées (`tests_tag_key_job_approval.sql` §6, `tests_definer_trigger_writers.sql` §4 de 77 à 0).

## Liste anti-patterns

1. Code mort : PASS (`concretePath`, `requestCaller` appelés par l'intercepteur ; `routeTemplate` gardé pour le
   journal `ROUTE_WITHOUT_TX` ; `enrollment_address_key` appelée par 0030).
2. Fixture synthétique : PASS (HTTPS réel, identité réelle, vraie base ; requêtes simultanées réelles).
3. Retour vide silencieux : PASS (`RETURN false` de 0030 documenté et testé).
4. Couverture des exigences : PASS (NFR-001, 002, 005, 007, 009 ; C-011/C-012 par la consignation, sous réserve M1-M3).
5. Surface figée : PASS (aucun `.sql` généré ni `schema_grand_livre_cashless.sql` touché ; `idempotency.md` d'une
   mission close modifié avec autorisation du partage).
6. Décision verrouillée : PASS.
7. Fichiers partagés : PASS avec note (m5).
8. Fragilité en production : PASS (`UNAUTHENTICATED` sur `actorId` nul, erreurs SQL documentées).

## Écarts de sécurité ouverts à lister à la revue post-fusion

OP-N64 (iOS, mission 12) ; OP-N65 (grâce 60 s, mission 13) ; OP-N67 (Android, liste logicielle, mission 13 ; absent
de la vue d'ensemble, M3) ; OP-N68 (droit par défaut des fonctions futures, mission 7) ; OP-N69 (colonnes de `device`,
mission 7) ; OP-N72 (pas de limite en amont de l'enrôlement, mission 13 à confirmer) ; droits plus larges acceptés :
ADR-114 (purges par `cashless_app`, borné par `tests_device_purge_window.sql`), ADR-115 (famille non opposée à l'étape
3 pour un terminal `REVOKED`), écriture par `cashless_app` dans la chaîne d'audit de la plateforme (0027) ; consigne
de déploiement non encore appliquée : purge `api_idempotency` (OP-N54, OP-N71) ; dette de production à nommer :
autorité des terminaux et signataire des jetons en faux seulement (M1).

## Points à soumettre au porteur

1. **M1 (mission qui lève la dette des adaptateurs de l'autorité et du signataire).** Risque : production impossible
   (garde) et dette invisible une fois OP-N42 fermé. Options : (a) **recommandée** — mission 7 avec OP-N41 (même
   dépendance à OP-N11, même famille d'adaptateurs AWS) ; (b) mission 13 (recette) ; (c) mission dédiée
   « exploitation ». Texte proposé :
   > **OP-N73 — Autorité des terminaux et signataire des jetons : faux seulement (C-004).** Bloque la production :
   > oui (la garde refuse le démarrage). Constat : `DEVICE_CA` et `TOKEN_SIGNER` n'ont que des faux
   > (`fake-device-ca.ts`, `fake-token-signer.ts`) ; l'adaptateur réel (KMS/HSM) attend OP-N11. Risque : aucun en
   > production (refus de démarrer) ; dette qui bloque la mise en service. Condition de levée : adaptateurs réels
   > (clé de l'autorité et clé de signature des jetons hors du code et de l'environnement, §13.2), garde levée pour ces
   > deux ports seulement. Test qui échoue si la limite s'élargit : `device-latency.spec.ts` « faux de l'autorité des
   > terminaux seul / du signataire des jetons d'appareil seul : démarrage refusé », `production-guard.spec.ts`.
2. **OP-N72** : mission 13 proposée, toujours à confirmer (déjà au compte rendu).
3. **m4** : accepter `migrate-lock.spec.ts` sur des bases jetables du cluster partagé (comme `migrate-rights.spec.ts`)
   ou le passer en étape seule de la CI. Pas un affaiblissement.

## Fichiers à faire relire par une personne

- `packages/ledger-sql/migrations/0029_config_served_guard.sql` (droits, verrou `FOR SHARE`).
- `packages/ledger-sql/migrations/0030_enrollment_limit_atomic.sql` (verrous consultatifs, colonne générée, audit).
- `packages/ledger-sql/tests/tests_enrollment_refusal.sql` (attentes modifiées), `post-roles.sql:476-477`
  (commentaire seul).
- `apps/api/src/idempotency/{request-hash,idempotency.interceptor}.ts`,
  `apps/api/src/media/personalization/{personalization.dto,personalization.service}.ts` (HMAC, liaison à l'appelant).
- `apps/api/src/devices/admin/device-admin.service.ts` (`deviceScope`).
- Liste T087 du compte rendu : complète pour le lot (elle reprend en plus les fichiers des lots WP01-WP17).

VERDICT: APPROVE (sous réserve que l'orchestrateur corrige M1, M2, M3 dans la consignation avant `move-task` ;
sinon REJECT sur ces points)
