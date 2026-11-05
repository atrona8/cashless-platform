---
work_package_id: WP25
title: Preuves de bout en bout, étapes de CI, contrôle de stabilité et consignation finale
dependencies: [WP11, WP12, WP13, WP14, WP15, WP24]
requirement_refs:
- FR-034
- NFR-001
- NFR-002
- NFR-003
- NFR-004
- NFR-005
- NFR-006
- NFR-009
- NFR-010
- NFR-011
- NFR-012
- SC-001
- SC-002
- SC-003
- SC-004
- SC-005
- SC-006
- SC-007
- C-001
- C-013
- NFR-007
- NFR-013
planning_base_branch: feat/passerelle-locale
merge_target_branch: feat/passerelle-locale
branch_strategy: Planning artifacts for this mission were generated on feat/passerelle-locale. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/passerelle-locale unless the human explicitly redirects the landing branch.
subtasks: [T112, T113, T114, T115, T116, T117]
phase: Phase 5 - Preuves
agent: claude
history:
- timestamp: '2026-11-05T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/gateway/test/e2e/
create_intent: [apps/gateway/test/support/tcp-relay.ts, apps/gateway/test/support/two-process-bench.ts, apps/gateway/test/support/disposable-databases.ts, apps/gateway/test/support/canary.ts, apps/gateway/test/support/queue-generator.ts, apps/gateway/test/support/sql-probes.ts, apps/gateway/test/e2e/jest.e2e.config.cjs, apps/gateway/test/e2e/sc-001-journey.spec.ts, apps/gateway/test/e2e/exclusion-under-load.spec.ts, apps/gateway/test/e2e/release-10000.spec.ts, apps/gateway/test/e2e/replay-100.spec.ts, apps/gateway/test/e2e/crash-points.spec.ts, apps/gateway/test/e2e/latency-two-process.spec.ts, apps/gateway/test/e2e/handover-and-freshness.spec.ts, apps/gateway/test/e2e/forced-resume.spec.ts, apps/gateway/test/e2e/production-refusals.spec.ts, apps/gateway/test/e2e/canary-end-to-end.spec.ts, apps/gateway/test/e2e/scoping.spec.ts, apps/gateway/test/e2e/contract-stability.spec.ts, apps/gateway/test/e2e/purge-end-to-end.spec.ts, apps/gateway/test/e2e/acceptance-matrix.spec.ts, apps/gateway/test/e2e/consignation.spec.ts, apps/gateway/test/e2e/ci-workflow.spec.ts, .github/workflows/ledger-tests.yml, .github/CI.md, .github/CODEOWNERS]
execution_mode: code_change
model: sonnet
owned_files: [apps/gateway/test/support/**, apps/gateway/test/e2e/**, .github/workflows/ledger-tests.yml, .github/CI.md, .github/CODEOWNERS]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP25 – Preuves de bout en bout, CI et consignation

> **Corrections après analyse** : `contracts/interfaces.md` § 13.4, § 13.6, § 13.7, § 13.8 : pas de `EDGE_PACK_DELAY_SECONDS` à tester ; `consignation.spec.ts` sur les onze écarts ; `CODEOWNERS` et branchement CI à toi ; NFR-006 échoue au-delà de 10 min, NFR-008 sur 50 blocages, NFR-007 et NFR-013 sont à toi.


> **Arbitrages de l'orchestrateur** : `contracts/interfaces.md` § 12 fait foi sur ce prompt, notamment pour § 12.8 et le rôle de référence de NFR-005.


## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude).
Lis ensuite la fiche de contexte, ce prompt, puis seulement :

- `spec.md` : tableau des NFR (NFR-001 à NFR-013), critères SC-001 à SC-007, FR-035 à FR-039 ; `quickstart.md` sections 5, 6, 7, 8 (relais,
  parcours en 17 étapes, pannes, correspondance preuve et exigence) ;
- `research.md` **R-26** (relais, points d'arrêt, deux processus, CI), **R-28** (seuils et méthodes), R-27 (canari), R-29 (contrat), R-30,
  section « Écarts de sécurité » ; `contracts/contract-stability-check.md` (sorties `0`, `2`, `1`, témoin positif) ;
- `contracts/interfaces.md` § 3, § 6, § 8, § 10 (points d'arrêt), § 11 ; `contracts/edge-routes.md` (liste des routes `/edge/*` pour
  NFR-011) ; `contracts/gateway-served-operations.md` (« Preuves attendues ») ;
- `docs/passation-8/rapports/plan-adversarial.md` A05, A19, A22, A23, A28, A29 ; `docs/passation-8/contexte-m8.md` décision 10 ; mémoire de
  poste : `local-test-environment-quirks` (horloge de la base, colima 3 Gio, Jest en `--runInBand`) ;
- code existant à lire (ne pas modifier) : `.github/workflows/ledger-tests.yml` (étapes l.126-241, job `ledger`, `timeout`),
  `.github/CI.md`, `apps/api/test/support/app.ts` (`startHttpsApp`), `tls.ts`, `db.ts`, `fake-device.ts`.

Ce lot **n'implémente aucune fonction de la mission** : il la prouve. Si une preuve échoue parce que
le code d'un lot est faux, il ne corrige pas ce code : il le signale à l'orchestrateur avec la
preuve minimale.

## Objective

Prouver l'exclusion de deux autorités et l'absence de perte, **avec deux processus, deux bases et un
relais coupable**, sur des seuils chiffrés (NFR-001 à NFR-013, SC-001 à SC-007) ; installer les
étapes de CI et le contrôle de stabilité du contrat ;
puis fermer la mission par la consignation finale des écarts de sécurité. Rien ne passe par un faux
en production ; les points d'arrêt ne sont actifs que hors production.

## Branch Strategy

Planification `feat/passerelle-locale`, cible `feat/passerelle-locale`, worktree alloué par lane
selon `lanes.json`.

## Commande

`spec-kitty agent action implement WP25 --agent claude --mission passerelle-locale-01M6NM1S`
(précédée de `LC_ALL=C LANG=C`).

Rappels : tu **écris** les suites et la CI ; tu ne lances ni Jest, ni pgTAP, ni `reset-db`
(l'orchestrateur joue la batterie en série, bases dédiées, jamais `cashless_test`) ; pas de commit ;
**port 80 intouché**, aucun test n'écoute dessus ;
ports du banc : central 3100, `edge` 3101, relais 3201, passerelle 3200 (voir `quickstart.md`), ou
ports libres choisis par le banc ; aucun `GRANT` ; aucune dépendance npm nouvelle ; un écart qui
affaiblit la sécurité s'arrête et remonte au porteur.

## T112 – Banc : relais TCP coupable, deux processus, deux bases (`test/support/`)

- `tcp-relay.ts` : `node:net` seul. `pause()` (retient les octets), `drop()` (ferme les connexions et refuse les nouvelles), `resume()`,
  `delayMs(n)`, `close()`. Transparent pour le TLS mutuel (le certificat client voyage jusqu'au central). Utilisable par code et en ligne de
  commande (`--listen 3201 --target 127.0.0.1:3101`). Test propre du relais (octets identiques, pause qui retient, drop qui coupe).
- `disposable-databases.ts` : crée et détruit `cashless_m8_central_<id>` et `cashless_m8_edge_<id>` (migrations du central jusqu'à la
  dernière, `roles.sql`, `post-roles.sql`, rôles `cashless_edge` et `cashless_edgeadmin` ; migrations `edge-NNNN` de la passerelle) sur le
  cluster du poste, **sans jamais toucher `cashless_test`** ; refuse tout nom hors du préfixe `cashless_m8_`.
- `two-process-bench.ts` : démarre (a) le processus public du central, (b) le processus `edge` (TLS mutuel, autorité `EDGE_CA`), (c) la
  passerelle en **processus enfant** (HTTPS réel, TLS 1.3, certificats générés par un `tls.ts` local ou par l'import de
  `apps/api/test/support/tls.ts`, import de test seulement), (d) le relais entre (c) et (b). `startHttpsApp` de l'API fixe
  `DATABASE_URL_APP` et `_PLATFORM` sur une seule base : le banc fixe les siennes, **une base par processus**. `GATEWAY_REQUEST_AUTHORITY`
  disjointe de `DEVICE_REQUEST_AUTHORITIES`, **sans joker**. Fournit : terminal simulé (`fake-device`), inscription par l'outil
  `tools/edge-admin`, ouverture de session de caisse et de vendeur au central, bascule et rendu par les routes humaines, lecture SQL des
  deux bases.
- `queue-generator.ts` : produit une file de N opérations valides **par `EdgeQueue.append`** (jamais par insertion SQL directe) pour NFR-002
  et NFR-006.
- `sql-probes.ts` : la requête de NFR-001 (R-28 : sur `journal_transaction`, `posting.id > W`, débit sur `WALLET_PAID/PROMO`, `source <>
  'EDGE_SYNC'`) ; contrôle de continuité de `edge_seq` au registre ; égalité des chaînes ; somme des soldes.
- `canary.ts` : génère un canari, ses **représentations** (UTF-8, hexadécimal minuscule et majuscule, base64, base64url, échappements JSON
  et SQL), une recherche sur fichier, répertoire, `pg_dump`, journaux et sorties d'enfants, et un **contrôle positif** (une fuite volontaire
  doit être trouvée).
- `jest.e2e.config.cjs` : `--runInBand`, délais longs, `jest.preset.cjs`, même `transformIgnorePatterns` que l'API. Le script npm `test:e2e`
  est un fichier de `interfaces.md` § 11 (`apps/gateway/package.json` appartient à WP16) : une ligne dans ton rapport.
- Le banc ne lit jamais l'horloge de PostgreSQL pour la comparer à celle de Node : les seuils se mesurent côté serveur, avec des marges
  (décalage de 0 à 120 ms du conteneur).

## T113 – Parcours SC-001 (`sc-001-journey.spec.ts`)

Les 17 étapes de `quickstart.md` § 6, sans intervention autre que les demandes d'admin :
inscription, session de caisse et session vendeur au central, bascule (`202`, époque +1), accusé,
ventes (`409 DEBIT_AUTHORITY_EDGE` au central avec `edge_base_url` et `authority_epoch`, `201` sur
la passerelle), recharge espèces, activation, caution,
refus (caution sur solde, QR, restitution : `409 DEBIT_AUTHORITY_EDGE`, rien d'écrit), blocage
répliqué en moins de 5 s, coupure (`pause`) puis retour (`CATCHING_UP` puis `ACTIVE`, réplication
sans trou), rendu (`RELEASING`, vidage, `releaseEdgeHandover`), fermeture de caisse (le comptage
inclut les espèces de la coupure),
**deuxième cycle** sur la même passerelle (A05 : `operations_count` du second rendu =
`final_edge_seq` moins le numéro d'activation), puis purge (étape 17). **À la fin : soldes du
central égaux à ceux de la passerelle** (SC-001) et aucune ligne `anomaly` inattendue.

## T114 – Charge : NFR-001, NFR-002, NFR-005, NFR-006, NFR-007 (et NFR-003 en T115)

- `exclusion-under-load.spec.ts` (**NFR-001, SC-002**) : bascule sous **100 débits par seconde** vers le central pendant la bascule, puis
  rendu sous charge ; la requête de `sql-probes.ts` rend **0** ligne (aucun débit de portefeuille de source autre que `EDGE_SYNC` après
  `W`), **0 opération perdue**, chaque requête reçoit 2xx, 4xx ou `409 DEBIT_AUTHORITY_EDGE`. Plusieurs essais (SC-002 dit 100 % des essais)
  : au moins 20 bascules et rendus enchaînés. Contrôle de sensibilité : la même requête, sur une base où on insère à la main un débit
  `source = 'API'` après `W`, **rend une ligne** (sinon le test ne prouve rien).
- `release-10000.spec.ts` (**NFR-002, SC-003, NFR-006**) : file de **10 000** opérations, `kill` de la passerelle au milieu du vidage,
  redémarrage ; 0 débit de passerelle après `RELEASING` (horodatage du journal local contre la date de `RELEASING`) ; `edge_seq` 1..10 000
  **continus au registre**, chaîne égale, 0 perdue, 0 écrite deux fois ; durée du vidage **inférieure à 10 minutes** (20 lots de 500, un lot
  en vol) : la mesure est enregistrée dans la sortie du test ; la valeur est « à remesurer en recette » (R-28), elle n'est pas un seuil de
  CI instable (marge documentée).
- `latency-two-process.spec.ts` (**NFR-005, SC-004**) : **1 000 paiements** en série puis à concurrence 10, deux processus, LAN simulé,
  mesure **serveur seul** : p95 <= 200 ms, p99 <= 500 ms ; échoue si moins de 1 000 observations.
- `handover-and-freshness.spec.ts` (**NFR-007, NFR-008**) : accusé en moins de 30 s après l'accord (lien sain, moins de 10 000 écritures à
  rattraper), et un test avec **notification perdue** (repli de 2 s) ; blocage appliqué sur la passerelle en moins de 5 s au p95 sur N
  essais.

## T115 – Pannes : NFR-003, NFR-004, SC-003, SC-005

- `replay-100.spec.ts` (**NFR-003**) : 100 rejeux d'une même opération par **trois chemins** (envoi direct au central, via la passerelle,
  journal de terminal après reprise forcée) : **1 écriture** par clé d'idempotence, par chemin ; lot de terminal relayé puis rejeu direct :
  un seul effet.
- `crash-points.spec.ts` (**NFR-004**) : `EDGE_ALLOW_FAILPOINTS=1` hors production. Pour `before-local-write`,
  `after-local-write-before-reply`, `during-drain-after-send-before-result`, `after-releasing-persisted`, puis **`kill-local-database`** (le
  processus signale avoir atteint le point et attend ; **le banc exécute `docker kill` du conteneur PostgreSQL local**, le relance, la
  passerelle se reconnecte) : 0 perte, numérotation continue, **aucune réponse 2xx sans entrée de file**, lot renvoyé à l'identique. Vérifie
  aussi que `fsync`, `full_page_writes`, `synchronous_commit` sont actifs sur la base de la passerelle du banc (A28).
- `forced-resume.spec.ts` (**SC-005, US7**) : arrêt de la passerelle, `force: true` + `gateway_confirmed_offline: true`, approbation d'une
  **seconde personne** : révocation, époque +1, handover `FORCED`, **moins de 5 minutes** une fois les deux personnes présentes ; aucune
  opération acquittée par un terminal n'est perdue ; journal du terminal renvoyé : `DUPLICATE` pour les opérations déjà rejouées (sans
  anomalie), `EDGE_REPLAY_FAILED` pour une référence inconnue, `TOPUP_CASH` en anomalie avec le montant (décision 4). Refus d'une reprise
  forcée à une personne.

## T116 – Sécurité : NFR-009 à NFR-013

- `production-refusals.spec.ts` (**NFR-009, SC-007**) : pour **chaque** réglage de la liste de R-26 (A19) un démarrage réel en production
  refuse : `HARDWARE_KEYSTORE=fake`, `EDGE_CA` factice (côté central **et** passerelle), vérificateur d'identité de test, `EDGE_FAILPOINT`,
  `EDGE_ALLOW_FAILPOINTS`, `CORS_ALLOW_ALL`, écoute sans TLS, joker d'autorité, secret de test, `fsync` / `full_page_writes` /
  `synchronous_commit` désactivés, `NODE_ENV` absent ou `staging`, `EDGE_PACK_DELAY_SECONDS=0`. Le test **énumère la liste du code**
  (`startup-guard.ts` et la garde du central) et échoue si une règle enregistrée n'a pas de démarrage réel correspondant dans la suite
  (couverture à 100 % des ports à faux). Contrôle positif : une configuration de production saine démarre.
- `canary-end-to-end.spec.ts` (**NFR-010**) : un canari (PWD de bracelet, clé de jeton, empreinte de jeton de rafraîchissement) traverse le
  flux, les snapshots et `getMediaAuthKey` ; recherche sous toutes ses représentations dans le **flux** (corps de réponse du central), la
  **base de la passerelle** (`pg_dump`), les **journaux de PostgreSQL local** (`log_statement = all`), la **sortie des processus enfants**
  et l'**image** (`docker save` de `apps/gateway/Dockerfile`, étape de CI ; hors CI le test construit l'image seulement si Docker est
  présent et **échoue sinon avec un message clair, il ne saute pas en silence**). Contrôle positif obligatoire. Aucune clé maître de
  bracelet dans l'image.
- `scoping.spec.ts` (**NFR-011**) : pour **chaque route `/edge/*`** (liste lue dans `openapi.yaml`) et pour la lecture `getDebitAuthority`
  en `edgeMtls` : un certificat de la passerelle B, d'un autre événement, d'un autre prestataire, révoqué, ou de terminal est refusé et ne
  lit **rien** d'autre ; un certificat de passerelle sur une route de terminal est refusé. Le test échoue si une route `/edge/*` du contrat
  n'est pas couverte.
- `purge-end-to-end.spec.ts` (**NFR-013**) : clôture de l'événement (automatique) puis ordre à deux personnes (manuel) : 0 occurrence du
  canari sous toute représentation, `sign` et `agree` refusés ; purge manuelle refusée si la file n'est pas acquittée.
- `contract-stability.spec.ts` (**NFR-012, SC-006**) : lance `node tools/contract-stability/check.mjs` sur le dépôt : sortie **0** ; sur une
  **copie modifiée** d'`openapi.yaml` hors `/edge/*` : sortie **2** ; sur une valeur d'énumération ajoutée : **2** ; avec une référence
  introuvable ou falsifiée : **1** (le témoin positif ne passe jamais sur une panne : on distingue `2` de `1`, A23).

## T117 – CI et consignation finale

**CI** (`.github/workflows/ledger-tests.yml`, `.github/CI.md`) :
- nouvelle étape « Stabilité du contrat (témoin positif) » juste après « Types du contrat à jour » : `node
  tools/contract-stability/check.mjs` puis le test du comparateur ; échec si la sortie n'est pas `0`. **Chemin de l'outil :
  `tools/contract-stability/check.mjs` (`interfaces.md` § 6)**, pas `packages/contracts/scripts/check-stability.mjs` ni `npm run
  check:stability` (contradiction signalée plus bas).
- migrations du central **et** de la passerelle, puis étape `gateway-integration` (suites `apps/gateway/test/**` hors `e2e`), `--runInBand`
  ;
- **job séparé** `gateway-e2e` (service `postgres:17`, Docker disponible sur `ubuntu-24.04`), en série, délai propre (le job `ledger` a un
  arrêt à 20 minutes, la batterie de bout en bout est plus longue : ne touche pas à ce délai), qui joue `test/e2e` avec
  `jest.e2e.config.cjs`, construit l'image et la balaye (`docker save` pour le canari ; balayage des vulnérabilités des condensats,
  DIRECTIVE_051, résultat consigné dans le journal du job) ;
- aucune étape n'écoute sur le port 80 ; aucune action tierce nouvelle non épinglée ; les secrets du banc sont des valeurs de test locales.
- `ci-workflow.spec.ts` : lit le workflow et échoue si l'une de ces étapes manque ou si le contrôle de stabilité est `continue-on-error`.

**Matrice d'acceptation exécutable** (`acceptance-matrix.spec.ts`) : tableau NFR-001 à NFR-013 et
SC-001 à SC-007 vers le fichier de test qui les prouve (lots 1 à 24 compris : par exemple NFR-005
vers WP21 et `latency-two-process.spec.ts`) ; le test échoue si un fichier cité n'existe pas ou ne
contient aucun `it(`/`test(`.

**Consignation finale** (`consignation.spec.ts`, plus les textes) : vérifie que
`docs/POINTS_OUVERTS.md` contient `OP-N100` à `OP-N110`, `docs/DECISIONS_ADR.md` contient `ADR-155`
à `ADR-165` avec risque, raison, mission qui lève, condition de levée ; que chaque écart a son test
de borne **nommé** (jeton de rafraîchissement sans rotation, tolérance 12 h + 1 s, `STALE`
plausible, purge, clés simulées, inscription par une personne,
plafonds de rejeu) ; que `PROMPTS-A-ENVOYER.md` et `PRD.md` reportent les écarts à la mission 12b et
aux suivantes. **Tu ne réécris pas ces documents** : ils ne sont pas dans ta carte ; tu y fais au
plus les changements d'**état** (« preuve livrée par WP25 ») avec une ligne dans le rapport, et tu
listes tout manque à l'orchestrateur.
Liste dans le rapport les **fichiers à faire relire par une personne** (règle 4 de `CLAUDE.md`) :
clés et cryptographie (`key-store`, jetons, `site-order`, `media-auth-key`), droits de la base
(WP09), purge, `edge-0001`, bornes de rejeu (WP06).

## Sécurité

- Les points d'arrêt et le faux du port matériel ne vivent que dans les processus du banc, hors production ; un test (production-refusals)
  prouve qu'ils sont refusés en production.
- Aucun secret réel, aucune clé maître dans le dépôt ni dans l'image ; certificats du banc générés à la volée et jetés.
- Le banc ne touche ni la base `cashless_test` ni le port 80 ; il refuse (erreur explicite) de se lancer sinon.

## Contradictions à signaler

1. Outil de stabilité : `contracts/contract-stability-check.md` (`packages/contracts/scripts/check-stability.mjs`, `npm run check:stability
   -w @cashless/contracts`, `quickstart.md` § 8) contre `interfaces.md` § 6 et `tasks.md` WP01 (`tools/contract-stability/check.mjs`) :
   `interfaces.md` fait foi.
2. Noms de bases : `research.md` R-26 (`cashless_edge_test`) contre `quickstart.md` (`cashless_m8_central`, `cashless_m8_edge`) : le banc
   utilise le préfixe `cashless_m8_` avec suffixe jetable.
3. Arborescence de tests : `quickstart.md` § 8 (`test/unit`, `test/integration`) contre l'attribution par lot de `contexte-m8.md`
   (`test/startup`, `test/authority`...) : l'attribution par lot fait foi.
4. `tasks.md` T116 cite NFR-009 à NFR-012 ; NFR-013 (purge) existe dans `spec.md` et n'est pas dans la table du quickstart § 8 : ce lot la
   couvre.
5. NFR-005 est mesuré par WP21 (T097, un processus) et ici (deux processus, R-28) : la preuve de référence est celle de ce lot.

## Definition of Done

- [ ] Banc : relais, deux processus, deux bases, générateur de file, sondes, canari avec contrôle positif.
- [ ] Une suite par exigence NFR-001 à NFR-013 et SC-001 à SC-007, avec un contrôle de sensibilité là où une preuve peut passer à vide (NFR-001, NFR-009, NFR-010, NFR-012).
- [ ] CI : stabilité du contrat, intégration de la passerelle, job `gateway-e2e` ; `CI.md` à jour ; `ci-workflow.spec.ts` vert.
- [ ] Matrice d'acceptation et consignation vérifiées par test ; fichiers à relire listés ; contradictions signalées ; lignes de 100 caractères.

## Ce que le relecteur doit casser

- Supprimer la requête de NFR-001 de son contrôle de sensibilité : le test doit rester capable d'échouer. Insérer un débit `source = 'API'`
  après `W`.
- Faire passer le contrôle de stabilité avec une panne du script (sortie `1`) : il doit être rouge, pas vert.
- Retirer une règle de la garde de production sans retirer son test, ou l'inverse : l'énumération doit échouer.
- Journaliser le canari en base64 dans la passerelle : le test de canari doit échouer.
- Lancer le banc avec `PGDATABASE=cashless_test` ou sur le port 80 : refus explicite.
- Exécuter la batterie deux fois d'affilée sur le même poste : aucune base résiduelle, aucun port occupé, résultats identiques.
