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
