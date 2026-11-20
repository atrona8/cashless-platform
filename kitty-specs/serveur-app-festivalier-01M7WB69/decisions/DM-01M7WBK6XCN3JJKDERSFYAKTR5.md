# Decision Moment `01M7WBK6XCN3JJKDERSFYAKTR5`

- **Mission:** `serveur-app-festivalier-01M7WB69`
- **Origin flow:** `specify`
- **Slot key:** `specify.kyc.agent-titulaire`
- **Input key:** `kyc_self_identification_rule`
- **Status:** `resolved`
- **Created:** `2026-11-20T11:31:16.012239+00:00`
- **Resolved:** `2026-11-20T11:36:22.938175+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

Comment le serveur reconnaît-il qu'un agent du guichet est lui-même le festivalier qu'il identifie (règle §6.3 point 4) ?

## Options

- numero verifie identique
- lien declare
- Other

## Final answer

Numéro vérifié identique : refus 403 si le numéro vérifié du compte festivalier est égal au téléphone de l'agent (app_user.phone) ; limite consignée (agent sans numéro ou avec un autre numéro)

## Rationale

_(none)_

## Change log

- `2026-11-20T11:31:16.012239+00:00` — opened
- `2026-11-20T11:36:22.938175+00:00` — resolved (final_answer="Numéro vérifié identique : refus 403 si le numéro vérifié du compte festivalier est égal au téléphone de l'agent (app_user.phone) ; limite consignée (agent sans numéro ou avec un autre numéro)")
