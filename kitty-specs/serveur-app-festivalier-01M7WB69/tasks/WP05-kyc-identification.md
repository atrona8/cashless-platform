---
work_package_id: WP05
title: Identification au guichet (API) — createKycVerification
dependencies: [WP04]
requirement_refs:
- FR-001
- FR-002
- FR-003
- FR-006
- NFR-003
- C-006
planning_base_branch: feat/serveur-app-festivalier
merge_target_branch: feat/serveur-app-festivalier
branch_strategy: Planning artifacts for this mission were generated on feat/serveur-app-festivalier. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/serveur-app-festivalier unless the human explicitly redirects the landing branch.
subtasks: [T018, T019, T020, T021, T022]
phase: Phase 2 - API
agent: claude
history:
- timestamp: '2026-11-20T10:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/kyc/
create_intent:
- apps/api/src/kyc/kyc.module.ts
- apps/api/src/kyc/kyc.controller.ts
- apps/api/src/kyc/kyc.service.ts
- apps/api/test/integration/kyc/create.spec.ts
- apps/api/test/integration/kyc/limits.spec.ts
execution_mode: code_change
model: sonnet
owned_files:
- apps/api/src/kyc/kyc.module.ts
- apps/api/src/kyc/kyc.controller.ts
- apps/api/src/kyc/kyc.service.ts
- apps/api/src/errors/sqlstate-map.ts
- apps/api/test/integration/kyc/create.spec.ts
- apps/api/test/integration/kyc/limits.spec.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP05 : Identification au guichet (API), `createKycVerification`

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche commune
`docs/passation-10a/fiche-implementation.md`, ce prompt, puis seulement :

- les notes de lane de WP01 et WP04 et la migration `0096` **telle que fusionnée** (signatures et
  codes réels) ; `interfaces.md` (lignes `create_kyc_verification`, codes `CL060` à `CL063`,
  `KycModule`) ; `contracts/kyc.md` ; `plan.md` IC-01 ; `spec.md` FR-001 à FR-004, FR-006, SC-001,
  C-005, C-006 ;
- `packages/contracts/openapi.yaml` l. 3195-3245 (`createKycVerification`), l. 16565-16640
  (`KycVerificationCreate`, `KycVerification`) ;
- modèle de contrôleur et de service de back-office :
  `apps/api/src/refunds/refund-backoffice-create.controller.ts` (en entier, 33 lignes) et
  `refund-backoffice-create.service.ts` l. 33-58 (portefeuille, chaîne de portées, rôle exercé) et
  l. 117-136 (audit) ; `refunds/refunds.module.ts` (forme du module) ;
- `apps/api/src/organization/tenant/tenant-access.ts` l. 14-60 (`TenantAccess.actor`, `TenantActor`)
  ; `identity/scope-resolver.ts` l. 37-60 et 108-120 (`resolveChain`, `exercisedRole`) ;
  `idempotency/idempotent.decorator.ts` l. 1-58 (options, `scope: 'bo:'`) ;
  `organization/platform/platform.dto.ts` l. 7-35 (`invalid` 400, `unprocessable` 422, `objectBody`,
  `isUuid`) ; `audit/audit.service.ts` l. 8 et 170 (union `AuditAction`, dernier membre l. 170), l.
  173-215 (union `AuditAction`, `record`) ; `errors/sqlstate-map.ts` l. 88-95 (fin de la table,
  `CL056`, `CL057`) et `test/unit/errors/sqlstate-map.spec.ts` l. 70-95 ;
- tests : `test/integration/refunds/create-backoffice.spec.ts` l. 1-60 (forme d'un test de route de
  guichet), `test/support/media-fixtures.ts` l. 84-122 (personnes `cashierA`, `organizerAdminA`,
  `supervisorA`, `cashierB`, portefeuille anonyme `walletA`), `test/support/cash-fixtures.ts` l.
  64-90 et 150-220 (`createCashWorld`, `setCaps`),
  `test/integration/topups/cash-topup-refusals.spec.ts` l. 117-130 (refus de plafond).

Priorité des sources (SPECIFICATION §0.3). `interfaces.md` fait foi ; contradiction ou manque : tu
la signales dans ta note, tu ne la tranches pas en silence.

## Objective

Servir `POST /kyc-verifications` tel que déclaré au contrat depuis la mission 5b (aucune route,
aucun champ, aucun code d'erreur exposé nouveau) : un agent `CASHIER` ou `ORGANIZER_ADMIN` sur la
portée de l'événement du portefeuille identifie un festivalier ; l'écriture passe **uniquement** par
`create_kyc_verification` (WP01). Le niveau `VERIFIED` du client est ensuite calculé à chaque usage
: la recharge refusée avant l'identification est acceptée après (SC-001).

## Context

- Aucun module `kyc/` n'existe. Tu crées `kyc.module.ts`, `kyc.controller.ts`, `kyc.service.ts`.
  **Une seule ligne d'import** dans `apps/api/src/app.module.ts` (hors carte, signalée), sur le
  modèle de `RefundsModule` (l. 33 et 87). WP06 ajoutera son contrôleur et son action à `KycModule`
  : laisse le module extensible (tableaux `controllers` et `providers`), sans anticiper son contenu.
- **Retouches hors carte nommées, à lister dans la note de lane** (nécessaires, hors de ta carte) :
  `apps/api/src/app.module.ts` (une ligne) ; `apps/api/src/audit/audit.service.ts` (ajoute
  `'KYC_VERIFIED'` **et** `'KYC_REVOKED'` à l'union `AuditAction` (WP06 ne touche pas ce fichier),
  avec un commentaire « mission 10a, WP05 ») ; `apps/api/test/unit/errors/sqlstate-map.spec.ts`
  (quatre lignes de la table attendue : ce test compare les **clés** de `SQLSTATE_MAP` à sa table,
  il échoue sans elles). Rien d'autre.
- **Décisions du porteur (20/11/2026)** : l'agent titulaire est refusé par égalité de numéro (WP01),
  limite consignée C-005 : **l'API ne refait pas ce contrôle** ; elle n'accepte jamais un agent venu
  du corps (l'agent est la personne authentifiée, `actor.principal.userId`).
- **Décision de l'orchestrateur (`interfaces.md`, 20/11)** : le corps est `wallet_id` **ou**
  `customer_id` (`oneOf` du contrat) ; sers les deux, **plus de 422 pour `customer_id`** ;
  `create_kyc_verification(p_wallet, p_customer, ...)` reçoit l'un et `NULL` pour l'autre ; avec
  `customer_id`, la ligne porte `wallet_id` NULL.
- Codes et mappage (`interfaces.md`) : `CL060` → `422 ACCOUNT_REQUIRED` ; `CL061` → `403 FORBIDDEN`
  ; `CL062` → `422 VALIDATION_FAILED` ; `CL063` → `409 CONFLICT_STATE`. Le texte du message SQL
  n'est jamais lu (`sqlstate-map.ts` l. 1-3).
- Rôles : `CASHIER` ou `ORGANIZER_ADMIN`, exercé sur une portée de la **chaîne de l'événement** du
  portefeuille (événement, organisateur, prestataire). Pas de `CounterAuth` : le contrat n'exige que
  `humanBearer`.
- Ne journalise jamais `id_last4`, un numéro de téléphone ni le corps de la requête (NFR-002 étendu,
  OP-N156 pour les numéros). Aucune dépendance nouvelle.

## Subtasks

### T018 : `KycModule`, `KycController`, `KycService.create`

- **Contrôleur** : `@Controller('kyc-verifications')`, `@Post()`, `@Idempotent({ scope: 'bo:' })`
  (`Idempotency-Key` exigée, réponse rejouée ; 201 par défaut de `POST`). Corps du modèle
  `refund-backoffice-create.controller.ts` : `const actor = this.access.actor(req, KYC_DESK_ROLES);`
  puis `return tx.run((client) => this.kyc.create(client, actor, body));` avec `export const
  KYC_DESK_ROLES = ['CASHIER', 'ORGANIZER_ADMIN'] as const;` (type `Role`). `TenantAccess.actor`
  répond `403` si la personne n'a aucun de ces rôles.
- **`KycService.create(client, actor, body)`** → `KycVerification` (`components['schemas']`), dans
  la transaction idempotente et cloisonnée de l'appelant :
  1. valide le corps (`parseKycVerificationCreate`, exportée du service : aucun fichier de DTO dans
     ta carte) : objet, champs inconnus refusés `400`, un seul de `wallet_id` ou `customer_id` (uuid
     ; les deux ou aucun : `400`), `id_type` parmi les cinq valeurs, `id_country` `^[A-Z]{2}$`,
     `id_last4` `^[0-9A-Z]{1,4}$`, `id_expires_on` date calendaire `AAAA-MM-JJ` (`invalid` de
     `platform.dto.ts` : `400`, comme la 9a) ;
  2. avec `customer_id` : le client doit être un `party` `CUSTOMER` du prestataire (RLS) sinon `404`
     ; **décision de l'orchestrateur (20/11/2026, renforcement)** : l'agent doit tenir
     `CASHIER` ou `ORGANIZER_ADMIN` sur la portée d'**au moins un** portefeuille de ce client
     (grand livre `EVENT`, même chaîne qu'au point 3) ; aucun : `403 FORBIDDEN`, rien d'écrit.
     Un caissier d'un événement n'identifie pas un client qui n'y a aucun portefeuille. Passe
     `p_wallet = NULL`, `p_customer = $id`. Test : client avec un portefeuille seulement sur un
     autre événement → `403`. Avec
     `wallet_id` : portefeuille : `SELECT w.ledger_id, l.scope_id AS event_id FROM wallet w JOIN
     ledger l ON l.id = w.ledger_id AND l.scope_type = 'EVENT' WHERE w.id = $1` ; absent (RLS
     comprise, autre prestataire ou anonyme sans grand livre d'événement) : `NOT_FOUND` `404` ;
  3. portée : `resolveChain(client, { type: 'EVENT', id: event_id })` puis
     `exercisedRole(actor.principal, KYC_DESK_ROLES, chain)` ; aucun :
     `ProblemException('FORBIDDEN')` (`403`, rien d'écrit : l'US 1 scénario 5 l'exige). Un `CASHIER`
     d'un autre événement du même prestataire est refusé ;
  4. écriture : `SELECT k.id, k.customer_id, k.wallet_id, k.method, k.agent_id, k.id_type,
     k.id_country, k.id_last4, k.id_expires_on::text AS id_expires_on, k.status, k.verified_at,
     k.revoked_at, k.revoked_by, k.revoked_reason FROM create_kyc_verification($1::uuid, $2::uuid,
     $3, $4, $5, $6::date, $7) k` (`$1` portefeuille ou `NULL`, `$2` client ou `NULL`, puis type,
     pays, `id_last4`, date, agent) avec `p_agent = actor.principal.userId`.
     **`id_expires_on::text`** : le pilote `pg` convertit un `date` en `Date` local (aucun analyseur
     de type n'est posé pour `date`, `db.module.ts` l. 12) ;
  5. audit (T020) ; mappe la ligne en `KycVerification` : `kyc_verification_id = id`, `id_country`
     rogné (`char(2)`), `verified_at` en ISO (`toISOString`), `revoked_*` à `null`.
- Erreurs de la base : laisse l'exception SQL remonter ; le filtre existant la traduit par
  `mapSqlState`. Aucun `catch` qui lit un message.
- `KycModule` : `imports: [TenantModule]` (comme `RefundsModule`), `controllers: [KycController]`,
  `providers: [KycService]`, `AuditService` comme les autres modules (vérifie son fournisseur).

### T019 : mappage `CL060` à `CL063` dans `errors/sqlstate-map.ts`

Après `CL057` : commentaire « Mission 10a (migration 0096) » puis quatre entrées : `CL060: { code:
'ACCOUNT_REQUIRED', status: 422 }`, `CL061: { code: 'FORBIDDEN', status: 403 }`, `CL062: { code:
'VALIDATION_FAILED', status: 422 }`, `CL063: { code: 'CONFLICT_STATE', status: 409 }`. Vérifie que
`ACCOUNT_REQUIRED` est un `ProblemCode` du contrat (il l'est : `activation.service.ts` l. 151).
Ajoute les quatre lignes à `test/unit/errors/sqlstate-map.spec.ts` (hors carte) : `npx jest
test/unit/errors/sqlstate-map.spec.ts --runInBand --forceExit` vert.

### T020 : audit de l'identification (`KYC_VERIFIED`)

`AuditService.record(client, { ...actor.audit, actorRole: <rôle de la chaîne>, operatorId:
actor.operatorId, action: 'KYC_VERIFIED', objectType: 'kyc_verification', objectId: id, after: {
wallet_id, customer_id, id_type, id_country, id_last4, id_expires_on, method: 'DESK' } })`, dans la
même transaction (modèle `refund-backoffice-create.service.ts` l. 117-136). `id_last4` **est admis**
dans l'audit (même donnée que la table, `interfaces.md`) mais **jamais** dans les journaux
applicatifs ; jamais un numéro de téléphone, jamais l'identifiant de l'agent titulaire détecté.
`actorRole` : le rôle **réellement exercé sur la chaîne** (`exercisedRole`), pas le premier rôle
tenu (`actor.role`), si les deux diffèrent. Proposition **non requise**, à signaler : ajouter
`id_last4` à `REDACTED_FIELDS` (`errors/redact.ts`, hors carte) comme renforcement des journaux.

### T021 : intégration `kyc/create.spec.ts`

Modèle : `refunds/create-backoffice.spec.ts`. Monde : `createMediaWorld()` + `createTestApp({
identity: w.idp })` ; festivalier avec client, numéro vérifié et portefeuille : `fundedCustomer(w,
0)` de `refunds/create-fixtures.ts` ; le portefeuille anonyme est `w.ids.walletA`. Cas, avec
**valeurs lues en base** et `contractViolations('KycVerification', res.body)` vide :
- `201` par `cashierA` : ligne `DESK`, `VERIFIED`, `agent_id` = `cashierA.userId`, `id_last4`
  normalisé ; `organizerAdminA` : `201` aussi ; `Idempotency-Key` rejouée : même corps,
  `Idempotency-Replayed`, **une seule** ligne ; même clé avec un autre corps : `409` ;
- `422 ACCOUNT_REQUIRED` : portefeuille anonyme ; client sans `customer_identity` ; rien d'écrit
  (compte des lignes **du prestataire du test** avant et après) ;
- `403` : `operatorAdminA`, `supervisorA` (mauvais rôle) ; `cashierA` d'un **autre événement** (une
  attribution `CASHIER` sur un second événement du prestataire, jamais l'événement du portefeuille)
  ; **agent titulaire** : `UPDATE app_user SET phone = <numéro du client>` par le propriétaire, puis
  `403`, rien d'écrit ; non authentifié : `401` ;
- `422 VALIDATION_FAILED` : pièce expirée hier (SQL `CL062`) ; `400` : `id_last4` de cinq caractères
  ou en minuscules, pays `sn`, type inconnu, champ inconnu (`agent_id` dans le corps : refusé),
  `wallet_id` et `customer_id` ensemble, ou aucun (`400`) ;
- `201` avec `customer_id` seul (ligne `wallet_id` NULL, contrat conforme) ; `422 ACCOUNT_REQUIRED`
  si le client n'a pas de numéro vérifié ; agent titulaire : `403` ;
- `404` : portefeuille ou client inconnu ; portefeuille du prestataire A appelé par `cashierB`
  (isolation) ;
- **limite C-005** : agent **sans** numéro (cas par défaut des fixtures : `email` seul) : `201` ;
- audit : une ligne `KYC_VERIFIED` d'acteur `cashierA`, rôle `CASHIER` ; `id_last4` présent, mais le
  texte de la ligne ne contient **pas** le numéro du client, et la sortie de journal de
  l'application (espionne `Logger`) ne contient **ni** `Z9Q7` (valeur rare choisie) **ni** le numéro
  ; corps de réponse conforme au contrat.

### T022 : intégration `kyc/limits.spec.ts` (SC-001)

Monde : `createCashWorld()` (terminal, session de caisse, `setCaps`). Étapes : bracelet activé au
guichet (`c.activate(m)`), client avec `customer_identity` rattaché au portefeuille **par le
propriétaire** (`UPDATE wallet SET customer_id`) ; `restore = await c.setCaps({ maxBalance: 1000,
monthly: null })` ; recharge de 5 000 : `422 WALLET_LIMIT_EXCEEDED` (rien d'écrit : compteurs
`c.counts()` inchangés) ; identification par `c.w.cashierA` : `201` ; **même** recharge (nouveau
`tapBody`) : `201` ; `restore()` en `finally`. Les plafonds des identifiés sont ceux de la
législation de l'événement : pas de valeur codée en dur dans ton test (`setCaps` ne règle que les
plafonds des non-identifiés). L'expiration d'une pièce est prouvée en SQL (WP01), pas ici.

## Tests et preuves

Base `cashless_wp05`, serveur 5433, depuis `apps/api` de la lane, **dans le même appel Bash** :

```bash
export PGHOST=127.0.0.1 PGPORT=5433 PGUSER=postgres PGDATABASE=cashless_wp05
R=/Users/xaamga/Documents/omar_sylla_work/cashless/cashless-platform
export PATH=$R/docs/passation-9a/scripts/bin:/Library/PostgreSQL/18/bin:$PATH
bash ../../packages/ledger-sql/scripts/reset-db.sh
export PGDATABASE=cashless_wp05; source ../../tools/dev-db/env.sh; env | grep DATABASE_URL
SKIP_LATENCY=1 npx jest test/integration/kyc test/unit/errors/sqlstate-map.spec.ts \
  --runInBand --forceExit
npx eslint src/kyc src/errors/sqlstate-map.ts src/audit/audit.service.ts test/integration/kyc
npx tsc --noEmit -p tsconfig.json
cd ../.. && node tools/contract-stability/check.mjs
```

Toutes les `DATABASE_URL_*` doivent viser `cashless_wp05`. Après un Jest, refais `reset-db.sh`. La
CI lance `npm run lint` et `npm run typecheck` (piège de la PR #20) : lance-les aussi.

## Branch Strategy

- Planification et fusion : `feat/serveur-app-festivalier`. Worktree de lane calculé par
  `lanes.json`.
- Commande : `LC_ALL=C LANG=C spec-kitty agent action implement WP05 --agent claude --mission
  serveur-app-festivalier-01M7WB69`.

## Definition of Done

- [ ] Route servie telle que déclarée ; `node tools/contract-stability/check.mjs` à 0 refus ; aucune
      route, aucun champ, aucun code exposé de plus ; l'agent vient toujours de l'authentification.
- [ ] Mappage `CL060` à `CL063` et son test unitaire verts ; audit sans numéro, `id_last4` absent
      des journaux.
- [ ] `create.spec.ts` et `limits.spec.ts` verts sur `cashless_wp05`, avec contrôles positifs.
- [ ] **Mutations vérifiées**, rejouées puis rétablies, résultat noté : (a) retirer le contrôle de
      portée (`exercisedRole`) : le test du `cashierA` d'un autre événement échoue ; (b) retirer
      `CL061` du mappage : le test de l'agent titulaire reçoit `500` et échoue ; (c) journaliser
      `id_last4` : le test de non-fuite échoue ; (d) lire l'agent dans le corps : le test «
      `agent_id` refusé » échoue ; (e) retirer `Idempotent` : le test de rejeu échoue.
- [ ] Note de lane : retouches hors carte, portée du chemin `customer_id`, rôle d'audit retenu,
      mutations.

## Risks

- `date` lu par `pg` en `Date` locale : le décalage de fuseau fausse `id_expires_on` ; `::text`
  partout.
- Rôle sur la mauvaise portée (organisateur d'un autre événement) : le test d'isolation de portée.
- Une exception SQL dont le message contiendrait un numéro : la base (WP01) n'en met jamais ;
  vérifie.

## Ce que le relecteur doit casser

- Identifier un portefeuille anonyme, un portefeuille d'un autre prestataire, d'un autre événement ;
  avec le rôle `OPERATOR_ADMIN`, `SUPERVISOR`, sans rôle, sans jeton ; un agent titulaire ; limite
  C-005.
- Corps hostile : champs inconnus (`agent_id`, `operator_id`, `status`), `id_last4` de cinq
  caractères, pièce expirée la veille ou aujourd'hui, `customer_id` et `wallet_id` ensemble, rejeu
  de la clé avec un autre corps.
- Fuite : `id_last4` dans un journal, numéro de téléphone, identifiant de l'agent titulaire dans
  `audit_log`, la réponse d'erreur ou un journal. Une écriture directe dans `kyc_verification`
  depuis le service.
- Un test qui ne prouve rien : `201` sans lire la ligne, recharge « acceptée » sans l'avoir vue
  refusée avant, mutation notée mais jamais rejouée.

## Fichiers à faire relire par une personne

- `apps/api/src/kyc/kyc.service.ts` (contrôle de portée, absence de fuite dans l'audit, agent issu
  de l'authentification). Pas de cryptographie.
