---
affected_files: []
cycle_number: 1
mission_slug: hors-ligne-snapshots-lots-01M645RN
reproduction_command:
reviewed_at: '2026-11-04T23:26:56Z'
reviewer_agent: claude
wp_id: WP21
---

**Issue 1 (bloquant)** : `end-to-end/offline-isolation` est rouge dans la passe parallèle de la CI (`SKIP_LATENCY=1 npm test`) : `digest()` interroge en propriétaire (la RLS ne filtre pas), l'empreinte « par prestataire » couvre toute la base. Reproduit : 8 échecs avec `SKIP_LATENCY=1 npx jest end-to-end/offline-isolation test/integration/offline/processing test/integration/offline/batches --maxWorkers=4`. Corriger en filtrant chaque requête de l'empreinte par `operator_id` (ou ledger/device du prestataire) ; à défaut, ajouter la suite à `SKIP_LATENCY` et à l'étape « suites seules » de `ledger-tests.yml`.

**Issue 2 (bloquant)** : `npm run lint` échoue (5 erreurs), l'étape de lint de la CI précède les tests : `apps/api/test/support/offline-dataset.ts:508` (any, WP21) ; hérités `src/offline/processing/offline-operation.processor.ts:335` (`opts` inutilisé), `src/offline/seq/seq-gap.service.ts:10` (import inutilisé), `test/integration/offline/processing-reversal-clock.spec.ts:41` (any), `test/integration/snapshots-content/cadence.spec.ts:261` (`kill` inutilisé). Corriger les cinq sans changer la logique.

**Issue 3 (bloquant)** : la garde `assertProcessing` de la partie J n'est prouvée par aucun test : retirer les deux appels du processeur (A1) ou rendre la garde du runner sans effet (A2) laisse 312 tests verts. Ajouter un test d'intégration : lot dont le statut passe à `REJECTED ABANDONED` après l'opération k (processeur factice puis vrai processeur) ; `abandoned: true`, aucune opération > k écrite (journal, registre).

Non bloquants (voir docs/passation-7/rapports/WP21-review-cycle-1.md) : titres SC décalés (spec : SC-007 secrets, SC-008 production, SC-011 isolation), FR-036 à citer sur processing.spec.ts:106, FR-042 preuve par commande, FR-024 intégration mince, ligne OP-N98 du tableau de POINTS_OUVERTS, ADR pour migrations 0052/0054-0057, course bénigne du signataire.
