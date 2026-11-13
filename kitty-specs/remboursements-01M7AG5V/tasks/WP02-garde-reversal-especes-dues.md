---
work_package_id: WP02
title: Garde du REVERSAL et espèces dues d'un bracelet remplacé
dependencies: []
requirement_refs:
- FR-009
- FR-018
planning_base_branch: feat/remboursements
merge_target_branch: feat/remboursements
branch_strategy: Planning artifacts for this mission were generated on feat/remboursements. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/remboursements unless the human explicitly redirects the landing branch.
subtasks: [T007, T008, T009, T010, T011]
phase: Phase 1 - Base
agent: claude
history:
- timestamp: '2026-11-13T15:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
role: implementer
model: sonnet
execution_mode: code_change
authoritative_surface: apps/api/src/ledger/
owned_files: [packages/ledger-sql/migrations/0082_replace_media_cash_due.sql, packages/ledger-sql/tests/tests_replace_cash_due.sql, apps/api/src/ledger/status-matrix.ts, apps/api/src/ledger/ledger-engine.service.ts, apps/api/test/unit/ledger/status-matrix*.spec.ts, apps/api/test/integration/ledger/refund-reversal-matrix.spec.ts]
create_intent: [packages/ledger-sql/migrations/0082_replace_media_cash_due.sql, packages/ledger-sql/tests/tests_replace_cash_due.sql, apps/api/test/unit/ledger/status-matrix-refund-reversal.spec.ts, apps/api/test/integration/ledger/refund-reversal-matrix.spec.ts]
tags: []
tracker_refs: []
---

# Work Package Prompt: WP02 : Garde du REVERSAL et espèces dues d'un bracelet remplacé

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer / Agent :
claude). Lis ensuite la fiche commune `docs/passation-9a/fiche-implementation.md`, ce prompt, puis seulement :

- `contracts/interfaces.md` : sections « Répartition des fichiers » (ligne WP02) et « Noms figés » ;
- `research.md` : « État des lieux » (`post_transaction`, matrice, l. 19-30), R-03, R-09 ; `spec.md` FR-009 (l. 175),
  FR-018 (l. 184) ; `contexte-9a.md` décision 5 ;
- `packages/ledger-sql/migrations/0060_edge_sync_registry.sql` l. 319-440 : `post_transaction`, À LIRE SEULEMENT (garde
  `LOCKED` l. 374-378) ; `migrations/0033_payments.sql` l. 100-105 (index `journal_transaction_reverses_once`) ;
- `schema_grand_livre_cashless.sql` l. 842-878 (`anomaly`, `anomaly_cash_due_guard`), l. 1399-1441 (`replace_media`), l.
  1880-1925 (`refund_cash_due`) ; `migrations/0021_definer_search_path.sql` l. 20-24 (tout `CREATE OR REPLACE` d'une
  fonction SECURITY DEFINER fixe `search_path = public, pg_temp`) ;
- `apps/api/src/ledger/status-matrix.ts` en entier (156 l.), `test/unit/status-matrix.spec.ts` (matrice exhaustive),
  `apps/api/src/ledger/ledger-engine.service.ts` l. 140-190, 280-295 et 399-413 (`checkStatus`) ;
- `test/integration/engine/{engine.spec.ts,mini-fixture.ts}` et `test/integration/reversals/reversal-fixtures.ts`
  (montage d'un moteur sur base réelle) ; pgTAP : `tests/tests_cash_sessions.sql` l. 100-115 et 507-535.

Priorité des sources (SPECIFICATION §0.3). Contradiction : tu la signales. `interfaces.md` fait foi.

## Objective

(1) Un paiement échoué doit pouvoir recréditer le festivalier : le moteur accepte le `REVERSAL` d'un `WALLET_REFUND` de
source `BACKOFFICE` partout où `WALLET_REFUND` est accepté, et rien d'autre (décision 5, ADR-189). (2) `replace_media`
fait suivre au bracelet neuf les espèces dues encore ouvertes de l'ancien : rendues une fois et une seule (OP-N55,
FR-018). Aucun `GRANT`, aucune fonction nouvelle, et `post_transaction` n'est PAS modifiée.

## Branch Strategy

- Branche de planification et de fusion : `feat/remboursements`.
- Worktree alloué par lane, calculé dans `lanes.json`.
- Commande : `LC_ALL=C LANG=C spec-kitty agent action implement WP02 --agent claude --mission remboursements-01M7AG5V`.

## Périmètre et arbitrages

- **Fait de code.** `post_transaction` n'applique pas la matrice par statut d'événement : la base ne lit que
  `ledger.status`. Un `REVERSAL` y passe déjà tant que le grand livre n'est pas `LOCKED`. Le refus des états de
  l'événement est celui du moteur. Décision de l'orchestrateur : l'élargissement se fait dans le moteur seulement ;
  aucune branche `LOCKED` (après verrouillage, ce sont les réclamations tardives, mission 9b, R-03) et aucun changement
  de `post_transaction`. Ne la redéfinis pas.
- WP02 possède désormais `ledger-engine.service.ts` (WP06 ne le touche plus) : garde le diff limité à `checkStatus` et à
  la lecture du type contre-passé.
- Migration `0082_replace_media_cash_due.sql` : `replace_media` seulement. `CREATE OR REPLACE` garde les droits ; fixe
  `SET search_path = public, pg_temp` (la version du schéma n'a que `public`). Aucune fonction nouvelle : elle recevrait
  `EXECUTE` de `cashless_app` (`roles.sql:44`) et casserait la liste figée de `tests_execute_grants.sql` (WP01).

## T007 : moteur, `checkStatus` reçoit le type de la transaction contre-passée

- Dans `writeLines`, pour un `REVERSAL`, lis avant `checkStatus` le `type` de la transaction `reversesId` (`SELECT type
  FROM journal_transaction WHERE id = $1 AND ledger_id = $2`, sous RLS du client) et passe-le comme `reversesType` à
  `isAccepted`. Introuvable : ne rien passer (la lecture de `readOriginalLines` refuse ensuite ; ce n'est pas un
  contournement). Les deux appels de `checkStatus` (l. 146 et 189) et celui de la l. 290 restent cohérents.
- Le résultat : un `REVERSAL` de source `BACKOFFICE` d'un `WALLET_REFUND` est accepté exactement quand `WALLET_REFUND`
  l'est (T008). Rien d'autre ne change : autre source, autre type contre-passé, autre état : verdict actuel.
- La double contre-passation reste refusée par `journal_transaction_reverses_once` (`23505`, traduit par le moteur
  existant) ; ne la contourne pas.

## T008 : `status-matrix.ts` et tests unitaires

- Ajoute `reversesType?: TransactionType` à `StatusCheckInput`. Dans `isAccepted` : `REVERSAL`, source `BACKOFFICE`,
  `reversesType === 'WALLET_REFUND'` : verdict de `WALLET_REFUND` pour les mêmes `eventStatus`, `ledgerStatus`, `source`
  (réutilise la règle, ne duplique aucune cellule). Sinon règle actuelle inchangée.
- Sans `reversesType`, comportement strictement actuel : `test/unit/status-matrix.spec.ts` passe sans modification.
- Nouveau `test/unit/ledger/status-matrix-refund-reversal.spec.ts` : propriété d'équivalence sur statut d'événement ×
  statut de grand livre × source ; acceptations (`SETTLING`, `REFUND_WINDOW`, `RECONCILING`, `CLOSING`, `CLOSED` grand
  livre `CLOSING`) ; refus (`DRAFT`, `CLOSED` grand livre `LOCKED` hors `BACKOFFICE`, `reversesType` `PURCHASE` en
  `SETTLING` et `REFUND_WINDOW`, toute source autre que `BACKOFFICE` en `SETTLING`) ; `RECONCILING` : `REVERSAL`
  synchronisé toujours accepté, `reversesType` ignoré.

## T009 : `replace_media` réattribue les espèces dues (0082)

- Reprends `replace_media` de `schema_grand_livre_cashless.sql:1399-1441` mot pour mot, avec `CREATE OR REPLACE` et le
  `search_path` fixé. Ajoute une seule instruction avec les autres mises à jour du bracelet neuf : `UPDATE anomaly SET
  media_id = p_new WHERE media_id = p_old AND kind = 'CASH_TOPUP_OVER_LIMIT' AND status = 'OPEN' AND operator_id =
  o.operator_id`.
- Ne touche pas à `status` : `anomaly_cash_due_guard` est `BEFORE UPDATE OF status`, il ne se déclenche pas et reste le
  seul chemin de clôture. Les anomalies `RESOLVED` et d'autres natures restent sur l'ancien bracelet.
- Aucune écriture comptable : `L-ESP-A-RENDRE` ne bouge pas. Un second remplacement (A → B → C) fait suivre les
  anomalies ouvertes de B. `replace_media` et `refund_cash_due` prennent le même verrou de ligne du bracelet : ne
  l'ajoute pas ailleurs.
- Après remplacement, `refund_cash_due(ancien)` échoue (`CL020`) et `refund_cash_due(neuf)` rend la somme, une fois.

## T010 : tests du moteur (unitaire et intégration)

Le fichier unitaire est celui de T008. Nouveau `test/integration/ledger/refund-reversal-matrix.spec.ts`, sur base réelle
(montage des fixtures du moteur) : un `WALLET_REFUND` de source `BACKOFFICE`, puis son `REVERSAL` (clé `bo:…`, lignes
inverses) :

- accepté avec l'événement en `SETTLING`, `REFUND_WINDOW`, `CLOSED` (grand livre `CLOSING`) et `CLOSING` ; solde du
  portefeuille recrédité, transaction équilibrée ;
- refusé : `REVERSAL` d'un `PURCHASE` avec l'événement en `SETTLING` (`VALIDATION_FAILED`) ; source autre que
  `BACKOFFICE` pour le `REVERSAL` du `WALLET_REFUND` en `SETTLING` ;
- seconde contre-passation du même `WALLET_REFUND`, autre clé : refusée par l'index existant (`ALREADY_REVERSED` ou code
  équivalent du moteur) ; même clé : rejeu, même transaction ;
- `WALLET_REFUND` en grand livre `LOCKED` : comportement inchangé (accepté `BACKOFFICE` avant `late_claims_until`,
  refusé sinon) et `REVERSAL` d'un `WALLET_REFUND` en `LOCKED` : refus de la base (`CL003`) tel qu'aujourd'hui.

## T011 : `tests/tests_replace_cash_due.sql`

pgTAP écrit à la main (en-tête : `tests_customer_auth.sql`).

- Monte deux bracelets du même lot (ancien `ACTIVE` avec portefeuille, neuf `PERSONALIZED`), une recharge espèces
  découpée (400 dus) et `open_cash_due_anomaly` (modèle `tests_cash_sessions.sql:507-535`).
- Après `replace_media(ancien, neuf)` : l'anomalie `OPEN` porte le `media_id` du neuf, même montant ; l'ancien n'a plus
  d'anomalie ouverte ; `refund_cash_due(ancien, …)` : `CL020` ; `refund_cash_due(neuf, …)` : une écriture
  `WALLET_REFUND` de 400, anomalie `RESOLVED`, `resolution_tx_id` posé ; autre clé : `CL020` ; même clé : même
  transaction ; solde de `L-ESP-A-RENDRE` nul.
- Reste en place : anomalie `RESOLVED` et anomalie d'une autre nature (`PSP_TOPUP_OVER_LIMIT`) sur l'ancien ;
  remplacement en chaîne A → B → C ; anomalie d'un autre prestataire intacte ; `cashless_app` ne peut ni clore
  l'anomalie à la main (`CL020`) ni modifier `media_id` (`42501`) ; `replace_media` sous `cashless_app` refuse un
  bracelet d'un autre prestataire (`assert_tenant`) ; `search_path` fixé ; droits d'`EXECUTE` inchangés.

## Tests et preuves

Depuis la lane (`cd <lane> || exit 1`), base `cashless_wp02`, serveur 5433 (vérifie `docker ps`) :

```bash
export PGHOST=127.0.0.1 PGPORT=5433 PGUSER=postgres PGDATABASE=cashless_wp02
R=/Users/xaamga/Documents/omar_sylla_work/cashless/cashless-platform
export PATH=$R/docs/passation-9a/scripts/bin:/Library/PostgreSQL/18/bin:$PATH
bash packages/ledger-sql/scripts/reset-db.sh
cd packages/ledger-sql
pg_prove -d cashless_wp02 tests/tests_replace_cash_due.sql tests/tests_definer_search_path.sql \
  tests/tests_execute_grants.sql tests/tests_cash_sessions.sql tests/tests_media_api.sql
pg_prove -d cashless_wp02 tests_grand_livre_cashless.sql scenario_reference_test.sql
ext() { sed -n '/^CREATE \(OR REPLACE \)\?FUNCTION replace_media(/,/^END \$\$;/p' "$1"; }
diff <(ext schema_grand_livre_cashless.sql) <(ext migrations/0082_replace_media_cash_due.sql)  # search_path, UPDATE
git diff --stat -- migrations/0060_edge_sync_registry.sql   # vide : post_transaction non touchée
cd ../../apps/api && export PGDATABASE=cashless_wp02 && source ../../tools/dev-db/env.sh
env | grep DATABASE_URL        # toutes les URL visent cashless_wp02
SKIP_LATENCY=1 npx jest test/unit/status-matrix.spec.ts test/unit/ledger test/integration/ledger \
  test/integration/reversals test/integration/engine --runInBand --forceExit
```

Après le Jest, refais `reset-db`. Preuves : FR-009 (T008, T010), FR-018 (T011), diff limité, suites générées inchangées.

## Definition of Done

- [ ] `0082_replace_media_cash_due.sql` : seulement `replace_media`, identique au schéma hors `search_path` et la ligne
      `UPDATE anomaly` ; aucun `GRANT` ; `post_transaction` et `0060` intacts.
- [ ] `status-matrix.ts` et `checkStatus` : règle déléguée à `WALLET_REFUND`, `reversesType` lu par le moteur ; ancien
      test de matrice inchangé et vert ; nouveaux tests unitaire et d'intégration verts.
- [ ] `tests_replace_cash_due.sql` couvre T011 ; suites de droits, `search_path` et générées vertes.
- [ ] Preuves (critère → commande → résultat) notées à la fin de `docs/passation-9a/suivi-lots.md`.
- [ ] Compte rendu : écart au plan (aucune garde en base, élargissement dans le moteur), fichiers à relire.

## Ce que le relecteur doit casser

- Un autre `REVERSAL` qui passe : celui d'un `PURCHASE` ou d'un `TOPUP` en `SETTLING` ; source `ONLINE`, `OFFLINE_SYNC`,
  `EDGE_SYNC`, `PSP_WEBHOOK`, `BATCH` ; `reversesId` d'un `WALLET_REFUND` d'un autre grand livre ou prestataire ;
  `reversesId` introuvable ; `REVERSAL` en `DRAFT`.
- Double contre-passation : deux appels concurrents, clés différentes ; même clé, contenu différent.
- `post_transaction` ou `0060` touchés ; un `REVERSAL` accepté en `LOCKED` ; règle copiée au lieu de déléguée (deux
  sources de vérité) ; `reversesType` absent qui change un verdict ; diff du moteur au-delà de `checkStatus` et de la
  lecture du type.
- `replace_media` : anomalie d'un autre prestataire déplacée ; anomalie `RESOLVED` ou d'une autre nature déplacée ;
  `status` modifié ; espèces dues rendues deux fois (ancien puis neuf, ou neuf deux fois) ; remplacement concurrent d'un
  rendu en cours ; `search_path` sans `pg_temp`.
- Droit nouveau : `GRANT` dans la migration, fonction nouvelle exécutable par `cashless_app`, `UPDATE (media_id)`
  ouvert.

## Fichiers à faire relire par une personne

- `packages/ledger-sql/migrations/0082_replace_media_cash_due.sql` (`replace_media`, SECURITY DEFINER).
- `apps/api/src/ledger/status-matrix.ts` et `checkStatus` dans `ledger-engine.service.ts` (cœur du moteur d'écritures).
