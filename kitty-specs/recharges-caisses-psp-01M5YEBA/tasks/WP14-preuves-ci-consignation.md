---
work_package_id: WP14
title: Preuves de bout en bout, CI et consignation
dependencies: [WP08, WP09, WP10, WP11, WP12, WP13]
requirement_refs: [NFR-001, NFR-007, NFR-008, NFR-010, FR-031, C-008]
planning_base_branch: feat/recharges-caisses-psp
merge_target_branch: feat/recharges-caisses-psp
branch_strategy: Planning artifacts for this mission were generated on feat/recharges-caisses-psp. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/recharges-caisses-psp unless the human explicitly redirects the landing branch.
subtasks: [T069, T070, T071, T072, T073, T074]
phase: Phase 5 - Preuves et consignation
history:
- timestamp: '2026-10-27T15:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent: claude
model: sonnet
agent_profile: implementer-ivan
role: implementer
authoritative_surface: apps/api/test/integration/end-to-end/
execution_mode: code_change
owned_files: [apps/api/test/integration/end-to-end/topup-*.spec.ts, apps/api/test/integration/end-to-end/cash-*.spec.ts, apps/api/test/integration/end-to-end/psp-*.spec.ts, .github/workflows/**, docs/POINTS_OUVERTS.md, docs/DECISIONS_ADR.md]
create_intent: [apps/api/test/integration/end-to-end/topup-journey.spec.ts, apps/api/test/integration/end-to-end/topup-isolation.spec.ts, apps/api/test/integration/end-to-end/topup-secrets.spec.ts, apps/api/test/integration/end-to-end/topup-latency.spec.ts, apps/api/test/integration/end-to-end/cash-concurrency.spec.ts, apps/api/test/integration/end-to-end/psp-concurrency.spec.ts, apps/api/test/integration/end-to-end/psp-production.spec.ts]
tags: []
tracker_refs: []
---

# Work Package Prompt: WP14 – Preuves de bout en bout, CI et consignation

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche de contexte d'implémentation fournie par
l'orchestrateur, ce prompt, puis seulement, dans `kitty-specs/recharges-caisses-psp-01M5YEBA/` :
- `spec.md` : Success Criteria SC-001 à SC-008, **tous** les FR, NFR et C (tu dresses la liste des
  preuves), Edge Cases ; `plan.md` : IC-11 et « Contrôle après conception » (limites et
  renforcements consignés) ; `research.md` R-17 et R-20 ; `research-adversarial.md` (A5, A13, A16,
  A17, A22, A24, A27, A32 : reports et preuves attendues) ;
- les **comptes rendus de WP01 à WP13** (fin de chaque `tasks/WPxx-*.md`) : écarts, points soumis au
  porteur, fichiers à relire, critères couverts, contradictions et lacunes signalées ;
- modèles : `apps/api/test/integration/end-to-end/payment-journey.spec.ts`,
  `payment-isolation.spec.ts`, `payment-secrets.spec.ts`, `payment-latency.spec.ts`,
  `payment-concurrency.spec.ts`, `apps/api/test/support/device-e2e.ts`, `app.ts`,
  `test-terminal.ts`, `fake-customer.ts`, `.github/workflows/ledger-tests.yml`, `.github/CI.md` ;
- `docs/passation-6/REPRISE.md` (« Fichiers à faire relire par une personne (prévus) »),
  `docs/POINTS_OUVERTS.md` (OP-N43, OP-N49, OP-N81, OP-N82), `docs/DECISIONS_ADR.md` (ADR-63,
  ADR-77, ADR-89, ADR-131, ADR-132, ADR-133), `PROMPTS-A-ENVOYER.md` (missions 6, 6b, 7, 9, 10, 13)
  et `PRD.md`.

Règle §0.3 : en cas de contradiction entre sources, appliquer la priorité (tests exécutables >
schéma SQL, `openapi.yaml`, `sync_protocol.md` > SPECIFICATION > `PRD.md`) et **la signaler**. Ne
jamais modifier un fichier `.sql` généré de `packages/ledger-sql/`.

## Objective

Prouver la mission de bout en bout par l'API (parcours SC-001, isolation SC-007, secrets SC-006,
concurrence SC-003 et NFR-001/NFR-008, latence NFR-006/NFR-009, gardes de production SC-008),
ajouter les mesures à la CI, **vérifier** que la consignation faite au fil des lots est complète
(OP-N49 levé, OP-N81, OP-N82, ADR-131 à ADR-133, reports), préparer la matrice d'acceptation (preuve
de chaque critère) et dresser la liste des fichiers à faire relire par une personne.

## Context

- Exigences : voir frontmatter, plus SC-001 à SC-008, NFR-001 à NFR-010 ; IC-11. La **matrice
  d'acceptation** (`acceptance-matrix.json` de la mission) est tenue par l'orchestrateur à chaque
  approbation de lot : ce lot fournit, pour **chaque** critère de `spec.md` (FR-001 à FR-031,
  NFR-001 à NFR-010, C-001 à C-010, SC-001 à SC-008), la preuve (fichier et nom du cas, commande,
  résultat) ; il ne crée pas le fichier (hors carte). Un critère sans preuve est un **constat
  bloquant** à remonter.
- Consignation déjà faite au plan : OP-N81 / ADR-131 (PSP réels et coffre reportés, faux refusés en
  production), OP-N82 (remboursement du paiement non crédité hors plateforme), ADR-132 (contrôle des
  caisses renforcé), ADR-133 (frais par configuration, anomalie `PSP_TOPUP_NOT_CREDITED`, actions,
  `A-PSP-*` négatif), reports aux missions 6b, 7 (A17), 9 (A16, A32) dans `PROMPTS-A-ENVOYER.md` et
  `PRD.md`. T073 **vérifie et complète** ; il ne reconstitue pas, il ne devine pas une décision.
- Seul ajout attendu : **OP-N49 levé** (livré par WP02 et WP09), plus l'entrée de toute dette
  acceptée en cours de mission que les comptes rendus révèlent sans entrée.
- Écritures directes en base dans les tests : amorçage seulement (jeu d'essai commun), comme les
  suites de la 5b ; SC-001 exige un parcours **sans** intervention directe en base.

**Règle de sécurité du projet (`CLAUDE.md`, règle 1 et règle 4)** : si un point de ce lot ne peut
être tenu qu'en affaiblissant la sécurité (seuil relâché, cas retiré d'une matrice, écart non
consigné, faux toléré), **arrête-toi sur ce point et soumets-le au porteur avant de coder**, avec le
risque et les options ; continue le reste. Un renforcement se fait, puis se consigne. **Un écart de
sécurité trouvé dans un compte rendu sans entrée consignée est un constat bloquant** (règle 4) à
remonter à l'orchestrateur.

## Arbitrages de l'orchestrateur (27/10/2026)

Tous dans le sens le plus strict ou de pure répartition. Ils priment sur le reste du prompt.

- **Aucune retouche de code de production.** Un défaut trouvé par une preuve est renvoyé à
  l'orchestrateur (lot propriétaire), jamais corrigé ici. Seules retouches hors carte permises, docs
  seulement : `.github/CI.md` (tableau des passes) ; `PROMPTS-A-ENVOYER.md` et `PRD.md` **si** un
  report manque (T073).
- **Seuils exacts, jamais relâchés pour passer** : NFR-006 (accusé de réception d'une notification)
  p95 ≤ 500 ms ; NFR-009 (recharge espèces) p95 ≤ 200 ms. Une mesure qui échoue en local est mesurée
  seule, sans autre suite, puis signalée ; le seuil ne change qu'avec l'accord du porteur.
- **Notifications par la vraie route HTTP.** Dans le parcours, l'isolation, les secrets et la
  latence, les notifications du faux PSP sont postées sur `POST
  /webhooks/{provider}/{psp_config_id}` avec la vraie signature (outil de notification signée de
  WP07), jamais en appelant `PspPaymentProcessor` directement.
- **Aucune hypothèse d'horloge entre Node et la base** (Docker, qui peut reculer) : les dates des
  notifications et des plafonds du jour viennent de l'horloge de Node seule ou de valeurs fixées.
- **Le balayage des secrets doit chercher quelque chose** : le test échoue s'il ne trouve pas les
  empreintes ou les marqueurs attendus aux endroits attendus (contrôle du balayage).
- **L'isolation se lit dans le contrat** (liste des opérations de la mission lue dans
  `openapi.yaml`), pas dans une liste écrite à la main : une route ajoutée plus tard sans cas fait
  échouer le test.
- Lot en série : concurrence, latence et parcours ne tournent jamais en parallèle d'autres suites.

- **Noms de WP07 (font foi)** : jetons `PSP_ADAPTERS` (`PspAdapterRegistry`) et
  `PSP_SECRET_STORE`, `FakePspAdapter`, `FakePspSecretStore` (le « faux coffre » ci-dessous),
  `signFakeNotification`, `verifyHmacSignature`, `WEBHOOK_TOLERANCE_SECONDS`, types
  `NormalizedPayment`, `NormalizedNotification`, `Secret`. Les canaris de secrets passent par
  `FakePspSecretStore` ; `PspAdapter.cancel(query, secrets)` existe (annulation) et
  `verifyNotification` rend `signedAt`.
- **Contrat de WP11 (pour mémoire)** : `PspTopupLookup.findForUpdate`,
  `PspPaymentProcessor.process`, `settleUnpaid`, `afterCommit` : les parcours n'y touchent pas
  directement (notifications par la route HTTP) ; les tests de concurrence peuvent l'espionner.
- **`WALLET_BLOCKED` reste `422`** (`CL039`) dans les parcours ; l'écart avec `contracts/psp.md`
  (409) est signalé dans la consignation, pas corrigé. Codes `CL041` à `CL044` : parcours de
  refus attendus (fermeur qui a compté `403` `CL041`, `PSP_NOT_CONFIGURED` `409` `CL042`).
- **Consignation de la décision du porteur du 27/10/2026** : `open_event_ledger` inchangée,
  `open_psp_accounts` étroite (`SECURITY DEFINER`, comptes `A-PSP-*` seulement) : à porter dans
  `DECISIONS_ADR.md` et à lister parmi les fichiers à faire relire (`0037`).
## Branch Strategy

Planification et fusion sur `feat/recharges-caisses-psp`. Dépendances : WP08 à WP13 (donc tous les
lots). Worktree attribué par lane d'après `lanes.json`. Commande : `spec-kitty agent action
implement WP14 --agent claude --mission recharges-caisses-psp-01M5YEBA`.

## Subtasks

### T069 — Parcours complet (SC-001, SC-002, SC-003, SC-004, SC-005)

`topup-journey.spec.ts`, étapes numérotées comme `payment-journey.spec.ts`, **tout par l'API**
(HTTPS réel, terminal de test `TOPUP_DESK`, vraie base, festivalier par le faux de la 5b, faux PSP
signeur de WP07). Relève les noms des opérations dans `openapi.yaml` et dans les comptes rendus de
WP08, WP10, WP13 (routes de demande `requestPspConfigurationChange`, `requestCashDeposit`,
`requestLateChargeback`, `requestWalletUnblock`, ajoutées par WP01 : chemins de `openapi.yaml` ; si
l'une est absente, c'est un défaut de WP01/WP08/WP10/WP13 à renvoyer à l'orchestrateur, pas un
contournement par le service).
1. Configuration : deux `OPERATOR_ADMIN` ; l'un crée les configurations `WAVE`, `ORANGE_MONEY`,
   `CARD` (`DRAFT`) ; règles de frais `PSP_CONFIGURATION` ; l'autre approuve (`ACTIVE`) ; activation
   d'une configuration sans règle de frais refusée ; `ORGANIZER_ADMIN` choisit les configurations de
   l'événement ; passage de l'événement à `LIVE` (étapes existantes de la 3) ; un changement de
   choix pendant `LIVE` : `202`.
2. **Espèces sans session (SC-002, OP-N49 levé)** : sur le terminal, avant toute session,
   `takeDeposit` (espèces) et `refundCashDue` → `409` ; recharge espèces → `409`. Le cas porte le
   nom **`SC-002 : OP-N49 levé`**.
3. Ouverture de session par le caissier (terminal + personne), recharge espèces (plafond en ligne :
   refus `422` au-delà, rien d'écrit), caution en espèces prise, espèces dues rendues, libération du
   bracelet avec espèces, toutes rattachées à la session ; aucune réponse n'a montré le théorique
   (SC-005).
4. Recharge mobile money au guichet (`initiatePspTopup`, `Idempotency-Key = serial:seq`) puis
   notification signée de succès sur la route publique → `TOPUP` écrit une fois, recharge
   `SUCCEEDED`, caution due prise après le crédit ; rejeu de la notification → `duplicate: true`,
   rien de plus. Même parcours pour la carte par le festivalier (3-D Secure attesté).
5. Paiement non créditable (SC-004) : carte sans 3-D Secure, puis succès qui dépasserait le plafond
   du portefeuille : recharge `FAILED`, **aucune** ligne au grand livre, anomalie portant le montant
   à rendre.
6. Contestation de la recharge carte (notification `DISPUTE`) : `CHARGEBACK`, portefeuille bloqué si
   le solde payé ne couvre pas ; déblocage à deux (`WALLET_UNBLOCK`, par `requestWalletUnblock`).
7. Fermeture : comptage par le caissier (réponse sans théorique), fermeture par un `SUPERVISOR` qui
   n'a pas compté (`CASH_CLOSE` égal au théorique, `CASH_DIFF` si écart), refus d'un fermeur qui a
   compté (`403`), rejeu de la fermeture (même réponse) ; dépôt en banque `CASH_DEPOSIT` à deux
   (`requestCashDeposit`),
   refusé au-delà du transit.
8. Contrôles finaux **en lecture** : balance du grand livre à zéro ; chaque recharge `SUCCEEDED` a
   exactement un `TOPUP` (clé du moyen) et chaque `TOPUP` PSP une recharge ; aucune écriture
   d'espèces hors session (jointure `posting` des comptes `CASH_DESK` et `cash_session_tx`) ; toute
   recharge `FAILED` après paiement a son anomalie ; chaque session fermée hors théorique et compté
   nuls a son `CASH_CLOSE`.

Cas limites à tenir dans le parcours : sessions de deux terminaux distincts (aucune confusion de
caisse) ; recharge PSP et recharge espèces du même portefeuille ; reprise d'une recharge `PENDING`
par le travailleur (`PspTopupPollerWorker.runOnce()` de WP12, appelé directement) pour un succès
jamais notifié.

Validation :
- [ ] Parcours sans écriture directe en base après l'amorçage (ou amorçage nommément listé).
- [ ] Les huit contrôles finaux échouent si on supprime une étape (un `TOPUP`, un `CASH_CLOSE`).

### T070 — Isolation route par route et balayage des secrets avec canari (SC-006, SC-007)

`topup-isolation.spec.ts` sur le modèle de `payment-isolation.spec.ts` ; `topup-secrets.spec.ts` sur
celui de `payment-secrets.spec.ts`.
1. **Isolation** : deux prestataires A et B (et deux organisateurs d'un même prestataire). Test de
   garde : la liste des opérations de la mission est lue dans `openapi.yaml` (chemins
   `/cash-sessions…`, `/topups/…`, `/organizers/{…}/psp-configurations`, `/psp-configurations/…`,
   `/events/{…}/psp-selections…`, `/webhooks/…`, et les opérations de contestation / dépôt relevées
   dans les comptes rendus) et **chaque** opération a un cas dans ce fichier. Pour chaque route : B
   (personne, terminal ou festivalier) sur un objet de A → jamais `2xx`, `404` sans fuite, rien ne
   change (comparaison avant / après) ; listes de B sans objet de A ; organisateur 2 ne voit pas les
   configurations, choix, sessions de l'organisateur 1. Route publique : la configuration de A
   présentée sous le chemin d'un autre fournisseur, ou inconnue, ou suspendue → mêmes corps et
   en-têtes de `404`. Pour chaque **nouvelle table** (`cash_session`, `cash_session_count`,
   `cash_session_tx`, `cash_desk`, `psp_configuration`, `event_psp_selection`, `psp_topup`,
   `psp_event`, `psp_chargeback`, `psp_webhook_rejection`) : sous `cashless_app` avec le prestataire
   B posé, 0 ligne de A. Aucune route accessible à un `CASHIER` ne rend le solde d'un compte
   `CASH_DESK` (inventaire des réponses, A27).
2. **Secrets (canari)** : les secrets du faux coffre (secret d'adaptateur, secret de notification
   courant et précédent) et les valeurs de signature envoyées reçoivent des marqueurs
   reconnaissables, aléatoires et propres à la suite. Après un parcours qui touche tout ce qui porte
   un secret (création et lecture de configurations par `OPERATOR_ADMIN` et `ORGANIZER_ADMIN`,
   recharges, notifications acceptées, refusées avec signature fausse, horodatage faux, corps trop
   gros, configuration suspendue, rejeux, travailleur, contestation), chaque marqueur est recherché
   sous toutes ses formes (texte, hexadécimal comme `bytea`, base64) dans **toutes** les tables
   (dont `api_idempotency`, `audit_log`, `psp_event`, `anomaly`, `psp_webhook_rejection`), dans tout
   ce qui part au journal (`Logger` de Nest, `console`, sorties) et dans toutes les réponses, y
   compris d'erreur : 0. Le corps d'une notification refusée n'apparaît nulle part (seule son
   empreinte SHA-256 est au journal). `psp_event.body` peut porter le corps d'une notification
   authentifiée (par conception) : le balayage le prouve en ne cherchant dans cette colonne que les
   secrets et les signatures, pas le corps. Contrôle du balayage : les empreintes SHA-256 attendues
   sont bien au journal, les configurations sont bien en base (le test échoue s'il ne cherche rien).
3. **Droit par colonne** : `SET ROLE cashless_app; SELECT secret_ref FROM psp_configuration` et
   `SELECT body FROM psp_event` → `42501` (preuve de WP05 rejouée de bout en bout, sans la refaire).

Validation :
- [ ] Une route ajoutée au contrat sans cas fait échouer la garde de couverture.
- [ ] Le test des secrets échoue si on journalise la signature reçue (mutation à tester à la main).

### T071 — Concurrence (NFR-001, NFR-008, SC-003)

`psp-concurrency.spec.ts` et `cash-concurrency.spec.ts`, par la vraie route HTTP quand l'enjeu est
l'entrée, par les services sinon. Aucun interblocage remonté ; aucune écriture partielle.
- **100 rejeux concurrents d'une même notification** (même identifiant) : 1 ligne `psp_event`, 1
  `TOPUP`, 99 réponses `duplicate: true`, solde crédité une fois.
- **100 notifications d'identifiants distincts pour le même paiement** (+ une interrogation du
  travailleur en même temps) : 1 `TOPUP` (clé qualifiée par la configuration), 1 recharge
  `SUCCEEDED`.
- **Notification mêlée à l'annulation** (`cancelPspTopup` pendant le succès) : un seul état final
  cohérent.
- **Plafond par carte** : deux recharges de la même empreinte qui dépassent ensemble le plafond du
  jour, envoyées ensemble : une seule créditée, l'autre non créditée avec anomalie.
- **Contestation** : 20 notifications `DISPUTE` identiques → 1 `CHARGEBACK` (rappel de WP13, compté
  ici).
- **Caisse** : fermeture pendant une recharge espèces (NFR-008) : soit la recharge précède `CLOSING`
  et entre dans le théorique, soit elle est refusée ; jamais d'écriture d'espèces après `CASH_CLOSE`
  ; deux fermetures simultanées → une seule `CASH_CLOSE` ; deux ouvertures simultanées → une session
  `OPEN`.
- Rappelle l'ordre des verrous (recharge → portefeuille → comptes ; caisse → session) dans l'en-tête
  des fichiers. Lancé en série avec le reste.

Validation :
- [ ] Chaque cas vérifie le nombre exact d'écritures **et** l'absence d'écriture partielle.
- [ ] Les cas échouent si l'on retire le verrou de ligne (mutation relevée par le relecteur de
      WP11).

### T072 — Latence (NFR-006, NFR-009), garde de production (SC-008) et CI

1. `topup-latency.spec.ts` : (a) 200 notifications authentifiées, **en série**, HTTPS réel, mesurées
   côté serveur autour du traitement de réception (le service de WP12, de la vérification au `200`,
   les deux transactions comprises) : **p95 ≤ 500 ms** (NFR-006) ; (b) 200 recharges espèces en
   série, mesurées autour de `CashTopupService` de WP09 : **p95 ≤ 200 ms** (NFR-009). p99 et maximum
   écrits sur la sortie. Sauté sous `SKIP_LATENCY` (`const latency = process.env.SKIP_LATENCY ?
   it.skip : it`), comme `payment-latency.spec.ts`.
2. `psp-production.spec.ts` (SC-008, C-007) : (a) balayage de `apps/api/src` (lecture de fichiers)
   des classes qui portent `isFake` ; chacune doit être nommée dans
   `test/unit/production-guard.spec.ts`, sinon le test échoue (un faux ajouté plus tard sans preuve
   de refus est vu) ; (b) rejoue le démarrage en configuration de production par le point d'entrée
   de `processes/bootstrap.ts` : chaque faux PSP (par fournisseur), le faux coffre, l'identité
   festivalier fausse → refus ; le processus public démarre avec des fournisseurs « indisponibles »
   : routes d'espèces servies, `initiatePspTopup` → `503 PSP_UNAVAILABLE`, notification → `404`.
   Réutilise les aides de WP07, ne les copie pas.
3. `.github/workflows/ledger-tests.yml` (propriété de ce lot, rien d'existant retiré ni rendu
   facultatif) : étape « Latence des recharges, NFR-006 et NFR-009 (suite seule, sans nouvel essai)
   » après la passe parallèle : `npm test -w @cashless/api -- --runInBand end-to-end/topup-latency`
   ; vérifie que le script de `test:pgtap` énumère bien les nouvelles suites
   (`tests_cash_sessions.sql`, `tests_psp_configurations.sql`, `tests_psp_topups.sql`,
   `tests_cash_psp_rights.sql`, `tests_execute_grants.sql`) et que `check:generated` ne voit aucun
   `.sql` généré modifié (C-002) ; si une variable d'environnement nouvelle est exigée par un lot
   (relevée dans les comptes rendus), ajoute-la avec une valeur de test ; en-tête du fichier : une
   ligne pour la mission.
4. `.github/CI.md` (retouche hors carte, docs) : tableau des passes à jour (nombre de suites et de
   tests, mesures de latence de la mission).

Validation :
- [ ] `ledger-tests.yml` valide (syntaxe YAML relue), toutes les étapes d'avant présentes.
- [ ] Le test (a) de `psp-production.spec.ts` échoue si on ajoute une classe `isFake` non couverte.

### T073 — Consignation (vérification) et préparation de la matrice d'acceptation

Vérifier, et compléter **seulement** ce qui manque :
- `docs/POINTS_OUVERTS.md` : **OP-N49 levé** (date, lots WP02 et WP09, migration
  `0036_cash_sessions.sql`, suites `tests_cash_sessions.sql`, `deposit.spec.ts`, `cash-due.spec.ts`,
  `release.spec.ts`, cas `SC-002 : OP-N49 levé`) ; OP-N81 présent avec son test de borne
  (`production-guard.spec.ts`) ; OP-N82 complété (paiement non crédité hors plateforme, **écart
  attendu au contrôle « grand livre = relevé »**, anomalies à exclure du rapprochement, A16, mission
  9) ; **OP-N43** complété (routes festivalier `initiatePspTopup`, `getPspTopup`, `cancelPspTopup`
  derrière le faux, mission 10) ; l'octroi provisoire `[A8-DETTE]` de WP05 (« accordées jusqu'à WP09
  ») **levé** (test présent, droit retiré) ; tout écart de sécurité accepté dans un compte rendu de
  WP01 à WP13 a son entrée (risque, raison, mission qui le lève, condition de levée, test qui échoue
  si la limite s'élargit).
- `docs/DECISIONS_ADR.md` : ADR-131, ADR-132, ADR-133 présents et **cohérents avec ce qui a été
  livré** (relis-les contre les comptes rendus ; si un renforcement livré n'y figure pas, ajoute-le
  à l'ADR concerné ou crée l'ADR suivant) ; un ADR pour chaque nouvel écart accepté (sinon : constat
  bloquant).
- `PROMPTS-A-ENVOYER.md` et `PRD.md` : reports présents (mission 6b adaptateurs réels : OP-N81,
  OP-N82 ; mission 7 : session d'une recharge espèces hors ligne, A17 ; mission 9 : rapprochement
  qui exclut les anomalies de paiements non crédités A16, session ouverte avant `RECONCILING` A32 ;
  mission 10 : festivalier ; mission 13 : dimensionnement relevé par les lots) ; section « Mission 6
  » à jour de ce qui a été livré. Retouche docs seulement, si un report manque, avec mention au
  compte rendu.
- Documents transverses de `docs/` (description produit, API, séquences, `spec-index.json`) : **ne
  les modifie pas** ; ils relèvent du skill `spec-kitty-docs-maintain` que l'orchestrateur invoque
  après la revue. Liste dans le compte rendu les routes, tables, processus et diagrammes à
  documenter.
- **Préparation de la matrice d'acceptation** : dans le compte rendu, un tableau à trois colonnes
  (critère · preuve : fichier + nom du cas · commande et résultat), couvrant FR-001 à FR-031,
  NFR-001 à NFR-010, C-001 à C-010, SC-001 à SC-008, dans un format directement recopiable dans les
  entrées `criteria[]` de la matrice (`criterion_id`, `proof_type`, `evidence`, `notes`). Pour les C
  (contraintes) : preuve par revue ou test de garde, nommée. Tout critère sans preuve : liste « non
  couverts » en tête du compte rendu (constat bloquant).

### T074 — Liste des fichiers à faire relire par une personne

Dresse dans le compte rendu, **avec la raison pour chacun** (l'agent qui a écrit le code ne vaut pas
relecture indépendante, règle 4) : `packages/ledger-sql/migrations/0036_cash_sessions.sql`
(`posting_cash_desk_guard`, `account_purpose_guard`, `begin_cash_close` / `finish_cash_close`,
fonctions `…_for_session`), `0037_psp_configurations.sql` (`activate_psp_configuration`, titulaire
des fonds, `secret_ref`, `open_psp_accounts`), `0038_psp_topups.sql` (`complete_card_topup` et son
verrou consultatif,
`record_chargeback`, `unblock_wallet`, `record_psp_event`), `packages/ledger-sql/post-roles.sql`
(droits par colonne et par fonction), `apps/api/src/webhooks/webhook-verifier.ts` et
`webhooks.controller.ts` (cryptographie, route sans identité), `apps/api/src/psp/` (ports, coffre,
comparaison à temps constant, échéance du secret précédent), `apps/api/src/processes/bootstrap.ts`
(`assertProcessIsSafe`), `apps/api/src/topups/psp/psp-payment-processor.ts`, `card-checks.ts` et
`psp-topup-caller.guard.ts` (argent, 3-D Secure, authentification composée),
`apps/api/src/chargebacks/` (blocage de portefeuille, contestation tardive),
`apps/api/src/psp-configurations/` (`secret_ref`, approbation liée à la version),
`apps/api/src/cash-sessions/` (comptage à l'aveugle, fermeture),
`apps/api/src/ledger/ledger-engine.service.ts` (découpage hors ligne) et
`configuration/sql-config-resolver.ts` (frais), plus **tout fichier signalé par un compte rendu**
(reprends leurs listes, sans doublon).

## Test Strategy

Ordre : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`, `npm run
test:pgtap -w @cashless/ledger-sql`, puis `npm run reset-db -w @cashless/ledger-sql &&
SKIP_LATENCY=1 npm test -w @cashless/api -- --runInBand` (suites de ce lot : `end-to-end/topup-`,
`end-to-end/cash-`, `end-to-end/psp-`), puis la suite de latence seule : `npm test -w @cashless/api
-- --runInBand end-to-end/topup-latency`. Jamais pgTAP sur une base où Jest vient de tourner
(rejouer `reset-db`). Base propre au lot : `cashless_wp14` ; `cashless_test` est réservée à
l'orchestrateur, qui rejoue en série ; latence et concurrence jamais en parallèle d'autres suites.
Dans un worktree de lane, créer d'abord les liens
`node_modules/@cashless/{api,contracts,ledger-sql,tag-format}`. Deux suites instables connues du
poste (claim-code-order, personalization) : à signaler, pas à corriger. Lignes de 100 caractères.

## Definition of Done

- [ ] Sous-tâches T069 à T074 faites ; `spec-kitty agent tasks mark-status Txxx --status done
      --mission recharges-caisses-psp-01M5YEBA` pour chacune.
- [ ] Suites de bout en bout vertes ; latence sous les seuils en local (valeurs notées) ; CI à jour
      ; NFR-010 : suites de la base, missions 1 à 5b et scénario de référence verts.
- [ ] Consignation vérifiée, OP-N49 levé, aucun écart de sécurité sans entrée ni ADR.
- [ ] Compte rendu du lot, en fin de ce fichier : écarts au plan (sens), retouches hors carte,
      points soumis au porteur, **critères non couverts** (s'il y en a), **tableau des preuves**
      (T073), **liste T074**, défauts renvoyés aux lots propriétaires, mesures de latence.

## Risks

- Mesure de latence faussée par une autre suite en parallèle, ou seuil relâché pour passer (interdit
  sans le porteur).
- Balayage des secrets qui ne cherche rien ; isolation figée sur une liste écrite à la main.
- Notification de test qui contourne la route publique (le contrôle de signature n'est alors pas
  prouvé).
- Consignation reconstituée à la fin au lieu d'être vérifiée : écart oublié, ou entrée inventée sans
  décision.
- Test de concurrence séquentiel déguisé (promesses attendues une à une) : n'éprouve aucun verrou.
- Matrice d'acceptation incomplète : critère « couvert » par un test qui ne le prouve pas.

## Reviewer Guidance

Vérifier : parcours sans écriture directe en base après l'amorçage, notifications par la route
publique ; isolation lue depuis le contrat, chaque route et chaque nouvelle table couvertes ;
secrets cherchés sous toutes leurs formes, dans `api_idempotency`, `audit_log`, `psp_event` et le
journal, avec contrôle du balayage ; latence en série, seuils exacts (500 ms et 200 ms, p95, 200
mesures) ; concurrence réellement parallèle (`Promise.all` sur des requêtes déjà émises), nombre
exact d'écritures, aucune écriture partielle ; CI : rien retiré, latence lancée seule ; OP-N49 levé
avec ses tests ; OP-N81, OP-N82, ADR-131 à ADR-133 cohérents avec les comptes rendus ; chaque écart
de sécurité des comptes rendus consigné (sinon constat bloquant) ; tableau des preuves complet
(chaque FR, NFR, C, SC) ; liste T074 complète.
