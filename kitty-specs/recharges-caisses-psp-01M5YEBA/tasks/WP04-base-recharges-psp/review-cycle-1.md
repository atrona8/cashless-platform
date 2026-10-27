---
affected_files: []
cycle_number: 1
mission_slug: recharges-caisses-psp-01M5YEBA
reproduction_command:
reviewed_at: '2026-10-27T15:26:48Z'
reviewer_agent: user
wp_id: WP04
---

# Revue WP04 (commit eea02fd2) - verdict : rejet (1 constat bloquant)

## Bloquant
1. [Majeur, double crédit] `psp_complete_core` (0038, bloc "Anomalie liée") fait
   `UPDATE anomaly SET status='RESOLVED', resolution_tx_id=p_tx WHERE id = t.anomaly_id` sans condition
   sur l'état. Une anomalie PSP_TOPUP_NOT_CREDITED peut déjà avoir été fermée par une écriture
   ANOMALY_RESOLUTION validée à deux (qui rend l'argent ou crédite le portefeuille). Un succès tardif
   (FAILED/EXPIRED/CANCELLED -> SUCCEEDED, R-20) crédite alors une seconde fois ET écrase la
   `resolution_tx_id` humaine (piste d'audit perdue). Contraste : `attach_chargeback_tx` garde bien
   `AND status = 'OPEN'`.
   Correction attendue : si `t.anomaly_id` n'est pas NULL et que l'anomalie n'est plus OPEN, refuser la
   complétion (CL029, la recharge reste en l'état pour décision humaine) ; ne fermer que `status='OPEN'`.
   Ajouter un test : anomalie résolue à la main puis succès tardif -> CL029, pas de second crédit,
   `resolution_tx_id` inchangée.

## Mineurs (non bloquants)
2. `unblock_wallet` compare `decided_at` à `psp_chargeback.created_at`, pas à l'instant du blocage
   (`block_wallet_after_chargeback` est un appel postérieur) : une demande approuvée entre
   l'enregistrement de la contestation et le blocage débloque ce blocage. Il faut deux ORGANIZER_ADMIN ;
   à durcir (horodater le blocage) ou à consigner.
3. Tests faibles : `cmp_ok(purge_psp_event_bodies(), '>=', 1)` et `cmp_ok(count, '<=', 2)` (borne du compteur
   de refus) passent aussi à 0/valeur large ; les assertions voisines compensent en partie.
   `psp_event_purge_shape` est une tautologie (toujours vraie).
4. `fee_amount` fourni n'est pas rapproché du net réellement crédité (brut - net) : seulement 1 <= net <= brut.
5. Fonctions neutres (`psp_poll_candidates`, `psp_events_to_retry`) rendent les lignes de TOUS les
   prestataires (références de paiement, `normalized`) à tout appelant EXECUTE ; prévu par
   contracts/database-rights.md (accordées à cashless_app) ; à signaler au porteur pour WP05.
6. `read_psp_event_body` : audit écrit dans la même transaction, avant le retour du corps - correct ;
   mais `p_actor` est fourni par l'appelant (contrôle OPERATOR_ADMIN actif seulement). WP05 doit
   retirer le SELECT de `psp_event.body` à cashless_app, sinon le corps se lit sans audit.

## Preuves relancées (cashless_wp04, après reset-db)
tests_psp_topups 284 ok ; tests_definer_trigger_writers 25 ok ; tests_payments 109 ok ;
tests_definer_search_path 14 ok ; tests_psp_configurations 165 ok ; tests_execute_grants 30 ok sous psql
(pg_prove échoue seulement car le conteneur ne trouve pas ../roles.sql : limite du poste, pas du lot).
