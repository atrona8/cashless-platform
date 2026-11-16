---
work_package_id: WP03
title: Codes du titulaire et destination
dependencies: [WP01]
requirement_refs:
- FR-011
- FR-012
- FR-013
- NFR-005
planning_base_branch: feat/remboursements
merge_target_branch: feat/remboursements
branch_strategy: Planning artifacts for this mission were generated on feat/remboursements. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/remboursements unless the human explicitly redirects the landing branch.
base_branch: kitty/mission-remboursements-01M7AG5V
base_commit: 49c129f8fc50cdd387fdc75cb8eafadbba05a4ce
created_at: '2026-11-16T09:45:56.036965+00:00'
subtasks: [T012, T013, T014, T015, T016, T017]
phase: Phase 2 - Parcours festivalier
agent: claude
history:
- timestamp: '2026-11-13T15:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/refunds/
create_intent: [apps/api/src/refunds/destination.ts, apps/api/src/refunds/holder-challenge.service.ts, apps/api/src/refunds/holder-decision.controller.ts, apps/api/src/refunds/refunds-holder.module.ts, apps/api/src/processes/maintenance-refund-promotion.ts, apps/api/test/integration/refunds/holder-challenge.spec.ts, apps/api/test/integration/refunds/holder-decision.spec.ts, apps/api/test/integration/refunds/holder-promotion.spec.ts, apps/api/test/integration/customer-auth/verify-challenge.spec.ts]
execution_mode: code_change
model: sonnet
owned_files: [apps/api/src/customer-auth/customer-auth.service.ts, apps/api/src/refunds/destination.ts, apps/api/src/refunds/holder-challenge.service.ts, apps/api/src/refunds/holder-decision.controller.ts, apps/api/src/processes/maintenance*, apps/api/test/integration/refunds/holder*.spec.ts, apps/api/test/integration/customer-auth/verify-challenge.spec.ts, apps/api/src/customer-auth/customer-auth.module.ts, apps/api/src/refunds/refunds-holder.module.ts]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP03 : Codes du titulaire et destination

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer / Agent :
claude). Lis ensuite la fiche commune `docs/passation-9a/fiche-implementation.md`, ce prompt, puis seulement :

- `contracts/interfaces.md` : « API » (`verifyChallenge`, `issueChallenge`), « Noms figés » (`resolveDestination`,
  `startHolderChallenge`), « Retouches hors carte », ligne WP03 ; `data-model.md` « `otp_challenge` », « États » ;
- `research.md` R-05, R-06 ; `contracts/served-operations.md` ligne `decideRefundRequestAsHolder` ; `spec.md` FR-011 à
  FR-013 (l. 177-179), NFR-005 (l. 196) ; `packages/contracts/openapi.yaml` l. 6214-6252 (route), 16230-16263
  (`RefundRequestCreate`), 16264-16334 (`RefundRequest`) ;
- `apps/api/src/customer-auth/customer-auth.service.ts` : l. 43-47 (erreurs), 78-140 (`requestOtp`, invalidation l.
  117-122), 143-176 (`waitBeforeRequest`), 180-271 (`exchange`, `exchangeIn`) ; `otp-sender.ts` ;
  `customer-auth.module.ts` ; `customer-auth.controller.ts` (`@Public()`) ;
- `apps/api/src/db/tenant-tx.ts` l. 31-47 (`run` annule sur exception), 74-90 (`withoutTenant`) ;
- maintenance : `processes/maintenance.module.ts`, `edge/maintenance/edge-silence.worker.ts` (modèle de travailleur),
  `processes/worker.ts` l. 5-33, `test/integration/maintenance/purge.spec.ts` l. 1-50 ;
- `audit/audit.service.ts` l. 130-141 (fin de l'union `AuditAction`) et l. 171 (`record`) ;
- tests : `test/integration/customer-auth/attempts.spec.ts` l. 1-60, `test/support/{customer-auth,fake-customer,
  media-fixtures,contract-schema}.ts`.

Priorité des sources (SPECIFICATION §0.3). Contradiction : tu la signales. `interfaces.md` fait foi sur les signatures.

## Objective

Rendre les codes à usage unique réutilisables sans émettre de jetons et sans mélanger leurs usages : `verifyChallenge`
(extrait d'`exchangeIn`) et `issueChallenge`, avec « un seul code vivant par (numéro, usage) » ; résoudre la destination
d'une demande (`resolveDestination`) ; envoyer au titulaire un code lié à la demande (`startHolderChallenge`) ; servir
`decideRefundRequestAsHolder` (route publique) ; promouvoir chaque minute les demandes dont l'attente est échue. La
connexion des festivaliers ne change pas d'un octet observable. Aucune route, aucun champ, aucun code d'erreur ajouté.

## Branch Strategy

- Branche de planification et de fusion : `feat/remboursements`.
- Worktree alloué par lane, calculé dans `lanes.json` (WP01 d'abord : migration `0081`, colonnes `purpose`,
  `subject_id`).
- Commande : `LC_ALL=C LANG=C spec-kitty agent action implement WP03 --agent claude --mission remboursements-01M7AG5V`.

## Périmètre et arbitrages

- Fichiers désormais possédés : `customer-auth.module.ts` et `refunds-holder.module.ts`. Retouches hors carte, une ligne
  chacune au compte rendu : (a) `customer-auth/customer-auth.module.ts` : `exports: [CustomerAuthService]` (aujourd'hui
  absent ; WP03 et WP04 en ont besoin) ; (b) `refunds/refunds-holder.module.ts` (`RefundsHolderModule`, `interfaces.md`)
  ; (c) `AuditAction` : une valeur `'REFUND_HOLDER_DECIDED'` en fin d'union ; (d) `suivi-lots.md` : noms et signatures
  qui servent à WP04.
- Erreurs : seulement `OTP_INVALID` (422), `OTP_RATE_LIMITED` (429), `CONFLICT_STATE` (409), `REFUND_NOT_ALLOWED`, déjà
  au catalogue. `app.module.ts` et `refunds.module.ts` sont à WP04 : tes tests montent `RefundsHolderModule` par
  `createTestApp({ imports: [...] })` ; ne touche pas à ces deux fichiers.
- Le contrat ne déclare pas l'en-tête `X-Test-Otp-Code` sur `createMyRefundRequest` (il n'apparaît dans aucun endroit de
  `openapi.yaml`) : les tests lisent le code par un `OtpSender` d'enregistrement posé en `overrides` sur `OTP_SENDER`,
  jamais par un en-tête. Aucun code dans les journaux ni dans une réponse (seul le faux renvoie le code à l'appelant
  interne).

## T012 : `verifyChallenge` et `issueChallenge` extraits du service

But : le cœur de `exchangeIn` (verrou par numéro, comparaison en temps constant, essais cumulés, blocage 30 min,
consommation) devient une méthode privée commune ; `exchange` et `verifyChallenge` l'appellent.

- `verifyChallenge(input: { otpRequestId; code; expectedPhone; purpose; subjectId? })` de `interfaces.md`, plus un champ
  optionnel `operatorId?` (renforcement, à signaler dans `suivi-lots.md` : sans lui, un défi d'un autre prestataire pour
  le même numéro passerait ; `resolveDestination` le passe). Format `otp_<uuid>` comme `REQUEST_ID` (l. 41) ;
  prestataire par `otp_challenge_operator` (`withoutTenant`) ; transaction propre par `this.tx.run` : l'essai faux
  compté et le blocage survivent à l'erreur levée APRÈS la transaction (c'est la règle du fichier, l. 1-6, `run` annule
  sur exception). Ne l'appelle jamais en comptant sur la transaction de l'appelant. Rend `void`, lève `otpInvalid()`
  (422) ou `rateLimited()` (429, `Retry-After`).
- Liaison, vérifiée AVANT la comparaison du code et sans compter d'essai : `purpose` du défi = `purpose` demandé ;
  `subject_id` = `subjectId` (nul pour `LOGIN`) ; `phone` du défi = `expectedPhone` ; prestataire = `operatorId` si
  fourni. Écart : `INVALID`, sans consommer ni compter. L'ordre existant reste : verrou du numéro, ligne `FOR UPDATE`,
  blocage, défi utilisable, comparaison, essais, consommation.
- `exchangeIn` : mêmes requêtes, mêmes réponses, même ordre ; il impose `purpose = 'LOGIN'` (sans cela, un code de
  titulaire ouvrirait une session du festivalier : c'est le point critique de ce lot) puis garde `customerFor` et
  `issue`. Ses tests existants (`otp.spec.ts`, `attempts.spec.ts`, `tokens.spec.ts`) passent SANS modification.
- `issueChallenge(input: { operatorId; phone; purpose: 'REFUND_HOLDER'; subjectId })` rend `{ otpRequestId, expiresIn,
  code }` (`code` pour les tests via le faux seulement). Refactore la création de `requestOtp` (l. 108-139) en méthode
  privée commune : verrou du numéro, attente (blocage, 3 par 15 min), invalidation des codes vivants, insertion, envoi
  APRÈS validation de la transaction (`sender.send`, canal `AUTO`). Différences voulues pour `REFUND_HOLDER` : `purpose`
  et `subject_id` à l'insertion ; `client_ref` = HMAC de `refund-holder:<subjectId>` (jamais l'adresse d'un appelant) et
  PAS de limite horaire par adresse (elle fusionnerait tous les titulaires) ; la limite par numéro et le blocage restent
  communs avec la connexion (R-05, point 4).
- « Un seul code vivant par (numéro, usage) » : l'`UPDATE … SET invalidated_at` de `requestOtp` (l. 117-122) gagne `AND
  purpose = $3` ; pour `REFUND_HOLDER` la règle est par (numéro, usage, sujet) : `AND subject_id = $4`, de sorte que
  deux demandes du même titulaire ne s'invalident pas. Un code de titulaire n'invalide donc pas une connexion en cours,
  et inversement ; deux défis `REFUND_HOLDER` du même sujet : le plus récent seul reste vivant.

## T013 : `refunds/destination.ts`

`resolveDestination(client, { operatorId, walletId, customerId, destination }, verify)` aux types figés
d'`interfaces.md` (`ResolvedDestination`) ; type du contrat via
`components['schemas']['RefundRequestCreate']['destination']` (import comme `approval/action-registry.ts:5`). `verify`
est `CustomerAuthService['verifyChallenge']` (injecté, testable).

- `BANK_TRANSFER` : `REFUND_NOT_ALLOWED` (OP-N123), avant toute lecture. Canal mobile sans `msisdn` : le numéro vérifié,
  sinon `REFUND_NOT_ALLOWED`.
- `holderPhone` : `customer_identity.phone` du festivalier (lu par `client`, sous RLS) ou `null`.
- `msisdn` égal à `holderPhone` : `newNumber = false`, aucune vérification (un `new_number_otp` joint est ignoré, non
  consommé).
- Autre numéro (ou aucun numéro vérifié) : `newNumber = true` ; `new_number_otp` absent : `REFUND_NOT_ALLOWED` ; présent
  : `await verify({ otpRequestId, code, expectedPhone: msisdn, purpose: 'LOGIN', operatorId })`. Un code obtenu pour un
  autre numéro, un code de titulaire (`REFUND_HOLDER`) ou un code déjà consommé est refusé (`422 OTP_INVALID`) ; blocage
  : `429 OTP_RATE_LIMITED`. Le code est consommé par `verify` (transaction propre) : note pour WP04 dans `suivi-lots.md`
  : appelle `resolveDestination` après les refus peu coûteux (fenêtre, éligibilité), avant l'insertion.

## T014 : `refunds/holder-challenge.service.ts` : `startHolderChallenge`

`startHolderChallenge(client, refundRequestId, holderPhone): Promise<void>`. Lit `operator_id` de la demande par
`client` (la demande vient d'être insérée dans la transaction de WP04 : même transaction, RLS), puis
`auth.issueChallenge({ operatorId, phone: holderPhone, purpose: 'REFUND_HOLDER', subjectId: refundRequestId })`. Le défi
se valide dans sa transaction propre ; un `429` lève et fait annuler la création de la demande (comportement voulu,
contrat de `createMyRefundRequest`). Le même service porte la logique de décision de T015 (méthode `decide`), pour que
le contrôleur reste mince.

## T015 : `refunds/holder-decision.controller.ts` : `decideRefundRequestAsHolder`

`POST /refund-requests/:refund_request_id/holder-decision`, `@Public()`, `@HttpCode(200)`, contrat `security: []`. Corps
: `decision` (`CONFIRM`|`BLOCK`), `otp_request_id`, `code` (`^[0-9]{6}$`) ; analyse locale comme `parseOtpExchange`
(champ inconnu ou format : `400 VALIDATION_FAILED`). Ordre, qui fixe ce que la route peut révéler :

1. identifiant de demande non conforme à un `uuid`, ou `refund_request_operator(id)` nul : `422 OTP_INVALID`, MÊME
   réponse qu'un code faux (corps et en-têtes identiques, hors identifiants de requête) ;
2. lecture de la demande (`tx.run(operatorId)`) et du numéro vérifié du titulaire (`customer_identity` du `customer_id`
   de la demande) ; absent : même `422 OTP_INVALID` ;
3. `verifyChallenge({ otpRequestId, code, expectedPhone: holderPhone, purpose: 'REFUND_HOLDER', subjectId: id,
   operatorId })` : faux, expiré, consommé, d'un autre usage ou d'une autre demande : `422 OTP_INVALID` ; trop d'essais
   : `429 OTP_RATE_LIMITED` ;
4. SEULEMENT ensuite l'état : un `UPDATE refund_request SET status = …, holder_decision = $2, holder_decided_at =
   clock_timestamp(), updated_at = clock_timestamp() WHERE id = $1 AND status = 'AWAITING_HOLDER' AND hold_until >
   clock_timestamp() RETURNING …` (`CONFIRM` → `REQUESTED`, `BLOCK` → `BLOCKED`), horloge de la base ; aucune ligne :
   `409 CONFLICT_STATE`. Aucun `409` avant la vérification du code : il révélerait l'état d'une demande sans code ;
5. une ligne d'audit `REFUND_HOLDER_DECIDED` (acteur nul, rôle `HOLDER`, décision en `after`) dans la même transaction :
   pour `BLOCK` c'est l'alerte du contrat pour le back-office (aucune autre infrastructure d'alerte n'existe ;
   signale-le) ;
6. réponse `200` : `RefundRequest` du contrat, construit par une fonction locale (montants par `Number(...)`, comme
   `me.service.ts:122`), contrôlé par `contractViolations('RefundRequest', body)`.

Le code étant consommé à l'étape 3, un rejeu donne `422`. Deux décisions simultanées avec le même code : une seule
passe.

## T016 : promotion des échues par le processus `maintenance`

- Nouveau `processes/maintenance-refund-promotion.ts` : `RefundPromotionWorker` (nom `refund-promotion`, constante
  `REFUND_PROMOTION_INTERVAL_MS = 60_000`), modèle `edge-silence.worker.ts` : `runOnce(now = Date.now())` ne fait rien
  avant l'échéance, puis `tx.withoutTenant` → `SELECT promote_due_refund_requests() AS n`, rend `n` ; `describe()` ;
  module `RefundPromotionMaintenanceModule` importé par `processes/maintenance.module.ts` (une ligne d'import).
- Il n'importe que `TenantTx` et `WorkerRegistry` : `test/unit/architecture.spec.ts` (processus `maintenance`, l.
  233-243) reste vert.

## T017 : tests

`createTestApp({ imports: [RefundsHolderModule], overrides: [{ provide: OTP_SENDER, useValue: recorder }] })`. Les
demandes sont INSÉRÉES EN BASE par le propriétaire (le parcours de création arrive avec WP04) : `createMediaWorld`,
`createTestCustomer`, une ligne `customer_identity`, `createCustomerWallet`, puis `INSERT INTO refund_request` conforme
aux CHECK de WP01.

- `verify-challenge.spec.ts` : bon code consommé, aucun jeton, aucun compte créé (`customer_identity` et `party`
  inchangés) ; rejeu, mauvais code (essai compté, persistant malgré l'erreur), 5e essai : 429 et blocage ;
  `expectedPhone`, `purpose`, `subjectId`, `operatorId` qui ne correspondent pas : 422 sans essai compté ; code `LOGIN`
  présenté comme `REFUND_HOLDER` et l'inverse (par `/customer-auth/token` : `422`, session jamais ouverte) ; un seul
  code vivant par (numéro, usage) et par sujet pour `REFUND_HOLDER`, dans les deux sens ; quota par numéro commun (3 par
  15 min, tous usages) ; connexion : suites existantes vertes.
- `holder-challenge.spec.ts` : matrice de `resolveDestination` (virement, autre numéro sans code, code d'un autre
  numéro, code d'un autre prestataire, code consommé deux fois, numéro vérifié sans code, aucun numéro vérifié) ;
  `startHolderChallenge` envoie un code au numéro du titulaire, défi `REFUND_HOLDER` lié à la demande.
- `holder-decision.spec.ts` : `CONFIRM`, `BLOCK` (audit), code faux et demande inconnue : corps identiques, défi de
  connexion du même numéro, défi d'une AUTRE demande, autre prestataire, après `hold_until` et hors `AWAITING_HOLDER` :
  `409`, rejeu : `422`, 5 essais : `429`, corps invalide : `400`, route sans jeton, réponse conforme au contrat.
- `holder-promotion.spec.ts` : échue promue sous `cashless_maint` (`MAINT_URL`), non échue et `holder_decision` intacts,
  deux prestataires dans un passage, second passage = 0, cadence d'une minute.

## Tests et preuves

Depuis la lane (`cd <lane> || exit 1`), base `cashless_wp03` (WP01 fusionné ou appliqué dans ta lane) :

```bash
export PGHOST=127.0.0.1 PGPORT=5433 PGUSER=postgres PGDATABASE=cashless_wp03
bash packages/ledger-sql/scripts/reset-db.sh
cd apps/api && source ../../tools/dev-db/env.sh
env | grep DATABASE_URL        # toutes les URL visent cashless_wp03
SKIP_LATENCY=1 npx jest test/integration/customer-auth test/integration/refunds/holder \
  test/integration/maintenance test/unit/architecture.spec.ts --runInBand --forceExit
npx tsc --noEmit -p tsconfig.json && npx prettier --check src/refunds src/customer-auth src/processes
```

Après le Jest, refais `reset-db`. Preuves : FR-011 à FR-013, NFR-005, connexion inchangée, défis isolés.

## Definition of Done

- [ ] `verifyChallenge` / `issueChallenge` extraits ; `exchangeIn` impose `LOGIN` ; un code vivant par (numéro, usage).
- [ ] `resolveDestination`, `startHolderChallenge`, route publique, travailleur de promotion, `RefundsHolderModule`.
- [ ] Ordre de la route respecté : aucune réponse `409` ni détail d'état avant un code valide.
- [ ] Quatre fichiers de tests verts ; suites `customer-auth` et `architecture` vertes ; `tsc` et Prettier propres.
- [ ] Preuves (critère → commande → résultat) notées à la fin de `docs/passation-9a/suivi-lots.md`.
- [ ] Compte rendu : retouches hors carte (a à d), renforcements (liaison d'usage, `LOGIN` imposé à la connexion, quota
      sans limite par adresse), limites (port d'envoi, alerte = audit).

## Ce que le relecteur doit casser

- Défi de connexion accepté comme défi de titulaire (même numéro) ; défi de titulaire accepté par `/customer-auth/token`
  ; défi d'une autre demande du même numéro ; défi d'un autre prestataire ; code du nouveau numéro réemployé après
  création.
- Code de titulaire qui invalide une connexion en cours (ou l'inverse) ; deux codes vivants du même usage ; essai faux
  non compté parce que la vérification a tourné dans la transaction de l'appelant (annulée à l'erreur).
- Réponse publique qui révèle une demande : `409` obtenu sans code valide, `422` différent entre demande inconnue et
  code faux (corps, en-têtes, forme de l'erreur), identifiant non-uuid qui répond autrement ; code ou numéro dans un
  journal.
- `BLOCK`/`CONFIRM` après `hold_until`, hors `AWAITING_HOLDER`, deux décisions concurrentes avec un même code, rejeu
  avec le même code ; décision qui écrit autre chose que `status`, `holder_decision`, `holder_decided_at`, `updated_at`.
- Connexion changée : message, ordre des essais, blocage, création de compte, jetons, temps constant (`timingSafeEqual`
  conservé), `Retry-After`.
- `customer-auth.module.ts` qui exporte plus que `CustomerAuthService` ; travailleur de maintenance qui lit une table ou
  atteint `DbModule` ; promotion d'une demande non échue ou hors `AWAITING_HOLDER`.

## Fichiers à faire relire par une personne

- `apps/api/src/customer-auth/customer-auth.service.ts` : `verifyChallenge`, `issueChallenge`, `exchangeIn`
  (cryptographie des codes, temps constant, essais et blocage, liaison d'usage).
- `apps/api/src/refunds/holder-decision.controller.ts` et `holder-challenge.service.ts` (route publique, ordre des
  contrôles, uniformité des réponses).
