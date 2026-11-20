# Decision Moment `01M7QAM2P80FKECZ6WRHFT05R5`

- **Mission:** `durcissements-serveur-01M7QAJD`
- **Origin flow:** `specify`
- **Slot key:** `specify.scope.op-n64-app-attest`
- **Input key:** `op_n64_scope`
- **Status:** `resolved`
- **Created:** `2026-11-18T12:38:03.720642+00:00`
- **Resolved:** `2026-11-18T12:39:27.541679+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

OP-N64 (terminal iOS) : jusqu'où va le côté serveur dans la 11a ?

## Options

- Stocker le keyId et vérifier les assertions App Attest côté serveur, borne iOS gardée jusqu à la mission 12
- Stocker le keyId seulement
- Sortir OP-N64 de la 11a (tout en mission 12)
- Other

## Final answer

Stocker le keyId et vérifier les assertions App Attest côté serveur ; borne iOS (QR seulement, /media/auth-keys refusé) gardée jusqu'à ce que l'app (mission 12) envoie les assertions ; OP-N64 passe côté serveur prêt, non levé

## Rationale

_(none)_

## Change log

- `2026-11-18T12:38:03.720642+00:00` — opened
- `2026-11-18T12:39:27.541679+00:00` — resolved (final_answer="Stocker le keyId et vérifier les assertions App Attest côté serveur ; borne iOS (QR seulement, /media/auth-keys refusé) gardée jusqu'à ce que l'app (mission 12) envoie les assertions ; OP-N64 passe côté serveur prêt, non levé")
