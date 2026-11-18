---
affected_files: []
cycle_number: 2
mission_slug: versements-rapprochements-cloture-01M7JT4G
reproduction_command:
reviewed_at: '2026-11-17T07:43:39Z'
reviewer_agent: claude
wp_id: WP02
---

# WP02 : relecture 1 (relecteur distinct), verdict : changements demandés

Prouvé vert sur `cashless_wp02r` : tests_statements (79), tests_closing_conditions (75), tests_event_ledger (85),
tests_cash_sessions (174), tests_definer_search_path (14), tests_grand_livre_cashless (403), scenario_reference_test
(64) ; `scripts/check-generated.sh` vert. Générateurs : aucune assertion retirée (3 `lives_ok` reformulés + 3
`throws_ok` ajoutés, plan 400 -> 403), soldes attendus et `scenario_reference.json` inchangés, aucun déclencheur ni
condition désactivé. Aucun GRANT en migration (les GRANT vus sont dans les fichiers de test, dans la transaction).
Fonctions DEFINER : toutes avec `search_path`, aucune exécutable par PUBLIC ni par un rôle `cashless_*`.

## 1. BLOQUANT (sécurité, isolation entre prestataires) : `UNIQUE (source, external_ref)` globale
`ON CONFLICT DO NOTHING` de `import_statement_lines` s'applique à la contrainte d'origine, qui ne porte ni sur le
prestataire ni sur le compte. Reproduit : le prestataire B importe (source `wave`, ref `VICTIM-1`) ; le prestataire A
importe ensuite la même (source, ref) : `created = 0, existing = 1`, aucune ligne de A n'existe, son compte
`A-PSP-WAVE` reste non rapproché. Conséquences :
- déni de service ciblé : B peut occuper à l'avance les références (prévisibles) de A et bloquer son passage à
  SETTLING (`PSP_RECONCILED`) ; la parade (changer de `source`) n'est pas visible pour A ;
- fuite : A apprend, par `existing`, qu'une référence (source, ref) existe chez un autre prestataire.
La note du plan (data-model.md l.51) raisonne « deux événements d'un même prestataire » et ignore l'effet inter-
prestataires ; l'écart n'est consigné ni dans POINTS_OUVERTS.md ni en ADR. Correction (renforcement, à consigner
ensuite) : retirer la contrainte d'origine (`ALTER TABLE external_statement_line DROP CONSTRAINT
external_statement_line_source_external_ref_key`), garder l'index unique `(account_id, source, external_ref)` (déjà
posé) ; `ON CONFLICT (account_id, source, external_ref) DO NOTHING` explicite ; test pgTAP : B occupe (source, ref),
A importe la même et la crée (`created = 1`), et inversement. Corriger le commentaire d'en-tête de 0083 et la note.
Si le porteur préfère garder la contrainte, il faut un ADR + POINTS_OUVERTS + test qui échoue si la limite s'élargit
(règle 3) : à lui de décider, non codé en silence.

## Mineurs (consigner, ne bloquent pas)
2. Une même transaction peut être rapprochée par deux lignes (manuel, ou auto avec deux `source` différentes) :
   une ligne manquante est masquée. Pas de contrôle « transaction déjà rapprochée ».
3. `closing_balance` est déclaré, jamais recoupé avec la somme des lignes : un relevé vide au bon solde rend le compte
   rapproché (conforme à la règle écrite ; à signaler à WP07/WP09 : l'écran doit montrer lignes et solde).
4. `closing_step_scope_guard` vérifie le prestataire des transactions, pas leur grand livre/événement.
5. `record_closing_step` lit l'événement en `FOR KEY SHARE` : le statut lu peut être périmé face à un `set_event_status`
   concurrent ; sans conséquence démontrée (les conditions de passage exigent les étapes), à noter.
