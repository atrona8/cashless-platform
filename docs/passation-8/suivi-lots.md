# Suivi des lots, mission 8 (orchestrateur)

Notes à transmettre aux lots suivants.

## Depuis WP03 (7e347655)
- WP09 : ajouter `edge_reference_change` à `tests_offline_rights.sql` (liste figée) ; `migrate.ts` : `CASHLESS_EDGE_PASSWORD`, `CASHLESS_EDGEADMIN_PASSWORD` (à WP09, `interfaces.md` § 12) ; fonctions internes `edge_event_lock`, `edge_event_handover_open`, `edge_admin_audit` jamais accordées.
- WP15 : `revoke`, `rotate`, `swap`, `set_role`, `edge_register_snapshot_key` appellent `assert_tenant` : l'outil pose `app.operator_id` à chaque appel. Noms entérinés : alerte `EDGE_ROLE_CHANGED`, audit `EDGE_SNAPSHOT_KEY_REGISTERED`. Une seule clé de snapshot `ACTIVE` par passerelle ; rotation : à trancher si besoin.
- WP25 : concurrence réelle de deux `register` et envoi réel de `pg_notify('edge_alert')` à prouver.
- Relecture humaine : `0058` en entier.

## Depuis WP02 (292e3923, ca2b07c5)
- `verifyChain` reste dans l'API ; `request-signature.ts` non déplacé : WP19 tranche (adaptateur sur les mêmes vecteurs, ou déplacement à signaler).
- WP13, WP16 : partir de la lane-b ; liens `node_modules/@cashless/shared-rules`.
- Relecture humaine : `packages/shared-rules/src/edge-content.ts`, `edge-chain.ts`.
- `npm ci --ignore-scripts` dans le checkout principal après la fusion.
