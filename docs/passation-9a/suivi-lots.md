# Suivi des lots, mission 9a (remboursements-01M7AG5V)

Notes entre lots : retouches hors carte, écarts au plan (renforce / affaiblit), fichiers à faire relire par une personne.

| Lot | État | Notes |
|---|---|---|
| WP01 | approved (f660b909, lane-a, review-cycle-1) | Index `refund_request_one_open` (WP04 lit 23505 → 409). Renforcements : garde d'insertion `refund_request_scope_guard`, CHECK jumelés (`otp_challenge_purpose_subject`, `AWAITING_HOLDER`/`hold_until`, `BLOCKED`/`BLOCK`, E.164, demandeur ≠ valideur). Hors carte : `tests_definer_trigger_writers.sql` (liste figée). `estimated_amount`/`fee` NOT NULL. Preuves : `tests_refund_requests.sql` 88/88, batterie pgTAP 71 fichiers / 6141. Relecture humaine : `0081`, `post-roles.sql` § 11. Note de lane : le lot a créé sa propre copie de ce fichier (conflit à la fusion, garder les deux sections). |
| WP02 | approved (80b826b2, lane-b, review-cycle-1) | Élargissement dans le moteur (`reversesType`, `readReversedType` sous RLS) ; `post_transaction` intacte ; `0082` = `replace_media` seul (`search_path` public, pg_temp ; UPDATE des anomalies `CASH_TOPUP_OVER_LIMIT` OPEN du même prestataire). Preuves : Jest unit/ledger, integration/ledger, reversals, engine 9 suites / 326 ; pgTAP `tests_replace_cash_due` 39 et voisins 374 ; suites générées 464 ; eslint, prettier, tsc. Remarque hors périmètre : `refund_cash_due` somme par `media_id` sans filtre `operator_id` (sans effet). Relecture humaine : `0082`, `status-matrix.ts`, `checkStatus`/`readReversedType`. |
| WP06 | reprise 16/11 (lane-f) | Prise le 13/11, arrêt sans code (conteneur de test arrêté) ; relancé le 16/11. |
| WP03 | in_progress 16/11 (lane-c) | Lancé le 16/11. |
