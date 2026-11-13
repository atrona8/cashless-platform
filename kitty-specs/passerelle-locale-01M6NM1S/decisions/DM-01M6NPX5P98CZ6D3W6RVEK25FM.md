# Decision Moment `01M6NPX5P98CZ6D3W6RVEK25FM`

- **Mission:** `passerelle-locale-01M6NM1S`
- **Origin flow:** `plan`
- **Slot key:** `plan.security.device-token-refresh`
- **Input key:** `device_token_refresh`
- **Status:** `resolved`
- **Created:** `2026-11-05T11:18:33.929332+00:00`
- **Resolved:** `2026-11-05T11:22:18.814932+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

Pendant EDGE, comment renouveler les jetons d'appareil de 15 min sans le central ?

## Options

- Clé propre à la passerelle, jetons valables sur elle seule
- Clé du central copiée sur la passerelle
- Aucun renouvellement
- Other

## Final answer

Clé propre à la passerelle dans le port de stockage matériel ; jetons valables sur elle seule, refusés au central (test). Risque accepté par le porteur le 05/11/2026 : passerelle volée, jetons limités aux terminaux de l'événement sur cette passerelle jusqu'à sa révocation. Dette nommée (OP, ADR, test).

## Rationale

_(none)_

## Change log

- `2026-11-05T11:18:33.929332+00:00` — opened
- `2026-11-05T11:22:18.814932+00:00` — resolved (final_answer="Clé propre à la passerelle dans le port de stockage matériel ; jetons valables sur elle seule, refusés au central (test). Risque accepté par le porteur le 05/11/2026 : passerelle volée, jetons limités aux terminaux de l'événement sur cette passerelle jusqu'à sa révocation. Dette nommée (OP, ADR, test).")
