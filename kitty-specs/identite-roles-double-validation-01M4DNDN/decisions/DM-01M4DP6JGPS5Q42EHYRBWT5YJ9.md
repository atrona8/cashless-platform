# Decision Moment `01M4DP6JGPS5Q42EHYRBWT5YJ9`

- **Mission:** `identite-roles-double-validation-01M4DNDN`
- **Origin flow:** `plan`
- **Slot key:** `plan.data.identity-lookup`
- **Input key:** `identity_lookup`
- **Status:** `resolved`
- **Created:** `2026-10-08T12:00:54.294948+00:00`
- **Resolved:** `2026-10-08T12:01:08.454451+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

Comment retrouver la personne d'un jeton avant de connaître son prestataire (RLS) ?

## Options

- Fonction SECURITY DEFINER identify_person(émetteur, sujet) qui rend personne, prestataire, statut et attributions actives
- Lecture sans RLS par un rôle dédié
- Other

## Final answer

Fonction SECURITY DEFINER identify_person(issuer, subject) accordée à cashless_app : rend l'identifiant, le prestataire (NULL pour la plateforme), le statut et les attributions actives ; aucune autre lecture hors RLS. (décidé par l'agent, délégation du porteur du projet)

## Rationale

_(none)_

## Change log

- `2026-10-08T12:00:54.294948+00:00` — opened
- `2026-10-08T12:01:08.454451+00:00` — resolved (final_answer="Fonction SECURITY DEFINER identify_person(issuer, subject) accordée à cashless_app : rend l'identifiant, le prestataire (NULL pour la plateforme), le statut et les attributions actives ; aucune autre lecture hors RLS. (décidé par l'agent, délégation du porteur du projet)")
