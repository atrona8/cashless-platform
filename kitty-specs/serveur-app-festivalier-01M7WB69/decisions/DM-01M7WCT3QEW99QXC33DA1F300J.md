# Decision Moment `01M7WCT3QEW99QXC33DA1F300J`

- **Mission:** `serveur-app-festivalier-01M7WB69`
- **Origin flow:** `plan`
- **Slot key:** `plan.otp.chaine-memoire`
- **Input key:** `otp_chain_code_retention`
- **Status:** `resolved`
- **Created:** `2026-11-20T11:52:30.702560+00:00`
- **Resolved:** `2026-11-20T11:57:43.789423+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

Chaîne d'envoi des codes : le code n'existe en clair qu'au moment de l'envoi. Pour basculer à 10 s puis 20 s, le garde-t-on en mémoire du processus (perdu au redémarrage) ou chiffré en base le temps de la chaîne ?

## Options

- memoire du processus
- chiffre en base
- Other

## Final answer

Mémoire du processus, 30 s au plus, jamais en base ni dans les journaux (porteur : « fait ce qui est le plus secure ») ; bascule perdue au redémarrage, le festivalier redemande ou choisit le SMS

## Rationale

_(none)_

## Change log

- `2026-11-20T11:52:30.702560+00:00` — opened
- `2026-11-20T11:57:43.789423+00:00` — resolved (final_answer="Mémoire du processus, 30 s au plus, jamais en base ni dans les journaux (porteur : « fait ce qui est le plus secure ») ; bascule perdue au redémarrage, le festivalier redemande ou choisit le SMS")
