# Mission Review Report: identite-roles-double-validation-01M4DNDN

**Reviewer**: claude (revue post-merge, skill `spec-kitty-mission-review`)
**Date**: 2026-10-09
**Mission**: `identite-roles-double-validation-01M4DNDN` — Identité, rôles et double validation
**Baseline commit**: `254057d` (`baseline_merge_commit` de `meta.json`, juste avant le squash merge `c2f3934`)
**HEAD at review**: `1680391` (poussé sur `origin/feat/identite-roles`, GitHub Actions run 37929190686 vert)
**WPs reviewed**: WP01..WP10 (10/10 `done`, un seul cycle de revue chacun, aucune transition forcée)

---

## Gate Results

Les portes 1 à 3 du skill visent le dépôt Spec Kitty lui-même (`tests/contract/`, `tests/architectural/`, dépôt e2e
inter-dépôts). Ce projet n'a pas ces dossiers ; leurs équivalents propres au projet ont été exécutés sur `1680391`.

### Gate 1 — Contract tests
- Commandes équivalentes : `npm run check -w @cashless/contracts` (types générés = `openapi.yaml`) ;
  `npm run check:generated -w @cashless/ledger-sql`.
- Exit code : 0 (local et run 37929190686).
- Result: **PASS**.

### Gate 2 — Architectural tests
- Commandes équivalentes : `test/unit/architecture.spec.ts` (pool `pg` confiné à `src/db/`, aucun `SET app.`) et
  `test/unit/idempotency-guard.spec.ts` (RISK-2 : toute route `@Idempotent` écrit par `IdempotentTx`, analyse par le
  compilateur TypeScript), dans `npm test`.
- Exit code : 0.
- Result: **PASS**.

### Gate 3 — Cross-repo E2E
- Sans objet (dépôt unique). Équivalent : `test/integration/end-to-end/identity-journey.spec.ts` (parcours complet)
  et `isolation-sweep.spec.ts` (11 routes lues dans le contrat), dans `npm test`.
- Exit code : 0.
- Result: **PASS** (aucune exception).

### Gate 4 — Issue Matrix
- `issue-matrix.json` absent : `spec.md` ne référence aucun ticket GitHub. Sans objet.
- Result: **PASS** (N/A).

Hors portes : CI complète rejouée sur la branche fusionnée (194 s) ; pgTAP 676 assertions, Jest 29 suites / 670 tests ;
GitHub Actions vert après le correctif `1680391` (voir RISK-1).

---

## FR Coverage Matrix

| FR ID | Description (brief) | WP Owner | Test File(s) | Test Adequacy | Finding |
|-------|---------------------|----------|--------------|---------------|---------|
| FR-001 | Personnes et attributions | WP01 | `tests_identity.sql` | ADEQUATE | — |
| FR-002 | Journal d'audit en ajout seul | WP02 | `tests_audit_log.sql` ; `tests_approvals.sql` (droits) | ADEQUATE | — |
| FR-003 | Authentification par jeton | WP04 | `authentication.spec.ts`, `oidc-verifier.spec.ts` | ADEQUATE | — |
| FR-004 | Prestataire et rôles déduits de la personne | WP04 | `authentication.spec.ts`, `isolation-sweep.spec.ts` | ADEQUATE | — |
| FR-005 | Contrôle des rôles par portée, déclaré par route | WP05 | `scope.spec.ts`, `roles-audit.spec.ts` | PARTIAL | DRIFT-1 |
| FR-006 | Gestion des personnes et des rôles | WP06 | `role-rules.spec.ts`, `users.spec.ts` | PARTIAL | DRIFT-2 |
| FR-007 | Amorçage du premier administrateur | WP03 | `identity-journey.spec.ts` (fonction réelle, deux lancements) | ADEQUATE | — |
| FR-008 | Journalisation des actions | WP05/06/08/09 | `users.spec.ts`, `roles-audit.spec.ts`, `identity-journey.spec.ts` (9 lignes = 9 actions) | ADEQUATE | RISK-3 (origine) |
| FR-009 | Demande d'approbation générique | WP08 | `action-registry.spec.ts`, `back-office.spec.ts` | ADEQUATE | — |
| FR-010 | Routes des demandes | WP08 | `back-office.spec.ts` | ADEQUATE | RISK-4 |
| FR-011 | Approbation et exécution unique | WP08 | `back-office.spec.ts` (rejeu, expiration validée, point de sauvegarde) | ADEQUATE | — |
| FR-012 | Refus | WP08 | `back-office.spec.ts` | ADEQUATE | — |
| FR-013 | Valideur jamais pris dans la requête | WP08/09 | `back-office.spec.ts`, `onsite.spec.ts`, `users.spec.ts` | ADEQUATE | — |
| FR-014 | Jeton d'approbation sur place | WP09 | `onsite.spec.ts` (10 refus, concurrence), `act-hash.spec.ts` | ADEQUATE | — |
| FR-015 | Garde de la transaction idempotente | WP07 | `idempotency-guard.spec.ts`, `committed-problem.spec.ts` | ADEQUATE | — |
| FR-016 | Faux serveur d'identité | WP04 | utilisé par toutes les suites d'identité | ADEQUATE | — |
| FR-017 | Signalement des contradictions | WP10 | `research.md` C-01 à C-15 | ADEQUATE (documentaire) | — |
| FR-018 | Journal chaîné | WP02 | `tests_audit_log.sql` | ADEQUATE | — |
| FR-019 | Scellement et vérification | WP02 | `tests_audit_log.sql` (4 altérations), `identity-journey.spec.ts` | ADEQUATE | — |

Toutes les suites appellent le code de production (routes HTTP réelles sur la base locale, fonctions SQL réelles) ;
aucune ne repose sur un objet fabriqué à la main à la place du chemin de production. Les seuls éléments de test sont
des routes de démonstration (action `ADJUSTMENT`, route `onsite-refunds`), voulues par la spécification (SC-005).

---

## Drift Findings

### DRIFT-1: Les routes de la mission ne déclarent pas leurs rôles par `@Roles`

**Type**: LOCKED-DECISION VIOLATION (léger) / écart de conception
**Severity**: MEDIUM
**Spec reference**: FR-005 (« déclarer pour chaque route le ou les rôles exigés et la portée de l'objet visé »)
**Evidence**:
- `grep "@Roles(" apps/api/src` : aucune occurrence ; `@Roles` + `RolesGuard` ne sont utilisés que par
  `test/integration/identity/roles-audit.spec.ts`.
- `apps/api/src/identity/users/users.controller.ts` : contrôle impératif `staffAdminRole(principal, …)` dans chaque
  méthode ; `grantRole`/`revokeRole` délèguent à `canGrant` dans le service ; `/approval-requests` délègue au
  registre d'actions.

**Analysis**: Le mécanisme déclaratif existe et est testé, mais les sept routes livrées vérifient les rôles par code.
Le résultat est correct (table de vérité et tests d'intégration positifs et négatifs), mais un oubli d'appel dans une
future route ne serait pas détecté par construction. Suivi conseillé : soit appliquer `@Roles` aux routes « Personnes »
(`listUsers`, `getUser`, `createUser`, `disableUser`), soit ajouter un test d'architecture qui exige `@Roles` ou un
contrôle explicite sur toute route non publique.

### DRIFT-2: Retrait et désactivation d'un `PLATFORM_ADMIN` sans route

**Type**: PUNTED-FR (partiel)
**Severity**: MEDIUM
**Spec reference**: FR-006 ; cas limite « retrait du dernier `PLATFORM_ADMIN` refusé »
**Evidence**: les routes `/operators/{operator_id}/…` ne voient pas une personne de plateforme (`operator_id` NULL,
RLS) : `users.spec.ts` › « administrateur de la plateforme : hors de portée des routes d'un prestataire (404) ».
Aucune route `/platform-admins/{id}/…`.

**Analysis**: La règle du dernier administrateur est garantie en base (pgTAP, `tests_identity.sql`) et traduite en
`403` si elle était atteinte, mais aucun administrateur de plateforme ne peut être retiré ni désactivé par l'API :
seule une intervention directe en base le permet. Consigné (C-10 de `research.md`) ; à prévoir dans une mission
ultérieure (gestion de la plateforme).

---

## Risk Findings

### RISK-1: Migrations dépendantes d'un rôle créé après elles (corrigé)

**Type**: BOUNDARY-CONDITION
**Severity**: HIGH (corrigé avant la revue)
**Location**: `packages/ledger-sql/migrations/0003_identity.sql`, `0006_platform_admin.sql` (avant `1680391`)
**Trigger condition**: cluster PostgreSQL neuf (CI) : `cashless_app` n'existe qu'après `roles.sql`, rejoué après la
série.

**Analysis**: `GRANT … TO cashless_app` dans deux migrations : la CI GitHub a échoué à « Base par les migrations »
(run 37928683650). Invisible en local, le rôle existant déjà dans le cluster. Corrigé par `1680391` (grants dans
`post-roles.sql`), reproduit en local avec le rôle renommé, CI verte (run 37929190686). Leçon : aucune migration ne
nomme `cashless_app` ; un test de CI sur cluster neuf est le seul garde-fou (il existe).

### RISK-2: Défaut de contrat révélé tardivement (corrigé)

**Type**: CROSS-WP-INTEGRATION
**Severity**: MEDIUM (corrigé en WP10)
**Location**: `packages/contracts/openapi.yaml`
**Trigger condition**: insertion des routes « Personnes » juste avant `components:`, donc sous `webhooks:` (OpenAPI 3.1).

**Analysis**: La revue de WP06 n'a pas vu que les 7 routes étaient déclarées comme webhooks (le `check` des types ne
valide que la cohérence génération/fichier). Le balayage d'isolation de WP10, qui lit les routes dans `paths`, l'a
révélé ; corrigé et types régénérés. Le balayage reste le garde-fou (il échoue si une route attendue manque).

### RISK-3: Origine de l'audit = adresse du répartiteur en production

**Type**: ERROR-PATH (fidélité)
**Severity**: MEDIUM
**Location**: `apps/api/src/audit/audit-context.ts` ; `apps/api/src/main.ts` (aucun `trust proxy`)
**Trigger condition**: déploiement derrière un répartiteur de charge (architecture cible AWS).

**Analysis**: `origin` = `req.ip` ; sans `app.set('trust proxy', …)`, c'est l'adresse du répartiteur, pas celle du
client : la colonne « d'où » de FR-008 serait inexacte pour toutes les lignes. Documenté dans le code, non réglé.
À traiter avec la mission de déploiement (réglage précis du nombre de mandataires de confiance, jamais `true`).

### RISK-4: Liste des demandes d'approbation : coût non borné

**Type**: BOUNDARY-CONDITION (performance)
**Severity**: LOW (MEDIUM quand les actions métier seront branchées)
**Location**: `apps/api/src/approval/approval.service.ts`, `list()` / `canSee()`
**Trigger condition**: personne qui n'a le droit de voir que peu de demandes d'un prestataire qui en a beaucoup.

**Analysis**: La page est remplie en lisant les demandes par lots et en résolvant, pour chacune, la chaîne de portée
(une à trois requêtes) jusqu'à remplir `limit` ou épuiser la table. Dans le pire cas (aucune demande visible), toute
la table du prestataire est parcourue dans une seule requête HTTP. Sans effet aujourd'hui (aucune action métier
branchée) ; à borner (nombre de lots, ou filtre SQL par portée) avant la mission 7 ou 9.

### RISK-5: Auto-désactivation et dernier `OPERATOR_ADMIN` d'un prestataire

**Type**: BOUNDARY-CONDITION
**Severity**: LOW
**Location**: `users.service.ts` › `disable`
**Trigger condition**: un `OPERATOR_ADMIN` désactive sa propre personne ou le dernier `OPERATOR_ADMIN` de son
prestataire.

**Analysis**: Permis (la spécification ne protège que le dernier `PLATFORM_ADMIN`). Le prestataire peut se retrouver
sans administrateur ; un `PLATFORM_ADMIN` peut rétablir la situation. À décider : interdire l'auto-désactivation
comme l'auto-attribution.

### RISK-6: Revue par le même agent que l'implémentation

**Type**: CROSS-WP-INTEGRATION (processus)
**Severity**: LOW
**Location**: `status.events.jsonl`, `tasks/WP*/review-cycle-1.md`
**Trigger condition**: chaque WP implémenté, revu et approuvé par `claude`, par délégation du porteur.

**Analysis**: Aucun évènement `ReviewerSelfApproval` n'est enregistré, mais l'indépendance de la revue n'est pas
assurée ; RISK-1 et RISK-2 sont précisément des défauts qu'une revue de WP n'a pas vus. Cette revue post-merge et la
CI GitHub servent de second regard ; une relecture humaine des zones de sécurité (garde d'authentification, jeton sur
place, `create_platform_admin`) est recommandée avant le pilote.

---

## Silent Failure Candidates

| Location | Condition | Silent result | Spec impact |
|----------|-----------|---------------|-------------|
| `approval.service.ts` › `canSee` | portée de la demande introuvable (`NOT_FOUND`) | demande masquée | Voulu (404 neutre) ; aucune autre erreur avalée |
| `oidc-verifier.ts` › `unavailable` | toute erreur non `jose` | `503` (refus) | Échec fermé, jamais d'acceptation : conforme |

Aucun `catch` qui rende une valeur vide sur une erreur inattendue dans le code de la mission.

---

## Security Notes

| Finding | Location | Risk class | Recommendation |
|---------|----------|------------|----------------|
| `identify_person` lit hors RLS toute personne par (émetteur, sujet) | migration `0003` | INFORMATION-DISCLOSURE (accepté, R-04) | Garder la fonction limitée à une personne ; ne jamais l'exposer en lecture libre |
| Configuration OIDC par défaut hors production (`https://idp.test`) | `config.ts` | MISCONFIG | Sans `NODE_ENV=production`, toute requête échoue en `503` (échec fermé) ; vérifier la variable au déploiement |
| Propriétaire des tables doit contourner la RLS | kit + `bootstrap-admin` | PRIVILEGE | Hypothèse du kit (C-11) : rôle de migration distinct, jamais utilisé par l'API |
| Comparaison de `act_hash` | `act-hash.ts` | TIMING | Temps constant (`timingSafeEqual`) : conforme |

Aucun appel de sous-processus, aucun chemin de fichier tiré d'une entrée, aucun appel HTTP sortant sans délai (JWKS :
`timeoutDuration` 2 s, `cooldownDuration` 30 s).

---

## Final Verdict

**PASS WITH NOTES**

### Verdict rationale

Les 19 exigences fonctionnelles ont une preuve exécutable qui passe par le code de production ; les contraintes
C-001 à C-008 sont respectées (valideur jamais lu dans la requête, contraintes « valideur ≠ auteur » intactes, aucune
fonction interne rendue au rôle applicatif, routes au contrat sans `x-release: V2`). Les deux défauts les plus graves
(RISK-1, RISK-2) ont été trouvés et corrigés avant la revue, et la CI GitHub est verte. Restent deux écarts MEDIUM non
bloquants (DRIFT-1 contrôle des rôles non déclaratif, DRIFT-2 aucune route de retrait d'un `PLATFORM_ADMIN`), un
risque MEDIUM de fidélité de l'audit en production (RISK-3) et NFR-005 (≤ 5 ms au p95) non mesuré : la conception le
respecte (clés en cache, une requête SQL par requête HTTP) mais aucun test ne le chiffre.

### Open items (non-blocking)

1. DRIFT-1 : `@Roles` sur les routes « Personnes » ou test d'architecture exigeant un contrôle de rôle.
2. DRIFT-2 : routes de gestion des administrateurs de la plateforme (retrait, désactivation).
3. RISK-3 : `trust proxy` réglé au déploiement.
4. RISK-4 : borner la liste des demandes avant de brancher les actions métier.
5. RISK-5 : décider de l'auto-désactivation et du dernier `OPERATOR_ADMIN`.
6. NFR-005 : mesure de charge de la garde d'authentification (avec le test de charge §15).
7. Relecture humaine des zones de sécurité avant le pilote (RISK-6).

## Retrospective Reminder

Le merge a capturé une rétrospective (`fa0a8b6 chore(identite-roles-double-validation-01M4DNDN): capture mission
retrospective`). Vérifier l'enregistrement puis faire remonter les constats :

```bash
spec-kitty retrospect summary
spec-kitty agent retrospect synthesize --mission identite-roles-double-validation-01M4DNDN   # dry-run
```
