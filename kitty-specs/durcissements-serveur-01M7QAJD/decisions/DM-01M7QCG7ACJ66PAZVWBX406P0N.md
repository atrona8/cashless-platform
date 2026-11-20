# Decision Moment `01M7QCG7ACJ66PAZVWBX406P0N`

- **Mission:** `durcissements-serveur-01M7QAJD`
- **Origin flow:** `plan`
- **Slot key:** `plan.security.iban-key`
- **Input key:** `iban_key_location`
- **Status:** `resolved`
- **Created:** `2026-11-18T13:10:54.540534+00:00`
- **Resolved:** `2026-11-18T14:37:15.158941+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

OP-N140 : le processus public n'a pas de service de clés et l'export CSV qui doit déchiffrer l'IBAN est public. Chiffrer l'IBAN (3 emplacements) avec une clé AES-256-GCM lue dans la configuration de l'API (production refusée sans clé), ou garder le masque seul et laisser le chiffrement à l'arrivée d'un vrai KMS ?

## Options

- Clé de configuration dans l API (recommandé)
- Masque seul, chiffrement reporté au vrai KMS (12b)
- Other

## Final answer

Clé de configuration dans l'API : AES-256-GCM, anneau de clés en configuration, production refusée sans clé ; chiffrement aux trois emplacements (refund_request.iban, payout.iban, approval_request.payload avec iban_mask) ; CHECK NOT VALID ; limite résiduelle (clé dans le processus public) consignée, levée avec le vrai KMS

## Rationale

_(none)_

## Change log

- `2026-11-18T13:10:54.540534+00:00` — opened
- `2026-11-18T14:37:15.158941+00:00` — resolved (final_answer="Clé de configuration dans l'API : AES-256-GCM, anneau de clés en configuration, production refusée sans clé ; chiffrement aux trois emplacements (refund_request.iban, payout.iban, approval_request.payload avec iban_mask) ; CHECK NOT VALID ; limite résiduelle (clé dans le processus public) consignée, levée avec le vrai KMS")
