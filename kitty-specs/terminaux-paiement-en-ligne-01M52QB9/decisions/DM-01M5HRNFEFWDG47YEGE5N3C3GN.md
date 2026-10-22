# Decision Moment `01M5HRNFEFWDG47YEGE5N3C3GN`

- **Mission:** `terminaux-paiement-en-ligne-01M52QB9`
- **Origin flow:** `plan`
- **Slot key:** `plan.security.vendor-pin-api-trust`
- **Input key:** `vendor_pin_api_trust`
- **Status:** `resolved`
- **Created:** `2026-10-22T12:16:39.376067+00:00`
- **Resolved:** `2026-10-22T12:24:54.637506+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

Limite : l'API lit les empreintes de PIN et la base ouvre une session sur le résultat de vérification envoyé par l'API ; consigner (famille OP-N56) ou isoler la vérification dans un processus séparé ?

## Options

_(none)_

## Final answer

Consigner (point ouvert et ADR, famille d'OP-N56, levée en mission 11) ; test de borne : seul cashless_app exécute la fonction qui rend l'empreinte ; audit de chaque ouverture de session

## Rationale

_(none)_

## Change log

- `2026-10-22T12:16:39.376067+00:00` — opened
- `2026-10-22T12:24:54.637506+00:00` — resolved (final_answer="Consigner (point ouvert et ADR, famille d'OP-N56, levée en mission 11) ; test de borne : seul cashless_app exécute la fonction qui rend l'empreinte ; audit de chaque ouverture de session")
