# Decision Moment `01M6NPFSFSDR6DE15WPNTTTSKG`

- **Mission:** `passerelle-locale-01M6NM1S`
- **Origin flow:** `plan`
- **Slot key:** `plan.architecture.gateway-database`
- **Input key:** `gateway_database`
- **Status:** `resolved`
- **Created:** `2026-11-05T11:11:15.449475+00:00`
- **Resolved:** `2026-11-05T11:18:26.486865+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

Base de la passerelle : schéma local réduit ou schéma central complet ?

## Options

- Schéma réduit et logique TypeScript partagée
- Schéma central complet
- Other

## Final answer

Schéma local réduit sur PostgreSQL, règles partagées en TypeScript, mêmes scénarios de référence ; le central reste seul à tenir la comptabilité. Écart de libellé à acter : « même moteur » (SPEC §9) devient « mêmes modules ».

## Rationale

_(none)_

## Change log

- `2026-11-05T11:11:15.449475+00:00` — opened
- `2026-11-05T11:18:26.486865+00:00` — resolved (final_answer="Schéma local réduit sur PostgreSQL, règles partagées en TypeScript, mêmes scénarios de référence ; le central reste seul à tenir la comptabilité. Écart de libellé à acter : « même moteur » (SPEC §9) devient « mêmes modules ».")
