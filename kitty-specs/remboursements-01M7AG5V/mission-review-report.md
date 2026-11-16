# Mission Review Report: remboursements-01M7AG5V

**Reviewer** : claude (revue post-fusion, skill `spec-kitty-mission-review` ; l'orchestrateur n'a écrit ni le code ni les
relectures des lots)
**Date** : 2026-11-16
**Mission** : `remboursements-01M7AG5V` — Remboursements des festivaliers (mission 9a)
**Baseline commit** : `945d4a8b` (`baseline_merge_commit` de `meta.json`)
**HEAD at review** : `ef7e2649` sur `feat/remboursements` (locale, pas encore poussée). Squash `bf0b6376`, acceptation
`8cd5ae97`, puis état Spec Kitty (`f8f90575`), rétrospective (`65adda2d`), suivi des lots (`ef7e2649`).
**WPs reviewed** : WP01..WP07 (7/7 `done`). WP01, WP02 et WP04 approuvés au cycle 1 ; WP03, WP05 et WP07 au cycle 2 ;
WP06 au cycle 3. Les retours en arrière forcés (`approved → planned` pour WP03, WP05, WP06 ; `in_review → planned`
pour WP06, WP07) suivent chacun une décision du porteur du 16/11 (décisions 11, 13, 14) ou un constat de batterie
(borne SC-007), avec leur compte rendu `review-cycle-N.md`. Aucun événement `ReviewerSelfApproval`.

> Limite d'indépendance : implémentation, relectures, acceptation et présente revue viennent d'agents Claude. Cette
> revue ne vaut pas relecture humaine (règle 4 de `CLAUDE.md`) : voir « Fichiers à faire relire par une personne ».

---

## Gate Results

Les portes 1 à 3 du skill visent le dépôt Spec Kitty ; leurs équivalents du projet ont été relancés sur `ef7e2649`.

### Gate 1 — Contract tests
- Commandes : `npm run check -w @cashless/contracts` ; `npm run check:generated -w @cashless/ledger-sql`.
- Exit code : 0 et 0 (« types à jour », « types Dart à jour », « suites pgTAP à jour »).
- `git diff 945d4a8b..HEAD -- packages/contracts schema_grand_livre_cashless.sql roles.sql scenario_reference.json
  tests_grand_livre_cashless.sql package*.json` : **vide**. Contrat d'API inchangé (C-002) ; aucun `.sql` généré modifié.
- Result : **PASS**.

### Gate 2 — Architectural tests
- Commande : `npx tsc --noEmit` ; `jest test/unit/architecture.spec.ts test/unit/processes.spec.ts
  test/unit/production-guard.spec.ts --runInBand`.
- Exit code : 0 ; 3 suites, 83/83.
- Batterie complète de l'orchestrateur avant fusion : pgTAP 72 fichiers / 6 180 assertions ; Jest 3 635/3 636 puis 45
  suites ciblées / 512 après la correction de WP06 cycle 3 ; `git diff 7d26ee9f HEAD -- apps packages` vide (le code
  de `feat` est la tête testée).
- Result : **PASS**.

### Gate 3 — Cross-repo E2E
- Sans objet (aucun dépôt de bout en bout pour ce projet). Équivalent : parcours `journey.spec.ts`,
  `journey-limits.spec.ts`, `concurrency.spec.ts`, `refund-latency.spec.ts` (WP07, 20 suites / 170 tests rejoués par la
  relecture).
- Result : **N/A**.

### Gate 4 — Issue Matrix
- Aucun numéro de ticket GitHub cité dans `spec.md` ; pas de `issue-matrix.json`.
- Result : **N/A**.

---

## FR Coverage Matrix

Matrice d'acceptation (`acceptance-matrix.json`) : 38 critères `pass`, 4 invariants négatifs `confirmed_absent`,
`overall_verdict: pass`. La revue a vérifié que chaque exigence a au moins un test du domaine qui l'assert.

| FR / NFR | Objet | Lot | Tests principaux | Adéquation |
|---|---|---|---|---|
| FR-001 | Demande persistante | WP01 | `tests_refund_requests.sql` (88), `approve-refund`, `confirm-refund` | ADEQUATE |
| FR-002 | Création par le festivalier | WP04 | `create-refund-request.spec.ts` | ADEQUATE |
| FR-003 | Une demande ouverte | WP01/WP04 | index `refund_request_one_open` (pgTAP), `409` dans `create-refund-request`, `concurrency` | ADEQUATE |
| FR-004, FR-005 | Fenêtre, éligibilité, montant estimé | WP04 | `create-refund-request.spec.ts` | ADEQUATE |
| FR-006, FR-007 | Listes festivalier et back-office | WP04 | `list-refund-requests.spec.ts` (autre festivalier → `404`) | ADEQUATE |
| FR-008, FR-014 | Approbation à deux, contrôle renforcé | WP05 | `approve-refund.spec.ts` | ADEQUATE |
| FR-009 | `PAID` / `FAILED` | WP05 | `confirm-refund.spec.ts` (`FAILED` refusé au proposant et à l'exécutant, décision 13) | ADEQUATE |
| FR-010 | Refus | WP05 | `reject-refund-request.spec.ts` | ADEQUATE |
| FR-011, FR-012 | Autre numéro, décision du titulaire | WP03 | `holder-challenge`, `holder-decision`, `holder-link` | ADEQUATE (FR-012 amendée, décision 15) |
| FR-013, NFR-005 | Échéance de l'attente | WP03 | `holder-promotion`, `refund-latency` ; travailleur `refund-promotion` (60 s) branché dans `maintenance.module.ts` | ADEQUATE |
| FR-015 à FR-017 | Guichet enchaîné, seconde personne, atomicité | WP06 | `release-chaining.spec.ts`, `media-port-swap.spec.ts` | ADEQUATE (seuil sur le cumul, décision 11) |
| FR-018 | Espèces dues d'un bracelet remplacé | WP02 | `tests_replace_cash_due.sql`, `cash-due-after-replace.spec.ts` | ADEQUATE (OP-N55 levé) |
| FR-019 | Autorité de débit | WP02/WP05/WP06 | `approve-refund`, `confirm-refund`, `debit-paths-refused` | ADEQUATE |
| FR-020 | Audit | WP03..WP06 | assertions d'audit dans les suites ci-dessus | ADEQUATE |
| NFR-001 à NFR-003 | Pas de double remboursement, une demande ouverte, grand livre équilibré | WP07 | `concurrency.spec.ts`, `journey.spec.ts`, `refund-invariants.ts` | ADEQUATE |
| NFR-004 | p95 < 500 ms | WP07 | `refund-latency.spec.ts` : création 475 ms, lectures 82 et 154 ms | ADEQUATE, marge faible (RISK-2) |

Contrôle des tests sur fixtures synthétiques : les suites passent par les routes HTTP et la base réelle (fixtures
`refund-flow-fixtures.ts`, `create-fixtures.ts` qui créent les données par les fonctions du grand livre). Les
mutations faites à la relecture de WP06 (retrait de `@RequiresOnsiteApproval`, ajout de `@CounterAuth`) ont été
détectées. Aucun faux positif trouvé.

---

## Drift Findings

### DRIFT-1 : FR-012 et scénario 5 amendés en cours de mission

**Type** : LOCKED-DECISION (amendement consigné) — **Severity** : LOW
**Spec reference** : FR-012, scénario 5, C-001
**Evidence** : `spec.md` l. 181 ; `data-model.md` l. 51 ; ADR-194 ; OP-N127 clos.
**Analysis** : la spec promettait « sans titulaire vérifié → REQUESTED », inatteignable par `/me` (identité créée avec
le numéro). Contradiction signalée par WP04, tranchée par le porteur (décision 15 : comportement strict, `422`), spec
amendée et analyse relancée (`9d740718`). Pas de dérive silencieuse.

Aucune invasion de non-objectif : pas de versement déclenché par l'API (C-003 : aucun appel HTTP sortant dans
`apps/api/src/refunds/`), pas de demande créée par le back-office (C-004, OP-N123), pas de route, de champ ni de code
d'erreur nouveau (C-002 ; les nouvelles valeurs `REFUND_REQUEST_*`, `REFUND_HOLDER`, `MEDIA_REASSIGNED` sont des
actions d'audit et un usage de défi, pas des codes de réponse).

---

## Risk Findings

### RISK-1 : ordre des états d'une demande gardé par l'API seule, limite non consignée

**Type** : BOUNDARY-CONDITION — **Severity** : MEDIUM
**Location** : `packages/ledger-sql/migrations/0081_refund_requests.sql` (en-tête : « Aucune transition d'état n'est
gardée par la base ») ; `post-roles.sql` § 11 (`GRANT UPDATE (status, approved_by, transaction_id, estimated_amount,
fee, …)` à `cashless_app`).
**Trigger condition** : un défaut de l'API, ou un accès au rôle `cashless_app`, fait un `UPDATE` qui ramène une demande
`PAID` ou `FAILED` à `REQUESTED`, ou change `estimated_amount` après l'approbation.
**Analysis** : la base garde la cohérence de chaque ligne (CHECK jumelés) mais pas le passage d'un état à l'autre. Une
demande ramenée à `REQUESTED` peut être approuvée une seconde fois ; le grand livre borne le débit au solde payé
restant (pas de découvert), donc le risque est un second remboursement du solde rechargé entre-temps, pas une création
de monnaie. La limite était prévue au prompt de WP01 (« à signaler, pas à corriger ici ») et notée dans
`suivi-lots.md`, mais **elle n'a ni entrée dans `docs/POINTS_OUVERTS.md`, ni ADR, ni test qui échoue si elle
s'élargit** (règle 3). Selon la règle 4, c'est un écart non consigné : **constat bloquant jusqu'à sa consignation**
(ou un déclencheur de transition en base, à décider par le porteur).

### RISK-2 : marge faible sur NFR-004

**Type** : NFR — **Severity** : LOW
**Location** : `refund-requests.service.ts`, `refund-eligibility.ts`, `me.service.ts`.
**Analysis** : p95 de création 475 ms pour 500 ms (20 requêtes simultanées). Tri `date_trunc` sans index et `/me/wallets`
en N+1 (constats de WP04). Le test de latence échouera au premier coût ajouté à l'éligibilité ; à surveiller en CI.

### RISK-3 : limites acceptées, levée encore « à confirmer »

**Type** : CROSS-WP — **Severity** : LOW (consignées)
**Analysis** : OP-N124 (code du titulaire consommé avant sa décision, ADR-192), OP-N125 (quota de codes commun, ADR-193),
OP-N126 (un seul recrédit d'un `FAILED`, ADR-191) et OP-N128 (guichet enchaîné, ADR-195) ont chacune une entrée, un ADR,
un test de limite (`journey-limits.spec.ts`, `journey.spec.ts`) et un report dans `PROMPTS-A-ENVOYER.md` et `PRD.md`.
Restent à confirmer par le porteur : la mission de levée d'OP-N124, OP-N125 et OP-N128, et le statut d'ADR-195
(« Proposée »).

---

## Silent Failure Candidates

| Location | Condition | Silent result | Spec impact |
|---|---|---|---|
| `apps/api/src/customer-app/me.service.ts:128` | `ProblemException` pendant le calcul d'éligibilité d'un portefeuille | `refund.eligible: false` | Affichage seulement : la création refait tous les contrôles et rend le vrai code d'erreur. Acceptable, déjà noté par WP04. |

Aucun `catch` qui rend une valeur vide dans `apps/api/src/refunds/`, `release.service.ts` ni
`customer-auth.service.ts`.

---

## Security Notes

| Constat | Emplacement | Classe | Recommandation |
|---|---|---|---|
| Transitions d'état non gardées par la base, non consignées | `0081`, `post-roles.sql` § 11 | DROITS DE LA BASE | RISK-1 : OP + ADR + test de limite, ou déclencheur de transition |
| Route publique `decideRefundRequestAsHolder` | `holder-decision.controller.ts` | AUTH | Conforme au contrat (ADR-76) : preuve par code (5 essais, blocage du numéro), lien demande/défi/numéro vérifié avant tout essai |
| Envoyeur de codes faux | `otp-sender.ts` | FAUX EN PRODUCTION | Refusé au démarrage en production (`FakeInProductionError`, `production-guard.spec.ts`) — règle 2 tenue |
| Fonctions `SECURITY DEFINER` | `refund_request_operator`, `promote_due_refund_requests`, `refund_request_scope_guard` | DROITS DE LA BASE | `EXECUTE` retiré de `PUBLIC` ; garde non appelable ; supposent un propriétaire qui ignore la RLS (OP-N87, existant) |
| Seconde personne au guichet | `release.service.ts` | CONTRÔLE À DEUX | Seuil sur le cumul des espèces (renforcement, ADR-190) ; limites OP-N128 consignées |

### Écarts de sécurité ouverts (règle 4)

| Écart | Consignation | Levée |
|---|---|---|
| OP-N124 code du titulaire consommé avant sa décision | ADR-192, test de limite | 9b proposée, à confirmer |
| OP-N125 quota de codes commun, alerte `BLOCK` = ligne d'audit | ADR-193, test de limite | 12b proposée, à confirmer |
| OP-N126 un seul recrédit d'un `FAILED` | ADR-191, test de limite | 9b (rapprochements) |
| OP-N128 guichet : `approved_by` nul sur la caution seule, cumul lu sous le verrou du bracelet | ADR-195 (Proposée), test de limite | 9b proposée, à confirmer |
| OP-N123 demande du back-office hors contrat | existant | 9b |
| OP-N130 ordre des états d'une demande gardé par l'API seule | ADR-196, test de limite (`tests_refund_requests.sql`) | 9b (décision du porteur du 16/11/2026) |

Levés par la mission : OP-N55 (espèces dues du bracelet remplacé), OP-N129 (lien du titulaire) ; OP-N127 clos.

### Fichiers à faire relire par une personne

> **Relecture humaine : validée par le porteur le 16/11/2026**, après la fusion dans `main` (PR #15), sans remarque.

- `packages/ledger-sql/migrations/0081_refund_requests.sql` (RLS, garde d'insertion, trois fonctions `SECURITY DEFINER`)
- `packages/ledger-sql/migrations/0082_replace_media_cash_due.sql` (`replace_media`)
- `packages/ledger-sql/post-roles.sql` § 11 (droits par colonne, `EXECUTE` de `cashless_app` et `cashless_maint`)
- `apps/api/src/ledger/status-matrix.ts`, `ledger-engine.service.ts` (contre-passation d'un `WALLET_REFUND`)
- `apps/api/src/customer-auth/customer-auth.service.ts` (`checkCode`, `createChallenge`, `verifyChallenge`,
  `issueChallenge`, `exchangeIn`), `otp-sender.ts`
- `apps/api/src/refunds/holder-challenge.service.ts`, `holder-decision.controller.ts`
- `apps/api/src/refunds/refund-eligibility.ts`, `refund-requests.service.ts`
- `apps/api/src/refunds/wallet-refund-action.ts`, `refund-confirm.service.ts`
- `apps/api/src/media/lifecycle/release.service.ts`

---

## Final Verdict

**PASS WITH NOTES**. RISK-1 consigné après la revue (décision du porteur du 16/11/2026 : OP-N130, ADR-196, levée en 9b).

### Verdict rationale

Les 20 FR et 5 NFR ont chacun un test du domaine qui contraint le comportement, par les routes et la base réelles ;
contrat, schéma de référence et `.sql` générés sont intacts ; aucune décision verrouillée n'est violée ; le seul
amendement (FR-012) a été tranché par le porteur et consigné. Les écarts de sécurité acceptés en cours de mission ont
chacun OP, ADR, test de limite et report. Un seul écart n'est pas consigné : l'ordre des états d'une demande n'est
gardé que par l'API (RISK-1). Selon la règle 4 de `CLAUDE.md`, il bloque jusqu'à sa consignation (OP + ADR + test qui
échoue si la limite s'élargit) ou sa correction par un déclencheur, au choix du porteur. Il ne bloque pas le code
livré, qui ordonne correctement les états (vérifié par les parcours et la concurrence).

### Open items (non-blocking)

- RISK-2 : marge de NFR-004 (index sur le tri, N+1 de `/me/wallets`).
- `interfaces.md` l. 111 (« même transaction » pour la consommation du code) à corriger à la prochaine révision.
- Pré-contrôle « demande déjà ouverte » avant la vérification du code (confort).
- Confirmer les missions de levée d'OP-N124, OP-N125, OP-N128 et le statut d'ADR-195.
- Relecture humaine des fichiers listés ci-dessus.

## Retrospective Reminder

La rétrospective a été écrite à la consolidation : `kitty-specs/remboursements-01M7AG5V/retrospective.yaml`
(`65adda2d`). Pour la revoir : `spec-kitty retrospect summary` (agrégation, lecture seule) et
`spec-kitty agent retrospect synthesize --mission remboursements-01M7AG5V` (propositions, à blanc par défaut).
