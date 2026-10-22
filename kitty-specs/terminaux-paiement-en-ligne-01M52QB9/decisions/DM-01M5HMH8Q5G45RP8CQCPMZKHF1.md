# Decision Moment `01M5HMH8Q5G45RP8CQCPMZKHF1`

- **Mission:** `terminaux-paiement-en-ligne-01M52QB9`
- **Origin flow:** `plan`
- **Slot key:** `plan.security.argon2-implementation`
- **Input key:** `argon2_implementation`
- **Status:** `resolved`
- **Created:** `2026-10-22T11:04:27.109550+00:00`
- **Resolved:** `2026-10-22T11:17:42.586034+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

Hachage argon2id des PIN : passer à Node 24 LTS (crypto.argon2 natif, aucune dépendance) ou ajouter une dépendance sous Node 22 ?

## Options

- Node 24 LTS, crypto.argon2 natif
- Dépendance @node-rs/argon2 sous Node 22
- Dépendance hash-wasm sous Node 22
- Other

## Final answer

Suivre docs/08-pile-logicielle.md (ADR-78) : Node 22 LTS conservé, paquet argon2 (ranisalt/node-argon2) ; version exacte tranchée à part

## Rationale

_(none)_

## Change log

- `2026-10-22T11:04:27.109550+00:00` — opened
- `2026-10-22T11:17:42.586034+00:00` — resolved (final_answer="Suivre docs/08-pile-logicielle.md (ADR-78) : Node 22 LTS conservé, paquet argon2 (ranisalt/node-argon2) ; version exacte tranchée à part")
