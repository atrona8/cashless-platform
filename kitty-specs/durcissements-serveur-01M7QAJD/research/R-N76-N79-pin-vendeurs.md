# Recherche mission 11a : OP-N76 (processus du PIN) et OP-N79 (vendor_id dans la clé de session)

Lecture seule ; rien n'a été modifié ni lancé. Chemins relatifs à la racine du dépôt.

## 1. Parcours actuel du PIN

### Routes (contrat inchangé, `openapi.yaml`)
- `apps/api/src/vendors/vendor-sessions.controller.ts` : `GET /vendor-sessions/vendors`, `POST /vendor-sessions` (ouverture),
  `DELETE /vendor-sessions/current`. L'ouverture empile : `@DeviceAuth()`, `@RequestLock(PIN_ATTEMPT_REQUEST_LOCK)` (verrou
  consultatif PG, un essai à la fois par terminal, pris AVANT l'idempotence), `@Idempotent({transient:true, keyUuid:true,
  pinFields:['pin'], nonFinal:['RATE_LIMITED']})`, puis `VendorSessionsService.open`.
- `apps/api/src/vendors/vendors.controller.ts` (ligne 34 injecte `VendorPinHasher`) : création de vendeur et changement de PIN
  (`hasher.hash(pin)` côté API, puis `create_vendor(...)` / `set_vendor_pin(...)` via `vendors.service.ts:103-140`).

### Service d'ouverture : `apps/api/src/vendors/vendor-sessions.service.ts`
- A (l.113-119) : transaction validée `SELECT check_id, pin_hash, locked FROM begin_vendor_pin_check($1,$2)` (vendeur, terminal).
- Hors transaction (l.121) : `hasher.verify(check?.pin_hash ?? null, input.pin)` : toujours un argon2 (empreinte factice si rien rendu).
- B (l.132-164) : si PIN juste, check présent, pas `locked` : `tx.run` (transaction IDEMPOTENTE de la requête) :
  `open_vendor_session($1,$2)` + audit `VENDOR_SESSION_OPENED` (l.146) dans la même transaction. `CL033` → refus ;
  `23505` sur l'index `vendor_session_open_per_device` → 429 (essai concurrent).
- C (l.166-181) : tout autre cas avec essai compté : audit `VENDOR_PIN_FAILED` (+ `VENDOR_LOCKED`) dans une transaction séparée, puis
  `401 VENDOR_PIN_INVALID`.
- En-tête du fichier l.19-23 : limite consignée A15 / OP-N76 / ADR-121.

### Hacheur : `apps/api/src/vendor-pin/`
- `vendor-pin.hasher.ts` : argon2id fixe (m=19456, t=2, p=1, 32 octets), `hash`, `verify` (toujours un calcul, empreinte factice
  aléatoire au démarrage), `idempotencyBody` (dérivé argon2 du PIN sous `VENDOR_PIN_IDEMPOTENCY_SECRET`, ADR-126), `ready`.
  Constructeur : exige `secret` et `idempotencySecret` d'au moins 32 octets, distincts.
- `vendor-pin.module.ts` : fabrique `new VendorPinHasher(config.vendorPinSecret, config.vendorPinIdempotencySecret)` ;
  `onModuleInit` → `runArgon2SelfTest` (`argon2-self-test.ts` : vecteur RFC 9106 §5.3 + aller-retour + empreinte sans secret refusée).
- Consommateurs du hacheur : `app.module.ts:79` (VendorPinModule), `vendors/vendors.module.ts:15`, `vendors.controller.ts:34`,
  `vendor-sessions.service.ts:80`, `idempotency/idempotency.interceptor.ts:247-249` (`moduleRef.get(VendorPinHasher, {strict:false})`
  pour masquer le PIN dans l'empreinte d'idempotence).

### `VENDOR_PIN_SECRET` : où il est lu
- `apps/api/src/config/config.ts` : champs `vendorPinSecret` (l.121) et `vendorPinIdempotencySecret` (l.127) ; secrets de test
  l.236-243 ; liste `TEST_HMAC_KEYS` l.250-257 (refusés en production même posés) ; `deviceSettings` l.672-700 (`hmacKey(...)`,
  `assertDistinctHmacKeys` avec 6 clés) ; retour l.733-734. Tests : `apps/api/test/unit/config.spec.ts` l.222, 243, 322-323, 369-421.
- Conséquence : aujourd'hui TOUT processus qui charge `loadConfig()` lit ce secret. Pour que le processus du PIN soit « seul détenteur », il faut
  scinder la configuration : `vendorPinSecret` ne doit plus être chargé (ni exigé en production) par l'API ; `VENDOR_PIN_IDEMPOTENCY_SECRET`
  peut rester à l'API (secret distinct, ADR-126 ; il ne vérifie aucun PIN).

### Verrou d'essai
- `apps/api/src/vendors/pin-attempt-lock.ts` : verrou consultatif de session PG, clé `hashtextextended('vendor-pin-attempt:'||device_id,0)`,
  connexion dédiée (`db/session-lock.ts`), sans attente, 429 `RATE_LIMITED` + `Retry-After: 1`. Vit dans la base : vaut pour tous les
  processus. Blocage du vendeur (5 essais) : tenu par la base dans `begin_vendor_pin_check`. OP-N80 (pool non mesuré) hors périmètre.

### Fonctions SQL : `packages/ledger-sql/migrations/0031_vendors.sql`
- `begin_vendor_pin_check(p_vendor, p_device)` l.261-317 : SECURITY DEFINER, lit `app.operator_id`, verrouille terminal puis vendeur,
  compte l'essai, 5e essai = blocage + fermeture des sessions, insère `vendor_pin_check` (30 s), RETURNS `(check_id, pin_hash, locked)`.
- `open_vendor_session(p_check, p_device)` l.325-379 : revérifie tout sous verrou, consomme le check (usage unique), met le compteur à 0,
  ferme la session précédente (`REPLACED`), insère `vendor_session` (12 h), tout échec = `CL033`.
- `close_vendor_session`, `assert_vendor_session` restent à `cashless_app` (hors N76).
- Aucune autre migration ne redéfinit ces deux fonctions (grep : 0033, 0034, 0048, 0061, 0063-0065, 0070 citent `vendor_session` sans les remplacer).
- Droits : `packages/ledger-sql/post-roles.sql` l.485-489 (liste `cashless_app` : commentaire OP-N76 + `begin_vendor_pin_check(uuid, uuid)`,
  `open_vendor_session(uuid, uuid)`), l.598-617 (`pin_hash` jamais lisible ; `REVOKE INSERT, UPDATE ON vendor_session, vendor_pin_check`).
  Les droits sont donnés par post-roles.sql (rejoué à chaque déploiement), PAS par une migration ; il n'y a donc pas de GRANT à défaire
  dans une migration : retirer les deux signatures de la liste de `cashless_app` suffit (section 0 retire déjà tout EXECUTE par défaut).

### Tests existants
- pgTAP `packages/ledger-sql/tests/tests_vendors.sql` : appelle begin/open en propriétaire (non touché par un changement de rôle).
- `tests_payment_rights.sql` :
  - l.112-115 (propriétaire) appelle begin/open pour la fixture ; l.316-323 les appelle SOUS `cashless_app` avec `lives_ok`
    (« begin_vendor_pin_check exécutable », « open_vendor_session exécutable ») → à INVERSER (`throws_ok`/`ok(NOT has_function_privilege)`
    pour `cashless_app`, `lives_ok` pour le nouveau rôle).
  - l.373-402 « Borne d'OP-N76 » : trois assertions attendant `ARRAY['cashless_app']` comme seul exécutant (droits déclarés, héritage compris,
    PUBLIC non) → à réécrire avec `ARRAY['cashless_pin']` (nom proposé) et à renommer « levée d'OP-N76 ».
- `tests_execute_grants.sql` : liste figée de `cashless_app` l.~96-110 (contient `begin_vendor_pin_check(uuid,uuid)` l.108 et
  `open_vendor_session(uuid,uuid)` l.110) → retirer ; ajouter une assertion de liste figée pour le nouveau rôle (deux fonctions exactement) ;
  ajouter le rôle aux listes de rôles du fichier (test pgcrypto l.~64-68, boucles par rôle). `tests_offline_rights.sql` et
  `tests_9b_rights.sql` citent aussi `vendor_session` : à regarder pour les listes de rôles.
- Jest unitaires : `apps/api/test/unit/vendors/vendor-sessions.service.spec.ts`, `unit/vendor-pin/vendor-pin.hasher.spec.ts`,
  `unit/config.spec.ts`, `unit/errors/sqlstate-map.spec.ts`.
- Jest intégration : `test/integration/vendors/vendor-sessions.spec.ts` (attention : l.184, 313-407 font `jest.spyOn(hasher, 'verify'/'idempotencyBody')`
  sur l'instance du hacheur DANS l'API : ces tests supposent la vérification dans l'API et sont à réécrire), `vendors.spec.ts`,
  `end-to-end/payment-journey.spec.ts`, `payment-secrets.spec.ts`, `payment-isolation.spec.ts`, `device-auth-cases/payments.qr.cases.ts`,
  `test/support/tls.ts`, et toute fixture qui obtient un PIN/une session via `hasher.hash` (`vendor-sessions.spec.ts` l.75-84).

## 2. Modèle des processus séparés existants

### Fait central : l'API ne parle à AUCUN autre processus
- `apps/api/src` n'a aucun client HTTP interne (grep fetch/http.request/axios/undici : seuls usages externes : `google-revocation-cache.ts`,
  `devices/tokens/refresh.service.ts`, `real-device-identity.ts`, `me.controller.ts` sans lien). Il n'existe donc PAS de précédent
  « l'API appelle un processus » : chaque processus est soit un TRAVAILLEUR sans route (appelé par un ordonnanceur, `--once`), soit un serveur
  HTTP atteint DIRECTEMENT par un terminal ou une personne (routage par chemin au répartiteur).
- Même binaire de base (`apps/api/dist/main.*.js`), un point d'entrée `main.<nom>.ts` par processus, un script `start:<nom>` dans
  `apps/api/package.json` l.9-18.

| Processus | Entrée | Module racine | Type | Rôle de base | Variable |
|---|---|---|---|---|---|
| API publique | `main.ts` | `processes/public.module.ts` | HTTP | `cashless_app` (+ `cashless_platform`) | `DATABASE_URL_APP`/`_PLATFORM` |
| clés de bracelet | `main.tag-keys.ts` (port 3001, `TAG_KEYS_PORT`) | `processes/tag-keys.module.ts` | HTTP, terminaux directs | `cashless_tagkeys` | `DATABASE_URL_TAGKEYS` |
| personnalisation | `main.personalization.ts` (3002) | `personalization.module.ts` | HTTP, personnes | `cashless_perso` | `DATABASE_URL_PERSO` |
| edge | `main.edge.ts` | `edge.module.ts` | HTTP mTLS propre (2e autorité) | `cashless_edge` | `DATABASE_URL_EDGE` |
| contrôle quotidien | `main.tag-check.ts` | `tag-check.module.ts` | travailleur `--once` | `cashless_tagcheck` | `DATABASE_URL_TAGCHECK` |
| administration des clés | `main.key-admin.ts` | `key-admin.module.ts` | travailleur | `cashless_keyadmin` | `DATABASE_URL_KEYADMIN` |
| snapshot-signer / -content / maintenance / psp-poller | `main.snapshot-*.ts`, `main.maintenance.ts`, `main.psp-poller.ts` | `processes/*.module.ts` | travailleurs | `cashless_snapsign`, `cashless_snapcontent`, `cashless_maint`, (psp-poller) | `DATABASE_URL_SNAPSIGN`… |

- Démarrage commun : `processes/bootstrap.ts` : `serve(rootModule, port, opts)` (HTTPS TLS 1.3 dès qu'un certificat est configuré, obligatoire
  en production via `assertSafeTransport` ; `assertProcessIsSafe` → `assertNoFakeInProduction` sur 15 ports ; `trust proxy` borné) et
  `runWorkers(...)`. `processes/process-base.ts` : `ProcessBaseModule` (filtre problem+json, X-Request-Id, registre des travailleurs) et
  `DenyUnmarkedRoutesGuard` (toute route non marquée `@DeviceAuth()`/`@Public()` est refusée : à utiliser pour le processus du PIN).
- Rôle de base : un pool UNIQUE par processus. `apps/api/src/db/process-db.module.ts` : type `KeyProcess` (`'tag-keys'|'personalization'|'tag-check'|
  'key-admin'|'edge'`), table `KEY_PROCESS_URL` (champ de config + variable), `ProcessDbModule.forProcess(nom)` ; chaîne vide = refus de démarrer
  de CE processus seulement. Les processus de snapshots ont leur module (`db/snapshot-signer-db.module.ts`). Champs de config :
  `config.ts` (`tagKeysDatabaseUrl`, `snapshotSignerDatabaseUrl` via `tagUrl('DATABASE_URL_SNAPSIGN')` l.841…).
  `test/unit/architecture.spec.ts` interdit d'atteindre `pg`, `PlatformTx` ou le jeton du pool hors `db/`, et vérifie par analyse des
  imports ce que chaque processus atteint (à étendre avec le nouveau processus : aucun import de `PlatformTx`).
- Création des rôles et droits : `packages/ledger-sql/post-roles.sql` (rôles `NOLOGIN`-pas : `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS
  NOINHERIT`, timeouts, droits remis à zéro) : bloc l.256-275 pour tagkeys/perso/tagcheck/keyadmin, bloc l.776-800 pour snapcontent/snapsign/maint ;
  droits propres par rôle (ex. `GRANT SELECT, INSERT ON audit_log` + `USAGE, SELECT ON SEQUENCE audit_log_id_seq` l.295-296, 337-338, 345-346) ;
  listes de REVOKE par rôle à compléter (l.580-583 TEMPORARY ; l.1091, 1116, 1131 listes de rôles). Mots de passe : `packages/ledger-sql/src/migrate.ts`
  l.152-166 (`CASHLESS_<ROLE>_PASSWORD`, tableau `passwords`), `tools/dev-db/env.sh` (l.43 `CASHLESS_SNAPSIGN_PASSWORD`, l.62 `DATABASE_URL_SNAPSIGN`),
  `tools/dev-db/env.test.example`, `.github/workflows/ledger-tests.yml` l.55-65, `docs/SERVICES-EXTERNES.md` l.57, `apps/api/test/support/db.ts`
  (`roleUrl(...)`, ex. `SNAPSIGN_URL` l.44).
- Secret : lu par `loadConfig()` depuis l'environnement (`hmacKey(env, NOM, libellé, production, valeurDeTest)` : exigé en production, valeur de test
  refusée si posée en production, `TEST_HMAC_KEYS`, `assertDistinctHmacKeys`). Garde de production : `assertNoFakeInProduction` (kms/production-guard)
  + tests `apps/api/test/unit/processes.spec.ts` l.170-235 (it.each sur les modules racines : refus faux en production, refus sans TRUST_PROXY_HOPS,
  refus sans NODE_ENV valide) : à étendre au processus du PIN.
- Tests Jest : `apps/api/test/support/app.ts` : `createKeyProcess(nom)` compile le vrai module racine (`Test.createTestingModule`, URL de rôle posée par
  `setKeyProcessUrls`, faux KMS du processus) et sert via supertest SANS port ; `startHttpsApp(...)` (l.~195) écoute en HTTPS réel sur un port libre de
  127.0.0.1 (utile pour un client HTTP interne). Il manque donc seulement un moyen de brancher le client de l'API sur l'URL du processus de test.

### Exemple le plus proche à imiter
- Pour la forme (rôle propre, pool unique, droits SQL minimaux, secret, audit, garde de production, tests de module) : `tag-keys`
  (`main.tag-keys.ts`, `processes/tag-keys.module.ts` : `ProcessDbModule.forProcess`, `ProcessBaseModule`, `DenyUnmarkedRoutesGuard`, `AuditModule`,
  `GRANT SELECT, INSERT ON audit_log`). `tag-check` n'est PAS un modèle d'appel : c'est un travailleur qui ne répond à personne.
- Pour l'écouteur HTTP à authentification propre (second écouteur, autorité distincte, TLS 1.3, refus du démarrage en production sans certificat) : `edge`
  (`bootstrap.ts` `edgeTlsServerOptions`).
- Le « client interne » côté API est NOUVEAU : aucun gabarit dans le dépôt.

## 3. OP-N79 : clé composite `(vendor_session_id, vendor_id)`

### État actuel
- `vendor_session` (`0031_vendors.sql` l.84-101) : PK `id` ; `vendor_id` FK `vendor(id)` ; `operator_id`, `device_id`. Index partiels uniques/non uniques seulement.
  `0033_payments.sql` l.62-63 : `UNIQUE (id, device_id, operator_id)` (`vendor_session_id_device_operator_key`).
- `sale_attribution` (`0033_payments.sql` l.70-86) : PK `transaction_id` ; colonnes `operator_id`, `vendor_id` (FK `vendor(id)`, NULL permis),
  `vendor_session_id`, `device_id`, `channel`, `actor_user_id`, `created_at`. CHECK `sale_attribution_terminal_all_or_none` : `(vendor_id IS NULL) =
  (vendor_session_id IS NULL)` ET `(vendor_session_id IS NULL) = (device_id IS NULL)` ; `sale_attribution_has_author`. FK composite existante
  `sale_attribution_session_fk (vendor_session_id, device_id, operator_id) → vendor_session(id, device_id, operator_id)` : le vendeur n'y figure pas
  (c'est le constat). Immuable (`forbid_mutation` UPDATE/DELETE), RLS forcée.
- Donc `sale_attribution` PORTE bien `vendor_id`. Les colonnes d'une FK MATCH SIMPLE à NULL ne sont pas contrôlées : le CHECK « tout ou rien » garantit
  que `vendor_id` et `vendor_session_id` sont nuls ensemble (attribution de back-office) : la nouvelle FK ne gêne pas ces lignes.
- Autre FK vers `vendor_session` : `approval_token_use (caller_vendor_session_id, caller_device_id, operator_id)` (0033 l.118-126) : hors périmètre
  d'OP-N79 (il n'y a pas de `vendor_id` dans cette table).
- Seules écritures de `sale_attribution` : `record_sale_attribution` (`0033` l.154-215) et `record_sale_attribution_at` (`0048` l.273-338) ; elles
  copient `s.vendor_id, s.id, s.device_id` de la session lue : cohérentes par construction. `0034` (l.424) et les fonctions de paiement appellent
  `record_sale_attribution`. Insertions directes : seulement en test pgTAP (propriétaire) : `tests_payment_rights.sql` l.135-137 (vendeur `vb` + session
  `sb` : cohérent ?) et l.295-297 (tentative sous `cashless_app`, refusée : droit INSERT retiré par `post-roles.sql` l.626-633).
- Aucun `DELETE`/`TRUNCATE` sur `vendor_session` dans migrations, tests ni post-roles. Mises à jour de `vendor_session` : seulement `closed_at`/`closed_reason`
  (colonnes hors clé) : la FK ne se redéclenche pas. Les déclencheurs de réplication de passerelle (`0063` l.593-596) ne sont pas touchés.

### Conception proposée : migration `0090_sale_attribution_vendor_key.sql` (la dernière existante est 0089)
1. `ALTER TABLE vendor_session ADD CONSTRAINT vendor_session_id_vendor_key UNIQUE (id, vendor_id);` (`id` est déjà PK : l'unicité est triviale ;
   il faut seulement l'index pour la FK ; coût : un index de plus, sans effet sur les écritures de session (≈ une par ouverture)).
2. `ALTER TABLE sale_attribution ADD CONSTRAINT sale_attribution_session_vendor_fk FOREIGN KEY (vendor_session_id, vendor_id) REFERENCES
   vendor_session (id, vendor_id);` (ne PAS remplacer `sale_attribution_session_fk` de 0033, que `approval_token_use` imite : retirer l'une
   obligerait à retoucher la clé unique cible). Sans ON DELETE/UPDATE (NO ACTION : aucune suppression de session n'existe).
3. Avant les `ALTER` : un bloc `DO $$ … $$` qui compte les lignes incohérentes
   (`SELECT count(*) FROM sale_attribution a JOIN vendor_session s ON s.id = a.vendor_session_id WHERE a.vendor_id IS DISTINCT FROM s.vendor_id`) et lève une
   exception nommée si > 0 (message clair au lieu de l'échec de la FK). Les données existantes respectent la règle par construction (les deux fonctions
   d'écriture copient le vendeur de la session ; seul un INSERT de propriétaire hors fonction pourrait l'avoir violée : à confirmer sur la base de test par
   la requête ci-dessus ; non exécutée ici).
4. Pas de GRANT/REVOKE : aucun droit de table ne change ; `cashless_app` reste sans INSERT/UPDATE sur `sale_attribution` (la borne de
   `tests_payment_rights.sql` reste valable ; elle devient la 2e barrière, plus la seule).
5. Tests pgTAP (nouveau fichier `tests_sale_attribution_vendor_key.sql` ou ajout à `tests_payment_rights.sql`, écrit à la main) : en propriétaire,
   INSERT direct d'une attribution `(vendor_session_id = session du vendeur A, vendor_id = vendeur B)` → `foreign_key_violation` 23503, nom de contrainte
   `sale_attribution_session_vendor_fk` ; contrôle positif : même INSERT avec le vendeur A passe ; attribution de back-office (vendeur et session NULL,
   `actor_user_id` posé) passe ; `record_sale_attribution` et `_at` toujours verts (suites 0033/0048 : `tests_payments.sql`, `tests_offline_device_vendor.sql`).
   Ratchet : test d'existence des deux contraintes (`has_unique`/`pg_constraint`), qui échoue si elles disparaissent. Le test existant l.135-137 doit rester
   cohérent (`vb`/`sb` : à vérifier à l'écriture).
6. Consignation (règle 3 de `CLAUDE.md`) : OP-N79 levée dans `docs/POINTS_OUVERTS.md`, ADR de levée (ou addendum à ADR-127), `PROMPTS-A-ENVOYER.md`/`PRD.md`.
   L'écart est un RENFORCEMENT : fait puis consigné, pas de décision du porteur à demander.
- Risques : verrous de l'`ALTER` (tables petites aujourd'hui ; `sale_attribution` peut être volumineuse en production : la validation de la FK parcourt
  la table : prévoir `NOT VALID` puis `VALIDATE CONSTRAINT` si la table est grande ; sur la base de recette, un seul `ADD` suffit) ; le fichier
  `schema_grand_livre_cashless.sql` et les `.sql` générés ne sont pas touchés.
- Alternatives rejetées : retoucher `0033` (interdit : migrations existantes non retouchées) ; remplacer la clé unique
  `(id, device_id, operator_id)` par `(id, vendor_id, device_id, operator_id)` (casse `approval_token_use`) ; déclencheur de contrôle (SECURITY DEFINER
  inutile, une contrainte déclarative est plus sûre).

## 4. Conception proposée pour OP-N76

### Principe
Un processus `vendor-pin` (module `apps/api/src/processes/vendor-pin.module.ts`, entrée `apps/api/src/main.vendor-pin.ts`, script `start:vendor-pin`,
port `VENDOR_PIN_PORT` défaut 3003) est seul à : lire `VENDOR_PIN_SECRET`, exécuter `begin_vendor_pin_check` et `open_vendor_session`, calculer une
empreinte de PIN. L'API ne garde que le verrou d'essai, l'idempotence, l'authentification du terminal et le dérivé d'idempotence.

### Rôle de base
- Nom proposé : `cashless_pin` (aligné sur `cashless_perso`, `cashless_tagcheck`). Variable `DATABASE_URL_PIN`, mot de passe `CASHLESS_PIN_PASSWORD`
  (migrate.ts, env.sh, env.test.example, `ledger-tests.yml`, `docs/SERVICES-EXTERNES.md`, `test/support/db.ts` `PIN_URL`).
- `post-roles.sql` : ajouter `cashless_pin` à la boucle de création (modèle l.256-275 ou l.776-800), puis UNIQUEMENT :
  `GRANT EXECUTE ON FUNCTION begin_vendor_pin_check(uuid,uuid), open_vendor_session(uuid,uuid) TO cashless_pin;`
  `GRANT SELECT, INSERT ON audit_log TO cashless_pin; GRANT USAGE, SELECT ON SEQUENCE audit_log_id_seq TO cashless_pin;` (pour que le processus écrive les
  audits `VENDOR_SESSION_OPENED`, `VENDOR_PIN_FAILED`, `VENDOR_LOCKED` : voir ci-dessous). Aucun droit de table sur `vendor`, `vendor_pin_check`,
  `vendor_session` (les fonctions sont SECURITY DEFINER). À vérifier à l'écriture : la politique RLS de `audit_log` s'applique-t-elle sans `TO` à ce rôle
  (comme pour tagkeys) ; sinon une politique d'INSERT par rôle comme `keyadmin_snapshot_key_audit_insert` (post-roles l.924).
- Retirer de la liste de `cashless_app` (post-roles l.487-489) les deux signatures ; ajouter le nouveau rôle aux listes de REVOKE de fin de fichier
  (l.580-583, 1091, 1116, 1131) et aux listes de rôles de `tests_execute_grants.sql`.
- Mise à jour des bornes de test (voir §1) : `tests_payment_rights.sql` §5 devient « seul `cashless_pin` exécute… » + « `cashless_app` ne peut pas »
  ; `tests_execute_grants.sql` : liste figée de `cashless_pin` = exactement ces deux fonctions ; liste de `cashless_app` sans elles. Aucun droit ajouté à
  `cashless_app` (SC-005) ; seul un renforcement.
- Le hacheur du PIN, `begin_vendor_pin_check` et `open_vendor_session` ne lisent `app.operator_id` qu'issu de `TenantTx.run(operatorId)` : le processus pose le
  prestataire fourni par l'API.

### Interface interne (hors `openapi.yaml`, non servie au public)
Deux opérations HTTP internes, JSON, préfixe `/internal/vendor-pin/`, routes marquées explicitement (le reste refusé par `DenyUnmarkedRoutesGuard`) :
1. `POST /internal/vendor-pin/open` `{operator_id, device_id, vendor_id, pin, request_id}` → fait TOUT l'enchaînement A→argon2→B→audit/C DANS le processus
   (transaction A ; vérification argon2 ; transaction B `open_vendor_session` ; audit `VENDOR_SESSION_OPENED` dans la même transaction que B, ou
   `VENDOR_PIN_FAILED`/`VENDOR_LOCKED` dans une transaction séparée) et rend soit la session `{vendor_session_id, vendor_id, vendor_display_name, expires_at}`
   soit un refus : 401 `VENDOR_PIN_INVALID` (même corps), 429 en cas d'index « une session par terminal » (`concurrent`), 5xx si panne. Le PIN voyage dans
   le corps TLS, jamais journalisé. L'API traduit en réponse du contrat inchangée (mêmes codes, mêmes corps). Le code de `vendor-sessions.service.ts`
   (A/B/C) est déplacé tel quel dans un service du processus ; `deviceAudit` devient un paramètre (request_id, origine `device:<id>`).
2. `POST /internal/vendor-pin/hash` `{pin}` → `{pin_hash}` : pour création de vendeur et changement de PIN (`vendors.controller.ts`), puisque l'API ne détient
   plus le secret. `create_vendor`/`set_vendor_pin` restent exécutées par `cashless_app` avec l'empreinte rendue (un hash calculé sans le secret serait de
   toute façon refusé à la vérification ; limite consignée : une connexion compromise peut poser une empreinte arbitraire, c'est-à-dire verrouiller ou
   réinitialiser un vendeur, mais pas se connecter sans PIN valide ; à signaler au porteur, aucun élargissement par rapport à aujourd'hui). Alternative : le processus
   exécute lui-même ces deux fonctions (déplace des droits : plus de code, plus de surface).
- Le dérivé d'idempotence (`idempotencyBody`, secret `VENDOR_PIN_IDEMPOTENCY_SECRET`) reste dans l'API : scinder `VendorPinHasher` en deux classes
  (`VendorPinDigester` côté processus : `hash`/`verify`/auto-test ; `IdempotencyPinMasker` côté API : dérivé seulement, sans le secret des PIN).
  `argon2-self-test.ts` va avec le processus (démarrage refusé si échec : déjà NFR-009) ; l'API garde un test d'argon2 pour son dérivé. `config.ts`
  doit alors charger `vendorPinSecret` UNIQUEMENT pour le processus du PIN (fonction `vendorPinSettings(env)` appelée par `main.vendor-pin`/son module) :
  l'API ne l'exige plus en production et ne le charge plus (preuve : test de configuration qui échoue si `loadConfig()` du processus public expose
  `vendorPinSecret`, et `assertDistinctHmacKeys` ajusté).

### Appel par l'API
- Nouveau client `apps/api/src/vendor-pin-client/` (client HTTP minimal `node:https`, agent keep-alive, délai court, aucune relance automatique d'un essai de PIN) injecté dans `VendorSessionsService` et `VendorsController` à la place de `VendorPinHasher`. Configuration : `VENDOR_PIN_URL` (obligatoire en production, `https://` imposé par `assertSafeTransport`-like) ; pas de port par défaut en production.
- Authentification du client (le processus n'accepte pas n'importe qui sur le réseau) : deux options, à trancher au plan :
  (a) HTTPS TLS 1.3 + clé partagée d'appel (`VENDOR_PIN_CALL_KEY`, signature HMAC de `méthode|chemin|corps|horodatage` ; secret distinct des autres, ajouté à
  `assertDistinctHmacKeys`, valeur de test refusée en production comme les autres) ; simple, aucune autorité à exploiter ;
  (b) mTLS avec une autorité interne dédiée (sur le modèle de `edgeTlsServerOptions`) : plus fort (pas de secret partagé), mais ajoute une autorité et des
  certificats à exploiter. Recommandation : (a), sauf avis du porteur ; dans les deux cas une API compromise garde sa capacité d'appeler le processus (elle voit
  déjà les PIN en transit : limite à NOMMER dans l'ADR de levée : ce qui est levé est la LECTURE des empreintes et l'ouverture de session SANS PIN
  valide ; l'API reste le canal du PIN).
- Aucun faux en production (règle 2) : ne pas créer de « faux client » du PIN dans le code de production. Les tests lancent le VRAI processus
  (`startHttpsApp`/serveur de test en local avec `DATABASE_URL_PIN`) et configurent l'API avec son URL réelle ; aucun port à ajouter à `assertProcessIsSafe`,
  mais un test dans `processes.spec.ts` : le processus du PIN refuse de démarrer en production sans `VENDOR_PIN_SECRET`, avec la valeur de test, sans
  `DATABASE_URL_PIN`, sans TLS, sans `NODE_ENV` ; et l'API refuse de démarrer en production sans `VENDOR_PIN_URL`.

### Indisponibilité du processus
- Refus, aucun repli : connexion refusée, délai dépassé ou 5xx → l'API répond une erreur de service (503 ; à vérifier dans le catalogue des codes du contrat :
  si aucun code adapté n'existe, utiliser l'existant `INTERNAL_ERROR` 500 plutôt que d'ajouter un code : le contrat ne change pas) ; aucune session ouverte, aucune
  vérification locale. Test : processus arrêté → refus, `vendor_session` inchangée, aucun appel à `begin/open` depuis `cashless_app`. Comportement du compteur :
  un essai compté par `begin_vendor_pin_check` avant l'indisponibilité reste compté (échec sûr voulu, comme aujourd'hui entre A et B). Un délai attendu côté API
  de l'ordre de 2 s (argon2 ~60 ms + marge) pour ne pas tenir le verrou d'essai (OP-N80) plus qu'aujourd'hui.

### Idempotence et atomicité (point d'attention)
- Aujourd'hui B (`open_vendor_session` + audit) s'exécute DANS la transaction idempotente de la requête (`IdempotentTx.run`). Désormais la session est
  ouverte par le processus, hors de cette transaction : si l'API plante après le commit du processus et avant l'enregistrement de la réponse, la session existe
  sans réponse. Pas de régression de sécurité : la route est `transient` (réponse jamais conservée, un renvoi de la même clé reçoit 409) ; le terminal refait un
  essai avec une nouvelle clé (nouvel essai compté, session précédente `REPLACED`). À consigner dans l'ADR.
- L'intercepteur d'idempotence exige un appel à `IdempotentTx.run` pour une route d'écriture (`idempotency.interceptor.ts` l.161-167 :
  `IDEMPOTENT_ROUTE_WITHOUT_TX`) : la route d'ouverture doit passer en `writes: false` (option existante, l.169-177 : réponse enregistrée seule) ou garder un
  `tx.run` utile. À vérifier au plan que `writes:false` est compatible avec `transient: true`, `keyUuid`, `nonFinal` et la gestion du 401 enregistré/rejoué
  (« un refus 4xx est enregistré et rejoué tel quel, sans nouveau comptage »).
- Le verrou d'essai (`RequestLock`) reste dans l'API et tenu pendant l'appel au processus : une ouverture simultanée du même terminal est toujours refusée en 429
  avant tout appel.

### Audit
- `VENDOR_SESSION_OPENED`/`FAILED`/`LOCKED` sont écrits par le processus avec `AuditModule` (comme tagkeys) ; `AuditService.record` suppose le contexte
  (`actorId:null`, `origin:'device:<id>'`, `requestId`) fourni par l'API dans l'appel. Test de non-régression : mêmes lignes d'audit que
  `vendor-sessions.spec.ts` aujourd'hui (une ouverture = une ligne OPENED avec `{vendor_id, device_id}` ; un échec = FAILED ; 5e essai = FAILED + LOCKED).
- Liste de contrôle de relecture humaine (règle 4) : `post-roles.sql` (nouveau rôle et ses droits), `0090` (sans risque cryptographique), le hacheur et le
  client/serveur internes (cryptographie, secret, authentification d'appel).

### Latence (NFR-001 : p95 ≤ 300 ms, p99 ≤ 600 ms, 200 essais en série)
- argon2id (19 Mio, t=2) ≈ 60 ms (OP-N80, fiche) déjà payé aujourd'hui dans l'API ; il passe dans le processus. Ajouts : un saut TLS local keep-alive
  (quelques ms) + sérialisation JSON ; les deux transactions A et B (≈ 5-15 ms chacune) restent. Marge très large (≈ 80-120 ms attendus). Mesure à faire :
  nouvelle suite `apps/api/test/integration/end-to-end/vendor-pin-latency.spec.ts` sur le modèle de `device-latency.spec.ts` (200 ouvertures en série,
  p95 et p99 mesurés), à ajouter à la liste `SKIP_LATENCY` de `apps/api/jest.config.cjs` (l.30-50). Prévoir un `UV_THREADPOOL_SIZE` suffisant dans le
  processus (argon2 y tourne sur le pool de threads libuv) ; l'isolation est un plus : un pic d'ouvertures ne consomme plus le pool de l'API.
- Le processus doit être démarré à chaud : l'auto-test au démarrage (RFC 9106 + aller-retour + empreinte factice) est fait avant d'écouter.

### Risques et alternatives rejetées
- Rejeté : router `POST /vendor-sessions` directement vers le processus (modèle tag-keys, terminal → processus) : il faudrait reconstruire dans le processus
  l'idempotence (qui exige `PlatformTx`, interdit hors liste blanche de `architecture.spec.ts`), le verrou d'essai, la garde de terminal
  (`DeviceIdentityModule` est possible) ; et le routage par chemin ajoute une règle d'exploitation par route. Avantage : l'API ne verrait jamais le PIN.
  À signaler au porteur comme option plus forte mais plus lourde (écart avec l'hypothèse de la spec « appel par l'API »).
- Rejeté : processus à la demande sans serveur (comme un travailleur `--once`) : l'ouverture est synchrone, avec un terminal en attente.
- Rejeté : vérification de repli dans l'API quand le processus tombe (interdit par la spec, scénario 4 de l'US 2).
- Risque à nommer : l'API voit toujours le PIN en clair en transit (et un attaquant de l'API peut brûler des essais d'un vendeur jusqu'au blocage : déni de
  service sur un vendeur, déjà possible aujourd'hui, borné à 5 essais par déblocage). Ce que la mission lève : lecture des empreintes, ouverture de session
  sans PIN valide, dépendance au secret.
- Tâches de test à ne pas oublier : réécrire `vendor-sessions.spec.ts` (espions sur `hasher.verify` de l'API) ; `vendor-sessions.service.spec.ts`,
  `vendor-pin.hasher.spec.ts`, `config.spec.ts`, `processes.spec.ts`, `architecture.spec.ts` (le processus n'atteint ni `PlatformTx` ni le pool de `cashless_app`),
  fixtures de PIN des suites end-to-end (hash via le processus de test), `test/support/db.ts` (`PIN_URL`).
- Consignation à produire : levée d'OP-N76 dans `docs/POINTS_OUVERTS.md`, ADR de levée (renvoyant à ADR-121 et décrivant ce qui reste : PIN en transit par l'API,
  `create_vendor`/`set_vendor_pin` toujours à `cashless_app`), `docs/passation`/docs transverses (04 architecture, 08 pile, SERVICES-EXTERNES), déploiement
  (nouveau processus à ajouter à la liste des déploiements : port, `DATABASE_URL_PIN`, `VENDOR_PIN_SECRET`, `VENDOR_PIN_URL` côté API, clé d'appel).
