# Relecture WP08, cycle 1 : relecteur distinct (claude)

Lot : WP08, « Socle : argon2, secret, contexte du terminal, idempotence, garde, erreurs ». Lane `lane-h`, commit
`38faf72a`. Diff relu : `git diff feat/terminaux-paiement-en-ligne...HEAD -- apps/ package.json package-lock.json tools/`
(36 fichiers).

## Verdict : APPROUVÉ

Aucun constat bloquant ni majeur. Quatre constats mineurs, à consigner (aucun ne demande de reprise du code dans ce lot).

## Vérifications faites, refus par refus (Reviewer Guidance du WP)

| Point | Résultat | Preuve |
|---|---|---|
| Secret obligatoire, distinct, refusé s'il est de test | OK | `config.ts` : `hmacKey(…'VENDOR_PIN_SECRET'…)`, ajouté à `TEST_HMAC_KEYS` et à `assertDistinctHmacKeys` ; `config.spec.ts` (absent ou vide, égal à chacun des 3 autres secrets, secret de test posé en production : refus) |
| Vecteur RFC recopié de la RFC, pas du binaire | OK | `argon2-self-test.ts` : étiquette RFC 9106 §5.3 en littéral hexadécimal (`0d640df5…e659`), comparée par `timingSafeEqual` ; `associatedData` bien passé |
| Démarrage refusé si le vecteur est faux | OK | `VendorPinModule.onModuleInit` → `runArgon2SelfTest` ; tests « binaire faux », « ignore le secret », « accepte tout », `onModuleInit` en échec |
| Paramètres argon2 | OK | argon2id, m = 19456, t = 2, p = 1, 32 octets, v = 0x13 ; sel tiré par argon2 (16 octets, vérifié dans l'empreinte) ; l'aller-retour vérifie le préfixe PHC |
| Comparaison à temps constant | OK | `argon2.verify` (natif) pour le PIN ; `timingSafeEqual` pour le vecteur |
| `verify` toujours calculé | OK | `null` → empreinte factice (32 octets aléatoires, mêmes paramètres, même secret, calculée au démarrage par `ready()`) ; PIN hors motif → calcul puis faux ; type non chaîne → `''` puis calcul |
| Aucune trace du PIN ni de l'empreinte | OK | `VendorPinHashError` ne garde que `cause.name` ; `422` sans écho ; `logProblem` passe par `redactSecrets` (testé) |
| Binaire chargé d'empreinte connue | OK | `argon2-supply-chain.spec.ts` : empreintes recopiées de R-01 (vérifiées contre research.md l. 29-31), binaire choisi par `node-gyp-build` = binaire réellement chargé (processus séparé) ; plateforme inconnue → échec explicite |
| `DEVICE_QUERY` et droits de `cashless_tagkeys` inchangés | OK | `DEVICE_QUERY` intacte ; `DEVICE_DETAILS_QUERY` portée seulement par `PublicDeviceDirectory` (`PublicDeviceIdentityModule`, chargé par `AppModule` → processus public seul) ; `tag-keys.module.ts` garde `DeviceIdentityModule` (étroit) ; aucun SQL touché |
| `IdentityTenantContext` ne lit que `req.device` posé par la garde | OK | branche `device && !staff && !customer`, chemin `/operators/:id` → 404 ; guichet inchangé ; `req.device` n'est posé que par `DeviceGuard` (aussi via `DeviceOrCallerGuard`, chemin terminal) |
| `<serial>` contrôlé avant réservation | OK | `parseDeviceKey` appelé avant `tenant().current` et `repository.reserve` ; test « rien d'écrit » |
| Seuls les deux codes non définitifs relâchent la clé | OK, voir constat 1 | `NON_FINAL_CODES` fermé ; autre 409 enregistré (testé) |
| Marqueur de terminal → trois preuves sans repli | OK | `DeviceOrCallerGuard` : marqueur (certificat sur la socket, `Signature`, `Signature-Input`, même vide) → `DeviceGuard` seul, son refus est la réponse |
| Chemin personne sous `@Public()` : pas de contournement | OK | `AuthenticationGuard` construit avec `StrictReflector` qui masque `IS_PUBLIC` et `STAFF_TOKEN_ROUTE` ; la garde ne lit que `getAllAndOverride`, donc le masque est complet ; test « sans marqueur ni jeton → 401 malgré @Public() », jeton de festivalier refusé sur une route « personne » ; `X-Staff-Authorization` → 401 ; route sans options → 401 |
| `23505` traduit seulement pour la contrainte nommée | OK | `UNIQUE_CONSTRAINTS` fermé, `Object.hasOwn` (`__proto__`/`toString` → 500, testé) ; `constraint` bien transmis par `resolveProblem` |
| CL031 à CL040 | OK | statuts conformes à `openapi.yaml` / `problem-statuses.ts` (CL036 422, CL040 409, ADR-123) |
| Registre sans index, matrice inchangée en contenu | OK | `readdirSync` sur `*.cases.ts`, doublon → erreur ; 13 cas de base gardés ; gardes lues : `DeviceGuard` ∪ `DeviceOrCallerGuard` |
| Aucun faux en production | OK | aucun nouveau faux ; `production-guard.ts` non touché ; le refus vient de la configuration et du test au démarrage |

Points (a) à (c) de l'orchestrateur :

- (a) Clé relâchée sur `DEBIT_AUTHORITY_*` pour toutes les routes `@Idempotent` : **pas un affaiblissement**. Il n'existe
  aucune route `writes: false`. Les sites existants qui lèvent `DEBIT_AUTHORITY_EDGE` (`activation.service.ts:75`,
  `deposit.service.ts:106`, `release.service.ts:91`, `claims.service.ts:272`, et `CL006` côté base) le font dans
  `IdempotentTx.run` (transaction annulée), avant toute écriture validée. `claims.service.ts:193` lève un
  `CommittedProblem`, qui reste enregistré : `onError` traite `recorded` avant la libération. Le rejeu ne peut donc
  refaire aucune écriture refusée. Changement de comportement visible : voir le constat 1.
- (b) Retouches hors carte : toutes justifiées et minimes. `app.module.ts` : import autorisé, plus le remplacement
  `DeviceIdentityModule` → `PublicDeviceIdentityModule`, qui est le mécanisme de T034. `enrollment.service.ts` : une
  ligne, report WP06. `enrollment.spec.ts` : test CL031, report WP06 ; il utilise `session_replication_role = replica`
  en propriétaire, pour l'amorçage seulement. `tls.ts` : une ligne de configuration de production des tests.
- (c) Garde, refus en production et argon2 : voir le tableau. Aucun contournement trouvé.

Tests rejoués par le relecteur : `npx jest test/unit/vendor-pin test/unit/device-route test/unit/errors
test/unit/config.spec.ts` dans lane-h, soit 8 suites, 271/271 verts. Les suites d'intégration n'ont pas été rejouées :
l'orchestrateur a déjà fait le Jest complet sur lane-h + lane-f (107 suites, 1833 réussis, 0 échec). Aucune base créée.

## Constats

1. **Mineur, à consigner.** Changement de comportement des routes existantes. Fichier :
   `apps/api/src/idempotency/idempotency.interceptor.ts:185`.
   Avant ce lot, un `409 DEBIT_AUTHORITY_EDGE` sur l'activation, la caution, la libération ou la confirmation au guichet
   était enregistré et rejoué à l'identique (SPECIFICATION §10.2). Désormais la clé est relâchée : un rejeu de la même
   clé, après le retour de l'autorité au central, s'exécute et peut réussir. Ce n'est pas un affaiblissement, puisque
   rien n'a été écrit, et c'est cohérent avec la nature transitoire du refus. Mais c'est un écart à §10.2 sur des routes
   hors mission. Correction attendue : une ligne d'ADR ou de point ouvert (orchestrateur), et une mention dans le
   contrat de ces routes si le porteur le juge utile.
2. **Mineur, défaut antérieur au lot, à signaler au porteur.** Le secret est exposé à des processus qui ne s'en servent
   pas. Fichier : `apps/api/src/config/config.ts:591`.
   `loadConfig` est commun à tous les processus (`bootstrap.ts:96`). En production, `VENDOR_PIN_SECRET` devient donc
   obligatoire aussi dans l'environnement des processus des clés, d'administration des clés et de personnalisation,
   qui ne l'utilisent jamais. Les secrets existants (`IDEMPOTENCY_HMAC_KEY`, `ENROLLMENT_CODE_HMAC_KEY`) suivent déjà ce
   schéma, et le contrat (`vendors.md`) prescrit ce `hmacKey`. Ce n'est donc pas introduit en silence par le lot.
   Option à soumettre : lire les secrets par processus (moindre exposition).
3. **Mineur, pour WP11.** `<seq>` n'a pas de borne haute. Fichier : `apps/api/src/idempotency/device-key.ts:24`.
   Le motif `[0-9]{4,}` accepte jusqu'à environ 250 chiffres. Au-delà de 2^63−1, `record_device_seq` (bigint) lèvera un
   `22003`, donc une réponse `500` (clé relâchée) au lieu de `422 VALIDATION_FAILED`. Sans risque d'écriture, mais la
   réponse n'est pas la bonne. Correction attendue (WP11 ou ici) : borner `seq ≤ 9223372036854775807` dans
   `parseDeviceKey`.
4. **Mineur.** Le test du verrou ne détecte pas une entrée nouvelle inattendue. Fichier :
   `apps/api/test/unit/vendor-pin/argon2-supply-chain.spec.ts:73`.
   Le test vérifie les entrées attendues (absence de script d'installation, versions) mais n'échoue pas si une autre
   entrée apparaît plus tard dans l'arbre d'argon2. Renforcement possible : comparer l'ensemble des dépendances
   transitives résolues d'argon2 à `EXPECTED_NEW_LOCK_ENTRIES`.

## Écarts de sécurité ouverts

Aucun écart affaiblissant n'est codé. Renforcements à consigner (déjà listés par l'implémenteur) : masquage étendu de
`redactSecrets`, `assertDeviceMode` qui refuse un mode non lu, garde exclusive qui refuse une route sans options et un
marqueur vide, et `verify` faux pour un PIN hors motif.

## Fichiers à faire relire par une personne (règle 4)

`apps/api/src/vendor-pin/` (3 fichiers), `apps/api/src/config/config.ts` (secret),
`apps/api/src/device-identity/device-or-caller.guard.ts` (en particulier `StrictReflector`),
`apps/api/src/identity/identity-tenant-context.ts`, `apps/api/src/device-identity/device-identity.module.ts`,
`apps/api/src/errors/redact.ts`, `apps/api/src/idempotency/idempotency.interceptor.ts` (libération de la clé).

## Liste anti-motifs du prompt de relecture

1. Code mort : **N/A justifié**. `DeviceOrCallerGuard`/`DeviceOrCallerAuth`, `assertDeviceMode`, `requestDeviceSeq`,
   l'option `deviceSeq` et `UNIQUE_CONSTRAINTS` n'ont pas encore d'appelant de production. C'est l'objet du lot
   (« aucune route métier n'est servie ici », socle de WP09 à WP13). `VendorPinHasher` est chargé au démarrage par
   `AppModule`, et `PublicDeviceDirectory`, `redactSecrets` et `NON_FINAL_CODES` sont branchés en production.
2. Données de test synthétiques : PASS. Les tests appellent le vrai `argon2`, la vraie garde, le vrai intercepteur et
   la vraie configuration. Les doublures se limitent aux ports d'identité et au registre.
3. Retour vide silencieux : PASS. `find` rend `null` sur un identifiant mal formé, et `hasDeviceMarker` rend `false`
   sans socket TLS : les deux cas sont documentés.
4. Couverture des exigences (FR/NFR) : PASS. FR-003 et NFR-004 : hasher. FR-009 : device-key. FR-015 :
   device-context. FR-016 et FR-025 : garde. NFR-002 et NFR-008 : redact. NFR-009 : config et auto-test. C-003 :
   matrice.
5. Surface figée : PASS. Aucun `.sql` de `packages/ledger-sql/` n'est touché, ni `kitty-specs/`.
6. Décision verrouillée : PASS. Il n'y a pas de repli dans la garde, `DEVICE_QUERY` est inchangée et `argon2` reste
   en version 0.44.0.
7. Fichiers partagés : note de coordination. `app.module.ts` sera aussi modifié par WP09 à WP13 (un import de module
   chacun, conflits triviaux). `enrollment.service.ts` relève de WP06 (report explicite). `sqlstate-map.ts` est aussi
   cité par WP01 et WP04 (lecture des codes). `device-auth-matrix.spec.ts` est cité par WP01.
8. Fragilité en production : PASS. Les nouveaux `throw` sont des refus voulus (démarrage refusé, 401, 422) ou des
   erreurs de programmation (`requestDeviceSeq` sur une route non marquée).
