# Compte rendu du lot WP05 : Demandes de paiement QR (migration 0034), cycle 2

Implémenteur : claude. Lane : lane-e. Commit **2ec3dee3** (sur 93f86ff1, qui contient e91f142d).
Le runtime a été relancé sans incident (`spec-kitty agent action implement WP05`) : WP05 a été repris, sans
refus du garde kitty-specs, donc sans réalignement. T021 à T024 sont remarquées done. Je n'ai pas fait de
`move-task`.

## Ce qui a changé

Fichiers du lot seulement : `packages/ledger-sql/migrations/0034_payment_requests.sql` et
`packages/ledger-sql/tests/tests_payment_requests.sql`.

- **Constat 5** : `payment_request_for_token` est maintenant `VOLATILE` au lieu de `STABLE`, avec un
  commentaire. Un test de forme vérifie que les 7 fonctions sont `provolatile = 'v'`.
- **Constat 1** : la session `s008` est rouverte, puis un témoin passe. Viennent ensuite les cas
  « vendeur désactivé » et « vendeur bloqué » (`failed_attempts = 5, locked_at = now()`, vendeur
  toujours ACTIVE), chacun suivi de son témoin. L'ancien cas, qui ne prouvait rien, est remplacé.
- **Constat 2** : nouveau cas avec une demande commerçant `tok-q12`. Un `ok` vérifie d'abord son
  état : PENDING, `wallet_id` posé par le verrouillage, événement d001, non expirée. Puis
  `lock_customer_qr_token` doit la refuser au terminal aa01. L'ancien cas `tok-m1` est gardé, mais
  renommé « déjà payée ».
- **Constat 3** : session expirée sans être close, au verrouillage (s008) et à la confirmation (s001),
  chacune avec son témoin. Deux aides `pg_temp.expire_session` et `renew_session` respectent la
  contrainte `vendor_session_ttl` (12 h exactes).
- **Constat 4a** : nouveau grand livre EUR de d001 (`cc004`) avec le portefeuille `w007`. Le
  verrouillage de la demande XOF `tok-m3` est refusé, puis le témoin existant (w004) passe.
- **Constat 4b** : QR client `tok-c7` dont la vente porte le terminal aa07 (événement d002), alors que
  la vente et la demande sont sur d001. La confirmation est refusée. Le témoin avec aa01 passe.
- **Constat 4c (facultatif, fait)** : nouveau terminal aa09 avec sa session `s010`. La session est
  déplacée sur aa03 entre le verrouillage et la confirmation, et la confirmation est refusée. Le
  témoin passe une fois la session rendue à aa09. Il fallait une session neuve : celle de aa02 est
  référencée par `sale_attribution` (clé étrangère composite), donc on ne peut pas changer son
  terminal.

## Preuves (base `cashless_wp05`, supprimée ensuite)

- `pg_prove tests/tests_payment_requests.sql` : **Tests=147, PASS** (131 au cycle 1, soit 16 de plus).
- `reset-db.sh` (code 0), puis `scripts/test-pgtap.sh` : **Files=37, Tests=2668, PASS**.
- Mutants : chaque mutant est appliqué par `CREATE OR REPLACE` depuis le texte de la migration, puis la
  base est restaurée. Script : `scratchpad/wp05_mutants.py`. Sortie complète :
  `scratchpad/rapports/WP05-mutants-cycle-2.txt`. Sur 9 mutants, **9 sont tués**, chacun par le test
  qu'il vise. Un mutant neutre survit, ce qui montre que l'outil est fiable.

  | Contrôle retiré | Test qui échoue |
  |---|---|
  | `v.status <> 'ACTIVE'` (lock) | 67 « vendeur désactivé, session ouverte » |
  | `v.locked_at IS NOT NULL` (lock) | 69 « vendeur bloqué (PIN) » |
  | `s.expires_at <= clock_timestamp()` (lock) | 66 « session expirée, non close » |
  | `l.currency <> r.currency` (lock) | 74 « portefeuille d'une autre devise » |
  | `r.direction <> 'CUSTOMER_QR'` (lock_customer_qr_token) | 106 « demande commerçant PENDING avec portefeuille posé » |
  | `s.expires_at <= clock_timestamp()` (confirm) | 98 « session expirée, non close » |
  | `s.device_id <> r.device_id` (confirm) | 100 « session sur un autre terminal » |
  | `x.event_id = r.event_id` (confirm, CUSTOMER_QR) | 116, et 117 par contrecoup |
  | `VOLATILE` remis en `STABLE` | 3 « sept fonctions VOLATILE » |

## Écarts, retouches hors carte, points soumis

- **Écarts au plan** : aucun. Le passage de `STABLE` à `VOLATILE` corrige une incohérence et ne
  change aucun droit.
- **Retouches hors carte** : aucune.
- **Points soumis** : aucun nouveau. Les reports du cycle 1 restent à l'orchestrateur : signature
  `(uuid, bytea)` pour WP07 et WP13, rédaction de T023 sur le montant débité, et test de la
  transaction unique pour WP13.
- **Lignes de plus de 100 caractères** : aucune nouvelle. Deux lignes du cycle 1 dépassent encore
  (tests l. 712, migration l. 47).

## Fichiers à faire relire par une personne

`packages/ledger-sql/migrations/0034_payment_requests.sql` : droits, `SECURITY DEFINER`, liaison de la
confirmation à la vente. Un agent ne vaut pas relecture humaine.
