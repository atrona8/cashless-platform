# Decision Moment `01M4DP7CDKVR2JRKQNE82R3NVK`

- **Mission:** `identite-roles-double-validation-01M4DNDN`
- **Origin flow:** `plan`
- **Slot key:** `plan.approval.atomicity`
- **Input key:** `approval_atomicity`
- **Status:** `resolved`
- **Created:** `2026-10-08T12:01:20.819042+00:00`
- **Resolved:** `2026-10-08T12:01:35.875867+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

Décision et exécution d'une demande approuvée : une ou plusieurs transactions ?

## Options

- Une seule transaction : décision, exécution dans un point de sauvegarde, EXECUTED ou FAILED, journal, réponse idempotente
- Décision puis exécution séparées
- Other

## Final answer

Une seule transaction (IdempotentTx) : decide_approval_request, exécution dans un SAVEPOINT, retour arrière du SAVEPOINT et FAILED avec le code stable si l'action échoue, EXECUTED sinon, ligne d'audit, réponse enregistrée ; aucun état APPROVED orphelin possible. (décidé par l'agent, délégation du porteur du projet)

## Rationale

_(none)_

## Change log

- `2026-10-08T12:01:20.819042+00:00` — opened
- `2026-10-08T12:01:35.875867+00:00` — resolved (final_answer="Une seule transaction (IdempotentTx) : decide_approval_request, exécution dans un SAVEPOINT, retour arrière du SAVEPOINT et FAILED avec le code stable si l'action échoue, EXECUTED sinon, ligne d'audit, réponse enregistrée ; aucun état APPROVED orphelin possible. (décidé par l'agent, délégation du porteur du projet)")
