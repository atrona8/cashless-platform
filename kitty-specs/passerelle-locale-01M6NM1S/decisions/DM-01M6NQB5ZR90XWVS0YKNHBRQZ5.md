# Decision Moment `01M6NQB5ZR90XWVS0YKNHBRQZ5`

- **Mission:** `passerelle-locale-01M6NM1S`
- **Origin flow:** `plan`
- **Slot key:** `plan.reliability.lost-gateway-counter-ops`
- **Input key:** `lost_gateway_counter_ops`
- **Status:** `resolved`
- **Created:** `2026-11-05T11:26:12.985066+00:00`
- **Resolved:** `2026-11-05T11:33:16.134479+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

Passerelle perdue avant le rejeu : que deviennent les activations et cautions faites sur elle ?

## Options

- Rejouées depuis le journal du terminal ; sinon anomalie
- Risque accepté, écart constaté au comptage
- Other

## Final answer

À la reprise forcée, les terminaux renvoient aussi activations et cautions de leur journal ; rejeu impossible traité par EDGE_REPLAY_FAILED (anomalie, espèces au compte d'attente, résolution à deux). Aucune perte silencieuse. Le format doit rester compatible avec le contrat.

## Rationale

_(none)_

## Change log

- `2026-11-05T11:26:12.985066+00:00` — opened
- `2026-11-05T11:33:16.134479+00:00` — resolved (final_answer="À la reprise forcée, les terminaux renvoient aussi activations et cautions de leur journal ; rejeu impossible traité par EDGE_REPLAY_FAILED (anomalie, espèces au compte d'attente, résolution à deux). Aucune perte silencieuse. Le format doit rester compatible avec le contrat.")
