# Passe contradictoire du plan (30/10/2026)

Agent distinct de l'auteur du plan (Sonnet), lecture seule ; 33 constats (3 bloquants, 18 majeurs, 12 mineurs).
Rapport complet : `docs/passation-7/rapports/plan-adversarial.md`. Chaque constat a une suite ; aucun n'est écarté.
« changed » = le plan est corrigé ; « accepted » = constat fondé, intégré tel quel ; « porteur » = soumis au porteur
(règle 1 de `CLAUDE.md`). Les corrections font foi (section R-30 de `research.md`).

| # | Gravité | Constat (résumé) | Suite | Disposition |
|---|---|---|---|---|
| A1 | Bloquant | `online_status = CONFIRMED` (non signé) éteint toute la conformité, même si l'opération en ligne est introuvable | Exemption seulement si la transaction en ligne existe ; introuvable → `ONLINE_CONFIRMED_MISSING` ET conformité complète (renforcement, R-30.1) | changed |
| A2 | Bloquant | Tables nouvelles écrivables par `cashless_app` (`GRANT … ON ALL TABLES` de `roles.sql`) | `REVOKE INSERT, UPDATE, DELETE` explicite sur chaque table nouvelle, `SELECT` seulement si l'API lit ; test générique « aucune table de la mission écrivable par `cashless_app` » (R-30.2) | changed |
| A3 | Bloquant | Quatre tables sans `operator_id` ni RLS | `operator_id` + `tenant_isolation` forcée sur toutes les tables nouvelles ; `SELECT` direct refusé à `cashless_app` sur le contenu et les enveloppes (lecture par fonctions) ; balayage d'isolation (R-30.2) | changed |
| A4 | Majeur | Exposition mesurée sur `recorded_at` interne au lot, comparé à une date du terminal | Référence = `min(occurred_at_corrigé, received_at du lot)` ; « rendu » = `offline_batch.completed_at` (lot) ou heure de réponse en ligne (R-30.3) | changed |
| A5 | Majeur | `recorded_at` de §7.4 non fixé | `recorded_at` = `offline_batch.received_at` pour tout le lot (heure d'approbation pour un import) (R-30.3) | changed |
| A6 | Majeur | Ancienne `config_id` plus permissive citable indéfiniment | `config_id` = dernière configuration servie au terminal avec `served_at ≤ occurred_at_corrigé + tol` ; plus ancienne → `POLICY_LIMIT_EXCEEDED` (R-30.4) | changed |
| A7 | Majeur | Snapshot plus ancien que le dernier accusé citable | Historique des accusés `offline_snapshot_ack` ; version citée < dernière accusée avant `occurred_at − tol` → `SNAPSHOT_VERSION_UNKNOWN` (R-30.4) | changed |
| A8 | Majeur | Comparaisons d'horloge sans tolérance | `+ tol` partout (`served_at`, inscription, âge ≤ `âge_max + tol`) ; test à −100 s (R-30.4) | changed |
| A9 | Majeur | Aucune version de maintien : expiration à 15 min sans changement | Version de maintien (`DELTA` vide) à `valid_until/3` tant qu'un terminal est éligible ; production à l'éligibilité (R-30.5) | changed |
| A10 | Majeur | Un `DELTA` relit toute la source (coût d'un `FULL`) | Source incrémentale (bracelets touchés depuis le curseur) pour les `DELTA` ; mesure « un blocage parmi 50 000 → ≤ 5 s » (R-30.5) | changed |
| A11 | Majeur | Curseurs `bigserial` sautent un blocage validé tard | Fenêtre de recouvrement de 5 s sur `at`, dédoublonnage par empreinte d'entrée ; test de transaction longue (R-30.5) | changed |
| A12 | Majeur | Rattrapage pas à pas | Dernier `FULL` servi si plus de 5 pas ou si un `FULL` plus récent que `b` existe ; mesure après 1 h d'absence (R-30.5) | changed |
| A13 | Majeur | Délais des rôles de processus incompatibles avec le `FULL` | Délais propres aux rôles snapshots ; calcul et appels KMS hors transaction ; inscription courte par paquets (R-30.6) | changed |
| A14 | Majeur | Verrou de lot sur le pool de 10 connexions | Pool dédié aux lots (`OFFLINE_BATCH_POOL_SIZE`, 20) ; pool plein → `503` + `Retry-After` ; limite documentée ; test à 50 lots (R-30.7) | changed |
| A15 | Majeur | Un processus cumule Decrypt + DataKey + Sign | **Porteur** (DM `01M664RXTFR2Q90H3M0A190C20`) : deux processus, `snapshot-content` (Decrypt + DataKey) et `snapshot-signer` (Sign seul) (R-30.8) | changed (porteur) |
| A16 | Majeur | Terminal `SUSPENDED` reçoit des enveloppes | Enveloppes pour `ACTIVE` seulement ; `GET` d'un suspendu → `403 DEVICE_SUSPENDED` ; ses lots restent traités (renforcement) (R-30.9) | changed |
| A17 | Majeur | Enveloppe sans empreinte de la clé d'accord | `agreement_key_sha256` dans la clé de `offline_snapshot_key` ; enveloppe périmée → `409` + nouvelle enveloppe (R-30.9) | changed |
| A18 | Mineur | Enveloppes tardives pour toutes les versions conservées | Dernier `FULL` et versions postérieures seulement (R-30.9) | changed |
| A19 | Mineur | `ETag` et cache ignorent l'enveloppe | `ETag` = version + terminal + empreinte de clé d'accord ; `Cache-Control: private` ; `304` à jour (R-30.9) | changed |
| A20 | Mineur | `pwd_pack_enc` hors du contenu signé | Chaque entrée porte `pwd_pack_sha256` (empreinte du chiffré) dans le contenu signé ; écart au §4.1-3 consigné (renforcement) (R-30.9) | changed |
| A21 | Majeur | Import approuvé à l'aveugle, signatures non revérifiées | Demande avec `sha256(batches)`, nombre d'opérations, total, plage de numéros ; empreinte, signatures et chaîne revérifiées à l'exécution (R-30.10) | changed |
| A22 | Majeur | Import sans état `PROCESSING` ni reprise | `PROCESSING` + reprise par opération, travailleur `journal-import` de l'API ; conflit avec un lot en vol traité (R-30.10) | changed |
| A23 | Majeur | Dates d'import fixées par le terminal révoqué | Opérations datées après la dernière présence serveur listées et signalées à l'approbation, total affiché ; postérieures à la révocation rejetées (R-30.10) | changed |
| A24 | Majeur | `complete_offline_batch` affaiblie | **Porteur** (DM `01M664S4Y4FW6W6TMP76BQGWV7`) : trace `RETRY` écrite par la base (`offline_batch_retry`), seule admise ; alerte 24 h ; écart consigné (ADR) ; R-01 et `plan.md` corrigés (R-30.11) | changed (porteur) |
| A25 | Mineur | Résultats non reconstructibles après panne | Résultat de chaque opération écrit dans sa transaction (`offline_op_result`) ; §13-2 compare octet pour octet (R-30.7) | changed |
| A26 | Mineur | Course reprise / abandon | Statut du lot relu à chaque opération ; `ABANDONED` → résultats du registre rendus (R-30.7) | changed |
| A27 | Mineur | Colonne `encrypted` inexistante | Colonnes réelles de `tag_data_key` (`encrypted_dek`, …) ; liste figée (R-30.12) | changed |
| A28 | Mineur | Droits sans appelant | `mark_seq_gap_alerted`, `event_sync_deadline` retirés à `cashless_app` ; chaque `EXECUTE` justifié par un appelant (R-30.12) | changed |
| A29 | Mineur | Rôle du défaut global ; 41 suites | Défaut posé pour le rôle propriétaire de `migrate.ts` (`DATABASE_URL_OWNER`) en CI comme en production ; test par rôle de migration ; 41 suites décomptées (R-30.12) | changed |
| A30 | Mineur | `wallet_status_history` sans état de départ | Ligne de départ à la migration pour les portefeuilles bloqués ; `t_blocage` inconnu → traité comme bloqué avant (manque) (R-30.13) | changed |
| A31 | Mineur | FR-043 et NFR-010 mal portés ; §13-4/5 non reportés | Ajoutés aux IC ; §13-4 et §13-5 déclarés en mission 8 (PROMPTS) (R-30.13) | changed |
| A32 | Mineur | R-30 vide, fichier absent | Rempli ; ce fichier | changed |
| A33 | Mineur | Production sans clé : boucle `409` | Sans clé `ACTIVE` : `403 OFFLINE_NOT_ALLOWED` (détail `SNAPSHOTS_UNAVAILABLE`) et `offline_enabled` faux dans la configuration servie (R-30.9) | changed |
