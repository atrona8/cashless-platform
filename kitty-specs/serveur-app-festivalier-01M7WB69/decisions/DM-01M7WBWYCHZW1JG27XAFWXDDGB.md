# Decision Moment `01M7WBWYCHZW1JG27XAFWXDDGB`

- **Mission:** `serveur-app-festivalier-01M7WB69`
- **Origin flow:** `specify`
- **Slot key:** `specify.op-n47.periode`
- **Input key:** `claim_secret_grace_period`
- **Status:** `resolved`
- **Created:** `2026-11-20T11:36:34.961412+00:00`
- **Resolved:** `2026-11-20T11:45:44.062764+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

Rotation du secret des codes de rattachement (OP-N47) : combien de temps l'ancien secret reste-t-il accepté, et qui déclenche la rotation ?

## Options

- 30 jours, par configuration
- jusqu a la fin de l evenement
- Other

## Final answer

Pas de période : rotation immédiate ; les codes émis sous l'ancien secret sont invalidés, réimpression ou réémission des codes

## Rationale

_(none)_

## Change log

- `2026-11-20T11:36:34.961412+00:00` — opened
- `2026-11-20T11:45:44.062764+00:00` — resolved (final_answer="Pas de période : rotation immédiate ; les codes émis sous l'ancien secret sont invalidés, réimpression ou réémission des codes")
