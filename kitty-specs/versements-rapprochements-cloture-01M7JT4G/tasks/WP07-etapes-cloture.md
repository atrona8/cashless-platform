---
work_package_id: WP07
title: Étapes de clôture et conditions de passage (API)
dependencies: [WP01, WP06]
requirement_refs: [FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-024, NFR-001, NFR-004]
planning_base_branch: feat/versements-rapprochements-cloture
merge_target_branch: feat/versements-rapprochements-cloture
branch_strategy: Planning artifacts for this mission were generated on feat/versements-rapprochements-cloture. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/versements-rapprochements-cloture unless the human explicitly redirects the landing branch.
subtasks: [T028, T029, T030, T031, T032, T033, T034]
phase: Phase 3 - Services et routes
agent: claude
history:
- timestamp: '2026-11-17T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/closing/
create_intent: [apps/api/src/closing/closing.module.ts, apps/api/src/closing/closing.controller.ts, apps/api/src/closing/closing-steps.service.ts, apps/api/src/closing/closing-steps.dto.ts, apps/api/src/closing/remaining-balances.service.ts, apps/api/src/closing/calculators/calculator.ts, apps/api/src/closing/calculators/pitch-fees.ts, apps/api/src/closing/calculators/operator-fee.ts, apps/api/src/closing/calculators/platform-fee.ts, apps/api/src/closing/calculators/operator-fee-regularization.ts, apps/api/src/closing/calculators/breakage.ts, apps/api/src/closing/calculators/deposit-forfeit.ts, apps/api/src/closing/calculators/promo-expiry.ts, apps/api/test/unit/closing/calculators.spec.ts, apps/api/test/integration/closing/closing-steps.spec.ts, apps/api/test/integration/closing/closing-order.spec.ts, apps/api/test/integration/closing/closing-replay.spec.ts, apps/api/test/integration/closing/closing-concurrency.spec.ts, apps/api/test/integration/closing/remaining-balances.spec.ts, apps/api/test/integration/closing/status-conditions.spec.ts]
execution_mode: code_change
model: sonnet
owned_files: [apps/api/src/closing/**, apps/api/src/events/status/status.service.ts, apps/api/src/events/status/status-messages.ts, apps/api/src/ledger/types.ts, apps/api/src/app.module.ts, apps/api/test/integration/closing/**, apps/api/test/unit/closing/**]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP07 : Étapes de clôture et conditions de passage (API)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis `docs/passation-9b/fiche-implementation.md` (démarrage, base
`cashless_wp07`, Jest, fin de lot), ce prompt, puis seulement :

- `docs/passation-9b/contexte-9b.md` : décisions 3 à 5 ;
- `contracts/interfaces.md` : `ClosingStepService`, `ClosingCalculator`, ordre des verrous, textes
  de condition ;
- `contracts/contract-additions.md` : routes 1 à 4, schémas `ClosingStep*`, `RemainingBalances`, §3
  (enum) ;
- `research.md` R-01 à R-05, contradictions 4 et 5 ; `data-model.md` : `closing_step`,
  `record_closing_step`, `set_event_status` et `event_transition_conditions` ;
- `packages/contracts/openapi.yaml` de ta base (écrit par WP01) : routes 1 à 4 et leurs schémas ;
  existant : `getEventStatusConditions` l. 8907, `transitionEventStatus` l. 8947, `StatusCondition`
  l. 17307 ;
- code : `events/status/status.service.ts` l. 28-41 (`EXTERNAL`), l. 55-90 (`conditions`), l.
  114-143 (`assertMet`) ; `status-messages.ts` l. 100-136 ; `status.controller.ts` l. 28-95 (rôles,
  `canReadEvent`, `settingRolesOn`) ; `ledger/ledger-engine.service.ts` l. 104-170 (`execute`,
  `writeLines`, `CL002`) et l. 520-614 (`enrich`) ; `ledger/builders/closing/fees.ts` l. 22-135 et
  `backoffice.ts` l. 78-110 (payloads) ; `ledger/builders/registry.ts` l. 70-100 ;
  `ledger/status-matrix.ts` l. 100-165 ; `ledger/types.ts` l. 73 (`BreakageDestination`) ;
  `chargebacks/chargebacks.controller.ts` (modèle de contrôleur à écriture) ;
  `packages/ledger-sql/scenario_reference.json` (`expected.after_closing`, clés
  `closing:EVT-2026:*`).

Priorité des sources (SPECIFICATION §0.3). Contradiction : tu la signales. `interfaces.md` fait foi
sur ce prompt.

## Objective

Servir les routes 1 à 4 : état des sept étapes, aperçu sans écriture, exécution une seule fois,
relevé des soldes restants. Rendre vraies les conditions de passage (`PSP_RECONCILED` calculée,
trois codes nouveaux avec leurs textes). Les écritures passent toutes par `LedgerEngineService` et
`record_closing_step` (WP02). Aucun constructeur de `ledger/builders/closing/` n'a d'appelant
aujourd'hui : ce lot les branche.

## Branch Strategy

- Branche de planification et de fusion : `feat/versements-rapprochements-cloture`.
- Worktree alloué par lane, calculé dans `lanes.json`.
- Commande :

  ```bash
  LC_ALL=C LANG=C spec-kitty agent action implement WP07 --agent claude \
    --mission versements-rapprochements-cloture-01M7JT4G
  ```

## Périmètre et arbitrages

- Hors lot : migrations et droits (WP02 à WP06), routes de versement, d'import et de relevé,
  scellement.
- Contrat : exactement `contract-additions.md`. Aucune dépendance npm nouvelle. Écarts qui
  affaiblissent la sécurité : règle 1 de `CLAUDE.md` (arrêt sur ce point, continuer le reste).
- `app.module.ts` est à toi : tu y ajoutes `ClosingModule`. WP08, WP09 et WP10 y feront une ligne
  d'import chacun (union à la consolidation) : ne réorganise rien.
- Source des écritures : `BATCH`, `createdBy` = l'auteur, sans valideur, comme le scénario de
  référence (tx 30 à 32, 43 à 45). Aucune règle de §12.1 n'exige deux personnes pour une étape.
  Dis-le au compte rendu.
- Retouches hors carte permises, une ligne chacune au compte rendu : `AuditAction` (ajouts en fin
  d'union dans `audit/audit.service.ts`) ; `apps/api/test/integration/events/status.spec.ts`
  (attentes l. 192-212 sur `PSP_RECONCILED` externe et l. 431-443 sur `CLOSED`, que tes conditions
  changent) : retouche minimale.
- Contradiction 4 de `research.md` : `breakage_destination = OPERATOR` est valide en base
  (SPECIFICATION l. 254 : « `ORGANIZER` ou `OPERATOR` : partage selon le contrat ») mais absent du
  type TS (`ledger/types.ts:73`). Étends le type (fichier à toi) et traite `OPERATOR` comme
  `ORGANIZER` (partage par `breakage_organizer_bps`). Signale-le au compte rendu : `research.md`
  envisageait un partage 100 % prestataire, rien n'est tranché.
- Grand livre à portée `ORGANIZER` (plusieurs événements) : le calcul par événement n'y est pas
  défini. Refuse l'aperçu et l'exécution des étapes 5 à 7 avec `422 VALIDATION_FAILED` et dis-le au
  compte rendu.

## Subtasks

### T028 : module, routes, service, verrou

- `closing.controller.ts`, chemin `operators/:operator_id/events/:event_id`. Route 1 `GET
  closing-steps` (rôles ORGANIZER_ADMIN, OPERATOR_ADMIN, SUPERVISOR) ; route 2 `GET
  closing-steps/:step/preview` ; route 3 `POST closing-steps/:step` (`@HttpCode(200)`,
  `@Idempotent({ scope: 'bo:' })`) ; route 4 `GET remaining-balances` (`format=csv`). Modèle :
  `status.controller.ts` (`TenantAccess.actor`, `canReadEvent`, `settingRolesOn`). `step` hors des
  sept valeurs : `400`. Événement d'un autre prestataire ou hors portée : `404`/`403` comme le
  statut.
- `closing-steps.service.ts` : `list`, `preview`, `execute(eventId, step, actor, key)`
  (interfaces.md).
- Lis `ClosingStepState` : sept lignes dans l'ordre de R-02, avec `status` (`TODO`, `DONE`,
  `NOT_APPLICABLE` selon les valeurs de `openapi.yaml`), auteur, date, transactions, `phase`
  (`SETTLING` ou `REFUND_WINDOW`).
- `ClosingCalculator` (un fichier par étape) : `compute(client, ctx)` rend `{ applicable, lines[],
  total, commands[] }`. Aucune écriture dans `compute` ; l'aperçu et l'exécution l'appellent tous
  deux.

### T029 : calculateurs `PITCH_FEES`, `OPERATOR_FEE`, `PLATFORM_FEE` (R-03)

- `PITCH_FEES` : `merchant_participation.pitch_fee` et `pitch_fee_mode` ; commande `PITCH_FEE` du
  moteur (`enrich` lit le solde pour `DEDUCT_CAPPED`). `PREPAID` : ligne d'aperçu avec
  `pitch_fee_reference`, sans écriture. Un commerçant dont le solde devient négatif
  (`DEDUCT_OR_DEBT`) : `MERCHANT_DEBT_TRANSFER` (clé
  `closing:<event>:PITCH_FEES:debt:<participation>`) dans la même étape. Tout `PREPAID` : étape
  `NOT_APPLICABLE`.
- `OPERATOR_FEE` : calcule les assiettes (`OperatorFeePayload.bases`, `fees.ts:89-95`) :
  `TOPUP_AMOUNT` = recharges payées de l'événement (`TOPUP`, `TOPUP_CASH`, `PSP_WEBHOOK` crédités, à
  lire dans `posting`) ; `PER_MEDIA` = supports activés. Si `operator_fee_basis = NET_OF_REFUNDS`,
  l'étape 2 écrit quand même la base brute (R-04).
- `PLATFORM_FEE` : assiette `operatorFeeHt` = HT des frais de l'étape 2 (relu dans
  `closing_step.summary`, pas recalculé). Règle `PLATFORM_CONTRACT`, 20 % des frais HT.
- Valeurs du scénario de référence : droits de place 25 000 (Food 15 000 + Tee 10 000 ; HT 21 186,
  TVA 3 814) ; frais 6 000 (3 % de 100 000 + 6 supports x 500 ; HT 5 085, TVA 915) ; redevance 1 017
  (862 HT + 155 TVA). Un test unitaire par calculateur retrouve ces nombres.

### T030 : calculateurs de `REFUND_WINDOW` (R-03, R-04)

- `OPERATOR_FEE_REGULARIZATION` (R-04) : seulement si `operator_fee_basis = NET_OF_REFUNDS`, sinon
  sans objet. Delta = frais(base brute écrite en SETTLING) moins frais(base nette des
  `WALLET_REFUND` faits depuis), en appliquant la MÊME règle (min, max, fixe) aux deux bases :
  `fee()` n'est pas linéaire (R-04, jamais le taux sur les remboursements). Commande `OPERATOR_FEE`
  avec `regularization: true`. Delta nul : sans objet.
- `BREAKAGE` : portefeuilles à solde payé ou espèces dues non nuls à `refund_deadline` ; commande
  `BREAKAGE` (`BreakagePayload.wallets`). `NONE` : sans objet (le builder refuse). Scénario : W01 9
  000 + W05 11 000 = 20 000, partagés 16 000 (`ORG_CASSE`) et 4 000 (`OPE_CASSE`) ; W06 (crédits
  offerts) n'est pas concerné.
- `DEPOSIT_FORFEIT` : supports `deposit_status = HELD` ; `DEPOSIT_FORFEITED` du moteur, UN support à
  la fois (`forfeit_deposit`, clé interne `deposit-forfeit:<media>:<n>`,
  `ledger-engine.service.ts:262-288`). Scénario : 2 000 pour W04. Les ids de transaction de l'étape
  se relisent par cette clé.
- `PROMO_EXPIRY` : portefeuilles à solde offert non nul, commande `PROMO_EXPIRY` (`enrich` lit le
  solde). Scénario : W06, 1 000.

### T031 : exécution et audit (R-01)

Dans la transaction idempotente de la route, dans cet ordre (ordre des verrous d'`interfaces.md`) :

1. grand livre de l'événement ; si absent ou `LOCKED` : `409 CONFLICT_STATE` ;
2. `pg_advisory_xact_lock(hashtextextended('closing:<event>:<step>', 0))` ;
3. **lire `closing_step` AVANT tout calcul** : étape déjà faite : renvoyer la réponse reconstruite
   depuis `summary` et `transaction_ids`, sans rien recalculer ni écrire. Sinon le moteur répondrait
   `CL002` (`IDEMPOTENCY_KEY_REUSED`, `ledger-engine.service.ts:133-142`) car les soldes ont changé
   : c'est le piège ;
4. ordre : toute étape précédente doit être `DONE` ou `NOT_APPLICABLE`, sinon `409
   CLOSING_CONDITION_NOT_MET` (detail : l'étape manquante). Phase : étapes 1 à 3 en `SETTLING` ; 4 à
   7 en `REFUND_WINDOW` et `clock_timestamp() >= refund_deadline` effective ; sinon le même `409` ;
5. `compute`, puis `engine.execute` pour chaque commande, clés `closing:<event_id>:<step>[:<id>]` ;
6. `record_closing_step(event, step, status, tx[], summary)` dans la même transaction ; audit
   (`AuditAction` `CLOSING_STEP_EXECUTED`, auteur, étape, montants par bénéficiaire ; jamais de
   donnée personnelle).

Une erreur du moteur en cours d'étape annule toute la transaction : aucune étape à moitié écrite.

### T032 : relevé des soldes restants (route 4)

Après `CLOSED` avec grand livre `CLOSING` : soldes restants par partie et par compte (droit net non
nul, comptes sans titulaire non nuls ; mêmes règles que `ledger_unsettled`, S:3024-3032 ;
`event_status_history.remaining` en total). `format=csv` : `Csv.write` de `common/csv.ts` (WP01).
Grand livre `LOCKED` : liste vide.

### T033 : conditions de passage (`status.service.ts`, `status-messages.ts`)

- `PSP_RECONCILED` sort de `EXTERNAL` (l. 34-41) : elle vient de la base (`source: 'DATABASE'`),
  calculée par `account_reconciliation` dans `event_transition_conditions` (WP02).
  `CASH_DESKS_COUNTED` reste comme elle est.
- Ajoute à `TEXTS` des couples fr/en remplie/non remplie : `NO_OPEN_CASH_SESSION`,
  `REFUND_DEADLINE_REACHED`, `CLOSING_STEPS_DONE`, et remplace le texte de `PSP_RECONCILED` (l.
  117-122). Phrases courtes, sans texte SQL.
- Le `409 CLOSING_CONDITION_NOT_MET` de `assertMet` nomme déjà les codes non remplis : ne le change
  pas.

### T034 : tests

Voir « Tests et preuves ». Tests unitaires des calculateurs : montants du scénario, cas limites
ci-dessous.

## Tests et preuves

```bash
cd <lane>/apps/api
export PGDATABASE=cashless_wp07; source ../../tools/dev-db/env.sh; env | grep DATABASE_URL
SKIP_LATENCY=1 npx jest test/unit/closing test/integration/closing \
  test/integration/events/status.spec.ts --runInBand --forceExit
npm run typecheck -w @cashless/api
```

La base doit porter les migrations `0083` à `0088` et la section 12 de `post-roles.sql` (reset-db
depuis ta lane). Cas exigés (chacun nomme son FR ou NFR) :

- FR-003 : aperçu des trois étapes de `SETTLING` sans écriture (compte de `journal_transaction`
  inchangé) ; l'aperçu égale ce que l'exécution écrit (25 000, 6 000, 1 017).
- FR-004 : étape 2 avant l'étape 1 : `409 CLOSING_CONDITION_NOT_MET` ; rejeu avec une AUTRE clé
  d'en-tête : même réponse, zéro écriture ; étape 4 en `SETTLING` : `409`.
- FR-005 à FR-007 : `PREPAID` sans écriture ; `DEDUCT_CAPPED` plafonné ; dette transférée ;
  régularisation `NET_OF_REFUNDS` avec une règle à minimum (double calcul différent d'un taux
  appliqué) ; casse 20 000 = 16 000 / 4 000 ; casse `OPERATOR` ; `NONE` sans objet ; caution 2 000 ;
  crédits offerts 1 000.
- FR-001, FR-002 : `RECONCILING` refusé avec une session de caisse `OPEN` ou `CLOSING` ; `CLOSED`
  refusé avant `refund_deadline` ; `CLOSED` refusé étapes de `REFUND_WINDOW` non faites ; textes fr
  et en.
- FR-008 : relevé des soldes restants JSON et CSV ; vide une fois `LOCKED`.
- FR-024 : une ligne d'audit par exécution, auteur correct.
- NFR-001 : 50 exécutions concurrentes de la même étape (clés d'en-tête différentes) : une seule
  série d'écritures ; 50 rejeux de la même clé : une seule. Aucun `500`.
- Grand livre équilibré (somme nulle par transaction) après chaque cas ; `app.module.ts` démarre.

## Definition of Done

- [ ] Routes 1 à 4 servies, rôles et portée contrôlés, `format=csv` de la route 4.
- [ ] Sept calculateurs partagés par l'aperçu et l'exécution ; valeurs du scénario retrouvées.
- [ ] État lu avant tout calcul ; verrou par (événement, étape) ; clés
  `closing:<event_id>:<step>[:<id>]`.
- [ ] `PSP_RECONCILED` calculée ; trois codes nouveaux avec textes fr/en ; `status.spec.ts` adapté.
- [ ] Destination de casse `OPERATOR` traitée et signalée (contradiction 4).
- [ ] Tests verts sur `cashless_wp07` ; typecheck et Prettier (100 caractères) verts ; aucun `.sql`
  touché.
- [ ] Compte rendu : retouches hors carte, écarts au plan (renforce / affaiblit), question de la
  source `BATCH`.

## Ce que le relecteur doit casser

1. Exécuter deux fois l'étape 1 avec deux clés d'en-tête différentes : une seule série d'écritures,
   pas de `CL002`.
2. Exécuter l'étape 3 avant l'étape 2, ou l'étape 5 en `SETTLING` : `409`, rien d'écrit.
3. Lancer l'aperçu pendant qu'une exécution tourne : l'aperçu n'écrit jamais, ne prend aucun verrou
   d'écriture.
4. Régularisation avec min et max de frais : le montant diffère du taux appliqué aux remboursements,
   et un test le prouve ; deux exécutions : une seule écriture.
5. Casse avec `breakage_destination = OPERATOR`, `LEGAL_ACCOUNT`, `NONE` : aucun `500`, partage
   correct.
6. 50 exécutions simultanées : le nombre de transactions `closing:*` ne dépasse pas celui d'une
   exécution.
7. Passer `RECONCILING` avec une session `CLOSING` ; `CLOSED` avant l'échéance : refusés, textes
   présents.
8. Étape d'un événement d'un autre prestataire ou d'un organisateur non administré : `404` / `403`,
   aucune écriture.
9. Réponse ou audit : aucune donnée personnelle de festivalier (seulement des identifiants et des
   montants).
10. `closing_step` : tenter un `UPDATE` ou `DELETE` par `cashless_app` échoue (droits de WP06, à
    confirmer).

## Fichiers à faire relire par une personne

- `closing/closing-steps.service.ts` (verrou, état lu avant calcul, ordre) ;
- `closing/calculators/*.ts` (calculs d'argent : assiettes, régularisation, casse, caution).
