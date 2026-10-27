# Decision Moment `01M5YF3D9YZZPHP1FGEWH3E4ME`

- **Mission:** `recharges-caisses-psp-01M5YEBA`
- **Origin flow:** `specify`
- **Slot key:** `specify.psp.secrets-store`
- **Input key:** `psp_secrets_store`
- **Status:** `deferred`
- **Created:** `2026-10-27T10:39:37.790311+00:00`
- **Resolved:** `2026-10-27T10:39:51.281570+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

Coffre des secrets PSP (AWS Secrets Manager, rattaché au détenteur des fonds) : écrire l'adaptateur AWS dans cette mission (nouvelle dépendance @aws-sdk/client-secrets-manager à vérifier et épingler, région provisoire OP-N11) ou livrer le port + faux coffre refusé en production et reporter l'adaptateur réel ?

## Options

- Reporter avec les adaptateurs PSP réels (faux coffre refusé en production)
- Écrire l adaptateur AWS maintenant
- Other

## Final answer

_(none)_

## Rationale

Lié à la décision des adaptateurs réels ; règle 1 de CLAUDE.md (faux gardé) et pile non arrêtée (document 08) : à soumettre au porteur avant le plan.

## Change log

- `2026-10-27T10:39:37.790311+00:00` — opened
- `2026-10-27T10:39:51.281570+00:00` — deferred
