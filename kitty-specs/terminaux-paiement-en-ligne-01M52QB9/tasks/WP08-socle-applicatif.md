---
work_package_id: WP08
title: "Socle : argon2, secret, contexte du terminal, idempotence, garde, erreurs"
dependencies: [WP01]
requirement_refs: [FR-003, FR-009, FR-015, FR-016, FR-025, NFR-002, NFR-004, NFR-008, NFR-009, C-003, C-009]
planning_base_branch: feat/terminaux-paiement-en-ligne
merge_target_branch: feat/terminaux-paiement-en-ligne
branch_strategy: Planning artifacts for this mission were generated on feat/terminaux-paiement-en-ligne. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/terminaux-paiement-en-ligne unless the human explicitly redirects the landing branch.
subtasks: [T032, T033, T034, T035, T036, T037, T038]
phase: "Phase 2 - Socle applicatif"
history:
- timestamp: '2026-10-22T14:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks-packages
agent_profile: node-norris
role: implementer
agent: claude
authoritative_surface: apps/api/
create_intent:
- apps/api/src/vendor-pin/vendor-pin.module.ts
- apps/api/src/vendor-pin/vendor-pin.hasher.ts
- apps/api/src/vendor-pin/argon2-self-test.ts
- apps/api/src/device-identity/device-or-caller.guard.ts
- apps/api/src/idempotency/device-key.ts
- apps/api/src/errors/redact.ts
- apps/api/test/unit/vendor-pin/argon2-supply-chain.spec.ts
- apps/api/test/unit/vendor-pin/vendor-pin.hasher.spec.ts
- apps/api/test/unit/device-route/device-context.spec.ts
- apps/api/test/unit/device-route/device-key.spec.ts
- apps/api/test/unit/device-route/device-or-caller.guard.spec.ts
- apps/api/test/unit/device-route/tenant-context.spec.ts
- apps/api/test/integration/end-to-end/device-auth-cases/registry.ts
execution_mode: code_change
owned_files:
- package-lock.json
- apps/api/package.json
- apps/api/src/config/config.ts
- apps/api/src/kms/production-guard.ts
- apps/api/src/vendor-pin/**
- apps/api/src/device-identity/**
- apps/api/src/identity/identity-tenant-context.ts
- apps/api/src/idempotency/**
- apps/api/src/errors/**
- apps/api/test/unit/errors/**
- apps/api/test/unit/config.spec.ts
- apps/api/test/unit/production-guard.spec.ts
- apps/api/test/unit/vendor-pin/**
- apps/api/test/unit/device-route/**
- apps/api/test/support/test-terminal.ts
- apps/api/test/integration/end-to-end/device-auth-matrix.spec.ts
- apps/api/test/integration/end-to-end/device-auth-cases/registry.ts
- tools/dev-db/env.sh
- tools/dev-db/env.test.example
tags: []
tracker_refs: []
---

# Work Package Prompt: WP08 – Socle : argon2, secret, contexte du terminal, idempotence, garde, erreurs

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load node-norris` (Profile : node-norris / Role : implementer / Agent : claude).
Lis ensuite la fiche de contexte d'implémentation fournie par l'orchestrateur, ce prompt, puis seulement :
- `plan.md` : IC-11, IC-13 ; `research.md` : R-01 (argon2, chaîne d'approvisionnement), R-03 (prestataire d'une route de
  terminal seul), R-10 (secret), R-11 (A3, A13, A14, A16, A19, A26) ;
- `contracts/vendors.md` : « Empreinte du PIN », « Secret `VENDOR_PIN_SECRET` » ; `contracts/payments.md` : « Clé et
  registre des numéros », « `GET /payments/{transaction_id}` » (garde exclusive) ; `data-model.md` : « Codes d'erreur
  nouveaux » ; `docs/08-pile-logicielle.md` (ligne `argon2`, règle d'ajout d'une dépendance) ;
- code : `apps/api/src/device-identity/` (`device.guard.ts`, `device-identity.module.ts`, `device-identity.port.ts`),
  `identity/identity-tenant-context.ts`, `identity/authentication.guard.ts`, `customer-identity/customer.guard.ts`,
  `idempotency/` (intercepteur, décorateur, `request-hash.ts`), `media/lifecycle/counter-access.ts` (`counterScope`),
  `errors/sqlstate-map.ts`, `errors/problem.filter.ts` (`logProblem`), `config/config.ts` (`hmacKey`,
  `TEST_HMAC_KEYS`, `assertDistinctHmacKeys`), `processes/bootstrap.ts`, `test/support/device-e2e.ts`,
  `test/integration/end-to-end/device-auth-matrix.spec.ts`.

Règle §0.3 : en cas de contradiction entre sources, appliquer la priorité (tests exécutables > schéma SQL,
`openapi.yaml`, `sync_protocol.md` > SPECIFICATION > PRD) et **la signaler**. Jamais de modification d'un `.sql` généré
de `packages/ledger-sql/`.

## Objective

Livrer tout ce dont les lots de routes (WP09 à WP13) ont besoin et qu'aucun ne doit écrire seul : `argon2@0.44.0`
vérifié, hachage du PIN avec `VENDOR_PIN_SECRET` et test au démarrage, contexte du terminal enrichi, idempotence d'une
route de terminal seul, garde exclusive « terminal ou personne / festivalier », traduction des nouveaux codes et
masquage des journaux, registre de cas de la matrice des preuves. Aucune route métier n'est servie ici.

## Context

- IC-11, IC-13 (partie API). Exigences : FR-003 (PIN vérifié par le serveur), FR-009 (clé et prestataire de
  `createPayment`), FR-015 (mode, téléphone personnel), FR-016/FR-025 (routes « terminal ou personne »), NFR-002,
  NFR-008 (aucun secret en clair), NFR-009 (aucun faux, garde de démarrage), C-003 (trois preuves).
- Décisions : secret hors base (porteur, 22/10) ; `argon2@0.44.0` et non 0.45 (porteur, 22/10 ; document 08) ;
  A13 garde exclusive **sans repli** ; A14 `<serial>` lié au terminal, 409 non définitifs non enregistrés ; A16
  provenance et vecteur au démarrage.
- Dépend de WP01 (`ProblemCode` régénérés). WP09 à WP13 en dépendent.
- **Constat du code (à respecter)** : `TenantDeviceDirectory` et `DEVICE_QUERY` servent aussi le processus des clés
  (`cashless_tagkeys`), qui n'a `SELECT` que sur `id, operator_id, event_id, pos_id, status, agreement_public_key,
  public_key, cert_sha256, os, nfc_enabled` (`post-roles.sql`, §2a). Ajouter des colonnes à `DEVICE_QUERY` casserait ce
  processus ; élargir les droits de `cashless_tagkeys` est un **affaiblissement** (à soumettre). Voir T034.

**Règle de sécurité du projet (`CLAUDE.md`, C-009)** : si un point de ce lot ne peut être tenu qu'en affaiblissant la
sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps, garde avec
repli), **arrête-toi sur ce point et soumets-le au porteur avant de coder**, avec le risque et les options ; continue
le reste. Un renforcement se fait, puis se consigne dans le compte rendu du lot.

## Arbitrages de l'orchestrateur (22/10/2026)

Décisions prises à la génération des lots ; tous dans le sens le plus strict ou de pure répartition (aucun
affaiblissement, règle 1 de `CLAUDE.md`). Elles priment sur les « points à trancher » du texte ci-dessus et
ci-dessous. Reporter dans le compte rendu du lot les écarts au plan qui en découlent.

- `apps/api/test/unit/errors/**` ajouté à la carte du lot (test de `sqlstate-map`).
- Traduire aussi `CL038` → `MEDIA_BLOCKED`, `CL039` → `WALLET_BLOCKED`.
- Requête séparée du contexte enrichi pour le seul processus public ; `DEVICE_QUERY` du processus des clés inchangée. Garde paramétrée « terminal ou personne » et « terminal ou festivalier ».
- Une ligne d'import de `VendorPinModule` dans `app.module.ts` : retouche hors carte autorisée.
- Le registre de cas accepte un fichier `*.cases.ts` sans cas (WP10).

## Branch Strategy

Planification et fusion sur `feat/terminaux-paiement-en-ligne`. Dépendances : WP01. Worktree attribué par lane
(`lanes.json`). Commande :
`spec-kitty agent action implement WP08 --agent claude --mission terminaux-paiement-en-ligne-01M52QB9`.

## Subtasks

### T032 — Dépendance `argon2@0.44.0` et test des empreintes des binaires

- `apps/api/package.json` : `"argon2": "0.44.0"` (version exacte) ; `npm install --ignore-scripts` (`.npmrc` impose
  `ignore-scripts=true`). `package-lock.json` : intégrité `sha512-zHPGN3S55sihSQo0dBbK0A5qpi2R31z7HZDZnry3ifOyj8bZZnpZND2gpmhnRGO1V/d555RwBqIK5W4Mrmv3ig==`
  (R-01) ; dépendances transitives attendues : `@phc/format`, `node-addon-api`, `node-gyp-build@4.8.4`, `cross-env`.
  Toute autre entrée nouvelle dans le verrou : s'arrêter et signaler.
- `npm audit signatures` : attestations vérifiées (sortie dans le compte rendu).
- `test/unit/vendor-pin/argon2-supply-chain.spec.ts` : version installée = `0.44.0` ; intégrité du verrou = celle de
  R-01 ; le binaire réellement chargé (`require('node-gyp-build').path(<dossier du paquet>)`) a une empreinte SHA-256
  présente dans la liste de R-01 (`linux-x64` glibc `d573da57…8cd0`, musl `90d12fb1…c47a`, `darwin-x64`
  `1698dae5…c166`, valeurs complètes de R-01) ; plateforme absente de la liste → échec explicite (OP-N11 : plateforme
  de production non arrêtée).
- Signaler dans le compte rendu : `cross-env` installé en production (inutile à l'exécution, sans script).

### T033 — `VENDOR_PIN_SECRET`, vecteur argon2 au démarrage, garde de production

- `config.ts` : `vendorPinSecret: Buffer` lu par `hmacKey(env, 'VENDOR_PIN_SECRET', …)` (32 octets au moins, hex ou
  base64 ; obligatoire en production) ; `TEST_VENDOR_PIN_SECRET` (valeur publique) ajouté à `TEST_HMAC_KEYS` (refusé en
  production même posé) ; ajouté à `assertDistinctHmacKeys` avec les trois secrets existants.
- `tools/dev-db/env.sh` et `env.test.example` : valeur de test (même procédé `printf … | od` que les autres), distincte.
- `src/vendor-pin/vendor-pin.hasher.ts` (`VendorPinHasher`, injectable) :
  - `PIN_PATTERN = /^[0-9]{6}$/` ; `hash(pin)` refuse un PIN hors motif (`422 VALIDATION_FAILED`, sans écho) ;
  - paramètres figés : `type: argon2id`, `memoryCost: 19456`, `timeCost: 2`, `parallelism: 1`, sel de 16 octets,
    `secret: vendorPinSecret` ; sortie PHC `$argon2id$v=19$…` ;
  - `verify(pinHash | null, pin): Promise<boolean>` : **toujours** un calcul argon2 ; `null` (vendeur inconnu, bloqué,
    désactivé, d'un autre commerçant) → vérification contre l'**empreinte factice**, calculée au démarrage depuis
    32 octets aléatoires (hors motif : jamais égale à un PIN), mêmes paramètres et même secret ; rend `false` ;
  - aucune méthode ne journalise le PIN ni l'empreinte ; erreurs d'argon2 rethrow sans leur message d'entrée.
- `src/vendor-pin/argon2-self-test.ts`, appelé par `VendorPinModule.onModuleInit` (échec → exception → démarrage
  refusé) : (1) **vecteur connu indépendant** : RFC 9106 §5.3 (argon2id, mot de passe 32 × `0x01`, sel 16 × `0x02`,
  secret 8 × `0x03`, données associées 12 × `0x04`, m = 32, t = 3, p = 4, sortie brute 32 octets) comparé à l'étiquette
  **recopiée du texte de la RFC** (prouve que le binaire calcule argon2id et applique le secret ; si `argon2@0.44.0`
  n'expose pas `associatedData`, s'arrêter et proposer un autre vecteur publié) ; (2) aller-retour avec le vrai
  secret : `hash` puis `verify` vrai, autre PIN faux, empreinte calculée sans secret refusée. **Précision du plan**
  (« empreinte calculée avec le secret ») : un vecteur figé avec le secret de production est impossible ; à consigner.
- `VendorPinModule` exporte `VendorPinHasher`. Pour que le test au démarrage tienne dès ce lot, **une ligne**
  d'import de `VendorPinModule` dans `apps/api/src/app.module.ts` (retouche hors carte, consignée ; WP09 l'importera
  aussi dans son module).
- `production-guard.ts` : aucune modification attendue (le refus vient de la configuration et du module) ; le toucher
  seulement si un nouveau faux apparaît.
- Tests : `config.spec.ts` (production sans secret, avec le secret de test, secret égal à un autre → refus ; hors
  production → secret de test) ; `vendor-pin.hasher.spec.ts` (format PHC, paramètres lus dans l'empreinte, PIN hors
  motif refusé, `verify(null, …)` faux et non instantané comparé à un vrai calcul — marge large, pas de mesure fine,
  vecteur RFC, auto-test qui échoue si l'on simule un binaire faux) ; `production-guard.spec.ts` inchangé sauf besoin.

### T034 — `DeviceContext` enrichi

- `DeviceContext` gagne : `serial: string`, `appMode: 'CATALOG_POS' | 'KEYPAD_TPE' | 'TOPUP_DESK'`,
  `personalPhone: boolean`, `merchantId: string | null`, `participationId: string | null` (point de vente →
  `merchant_participation`), facultatifs dans le type pour les contextes construits à la main.
- **Sans toucher `DEVICE_QUERY`** ni les droits de `cashless_tagkeys` : le processus public (`cashless_app`, qui lit
  `device`, `point_of_sale`, `merchant_participation`) lit ces champs par une requête propre
  (`DEVICE_DETAILS_QUERY`, jointure gauche sur `point_of_sale` et `merchant_participation`, même prestataire), dans la
  même transaction que `find` ; le processus des clés garde la requête étroite. Mécanisme au choix (deux fournisseurs
  de `DEVICE_DIRECTORY`, ou option du module) ; le processus des clés ne doit jamais exécuter la requête large.
  Si ce n'est pas tenable sans élargir les droits de `cashless_tagkeys` : s'arrêter et soumettre.
- `DeviceGuard` recopie ces champs dans `req.device`. Contrôle de mode **non** ajouté à la garde (chaque lot le fait
  selon sa route) ; fournir un utilitaire `assertDeviceMode(device, allowed[])` → `422 DEVICE_MODE_NOT_ALLOWED`.
- Tests `test/unit/device-route/device-context.spec.ts` ; non-régression : `device-auth-matrix.spec.ts` et suites du
  processus des clés vertes.

### T035 — Idempotence d'une route de terminal (prestataire, `serial`, refus non définitifs)

- `identity-tenant-context.ts` : si `req.device` est posé (seule `DeviceGuard` le pose) et qu'il n'y a ni personne ni
  festivalier, rendre `{ operatorId: req.device.operatorId }` ; chemin `/operators/:operator_id/…` → `404`. Cas
  guichet (personne **et** terminal) : comportement inchangé. Aucune autre source (en-tête, corps) n'en décide. Test :
  une route de personne sans `@DeviceAuth` ne voit jamais `req.device` (pas de repli).
- `src/idempotency/device-key.ts` : `deviceScope = (req) => \`device:${requestDevice(req).deviceId}:\`` (même forme
  que `counterScope`) ; `parseDeviceKey(key, device)` : motif `^(.+):([0-9]{4,})$`, `<serial>` = `device.serial`,
  sinon `422 VALIDATION_FAILED` **avant** la réservation (rien d'écrit) ; rend `seq` (bigint).
- `IdempotentOptions.deviceSeq?: true` : active `parseDeviceKey` et pose `req.deviceSeq` pour le contrôleur (WP11 le
  passe à `record_device_seq`). `record_device_seq` lui-même est appelé par WP11, pas ici.
- Refus non définitifs : dans `onError`, un problème `DEBIT_AUTHORITY_MOVING` ou `DEBIT_AUTHORITY_EDGE` (liste fermée
  `NON_FINAL_CODES`) **relâche** la clé comme un 5xx (rien d'enregistré) et part tel quel ; idem s'il survient dans
  `run` (transaction annulée). Tout autre 4xx reste enregistré.
- Tests `test/unit/device-route/device-key.spec.ts`, `tenant-context.spec.ts` (motif, autre serial, `seq` < 4
  chiffres, clé relâchée sur les deux codes, enregistrée sur un autre 409).

### T036 — Garde exclusive « terminal ou personne » (A13)

- `src/device-identity/device-or-caller.guard.ts` : décorateur `DeviceOrCallerAuth({ other: 'person' | 'customer',
  device?: DeviceAuthOptions })` = `Public()` + `UseGuards(DeviceOrCallerGuard)`. Marqueurs de terminal : certificat
  client présenté sur la socket TLS, ou en-tête `Signature` ou `Signature-Input`. **Un marqueur présent → `DeviceGuard`
  complet (trois preuves), aucun repli** ; aucun marqueur → `AuthenticationGuard` (`person`) ou `CustomerGuard`
  (`customer` : `getPaymentRequest`, `cancelPaymentRequest` côté festivalier, R-08) — appelés comme objets, jamais
  par la garde globale. `X-Staff-Authorization` : refusé (pas une route de guichet).
- Métadonnée lisible par `guardedRoutes` (la matrice doit voir ces routes comme routes de terminal) : la garde est
  posée par `UseGuards(DeviceOrCallerGuard)` ; T038 l'ajoute aux gardes lues.
- Tests `device-or-caller.guard.spec.ts` : certificat seul sans jeton → 401 ; signature seule → 401 ; jeton de
  personne + certificat → 401 (pas de repli) ; personne sans marqueur → principal posé ; festivalier sans marqueur →
  client posé ; terminal complet → `req.device`.

### T037 — Traduction des codes d'erreur et masquage des journaux

- `sqlstate-map.ts` : `CL031` `ENROLLMENT_EVENT_CLOSED` 422, `CL032` `VENDOR_SESSION_INVALID` 409, `CL033`
  `VENDOR_PIN_INVALID` 401, `CL034` `SALE_LINES_INVALID` 422, `CL035` `ALREADY_REVERSED` 409, `CL036`
  `REVERSAL_NOT_ALLOWED` (statut **retenu par WP01** : 422 au contrat actuel, 403 au data-model — prendre celui du
  contrat généré), `CL037` `PAYMENT_REQUEST_NOT_PENDING` 409.
- `23505` avec contrainte **nommée** `journal_transaction_reverses_once` → `409 ALREADY_REVERSED` ; tout autre `23505`
  reste `500` (A19) : table `UNIQUE_CONSTRAINTS` fermée, comme `DOUBLE_VALIDATION_CONSTRAINTS`.
- `src/errors/redact.ts` : `redactSecrets(text)` remplace toute empreinte `$argon2id$…`, et les valeurs des champs
  `pin`, `token`, `customer_qr_token`, `qr_payload` et de l'en-tête `X-Approval-Token` si elles apparaissent ;
  appliqué au `message` journalisé par `logProblem`. Aucun journal des corps n'existe aujourd'hui : règle écrite en
  commentaire (tout futur journal de requête passe par `redactSecrets`).
- Test : `apps/api/test/unit/errors/sqlstate-map.spec.ts` (tableau `TABLE`, cas `23505`) — **hors carte** (dossier
  `test/unit/errors/` non attribué) : retouche consignée ; tests de `redactSecrets` dans
  `test/unit/device-route/` ou dans ce même fichier.

### T038 — Registre de cas de la matrice des preuves

- `device-auth-cases/registry.ts` : charge **tous** les fichiers `*.cases.ts` du dossier (lecture du dossier, pas
  d'index à éditer) ; chaque fichier exporte `controllers: string[]` et `cases(ctx): Record<string, RouteCase>`.
  `CaseContext` donne : monde de test (`w`), terminal, bracelet, serveurs, `next()`, `seqKey(terminal)` (clé
  `<serial>:<seq>` croissante), et un crochet `prepare?(ctx)` pour l'amorçage d'un cas (ex. session de vendeur).
  Doublon de clé de route entre fichiers ou avec les cas de base → échec explicite.
- `RouteCase` étendu : méthodes `GET | POST | PUT | PATCH | DELETE`, `idempotencyKey?: (ctx) => string` (défaut :
  UUID), `exclusive?: 'person' | 'customer'` pour les routes de T036.
- `device-auth-matrix.spec.ts` : les 13 cas actuels restent dans le fichier (cas de base) et se fusionnent avec ceux
  du registre ; ensemble des contrôleurs attendus = base ∪ `controllers` des fichiers ; routes gardées =
  `guardedRoutes(DeviceGuard)` ∪ `guardedRoutes(DeviceOrCallerGuard)` ; variantes « avec corps » pour POST, PUT,
  PATCH ; « routes du contrat non servies : 404 » gardé et généralisé à toutes les méthodes.
- `test/support/test-terminal.ts` : `seqKey()` (compteur par terminal, 4 chiffres au moins).
- À ce lot, aucun fichier `*.cases.ts` : la matrice doit rester verte à l'identique (même nombre de routes servies).

## Test Strategy

Ordre : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`,
`npm run test:pgtap -w @cashless/ledger-sql`, puis `npm run reset-db -w @cashless/ledger-sql && npm test -w
@cashless/api -- --runInBand`. Jamais pgTAP sur une base où Jest vient de tourner (rejouer `reset-db`). La base
partagée appartient à l'orchestrateur : lance tes tests unitaires librement, mais demande-lui les suites d'intégration
(`device-auth-matrix`, `device-isolation`, suites du processus des clés), en série seulement. Dans un worktree de
lane, créer d'abord les liens `node_modules/@cashless/{api,contracts,ledger-sql,tag-format}` ; y installer `argon2`
avec `--ignore-scripts`. Horloge de la base Docker qui peut reculer : aucun test ne compare l'heure de Node à `now()`
de la base sans marge.

## Definition of Done

- Démarrage refusé (test) : production sans `VENDOR_PIN_SECRET`, avec le secret de test, secret égal à un autre, et
  vecteur argon2 faux. Binaire chargé d'empreinte connue.
- Idempotence de terminal seul, garde exclusive, nouveaux codes, `ALREADY_REVERSED` par nom de contrainte, masquage :
  testés. Matrice des preuves verte, inchangée en contenu, lisant le registre.
- Lint, typecheck, toutes les suites vertes. Chaque sous-tâche marquée par `spec-kitty agent tasks mark-status Txxx
  --status done --mission terminaux-paiement-en-ligne-01M52QB9`.
- Compte rendu du lot ajouté en fin de ce fichier : écarts au plan (sens), retouches hors carte (`app.module.ts`,
  `test/unit/errors/sqlstate-map.spec.ts`, une ligne chacune), points soumis au porteur, fichiers à faire relire par
  une personne (`vendor-pin/`, `config.ts` pour le secret, `device-or-caller.guard.ts`, `identity-tenant-context.ts`),
  **critères d'acceptation couverts avec leur preuve** (NFR-009 : `config.spec.ts` et nom du cas ; A16 :
  `argon2-supply-chain.spec.ts` ; A13 : `device-or-caller.guard.spec.ts` ; A14 : `device-key.spec.ts` ; A19 :
  `sqlstate-map.spec.ts`).

## Risks

- Extension d'`IdentityTenantContext` qui laisserait une route de personne s'exécuter pour un terminal.
- Garde « l'un ou l'autre » avec repli : un terminal sans preuve valide passerait par le chemin personne.
- Requête de terminal élargie qui casse le processus des clés, ou droits de `cashless_tagkeys` élargis.
- Empreinte factice calculée différemment (paramètres, secret) : différence de temps visible (NFR-004).
- Clé relâchée sur un 4xx définitif : un rejeu referait une écriture refusée.

## Reviewer Guidance

Le relecteur distinct vérifie, refus par refus : secret obligatoire, distinct et refusé s'il est de test ; vecteur
RFC recopié de la RFC, pas du binaire ; `verify` toujours calculé ; aucune trace du PIN ou de l'empreinte dans les
messages d'erreur ; `DEVICE_QUERY` et droits de `cashless_tagkeys` inchangés ; `IdentityTenantContext` ne lit que
`req.device` posé par la garde ; `<serial>` contrôlé avant réservation ; seuls les deux codes non définitifs
relâchent la clé ; marqueur de terminal → trois preuves sans repli ; `23505` traduit seulement pour la contrainte
nommée ; registre sans fichier index et matrice inchangée en contenu.

## Reports de l'orchestrateur (23/10/2026)

- Transféré de WP06 (arbitrage « audit de tous les refus », ADR-117) : ajouter `ENROLLMENT_EVENT_CLOSED:
  'EVENT_CLOSED'` à `ATTEMPT_RESULTS` dans `apps/api/src/devices/enrollment/enrollment.service.ts` (retouche hors
  carte autorisée). WP06 ne pouvait pas le faire : sa lane n'a pas le `ProblemCode` de WP01. La base est prête
  (0035 élargit `device_enrollment_attempt.result` à `EVENT_CLOSED` et remplace `record_enrollment_attempt`).
  Prouver par un test d'intégration qu'un refus `CL031` à l'enrôlement est compté et audité, sans terminal créé ni
  code consommé. Si la lane n'a pas encore 0035 (WP06 non fusionné), écrire le test et le signaler : l'orchestrateur
  le jouera sur la combinaison des lanes.
- ADR-123 : `sqlstate-map.ts` : `CL036` → `422 REVERSAL_NOT_ALLOWED` (et non 403) ; nouveau `CL040` →
  `409 REVERSAL_WINDOW_EXPIRED`. La traduction de `CL037` en `422 QR_TOKEN_INVALID` sur le QR client se fait dans la
  route (WP13), pas dans la table globale.
