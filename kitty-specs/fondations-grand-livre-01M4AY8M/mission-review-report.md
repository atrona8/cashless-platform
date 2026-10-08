# Mission Review Report: fondations-grand-livre-01M4AY8M

**Reviewer**: claude (revue post-merge, skill `spec-kitty-mission-review`)
**Date**: 2026-10-08
**Mission**: `fondations-grand-livre-01M4AY8M` — Fondations du grand livre et de l'API
**Baseline commit**: `0da7343` (`baseline_merge_commit` de `meta.json`, juste avant le squash merge `ff0cf25`)
**HEAD at review**: `016a995` (poussé sur `origin/feat/fondations-grand-livre`)
**WPs reviewed**: WP01..WP14 (14/14 `done`)

---

## Gate Results

Les portes 1 à 3 du skill visent le dépôt Spec Kitty lui-même (`tests/contract/`, `tests/architectural/`, dépôt
e2e inter-dépôts). Ce projet n'a pas ces dossiers ; leurs équivalents propres au projet ont été exécutés.

### Gate 1 — Contract tests
- Commande équivalente : `npm run check -w @cashless/contracts` (types générés = `openapi.yaml`) et
  `npm run check:generated -w @cashless/ledger-sql` (suites pgTAP = générateurs).
- Exit code : 0 (local et GitHub Actions run 37771506938).
- Result : PASS

### Gate 2 — Architectural tests
- Commande équivalente : `apps/api/test/unit/architecture.spec.ts` (seul `db/` touche `pg` et le pool ; aucun
  `SET app.`) et la section « architecture du moteur » d'`engine.spec.ts` (aucun `INSERT` direct dans
  `journal_transaction`/`posting` ; `post_transaction(` seulement sous `ledger/`), dans `npm test`.
- Exit code : 0. Result : PASS

### Gate 3 — Cross-repo E2E
- Non applicable : dépôt unique, aucun comportement inter-dépôts. Équivalent de bout en bout : le job CI
  `ledger-tests` sur GitHub (PostgreSQL 17 réel, migrations, 505 assertions pgTAP, 505 tests Jest dont le rejeu du
  scénario) — run 37771506938, toutes étapes vertes.
- Result : PASS (équivalent) ; aucun `mission-exception.md` nécessaire.

### Gate 4 — Issue Matrix
- `issue-matrix.json` absent : `spec.md` ne référence aucune issue GitHub. Rows : 0. Result : PASS (non applicable).

---

## FR Coverage Matrix

| FR | Description | WP | Test(s) | Adequacy | Finding |
|---|---|---|---|---|---|
| FR-001 | Monorepo npm workspaces, aucun V2 | WP01 | lint/typecheck sur 3 workspaces ; `smoke.spec.ts` | ADEQUATE | — |
| FR-002 | Migrations versionnées, 0001 = schéma de référence, puis `roles.sql` | WP03 | `npm run migrate` en CI ; somme de contrôle sur le contenu inclus | ADEQUATE | — |
| FR-003 | pgTAP local sans admin ni Docker | WP02 | `tools/dev-db` exercé à chaque passage local (505 assertions) | ADEQUATE | — |
| FR-004 | pgTAP en CI sous PG 17 par les migrations | WP14 | Job GitHub vert | ADEQUATE | — |
| FR-005 | Garde des `.sql` générés | WP03/WP14 | `check-generated.sh` en CI | ADEQUATE | — |
| FR-006 | `cashless_app` + `set_config(…, true)` par transaction | WP10/WP11 | `isolation.spec.ts` (connexion réutilisée A puis B, `SET ROLE` sans `set_config` → 0 ligne), `architecture.spec.ts` | ADEQUATE | — |
| FR-007 | Prestataire du contexte authentifié, fournisseur remplaçable | WP10 | `idempotency.spec.ts` (401 sans prestataire) | ADEQUATE | — |
| FR-008 | problem+json par SQLSTATE, jamais le texte SQL | WP10/WP11 | `errors.spec.ts` (chaque SQLSTATE, sentinelle absente du corps et des en-têtes), `sqlstate-map.spec.ts` | ADEQUATE | — |
| FR-009 | Idempotence S21 | WP04/WP11 | 41 assertions pgTAP ; `idempotency.spec.ts` (concurrence réelle par verrou consultatif) | ADEQUATE | RISK-2 |
| FR-010 | `X-Request-Id` | WP10 | `health.spec.ts` | ADEQUATE | — |
| FR-011 | `Accept-Language` | WP10 | `health.spec.ts` ; catalogues complets testés | ADEQUATE | — |
| FR-012 | Route de santé seule publiée | WP10 | `health.spec.ts` ; route de test sous `test/` uniquement | ADEQUATE | — |
| FR-013 | 26 constructeurs, seul appelant de `post_transaction` | WP07/08/12 | `registry.spec.ts` ; tests ligne à ligne ; test d'architecture | ADEQUATE | — |
| FR-014 | 5 types délégués aux fonctions SQL | WP12 | `engine.spec.ts` (caution) ; `replay.spec.ts` T5/T7/T23/T44 | PARTIAL | DRIFT-2 |
| FR-015 | Ordre §5.4, configuration figée, identifiant rendu | WP12 | `engine.spec.ts`, `replay.spec.ts` | ADEQUATE | DRIFT-3 (écart d'ordre consigné) |
| FR-016 | Entiers, arrondi, taxe extraite une fois | WP06 | `money.spec.ts` | ADEQUATE | — |
| FR-017 | 19 cas normatifs | WP06 | `reference-cases.spec.ts` ; script Python en CI | ADEQUATE | — |
| FR-018 | Refus selon le statut, `CLOSING`/`LOCKED`, `wallet_scope = ORGANIZER` | WP09/WP12 | `status-matrix.spec.ts` ; `engine.spec.ts` (DRAFT) | PARTIAL | DRIFT-1 |
| FR-019 | `BACKOFFICE` : auteur ≠ valideur | WP08/WP12 | `engine.spec.ts` ; `errors.spec.ts` (23514 → 403) | ADEQUATE | — |
| FR-020 | Rejeu du scénario jusqu'à `CLOSED`/`LOCKED` | WP13 | `replay.spec.ts` (lignes écrites = JSON, soldes aux 2 points) | ADEQUATE | — |
| FR-021 | Second rejeu sans effet | WP13 | `replay.spec.ts` (comptes de transactions et de lignes) | ADEQUATE | — |
| FR-022 | Types générés + contrôle CI | WP05 | `check.mjs` en CI | ADEQUATE | — |
| FR-023 | Tests TS en CI sur base par migrations | WP14 | Job GitHub vert | ADEQUATE | — |
| FR-024 | Contradictions consignées | WP13 | `research.md` R-13 (C-1 à C-15) | ADEQUATE | — |

Contrôle « faux positif » : les tests d'intégration du moteur et du scénario lisent ce qui est réellement écrit en base
(`posting`, `trial_balance`) ; supprimer le moteur ou un constructeur les ferait échouer. Les tests unitaires des
constructeurs utilisent un résolveur symbolique (`scenario-lines.ts`), mais exercent le vrai code de construction ;
leur résolution réelle des comptes est couverte par le rejeu.

NFR : NFR-001/002 ✓ (rejeu) ; NFR-003 ✓ (505 = 400 + 64 + 41) ; NFR-004 ✓ ; NFR-005 lecture ✓, modification couverte
par pgTAP seulement (RISK-4) ; NFR-006 ✓ (pgTAP ~10 s, base ~10 s) ; NFR-007 ✓ (152 s local, run GitHub vert) ;
NFR-008 ✓ (`isolation.spec.ts`).

Contraintes : C-001 ✓ (pgTAP des droits + test d'architecture) ; C-002 ✓ (aucun `.sql`, `.py`, `.json` de
`packages/ledger-sql` modifié depuis la base de référence) ; C-003 ✓ ; C-004 ✓ (règle ESLint, lectures `::text`) ;
C-005/C-006/C-007 ✓ ; C-008 ✓ (pas de `packages/nfc-sdk`) ; C-009 ✓ (`openapi.yaml` inchangé) ; C-010 caduque
(remote créé, consigné R-13 C-14).

---

## Drift Findings

### DRIFT-1 : règle `wallet_scope = ORGANIZER` non traitée explicitement

**Type** : PUNTED-FR (partiel) — **Severity** : MEDIUM — **Spec reference** : FR-018, SPECIFICATION §12.1 (dernier
paragraphe)
**Evidence** : aucune occurrence de `wallet_scope` dans `apps/api/src` ni `apps/api/test`.
`ledger/db/ledger-queries.ts` (`readLedgerContext`) prend l'événement de la commande, sinon celui du grand livre
`EVENT` ; `ledger-engine.service.ts` (`ledgerContext`) refuse `VALIDATION_FAILED « événement du grand livre
introuvable »` sinon.
**Analysis** : pour un grand livre `ORGANIZER`, la matrice s'applique bien à l'`event_id` de la commande quand il est
fourni (comportement conforme par construction), mais (a) aucun test ne le prouve, et (b) une commande sans
événement sur un grand livre `ORGANIZER` (casse après `inactivity_breakage_days`, §12) est refusée, alors que §12.1
ne le prévoit pas. Sans effet dans cette mission (aucun grand livre `ORGANIZER`), à traiter avant la mission qui
introduit les portefeuilles durables.

### DRIFT-2 : variantes déléguées `refund_cash_due` et `preload_media` sans test d'intégration

**Type** : PUNTED-FR (partiel) — **Severity** : LOW — **Spec reference** : FR-014
**Evidence** : `engine.spec.ts` et `replay.spec.ts` n'appellent que `take_deposit`, `refund_deposit`,
`forfeit_deposit`. Le routage `WALLET_REFUND/CASH_DUE` et `PROMO_CREDIT/PRELOAD` n'est testé qu'en unitaire
(`registry.spec.ts`).
**Analysis** : le chemin `delegate()` pour ces deux fonctions (clé, comptes, rejeu par `before`) n'a jamais tourné
contre la base.

### DRIFT-3 : ordre du moteur différent de §5.4 tel qu'écrit dans la fiche

**Type** : LOCKED-DECISION (écart consigné) — **Severity** : LOW (accepté) — **Spec reference** : FR-015, R-13 C-9
**Evidence** : `ledger-engine.service.ts` `writeLines` : verrou et lecture de la clé avant contexte, matrice et
soldes.
**Analysis** : écart volontaire et documenté, cohérent avec `post_transaction` (idempotence avant l'état du grand
livre) et nécessaire à FR-021 après `LOCKED`. Effet de bord : un rejeu n'est pas soumis à la matrice — voulu.

---

## Risk Findings

### RISK-1 : revue des WP sans indépendance

**Type** : PROCESS — **Severity** : MEDIUM
**Evidence** : `status.events.jsonl` : les 14 passages `in_review → approved` ont le même acteur que l'implémentation
(`claude`) ; aucun cycle de rejet. Délégation explicite du porteur (mémoire « autonomie-missions »).
**Analysis** : les défauts trouvés après coup (WP10 démarrage, WP12 caution rejouée après confiscation, requêtes
chevauchantes) montrent que la revue par WP était étroite. La présente revue est la première passe transversale ;
une relecture humaine des modules `idempotency/` et `ledger/` reste recommandée.

### RISK-2 : rien n'oblige une route idempotente à écrire via `IdempotentTx`

**Type** : BOUNDARY-CONDITION — **Severity** : MEDIUM — **Location** : `apps/api/src/idempotency/idempotency.interceptor.ts`
**Trigger** : un futur contrôleur `@Idempotent` qui écrit avec `TenantTx.run` (ou appelle le moteur) au lieu de
`@IdempotentTransaction()`.
**Analysis** : la réponse est alors enregistrée par `completeAlone` **après** le COMMIT métier ; une panne entre les
deux laisse la clé `IN_PROGRESS` puis reprise, et le travail est rejoué. Le grand livre reste protégé par sa propre
clé (G5), mais pas les écritures hors grand livre. Recommandation : test d'architecture ou garde à l'exécution qui
refuse une route `@Idempotent` sans `IdempotentTx`.

### RISK-3 : rejeu moteur d'une transaction écrite sans empreinte

**Type** : BOUNDARY-CONDITION — **Severity** : LOW — **Location** : `ledger-engine.service.ts` `writeLines`
**Trigger** : clé déjà utilisée par une écriture faite hors moteur (fonction SQL déléguée, script) avec le même type.
**Analysis** : seule l'égalité de type est vérifiée ; un contenu différent est rendu comme rejeu au lieu de
`IDEMPOTENCY_KEY_REUSED`.

### RISK-4 : isolation en écriture non prouvée au niveau de l'API

**Type** : TEST-GAP — **Severity** : LOW — **Spec reference** : NFR-005 (« lisible ou modifiable »)
**Analysis** : `isolation.spec.ts` prouve la lecture ; la modification croisée n'est couverte que par les assertions
pgTAP RLS (tables du schéma et `api_idempotency`).

### RISK-5 : moteur et idempotence sans appelant de production (attendu)

**Type** : DEAD-CODE (attendu) — **Severity** : LOW
**Evidence** : `LedgerModule` n'est importé par aucun module de `src/` ; `CONFIG_RESOLVER` n'a pas d'implémentation de
production (mission 3) ; `UnauthenticatedTenantContext` refuse tout (mission 2).
**Analysis** : conforme au périmètre (FR-012, aucune route métier). À câbler par les missions 2 et 3.

### RISK-6 : corps de réponse avec `bigint`

**Type** : ERROR-PATH — **Severity** : LOW — **Location** : `idempotency.repository.ts` `complete`
**Analysis** : `JSON.stringify` lève sur un `bigint` : une future route qui rend un montant `bigint` sans sérialiseur
produira un 500 (clé relâchée). À couvrir par le sérialiseur des frontières HTTP prévu au contrat.

---

## Silent Failure Candidates

| Location | Condition | Silent result | Spec impact |
|---|---|---|---|
| `ledger/db/ledger-queries.ts` `readSignedBalances` | compte absent (portefeuille inconnu) | solde `0n` | Vente refusée `INSUFFICIENT_FUNDS` au lieu de `NOT_FOUND` ; aucune écriture fausse |
| `ledger/db/ledger-queries.ts` `readTopupHeadroom` | fonction renvoie NULL | « sans plafond » | Conforme au schéma (NULL = pas de plafond) |
| `db/tenant-tx.ts` | échec du `ROLLBACK` | ignoré, erreur d'origine relancée | Aucun |
| `idempotency.interceptor.ts` `release` | échec du relâchement | journalisé, erreur d'origine relancée | Clé reprise à l'expiration du bail (60 s) |

---

## Security Notes

| Finding | Location | Risk class | Recommendation |
|---|---|---|---|
| Aucune interpolation de donnée de requête dans le SQL ; toutes les valeurs passent en paramètres `pg` | `src/` | — | — |
| Le seul SQL dynamique (`readExisting`) interpole une constante du module | `ledger-engine.service.ts` | — | — |
| Fournisseur de prestataire par en-tête présent seulement sous `test/` ; aucun import `test/` depuis `src/` | `test/support/app.ts` | — | Garder ce contrôle dans le test d'architecture |
| Texte SQL jamais renvoyé (journalisé côté serveur avec `requestId`) | `errors/problem.filter.ts` | — | Prévoir le masquage des données personnelles dans ces journaux quand de vraies routes existeront |
| Mot de passe de `cashless_app` dans le YAML de CI (`cashless_app_ci`) | `.github/workflows/ledger-tests.yml` | Secret de test | Acceptable (base éphémère) ; ne jamais réutiliser hors CI |

---

## Final Verdict

**PASS WITH NOTES**

### Verdict rationale

Les 24 FR ont une chaîne complète spec → WP → test → code ; 22 sont couverts de façon adéquate, 2 partiellement
(FR-014, FR-018) sans effet sur le périmètre livré. Aucune décision verrouillée n'est violée en silence : l'écart
d'ordre du moteur (FR-015) est documenté et nécessaire à FR-021. Les NFR mesurables sont tenus (0 écart, second
rejeu nul, 505 assertions, pipeline sous 15 min, durées du rôle). Aucun fichier normatif ni généré n'a été modifié.
La CI est verte sur GitHub. Aucun constat CRITICAL ou HIGH.

### Open items (non-blocking)

1. DRIFT-1 : traiter et tester `wallet_scope = ORGANIZER` (commandes sans événement) avant les portefeuilles durables.
2. DRIFT-2 : tests d'intégration de `refund_cash_due` et `preload_media` via le moteur.
3. RISK-2 : garde imposant `IdempotentTx` sur les routes `@Idempotent` (à faire dès la première route métier).
4. RISK-3 : vérifier le contenu (pas seulement le type) d'une transaction existante sans empreinte.
5. RISK-6 : sérialiseur `bigint` aux frontières HTTP.
6. RISK-1 : relecture humaine des modules `idempotency/` et `ledger/`.

## Retrospective Reminder

Le `retrospective.yaml` a été capturé au merge (`kitty-specs/fondations-grand-livre-01M4AY8M/retrospective.yaml`,
commit `c01c66e`). Pour en tirer les enseignements :

- `spec-kitty retrospect summary` — vue transverse (lecture seule)
- `spec-kitty agent retrospect synthesize --mission fondations-grand-livre-01M4AY8M` — propositions (simulation)
- `… --apply` pour les appliquer
