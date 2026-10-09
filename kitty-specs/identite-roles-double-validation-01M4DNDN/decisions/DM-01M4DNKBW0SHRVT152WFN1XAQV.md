# Decision Moment `01M4DNKBW0SHRVT152WFN1XAQV`

- **Mission:** `identite-roles-double-validation-01M4DNDN`
- **Origin flow:** `specify`
- **Slot key:** `specify.approval.onsite-token`
- **Input key:** `onsite_token_scope`
- **Status:** `resolved`
- **Created:** `2026-10-08T11:50:24.896509+00:00`
- **Resolved:** `2026-10-08T11:50:36.201071+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

Jusqu'où va le jeton d'approbation sur place (X-Approval-Token) dans cette mission ?

## Options

- Vérification complète côté API (signature, expiration, jti à usage unique, act, act_hash, sub ≠ appelant, rôle) exposée comme garde réutilisable, émise par le faux fournisseur en test
- Seulement l'interface, vérification plus tard
- Other

## Final answer

Vérification complète côté API, offerte comme garde réutilisable par opération (operationId, rôle exigé) ; usage unique mémorisé en base jusqu'à l'expiration ; émission par le serveur d'identité (faux fournisseur en test). Les opérations qui l'exigent (refundCashDue, releaseMedia) arrivent avec les missions bracelets et recharges. (décidé par l'agent, délégation du porteur du projet)

## Rationale

_(none)_

## Change log

- `2026-10-08T11:50:24.896509+00:00` — opened
- `2026-10-08T11:50:36.201071+00:00` — resolved (final_answer="Vérification complète côté API, offerte comme garde réutilisable par opération (operationId, rôle exigé) ; usage unique mémorisé en base jusqu'à l'expiration ; émission par le serveur d'identité (faux fournisseur en test). Les opérations qui l'exigent (refundCashDue, releaseMedia) arrivent avec les missions bracelets et recharges. (décidé par l'agent, délégation du porteur du projet)")
