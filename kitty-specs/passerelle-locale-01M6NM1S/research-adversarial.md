# Passe contradictoire du plan : suite donnée aux 29 constats

Source : `docs/passation-8/rapports/plan-adversarial.md` (A01 à A29, relecteur indépendant). Décisions du porteur qui font foi :
`docs/passation-8/contexte-m8.md`, décisions 11 à 18 (05/11/2026). Chaque constat a été revérifié dans le code avant correction (références
dans la colonne « Vérification »).

Légende de la colonne **Suite** : **corrigé** = artefact corrigé sans décision nouvelle ; **décision du porteur** = corrigé selon une décision 11 à 18
(écart accepté, avec OP et ADR) ; **reporté** = partie renvoyée à une mission ou à la procédure de site, dite explicitement.

## Décompte

| Suite | Nombre | Constats |
|---|---|---|
| corrigé | 23 | A02, A03, A04, A05, A06, A08, A10, A11, A13, A14, A15, A17, A18, A19, A20, A22, A23, A24, A25, A26, A27, A28, A29 |
| décision du porteur | 6 | A01 (décision 11), A07 (13), A09 (14), A12 (15), A16 (16), A21 (17) |
| reporté (constat entier) | 0 | aucun |
| restes reportés ou à soumettre (parties de constats déjà corrigés) | 5 | voir fin de fichier |

A02 est corrigé (schéma unique) et applique aussi les décisions 12 (`after_change_seq`) et 18 (audit versé au central).

## Tableau

| N° | Gravité | Constat | Suite | Où c'est traité | Vérification faite dans le code |
|---|---|---|---|---|---|
| A01 | BLOQUANT | Jeton d'appareil de la passerelle expire en 15 min, rafraîchissement suspendu, clés du central non répliquées, phrase fausse sur `aud` | décision du porteur (11) | `research.md` R-19 ; `contracts/replication-page-additions.yaml` (`EdgeDevice.token_family`) ; `OP-N101`, `OP-N102`, `ADR-156`, `ADR-157` | `device-token.service.ts:118` (comparaison du `kid`) et `:124` (audience) : le contrôle central existe déjà, la mission le prouve, ne l'ajoute pas ; clés du central non répliquées |
| A02 | BLOQUANT | Deux schémas de flux, `edge_seq_applied` et `device_seq_acked` absents du contrat, deux scellements de colis | corrigé (+ décisions 12 et 18) | `contracts/replication-page-additions.yaml` seul schéma ; `research.md` R-24 réécrite ; `data-model.md` (`edge_pwd_pack_key`) ; `contracts/contract-stability-check.md` aligné | grep sur `contracts/` : les champs absents sont ajoutés ; `ReplicationPage` et `EdgeSyncBatch` ne sont référencés que par `/edge/*` (`openapi.yaml:7000`, `7058`) |
| A03 | ÉLEVÉ | Blocages hors filigrane et hors curseur `posting.id` | corrigé | journal `change_seq` (`reference.media_refs`, `wallet_states`) ; `edge_ack_handover` refuse sans le curseur de référence ; `data-model.md` A.3, A.5 ; `research.md` R-08 | un blocage n'écrit aucun `posting` ; `ack_edge_handover` ne contrôle que le filigrane de postings (`schema:2592`) |
| A04 | BLOQUANT | Contraintes de `edge_gateway` cassent les suites générées et `force_central_authority` | corrigé | `data-model.md` A.2 : colonnes nullables, pas d'index « une primaire » ni de `CHECK`, `revoked_at` par déclencheur, `ledger_id` supprimée ; lot de non-régression | `tests_grand_livre_cashless.sql:499-500` (deux `PRIMARY` pour `…0e1`, cinq colonnes) ; `force_central_authority` : `UPDATE … SET status = 'REVOKED'` sans `revoked_at` (`schema:2686`) |
| A05 | BLOQUANT | `operations_count = final_edge_seq` échoue dès le deuxième cycle | corrigé | `operations_count = final_edge_seq - edge_seq_at_activation` ; `data-model.md` A.3, A.4, B.1 ; `research.md` R-07 ; test à deux cycles | `complete_edge_release` : `contiguous_edge_seq` et `last_chain_hash` persistants, jamais remis à zéro (`schema:2652-2660`) |
| A06 | ÉLEVÉ | Bornes de décision en TypeScript, enveloppe trop large, `CL007` non traité | corrigé | `data-model.md` A.4 bis ; `research.md` R-09 ; une transaction par opération avec `record_edge_seq` ; `CL007` : rognage sous verrou, reprise, sinon `REJECTED` sans blocage | `record_edge_seq` prend la transaction écrite en paramètre (`schema:2726`) ; `CL007` levée par `post_transaction` (`schema:621`) |
| A07 | ÉLEVÉ | `EDGE_ONLINE` invérifiable : une passerelle compromise invente des ventes | décision du porteur (13) | preuve du bracelet au rejeu, plafonds, alerte (`data-model.md` A.4 bis étapes 6 et 7) ; perte maximale chiffrée (`research.md` R-09) ; `OP-N104`, `ADR-159` ; **valeurs des plafonds À SOUMETTRE AU PORTEUR** | aucune signature de terminal pour `EDGE_ONLINE` (`openapi.yaml:14416-14485`) ; `offline_policy.max_per_sale` vaut 0 par défaut, inutilisable comme plafond de rejeu |
| A08 | ÉLEVÉ | Rejeu d'un `REVERSAL` crée de l'argent | corrigé | `data-model.md` A.4 bis étape 8 ; `research.md` R-09 | borne 2 pouvait rogner la vente d'origine alors que l'annulation locale recrédite le montant plein |
| A09 | ÉLEVÉ | Recharge espèces rejetée au rejeu, invariant « solde local ≤ réel » faux | décision du porteur (14) | deux parts, anomalie `CASH_TOPUP_OVER_LIMIT` (`research.md` R-10, `data-model.md` A.4 bis étape 11 et B.7.5 corrigé) ; `spec.md` US5 et cas limites ; `plan.md` IC-09 ; `OP-N108`, `ADR-163` (à signaler au juriste) | `sync_protocol.md:568` et `:856` (cas 22, ADR-63) : jamais de rejet, deux parts |
| A10 | ÉLEVÉ | Clés d'origine du guichet incompatibles avec l'idempotence du terminal | corrigé | `origin_key` = `Idempotency-Key` `<serial>:<seq>` ; suffixe `#deposit` ; `research.md` R-10, R-12, R-23 ; `data-model.md` A.6.3, B.2 | `openapi.yaml:1341` (activateMedia), `:1489`, `:2589` : `Idempotency-Key` déclarée `serial:seq` |
| A11 | ÉLEVÉ | Ajouts d'énumération dans des schémas partagés | corrigé | aucune valeur ajoutée : `MALFORMED_OPERATION`, `INSUFFICIENT_FUNDS`, `INSUFFICIENT_FUNDS_RETRY`, `REVERSAL_TARGET_NOT_FOUND` ; `research.md` R-09, R-29 ; `contracts/contract-stability-check.md` (T13) | `openapi.yaml:14290-14331` : valeurs existantes confirmées ; `OfflineOperationResult` partagé (`:14363`, `:14371`) |
| A12 | ÉLEVÉ | Époque forgée met la passerelle en `STALE` définitivement | décision du porteur (15) | `research.md` R-16 ; `data-model.md` B.1, B.8 (levée locale à deux) ; `OP-N110`, `ADR-165` | `X-Authority-Epoch` non vérifiable hors central |
| A13 | ÉLEVÉ | Handover courant ambigu, lecture du `FAILED` | corrigé | `get_current_edge_handover` par priorité ; `data-model.md` A.4, B.8 ; `contracts/edge-routes.md` ; quatre cas de test | `handover_one_open` est par `(ledger, direction)` : deux handovers ouverts en même temps |
| A14 | ÉLEVÉ | Horloge de la passerelle falsifiable, monotone non persistable | corrigé | plafond d'heure persisté ; `research.md` R-14 ; `data-model.md` B.1 `edge_clock` ; limite consignée dans `OP-N103` | une horloge monotone n'a de sens que dans un démarrage |
| A15 | ÉLEVÉ | Tolérance du jeton expiré sans borne sur l'ancienneté de l'expiration | corrigé (renforcement) | condition `exp >= activated_at` ; `research.md` R-20 ; consigné dans `ADR-158` | `cash_session` sans durée maximale (`0036`) |
| A16 | MOYEN | Inscription par une seule personne, `STANDBY` reçoit les mots de passe | décision du porteur (16) | alerte immédiate, délai avant les colis, rien à une `STANDBY` non promue ; `research.md` R-05, R-16 ; `data-model.md` A.5 ; `OP-N105`, `ADR-160` ; **durée du délai À SOUMETTRE AU PORTEUR** | `register_edge_gateway` sans approbation (proposé) |
| A17 | MOYEN | Accusé non idempotent côté SQL | corrigé | `edge_ack_handover` idempotente ; `data-model.md` A.4 ; `contracts/edge-routes.md` | `ack_edge_handover` : `IF h.status <> 'GRANTED' THEN … CL013` (`schema:2585`) |
| A18 | MOYEN | Curseur `posting.id` saute une écriture validée hors ordre | corrigé | horizon sous verrou exclusif bref ; `research.md` R-08 ; `data-model.md` A.4 | `post_transaction` tient un verrou partagé jusqu'à la validation (`schema:537`) ; `posting.id` `bigserial` |
| A19 | MOYEN | Liste des faux incomplète, `NODE_ENV` ouvert, noms divergents | corrigé | `research.md` R-26 (liste exhaustive, énumération stricte, un démarrage réel par réglage) ; `quickstart.md` aligné | `config.ts:335-341` (`NODE_ENVS`), `:706` (joker refusé en production), `:730-738` (`CORS_ALLOW_ALL`) |
| A20 | MOYEN | Séparation par `@authority` contredite | corrigé | `research.md` R-21 ; `quickstart.md` (liste du central sans l'adresse de la passerelle) ; test dans les deux sens | `request-signature.ts:133-137` ; défaut de test `localhost:*,127.0.0.1:*` (`config.ts:373`) |
| A21 | MOYEN | Aucune purge des secrets après l'événement | décision du porteur (17) | FR-035, NFR-013 ; `data-model.md` B.9 bis ; `research.md` R-27 ; `OP-N106`, `ADR-161` | `edge_media.pwd_pack_enc`, clés et empreintes de jetons restent sur disque sans purge |
| A22 | MOYEN | Test à canari insuffisant | corrigé | toutes représentations, contrôle positif, journaux PostgreSQL ; `research.md` R-27 ; `contracts/replication-page-additions.yaml` (pied) ; NFR-010 | un `grep` du canari en clair ne voit ni hexadécimal, base64, ni JSON échappé |
| A23 | MOYEN | Témoin positif de CI passe sur une panne du script, référence sans garde de propriété | corrigé | codes de sortie `2` (refus) et `1` (panne), `cmp` de la mutation, `CODEOWNERS` et contrôle de décision ; `contracts/contract-stability-check.md` | `! node …` réussit pour tout code non nul ; aucun `CODEOWNERS` dans le dépôt |
| A24 | MOYEN | `wallet_id` et `cash_desk_account_id` fournis par la passerelle sans contrôle | corrigé (renforcement) | `data-model.md` A.4 bis étapes 9 et 10 ; `research.md` R-10 | `take_deposit(p_media, p_money_account)` accepte le compte tel quel (`schema:1596`) |
| A25 | MOYEN | Promotion de la `STANDBY` sans canal de rôle ni échange atomique | corrigé | `swap_edge_gateway_roles` ; `reference.gateway.role` ; `research.md` R-05, R-16 ; `data-model.md` A.4 | `UNIQUE … WHERE role='PRIMARY'` supprimé (A04), l'unicité se contrôle dans la fonction |
| A26 | MOYEN | Sort des deltas locaux après `DUPLICATE` ou `REJECTED` | corrigé | règle par issue ; `research.md` R-24 ; `data-model.md` B.2 | un `DUPLICATE` n'écrit aucune ligne : le portefeuille n'apparaît dans aucune page |
| A27 | FAIBLE | Incohérences documentaires (9 points) | corrigé | 1. NFR-005 1 000 paiements dans `spec.md` ; 2. « 5 routes » ; 3. ce fichier existe ; 4. `ledger.edge_gateway_id` ; 5. IC-02 ; 6. `releaseMedia` : `409 DEBIT_AUTHORITY_EDGE` ; 7. `ARMED`/`STANDBY` : `409 CONFLICT_STATE` ; 8. relais `apps/gateway/test/support/tcp-relay.ts` ; 9. Docker présent | `schema` : colonne `ledger.edge_gateway_id` (`set_debit_authority`) ; `plan.md` |
| A28 | FAIBLE | NFR-004 ne prouve pas la durabilité de la base locale | corrigé (partie reportée) | point d'arrêt `kill-local-database`, contrôle de `fsync` au démarrage ; `research.md` R-26 ; la coupure de courant sans onduleur reste à la procédure de site (FR-033) | `SIGKILL` de Node ne teste pas PostgreSQL |
| A29 | FAIBLE | Reprise d'un lot `ABANDONED` non spécifiée | corrigé | nouveau `batch_id`, `edge_seq_from` = premier numéro non enregistré ; `research.md` R-08 ; `data-model.md` A.5 | `openapi.yaml:14409-14412` (`abandoned: true`) |

## Restes reportés ou à soumettre (parties de constats, rien abandonné en silence)

1. **À SOUMETTRE AU PORTEUR** : valeurs des plafonds de rejeu `EDGE_ONLINE` par vente et par terminal et par heure (A07 ; `research.md`, écarts, point 11).
2. **À SOUMETTRE AU PORTEUR** : durée du délai avant l'envoi des mots de passe (A16 ; point 12, proposition 30 minutes).
3. **Reporté, mission à fixer par le porteur** : jeton de coupure signé par le central pour lever la tolérance des jetons de personne (A15, `OP-N103`) ; rotation du jeton de rafraîchissement sur la passerelle (A01, point 13, demande un champ de contrat de retour).
4. **Reporté, procédure de site (FR-033)** : coupure de courant sans onduleur (A28) ; disque chiffré ; limite de l'horloge reculée pendant un arrêt (A14).
5. **Hypothèse à confirmer avec l'équipe terminal** (C-013) : un `401` sur un jeton du central déclenche un rafraîchissement (A01) ; code `409 CONFLICT_STATE` de `ARMED` et `STANDBY` (A27.7).
