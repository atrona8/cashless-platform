---
work_package_id: WP09
title: Import et rapprochement des relevés (API)
dependencies: [WP01, WP06]
requirement_refs: [FR-013, FR-014, FR-015, FR-024, NFR-003]
planning_base_branch: feat/versements-rapprochements-cloture
merge_target_branch: feat/versements-rapprochements-cloture
branch_strategy: Planning artifacts for this mission were generated on feat/versements-rapprochements-cloture. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/versements-rapprochements-cloture unless the human explicitly redirects the landing branch.
subtasks: [T040, T041, T042]
phase: Phase 3 - Services et routes
agent: claude
history:
- timestamp: '2026-11-17T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/reconciliation/
create_intent: [apps/api/src/reconciliation/reconciliation.module.ts, apps/api/src/reconciliation/statements.controller.ts, apps/api/src/reconciliation/reconciliation.controller.ts, apps/api/src/reconciliation/statements.service.ts, apps/api/src/reconciliation/reconciliation.service.ts, apps/api/src/reconciliation/statements.dto.ts, apps/api/test/integration/reconciliation/import-statement.spec.ts, apps/api/test/integration/reconciliation/statement-lines.spec.ts, apps/api/test/integration/reconciliation/match-statement-line.spec.ts, apps/api/test/integration/reconciliation/reconciliation-state.spec.ts, apps/api/test/integration/reconciliation/statement-import-latency.spec.ts]
execution_mode: code_change
model: sonnet
owned_files: [apps/api/src/reconciliation/**, apps/api/test/integration/reconciliation/**]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP09 : Import et rapprochement des relevés (API)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis `docs/passation-9b/fiche-implementation.md` (démarrage, base
`cashless_wp09`, Jest, fin de lot), ce prompt, puis seulement :

- `docs/passation-9b/contexte-9b.md` : décision 3 (relevés en CSV, rapprochement automatique puis
  manuel) ;
- `contracts/interfaces.md` : `import_statement_lines`, `match_statement_line`,
  `account_reconciliation`, `Csv` ;
- `contracts/contract-additions.md` : routes 10 à 13, schémas `StatementImportResult`,
  `StatementLine`, `StatementLineMatch`, `AccountReconciliation` ;
- `research.md` R-08 ; `data-model.md` : `statement_import`, `external_statement_line`, invariant 4
  ;
- `packages/contracts/openapi.yaml` de ta base (WP01) : routes 10 à 13 et leurs schémas ;
- `packages/ledger-sql/migrations/0083_statements.sql` de ta base : forme des `jsonb` des deux
  fonctions, SQLSTATE levés, colonnes de `account_reconciliation` ;
- code : `media/batches/csv-body.middleware.ts` l. 1-31 (corps `text/csv`, 1 Mo, lu AVANT
  l'idempotence) et `media/batches/batches.controller.ts` l. 214-230 (route qui le consomme) ;
  `common/csv.ts` (WP01) ; `events/status/status.controller.ts` l. 28-95 (`TenantAccess`,
  `canReadEvent`, `settingRolesOn`) ; `schema_grand_livre_cashless.sql` l. 880-890
  (`external_statement_line`), l. 913-930 (`trial_balance`, `trial_balance_at`) ;
  `test/integration/topups/psp-fixtures.ts` et `chargebacks/chargeback-fixtures.ts`.

Priorité des sources (SPECIFICATION §0.3). Contradiction : tu la signales. `interfaces.md` fait foi
sur ce prompt.

## Objective

Servir les routes 10 à 13 : importer en CSV le relevé d'un compte d'argent, rapprocher les lignes
(automatique par les tables sources, puis à la main), lire les lignes et l'état par compte. Toute
écriture passe par `import_statement_lines` et `match_statement_line` (WP02, `cashless_app` n'a plus
que `SELECT`). Ce lot ne calcule rien de comptable : il valide, appelle la base, présente.
`PSP_RECONCILED` se calcule en base (WP02) ; son texte et sa route sont à WP07.

## Branch Strategy

- Branche de planification et de fusion : `feat/versements-rapprochements-cloture`.
- Worktree alloué par lane, calculé dans `lanes.json`.
- Commande :

  ```bash
  LC_ALL=C LANG=C spec-kitty agent action implement WP09 --agent claude \
    --mission versements-rapprochements-cloture-01M7JT4G
  ```

## Périmètre et arbitrages

- Hors lot : migrations (WP02), droits (WP06), `csv.ts` (WP01), condition `PSP_RECONCILED` et ses
  textes (WP07), route de statut. Aucun SQL, aucune dépendance, aucune route hors
  `contract-additions.md`.
- Une ligne d'import dans `app.module.ts` (`ReconciliationModule`), hors carte, signalée dans la
  note de lane (WP07 possède le fichier ; union à la consolidation).
- `AuditAction` : ajouts en fin d'union (`STATEMENT_IMPORTED`, `STATEMENT_LINE_MATCHED`), une ligne
  par valeur.
- Corps `text/csv` : réutilise `CsvBodyMiddleware` de `media/batches/` (ne le copie pas, ne le
  modifie pas ; limite de 1 Mo, soit bien plus que 10 000 lignes). Fichier trop gros : `400`.
- Séparateur : le format est `external_ref;value_date;amount;currency` (point-virgule). `Csv` de
  WP01 est décrit « RFC 4180 » : vérifie qu'il admet le séparateur `;`. Sinon ne le modifie pas :
  signale-le à l'orchestrateur.
- **Signe des montants (fixé ici, à documenter dans le DTO et dans la réponse d'erreur)** : le signe
  est celui du compte d'argent dans le grand livre (`posting.amount` : débit positif). Positif =
  argent ENTRÉ sur le compte (recharge, versement reçu) ; négatif = argent SORTI (remboursement,
  versement). Le solde de clôture suit la même convention (positif = argent détenu, comme
  `trial_balance.signed_balance` d'un compte `ASSET`). Montants entiers en unité mineure, jamais
  zéro.
- Hors rapprochement : un rapprochement posé ne se défait pas en 9b (data-model). Aucune route de
  défaisage.

## Subtasks

### T040 : route 10 `importAccountStatement`

- `POST /ledgers/{ledger_id}/accounts/{account_id}/statements`, `@HttpCode(201)`, `@Idempotent({
  scope: 'bo:' })`, corps `text/csv`, paramètres `source`, `statement_date`, `closing_balance`.
  Rôles ORGANIZER_ADMIN et OPERATOR_ADMIN, avec `settingRolesOn` non vide sur l'organisateur de
  l'événement.
- Valide AVANT d'appeler la base : `statement_date` ISO ; `closing_balance` entier signé ; en-tête
  du CSV exact ; chaque ligne : `external_ref` non vide (255 car. au plus, sans retour à la ligne),
  `value_date` ISO, `amount` entier non nul, `currency` = devise du grand livre (autre devise : `422
  VALIDATION_FAILED`, rien écrit). Une ligne invalide fait refuser TOUT le fichier avec le numéro de
  ligne.
- Compte : doit appartenir au grand livre, de famille `ASSET`, du même prestataire. Sinon `404`
  (autre prestataire) ou `422` (compte du grand livre mais pas d'argent). Ne te fie pas à ce
  contrôle : la garde de portée de la base (WP02) est la vraie ; traduis son refus.
- Appelle `import_statement_lines(import jsonb, lines jsonb)` UNE fois pour tout le fichier (pas une
  requête par ligne : NFR-003). Empreinte `file_sha256` calculée par `node:crypto`. Réimport du même
  fichier ou de lignes déjà présentes : aucune ligne en double, `lines_existing` rendu,
  `lines_created` à 0.
- Réponse `StatementImportResult` : créées, rapprochées automatiquement, déjà présentes. Audit
  `STATEMENT_IMPORTED` (compte, empreinte, compteurs ; jamais le contenu du relevé).

### T041 : routes 11, 12, 13

- Route 11 `GET /ledgers/{ledger_id}/statement-lines` : page de `StatementLine` (`Cursor`, `Limit`,
  `PageMeta`, comme `listRefundRequests`), filtres `account_id`, `matched` (booléen strict, autre
  valeur : `400`). Une requête par page, tri stable (date de valeur puis `id`). Aucune ligne d'un
  autre grand livre ou prestataire.
- Route 12 `POST /statement-lines/{statement_line_id}/match`, `@Idempotent({ scope: 'bo:' })`, corps
  `{transaction_id}` OU `{anomaly_id}` (les deux, aucun ou champ étranger : `400`). Appelle
  `match_statement_line(line, tx, anomaly, actor)`. Refus : ligne inconnue ou d'un autre prestataire
  `404` ; déjà rapprochée `409 CONFLICT_STATE` ; transaction d'un autre grand livre ou ne touchant
  pas ce compte `422 VALIDATION_FAILED`. Traduis les SQLSTATE levés par `0083` ; un code sans
  traduction : signale-le. Audit `STATEMENT_LINE_MATCHED`. Réponse `200 StatementLine`.
- Route 13 `GET /ledgers/{ledger_id}/reconciliation` (ORGANIZER_ADMIN, OPERATOR_ADMIN, SUPERVISOR) :
  rend `account_reconciliation(ledger)` : par compte d'argent, nombre de lignes, non rapprochées,
  solde du relevé, solde du grand livre à la date du relevé, rapproché oui ou non, et les anomalies
  PSP qui expliquent l'écart (FR-015, OP-N82 : `PSP_TOPUP_OVER_LIMIT`, `PSP_TOPUP_NOT_CREDITED`,
  `PSP_MISMATCH`). Un compte sans relevé : listé, `reconciled: false`, jamais omis.

### T042 : tests et mesure

Voir « Tests et preuves ». La suite de latence est un fichier à part, écarté par `SKIP_LATENCY`
(modèle : `const latency = process.env.SKIP_LATENCY ? it.skip : it;`,
`topups/cash-topup.spec.ts:294`).

## Tests et preuves

```bash
cd <lane>/apps/api
export PGDATABASE=cashless_wp09; source ../../tools/dev-db/env.sh; env | grep DATABASE_URL
SKIP_LATENCY=1 npx jest test/integration/reconciliation --runInBand --forceExit
npm run typecheck -w @cashless/api
# NFR-003, SEULE, sans SKIP_LATENCY :
npx jest test/integration/reconciliation/statement-import-latency.spec.ts --runInBand --forceExit
```

La base doit porter les migrations `0083` à `0088` et la section 12 de `post-roles.sql` (reset-db
depuis ta lane). Cas exigés (chacun nomme son FR ou NFR) :

- FR-013, SC-003 : relevé de 10 lignes dont 8 portent une référence connue : 8 rapprochées
  automatiquement, 2 non ; réimport du même fichier puis d'un fichier qui recouvre : aucun doublon ;
  devise étrangère, en-tête faux, ligne invalide, montant nul : `422`/`400`, rien d'écrit ; compte
  d'un autre prestataire : `404` ; compte non `ASSET` : `422` ; fichier de plus de 1 Mo : `400`.
- FR-014 : les quatre sources automatiques : `psp_topup.provider_payment_ref`,
  `psp_chargeback.provider_dispute_id`, `refund_request.external_reference`, `payout.external_ref`
  (jamais par analyse d'`idempotency_key`) ; rapprochement manuel d'une ligne restante ; refus :
  double rapprochement, autre grand livre, transaction qui ne touche pas le compte,
  `{transaction_id, anomaly_id}` ensemble.
- FR-015, OP-N82 : un paiement non crédité (`PSP_TOPUP_NOT_CREDITED`) présent au relevé : ligne
  rapprochée à l'anomalie, compte `reconciled` avec l'explication ; sans cela l'écart reste non
  expliqué.
- Compte rapproché : toutes ses lignes rapprochées ET solde du relevé = solde du grand livre à la
  date. Un seul de ces deux manques suffit à rendre `reconciled: false`. Lis
  `event_transition_conditions` (SQL, pas la route de statut) : `PSP_RECONCILED` passe à `true`
  quand tous les `A-PSP-*` sont rapprochés.
- Isolation : prestataire B ne voit ni ne rapproche rien de A ; `SUPERVISOR` : `403` sur 10 et 12,
  `200` sur 13 ; `CASHIER` : `403` partout.
- FR-024 : une ligne d'audit par import et par rapprochement, auteur correct, sans contenu de
  relevé.
- Signe : une recharge reçue (positif) et un remboursement sorti (négatif) se rapprochent sur le
  même compte ; un montant de signe contraire à la transaction n'est jamais rapproché
  automatiquement.
- NFR-003 (mesure, suite isolée) : 10 000 lignes importées et rapprochées automatiquement en moins
  de 60 s. Écris la durée mesurée dans le compte rendu.

## Definition of Done

- [ ] Routes 10 à 13 servies, rôles et portée contrôlés ; une seule requête SQL d'import pour tout
  le fichier.
- [ ] Signe des montants et format documentés dans le DTO ; en-tête et lignes validés avant la base.
- [ ] Aucun SQL, aucune dépendance, aucune écriture hors des deux fonctions de WP02.
- [ ] Rapprochement automatique par les quatre tables sources ; manuel contrôlé ; anomalies
  représentées.
- [ ] Tests verts sur `cashless_wp09` ; mesure NFR-003 faite seule ; typecheck et Prettier (100
  caractères) verts.
- [ ] Compte rendu : retouches hors carte (`app.module.ts`, `AuditAction`), séparateur `;` et `Csv`,
  durée mesurée, écarts au plan (renforce / affaiblit).

## Ce que le relecteur doit casser

1. Importer un relevé sur `A-CAISSE-1` ou un compte de droits (`L-*`) : refusé, rien d'écrit.
2. Importer sur le compte d'un autre prestataire, ou avec le `ledger_id` d'un autre événement :
   `404`/`422`.
3. Même fichier importé deux fois avec deux clés d'idempotence : aucune ligne en double ; 20 imports
   simultanés : un seul jeu de lignes, aucun `500`.
4. Ligne dont `external_ref` collisionne avec celle d'un autre compte de la même source :
   comportement défini et testé (l'ancienne `UNIQUE (source, external_ref)` est gardée par la base :
   dis ce que tu observes).
5. Rapprocher une ligne à la transaction d'un autre prestataire, d'un autre compte, ou deux fois :
   refusé.
6. Corps avec formule (`=1+1`), guillemets, retours à la ligne, BOM UTF-8, `\r\n` : lu correctement,
   jamais exécuté.
7. Montant de relevé de signe contraire à celui du grand livre : jamais rapproché automatiquement.
8. `GET .../reconciliation` pendant un import concurrent : jamais un état à moitié écrit (lecture
   cohérente).
9. `PSP_RECONCILED` : un compte avec solde de relevé différent d'un centime reste non rapproché.
10. Une ligne d'audit ou une réponse d'erreur qui recopie le contenu du fichier : constat bloquant.

## Fichiers à faire relire par une personne

- `reconciliation/statements.service.ts` (validation du fichier avant la base, portée, signe des
  montants) ;
- `reconciliation/statements.controller.ts` (rôles, portée, corps `text/csv` lu avant
  l'idempotence).
