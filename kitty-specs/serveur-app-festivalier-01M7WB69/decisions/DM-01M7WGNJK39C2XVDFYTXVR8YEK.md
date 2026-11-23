# Decision Moment `01M7WGNJK39C2XVDFYTXVR8YEK`

- **Mission:** `serveur-app-festivalier-01M7WB69`
- **Origin flow:** `plan`
- **Slot key:** `plan.contrat.motifs-import`
- **Input key:** `printed_number_reject_reasons`
- **Status:** `resolved`
- **Created:** `2026-11-20T12:59:56.387982+00:00`
- **Resolved:** `2026-11-20T13:07:15.821292+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

Import du fichier de l'imprimeur : la réponse liste les lignes refusées avec un motif tiré d'une énumération fermée du contrat. Faut-il ajouter deux valeurs (BAD_PRINTED_NUMBER, PRINTED_NUMBER_TAKEN) ou réutiliser MALFORMED_LINE ?

## Options

- deux valeurs ajoutees
- MALFORMED_LINE
- Other

## Final answer

Deux valeurs ajoutées à ClaimCodeAssociationResult.reason (BAD_PRINTED_NUMBER, PRINTED_NUMBER_TAKEN), ajout rétrocompatible inscrit dans contract-baseline.json (ADR-225), types générés régénérés

## Rationale

_(none)_

## Change log

- `2026-11-20T12:59:56.387982+00:00` — opened
- `2026-11-20T13:07:15.821292+00:00` — resolved (final_answer="Deux valeurs ajoutées à ClaimCodeAssociationResult.reason (BAD_PRINTED_NUMBER, PRINTED_NUMBER_TAKEN), ajout rétrocompatible inscrit dans contract-baseline.json (ADR-225), types générés régénérés")
