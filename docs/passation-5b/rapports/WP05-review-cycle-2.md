# Relecture WP05 — Demandes de paiement QR (migration 0034) — cycle 2

Relecteur distinct (claude), qui n'a écrit ni le code ni la relecture du cycle 1. Commit relu `2ec3dee3`
(lane-e), diff `e91f142d..2ec3dee3`. Le commit suivant de la lane (`b4297377`) ne touche que `kitty-specs/`.

## Verdict : APPROUVÉ

Les cinq constats du cycle 1 sont traités. Chaque contrôle visé est maintenant prouvé par un test qui échoue
quand on retire ce contrôle. 0034 n'est pas affaiblie : la seule différence est `STABLE` -> `VOLATILE` sur
`payment_request_for_token`, plus le commentaire qui l'explique.

## Preuves rejouées (base `cashless_wp05r`, supprimée ensuite)

- `reset-db.sh` : code 0. `pg_prove tests/tests_payment_requests.sql` : `Tests=147, PASS`.
- Batterie complète et Jest : pas rejoués ici. L'orchestrateur les a passés sur `cashless_test` : 37 fichiers,
  2668 PASS ; Jest 1705 réussis, 0 échec.
- Mutants : je les ai écrits moi-même (`scratchpad/wp05r2/mut.py`, sortie dans `scratchpad/wp05r2/mutants.txt`).
  Chacun est appliqué par `CREATE OR REPLACE` depuis le texte de la migration, puis la fonction est restaurée.
  J'ai repris les retraits de l'implémenteur et ajouté des variantes : retrait des deux contrôles du vendeur
  ensemble, `l.currency IS NULL`, `r.direction IS NULL`, `x.event_id IS NOT NULL`, `IF NOT FOUND` -> `IF FALSE`.
  **14 mutants sur 14 tués, chacun par le test qu'il vise. Le mutant neutre survit**, ce qui montre que
  l'outil est fiable. Après restauration : `Result: PASS`.

| Constat du cycle 1 | Contrôle retiré ou faussé | Test qui échoue | Témoin |
|---|---|---|---|
| 1 | `v.status <> 'ACTIVE'` (lock) | 67, vendeur désactivé, session ouverte | vendeur de nouveau ACTIVE |
| 1 | `v.locked_at IS NOT NULL` (lock) | 69, vendeur bloqué (PIN) | vendeur débloqué |
| 2 | `r.direction <> 'CUSTOMER_QR'` (2 variantes) | 106, demande commerçant PENDING avec `wallet_id` posé, état vérifié par un `ok` avant | — (le refus est seul) |
| 3 | `s.expires_at` (lock) | 66, session expirée, non close (un `ok` vérifie `closed_at IS NULL`) | session rouverte |
| 3 | `s.expires_at` (confirm) | 98 | 99, CATALOG_POS |
| 4a | `l.currency <> r.currency` (2 variantes) | 74, portefeuille EUR de d001 | w004 |
| 4b | `x.event_id = r.event_id` (3 variantes) | 116 (et 117, conséquence attendue : c7 déjà confirmée) | 117 |
| 4c | `s.device_id <> r.device_id` (confirm) | 100, session déplacée sur aa03 | 101 |
| 5 | `VOLATILE` -> `STABLE` | 3, sept fonctions VOLATILE | — |

## Contrôle de non-affaiblissement

- `git diff e91f142d 2ec3dee3 -- packages/ledger-sql/migrations/` : 1 ligne de code changée (`VOLATILE`), plus
  2 lignes de commentaire. Aucun `GRANT`, aucun `REVOKE` retiré, `search_path` inchangé, aucun contrôle retiré.
- Fichiers de code modifiés : seulement `0034_payment_requests.sql` et `tests_payment_requests.sql`. Aucun
  `.sql` généré n'est touché.
- Les cas qui ne prouvaient rien sont remplacés ou renommés honnêtement (`tok-m1` devient « déjà payée »).
  Aucune assertion n'a été retirée : on passe de 131 à 147 tests.

## Constats (aucun bloquant)

1. **Mineur, rédaction** : `tests_payment_requests.sql`, témoin 117 « même vente sur un terminal de
   l'événement ». C'est en fait une autre vente (`34fc023`), qui ne diffère que par le terminal. La preuve
   reste valable ; il suffirait de corriger le libellé à l'occasion.
2. **Mineur, antérieur au cycle 2** : deux lignes dépassent 100 caractères (migration l. 47, 104 car. ;
   tests l. 721, 101 car.). Le reformatage Prettier est prévu à la fusion.

## Liste anti-motifs

1. Code mort : PASS. Les fonctions SQL seront appelées par WP11 et WP13, ce qui est attendu pour un lot de
   base.
2. Faux-semblant de test : PASS. Les deux cas du cycle 1 sont corrigés, et les mutants le prouvent.
3. Retour vide silencieux : PASS.
4. Couverture des exigences : PASS (FR-018, FR-019, FR-020, NFR-007 et NFR-008 côté base ; NFR-005 partiel,
   comme prévu, avec WP13 et WP14).
5. Surface gelée : PASS.
6. Décision verrouillée : PASS (aucun `GRANT`, jeton jamais en clair, `CL037` unique).
7. Fichiers partagés : PASS (fichiers propres au lot).
8. Fragilité en production : PASS.

## Écarts de sécurité ouverts

Aucun nouveau. Les reports du cycle 1 (signature `(uuid, bytea)` pour WP07 et WP13, transaction unique à
prouver en WP13, rédaction de T023) sont déjà faits par l'orchestrateur.

## Fichiers à faire relire par une personne

`packages/ledger-sql/migrations/0034_payment_requests.sql` : droits de la base, `SECURITY DEFINER`, liaison
de la confirmation à la vente. Un agent relecteur ne vaut pas relecture humaine.
