# Decision Moment `01M6NM8ZSQ5QV19CWBD2XQDW98`

- **Mission:** `passerelle-locale-01M6NM1S`
- **Origin flow:** `specify`
- **Slot key:** `specify.scope.cash-session-during-edge`
- **Input key:** `cash_session_during_edge`
- **Status:** `resolved`
- **Created:** `2026-11-05T10:32:35.383659+00:00`
- **Resolved:** `2026-11-05T10:36:05.993304+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

Comment ouvrir et fermer une session de caisse pendant EDGE, alors que /cash-sessions n'est pas x-edge-available ?

## Options

- Sessions ouvertes avant la bascule, fermeture au central après le rendu
- Other

## Final answer

Sessions ouvertes au central et répliquées avant la bascule ; recharge refusée sur toute autre session ; fermeture et comptage au central après le rendu. Contrat inchangé. Limite acceptée : pas d'ouverture ni de relève de guichet pendant la coupure.

## Rationale

_(none)_

## Change log

- `2026-11-05T10:32:35.383659+00:00` — opened
- `2026-11-05T10:36:05.993304+00:00` — resolved (final_answer="Sessions ouvertes au central et répliquées avant la bascule ; recharge refusée sur toute autre session ; fermeture et comptage au central après le rendu. Contrat inchangé. Limite acceptée : pas d'ouverture ni de relève de guichet pendant la coupure.")
