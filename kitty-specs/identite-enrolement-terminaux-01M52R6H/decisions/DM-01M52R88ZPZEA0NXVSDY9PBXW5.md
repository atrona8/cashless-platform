# Decision Moment `01M52R88ZPZEA0NXVSDY9PBXW5`

- **Mission:** `identite-enrolement-terminaux-01M52R6H`
- **Origin flow:** `specify`
- **Slot key:** `specify.identity.transport`
- **Input key:** `device_auth_scheme`
- **Status:** `resolved`
- **Created:** `2026-10-16T16:20:50.294941+00:00`
- **Resolved:** `2026-10-19T09:41:33.205209+00:00`
- **Resolved by:** `porteur`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

Authentification des terminaux : jeton d'appareil lié à la clé + signature de chaque requête, sans mTLS en V1 ; ou les trois (jeton, signature, mTLS avec une autorité de certification des terminaux) ; ou jeton + mTLS sans signature par requête ?

## Options

- Jeton et signature de chaque requête, sans mTLS
- Jeton, signature et mTLS
- Jeton et mTLS, sans signature par requête
- Other

## Final answer

Jeton, signature et mTLS

## Rationale

Condition de levée d'OP-N42 (ADR-88) tenue à la lettre ; SPEC §10.3 et openapi.yaml (« l'un OU l'autre », mTLS + jeton lié recommandé en production) sont plus permissifs : contradiction signalée, résolue dans le sens le plus sûr.

## Change log

- `2026-10-16T16:20:50.294941+00:00` — opened
- `2026-10-19T09:41:33.205209+00:00` — resolved (final_answer="Jeton, signature et mTLS")
