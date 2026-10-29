# Decision Moment `01M645SWY4PETSJE3PJ7YXKYTP`

- **Mission:** `hors-ligne-snapshots-lots-01M645RN`
- **Origin flow:** `specify`
- **Slot key:** `specify.scope.kms-adapters`
- **Input key:** `kms_adapters_scope`
- **Status:** `resolved`
- **Created:** `2026-10-29T15:52:35.524859+00:00`
- **Resolved:** `2026-10-29T15:56:00.017027+00:00`
- **Opened by:** `cli`
- **Other answer:** `true`

## Question

Les adaptateurs AWS KMS réels (signature des snapshots, OP-N41 clés des bracelets, OP-N73 autorité des terminaux et jetons) demandent un accès AWS (région OP-N11). Les inclut-on dans la mission 7 ?

## Options

- Reporter dans une mission 7b (comme la 6b)
- Inclure, écrits sans accès AWS (non activables)
- Inclure, j ai un accès AWS
- Other

## Final answer

Repenser le découpage : toutes les intégrations qui demandent un accès externe (AWS KMS, Secrets Manager, PSP réels…) sont regroupées en fin de feuille de route ; d'ici là la mission 7 et les suivantes simulent ces services (faux refusés en production).

## Rationale

_(none)_

## Change log

- `2026-10-29T15:52:35.524859+00:00` — opened
- `2026-10-29T15:56:00.017027+00:00` — resolved (final_answer="Repenser le découpage : toutes les intégrations qui demandent un accès externe (AWS KMS, Secrets Manager, PSP réels…) sont regroupées en fin de feuille de route ; d'ici là la mission 7 et les suivantes simulent ces services (faux refusés en production).")
