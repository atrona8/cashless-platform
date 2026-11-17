---
affected_files: []
cycle_number: 1
mission_slug: versements-rapprochements-cloture-01M7JT4G
reproduction_command:
reviewed_at: '2026-11-17T07:35:41Z'
reviewer_agent: user
wp_id: WP02
---

# WP02 : retour de l'orchestrateur (décision du porteur du 17/11/2026, décision 6 de contexte-9b.md)

Le code de WP02 n'est pas en cause : le porteur garde les quatre conditions (renforcements). Il faut adapter
les suites existantes, sans affaiblir aucune condition.

1. **Bloquant — suites générées rouges** (`tests_grand_livre_cashless.sql` 288-295, `scenario_reference_test.sql`
   59-64). Correction : modifier les GÉNÉRATEURS (`packages/ledger-sql/gen_tests.py`, `gen_golden.py`, et
   `scenario_reference.json` seulement si nécessaire) pour que chaque parcours pose, avant chaque passage de
   statut, ce que les conditions exigent : étapes de clôture enregistrées (`record_closing_step`, statut
   `DONE` avec les écritures du scénario, ou `NOT_APPLICABLE`), comptes PSP/banque rapprochés (relevé importé
   par `import_statement_lines` qui concorde, ou aucun mouvement), échéance de remboursement atteinte.
   Régénérer les `.sql` par les générateurs (`scripts/check-generated.sh` doit être vert) ; **jamais
   d'édition à la main d'un `.sql` généré**. Les soldes attendus (`expected.*`) ne changent pas.
2. **Bloquant — `tests_event_ledger.sql`** 43-46, 69, 72-73, 75 : même adaptation des fixtures, sans
   désactiver de déclencheur ni de condition.
3. Retouches hors carte autorisées par ce retour : `gen_tests.py`, `gen_golden.py`, `scenario_reference.json`,
   `tests_grand_livre_cashless.sql` et `scenario_reference_test.sql` (régénérés), `tests_event_ledger.sql`.
   Liste-les dans la note de lane.
4. Preuve attendue : `pg_prove` vert sur `tests_statements.sql`, `tests_closing_conditions.sql`,
   `tests_event_ledger.sql`, `tests_cash_sessions.sql`, `tests_definer_search_path.sql`,
   `tests_grand_livre_cashless.sql`, `scenario_reference_test.sql` ; `check-generated.sh` vert.
