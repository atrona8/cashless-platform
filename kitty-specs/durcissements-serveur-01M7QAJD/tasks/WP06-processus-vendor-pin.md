---
work_package_id: WP06
title: Processus vendor-pin (OP-N76)
dependencies: [WP03, WP04]
requirement_refs: [FR-005, C-006, C-008]
planning_base_branch: feat/durcissements-serveur
merge_target_branch: feat/durcissements-serveur
branch_strategy: >-
  Planning artifacts for this mission were generated on feat/durcissements-serveur. During
  /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must
  merge back into feat/durcissements-serveur unless the human explicitly redirects the landing branch.
subtasks: [T022, T023, T024, T025, T026]
phase: Phase 2 - API et processus
agent: claude
history:
- timestamp: '2026-11-18T16:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/processes/vendor-pin.module.ts
create_intent:
- apps/api/src/main.vendor-pin.ts
- apps/api/src/processes/vendor-pin.module.ts
- apps/api/src/vendor-pin/vendor-pin-call.guard.ts
- apps/api/src/vendor-pin/vendor-pin-call-signature.ts
- apps/api/src/vendor-pin/vendor-pin-internal.controller.ts
- apps/api/src/vendor-pin/vendor-pin-open.service.ts
- apps/api/src/vendor-pin/vendor-pin.digester.ts
- apps/api/src/vendor-pin/vendor-pin-server.module.ts
- apps/api/test/integration/vendor-pin/vendor-pin-process.spec.ts
- apps/api/test/integration/vendor-pin/vendor-pin-fixtures.ts
execution_mode: code_change
model: sonnet
owned_files:
- apps/api/src/main.vendor-pin.ts
- apps/api/src/processes/vendor-pin.module.ts
- apps/api/src/vendor-pin/**
- apps/api/test/unit/architecture.spec.ts
- apps/api/test/unit/processes.spec.ts
- apps/api/test/integration/vendor-pin/**
- apps/api/package.json
- apps/api/test/support/app.ts
- apps/api/test/unit/vendor-pin/vendor-pin.hasher.spec.ts
- apps/api/test/unit/vendor-pin/argon2-supply-chain.spec.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP06 : Processus vendor-pin (OP-N76)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche commune `docs/passation-11a/fiche-implementation.md`, ce
prompt, puis seulement :

- les notes de lane de WP03 (rôle `cashless_pin`, `DATABASE_URL_PIN`, `PIN_URL` de `test/support/db.ts`) et de WP04
  (noms **réels** des champs de configuration : secret, clé d'appel, URL, dérivé d'idempotence) ;
- `research/R-N76-N79-pin-vendeurs.md` §1 (parcours actuel A → argon2 → B → C), §2 (modèle des processus, exemple
  `tag-keys`), §4 (principe, interface interne, audit, latence, risques) ;
- `apps/api/src/vendors/vendor-sessions.service.ts` l. 36-217 (le code à déplacer : `open`, `openSession`,
  `recordFailure`, `record`, `pinInvalid`, `OPEN_SESSION_INDEX`) ;
- `apps/api/src/vendor-pin/vendor-pin.hasher.ts` (entier), `vendor-pin.module.ts`, `argon2-self-test.ts` ;
- `apps/api/src/processes/tag-keys.module.ts`, `main.tag-keys.ts`, `process-base.ts` (`DenyUnmarkedRoutesGuard`,
  marqueur `@Public()`), `bootstrap.ts` (`serve`, `assertProcessIsSafe`, `tlsServerOptions`),
  `db/process-db.module.ts` (type `KeyProcess`, table `KEY_PROCESS_URL`) ;
- `test/unit/processes.spec.ts` l. 160-240 (refus en production), `test/unit/architecture.spec.ts` l. 100-230 et
  l. 300-320 (liste des `main.*.ts`) ;
  `test/support/app.ts` (`createKeyProcess`, `startHttpsApp`, `setKeyProcessUrls`) ;
- `interfaces.md` : tables « Configuration » et « TypeScript » (routes internes, en-têtes, fenêtre de 30 s).

Priorité des sources (SPECIFICATION §0.3). `interfaces.md` fait foi. Contradiction : tu la signales.

## Objective

Créer le processus `vendor-pin`, seul détenteur de `VENDOR_PIN_SECRET`, de la lecture des empreintes de PIN et de
l'ouverture de session de vendeur, avec son propre rôle de base `cashless_pin`, deux routes internes signées, des
audits écrits par lui, et un démarrage refusé sans secret ni clé d'appel en production (FR-005, C-006, C-008). Ce lot
livre le **serveur** ; le client de l'API et la route `POST /vendor-sessions` sont à WP07.

## Context

- **Point ouvert levé** : OP-N76 (ADR-121). Limite résiduelle à ne pas cacher : l'API voit toujours le PIN en clair
  en transit ; ce qui est levé est la lecture des empreintes et l'ouverture de session sans PIN valide.
- **Décision de conception reprise de la recherche** (à confirmer dans ta note si tu t'en écartes) : authentification
  de l'appel par HMAC (option a), pas de TLS mutuel. Clé d'appel `VENDOR_PIN_CALL_KEY`, ≥ 32 octets base64 ; en-têtes
  `x-pin-ts` et `x-pin-sig` = HMAC-SHA256(clé, `ts + "\n" + méthode + " " + chemin + "\n" + corps`), fenêtre de 30 s,
  comparaison en temps constant. Le processus écoute en local (3003) ; en production TLS 1.3 comme les autres
  (`assertSafeTransport`).
- **Interfaces possédées** : `POST /internal/vendor-pin/open` (`{ vendorId, deviceId, operatorId, pin, … }` → session
  ou refus) et `POST /internal/vendor-pin/hash` (`{ pin }` → `{ pin_hash }`) ; le détail de la charge d'`open` est
  à toi, mais **fige-le dans ta note de lane** (WP07 l'appelle) : champs, codes de refus, forme des erreurs.
- **Décision de conception à prendre, signalée** : scinder `VendorPinHasher`. `vendor-pin.digester.ts` (nouveau,
  classe `VendorPinDigester`) reçoit `hash`, `verify`, l'empreinte factice et l'auto-test RFC 9106 (secret des PIN) ;
  `vendor-pin.hasher.ts` garde, **sous le même nom `VendorPinHasher`**, le seul dérivé d'idempotence côté API
  (`idempotencyBody`, `ready`), avec `PIN_PATTERN` toujours exporté (importé par `vendors.dto.ts`). Ainsi
  `idempotency.interceptor.ts` (non possédé) n'est pas touché. Le constructeur de l'API ne reçoit plus
  `VENDOR_PIN_SECRET` (le champ `vendorPinSecret` d'`AppConfig` reste jusqu'à WP07, qui le retire ; ne le lis plus).
- `db/process-db.module.ts` (valeur `'vendor-pin'` de `KeyProcess`, `DATABASE_URL_PIN`) est fait par **WP03** (dont tu
  dépends) : ne le touche pas. `test/support/app.ts` et les tests du hacheur sont à toi. **Hors carte, à lister dans
  la note de lane** (une ligne chacun, rien d'autre) : `app.module.ts` (import du module
  du hacheur d'API s'il change de nom), `test/unit/vendor-pin/vendor-pin.hasher.spec.ts` et
  `argon2-supply-chain.spec.ts` (suivent la scission), `test/support/app.ts` (`createKeyProcess('vendor-pin')`).

## Subtasks

### T022 : `main.vendor-pin.ts` et module du processus

1. `main.vendor-pin.ts` : copie de `main.tag-keys.ts`, port `VENDOR_PIN_PORT` (défaut 3003), module
   `VendorPinProcessModule`. Écoute locale par défaut (`127.0.0.1`) ; vérifie ce que fait `serve` et n'élargis pas.
2. `processes/vendor-pin.module.ts` : `ProcessDbModule.forProcess('vendor-pin')` (un seul pool, rôle
   `cashless_pin`), `ProcessBaseModule`, `HealthModule`, `AuditModule`, `VendorPinServerModule`, et
   `DenyUnmarkedRoutesGuard` en `APP_GUARD` (même bloc que `tag-keys`). **Aucun** `DeviceIdentityModule`, `KmsModule`,
   `PlatformTx`, ni pool de `cashless_app` (le test d'architecture T026 l'interdit).
3. `vendor-pin-server.module.ts` : fournit `VendorPinDigester` (secret lu **ici seulement**), l'auto-test au démarrage
   (échec = refus de démarrer, avant d'écouter ; NFR-009 déjà tenu aujourd'hui), le contrôleur et le service.
4. Garde de production : le processus refuse de démarrer sans `VENDOR_PIN_SECRET`, avec la valeur de test, sans
   `VENDOR_PIN_CALL_KEY`, sans `DATABASE_URL_PIN`, sans TLS, sans `NODE_ENV` valide (les gardes de WP04 et de
   `bootstrap.ts` y suffisent si tu les appelles ; sinon complète-les ici). **Aucun faux** de PIN ou de client.
5. `apps/api/package.json` : ajoute `"start:vendor-pin": "node --require tsx/cjs dist/main.vendor-pin.js"`, à
   l'identique des autres. Rien d'autre dans ce fichier (aucune dépendance).

Validation : `npx tsc -p tsconfig.json --noEmit` ; démarrage manuel sur `cashless_wp06` (port libre, pas 80 ni 5434)
puis arrêt par ton propre `kill` du PID que tu as lancé (jamais `pkill`).

### T023 : route interne d'ouverture

1. `vendor-pin-call.guard.ts` + `vendor-pin-call-signature.ts` : garde de la route marquée `@Public()` (elle franchit
   `DenyUnmarkedRoutesGuard`) qui exige les deux en-têtes, recalcule le HMAC sur le **corps brut** reçu (lis comment
   le corps brut est disponible : pas de re-sérialisation), refuse `|now − ts| > 30 s`, compare en temps constant
   (`timingSafeEqual` après égalité de longueur). Tout refus : `401` identique, sans dire quel contrôle a échoué.
   Un seul fichier de fonctions pures de signature, réutilisé par WP07 (exporte `signCall(key, ts, method, path,
   body)` et `verifyCall(...)` ; WP07 importe le premier).
2. `vendor-pin-open.service.ts` : déplace **tel quel** A → argon2 → B → C de `vendor-sessions.service.ts` :
   transaction A
   (`begin_vendor_pin_check` sous `TenantTx.run(operatorId)`, rôle `cashless_pin`), `verify` hors transaction (toujours
   un argon2, empreinte factice sinon), transaction B (`open_vendor_session` + audit `VENDOR_SESSION_OPENED` dans la
   même), échec : audit `VENDOR_PIN_FAILED` (+ `VENDOR_LOCKED`) dans une transaction séparée. Le contexte d'audit
   (`requestId`, origine `device:<id>`) vient de la charge, jamais d'un acteur humain.
3. Réponses : session `{ vendor_session_id, vendor_id, vendor_display_name, expires_at }` ; refus de PIN : un seul
   code et un seul corps (même durée de calcul : NFR-004) ; essai concurrent (`23505` sur
   `vendor_session_open_per_device`) : refus distinct que WP07 traduit en `429` ; panne : `5xx` sans détail.
4. `cashless_pin` doit pouvoir écrire `audit_log` : vérifie le droit et la politique RLS posés par WP03. **S'il
   manque**, ne l'accorde pas : décris (règle 1) et arrête-toi sur ce point.
5. Journaux : jamais le PIN, jamais l'empreinte, jamais la signature (passe tout message par `redactSecrets`).

Validation : les cas de T025 ; `grep -n "pin" src/vendor-pin` ne doit montrer aucun `console`/`logger` du PIN.

### T024 : route interne de hachage

`POST /internal/vendor-pin/hash` `{ pin }` → `{ pin_hash }` : même garde de signature ; le PIN est contrôlé par
`PIN_PATTERN` (422 sans écho, comme aujourd'hui) puis haché par `VendorPinDigester.hash`. Limite à nommer dans la
note (déjà au plan) : une API compromise peut poser une empreinte arbitraire par `create_vendor`/`set_vendor_pin`
(verrouiller ou réinitialiser un vendeur) mais pas ouvrir de session sans PIN valide ; aucun élargissement.

Validation : empreinte rendue vérifiable par `open` avec le même secret ; PIN de 5 chiffres : 422 sans écho.

### T025 : tests du processus (`apps/api/test/integration/vendor-pin/`)

Utilise le **vrai** module compilé (`createKeyProcess('vendor-pin')` + `setKeyProcessUrls`, rôle `cashless_pin`).
Fixtures de PIN dans `vendor-pin-fixtures.ts` (amorçage en propriétaire, comme `vendors/vendor-fixtures.ts`).

1. Signature absente, fausse, sur un autre corps, horodatage à +31 s et −31 s : `401` identique ; la base n'est pas
   touchée (compteur d'essais inchangé).
2. PIN juste : session ouverte, une ligne d'audit `VENDOR_SESSION_OPENED` `{vendor_id, device_id}`, compteur à 0.
   PIN faux ou vendeur inconnu, d'un autre prestataire, désactivé, bloqué : même refus ; 5e essai : `FAILED` +
   `LOCKED` ; mêmes lignes que `vendors/vendor-sessions.spec.ts` aujourd'hui.
3. Sous `cashless_pin` (connexion directe) : seul `EXECUTE` de `begin_vendor_pin_check` et `open_vendor_session` ;
   `SELECT` sur `vendor`, `vendor_pin_check`, `vendor_session`, `INSERT` sur `sale_attribution` : `42501`.
4. Démarrage refusé en production sans `VENDOR_PIN_SECRET` ; avec la valeur de test de `TEST_HMAC_KEYS` ; sans
   `VENDOR_PIN_CALL_KEY` ; sans `DATABASE_URL_PIN` : un test chacun (ajoute-les à `processes.spec.ts`, T026, quand
   ils se font au niveau du module).
5. **Mutation NFR-004** : retire la vérification HMAC (garde qui rend toujours vrai), constate l'échec des tests de
   signature, remets-la. Même chose pour la comparaison d'horodatage. Consigne les deux.

### T026 : `architecture.spec.ts` et `processes.spec.ts`

1. `architecture.spec.ts` : (a) seul le processus `vendor-pin` (fichiers atteignables depuis
   `processes/vendor-pin.module.ts`) lit `vendorPinSecret` / `VENDOR_PIN_SECRET` ; aucun fichier atteignable depuis
   la racine publique ne le lit ; (b) le processus `vendor-pin` n'importe ni `PlatformTx`, ni le jeton du pool
   `cashless_app`, ni `KmsModule` ; (c) `main.vendor-pin.ts` figure dans la liste des points d'entrée (l. ~307).
2. `processes.spec.ts` : ajoute `['vendor-pin', VendorPinProcessModule]` aux `it.each` de refus en production
   (NODE_ENV absent ou inconnu, `TRUST_PROXY_HOPS` absent) **quand ces gardes s'appliquent à ce module**, et les
   cas de T025.4. Un module qui n'est pas concerné par un cas (pas de faux KMS) : n'ajoute pas un test creux ;
   écris le test propre et dis pourquoi.
3. **Mutation** : fais lire `VENDOR_PIN_SECRET` à un fichier de l'API publique, constate l'échec de (a), retire-le.

Validation : `SKIP_LATENCY=1 npx jest test/unit/architecture.spec.ts test/unit/processes.spec.ts
test/integration/vendor-pin --runInBand --forceExit` (même appel que `source env.sh`, base `cashless_wp06`).

## Branch Strategy

- Planification et fusion : `feat/durcissements-serveur`.
- Worktree de lane calculé par `lanes.json` ; la base contient WP03 et WP04.
- Commande : `LC_ALL=C LANG=C spec-kitty agent action implement WP06 --agent claude --mission
  durcissements-serveur-01M7QAJD`.

## Definition of Done

- [ ] Processus démarrable (`start:vendor-pin`), pool unique `cashless_pin`, routes non marquées refusées.
- [ ] `open` et `hash` signés ; signature, horodatage et corps vérifiés ; refus uniforme ; mutations consignées.
- [ ] Mêmes audits, mêmes compteurs, même refus unique qu'avant (tests de T025.2 verts).
- [ ] `VENDOR_PIN_SECRET` lu par le seul processus : test d'architecture vert et mutation prouvée.
- [ ] Démarrage refusé en production : secret absent, secret de test, clé d'appel absente, URL de base absente.
- [ ] Charge de `open`, codes de refus et fichier `signCall` figés dans la note de lane (WP07 en dépend).
- [ ] `openapi.yaml` inchangé ; `check.mjs` à 0 refus ; aucune dépendance nouvelle ; lignes ≤ 100.
- [ ] Note de lane : retouches hors carte, écarts, fichiers à faire relire par une personne : `vendor-pin.digester.ts`,
      `vendor-pin-call*.ts` (cryptographie, secret, authentification d'appel).

## Risks

1. **Argon2 sur le pool libuv** : prévois `UV_THREADPOOL_SIZE` suffisant dans la doc de démarrage (note de lane) ;
   l'auto-test se fait avant d'écouter.
2. **Corps brut** : une signature calculée sur un corps re-sérialisé accepte deux formes d'un même message ou refuse
   le bon. Calcule-la sur les octets reçus.
3. **Fuite par le temps** : refus de signature et refus de PIN doivent coûter la même chose qu'avant côté PIN
   (toujours un argon2) ; ne court-circuite pas.
4. **Droit `audit_log`** manquant à `cashless_pin` : écart soumis au porteur, pas rouvert en silence.
5. Écouter sur toutes les interfaces par erreur : le processus ne doit répondre qu'à l'API.

## Ce que le relecteur doit casser

- Appeler les routes sans signature, avec une signature d'un autre chemin, d'un autre corps, rejouée à +31 s, avec
  une clé de même préfixe, avec `x-pin-sig` de longueur différente : tout doit rendre le même `401`, sans toucher la
  base. Retirer la garde et constater que les tests échouent.
- Lire `VENDOR_PIN_SECRET` depuis l'API publique ou depuis `config.ts` du processus public : le test d'architecture
  doit échouer.
- Depuis `cashless_pin`, lire `vendor`, `vendor_pin_check`, ou exécuter une autre fonction : refus.
- Chercher le PIN, l'empreinte ou la signature dans les journaux, les corps d'erreur et l'audit.
- Mesurer qu'un vendeur inconnu et un PIN faux coûtent le même temps de calcul.
- Démarrer le processus en production avec chaque variable absente puis fausse ; avec un faux : doit refuser.
- Vérifier qu'aucun repli (vérification locale, « mode dégradé ») n'existe dans le code livré.
