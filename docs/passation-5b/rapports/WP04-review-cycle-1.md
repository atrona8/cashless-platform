# WP04 — relecture, cycle 1 (relecteur distinct)

Lot : « Paiement, annulation, approbation sur place » (migration 0033). Lane
`.worktrees/terminaux-paiement-en-ligne-01M52QB9-lane-d`, commit d'implémentation `f46a5d2b`
(seuls fichiers : `packages/ledger-sql/migrations/0033_payments.sql`,
`packages/ledger-sql/tests/tests_payments.sql`).

## Verdict : APPROUVÉ (constats mineurs, aucun bloquant)

## Vérifications faites

- **(a) Paramètres optionnels `p_jti` / `p_approval_request` : pas de contournement par NULL.**
  - Contrôle de forme : `SUPERVISOR_DEVICE` sans `p_jti` → CL001 ; `BACKOFFICE` sans
    `p_approval_request` → CL001 ; `VENDOR` avec `p_jti` ou `p_approval_request` → CL001 ; un
    paramètre d'un autre mode → CL001 (0033_payments.sql:391-400).
  - Défense en profondeur : même sans ce contrôle de forme, `u.jti = NULL` et `q.id = NULL` ne
    trouvent aucune ligne, donc `NOT EXISTS` → CL036. NULL ne peut pas lever la preuve.
  - La preuve `SUPERVISOR_DEVICE` lie le jeton à l'opération `reversePayment`, au terminal, à la
    session, à la vente (`target_id`), à la transaction en cours (`used_at >= now()`) et à un
    valideur ACTIVE qui détient SUPERVISOR sur l'événement ou son organisateur. La preuve
    `BACKOFFICE` demande une requête SALE_REVERSAL APPROVED du prestataire, visant la vente
    (`target_id` et `payload`), avec deux personnes distinctes ACTIVE qui ont le rôle. Les
    requêtes naissent PENDING (déclencheur `approval_request_born_pending`, antérieur) et ne
    passent APPROVED que par `decide_approval_request`.
- **(b) SECURITY DEFINER** : les 5 fonctions portent `SET search_path = public, pg_temp`, avec
  `REVOKE ALL … FROM PUBLIC`. Constaté sur la base après post-roles : ACL `postgres=X` seul pour les
  4 nouvelles. `consume_tap` garde `cashless_app=X`, comme avant. Aucun GRANT dans 0033. Aucun
  déclencheur SECURITY DEFINER.
  - `consume_tap` : le corps de 0026 est identique, ligne à ligne (diff) ; seul ajout, le contrôle
    A18.
  - Verrous : le verrou consultatif `media-tap-use:` est pris d'abord dans `assert_tap_payable`
    (ensuite bracelet FOR SHARE) et dans `consume_tap`. `assert_reversible` prend le vendeur puis
    la session FOR SHARE, ce qui respecte l'ordre global ; aucun FOR UPDATE après un FOR SHARE.
    Une double annulation est arrêtée par l'index unique `journal_transaction_reverses_once`
    (testé : nom et 23505). Un double paiement sur une même lecture est arrêté par le verrou
    consultatif plus `transaction_id`.
  - Isolation entre prestataires : chaque lecture est filtrée sur `app.operator_id` ; un objet
    d'un autre prestataire renvoie P0002 (testé). Pas de calcul de montant dans ce lot.
- **(c) Mutants** : 11 essais sur ma base `cashless_wp04r`, supprimée depuis. 9 sont tués, 2
  survivent (constats 2 et 3).
  - Tués : retrait de `used_at >= now()`, du contrôle A18 de `consume_tap`, de l'état de
    l'événement, de `tx.device_id = s.device_id` dans l'attribution, du terminal dans
    `assert_tap_payable`, du vendeur de la vente en mode VENDOR, de `target_id`, de « déjà
    annulée » ; remplacement de `count = 2` par `>= 1`.
  - La suite passe : `tests_payments.sql` donne 105/105 PASS. La batterie complète (2521) et Jest
    ont été rejoués par l'orchestrateur.
- **(d) LIVE/CLOSING** : contrôlé sur les trois modes, avant toute logique propre à un mode
  (0033_payments.sql:415-418). RECONCILING est testé en VENDOR et en SUPERVISOR_DEVICE.
- La liste `approval_request_action_check` est celle de 0011 à l'identique, plus `SALE_REVERSAL`
  (diff des listes triées). Aucun fichier généré n'est modifié. ADR-123 est respecté : la fenêtre
  est contrôlée en dernier, avec CL040 ; un autre vendeur hors fenêtre reçoit CL036 (testé).

## Constats

1. **Mineur, à reporter à WP07.** `sale_attribution` : `roles.sql:15` donne
   `INSERT, UPDATE ON ALL TABLES` à `cashless_app` (UPDATE est bloqué par `forbid_mutation`).
   Un INSERT direct contourne `record_sale_attribution`, et `vendor_id` n'est lié à la session par
   aucune clé : la clé composite porte `(vendor_session_id, device_id, operator_id)` seulement
   (0033_payments.sql:85-86).
   - Scénario : une API défaillante ou compromise attribue une vente à un autre vendeur, qui peut
     ensuite l'annuler en mode VENDOR, puisque `assert_reversible` relit
     `sale_attribution.vendor_id`.
   - Bornes actuelles : RLS sur le prestataire, et une session qui appartient bien au terminal.
   - Correction attendue (WP07) : `REVOKE INSERT, UPDATE ON sale_attribution FROM cashless_app`
     (écriture seulement par `record_sale_attribution`). Durcissement possible ici ou en WP07 :
     ajouter `vendor_id` à la clé composite, avec
     `UNIQUE (id, device_id, operator_id, vendor_id)` sur `vendor_session`.
2. **Mineur (test).** `assert_reversible` : la session expirée (`expires_at`) n'est pas testée
   (mutant survivant, 0033_payments.sql:432). Seule la session close l'est. Correction attendue :
   un cas de session expirée → CL036.
3. **Mineur (test).** Mode SUPERVISOR_DEVICE : le retrait de `r.role = 'SUPERVISOR'`
   (0033_payments.sql:466) survit. Le valideur j33-5 n'a aucun rôle, ce qui ne distingue pas un
   valideur qui aurait un autre rôle (CASHIER, ORGANIZER_ADMIN) sur l'événement. Correction
   attendue : un jeton dont le valideur a un rôle autre que SUPERVISOR sur l'événement → CL036.
4. **Mineur, informatif, pour WP12 et la relecture humaine.** `approval_token_use` est inséré par
   l'API, qui peut renseigner `used_at`, `approver_id` et `target_id`. La preuve en base est donc
   aussi solide que la vérification du JWT par l'API. Elle borne bien le rejeu (jti unique,
   `target_id`, annulation unique), mais ne remplace pas cette vérification. WP12 doit insérer
   sans renseigner `used_at` (valeur par défaut `clock_timestamp()`).
5. **Informatif.** En BACKOFFICE, l'`expires_at` de la demande n'est pas recontrôlé après
   l'approbation, comme dans le modèle 0017. La demande passe EXECUTED, et l'annulation est unique
   de toute façon.

## Liste anti-motifs

1. Code mort : N/A. Couche base ; les appelants sont dans les lots dépendants (WP05, WP11, WP12).
2. Faux de test : PASS. Les tests appellent les vraies fonctions ; les mutants le confirment.
3. Retour vide silencieux : PASS.
4. Couverture des FR : PASS (FR-006, FR-010 et FR-016/017 côté base, NFR-005 par l'index, NFR-006
   par refus sans écriture).
5. Surface figée : PASS (aucun `.sql` généré touché).
6. Décision verrouillée : PASS (aucun GRANT, pas de déclencheur SECURITY DEFINER).
7. Fichiers partagés : PASS (deux fichiers propres au lot).
8. Fragilité en production : PASS (RAISE avec code SQLSTATE documenté).

## Défauts antérieurs à la mission

Aucun constaté dans le périmètre relu.

## À faire relire par une personne

`packages/ledger-sql/migrations/0033_payments.sql`, en particulier `assert_reversible` (preuves
d'approbation) et la clé composite de `sale_attribution`.
