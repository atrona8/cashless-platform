# Fiche de contexte, mission 8 (passerelle-locale-01M6NM1S)

Branche `feat/passerelle-locale`. Spec : `kitty-specs/passerelle-locale-01M6NM1S/spec.md` (FR-001 à FR-039, NFR-001 à NFR-013,
C-001 à C-013). Sources normatives : `docs/SPECIFICATION.md` §9.7, §12.1, §13.1, §14.1 S12 S13 ; `docs/sync_protocol.md` §9, §13 ;
`docs/DECISIONS_ADR.md` ADR-52 ; `packages/contracts/openapi.yaml` (tag Passerelle, `x-edge-available`) ; pile : `docs/08-pile-logicielle.md`.

Décisions du porteur (05/11/2026) : bascule par un admin avec le lien ; recharges espèces sur sessions ouvertes au central avant
la bascule ; port de stockage matériel, faux refusé en production, réel en 12b ; `STANDBY` promue par handover normal ; contrat
stable, ajouts facultatifs sous `/edge/*` seulement ; inscription d'une passerelle par outil d'administration hors API publique.

Règles : ne jamais modifier les `.sql` générés de `packages/ledger-sql/`. Écart de sécurité : jamais en silence (CLAUDE.md).
Commandes spec-kitty avec `LC_ALL=C LANG=C`. Base de test partagée : les agents ne lancent ni Jest, ni pgTAP, ni reset-db, et ne
commitent pas. Une API tourne sur le port 80 : ne pas y toucher.

## Décisions du plan (porteur, 05/11/2026, confirmées) : font foi sur les rapports `docs/passation-8/rapports/R-*.md`

1. Base de la passerelle : PostgreSQL local, schéma réduit (série de migrations propre), règles partagées en TypeScript, mêmes scénarios de référence ; le central seul tient la comptabilité. Écart de texte à acter : « même moteur » (SPEC §9) devient « mêmes modules ».
2. Jetons d'appareil pendant EDGE : clé propre à la passerelle dans le port de stockage matériel, jetons valables sur elle seule, refusés au central (test). Écart accepté, dette nommée.
3. Jeton de personne expiré au guichet : toléré sur la passerelle seulement, bien signé, personne qui a ouvert la session, même terminal, session ouverte, 12 h au plus après la bascule, chaque usage audité. Écart accepté, dette nommée. Risque : compte révoqué pendant la coupure.
4. Passerelle perdue avant rejeu : pas de changement de contrat. Un terminal n'envoie que `ONLINE_REF` pour activation et caution (`OfflineOperationType`) ; le central reconnaît une référence à une opération inconnue et ouvre `EDGE_REPLAY_FAILED` ; un `TOPUP_CASH` suit le refus existant, anomalie portant le montant. Aucune perte silencieuse, rétablissement manuel, résolution à deux.
5. Rôle `cashless_edge` et enveloppe pour écrire en `EDGE_SYNC` (vérifie passerelle, handover, époque, `origin_*`) ; `post_transaction` en `EDGE_SYNC` refusée à `cashless_app`. Migrations à partir de `0058`.
6. Renforcements à faire puis consigner : retirer l'écriture directe de `cashless_app` sur `edge_gateway` ; `record_edge_seq` refuse une passerelle `REVOKED` ou sans handover de cette passerelle ; lier passerelle et handover ; `begin_cash_close` refusé (`409 CONFLICT_STATE`) tant que l'autorité est à la passerelle ou que la file n'est pas vide.
7. Contrat : seuls des champs facultatifs sur `ReplicationPage`, sous `/edge/*`. Aucune autre route ne change. Compléter un 409 du central (`edge_base_url`, époque) n'est permis que si le contrat le déclare déjà.
8. Écarts acceptés, chacun avec OP, ADR, test de borne et report : clés de passerelle simulées jusqu'à 12b ; décision 2 ; décision 3.
9. À régler au plan, signaler si sécurité : contenu haché de la chaîne de la passerelle et vecteurs ; horloge de la passerelle ; écriture de `ISOLATED`/`CATCHING_UP` ; réveil immédiat de l'attente longue (NFR-007) ; NFR-005 sur 1 000 paiements.
10. Preuves : deux processus, deux bases, relais TCP coupable, points d'arrêt actifs hors production seulement, étape CI dédiée.

## Décisions après la passe contradictoire (porteur, 05/11/2026)

11. A01, renouvellement du jeton d'appareil : sans rotation sur la passerelle ; empreinte répliquée du jeton de rafraîchissement et certificat du terminal, jeton court valable sur elle seule, rotation forcée au retour. Écart accepté, dette nommée.
12. A02 : `after_change_seq` facultatif accepté sur `/edge/replication-feed`.
13. A07 : au rejeu, preuve du bracelet (compteur croissant, signature, bon portefeuille), plafond par vente et par terminal et par heure, alerte, sans changement de contrat. Risque résiduel accepté par ADR, perte maximale chiffrée.
14. A09 : recharge espèces jamais rejetée pour un plafond au rejeu, deux parts (protocole §8), anomalie résolue à deux ; signaler au juriste le dépassement temporaire d'un plafond réglementaire.
15. A12 : `STALE` persisté seulement si confirmé par le central ou plausible (au plus époque détenue + 2) ; sinon refus sans arrêt, alerte ; levée locale à deux personnes si le lien est coupé.
16. A16 : inscription par UNE personne (choix du porteur contre la recommandation), alerte immédiate et délai avant l'envoi des mots de passe ; rien pour une `STANDBY` non promue. Écart accepté, dette nommée, test.
17. A21 : purge automatique à la clôture de l'événement et manuelle à deux personnes (clé d'accord, données répliquées), test ; limite consignée : mini-PC volé avant la purge.
18. Audit de la tolérance des jetons de personne versé au central par un champ facultatif sous `/edge/*`.

## Décisions en cours d'implémentation (porteur, 09/11/2026)

19. `edge_app` : déclencheur `BEFORE TRUNCATE` sur `edge_authority`, `edge_op`, `edge_audit` (corrigé) ; le rôle unique peut
    toujours `DISABLE TRIGGER`/`DROP` : consigné (POINTS_OUVERTS + ADR), levée par WP25 ou une mission ultérieure.
20. Horloge de la passerelle : recul accepté de l'heure du central ramené à quelques minutes (5 min) ; au-delà, refus et
    `CLOCK_CENTRAL_OUT_OF_BOUNDS`. Correction dans un lot de la passerelle après WP17.
21. Recharge au guichet : plafond par opération réglable, 500 000 XOF par défaut. Conciliation avec la décision 14 :
    refus à la saisie sur la passerelle (WP22) ; au rejeu (0062), jamais rejetée, anomalie résolue à deux (WP09, 0064).
22. Certificat client vers le central (WP20) : poignée de main TLS signée par le composant matériel, aucune clé privée en
    fichier ; `GATEWAY_CENTRAL_CLIENT_KEY_FILE` abandonné.
23. `edge_exposed` sur `device_refresh_token` et rendu de `token_family` : WP08 au cycle 2 ; WP18 le lit ensuite.
24. Fichier de clés de développement : corrigé (nom unique, création exclusive, 0600 forcé, verrou, `realpath`), en WP20.
25. Plafond horaire par terminal : fenêtre en microsecondes, bornes fermées, migration correctrice et test de bordure.
26. Frais : recalcul par le moteur central à la réception (WP13), frais de la passerelle ignorés ; test hostile.
27. Clés de site : deux titulaires nominatifs distincts exigés par l'outil d'enrôlement, procédure d'exploitation ;
    limite résiduelle consignée.
28. Journal de réplication : déclencheurs différés gardés ; règle « SET CONSTRAINTS ALL IMMEDIATE avant tout DDL après
    écriture » dans l'en-tête de 0063 et le guide des migrations ; test à deux connexions réelles.
29. `edge-0003` (WP18) accepté sous réserve de la relecture ; numéros suivants attribués par l'orchestrateur.
30. Corrections de lots approuvés sans les rouvrir : migration correctrice `0064` portée par WP09 (fenêtre horaire,
    plafond par recharge au rejeu) ; passerelle (TRUNCATE, horloge, fichier de clés) portée par WP20.
32. Décision 22 non faisable sans dépendance native : clé TLS client en fichier jusqu'à la mission 12b, durcie dans
    WP20 (démarrage refusé si fichier ou répertoire plus larges que 0600 ou lien symbolique, clé distincte de `batch`,
    jamais journalisée) ; OP-N113, ADR-168. La 12b choisit fournisseur OpenSSL/PKCS#11 ou proxy mTLS.
33. Ordres locaux à deux personnes (`LOCAL_UNSTALE`, purge manuelle) versés à l'audit du central : champ facultatif
    rétrocompatible sous `/edge/*` (accord du porteur, ADR-169) ; contrat et réception par WP13, envoi par WP24.
34. Seconde demande `CENTRAL` à autre clé = abandon du rendu en cours (WP11) : consigné (OP-N114, ADR-170) ; le
    back-office (hors mission) demande une confirmation explicite avant d'abandonner un rendu.
35. Schéma `Problem` : ajout facultatif rétrocompatible de `edge_base_url` et `authority_epoch` (accord du porteur, hors
    `/edge/*`, ADR-171), porté par WP13 avec l'ajout de la décision 33.
36. Caution et activation en `EDGE` : ajout facultatif rétrocompatible sous `/edge/*` (page de réplication) des
    conditions de caution et frais d'activation (ADR-172) ; production et contrat par WP12 (correction), lecture par
    WP22 (correction, après WP12). Sans le champ, refus maintenu.
37. Rendu bloqué : trace `EDGE_RELEASE_STUCK` en `audit_log` par une fonction `SECURITY DEFINER` dédiée, migration
    `0065`, `EXECUTE` à `cashless_maint` seul (ADR-173), par WP12 (correction). Migration centrale suivante : `0066` (prise par la décision 39).
38. `check_balanced()` en `SECURITY DEFINER SET search_path = public, pg_temp` (migration correctrice `0066`, WP13),
    plutôt qu'un droit de lecture sur `posting` (ADR-174).
39. Réception des lots (WP13) : fonctions `SECURITY DEFINER` étroites pour le curseur du registre, la clé publique
    du terminal, les résultats mémorisés, la configuration des frais et l'audit ; `EXECUTE` à `cashless_edge` seul,
    dans `0066` (ADR-174). Migration centrale suivante : `0067`.
    Complément de la décision 36 (orchestrateur, pour tenir la décision 21) : le plafond par recharge réglable est
    répliqué avec les conditions de caution (même ajout sous `/edge/*`, WP12) ; WP22 le lit au lieu de
    `wallet_limits.max_cash_topup`, absent de tout contrat.
40. `edge_tap_proof` (6e fonction de `0066`, hors décision 39) gardée (ADR-182) ; isolation entre passerelles à tester
    en WP25.
41. WP15, T068 : option (a), fonction de lecture étroite en `0067` à `cashless_tagkeys` seul (ADR-183). Migration
    centrale suivante : `0068`.
42. NFR-005 non tenue à concurrence 10 (p95 362 ms contre 200, relecture de WP21) : reportée à WP25 (mesure et
    optimisation), WP21 ne la corrige pas.
43. WP15 : prestataires servis par le travailleur de colis désignés par une liste en configuration du processus
    des clés (aucune fonction de plus en base) ; sans liste, rien (échec fermé, journalisé).
44. WP15 : clé de contenu des colis dérivée (HKDF : plus ancienne clé de données, empreinte de la clé d'accord,
    passerelle), sans état ; risque consigné (ADR-184), levée en 12b.
45. Ordre de dépense (`spend_order`) répliqué vers la passerelle : ajout facultatif rétrocompatible sous `/edge/*`
    (ADR-185) ; sans le champ, refus des ventes qui mêlent payé et offert. Porté par WP25 (central, contrat,
    passerelle).
46. WP14 : anomalie `EDGE_REPLAY_FAILED` ouverte par la fonction de base (migration correctrice `0068` : la fonction
    d'ouverture des anomalies l'accepte), jamais par `INSERT` direct dans `anomaly` (le droit de `cashless_app`, dette
    OP-N86, ne sert pas de nouveau chemin). Migration centrale suivante : `0069`.
47. WP24 : TLS sur le port d'administration local de la passerelle, comme prévu au plan (correction de WP24).
48. WP24 : purge manuelle versée au central AVANT la destruction : dernier lot avec l'ordre dans `local_orders`,
    accusé attendu, puis purge ; sans lien, attente ou purge locale avec trace consignée (décision 33 tenue).
49. WP24 (11/11) : WAL et blocs libres non effacés, tables d'ajout seul non vidées, purge hors de la transaction de la
    file : consignés (OP-N118, ADR-186), levée en 12b avec OP-N106.
50. WP24 (11/11) : décision 48 impossible en l'état (`operations` `minItems: 1` à `/edge/sync-batches`, file vide exigée
    par la purge). Ajout rétrocompatible sous `/edge/*` porté par WP25 : lot sans opération accepté s'il porte des
    `local_orders` (`edge_seq` et chaîne inchangés). D'ici là, purge forcée après 30 s avec trace `CENTRAL_UNCONFIRMED`
    (OP-N119, ADR-187). Retouches hors carte de WP24 pour le TLS (`admin-listener.ts`, tests de démarrage) ratifiées.
51. WP25 (11/11) : lot vide refusé aussi en base : `edge_sync_batch_begin` reçoit le nombre d'ordres locaux et refuse un
    intervalle vide sans ordre (pgTAP, mutation) ; correction de la partie A, faite après la partie B, avant la relecture.
31. `REPLICATION_CATCH_UP` : refus au démarrage en production du bouchon, fait par WP18 (`production-guard.spec.ts`).

## Consigne des rédacteurs de prompts (WP), format allégé du porteur

Un prompt `kitty-specs/passerelle-locale-01M6NM1S/tasks/WPnn-slug.md`, 150 à 250 lignes (nom de fichier dans `tasks.md`), français, sans tiret cadratin. Il renvoie aux sources au lieu de les reformuler : `contracts/interfaces.md` (noms figés), `data-model.md`, `research.md` R-xx, `contracts/*`, constats `A..` de `docs/passation-8/rapports/plan-adversarial.md`.

Frontmatter (exemple réel : `kitty-specs/hors-ligne-snapshots-lots-01M645RN/tasks/WP05*.md`) : `work_package_id`, `title`, `dependencies`, `requirement_refs: []` (l'orchestrateur les pose), `planning_base_branch` et `merge_target_branch` = `feat/passerelle-locale`, `branch_strategy`, `subtasks`, `phase`, `agent: claude`, `model: sonnet`, `history`, `agent_profile: implementer-ivan`, `role: implementer`, `execution_mode: code_change`, `owned_files`, `authoritative_surface`, `create_intent` (fichiers à créer, chemins littéraux), `tags: []`, `tracker_refs: []`.

Corps : `## ⚡ Do This First: Load Agent Profile` en premier (`/ad-hoc-profile-load implementer-ivan`, puis liste de ce qu'il faut lire, précise, par sections) ; Objectif ; Branch Strategy (planification `feat/passerelle-locale`, cible `feat/passerelle-locale`, worktree alloué par lane selon `lanes.json`) ; Commande `spec-kitty agent action implement WPnn --agent claude --mission passerelle-locale-01M6NM1S` ; une section par sous-tâche (but, fichiers, arbitrages, cas limites) ; Tests attendus (noms de fichiers, cas, chaque test doit échouer sur une implémentation fausse) ; Sécurité ; Definition of Done ; « Ce que le relecteur doit casser ». Rappels : ne lance ni Jest, ni pgTAP, ni reset-db (l'orchestrateur le fait en série) sauf consigne contraire ; aucune migration sans `REVOKE ALL ... FROM PUBLIC` ; aucun `GRANT` hors WP09 ; aucun `.sql` généré touché ; un écart qui affaiblit la sécurité s'arrête et remonte au porteur.

### Fichiers par lot (sans chevauchement)

- WP01 `packages/contracts/openapi.yaml`, `packages/contracts/generated/**`, `packages/contracts/dart/**`, `tools/contract-stability/**`
- WP02 `packages/shared-rules/**`, `apps/api/src/ledger/money/**`, `apps/api/src/payments/chained-content.ts`, `apps/api/src/offline/rules/**`, `apps/api/src/offline/batches/batch-chain.ts`, `apps/api/test/fixtures/edge-vectors/**`
- WP03 à WP08 : leur migration (`interfaces.md` § 1) et `packages/ledger-sql/tests/tests_edge_*.sql` de leur sous-tâche
- WP09 `packages/ledger-sql/roles.sql`, `post-roles.sql`, `tests/tests_execute_grants.sql`, `tests/tests_offline_rights.sql`, `tests/tests_edge_rights.sql`, `apps/api/test/integration/edge/edge-sync-guard.spec.ts`
- WP10 `apps/api/src/main.edge.ts`, `apps/api/src/processes/edge.module.ts`, `apps/api/src/edge/ca/**`, `apps/api/src/edge/identity/**`, `apps/api/src/edge/control/**`, `apps/api/test/integration/edge/process/**`
- WP11 `apps/api/src/debit-authority/**`, `apps/api/test/integration/debit-authority/**`
- WP12 `apps/api/src/edge/handover/**`, `apps/api/src/edge/replication/**`, `apps/api/src/edge/maintenance/**`, `apps/api/test/integration/edge/routes/**`
- WP13 `apps/api/src/edge/sync/**`, `apps/api/test/integration/edge/sync/**`
- WP14 `apps/api/src/edge/journal/**`, `apps/api/src/offline/processing/online-ref-resolver.ts`, `apps/api/test/integration/edge/journal/**`
- WP15 `tools/edge-admin/**`, `apps/api/src/edge/packs/**`, `apps/api/test/integration/edge/packs/**`
- WP16 `apps/gateway/package.json`, `apps/gateway/tsconfig*.json`, `apps/gateway/jest.config.cjs`, `apps/gateway/migrations/**`, `apps/gateway/src/main.ts`, `apps/gateway/src/config/**`, `apps/gateway/src/db/**`, `apps/gateway/src/key-store/**`, `apps/gateway/src/clock/**`, `apps/gateway/src/processes/**`, `apps/gateway/src/testing/**`, `apps/gateway/test/startup/**`
- WP17 `apps/gateway/src/central-client/**`, `apps/gateway/src/authority/**`, `apps/gateway/test/authority/**`
- WP18 `apps/gateway/src/replication/**`, `apps/gateway/test/replication/**`
- WP19 `apps/gateway/src/device-proofs/**`, `apps/gateway/src/device/**`, `apps/gateway/test/device/**`
- WP20 `apps/gateway/src/queue/**`, `apps/gateway/test/queue/**`
- WP21 `apps/gateway/src/operations/sales/**`, `apps/gateway/test/sales/**`
- WP22 `apps/gateway/src/staff/**`, `apps/gateway/src/operations/counter/**`, `apps/gateway/test/counter/**`
- WP23 `apps/gateway/src/operations/offline/**`, `apps/gateway/src/snapshots/**`, `apps/gateway/test/offline/**`
- WP24 `apps/gateway/src/purge/**`, `apps/gateway/src/standby/**`, `apps/gateway/test/purge/**`, `apps/gateway/Dockerfile`, `apps/gateway/docker-compose.site.yml`, `docs/procedure-site-passerelle.md`
- WP25 `apps/gateway/test/support/**`, `apps/gateway/test/e2e/**`, `.github/workflows/ledger-tests.yml`, `.github/CI.md`
