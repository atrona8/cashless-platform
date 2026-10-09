# Decision Moment `01M4DP86J67CYY211DC4PWCC9W`

- **Mission:** `identite-roles-double-validation-01M4DNDN`
- **Origin flow:** `plan`
- **Slot key:** `plan.data.audit-append-only`
- **Input key:** `audit_append_only`
- **Status:** `resolved`
- **Created:** `2026-10-08T12:01:47.591969+00:00`
- **Resolved:** `2026-10-08T12:02:04.301506+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

Comment garantir que le journal d'audit est en ajout seul alors que roles.sql rend UPDATE sur toutes les tables ?

## Options

- Déclencheur qui refuse UPDATE et DELETE (pour tous les rôles) + TRUNCATE déjà retiré par roles.sql, testé par pgTAP
- Modifier roles.sql
- Other

## Final answer

Déclencheur BEFORE UPDATE OR DELETE qui lève une erreur pour tout rôle ; roles.sql (fichier du kit) n'est pas modifié ; TRUNCATE déjà retiré ; pgTAP prouve le refus. (décidé par l'agent, délégation du porteur du projet)

## Rationale

_(none)_

## Change log

- `2026-10-08T12:01:47.591969+00:00` — opened
- `2026-10-08T12:02:04.301506+00:00` — resolved (final_answer="Déclencheur BEFORE UPDATE OR DELETE qui lève une erreur pour tout rôle ; roles.sql (fichier du kit) n'est pas modifié ; TRUNCATE déjà retiré ; pgTAP prouve le refus. (décidé par l'agent, délégation du porteur du projet)")
