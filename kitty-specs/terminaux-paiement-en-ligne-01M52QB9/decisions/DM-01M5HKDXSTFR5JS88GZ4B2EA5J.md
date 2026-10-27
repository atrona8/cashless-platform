# Decision Moment `01M5HKDXSTFR5JS88GZ4B2EA5J`

- **Mission:** `terminaux-paiement-en-ligne-01M52QB9`
- **Origin flow:** `specify`
- **Slot key:** `specify.enrollment.blocking-event-states`
- **Input key:** `enrollment_blocking_event_states`
- **Status:** `resolved`
- **Created:** `2026-10-22T10:45:09.050432+00:00`
- **Resolved:** `2026-10-22T10:51:33.643593+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

OP-N74 : quels états de l'événement font refuser la création d'un code d'enrôlement et l'enrôlement (en plus d'un point de vente supprimé) ?

## Options

- CLOSED seulement
- À partir de CLOSING, sauf le mode TOPUP_DESK
- À partir de CLOSING, tous modes
- Other

## Final answer

Refus dès CLOSING pour CATALOG_POS et KEYPAD_TPE ; TOPUP_DESK enrôlable jusqu'à CLOSED exclu ; CLOSED refuse tout ; point de vente supprimé toujours refusé

## Rationale

_(none)_

## Change log

- `2026-10-22T10:45:09.050432+00:00` — opened
- `2026-10-22T10:51:33.643593+00:00` — resolved (final_answer="Refus dès CLOSING pour CATALOG_POS et KEYPAD_TPE ; TOPUP_DESK enrôlable jusqu'à CLOSED exclu ; CLOSED refuse tout ; point de vente supprimé toujours refusé")
