# Decision Moment `01M4B0BATNKGG1QASEV327NEWZ`

- **Mission:** `fondations-grand-livre-01M4AY8M`
- **Origin flow:** `plan`
- **Slot key:** `plan.tooling.pgtap-extension`
- **Input key:** `pgtap_extension_install`
- **Status:** `resolved`
- **Created:** `2026-10-07T11:00:32.725269+00:00`
- **Resolved:** `2026-10-07T11:26:41.668108+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

Les suites font CREATE EXTENSION pgtap et share/extension de Program Files n'est pas modifiable sans admin : comment rendre l'extension disponible en local ?

## Options

- Cluster PostgreSQL 17 privé (copie des binaires dans le dossier utilisateur, port 5433)
- Copie unique des fichiers pgTAP dans Program Files depuis un terminal administrateur
- PostgreSQL 17 + pgTAP dans WSL
- Other

## Final answer

Cluster PostgreSQL 17 privé : copie des binaires installés dans le profil utilisateur (hors dépôt), pgTAP ajouté, cluster de test sur le port 5433 en auth trust locale ; affine la décision specify 01M4AYCMYA8NFD6SRQRGD0BBMC

## Rationale

_(none)_

## Change log

- `2026-10-07T11:00:32.725269+00:00` — opened
- `2026-10-07T11:26:41.668108+00:00` — resolved (final_answer="Cluster PostgreSQL 17 privé : copie des binaires installés dans le profil utilisateur (hors dépôt), pgTAP ajouté, cluster de test sur le port 5433 en auth trust locale ; affine la décision specify 01M4AYCMYA8NFD6SRQRGD0BBMC")
