---
work_package_id: WP07
title: Session de vendeur par le processus (OP-N76)
dependencies: [WP06]
requirement_refs: [FR-006, FR-007, NFR-001]
planning_base_branch: feat/durcissements-serveur
merge_target_branch: feat/durcissements-serveur
branch_strategy: >-
  Planning artifacts for this mission were generated on feat/durcissements-serveur. During
  /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must
  merge back into feat/durcissements-serveur unless the human explicitly redirects the landing branch.
base_branch: kitty/mission-durcissements-serveur-01M7QAJD
base_commit: f7369e8d4c53ae5128c2cb850bad862995e7c6ee
created_at: '2026-11-19T09:53:44.088453+00:00'
subtasks: [T027, T028, T029, T030]
phase: Phase 2 - API et processus
agent: claude
history:
- timestamp: '2026-11-18T16:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/vendors/
create_intent:
- apps/api/src/vendors/vendor-pin.client.ts
- apps/api/test/integration/vendors/vendor-pin-latency.spec.ts
execution_mode: code_change
model: sonnet
owned_files:
- apps/api/src/vendors/**
- apps/api/test/integration/vendors/**
- apps/api/test/unit/vendors/vendor-sessions.service.spec.ts
- apps/api/jest.config.cjs
- apps/api/test/integration/end-to-end/payment-secrets.spec.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP07 : Session de vendeur par le processus (OP-N76)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche commune `docs/passation-11a/fiche-implementation.md`, ce
prompt, puis seulement :

- la note de lane de **WP06** : charge exacte de `POST /internal/vendor-pin/open`, codes de refus, fonction
  `signCall`, nom des réglages ; ces signatures réelles font foi sur ce prompt ; note de lane de WP04 (noms de
  `VENDOR_PIN_URL`, `VENDOR_PIN_CALL_KEY`, dérivé d'idempotence) ;
- `research/R-N76-N79-pin-vendeurs.md` §4 (« Appel par l'API », « Indisponibilité du processus », « Idempotence et
  atomicité », « Latence ») ;
- `apps/api/src/vendors/vendor-sessions.service.ts` (entier), `vendor-sessions.controller.ts` (entier),
  `vendors.controller.ts` l. 25-110 (`hasher.hash` aux l. 68 et 102), `vendors.module.ts`, `vendors.dto.ts`
  (l. 13 : import de `PIN_PATTERN`), `pin-attempt-lock.ts` ;
- `apps/api/src/idempotency/idempotent.decorator.ts` (option `writes`, `transient`) et
  `idempotency.interceptor.ts` l. 150-180 (route d'écriture sans transaction : `500` ; `writes: false` : la réponse
  est enregistrée seule) ;
- `apps/api/test/integration/vendors/vendor-sessions.spec.ts` en entier (l. 184, 313-460 : espions sur
  `hasher.verify` et `hasher.idempotencyBody`, à réécrire) ; `vendors.spec.ts`, `vendor-fixtures.ts` ;
- `test/integration/end-to-end/device-latency.spec.ts` (modèle de mesure), `apps/api/jest.config.cjs` l. 25-52
  (liste `SKIP_LATENCY`), `test/support/app.ts` (`startHttpsApp`).

Priorité des sources (SPECIFICATION §0.3). `interfaces.md` fait foi. Contradiction : tu la signales.

## Objective

Faire passer par le processus `vendor-pin` (WP06) toute vérification de PIN, toute ouverture de session de vendeur et
tout hachage de PIN (création de vendeur, changement de PIN) : un client interne signé, appelé par
`VendorSessionsService` et `VendorsController`, **sans aucun repli** si le processus ne répond pas, avec exactement
les mêmes réponses, le même décompte d'essais et le même audit qu'avant (FR-006, FR-007, NFR-001).

## Context

- **Point ouvert levé** : OP-N76 (suite de WP06). L'API ne lit plus `VENDOR_PIN_SECRET` (WP04 et WP06) ni
  n'exécute plus `begin_vendor_pin_check` ni `open_vendor_session` : WP03 les a retirées à `cashless_app`.
- **Interface possédée** : `VendorPinClient.open(...)` et `.hash(pin)` dans `apps/api/src/vendors/vendor-pin.client.ts`
  (`interfaces.md`, table « TypeScript »). Interfaces consommées : routes internes et en-têtes de WP06 (`x-pin-ts`,
  `x-pin-sig`, fenêtre de 30 s) ; configuration de WP04.
- **Écart de carte à signaler** : le prompt de coordination parlait d'un `vendors/vendor-pin.hasher.ts` ; il n'existe
  pas. Le hacheur est `src/vendor-pin/vendor-pin.hasher.ts` et sa scission est faite par **WP06**. Tu ne le modifies
  pas ; tu retires seulement les usages de `hasher.verify` et `hasher.hash` côté `vendors/`.
- **Route sans écriture dans l'API** (R-N76-N79 §5) : `POST /vendor-sessions` ne passe plus par `IdempotentTx.run` ;
  elle devient `@Idempotent({ …, writes: false })` en gardant `transient: true`, `keyUuid: true`,
  `pinFields: ['pin']`, `nonFinal: ['RATE_LIMITED']`. Vérifie par test que le renvoi de la même clé après succès rend
  encore `409 CONFLICT_STATE`, qu'après un refus `401` il rejoue le `401` sans recompter, et que le `429` reste
  rejouable. Si `writes: false` n'est **pas** compatible avec l'une de ces combinaisons, ne contourne pas : décris
  l'incompatibilité et propose les options (le comportement de la route ne doit pas changer, C-002).
- **Atomicité** (consigner dans la note, pour l'ADR de WP14) : la session est ouverte par le processus hors de la
  transaction idempotente de l'API ; si l'API tombe après le commit du processus et avant la réponse, la session existe
  sans réponse. Route `transient` : un renvoi reçoit `409`, le terminal refait un essai avec une nouvelle clé (nouvel
  essai compté, session précédente `REPLACED`). Pas de régression de sécurité ; ne code rien pour « réparer » ça.

## Subtasks

### T027 : `VendorPinClient` (signature, délai, refus sans repli)

1. Client minimal en `node:https`/`node:http` selon l'URL (`https` imposé en production par la configuration de
   WP04), agent keep-alive, **délai court** (≈ 2 s : argon2 ≈ 60 ms + marge ; ne tiens pas le verrou d'essai plus
   qu'aujourd'hui), **aucune relance automatique** d'un essai de PIN ni d'un hachage.
2. Signature : importe `signCall` de WP06 ; corps JSON sérialisé **une seule fois**, signé sur ces octets exacts,
   envoyés tels quels ; `x-pin-ts` = horloge de l'API en secondes ; chemin signé = chemin appelé.
3. `open({ operatorId, deviceId, vendorId, pin, requestId })` rend une des issues : `opened(session)`, `refused`,
   `concurrent` (essai simultané) ; `hash(pin)` rend l'empreinte (le `422` du PIN mal formé reste celui d'avant : le
   corps est déjà contrôlé par `parseVendorSessionOpen`/`parseVendorCreate`, mais traduis le `422` du processus sans
   écho si il survient).
4. Indisponibilité (connexion refusée, délai, `5xx`, réponse illisible, signature refusée) : **erreur de service sans
   détail** (catalogue du contrat : utilise le code existant `INTERNAL_ERROR` 500 ou celui que WP06 documente ; **aucun
   code nouveau**, C-002). Jamais de session, jamais de vérification locale, jamais le PIN dans le message.
5. Fourni par `VendorsModule` ; configuration par `APP_CONFIG` (URL et clé d'appel de WP04). **Aucun faux client** dans
   le code livré (règle 2) : les tests visent le vrai processus.

Validation : `npx tsc -p tsconfig.json --noEmit` ; cas de T029.

### T028 : `vendor-sessions.service.ts` et `vendors.controller.ts` passent par le client

1. `VendorSessionsService.open` : conserve le verrou d'essai (`RequestLock`, `pin-attempt-lock.ts`, pris avant tout
   appel : une ouverture simultanée du même terminal est refusée `429` sans appel au processus), appelle
   `client.open(...)`, puis traduit : `opened` → `vendorSessionDto`, `refused` → `pinInvalid()` (même `401
   VENDOR_PIN_INVALID`), `concurrent` → `attemptInProgress()` (même `429`). Supprime A/B/C, `recordFailure`,
   `openSession`, `OPEN_SESSION_INDEX` s'il n'est plus utilisé ici (il est dans le processus). `listForTerminal` et
   `close` ne changent pas.
2. Contrôleur : `@Idempotent` en `writes: false` (voir Context) ; l'audit `VENDOR_SESSION_OPENED` est écrit par le
   processus, pas par l'API : plus de double écriture. `deviceAudit` reste exporté (le processus reçoit `requestId`).
3. `vendors.controller.ts` : `this.hasher.hash(...)` devient `this.pinClient.hash(...)` (création de vendeur l. 68,
   changement de PIN l. 102) ; le contrôle « hors portée : 404 avant tout calcul » reste avant l'appel. `create_vendor`
   et `set_vendor_pin` restent exécutées par `cashless_app` avec l'empreinte rendue (limite nommée, au plan).
4. `vendors.module.ts` : retire la dépendance à `VendorPinModule` si plus rien n'en vient ici ; garde-la si
   l'intercepteur d'idempotence en a besoin (`moduleRef.get(VendorPinHasher, {strict:false})`) : vérifie.
5. Aucun import de `argon2`, de `vendor-pin.digester`, ni lecture de `vendorPinSecret` sous `src/vendors/`
   (`grep` ; le test d'architecture de WP06 le prouve).

Validation : `grep -rn "hasher\|argon2\|vendorPinSecret" src/vendors` ne rend rien d'autre que `PIN_PATTERN`.

### T029 : `vendor-sessions.spec.ts` réécrit

Les espions sur `hasher.verify` (l. 184, 313-460) supposent la vérification dans l'API : à réécrire. Garde la **même
intention** de chaque cas, avec le vrai processus (`createKeyProcess('vendor-pin')` ou `startHttpsApp`, URL branchée
dans la configuration de l'API de test) :

1. Parcours inchangés (contrôle positif de FR-007 : mêmes fixtures, mêmes attentes de corps et de statut) : bon PIN
   `201` et audit `VENDOR_SESSION_OPENED`, PIN faux/inconnu/autre commerçant/désactivé/bloqué (même `401` et même
   corps), PIN mal formé `422` sans essai compté, 5 échecs puis blocage (`FAILED` + `LOCKED`), « compter d'abord »,
   deux terminaux, remplacement `REPLACED`, fermeture `LOGOUT`, liste de vendeurs.
2. **Processus arrêté** (FR-006, sans repli) : arrête le processus de test, `POST /vendor-sessions` avec le bon PIN →
   erreur de service ; `vendor_session` inchangée, aucune ligne `VENDOR_SESSION_OPENED` ; l'API n'a **pas** exécuté
   `begin_vendor_pin_check` ni `open_vendor_session` (aucun essai compté, `vendor_pin_check` vide). Même cas : appel
   avec signature fausse côté client (clé d'appel erronée en configuration) → refus, rien d'écrit.
3. Verrou d'essai : essai retenu dans le processus (ralentis-le par une garde de test sur le serveur, jamais sur le
   code de production) → le second reçoit `429` + `Retry-After: 1`, clé du `429` rejouable, rien compté.
4. ADR-126 : l'empreinte d'idempotence reste le HMAC du corps **dérivé** (pas du PIN en clair) ; même clé avec autre
   PIN → `409 IDEMPOTENCY_KEY_REUSED`, même PIN → rejeu. Ces cas utilisent `idempotencyBody` de l'API : l'espion
   porte sur le hacheur d'API réduit (WP06).
5. 20 essais simultanés de PIN faux, même terminal : `401` ou `429`, au plus 5 comptés ; 5 terminaux × 4 : bloqué à 5
   exactement. Création de vendeur et changement de PIN : l'empreinte vient du processus et se vérifie à l'ouverture.
6. `vendors.spec.ts` et `vendor-fixtures.ts` : le PIN d'amorçage est haché par le processus de test (ou par le
   digesteur de WP06 avec le même secret de test) ; ne recopie pas le secret en clair dans un fichier de test.
7. **Mutation NFR-004** : dans ta lane, remets un repli (vérification locale ou session ouverte quand le processus est
   absent), constate que le cas 2 échoue, retire-le. Consigne.

Validation (même appel Bash, voir la fiche) : `export PGDATABASE=cashless_wp07; source ../../tools/dev-db/env.sh;
env | grep DATABASE_URL`, puis `SKIP_LATENCY=1 npx jest test/integration/vendors test/unit/vendors
--runInBand --forceExit`. `reset-db` ensuite.

`test/unit/vendors/vendor-sessions.service.spec.ts` (suit le service) et `test/integration/end-to-end/payment-secrets.spec.ts`
sont à toi. **Retrait du champ `vendorPinSecret`** : quand plus rien dans l'API ne le lit, retire-le d'`AppConfig` et de
`loadConfig` dans `apps/api/src/config/config.ts` (retouche **hors carte** autorisée, possédée par WP04 : seulement ce
champ et sa lecture ; liste-la dans la note) ; `tsc` sans erreur. Hors carte aussi, une ligne : `test/support/app.ts`
(possédé par WP06) pour brancher l'URL du processus de test dans la configuration de l'API de test.

### T030 : suite de latence NFR-001

1. `apps/api/test/integration/vendors/vendor-pin-latency.spec.ts` (nouveau), sur le modèle de `device-latency.spec.ts` :
   200 ouvertures de session en série (PIN juste ; ferme ou remplace la session entre deux ; un terminal par lot
   si le verrou l'exige), HTTPS réel vers l'API, processus `vendor-pin` réel ; mesure p95 et p99 de la route.
2. Seuils : p95 ≤ 300 ms, p99 ≤ 600 ms (NFR-001). Écris-les comme assertions, avec en commentaire le « attendu »
   de la recherche (≈ 80-120 ms) ; imprime les valeurs mesurées (elles vont dans la matrice de WP14).
3. Ajoute `'vendors/vendor-pin-latency'` à la liste `SKIP_LATENCY` de `apps/api/jest.config.cjs` (fichier à toi)
   (l. 30-50), à lister dans la note. Sans cela, la passe parallèle la lance.
4. Lance-la **seule** : `npx jest test/integration/vendors/vendor-pin-latency.spec.ts --runInBand --forceExit`
   (sans `SKIP_LATENCY`). Sous Docker, une mesure instable se signale sans relâcher le seuil.

## Branch Strategy

- Planification et fusion : `feat/durcissements-serveur`.
- Worktree de lane calculé par `lanes.json` ; la base contient WP06 (donc WP03 et WP04).
- Commande : `LC_ALL=C LANG=C spec-kitty agent action implement WP07 --agent claude --mission
  durcissements-serveur-01M7QAJD`.

## Definition of Done

- [ ] `VendorPinClient` signé, délai court, sans relance, sans repli ; erreur de service sans détail ni PIN.
- [ ] `POST /vendor-sessions` : mêmes statuts, corps, en-têtes, audit et décompte qu'avant ; `writes: false` validé.
- [ ] `vendors/` ne contient plus `argon2`, `hasher.verify`, `hasher.hash`, lecture du secret.
- [ ] Cas « processus arrêté » : refus, `vendor_session` et `vendor_pin_check` inchangées, aucun appel direct de
      `begin`/`open` ; mutation du repli prouvée.
- [ ] `vendor-sessions.spec.ts`, `vendors.spec.ts`, `vendor-sessions.service.spec.ts` verts sur `cashless_wp07`.
- [ ] Latence : p95 et p99 mesurés et sous les seuils ; `SKIP_LATENCY` mis à jour.
- [ ] `openapi.yaml` inchangé, `check.mjs` à 0 refus ; aucune dépendance ; lignes ≤ 100.
- [ ] Note de lane : retouches hors carte, mesures, fichiers à faire relire : `vendor-pin.client.ts`
      (authentification d'appel, secret).

## Risks

1. `writes: false` et `transient` : combinaison peu testée ; un `500` `IDEMPOTENT_ROUTE_WITHOUT_TX` ou une clé non
   relâchée sur erreur de service. Teste l'erreur de service puis le renvoi de la même clé.
2. Message d'erreur du client qui cite le corps (PIN) : passe-le par `redactSecrets` ou n'en mets pas.
3. Le verrou d'essai tenu pendant l'appel : un délai trop long bloque le terminal ; garde le délai court.
4. Fixtures qui hachent le PIN dans l'API : plus de secret côté API, elles échouent à l'ouverture.
5. Horloge : API et processus sur des horloges décalées de plus de 30 s refusent tout ; en test, même machine.

## Ce que le relecteur doit casser

- Arrêter le processus, ou lui faire répondre `500`/lentement : aucune session, aucune vérification dans l'API, aucun
  `begin_vendor_pin_check` exécuté par `cashless_app` (droit retiré : `42501`). Chercher un repli caché (`catch` qui
  ouvre quand même, `try` sur `verify`).
- Comparer `POST /vendor-sessions` avant/après, octet par octet (statuts, corps, `Retry-After`) pour chaque cas.
- Rejouer la même clé : succès → `409`, refus → `401` rejoué sans recompte, `429` → rejouable.
- Lire les journaux, l'audit, les messages d'erreur pour un PIN ou une signature.
- Compter les essais après indisponibilité : un essai compté avant la panne reste compté (échec sûr voulu).
- Vérifier que le test de latence échoue si on ajoute 400 ms au processus, et qu'il est bien écarté par `SKIP_LATENCY`.
- Chercher tout accès de `src/vendors/` à `VENDOR_PIN_SECRET`.
