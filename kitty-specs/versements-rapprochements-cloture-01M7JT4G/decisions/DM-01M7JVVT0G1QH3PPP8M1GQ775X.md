# Decision Moment `01M7JVVT0G1QH3PPP8M1GQ775X`

- **Mission:** `versements-rapprochements-cloture-01M7JT4G`
- **Origin flow:** `plan`
- **Slot key:** `plan.controls.long_tx`
- **Input key:** `long_tx_monitoring`
- **Status:** `resolved`
- **Created:** `2026-11-16T19:03:10.608735+00:00`
- **Resolved:** `2026-11-16T19:26:45.747262+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

Comment surveiller les transactions de plus de 60 s, qui exige de lire pg_stat_activity de tous les rôles ?

## Options

- Fonction SECURITY DEFINER sans texte de requête
- Rôle de surveillance avec pg_read_all_stats
- Reporter à la 12b
- Other

## Final answer

Fonction SECURITY DEFINER sans texte de requête, exécutable par le seul rôle de maintenance

## Rationale

_(none)_

## Change log

- `2026-11-16T19:03:10.608735+00:00` — opened
- `2026-11-16T19:26:45.747262+00:00` — resolved (final_answer="Fonction SECURITY DEFINER sans texte de requête, exécutable par le seul rôle de maintenance")
