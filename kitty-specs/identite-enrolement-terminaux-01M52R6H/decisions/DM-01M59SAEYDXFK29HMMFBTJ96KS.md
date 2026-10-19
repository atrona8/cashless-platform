# Decision Moment `01M59SAEYDXFK29HMMFBTJ96KS`

- **Mission:** `identite-enrolement-terminaux-01M52R6H`
- **Origin flow:** `plan`
- **Slot key:** `plan.transport.mtls-termination`
- **Input key:** `mtls_termination`
- **Status:** `resolved`
- **Created:** `2026-10-19T09:54:11.533577+00:00`
- **Resolved:** `2026-10-19T09:54:46.226548+00:00`
- **Resolved by:** `porteur`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

Où vérifier le certificat client mTLS des terminaux : dans les processus Node eux-mêmes (TLS de bout en bout, répartiteur en passage TCP), ou au répartiteur qui transmet le certificat vérifié dans un en-tête de confiance ?

## Options

- Dans les processus Node (passage TCP)
- Au répartiteur, certificat transmis en en-tête
- Other

## Final answer

Dans les processus Node (passage TCP)

## Rationale

_(none)_

## Change log

- `2026-10-19T09:54:11.533577+00:00` — opened
- `2026-10-19T09:54:46.226548+00:00` — resolved (final_answer="Dans les processus Node (passage TCP)")
