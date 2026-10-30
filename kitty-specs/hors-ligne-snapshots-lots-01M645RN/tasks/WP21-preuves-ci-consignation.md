---
work_package_id: WP21
title: Preuves de bout en bout, mesures, CI et consignation
dependencies: [WP01, WP02, WP03, WP04, WP05, WP06, WP07, WP08, WP09, WP10, WP11, WP12, WP13, WP14, WP15, WP16, WP17, WP18, WP19, WP20]
requirement_refs:
- FR-036
- FR-044
- NFR-001
- NFR-002
- NFR-003
- NFR-010
- NFR-015
planning_base_branch: feat/hors-ligne-snapshots-lots
merge_target_branch: feat/hors-ligne-snapshots-lots
branch_strategy: Planning artifacts for this mission were generated on feat/hors-ligne-snapshots-lots. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/hors-ligne-snapshots-lots unless the human explicitly redirects the landing branch.
subtasks: [T087, T088, T089, T090, T091]
phase: Phase 4 - Preuves
agent: claude
history:
- timestamp: '2026-10-30T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/test/integration/end-to-end/
create_intent: [apps/api/test/integration/end-to-end/offline-journey.spec.ts, apps/api/test/integration/end-to-end/offline-minimal.spec.ts, apps/api/test/integration/end-to-end/offline-isolation.spec.ts, apps/api/test/integration/end-to-end/offline-secrets.spec.ts, apps/api/test/integration/end-to-end/offline-production.spec.ts, apps/api/test/integration/end-to-end/offline-concurrency.spec.ts, apps/api/test/integration/end-to-end/offline-latency.spec.ts, apps/api/test/integration/end-to-end/snapshot-latency.spec.ts, apps/api/test/support/offline-dataset.ts]
execution_mode: code_change
model: sonnet
owned_files: [apps/api/test/integration/end-to-end/offline-*.spec.ts, apps/api/test/integration/end-to-end/snapshot-latency.spec.ts, apps/api/test/support/offline-dataset.ts, .github/workflows/ledger-tests.yml, docs/POINTS_OUVERTS.md, docs/DECISIONS_ADR.md]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP21 – Preuves, CI et consignation

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche de contexte d'implémentation fournie par
l'orchestrateur, ce prompt, puis seulement : `spec.md` (FR-041, FR-044, NFR-001 à NFR-014,
SC-001 à SC-012) ; `quickstart.md` (parcours en 6 étapes et commandes) ; `contracts/interfaces.md`
§ 8 (`TestTerminal`) et § 11 ; `research.md` R-30 (liste des décisions du porteur) ; `docs/
sync_protocol.md` §13 ; les comptes rendus des lots WP01 à WP20 (`docs/passation-7/rapports/`) ;
pour la forme, `kitty-specs/recharges-caisses-psp-01M5YEBA/tasks/WP14-preuves-ci-consignation.md`
(T070 à T074) et ses suites `topup-journey`, `topup-secrets`, `psp-production`, `topup-latency`.
Priorité des sources (SPECIFICATION §0.3) : contradiction signalée, jamais choisie en silence.
Ne modifie jamais un `.sql` généré de `packages/ledger-sql/`.

## Objective

Prouver la mission de bout en bout par l'API seule, sans écriture directe en base : parcours complet
(SC-001), tests minimaux du protocole §13 (1, 2, 3, 6, 7), isolation, balayage de secrets avec canari,
garde de production, concurrence, mesures de performance, puis brancher le tout dans la CI et vérifier
que la consignation de la mission est complète. Le lot ne corrige pas le code des autres lots : un
défaut trouvé est renvoyé au lot propriétaire (liste au compte rendu).

## Périmètre et arbitrages

Dans le lot : suites de `end-to-end/`, jeu de données `offline-dataset.ts`, étapes du workflow, vérification
et complément de `POINTS_OUVERTS.md` et `DECISIONS_ADR.md`, matrice d'acceptation préparée au compte rendu.
Hors lot : les tests §13-4 et §13-5 (bascule `EDGE`), reportés en mission 8 (`research.md` R-30.13) : ne
pas les écrire, vérifier le report dans `PROMPTS-A-ENVOYER.md` et `PRD.md`. Hors lot aussi : documents
transverses de `docs/` (skill `spec-kitty-docs-maintain`, après la revue).
Chemins corrigés : le workflow CI s'appelle `.github/workflows/ledger-tests.yml` (la carte de la fiche
disait `ci.yml`, qui n'existe pas). Retouches hors carte (une ligne de rapport chacune) :
`apps/api/jest.config.cjs` (liste `SKIP_LATENCY`), `.github/CI.md` (tableau des passes), `PROMPTS-A-ENVOYER.md`
et `PRD.md` (report manquant seulement). `acceptance-matrix.json` n'existe pas encore pour cette mission :
l'orchestrateur la crée (modèle : mission 6) ; le lot en prépare le contenu (T091).
Aucune recharge espèces hors ligne (décision du porteur, 30/10/2026) : le parcours le vérifie.

## Subtasks

### T087 – Parcours complet et tests minimaux §13 (SC-001, SC-012, FR-044)

Fichiers : `offline-journey.spec.ts`, `offline-minimal.spec.ts`, `support/offline-dataset.ts`.
Modèles : `topup-journey.spec.ts`, `device-journey.spec.ts`, `support/device-e2e.ts` (aides), `TestTerminal`
de WP18 (`signBatch`, `chainHash`, constructeur de journal). Réutiliser, ne pas copier.
- Parcours = `quickstart.md`, 6 étapes, une assertion nommée par étape : (1) plafond du prestataire puis
  réglage de l'événement, politique effective réduite, risque maximal ; (2) configuration (`config_id`,
  `snapshot_keys`) puis `FULL`, signature vérifiée avec la clé publique du jeu d'essai, mot de passe
  ouvert par l'enveloppe du terminal ; (3) bracelet bloqué, `DELTA` signé en 5 s au plus (processus
  `snapshot-content` puis `snapshot-signer`, `--once` en boucle ou travailleurs lancés) ; (4) terminal coupé :
  trois ventes dont une de 9 000 sur 6 000, une annulation ; lot `ACCEPTED`, `ACCEPTED_WITH_SHORTFALL` +
  `OFFLINE_SHORTFALL`, annulation qui réduit l'anomalie ; (5) trou `SEQ_GAP`, levée par deux `SUPERVISOR`
  (même personne refusée) ; (6) terminal révoqué, journal importé à deux, aucun nouveau snapshot enveloppé pour lui.
  Ajouter : un `TOPUP_CASH` porté par un lot est rejeté avec anomalie et montant, aucune écriture (SC-010).
- `offline-minimal.spec.ts`, un `describe` par point de `sync_protocol.md` §13 : (1) 100 rejeux du même lot
  et du même paiement → une écriture par clé ; (2) serveur coupé au milieu d'un lot de 500 (arrêt du
  processeur après l'opération k, puis rejeu) : résultats identiques à un traitement sans panne,
  `contiguous_acked_seq` correct ; (3) transaction 22 : écritures égales à `packages/ledger-sql/
  scenario_reference.json` (même lecture que `test/unit/builders/support/scenario-lines.ts`) ; (6) horloge
  +2 h puis −2 h : corrections §7.4 et anomalies `CLOCK_SKEW` ; (7) bracelet bloqué pendant l'isolement :
  ventes antérieures débitées, postérieures en `SUSPENSE`.
- `offline-dataset.ts` : fabrique du jeu : prestataire, événement, grand livre, N terminaux, N bracelets par
  SQL en bloc (`generate_series`), N = 50 000 pour les mesures (paramètre), 200 pour les parcours.
  Nettoyage par prestataire, jamais de `TRUNCATE`.
- Critère : la transaction 22 est comparée ligne à ligne ; le parcours échoue si une étape est sautée.

### T088 – Isolation, secrets, garde de production (SC-007, SC-008, SC-011, NFR-007, NFR-008, NFR-010)

Fichiers : `offline-isolation.spec.ts`, `offline-secrets.spec.ts`, `offline-production.spec.ts`.
- **Isolation** (modèle `isolation-sweep.spec.ts:43` et `topup-isolation.spec.ts`) : le contrat doit déclarer
  les routes de la mission et chacune a un cas (test de complétude, comme `:137`) ; sans jeton `401` ; deux
  prestataires et deux organisateurs : politique, snapshot, lot, résultat de lot, trou, import — chacun
  `404` neutre pour l'autre ; après le balayage, les objets de A sont intacts ; terminal de A sur le
  grand livre de B refusé.
- **Secrets** (modèle `media-secrets.spec.ts` et `topup-secrets.spec.ts`) : le test déroule un parcours qui
  produit tous les secrets (mots de passe de bracelet, clés `K_v` en clair, clé privée de signature du faux,
  PIN de vendeur et empreinte), puis cherche chaque valeur, en hex (deux casses), base64, base64url et
  texte, dans toutes les colonnes de toutes les tables (liste GÉNÉRÉE depuis `pg_catalog`), dans les journaux
  capturés des TROIS nouveaux processus, dans les réponses, dans le `snapshot` servi et dans l'environnement
  des processus. Contrôle du contrôle : les mêmes valeurs écrites en clair dans une table temporaire et une
  ligne d'audit, transaction annulée, DOIVENT être trouvées. Exception nommée : `pwd_pack_enc` chiffré sous
  `K_v` est attendu (jamais en clair).
- **Production** (modèle `psp-production.spec.ts`) : (a) balayage de `apps/api/src` : toute classe qui porte
  `isFake` est couverte par `test/unit/production-guard.spec.ts` (nommée ou son jeton), sinon échec ; (b)
  `SnapshotContentProcessModule` et `SnapshotSignerProcessModule` en configuration de production avec le faux
  → `assertProcessIsSafe` refuse ; (c) API publique en production sans clé `ACTIVE` →
  `403 OFFLINE_NOT_ALLOWED` (détail `SNAPSHOTS_UNAVAILABLE`), configuration servie avec `offline_enabled`
  faux. Lien OP-N89 : le test (b) en est le test de borne.
- Critère : le contrôle du contrôle échoue si le balayage est vidé ; (a) échoue si on ajoute une classe
  `isFake` non couverte.

### T089 – Concurrence et mesures (NFR-001, NFR-003, NFR-004, NFR-005, NFR-013)

Fichiers : `offline-concurrency.spec.ts`, `offline-latency.spec.ts`, `snapshot-latency.spec.ts`.
Forme des mesures : `media-latency.spec.ts:40-60` (`percentile`, `p95`, `p99`, séries, `MAX_SERIES = CI ? 1 : 3`),
`const latency = process.env.SKIP_LATENCY ? it.skip : it`. Mesure côté serveur autour du service, HTTPS réel,
en série, rien d'autre ne tourne. Imprimer p95, p99 et maximum.
- **Concurrence** : 100 rejeux d'un même lot, dont concurrents → une écriture par opération (NFR-001) ; 50
  envois concurrents d'un même terminal → un seul accepté, les autres `BATCH_IN_PROGRESS` (NFR-013) ; pool
  de verrous des lots plein (`OFFLINE_BATCH_POOL_SIZE` réduit) → réponse définie, pas d'attente infinie, pas
  d'écriture partielle (NFR-011) ; connexions de l'API bornées (≤ 100 de la base de CI).
- **Lot** (NFR-003) : lot de 500 opérations, p95 ≤ 60 s (mesure du traitement serveur).
- **Snapshot** (NFR-004, NFR-005) : jeu de 50 000 bracelets ; `FULL` produit et signé en 30 s au plus ;
  `DELTA` servi en 2 s au plus pour 95 % des demandes ; blocage visible dans une version publiée en 5 s au plus
  (100 % des essais, avec un `FULL` d'un autre grand livre en cours) ; autre changement en 60 s au plus
  (horloge réelle, pas d'horloge injectée pour cette mesure).
- Les seuils sont ceux de la spec (confirmés le 29/10/2026) : ne pas les desserrer pour passer. Un seuil
  non tenu est un constat au compte rendu et au porteur, pas une valeur changée.
- Critère : les trois suites verdissent seules, en série ; sous `SKIP_LATENCY=1` elles sont écartées.

### T090 – CI et quickstart (NFR-015)

Fichiers : `.github/workflows/ledger-tests.yml` ; retouches hors carte `jest.config.cjs`, `.github/CI.md`.
Modèle : les étapes existantes (`ledger-tests.yml:140-210`). Rien d'existant n'est retiré ni rendu facultatif.
- `jest.config.cjs` : ajouter à la liste `SKIP_LATENCY` `end-to-end/offline-latency`, `end-to-end/snapshot-latency`,
  `end-to-end/offline-concurrency` (et tout autre suite lourde ou de processus de ce lot, listée au rapport).
- Workflow, après la passe parallèle : une étape pour la concurrence (`--runInBand
  end-to-end/offline-concurrency`) et une pour les mesures (`--runInBand end-to-end/offline-latency
  end-to-end/snapshot-latency`), même forme que « Latence du paiement, NFR-001 » ; commentaire d'en-tête avec
  la mission. Vérifier que `test:pgtap` (`packages/ledger-sql/scripts/test-pgtap.sh`) énumère les suites
  `tests_offline_*.sql` ; variables d'environnement nouvelles (`DATABASE_URL_SNAPCONTENT`,
  `DATABASE_URL_SNAPSIGN`, `DATABASE_URL_MAINT`) posées avec valeurs de test si les lots les exigent ; la
  vérification `check:generated` ne voit aucun `.sql` généré modifié.
- `.github/CI.md` : tableau des passes à jour (suites, tests, mesures de la mission).
- Quickstart : dérouler chaque commande de `quickstart.md` telle qu'écrite (sans lancer Jest sur la base de
  l'orchestrateur : base de lot `cashless_wp21`) ; chemin ou nom faux → liste au compte rendu (le fichier
  n'est pas à toi). Les processus `--once` doivent exister (`dist/main.*.js`).
- Critère : YAML relu, étapes d'avant présentes ; les commandes du quickstart existent et sont correctes.

### T091 – Consignation et matrice d'acceptation (FR-041, SC-009)

Vérifier, et compléter SEULEMENT ce qui manque (docs : `POINTS_OUVERTS.md`, `DECISIONS_ADR.md`).
- **OP-N57, OP-N58, OP-N68, OP-N69, OP-N75** (lignes 38, 39, 49, 50, 57 du tableau, fiches aux lignes 329,
  353, 598, 625, 768) : chacun **levé** avec date, lot, migration et test nommé qui échoue si le droit
  s'élargit (modèle de la ligne OP-N49 levé, ligne 30) : N57 `tests_offline_snapshots.sql` + `tests_offline_rights.sql`
  (version = max + 1, `INSERT` refusé) ; N58 `tests_offline_policy.sql` + `tests_definer_trigger_writers.sql`
  §3 inversé ; N68 `tests_execute_grants.sql` §4 inversé ; N69 `tests_device_rights.sql` §1 (liste vide) ;
  N75 `tests_device_purge_window.sql` sous `cashless_maint` + `tests_execute_grants.sql`. Les noms réels se
  relisent dans les comptes rendus des lots ; un nom faux est une erreur à corriger.
- **OP-N89, OP-N90 et OP-N91** : présents (tableaux en tête et § 2, fiches dédiées), **tenus**, avec leur test
  de borne (`production-guard.spec.ts` ; `tests_offline_batches.sql`, alerte à 24 h de WP13 ;
  `tests_execute_grants.sql` pour OP-N91). Rien à lever.
- ADR-137 à ADR-140 présents (`DECISIONS_ADR.md`), cohérents avec le livré ; les
  ADR-111 et ADR-112 annoncent la levée de N68 et N69 : leur état à jour. Un ADR pour tout écart de sécurité
  accepté dans un compte rendu de WP01 à WP20 ; sans entrée, c'est un constat bloquant (règle 3 de `CLAUDE.md`).
- `PROMPTS-A-ENVOYER.md` et `PRD.md` : reports présents (§13-4/5 en mission 8 ; adaptateur AWS 12b pour OP-N89 ;
  revue en mission 13 pour OP-N90 et OP-N91). Retouche docs seulement, avec mention au compte rendu.
- **Matrice d'acceptation préparée** : tableau à trois colonnes (critère · preuve : fichier + nom du cas ·
  commande et résultat), couvrant FR-001 à FR-044, NFR-001 à NFR-015, SC-001 à SC-012 et les contraintes, au
  format recopiable dans `criteria[]` (`criterion_id`, `proof_type`, `evidence`, `notes`). Critère sans
  preuve : liste « non couverts » en tête du compte rendu (constat bloquant).
- **Liste des fichiers à relire par une personne**, avec la raison : migrations `0043` à `0049`,
  `post-roles.sql`, `apps/api/src/kms/`, `snapshots-content/crypto/`, `snapshots-signer/`,
  `packages/tag-format/src/device-envelope.ts`, `offline/batches/`, `offline/processing/`, `payments/chained-content.ts`.
- Critère : aucun point de FR-041 sans test nommé ni ligne consignée.

## Sécurité

- Un écart qui affaiblit la sécurité trouvé pendant les preuves (droit trop large, secret retrouvé, faux
  accepté en production) est un constat bloquant : au porteur avant tout correctif, jamais corrigé ni
  masqué dans ce lot (règle 1 de `CLAUDE.md`).
- Le balayage de secrets ne journalise jamais la valeur trouvée, seulement la table, la colonne et la forme.
- Les tests créent leurs données dans leur prestataire et nettoient ; aucun secret de test réel.
- Le lot ne desserre aucun seuil ni ne retire aucun test d'un autre lot pour verdir la CI.

## Tests

Les suites de ce lot SONT les preuves. Le lot les fait passer sur sa base de lot `cashless_wp21` (une suite à
la fois, mesures seules) ; il ne lance rien sur `cashless_test`. L'orchestrateur relance en série la batterie
complète (`npm run reset-db -w @cashless/ledger-sql`, `SKIP_LATENCY=1 npx jest`, puis les suites seules du
quickstart, `npm run test:pgtap`). Mesures : noter la machine, `CI` posé ou non, p95, p99, maximum.

## Ce que le relecteur doit casser

1. Retirer une étape du parcours (par exemple le `DELTA` après blocage) : le test doit échouer.
2. Vider la liste des colonnes du balayage de secrets : le contrôle du contrôle doit échouer.
3. Ajouter une classe `isFake` non couverte : le balayage de `production.spec` doit échouer.
4. Rejouer 100 fois avec un registre qui ignore la clé : doubles écritures vues.
5. Un seuil de latence desserré ou une série réduite à un échantillon trop petit pour un p95.
6. Une suite lourde absente de la liste `SKIP_LATENCY` : la passe parallèle épuise les connexions.
7. Une fiche `POINTS_OUVERTS.md` « levée » dont le test cité n'existe pas ou ne s'exécute pas.
8. Étape de CI ajoutée mais testée avec un motif qui ne retient aucune suite (verte à vide).

## Definition of Done

- [ ] Parcours des 6 étapes et tests §13 (1, 2, 3, 6, 7) verts ; transaction 22 égale au scénario.
- [ ] Isolation, secrets avec canari, garde de production verts ; contrôles des contrôles en place.
- [ ] Concurrence et mesures NFR-003, NFR-004, NFR-005 mesurées avec les seuils de la spec, chiffres notés.
- [ ] `ledger-tests.yml`, `jest.config.cjs`, `CI.md` à jour ; commandes du quickstart vérifiées.
- [ ] OP-N57, N58, N68, N69, N75 levés avec test nommé ; N89, N90 tenus ; ADR et reports vérifiés.
- [ ] Matrice d'acceptation préparée ; liste des fichiers à relire ; défauts renvoyés aux lots propriétaires.
- [ ] Lignes de 100 caractères au plus ; aucun `.sql` généré modifié.

## Branch Strategy

- Branche de planification et de fusion : `feat/hors-ligne-snapshots-lots`.
- Worktree par lane, calculée dans `lanes.json`.
- Commande : `spec-kitty agent action implement WP21 --agent claude --mission
  hors-ligne-snapshots-lots-01M645RN`.

## Activity Log

- 2026-10-30T12:00:00Z – claude – Prompt generated via /spec-kitty.tasks
