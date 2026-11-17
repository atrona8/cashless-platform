---
work_package_id: WP13
title: Relevés des parties et export comptable
dependencies: [WP01, WP06, WP07]
requirement_refs: [FR-022, FR-023, FR-024, NFR-004, C-007]
planning_base_branch: feat/versements-rapprochements-cloture
merge_target_branch: feat/versements-rapprochements-cloture
branch_strategy: Planning artifacts for this mission were generated on feat/versements-rapprochements-cloture. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/versements-rapprochements-cloture unless the human explicitly redirects the landing branch.
subtasks: [T058, T059, T060, T061]
phase: Phase 3 - Services et routes
agent: claude
history:
- timestamp: '2026-11-17T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/statements/
create_intent:
- apps/api/src/statements/statements.module.ts
- apps/api/src/statements/party-statement.controller.ts
- apps/api/src/statements/party-statement.service.ts
- apps/api/src/statements/party-statement-scope.ts
- apps/api/src/statements/my-wallet-statement.controller.ts
- apps/api/src/statements/account-mappings.controller.ts
- apps/api/src/statements/account-mappings.service.ts
- apps/api/src/statements/accounting-export.service.ts
- apps/api/test/integration/statements/party-statement.spec.ts
- apps/api/test/integration/statements/my-wallet-statement.spec.ts
- apps/api/test/integration/statements/accounting-export.spec.ts
- apps/api/test/integration/statements/statement-latency.spec.ts
execution_mode: code_change
model: sonnet
owned_files:
- apps/api/src/statements/**
- apps/api/test/integration/statements/**
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP13 : Relevés des parties et export comptable

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis `docs/passation-9b/fiche-implementation.md` (démarrage, base
`cashless_wp13`, Jest, fin de lot), ce prompt, puis seulement :

- `docs/passation-9b/contexte-9b.md` ; `spec.md` : story 7, FR-022, FR-023, FR-024, NFR-004, C-007 ;
- `contracts/contract-additions.md` : lignes 16 à 19, schémas `PartyStatement`, `AccountMapping`,
  `AccountMappingVersion` ; `research.md` R-14 ; `data-model.md` (`account_mapping`) ;
- `packages/contracts/openapi.yaml` (écrit par WP01) : les quatre opérations et leurs schémas font
  foi sur ce prompt pour les champs ; `docs/SPECIFICATION.md` §12.3 (l. 1306-1340, relevés et
  exemple SYSCOHADA indicatif) ; `docs/POINTS_OUVERTS.md` OP-N3 ;
- les notes de lane de WP01 (`common/csv.ts`), WP05 (`account_mapping`,
  `create_account_mapping_version`, migration `0088`) et WP07 (`closing_step.summary`) ;
- code : `organization/tenant/tenant-access.ts` l. 15-60 (`actor`, `scopesHeld`, `read`) ;
  `vendors/vendors.service.ts` l. 30-52 (`merchantScope`, `assertMerchantInScope`) ;
  `customer-app/me.controller.ts` l. 55-90 et `customer-app/me.service.ts` l. 186-250 (relevé JSON
  existant, inchangé) ; `media/batches/batches.controller.ts` l. 190-205 (réponse `text/csv`) ;
  `refunds/refund-requests.controller.ts` (modèle de contrôleur de back-office) ;
- schéma : `packages/ledger-sql/schema_grand_livre_cashless.sql` l. 379-398 (`account`), `posting`,
  `journal_transaction`, `trial_balance_at` ; test modèle : `test/scenario/api-config-replay.spec.ts`
  (fixture et rejeu du scénario de référence).

Priorité des sources (SPECIFICATION §0.3). Contradiction : tu la signales. `contract-additions.md`
et `openapi.yaml` font foi sur ce prompt.

## Objective

Servir les routes 16 à 19 : relevé d'une partie (JSON paginé ou CSV) limité à son périmètre, relevé
CSV du festivalier, correspondance comptable versionnée, export comptable par entité qui signale les
types non mappés. Aucune lecture ne dépasse le périmètre de la personne ; aucun jeu SYSCOHADA
définitif n'est livré (OP-N3).

## Branch Strategy

- Branche de planification et de fusion : `feat/versements-rapprochements-cloture`.
- Worktree alloué par lane, calculé dans `lanes.json`.
- Commande : `LC_ALL=C LANG=C spec-kitty agent action implement WP13 --agent claude --mission
  versements-rapprochements-cloture-01M7JT4G`.

## Périmètre et arbitrages

- Contrat = `contract-additions.md` exactement : rien d'autre n'est ajouté, rien d'existant ne change
  (la route JSON `listMyWalletTransactions` reste telle quelle). Aucune dépendance nouvelle : CSV par
  `common/csv.ts` (WP01), jamais à la main. Aucun PDF.
- Tu ne touches ni `app.module.ts` (possédé par WP07) ni `customer-app/` : `StatementsModule` porte
  aussi le contrôleur de `/me/wallets/{wallet_id}/statement` (deux contrôleurs peuvent partager le
  préfixe `me`). **Une ligne d'import hors carte dans `app.module.ts`**, notée dans ta note de lane
  (union à la consolidation).
- Lecture seule : par le rôle applicatif, sous RLS, `SELECT` de tables existantes ; les versions de
  `account_mapping` s'écrivent par la fonction de WP05, jamais par `INSERT`. Aucune migration, aucun
  droit (WP06 les a posés). Un droit manquant : signale-le, ne le contourne pas.
- **Règle 1 de `CLAUDE.md`** : si un relevé devait lire au-delà du périmètre (autre commerçant, autre
  prestataire), c'est un écart qui affaiblit : décris-le, attends le porteur.
- Source de vérité des montants : les écritures (`posting`). `closing_step.summary` ne sert qu'à
  recouper le total d'une étape de clôture dans un test, jamais à le remplacer.
- Table de correspondance « catégorie du relevé → comptes et types de transaction » : une constante
  testée, pas du code dispersé (modèle de §12.3).

## Subtasks

### T058 : route 16 `getPartyStatement`

`GET /operators/{operator_id}/events/{event_id}/statements/{party_kind}`, paramètres `party_id`,
`format` (`json` par défaut, `csv`), `cursor`, `limit` (JSON seulement). `Idempotency-Key` sans objet
(lecture).

- Périmètre par `party_kind` et rôle, en LISTE FIGÉE (`party-statement-scope.ts`, testée) :
  `MERCHANT` : `MERCHANT_ADMIN` pour ses commerçants seulement (`merchantScope`), `ORGANIZER_ADMIN`
  pour les commerçants de ses événements, `OPERATOR_ADMIN` ; `ORGANIZER` : `ORGANIZER_ADMIN` pour son
  organisateur, `OPERATOR_ADMIN` ; `OPERATOR` : `OPERATOR_ADMIN` ; `PLATFORM` : `PLATFORM_ADMIN`.
  Mauvais rôle : `403`. Bon rôle, partie hors périmètre ou événement d'un autre prestataire : `404`
  (même réponse qu'un identifiant inconnu, aucun oracle d'existence). Si `openapi.yaml` dit autre
  chose que cette liste, `openapi.yaml` fait foi : signale l'écart.
- Contenu par partie (§12.3) : commerçant (ventes brutes, annulations, commissions, droit de place,
  versements, solde, « reste dû » après transfert de dette) ; organisateur (ventes internes,
  commissions, droits de place, frais festivaliers, casse, cautions acquises, moins frais PSP, frais du
  prestataire, crédits offerts consommés, pertes, cautions détenues) ; prestataire (frais facturés,
  part de casse, moins la redevance) ; plateforme (redevance par prestataire et par devise).
- JSON : lignes paginées (`Cursor`, `Limit`, `PageMeta`, pas de total) plus un récapitulatif.
  `format=csv` : `text/csv; charset=utf-8`, `Content-Disposition`, toutes les lignes, écrit par
  `Csv.write` (RFC 4180, anti-injection : un libellé de tiers commençant par `=`, `+`, `-` ou `@` est
  neutralisé).
- Audit de chaque relevé exporté en CSV (FR-024) : auteur, partie, événement, nombre de lignes. Jamais
  de contenu financier dans le journal.

### T059 : route 17 `getMyWalletStatement`

`GET /me/wallets/{wallet_id}/statement`, jeton de compte (`@CustomerAuth()`), `200 text/csv`. Portefeuille
inconnu ou d'un autre compte : `404`, même réponse (modèle `me.service.ts`, l. 193-200). Contenu
(§12.3, festivalier) : recharges, crédits offerts, frais, cautions, achats, remboursements, casse ;
montant signé, devise, date, libellé (nom du commerçant pour achats et annulations). Le relevé JSON
existant reste servi par la route déjà au contrat.

### T060 : routes 18 et 19, correspondance et export comptable

- `GET` et `POST /operators/{operator_id}/account-mappings` : lecture `OPERATOR_ADMIN` et
  `ORGANIZER_ADMIN` (limité à son entité), écriture `OPERATOR_ADMIN`. `POST` crée une NOUVELLE version
  par `create_account_mapping_version` (`201 AccountMappingVersion`), valide chaque ligne
  (`purpose`, type de transaction ou « tous », comptes débit et crédit) et refuse un champ inconnu.
  Aucune version n'est modifiée ni supprimée. Aucun jeu SYSCOHADA livré : les valeurs de l'exemple
  de §12.3 n'existent que dans les tests, marquées « indicatif ».
- `GET /operators/{operator_id}/accounting-exports` (`entity`, `from`, `to`) : `OPERATOR_ADMIN`, ou
  `ORGANIZER_ADMIN` pour son entité seulement. `text/csv`. Chaque ligne d'écriture reçoit ses comptes
  légaux de la version en vigueur à la date de l'écriture. Les couples (`purpose`, type) SANS
  correspondance ne sont jamais omis : ils sont listés en tête du fichier (première colonne
  `ligne` = `NON_MAPPE`, puis `ECRITURE`) et comptés dans `X-Unmapped-Count`. Le débit égale le
  crédit par entité sur la période (test). Documente ce format dans ta note de lane (WP14 le reprend).

### T061 : tests et mesure NFR-004

Voir « Tests et preuves ».

## Tests et preuves

```bash
cd <lane> && PGDATABASE=cashless_wp13 bash packages/ledger-sql/scripts/reset-db.sh
cd <lane>/apps/api && export PGDATABASE=cashless_wp13 && source ../../tools/dev-db/env.sh \
  && env | grep DATABASE_URL && SKIP_LATENCY=1 npx jest test/integration/statements \
  --runInBand --forceExit
cd <lane> && PGDATABASE=cashless_wp13 bash packages/ledger-sql/scripts/reset-db.sh
cd <lane>/apps/api && export PGDATABASE=cashless_wp13 && source ../../tools/dev-db/env.sh \
  && npx jest test/integration/statements/statement-latency.spec.ts --runInBand --forceExit
cd <lane> && npm run typecheck -w @cashless/api && npx prettier --check \
  "apps/api/src/statements/**/*.ts" "apps/api/test/integration/statements/**/*.ts"
```

Relance `reset-db` après chaque Jest. Cas exigés :

- FR-022 : scénario de référence rejoué par le moteur (fixture et `STEPS` de `test/scenario/`, ou
  fixture réduite) : le relevé de l'organisateur, ligne à ligne, égale les soldes `L-ORG-*` de
  `scenario_reference.json` (`expected.after_closing`) ; celui du prestataire (`L-OPE-*`) et de la
  plateforme (`L-PLT-*`) aussi ; celui d'un commerçant donne ventes, commission, droit de place,
  versements, solde.
- Périmètre : un `MERCHANT_ADMIN` voit son commerçant et reçoit `404` pour un autre ; un
  `ORGANIZER_ADMIN` d'un autre organisateur : `404` ; `SUPERVISOR` et `CASHIER` : `403` ; un autre
  prestataire : `404` ; festivalier : son portefeuille seulement. Liste figée des rôles par
  `party_kind` : le test échoue si elle s'élargit.
- CSV : en-têtes, guillemets, virgules et sauts de ligne dans un libellé, cellule `=1+1` neutralisée,
  UTF-8 ; JSON et CSV donnent les mêmes totaux.
- FR-023 : export avec un type non mappé : listé en tête, `X-Unmapped-Count` exact, rien d'omis ; après
  une nouvelle version de la correspondance, les écritures antérieures gardent l'ancienne ; ajout seul
  (aucun `UPDATE` ni `DELETE` possible par l'API) ; débit = crédit par entité.
- NFR-004 (suite ISOLÉE, ignorée sous `SKIP_LATENCY`) : événement de 100 000 transactions (insertion
  en masse par le propriétaire de la base, `session_replication_role = 'replica'` le temps du semis,
  puis `ANALYZE` ; reprends l'aide de semis de WP07 ou WP08 si elle existe). 20 relevés simultanés
  par partie : 95e centile sous 1 s ; affiche min, médiane, p95, max. Lance-la SEULE ; relance une
  fois si seul le p95 échoue (VM Docker lente) et note les chiffres.
- Aucune écriture au grand livre : les nombres de `journal_transaction` et de `posting` sont inchangés
  après les relevés et l'export.

## Definition of Done

- [ ] Routes 16 à 19 servies, JSON et CSV identiques en totaux, périmètre par partie testé.
- [ ] Export qui signale les non mappés (en tête et `X-Unmapped-Count`), aucun jeu SYSCOHADA livré.
- [ ] NFR-004 mesurée seule, chiffres au compte rendu.
- [ ] Tests verts sur `cashless_wp13` ; typecheck et Prettier (100) verts ; aucun `.sql` touché.
- [ ] Note de lane : ligne d'import hors carte (`app.module.ts`), format de l'export (pour la note
  aux équipes clientes de WP14), liste figée des rôles, écarts, fichiers sensibles.

## Ce que le relecteur doit casser

1. Un `MERCHANT_ADMIN` demande le relevé d'un autre commerçant du même événement, par `party_id`,
   par l'identifiant d'une participation ou par un `party_kind` détourné : `404`, jamais `403` ni des
   données.
2. Un identifiant d'événement d'un autre prestataire, un `operator_id` d'un autre prestataire : `404`.
3. Un libellé de commerçant `=HYPERLINK(...)` : neutralisé dans les deux CSV.
4. Un type de transaction sans correspondance : absent de l'export (défaut) ; export qui renvoie `200`
   sans en-tête `X-Unmapped-Count`.
5. Une version de correspondance modifiée ou supprimée (API, puis `cashless_app` direct) : refusée.
6. Un festivalier demande le relevé du portefeuille d'un autre : `404` identique à un inconnu.
7. Relevé de plus de `limit` lignes : curseur stable, aucun doublon ni trou ; CSV complet.
8. `git diff --stat` : seuls les `owned_files` et la ligne d'`app.module.ts` annoncée.

## Fichiers à faire relire par une personne

- `statements/party-statement-scope.ts` et `party-statement.service.ts` (périmètre, aucune fuite
  entre commerçants ni entre prestataires) ;
- `statements/accounting-export.service.ts` (non mappés, versions, équilibre) ;
- l'écriture CSV de `common/csv.ts` (WP01, anti-injection) telle qu'utilisée ici.
