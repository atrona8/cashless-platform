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

## Relecture de WP03 (approuvé)
- WP09 (`tests_edge_rights.sql`) : ajouter des cas inter-prestataires pour `rotate`, `swap`, `set_role`, `edge_register_snapshot_key` (retirer `assert_tenant` ne ferait aujourd'hui échouer aucun test) ; isolation réelle de `edge_reference_change` ; retrait des droits par défaut de `cashless_app` sur `edge_gateway` ET `edge_reference_change`.
- Mineurs consignés : `touch_edge_gateway` (passerelle inconnue sans effet, autre prestataire `no_data_found` : oracle faible) ; `register`/`rotate` 23505 sur empreinte prise (outil d'administration seul).
- Matrice d'acceptation : à tenir au fil des lots (orchestrateur), critères de WP03 : FR-002, FR-031 (partie base), FR-037 (partie base), C-009.

## Relecture de WP01 (approuvé, 628487f7)
- WP25 : brancher `check:stability` et `check-baseline-decision.mjs` en CI. Consigner une ligne réelle `Décision du porteur : 05/11/2026 ADR-nnn` pour la référence, avant la fusion. Resserrer `check-baseline-decision.mjs` : exiger la ligne dans le dernier commit qui touche la référence, ou ajoutée au fichier d'ADR par rapport à `main` (aujourd'hui toute ligne ancienne suffit).
- La liste blanche épingle le SHA-256 de chaque sous-arbre ajouté : toute retouche d'un schéma `Edge*` exige une décision du porteur sur `contract-baseline.json`.
- Relecture humaine : `tools/contract-stability/contract-baseline.json`, `check.mjs`.

## Depuis WP04 (f4896911)
- **WP08** : un journal `edge_reference_change` vide pour un grand livre fait REFUSER l'accord (échec fermé). Prévoir une reprise de l'existant ou une ligne d'amorce par grand livre, sinon aucun premier accord ne passe. Test obligatoire.
- WP09 : `fail_edge_grant`, `request_edge_release` du kit sans enveloppe : vérifier leurs droits ; `edge_grant_authority`, `fail_edge_release` à `cashless_app` ; `edge_stuck_handovers` au rôle de maintenance ; internes `edge_bind_gateway`, `edge_lock_handover` jamais accordées.
- WP11 : l'audit `EDGE_AUTHORITY_*` est à l'API ; `force_central_authority_approved` ne contrôle pas `gateway_confirmed_offline` : la route l'exige. `begin_cash_close` lève `CL029` sous `EDGE` : la réponse doit être `409 CONFLICT_STATE` sans changer le sens de `CL029` pour les autres cas.
- WP12 : handover étranger ou inconnu = `CL013`, message identique.
- WP25 : concurrence réelle sur les verrous, livraison réelle du `NOTIFY`, consigner `begin_cash_close` (comportement nouveau hors `/edge/*`, décision 6).
- Renforcements à consigner : `edge_complete_release` exige la même déclaration qu'au début du rendu ; accusé à position nulle refusé ; approbations inutilisables `42501`.
- Relecture humaine : `begin_cash_close`, `edge_grant_authority`, `force_central_authority_approved`, `edge_ack_handover`, `edge_complete_release`.
