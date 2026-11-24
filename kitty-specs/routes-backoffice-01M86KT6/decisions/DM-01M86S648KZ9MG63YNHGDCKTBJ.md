# Decision Moment `01M86S648KZ9MG63YNHGDCKTBJ`

- **Mission:** `routes-backoffice-01M86KT6`
- **Origin flow:** `specify`
- **Slot key:** `specify.devices.model-referential`
- **Input key:** `phone_model_referential`
- **Status:** `resolved`
- **Created:** `2026-11-24T12:41:11.699326+00:00`
- **Resolved:** `2026-11-24T12:42:14.510606+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

Qui tient la liste des modèles de téléphone et leur niveau NFC, et que se passe-t-il pour un terminal dont le modèle est toléré ou non testé ?

## Options

- Plateforme tient la liste, alerte seulement
- Plateforme tient la liste, enrôlement refusé si non testé
- Other

## Final answer

L'administrateur plateforme tient la liste (modèle, niveau, date de mesure) ; la fiche d'un terminal et la liste des terminaux d'un événement signalent un modèle toléré ou non testé ; aucun refus d'enrôlement.

## Rationale

_(none)_

## Change log

- `2026-11-24T12:41:11.699326+00:00` — opened
- `2026-11-24T12:42:14.510606+00:00` — resolved (final_answer="L'administrateur plateforme tient la liste (modèle, niveau, date de mesure) ; la fiche d'un terminal et la liste des terminaux d'un événement signalent un modèle toléré ou non testé ; aucun refus d'enrôlement.")
