---
affected_files: []
cycle_number: 1
mission_slug: versements-rapprochements-cloture-01M7JT4G
reproduction_command:
reviewed_at: '2026-11-17T10:16:10Z'
reviewer_agent: claude
wp_id: WP07
---

# Constats de relecture WP07 (cycle 1)

Preuves relancées sur `cashless_wp07r` : `test/unit/closing`, `test/integration/closing`, `events/status.spec.ts`
= 8 suites, 47 tests verts. Le constat 1 vient d'une sonde que j'ai écrite (supprimée ensuite).

## 1. BLOQUANT : l'étape 4 `NET_OF_REFUNDS` échoue en base (FR-005, R-04), l'aperçu annonce autre chose
`operator-fee-regularization.ts` écrit deux commandes : `OPERATOR_FEE` avec `regularization: true` (contre-passation
de la base brute), puis `OPERATOR_FEE` SANS `regularization` (frais sur la base nette, clé `...:rewrite`). Or la
matrice de statuts (`ledger/status-matrix.ts` l. 138) n'autorise en `REFUND_WINDOW` que la variante `REGULARIZATION` :
le moteur répond `422 VALIDATION_FAILED « OPERATOR_FEE accepté seulement en variante REGULARIZATION : événement
REFUND_WINDOW »`. Sonde : contrat passé en `NET_OF_REFUNDS`, scénario jusqu'à REFUND_WINDOW (remboursements 13 500) :
l'aperçu rend 405 (343 HT + 62 taxe) et les 10 exécutions rendent 422, aucune étape écrite, étape 4 bloquée donc
`CLOSED` impossible pour ce contrat. Les tests unitaires passent parce que le client est scripté et que le moteur
n'est jamais appelé ; aucun test d'intégration ne couvre `NET_OF_REFUNDS`.
Correction : le builder `OPERATOR_FEE` (`regularization`) ne sait exprimer que `-fee(bases)` ; le delta d'une règle à
min/max n'est pas de cette forme. Il faut soit étendre le builder (payload à montant explicite) soit autoriser la
réécriture en `REFUND_WINDOW` dans la matrice : deux fichiers hors carte de WP07 (`ledger/builders/closing/fees.ts`,
`ledger/status-matrix.ts`), changement de contrat interne de grand livre : à soumettre au porteur AVANT de coder.
Ajouter ensuite un test d'intégration (moteur réel, règle à minimum, 2 exécutions = 1 écriture, grand livre équilibré,
aperçu = écrit).

## 2. Mineur : tout `PREPAID` perd la ligne d'aperçu (T029, FR-005)
`pitch-fees.ts` rend `notApplicable({ lines: lines.length })` quand le total est nul : les lignes `PREPAID` avec
`pitch_fee_reference` ne sont ni dans l'aperçu ni dans `closing_step.summary`. Le prompt demande la ligne avec sa
référence. Rendre `lines` dans le résultat sans objet (et l'asserter dans le test « tous PREPAID »).

## 3. Mineur : couvertures manquantes
- `RECONCILING` avec une session `CLOSING` : la base la couvre (0084 l. 119) mais aucun test API ne le prouve.
- Casse `OPERATOR` / `LEGAL_ACCOUNT` / `NONE` : unitaire seulement (builder réel, base absente) ; pas de passage par
  le moteur en intégration.

## Écarts déclarés : jugés
Route 4 selon `RemainingBalances` (conforme au contrat et à openapi) ; `OPERATOR` = `ORGANIZER` (le builder fait déjà
ce partage ; à valider par le porteur, montant) ; 422 sur grand livre `ORGANIZER` aux sept étapes (plus strict, pas
d'affaiblissement) ; clé de verrou `closing-step:` (identique à `record_closing_step` : correct) ; `PER_MEDIA` compte
tous les supports jamais rattachés au grand livre (acceptable, à noter) ; source `BATCH` sans valideur (conforme au
prompt et au scénario) ; retouches `status.spec.ts` et `audit.service.ts` minimales, sans affaiblir les attentes.
Vérifiés sans défaut : droits `cashless_app` sur `closing_step` (UPDATE/DELETE/INSERT refusés), état lu avant calcul,
verrou, ordre et phase, `CLOSED` avant l'échéance refusé, isolation 404/403, audit sans donnée personnelle, aperçu
sans écriture (compte inchangé), `PSP_RECONCILED` lue en base.
