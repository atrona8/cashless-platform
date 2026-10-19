# Decision Moment `01M59SD0YNWKK8R4EKT2T7THJK`

- **Mission:** `identite-enrolement-terminaux-01M52R6H`
- **Origin flow:** `plan`
- **Slot key:** `plan.attestation.ios-key-binding`
- **Input key:** `ios_signing_key_proof`
- **Status:** `resolved`
- **Created:** `2026-10-19T09:55:35.509871+00:00`
- **Resolved:** `2026-10-19T09:56:36.156129+00:00`
- **Resolved by:** `porteur`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

iOS : App Attest prouve l'app intacte et que SA clé est dans la Secure Enclave, pas que la clé de signature ECDSA du terminal y est. Accepter la liaison des clés publiques à l'instance attestée (limite consignée), ou signer chaque requête iOS par assertion App Attest (format propre à iOS) ?

## Options

- Liaison des clés à l instance attestée, limite consignée
- Assertion App Attest sur chaque requête iOS
- Other

## Final answer

Liaison des clés à l'instance attestée, limite consignée

## Rationale

iPhone : QR seulement, jamais de mot de passe de bracelet ; ADR, point ouvert et test qui borne iOS au QR

## Change log

- `2026-10-19T09:55:35.509871+00:00` — opened
- `2026-10-19T09:56:36.156129+00:00` — resolved (final_answer="Liaison des clés à l'instance attestée, limite consignée")
