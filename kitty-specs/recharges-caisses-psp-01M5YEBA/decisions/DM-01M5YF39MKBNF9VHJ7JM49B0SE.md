# Decision Moment `01M5YF39MKBNF9VHJ7JM49B0SE`

- **Mission:** `recharges-caisses-psp-01M5YEBA`
- **Origin flow:** `specify`
- **Slot key:** `specify.psp.real-adapters`
- **Input key:** `psp_real_adapters`
- **Status:** `resolved`
- **Created:** `2026-10-27T10:39:34.035638+00:00`
- **Resolved:** `2026-10-27T10:48:27.364743+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

Adaptateurs PSP réels (Wave, Orange Money, PayDunya, Stripe) : les coder dans cette mission sans accès de test (action 11), ou livrer l'interface + faux refusé en production et reporter les adaptateurs réels à une mission dédiée une fois les accès obtenus ?

## Options

- Reporter les 4 adaptateurs réels (faux seul, refusé en production)
- Coder les 4 sur documentation, activation bloquée en production tant que non vérifiés
- Coder seulement ceux dont les accès de test existent déjà
- Other

## Final answer

Reporter les 4 adaptateurs réels : interface commune + faux par fournisseur refusé au démarrage en production ; adaptateurs réels dans une mission dédiée dès les accès de test obtenus (action 11). Dette nommée : OP + ADR + test + reports PROMPTS/PRD. Décision du porteur du 27/10/2026.

## Rationale

_(none)_

## Change log

- `2026-10-27T10:39:34.035638+00:00` — opened
- `2026-10-27T10:48:27.364743+00:00` — resolved (final_answer="Reporter les 4 adaptateurs réels : interface commune + faux par fournisseur refusé au démarrage en production ; adaptateurs réels dans une mission dédiée dès les accès de test obtenus (action 11). Dette nommée : OP + ADR + test + reports PROMPTS/PRD. Décision du porteur du 27/10/2026.")
