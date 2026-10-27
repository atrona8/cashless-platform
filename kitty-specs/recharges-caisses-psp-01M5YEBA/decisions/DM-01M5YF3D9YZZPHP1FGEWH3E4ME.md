# Decision Moment `01M5YF3D9YZZPHP1FGEWH3E4ME`

- **Mission:** `recharges-caisses-psp-01M5YEBA`
- **Origin flow:** `specify`
- **Slot key:** `specify.psp.secrets-store`
- **Input key:** `psp_secrets_store`
- **Status:** `resolved`
- **Created:** `2026-10-27T10:39:37.790311+00:00`
- **Resolved:** `2026-10-27T10:48:31.164845+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

Coffre des secrets PSP (AWS Secrets Manager, rattaché au détenteur des fonds) : écrire l'adaptateur AWS dans cette mission (nouvelle dépendance @aws-sdk/client-secrets-manager à vérifier et épingler, région provisoire OP-N11) ou livrer le port + faux coffre refusé en production et reporter l'adaptateur réel ?

## Options

- Reporter avec les adaptateurs PSP réels (faux coffre refusé en production)
- Écrire l adaptateur AWS maintenant
- Other

## Final answer

Reporter avec les adaptateurs PSP réels : port + faux coffre refusé en production ; adaptateur AWS Secrets Manager livré avec eux. Décision du porteur du 27/10/2026.

## Rationale

_(none)_

## Change log

- `2026-10-27T10:39:37.790311+00:00` — opened
- `2026-10-27T10:48:31.164845+00:00` — resolved (final_answer="Reporter avec les adaptateurs PSP réels : port + faux coffre refusé en production ; adaptateur AWS Secrets Manager livré avec eux. Décision du porteur du 27/10/2026.")
