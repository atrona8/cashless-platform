# Decision Moment `01M7QCG7ACJ66PAZVWBX406P0N`

- **Mission:** `durcissements-serveur-01M7QAJD`
- **Origin flow:** `plan`
- **Slot key:** `plan.security.iban-key`
- **Input key:** `iban_key_location`
- **Status:** `deferred`
- **Created:** `2026-11-18T13:10:54.540534+00:00`
- **Resolved:** `2026-11-18T13:11:19.532712+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

OP-N140 : le processus public n'a pas de service de clés et l'export CSV qui doit déchiffrer l'IBAN est public. Chiffrer l'IBAN (3 emplacements) avec une clé AES-256-GCM lue dans la configuration de l'API (production refusée sans clé), ou garder le masque seul et laisser le chiffrement à l'arrivée d'un vrai KMS ?

## Options

- Clé de configuration dans l API (recommandé)
- Masque seul, chiffrement reporté au vrai KMS (12b)
- Other

## Final answer

_(none)_

## Rationale

Porteur indisponible le 18/11/2026 (consigne : continuer en autonomie) ; écart de sécurité ou écart à une décision du porteur (règle du 13/10/2026) : soumis, codage du lot concerné en attente de sa réponse.

## Change log

- `2026-11-18T13:10:54.540534+00:00` — opened
- `2026-11-18T13:11:19.532712+00:00` — deferred
