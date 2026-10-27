# Relecture WP05 — Demandes de paiement QR (migration 0034) — cycle 1

Relecteur distinct (claude), commit relu `e91f142d` (lane-e). Fichiers :
`packages/ledger-sql/migrations/0034_payment_requests.sql`, `packages/ledger-sql/tests/tests_payment_requests.sql`.

## Verdict : REJETÉ (tests seulement, le code de 0034 est bon)

Aucun défaut de sécurité trouvé dans le code. Rejet pour deux tests qui ne prouvent pas ce que leur
nom dit (deux contrôles de sécurité sans aucune preuve) et quelques contrôles non testés. La correction
porte seulement sur `tests_payment_requests.sql` : cycle 2 court.

## Preuves rejouées

- Base `cashless_wp05r` (supprimée ensuite) : `reset-db.sh` code 0 ; `pg_prove tests/tests_payment_requests.sql`
  donne `Tests=131, PASS`. Batterie complète non rejouée ici (faite par l'orchestrateur : 37 fichiers,
  2652 PASS ; Jest 1705/0).
- Mutants : 45 mutants appliqués par `CREATE OR REPLACE` sur ma base (outil vérifié : un mutant neutre
  survit, un mutant réel est tué). 31 tués, 14 survivants : 6 équivalents ou impossibles à tester en
  pgTAP (voir plus bas), 8 contrôles réels non prouvés (constats 1 à 4).

## Constats

1. **Majeur** — `tests_payment_requests.sql:427-429` « verrouillage : vendeur désactivé (CL037) » ne
   prouve rien. La demande `tok-m9` est déjà refusée parce que sa session `34fb008` a été close
   juste avant (l. 424). Mutants qui survivent : retrait de `v.status <> 'ACTIVE'` et retrait de
   `v.locked_at IS NOT NULL` dans `lock_payment_request_for_pay` (0034:300). Échec possible : un
   vendeur désactivé ou bloqué (PIN) peut encaisser un QR commerçant au niveau de ce contrôle. Ce
   n'est rattrapé qu'en aval, par `record_sale_attribution` à la confirmation. Correction attendue :
   rouvrir la session, puis désactiver le vendeur (un cas). Ajouter un cas vendeur bloqué
   (`failed_attempts = 5, locked_at = now()`, contrainte `vendor_locked`), chacun avec son témoin.
2. **Majeur** — `tests_payment_requests.sql:572-573` « QR client : demande commerçant présentée comme
   QR client (CL037) » ne prouve rien. `tok-m1` a été confirmée l. 562, donc le refus vient de
   `status`. Mutant qui survit : retrait de `r.direction <> 'CUSTOMER_QR'` dans
   `lock_customer_qr_token` (0034:334). Échec possible : une demande `MERCHANT_QR` encore `PENDING` qui
   porte un `wallet_id` (écrit par `lock_payment_request_for_pay`) serait acceptée au terminal comme
   QR client, et le terminal débiterait ce portefeuille. Correction attendue : utiliser une demande
   commerçant `PENDING` dont `wallet_id` est posé (un `lk` réussi dans la même transaction de test),
   puis vérifier le refus.
3. **Mineur** — expiration de la session non testée : mutants « retrait de
   `s.expires_at <= clock_timestamp()` » au verrouillage (0034:299) et à la confirmation
   (0034:419), tous deux survivants. Le cas « session close » existe, pas le cas « session expirée ».
   Correction attendue : un cas pour chacun (poser `expires_at` dans le passé en propriétaire), avec
   son témoin.
4. **Mineur** — trois autres contrôles ne sont pas prouvés. (a) Devise du portefeuille ≠ devise de la
   demande au verrouillage (0034:294). (b) `CUSTOMER_QR` : terminal de la vente affecté à
   l'événement de la demande (0034:426-430, un renforcement de l'implémenteur). (c) `s.device_id <>
   r.device_id` à la confirmation (0034:418 ; quasi équivalent, car la session est contrôlée contre
   le terminal à la création). Correction attendue : un cas pour (a) et un pour (b) ; (c) est
   facultatif.
5. **Mineur (non bloquant)** — `payment_request_for_token` est déclarée `STABLE` alors qu'elle lit
   `clock_timestamp()`, qui est volatile (0034:481). C'est sans effet pour un appel unique, mais
   c'est incohérent. Suggestion : retirer `STABLE`.

Mutants survivants équivalents ou non testables en pgTAP (aucune action) : `t.ledger_id <> w.ledger_id`
(impliqué par le débit d'un compte du portefeuille et les clés composites de `posting`) ; filtre
prestataire sur la demande dans `lock_payment_request_for_pay` (déjà filtrée à l'étape 1) ; filtre
prestataire sur le portefeuille (le grand livre d'un autre prestataire est relu avec le filtre, donc
refusé : défense en profondeur conservée) ; `NOWAIT` (il faut deux sessions : WP13 et WP14).

## Points examinés en priorité (demande de l'orchestrateur)

- (a) `payment_request_for_token(p_id, p_nonce_hash)` est plus stricte que la forme à un paramètre, et
  sans oracle. Une demande inconnue, une demande d'un autre prestataire ou une mauvaise empreinte
  donnent le même `CL037` et le même message. Aucun verrou n'est pris et le chemin d'exécution est le
  même (une lecture par la clé primaire). `nonce_hash` n'est jamais rendu. C'est compatible avec
  `GET /payment-requests/{id}` (l'identifiant est dans l'URL). **À faire par l'orchestrateur** :
  aligner l'arbitrage, `contracts/database-rights.md` et WP07 sur la signature `(uuid, bytea)`.
- (b) L'écriture de `wallet_id` dans `lock_payment_request_for_pay` est sans faille trouvée.
  - Il faut l'empreinte pour l'écrire. L'écriture se fait sous `FOR UPDATE`, sur une demande
    `PENDING`, non expirée.
  - Avec A10 (verrouillage, moteur et confirmation dans une seule transaction), elle n'est jamais
    validée sans la confirmation. Elle est réécrite à chaque verrouillage : personne ne peut
    « réserver » la demande.
  - Deux payeurs simultanés se sérialisent sur la demande. En READ COMMITTED, le second relit la
    ligne à jour (`CONFIRMED`) et reçoit `CL037`.
  - Un déni de service n'est possible que pour la durée d'une transaction de l'API, et seulement
    avec l'identifiant.
  - Payer avec un autre portefeuille est impossible : `confirm_payment_request` exige l'empreinte et
    une vente qui débite exactement le `wallet_id` posé, sans autre portefeuille.
  - Risque résiduel : si l'API validait un verrouillage sans confirmation, un `wallet_id` périmé
    resterait sur une demande `PENDING`. Il est neutralisé par le contrôle `direction` de
    `lock_customer_qr_token` (d'où le constat 2). **Report WP13** : un test qui prouve que
    verrouillage, moteur et confirmation tiennent dans une seule transaction.
- (c) Montant débité : la somme nette des postings sur les comptes `WALLET_PAID`/`WALLET_PROMO` de CE
  portefeuille, avec aucun autre portefeuille touché. C'est conforme à `contracts/qr-payments.md`
  (« PURCHASE du montant, du portefeuille ») et à la convention du schéma (+ = débit). Le renvoi du
  prompt vers « même définition que `record_sale_lines` » est faux, car `record_sale_lines` compte le
  crédit `MERCHANT`, qui diffère si des frais sont postés dans la vente. Le choix de l'implémenteur
  est le bon. **À faire par l'orchestrateur** : corriger la rédaction de T023 ou du data-model.
  Contradiction signalée, non tranchée en silence.
- (d) Points vérifiés :
  - le jeton n'est gardé que haché (`bytea` de 32 octets, test de forme) ;
  - usage unique : seconde confirmation et second verrouillage refusés ;
  - client 60 s fixes, commerçant 15 à 300 s (bornes tuées par mutants) ;
  - refus comparés au même message (`throws_ok` avec le message exact) ;
  - isolation entre prestataires (section 8, plus le filtre `operator_id` partout) ;
  - les 7 fonctions sont `SECURITY DEFINER`, `SET search_path = public, pg_temp`, avec
    `REVOKE ALL … FROM PUBLIC` ; aucun `GRANT` ;
  - aucun `ALTER TABLE payment_request` ;
  - ordre des verrous conforme : lecture sans verrou, puis terminal, vendeur, session, demande,
    portefeuille. Le moteur ne prend pas la ligne du portefeuille (0033), donc pas de montée de
    `FOR SHARE` vers `FOR UPDATE`.
  Vingt paiements simultanés : sûr par construction (sérialisation `FOR UPDATE` et relecture du
  statut) ; la preuve reste à WP13 et WP14, comme le prévoit le lot.
- (e) Tests : voir les mutants ci-dessus et les constats 1 à 4.

## Remarques hors rejet

- Annulation par le festivalier avec le jeton (contrat A10) : le jeton d'un QR commerçant s'affiche
  sur l'écran du terminal, donc un passant qui le scanne peut annuler la demande. Cette nuisance est
  voulue par le contrat. À connaître pour WP13 et le porteur.
- Le verrouillage prend les verrous avant de contrôler l'empreinte : quelqu'un qui connaît seulement
  l'identifiant peut retenir brièvement la ligne. C'est négligeable, et c'est le prix de l'ordre
  global des verrous.

## Liste anti-motifs

1. Code mort : PASS. Fonctions SQL appelées par WP11 et WP13 (lots aval prévus) ; pas d'appelant
   TypeScript à ce stade, ce qui est attendu pour un lot de base.
2. Faux-semblant de test : **FAIL**. Deux cas ne passent pas par le contrôle qu'ils nomment
   (constats 1 et 2).
3. Retour vide silencieux : PASS.
4. Couverture des exigences : PASS (FR-018, FR-019, FR-020, NFR-007 et NFR-008 côté base ; NFR-005
   partiel, comme prévu).
5. Surface gelée : PASS (aucun `.sql` généré, `payment_request` inchangée).
6. Décision verrouillée : PASS (aucun `GRANT`, jeton jamais en clair, `CL037` unique).
7. Fichiers partagés : PASS (fichiers propres au lot).
8. Fragilité en production : PASS (`55P03` traduit en `CL037`, `23505` laissé, comme voulu).

## Fichiers à faire relire par une personne

`packages/ledger-sql/migrations/0034_payment_requests.sql` : droits de la base, `SECURITY DEFINER`,
liaison de la confirmation à la vente. Un agent relecteur ne vaut pas relecture humaine.
