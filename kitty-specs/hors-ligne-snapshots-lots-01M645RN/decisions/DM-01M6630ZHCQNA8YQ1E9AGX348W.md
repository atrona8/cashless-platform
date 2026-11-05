# Decision Moment `01M6630ZHCQNA8YQ1E9AGX348W`

- **Mission:** `hors-ligne-snapshots-lots-01M645RN`
- **Origin flow:** `plan`
- **Slot key:** `plan.cash.guard-offline-coverage`
- **Input key:** `cash_guard_offline_coverage`
- **Status:** `canceled`
- **Created:** `2026-10-30T09:42:30.700549+00:00`
- **Resolved:** `2026-10-30T09:48:58.023401+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

La garde de caisse (0036) vérifie la session OUVERTE au moment de l'écriture, pas celle qui couvrait occurred_at : une recharge hors ligne dont la session est fermée passerait si le terminal a rouvert une session depuis. Renforcer la garde en base pour les sources OFFLINE_SYNC/EDGE_SYNC (écriture refusée si la session ouverte ne couvre pas occurred_at) ?

## Options

- Renforcer la garde en base
- Contrôle dans la fonction de la mission seulement
- Other

## Final answer

_(none)_

## Rationale

Sans objet : le porteur retire la recharge espèces hors ligne de la mission (30/10/2026) ; garde de caisse inchangée.

## Change log

- `2026-10-30T09:42:30.700549+00:00` — opened
- `2026-10-30T09:48:58.023401+00:00` — canceled
