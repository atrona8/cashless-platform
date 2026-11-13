# Decision Moment `01M6NMP2MPE81W7DPKDKNMNH24`

- **Mission:** `passerelle-locale-01M6NM1S`
- **Origin flow:** `specify`
- **Slot key:** `specify.scope.standby-promotion`
- **Input key:** `standby_promotion`
- **Status:** `resolved`
- **Created:** `2026-11-05T10:39:44.278931+00:00`
- **Resolved:** `2026-11-05T10:45:40.444522+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

Jusqu'où aller pour la passerelle de secours STANDBY ?

## Options

- STANDBY refuse tout débit ; promotion par handover normal seulement
- Other

## Final answer

La STANDBY refuse tout débit, test à l'appui ; promotion par handover normal (EDGE, CENTRAL, EDGE) seulement ; passerelle perdue sur site isolé : hors ligne avec plafonds puis reprise forcée à deux. Réplication synchrone (branche facultative de §9.8) hors périmètre.

## Rationale

_(none)_

## Change log

- `2026-11-05T10:39:44.278931+00:00` — opened
- `2026-11-05T10:45:40.444522+00:00` — resolved (final_answer="La STANDBY refuse tout débit, test à l'appui ; promotion par handover normal (EDGE, CENTRAL, EDGE) seulement ; passerelle perdue sur site isolé : hors ligne avec plafonds puis reprise forcée à deux. Réplication synchrone (branche facultative de §9.8) hors périmètre.")
