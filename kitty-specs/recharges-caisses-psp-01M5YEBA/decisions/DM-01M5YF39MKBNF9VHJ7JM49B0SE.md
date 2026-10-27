# Decision Moment `01M5YF39MKBNF9VHJ7JM49B0SE`

- **Mission:** `recharges-caisses-psp-01M5YEBA`
- **Origin flow:** `specify`
- **Slot key:** `specify.psp.real-adapters`
- **Input key:** `psp_real_adapters`
- **Status:** `deferred`
- **Created:** `2026-10-27T10:39:34.035638+00:00`
- **Resolved:** `2026-10-27T10:39:47.076513+00:00`
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

_(none)_

## Rationale

Porteur absent (consigne : ne pas l'attendre) ; garder un faux plus longtemps que prévu relève de la règle 1 de CLAUDE.md : à soumettre avant tout codage, au plus tard au plan.

## Change log

- `2026-10-27T10:39:34.035638+00:00` — opened
- `2026-10-27T10:39:47.076513+00:00` — deferred
