# Decision Moment `01M667Y1J4DT3HY96ZBCXXMXBT`

- **Mission:** `hors-ligne-snapshots-lots-01M645RN`
- **Origin flow:** `plan`
- **Slot key:** `plan.security.journal-import-listing`
- **Input key:** `journal_import_listing`
- **Status:** `resolved`
- **Created:** `2026-10-30T11:08:17.348697+00:00`
- **Resolved:** `2026-10-30T11:08:32.098686+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

Travailleur journal-import (API, cashless_app) : comment lister les imports PROCESSING de tous les prestataires sans SELECT sur device_journal_import ?

## Options

- Fonction étroite
- Déplacer au processus maintenance

## Final answer

device_journal_imports_processing() DEFINER STABLE (WP05) rend seulement (import_id, operator_id) des imports PROCESSING ; accordée à cashless_app ; traitement ensuite sous RLS par prestataire ; ADR-140.

## Rationale

_(none)_

## Change log

- `2026-10-30T11:08:17.348697+00:00` — opened
- `2026-10-30T11:08:32.098686+00:00` — resolved (final_answer="device_journal_imports_processing() DEFINER STABLE (WP05) rend seulement (import_id, operator_id) des imports PROCESSING ; accordée à cashless_app ; traitement ensuite sous RLS par prestataire ; ADR-140.")
