# Decision Moment `01M59WNTT06K1SY81HBK6PT4E8`

- **Mission:** `identite-enrolement-terminaux-01M52R6H`
- **Origin flow:** `plan`
- **Slot key:** `plan.attestation.android-agreement-key`
- **Input key:** `android_min_version`
- **Status:** `resolved`
- **Created:** `2026-10-19T10:52:49.856783+00:00`
- **Resolved:** `2026-10-19T11:00:26.599118+00:00`
- **Resolved by:** `porteur`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

La clé d'accord ECDH ne peut être dans le Keystore matériel qu'à partir d'Android 12 (API 31) ; en dessous elle est logicielle et exportable. Android 12 minimum, ou Android 9-11 accepté avec NFC et mots de passe de bracelet refusés (limite consignée) ?

## Options

- Android 12 minimum
- Android 9-11 sans NFC ni mot de passe, limite consignée
- Other

## Final answer

Android 12 minimum

## Rationale

_(none)_

## Change log

- `2026-10-19T10:52:49.856783+00:00` — opened
- `2026-10-19T11:00:26.599118+00:00` — resolved (final_answer="Android 12 minimum")
