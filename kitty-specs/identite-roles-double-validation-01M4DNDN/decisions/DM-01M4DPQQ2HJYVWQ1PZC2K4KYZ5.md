# Decision Moment `01M4DPQQ2HJYVWQ1PZC2K4KYZ5`

- **Mission:** `identite-roles-double-validation-01M4DNDN`
- **Origin flow:** `plan`
- **Slot key:** `plan.audit.chain-and-seal`
- **Input key:** `audit_chain_seal`
- **Status:** `resolved`
- **Created:** `2026-10-08T12:10:16.017411+00:00`
- **Resolved:** `2026-10-08T12:11:11.363341+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

Faut-il protéger le journal d'audit par une chaîne d'empreintes et une copie externe, sur le modèle du scellement du grand livre ?

## Options

- Chaîne et scellement maintenant, copie externe plus tard
- Tout dans la mission 2
- Rien de plus pour l instant

## Final answer

Chaîne et scellement maintenant, copie externe plus tard (choix du porteur du projet, 2026-10-08) : chaque ligne d'audit chaînée par empreinte au sein de son prestataire, scellements périodiques de l'audit en base avec fonction de vérification et tests pgTAP ; la tâche planifiée et la copie vers le stockage externe en écriture unique sont confiées à la mission 9, avec celles du grand livre (§13.7).

## Rationale

_(none)_

## Change log

- `2026-10-08T12:10:16.017411+00:00` — opened
- `2026-10-08T12:11:11.363341+00:00` — resolved (final_answer="Chaîne et scellement maintenant, copie externe plus tard (choix du porteur du projet, 2026-10-08) : chaque ligne d'audit chaînée par empreinte au sein de son prestataire, scellements périodiques de l'audit en base avec fonction de vérification et tests pgTAP ; la tâche planifiée et la copie vers le stockage externe en écriture unique sont confiées à la mission 9, avec celles du grand livre (§13.7).")
