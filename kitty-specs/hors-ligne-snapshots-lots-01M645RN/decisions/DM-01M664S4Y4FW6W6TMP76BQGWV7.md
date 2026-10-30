# Decision Moment `01M664S4Y4FW6W6TMP76BQGWV7`

- **Mission:** `hors-ligne-snapshots-lots-01M645RN`
- **Origin flow:** `plan`
- **Slot key:** `plan.security.retryable-batch-close`
- **Input key:** `retryable_batch_close`
- **Status:** `resolved`
- **Created:** `2026-10-30T10:13:11.236613+00:00`
- **Resolved:** `2026-10-30T10:15:05.625896+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

Rejet réessayable (4e CL007, protocole §7.1-9 : rien au registre) : complete_offline_batch doit admettre un numéro sans résultat final. Trace durable en base (ligne RETRY écrite par la base, alerte après 24 h) ou autre ?

## Options

- Trace RETRY en base + alerte 24 h
- Inscrire REJECTED définitif (écart au protocole)
- Other

## Final answer

Trace RETRY écrite par la base dans la transaction de l'opération (offline_batch_retry) ; complete_offline_batch n'admet un numéro sans résultat final que sur cette ligne ; alerte si non renvoyé sous 24 h ; écart consigné (ADR).

## Rationale

_(none)_

## Change log

- `2026-10-30T10:13:11.236613+00:00` — opened
- `2026-10-30T10:15:05.625896+00:00` — resolved (final_answer="Trace RETRY écrite par la base dans la transaction de l'opération (offline_batch_retry) ; complete_offline_batch n'admet un numéro sans résultat final que sur cette ligne ; alerte si non renvoyé sous 24 h ; écart consigné (ADR).")
