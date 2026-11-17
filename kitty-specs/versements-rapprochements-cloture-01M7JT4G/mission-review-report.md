# Mission Review Report: versements-rapprochements-cloture-01M7JT4G

**Reviewer** : claude (revue post-fusion, skill `spec-kitty-mission-review` ; l'agent de revue n'a écrit ni le code ni
les relectures des lots)
**Date** : 2026-11-17
**Mission** : `versements-rapprochements-cloture-01M7JT4G` — Versements, rapprochements et clôture (mission 9b)
**Baseline commit** : `b537c16d` (`main` après la PR #17, 9a close ; sert aux différences ci-dessous). `meta.json` porte
`baseline_merge_commit` `e817b56c` (dernier commit de coordination avant la fusion).
**HEAD at review** : `115e7807` sur `feat/versements-rapprochements-cloture` (locale, pas encore poussée). Acceptation
`15f1a19c`, squash `b4b81d8c`, puis trois commits d'après fusion relus à part : `d7a26b47` (docs), `b2538d99`
(consignation OP-N148, OP-N149, ADR-212, ADR-213), `115e7807` (tests).
**WPs reviewed** : WP01..WP14 (14/14 `done`, comptes rendus de relecture de la coordination). Revue du code livré sur
`feat`, pas des lots un à un.

> Limite d'indépendance : implémentation, relectures, acceptation et présente revue viennent d'agents Claude. Cette
> revue ne vaut pas relecture humaine (règle 4 de `CLAUDE.md`) : voir « Fichiers à faire relire par une personne ».

---

## Gate Results

### Gate 1 — Contract tests
- Contrat : comparaison **sémantique** (YAML chargé des deux côtés) de `openapi.yaml` à `b537c16d` et à `HEAD`. Aucune
  clé existante supprimée ni modifiée dans les chemins, schémas ou paramètres. Ajouts : 18 chemins, 20 opérations
  (`185 / 222` contre `167 / 202`), 19 schémas, la valeur `PAYOUT_EXCEEDS_ENTITLEMENT` de `ProblemCode`. Les 20
  opérations égalent celles de `contracts/contract-additions.md` (décision 5) ; le balayage `isolation-9b.spec.ts`
  recoupe lui-même cette égalité.
- Routes du code : `git diff -U0 b537c16d HEAD -- apps/api/src` ne montre que 21 décorateurs de route nouveaux, les 20
  du contrat et `postLateClaim` (déjà au contrat, servie ici). Aucune route en trop, aucune absente.
- `.sql` générés : modifiés seulement par leurs générateurs (`gen_tests.py`, `gen_golden.py`, décision 6 ; les
  `.sql` régénérés suivent). Aucun édité à la main.
- Result : **PASS**, avec DRIFT-1 (textes existants du contrat retouchés, déclarés).

### Gate 2 — Architectural tests
- Relancé : `unit/production-guard` (faux de la copie des scellements refusé en production, règle 2). Lots
  d'architecture et de processus : couverts par la batterie de l'orchestrateur avant fusion, non relancés ici.
- Result : **PASS** (voir « Preuves relancées »).

### Gate 3 — Cross-repo E2E
- Sans objet. Équivalent relancé : `scenario/closing-journey.spec.ts` (`CLOSING` → `CLOSED` → `LOCKED` par les seules
  routes du back-office) et `invariants-cloture/concurrency.spec.ts`.
- Result : **N/A** (équivalent **PASS**).

### Gate 4 — Issue Matrix
- Aucun ticket GitHub cité ; pas de `issue-matrix.json`. Result : **N/A**.

---

## Preuves relancées (base `cashless_wprv`, `--runInBand`, `reset-db` avant et après)

- Environnement : `PGDATABASE=cashless_wprv` puis `source tools/dev-db/env.sh` dans le même appel ; les 11
  `DATABASE_URL*` posées visent toutes `cashless_wprv` (0 hors cible). `DATABASE_URL_SNAPCONTENT` et `_SNAPSIGN` ne sont
  pas posées par `env.sh` (retombée silencieuse de `test/support/db.ts` sur `cashless_test`) : aucune suite relancée
  ne les utilise.
- Jest : `invariants-cloture/` (7 suites : `limits-9b`, `consignation`, `isolation-9b`, `concurrency`,
  `payment-data-exposure`, `internal-sales-commission`, `utc-bounds`), `refunds/holder-code-retry`,
  `scenario/closing-journey`, `unit/production-guard` : **10 suites, 119 tests, tous verts** (60 s).
- pgTAP : `tests_9b_rights.sql` et `tests_statements.sql` : **207 tests, PASS** (`pg_prove` du dépôt,
  `docs/passation-9a/scripts/bin/pg_prove`).
- Mutations d'essai sur la base seulement (aucun fichier modifié, base remise à zéro ensuite) : (A)
  `GRANT INSERT ON refund_request TO cashless_maint` fait échouer `limits-9b` ; (B) `GRANT INSERT (status)` au niveau
  colonne à `cashless_platform` ne le fait **pas** échouer (voir RISK-2).
- `cashless_test`, l'API partagée et `pkill` : non touchés.

---

## FR Coverage Matrix

`acceptance-matrix.json` : 36 critères, 6 invariants négatifs, `overall_verdict: pass`. Les 63 noms de fichiers de test
cités existent. Vérifications propres à la revue : routes et contrat (ci-dessus), droits, `SECURITY DEFINER`, RLS,
`create_payout_batch`, `settle_payout`, gardes de production.

| FR / NFR / SC | Objet | Tests principaux | Adéquation |
|---|---|---|---|
| FR-001, FR-002 | Conditions visibles, caisse ouverte | `closing/status-conditions`, `closing-order`, `tests_closing_conditions.sql` | ADEQUATE |
| FR-003 à FR-007 | Étapes avec aperçu, ordre, droits de place, frais, casse, cautions, crédits | `closing/closing-steps`, `closing-variants`, `closing-order` | ADEQUATE (décisions 10 et 11 couvertes) |
| FR-008 | Clôture, verrouillage, soldes restants | `closing/remaining-balances`, `scenario/closing-journey` | ADEQUATE |
| FR-009, FR-010 | Lot préparé, validé à deux, rôle selon le bénéficiaire | `payouts/payout-batch`, `tests_payouts.sql` (borne `CL055`, action `PAYOUT`, auteur et valideur distincts) | ADEQUATE |
| FR-011 | Export CSV du lot | `payouts/payout-export` (neutralisation des formules, décision 9) | ADEQUATE |
| FR-012 | Résultat d'un versement | `payouts/payout-confirm`, `tests_payouts.sql` | ADEQUATE ; voir RISK-1 (une seule personne) |
| FR-013 à FR-015 | Import, rapprochement, anomalies PSP | `reconciliation/*`, `tests_statements.sql` (décisions 7 et 14) | ADEQUATE |
| FR-016 | Réclamations tardives, `ADJUSTMENT` | `late-claims/late-claim`, `money-account` | ADEQUATE |
| FR-017 | Demande du back-office | `refunds/create-backoffice` | ADEQUATE |
| FR-018 | Transitions gardées par la base (OP-N130) | `tests_refund_transitions.sql` | ADEQUATE |
| FR-019 | Limites de la 9a levées (N124, N126, N128) | `refunds/journey-limits`, `failed-recredit-bound`, `release-cumul-lock`, `concurrency` | ADEQUATE |
| FR-020, NFR-005 | Scellement, copie, vérification | `sealing/seal-and-verify`, `unit/production-guard`, `tests_ops_functions.sql` | ADEQUATE (copie simulée refusée en production) |
| FR-021, NFR-006, SC-005 | Contrôles permanents et alertes | `controls/controls-alerts` | ADEQUATE |
| FR-022 | Relevés des parties | `statements/party-statement` (décision 15, ventes internes) | ADEQUATE |
| FR-023 | Export comptable configurable | `statements/accounting-export`, `tests_account_mapping.sql` ; bornes UTC (décision 17) `invariants-cloture/utc-bounds` | ADEQUATE |
| FR-024 | Audit | assertions d'audit par suite ; `payment-data-exposure` | ADEQUATE |
| NFR-001 | 50 exécutions concurrentes sans doublon | `invariants-cloture/concurrency`, `payout-concurrency`, `closing-concurrency` | ADEQUATE |
| NFR-002, SC-001 | Grand livre juste, scénario de référence | `scenario/closing-journey` | ADEQUATE |
| NFR-003 | Import de 10 000 lignes en moins de 60 s | `statement-import-latency` | ADEQUATE (non relancé : mesure de latence) |
| NFR-004 | p95 inférieur à 1 s | `statements/statement-latency` | ADEQUATE (non relancé ; `closing_balance` retiré du JSON pour tenir la borne, décision 16, OP-N143) |
| SC-002 | Versement au-delà du droit net ou par l'auteur refusé | `concurrency` (cumul de deux lots), `payout-batch` | ADEQUATE |
| SC-003, SC-004, SC-006 | Rapprochement 80 %, altération détectée, dettes levées | `import-statement`, `seal-and-verify`, tests de levée par dette | ADEQUATE |
| C-001 à C-011 | Contraintes | contrat (Gate 1), droits (ci-dessous), production-guard | ADEQUATE ; C-002 tenue (ajouts seuls) |

---

## Drift Findings

### DRIFT-1 : textes existants du contrat retouchés

**Type** : LOCKED-DECISION (amendement déclaré) — **Severity** : LOW
**Evidence** : `openapi.yaml` : description de `ProblemCode` (ajout de `PAYOUT_EXCEEDS_ENTITLEMENT`, valeur de
l'enum), de `IdempotencyKey` (ajout d'`exportPayoutBatch` à la liste des routes à réponse non conservée), de
`StatusCondition.code` (trois conditions ajoutées ; `PSP_RECONCILED` passe d'« externe » à « calculée »).
**Analysis** : tous les trois sont listés dans `contract-additions.md` (l. 29, 75 et section des codes), aucune clé,
type ni valeur existants ne change ; rétrocompatible. La consigne du 05/11 est respectée par l'exception de la décision
2. La note aux équipes clientes (`docs/REPONSE-ENDPOINTS-BACKOFFICE-9B.md`) couvre le renommage Dart (ADR-213).

### DRIFT-2 : approbation d'une écriture de résultat attribuée à une personne qui n'a pas agi

**Type** : SECURITY-DRIFT (non consigné) — **Severity** : MEDIUM
**Spec reference** : FR-012, `research.md` R-06 (résultat « sans approbation »), SPECIFICATION §6 (BACKOFFICE exige deux
personnes).
**Evidence** : `0085_payouts.sql`, `settle_payout` : `v_approver := CASE WHEN p_actor = po.approved_by THEN
po.initiated_by ELSE po.approved_by END`, passé comme `approved_by` à `post_transaction`. En-tête de la migration :
« le règlement est une action seule ».
**Analysis** : voir RISK-1.

Aucune invasion de non-objectif : pas de versement déclenché par l'API (C-003), pas de fonction en trop, pas de route
hors liste.

---

## Risk Findings

### RISK-1 : résultat d'un versement par une seule personne, `approved_by` d'emprunt, non consigné (bloquant tant que non consigné)

**Type** : AUTH / CONTRÔLE À DEUX — **Severity** : MEDIUM
**Location** : `0085_payouts.sql` (`settle_payout`), `apps/api/src/payouts/payouts.controller.ts` (`confirmPayout` :
« Aucune règle de deux personnes sur le résultat (FR-012) »).
**Trigger condition** : un administrateur déclare `PAYOUT_FAILED` (recrédit du droit) ou `PAYOUT_CONFIRMED` (référence
quelconque) seul, sur une ligne qu'il n'a pas validée.
**Analysis** : la spécification et le plan (R-06) prévoient bien un résultat sans seconde personne, donc ce n'est pas
une dérive de périmètre. Mais deux effets ne sont consignés ni en `POINTS_OUVERTS.md` ni en ADR : (1) la
transaction BACKOFFICE écrite porte comme « valideur » le valideur du lot (ou l'initiateur), qui n'a pas agi sur cet
événement : la colonne de seconde personne du grand livre est satisfaite formellement, pas réellement (seul
`payout.confirmed_by` dit qui a agi) ; la contrainte de deux personnes distinctes de `journal_transaction` ne protège
donc pas le résultat ; (2) un `PAYOUT_FAILED` seul recrédite le droit, que le versement soit réellement parti ou non :
une personne seule peut rouvrir le droit puis préparer (avec une seconde) un nouveau lot, d'où un double versement
possible. C'est l'inverse de la décision 13 de la 9a, qui a exigé une seconde personne pour `FAILED` d'un
remboursement (`confirm-refund`). Le contournement est aujourd'hui borné par l'audit et par le rapprochement bancaire,
mais l'en-tête de la migration est le seul endroit où c'est écrit. Selon la règle 4 de `CLAUDE.md`, un écart de sécurité
non consigné est un constat bloquant jusqu'à sa consignation (OP + ADR + test qui échoue si une personne seule peut
écrire autre chose que son propre nom), ou jusqu'à la décision du porteur d'exiger la seconde personne pour
`PAYOUT_FAILED`.

### RISK-2 : les tests de borne d'OP-N140 et d'OP-N145 bornent un état, pas la limite

**Type** : PROOF-GAP — **Severity** : LOW
**Location** : `apps/api/test/integration/invariants-cloture/limits-9b.spec.ts`.
**Analysis** : voir « Relecture des trois commits ». En bref : le test d'OP-N145 attrape un `INSERT` accordé au niveau
table à un autre rôle (mutation A prouvée) mais pas au niveau colonne (mutation B) ; le test d'OP-N140 fige le code de
`redact.ts` mais n'échouerait pas si un journal de corps de requête était ajouté, qui est le vrai risque de l'OP.

### RISK-3 : isolation entre organisateurs d'un même prestataire non prouvée

**Type** : PROOF-GAP — **Severity** : LOW (consigné : OP-N149, mission 13)
**Analysis** : `isolation-9b.spec.ts` prouve les 20 opérations entre prestataires (la RLS compte), non entre
organisateurs du même prestataire, qui ne repose que sur les contrôles de portée de l'API
(`resolveChain`, `assertOrganizerScope`, `party-statement-scope.ts`). Je n'ai trouvé aucun défaut en lisant ces
contrôles ; une mutation qui en retirerait un resterait verte. Consigné après la fusion.

### RISK-4 : limites mineures sans test de borne

**Type** : CROSS-WP — **Severity** : LOW
**Analysis** : OP-N134, N135, N136, N137, N141, N142 et N143 citent un test de comportement, non un test qui échoue si la
limite s'élargit (règle 3, troisième point, lue strictement). Aucune n'affaiblit la sécurité ; à traiter par les
missions qui les lèvent.

### RISK-5 : dépendances de déploiement des fonctions `ops_*`

**Type** : DEPLOY — **Severity** : LOW (consigné : OP-N133, mission 12b)
**Analysis** : le propriétaire doit ignorer la RLS (hypothèse d'OP-N87) et être membre de `pg_read_all_stats` ; sans
cela, `ops_long_transactions` rend la ligne `?config` (alerte 11, jamais une liste vide silencieuse). À poser dans le
déploiement.

---

## Silent Failure Candidates

| Location | Condition | Silent result | Spec impact |
|---|---|---|---|
| `ops_long_transactions` | propriétaire sans `pg_read_all_stats` | ligne `?config`, convertie en alerte 11 par le travailleur | Pas silencieux : alerte ; consigné (OP-N133) |
| Rapprochement automatique (`import_statement_lines`) | ligne dont la demande de remboursement est déjà recréditée | ligne laissée « non rapprochée » | Visible, alerte générique `statement-unmatched` ; consigné (OP-N148) |

Aucun `catch` qui rend une valeur vide trouvé dans les nouveaux dossiers `payouts`, `closing`, `reconciliation`,
`sealing`, `statements`.

---

## Security Notes

| Constat | Emplacement | Classe | Recommandation |
|---|---|---|---|
| Droits de la section 12 : lecture seule des tables neuves ou modifiées pour `cashless_app` ; `REVOKE ALL` à `PUBLIC` et à tous les rôles ; écriture par fonctions nommées ; 12b retire `EXECUTE` aux gardes et fonctions de déclencheur ; 12c : 14 fonctions `ops_*` à `cashless_maint` seul, qui n'a aucune lecture de table | `post-roles.sql` § 12 ; `tests_9b_rights.sql` (relancé, vert) | DROITS DE LA BASE | Conforme (C-005). Aucun `DELETE` accordé |
| Fonctions `SECURITY DEFINER` de `0083` à `0088` : `SET search_path = public, pg_temp`, `REVOKE ALL … FROM PUBLIC`, `assert_tenant` partout où l'appelant est un prestataire (import, rapprochement, étapes, lot, règlement, correspondance). Les `ops_*` n'en ont pas, par construction (elles traversent les prestataires) : `EXECUTE` à `cashless_maint` seul | `0083` à `0088` | DROITS DE LA BASE | Conforme ; limite OP-N133 |
| RLS : `statement_import`, `closing_step`, `account_mapping` en `ENABLE` + `FORCE`, politique `USING` et `WITH CHECK` sur `operator_id`, déclencheur de garde de portée à l'insertion, `forbid_mutation` (ajout seul) | `0083`, `0084`, `0088` | RLS | Conforme |
| Verrous de la décision 14 : `match_statement_line` et le rapprochement automatique verrouillent d'abord les `refund_request` liées (ordre des identifiants), puis refusent ou laissent non rapprochée une ligne dont la demande est recréditée | `0083` ; `concurrency.spec.ts` (course réelle de 8 demandes), `tests_statements.sql` § 4b | CONCURRENCE | Conforme ; reste OP-N148 (ligne importée après le recrédit) |
| `create_payout_batch` : demande `PAYOUT`, `APPROVED`, auteur et valideur identiques à ceux de la demande et distincts ; droit net relu sous verrou (`CL055`) ; `CASH` refusé ; un versement par bénéficiaire et par lot ; IBAN jamais dans un message | `0085` | CONTRÔLE À DEUX | Conforme à la décision 13 pour le lot ; le résultat est RISK-1 |
| Masquage des données de paiement : `approvalRequestDto` masque `payload` et `result` ; IBAN et numéro en clair seulement dans le CSV d'export | `approval.mapper.ts` ; `payment-data-exposure.spec.ts` (relancé, vert) | DONNÉES PERSONNELLES | OP-N147 levé ; reste OP-N140 (journal de corps futur) |
| Faux de la copie des scellements : `createSealCopy` refuse la production, `assertProcessIsSafe` le nomme | `sealing.module.ts`, `kms/production-guard.ts` ; `production-guard.spec.ts` (relancé, vert) | FAUX EN PRODUCTION | Règle 2 tenue |
| `ops_raise_alert` : code 7 à 11, détail de 4 ko au plus, clés `query`, `iban`, `msisdn`, `phone`, `token`, `secret` refusées à toute profondeur | `0087` | FUITE | Conforme |
| `ops_long_transactions` : ne rend jamais le texte des requêtes (C-011) | `0087` ; `tests_9b_rights.sql` | FUITE | Conforme |

### Écarts de sécurité ouverts (règle 4)

Tableau complet d'OP-N131 à OP-N149 (ADR-197 à ADR-213 : 197 → N131, 198 → N132, 199 → N133, 200 → N134 à N136 et N146,
201 → N145 et N146, 202 → N135, 203 → N123, N126, N140, N144, 204 → N137 et N147, 205 → N141, 206 → N138, 207 → N139,
208 → N130, 209 → N142 et N143, 210 → levées, 211 → N147, 212 → N148, 213 → N146 ; tous « Acceptée » ou « Renforcement »).
« Bloque la production » est celui des fiches.

| OP | ADR | Écart | Bloque la prod. | Mission qui le lève | Test qui le borne |
|---|---|---|---|---|---|
| N131 | 197 | Copie des scellements simulée | oui, mais le faux refuse déjà le démarrage | 12b | `unit/production-guard.spec.ts` (réel) |
| N132 | 198 | Alertes sans envoi à une personne | oui, avant l'exploitation réelle | 12b | `controls/controls-alerts.spec.ts`, `consignation.spec.ts` (le code n'envoie rien) |
| N133 | 199 | Propriétaire des `ops_*` privilégié, `pg_read_all_stats` | oui (déploiement) | 12b | `tests_9b_rights.sql`, `tests_ops_functions.sql` |
| N134 | 200 | `closing_balance` non recoupé | non | porteur | `tests_statements.sql` (comportement) |
| N135 | 200, 202 | Une transaction rapprochée par plusieurs lignes | non | porteur | `tests_statements.sql` § 3b et § 3c (comportement) |
| N136 | 200 | `explained_by_anomalies` absent du contrat | non | porteur | `reconciliation-state.spec.ts` (comportement) |
| N137 | 204 | Mineurs de WP08 | non | 11a | `payout-batch`, `payout-confirm` (comportement) |
| N138 | 206 | `CASH` inatteignable sur `LOCKED` | non | règle voulue | `money-account.spec.ts` |
| N139 | 207 | Remboursement tardif vers un autre numéro, sans code | non | 12b | `late-claim.spec.ts` (deux personnes) |
| N140 | 203 | `redact.ts` sans IBAN ; IBAN en clair au repos | oui si un journal de corps est ajouté | 11a | `late-claim.spec.ts` (audit masqué), `limits-9b.spec.ts` (partiel, RISK-2) |
| N141 | 205 | Écart de régularisation non plafonné | non | 11a | `closing-variants.spec.ts` (comportement) |
| N142 | 209 | Pagination, export non tracé, double compte possible | non | porteur | `accounting-export`, `party-statement` (comportement) |
| N143 | 209 | `closing_balance` non servi | non | ultérieure | `statement-latency.spec.ts` |
| N144 | 203 | Recrédit sans voie de contournement | non | porteur | `refunds/failed-recredit-bound.spec.ts` |
| N145 | 201 | `INSERT` direct en `PAID` ; anciennes signatures | non | 11a | `limits-9b.spec.ts` (table seulement, RISK-2) |
| N146 | 200 à 203, 205, 206, 209, 213 | Renforcements faits puis consignés | non | clos | sans objet |
| N147 | 204, 211 | Masque du résultat d'approbation | non | **levé** | `payment-data-exposure.spec.ts` |
| N148 | 212 | Ligne importée après le recrédit, alerte générique seule | non | 12b | `tests_statements.sql` § 4b |
| N149 | aucun (voulu) | Isolation entre organisateurs non balayée | non | 13 | aucun : trou de preuve |
| **à créer** | **à créer** | **Résultat d'un versement par une seule personne, `approved_by` d'emprunt (RISK-1)** | non | à décider | à écrire |

Reports vérifiés : `PRD.md` (l. 324 et 408) et `PROMPTS-A-ENVOYER.md` (l. 427, 570, 640, 692) portent les dettes pour
les missions 11a, 12b et 13. Levés par la mission : OP-N82, OP-N123, OP-N124, OP-N126, OP-N128, OP-N130, OP-N147.

### Relecture des trois commits d'après fusion

- **`limits-9b.spec.ts` (115e7807) — PARTIEL.** *OP-N145* : le test lit les droits réels de la base, exige que
  `cashless_app` soit le seul à avoir `INSERT` au niveau table, qu'aucun rôle n'ait `DELETE` ni `TRUNCATE` et que les
  colonnes d'`UPDATE` de `cashless_app` soient exactement les quinze attendues. Mutation A (`GRANT INSERT … TO
  cashless_maint`) : échec, comme voulu. Mutation B (`GRANT INSERT (status)` à `cashless_platform`, niveau colonne) :
  **le test reste vert** ; `information_schema.role_table_grants` ne voit pas les droits de colonne. À compléter par
  `column_privileges` pour `INSERT`. Il ne prouve pas non plus que l'`INSERT` direct en `PAID` reste possible, ce qui
  est sans importance (la limite est qui peut écrire). *OP-N140* : le test fige le comportement de `redact.ts` (l'IBAN
  n'est pas masqué, liste de champs inchangée). Il échoue si on **renforce** le masque (levée voulue, commentaire du
  fichier) mais pas si le risque réel s'élargit : un journal de corps de requête ajouté ailleurs. Il serait plus solide
  avec une recherche des écritures de `req.body` dans les journaux, ou le test du journal de requêtes. Ni l'un ni l'autre
  n'est une régression : ce sont des bornes plus faibles que ce que la fiche annonce.
- **`consignation.spec.ts` (115e7807) — exemption JUSTIFIÉE, avec réserve.** OP-N149 n'est pas un écart accepté : aucun
  contrôle n'a été retiré, reporté ni élargi ; c'est un trou dans la preuve, sans défaut constaté (j'ai relu les
  contrôles de portée sans trouver de faille). La règle 3 vise les écarts acceptés ; une OP sans ADR est cohérente, et
  la fiche porte mission (13), condition de levée et reports (vérifiés). Réserve : l'exemption est codée en dur par
  numéro (`op !== 'OP-N149'`) ; mieux vaut un marqueur lisible dans la fiche (« Pas un écart accepté ») que le test lit,
  pour qu'une OP future ne s'y glisse pas sans ADR. ADR-213 (renommage Dart) cite OP-N146 : correct, ce n'est pas un
  sujet de sécurité.
- **`holder-code-retry.spec.ts` (115e7807) — NE FAIT PAS AFFAIBLIR le test, sûr en passe parallèle.** Avant : deux refus
  successifs, code non consommé, puis décision acceptée après remise de l'échéance. Après : deux refus simultanés, puis
  une remise de l'échéance conditionnelle et atomique (`WHERE status = 'AWAITING_HOLDER'`, même transaction que la
  lecture du nombre de codes consommés) ; si la demande a été promue entre-temps (`promote_due_refund_requests()` d'une
  autre suite balaie tous les prestataires), la remise ne touche aucune ligne, le test recommence sur une demande
  neuve (30 essais au plus). Ce que le test prouve reste entier : 409 ×2 tant que l'échéance est passée, **0 code
  consommé** lu après les refus, puis 200 et 1 code consommé. Une demande promue ne peut pas être prise pour une demande
  refusée à bon droit : la promotion est irréversible, donc une remise réussie garantit que les refus venaient de
  l'échéance. Réserve mineure : `session_replication_role = 'replica'` (propriétaire, transaction locale) coupe les
  déclencheurs pour la seule colonne `hold_until`, sans toucher `status`. Vert dans la passe relancée.
- **Docs 07 et 09 et migrations `0083` à `0088` — COHÉRENTS.** `07-api-reference.md` : 185 chemins et 222 opérations,
  20 opérations ajoutées (recomptés sur le contrat). `09-class-diagram.md` : trois tables neuves (`statement_import`,
  `closing_step`, `account_mapping`), 112 au total, colonnes de `payout` (`approval_request_id`, `origin_account_id`,
  `msisdn`, `iban`, `failure_reason`, `confirmed_by`, `confirmed_at`) et d'`external_statement_line` (`statement_import_id`,
  `currency`, `matched_anomaly_id`, `matched_by`, `matched_at`) conformes aux migrations. Défauts de forme : la fiche
  OP-N145 n'a pas de ligne « Test » et celle d'OP-N140 ne cite pas `limits-9b.spec.ts` (cité seulement l. 2126) ; le
  tableau récapitulatif de `POINTS_OUVERTS.md` (l. 238 à 249) omet N138, N142, N143, N145, N146, N147 et N149.

---

## Final Verdict

**PASS WITH NOTES**, sous réserve de la consignation de RISK-1 (constat bloquant au sens de la règle 4 tant qu'il n'est
pas consigné, comme RISK-1 de la 9a).

### Verdict rationale

Les 24 FR, 6 NFR et 6 SC ont chacun un test du domaine par les routes et la base réelles ; le contrat n'est modifié que
par ajouts (20 opérations, aucune route en trop ni absente) ; droits de la base, `SECURITY DEFINER`, RLS, verrous de la
décision 14, masquage des paiements et refus du faux en production sont conformes et prouvés (119 tests Jest et 207
assertions pgTAP rejoués en série, verts). Les écarts acceptés (OP-N131 à N149, ADR-197 à 213) ont une fiche, un ADR
(sauf N149, justifié), un report et, pour la plupart, un test. Reste un écart non consigné : le résultat d'un versement
écrit par une seule personne, avec une seconde personne d'emprunt dans la transaction. Les bornes d'OP-N140 et d'OP-N145
sont plus faibles que leurs fiches ne le disent.

### Open items

- RISK-1 : consigner (OP + ADR + test) ou exiger la seconde personne pour `PAYOUT_FAILED` ; décision du porteur.
- RISK-2 : compléter `limits-9b.spec.ts` (droits `INSERT` par colonne ; absence de journal de corps pour OP-N140).
- RISK-3 : balayage entre organisateurs d'un même prestataire (OP-N149, mission 13).
- RISK-4 : tests de borne des limites mineures, à la levée.
- Documents : ligne « Test » d'OP-N145, `limits-9b` dans la fiche d'OP-N140, lignes manquantes du récapitulatif.
- `env.sh` ne pose pas `DATABASE_URL_SNAPCONTENT` ni `_SNAPSIGN` : les suites de snapshots retomberaient sur
  `cashless_test` en silence.
- Relecture humaine des fichiers listés ci-dessous.

### Fichiers à faire relire par une personne

- `packages/ledger-sql/post-roles.sql` § 12 (droits de la base, `cashless_maint`)
- `packages/ledger-sql/migrations/0085_payouts.sql` (`create_payout_batch`, `settle_payout`, gardes de `payout`) : RISK-1
- `packages/ledger-sql/migrations/0083_statements.sql` (verrous de la décision 14, rapprochement automatique)
- `packages/ledger-sql/migrations/0087_ops_functions.sql` (`ops_seal_*`, `ops_record_seal_copy`, `ops_raise_alert`,
  `ops_long_transactions`) : tout le fichier
- `packages/ledger-sql/migrations/0084_closing_conditions_steps.sql` (`set_event_status`, conditions de passage)
- `packages/ledger-sql/migrations/0086_refund_debts.sql` (`refund_request_transition_guard`, `refund_deposit`)
- `packages/ledger-sql/migrations/0088_account_mapping.sql`
- `apps/api/src/payouts/payout-action.ts`, `payouts.service.ts` (rôle par bénéficiaire, seconde personne)
- `apps/api/src/approval/approval.mapper.ts` (masque de `result`)
- `apps/api/src/sealing/` (`seal-copy.ts`, `fake-seal-copy.ts`, `sealing.module.ts`), `kms/production-guard.ts`
- `apps/api/src/errors/redact.ts` (OP-N140)

## Retrospective Reminder

La rétrospective a été capturée à la consolidation (`kitty-specs/versements-rapprochements-cloture-01M7JT4G/retrospective.yaml`,
`39bdb45b`). Pour la revoir : `spec-kitty retrospect summary` (lecture seule) et
`spec-kitty agent retrospect synthesize --mission versements-rapprochements-cloture-01M7JT4G` (propositions, à blanc par
défaut).

## Suites données à la revue (17/11/2026)

- **RISK-1 / DRIFT-2 — résolu (décision 18 du porteur).** `PAYOUT_FAILED` exige une personne distincte du
  préparateur (`initiated_by` = auteur de la demande d'approbation) et du valideur du lot ; elle est enregistrée
  comme valideur réel de la transaction (`0089_payout_failed_second_person.sql`, garde API `403 FORBIDDEN`,
  `CL041` en base) ; `CONFIRMED` reste à une personne. ADR-214 ; FR-012 et SPECIFICATION §11.4 amendés ; note
  aux équipes clientes mise à jour. Commit `b0cc3675`, relu par un relecteur distinct (ACCEPTÉ, mutations faites).
- **Notes (décision 19) — corrigées.** `limits-9b` vérifie les droits par colonne (mutation `GRANT INSERT (status)`
  détectée) ; fiche OP-N145 et récapitulatif de `POINTS_OUVERTS.md` complétés ; `env.sh` pose
  `DATABASE_URL_SNAPCONTENT` et `_SNAPSIGN`. Commit `81234678`.
- **Batterie complète sur feat (`81234678`, `cashless_test`)** : Jest parallèle 330 suites, 3 991 tests verts,
  0 échec ; `controls-alerts` et `seal-and-verify` en série 40/40 ; pgTAP 79 fichiers, 6 875 tests, dont
  `tests_offline_snapshot_source_no_stats.sql` (mesure de temps, mission 7) en dépassement sous charge, vert
  2 fois sur 2 relancé seul.
- **Verdict mis à jour : PASS WITH NOTES, aucun constat bloquant ouvert.** Choix laissé au porteur : une phrase
  rétrocompatible dans la description de `confirmPayout` (`openapi.yaml`) pour rendre la règle visible au contrat.
