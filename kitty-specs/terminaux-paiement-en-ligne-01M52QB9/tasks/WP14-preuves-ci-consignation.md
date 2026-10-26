---
work_package_id: WP14
title: Preuves de bout en bout, CI, consignation
dependencies:
- WP09
- WP10
- WP11
- WP12
- WP13
requirement_refs:
- NFR-001
- NFR-002
- NFR-005
- NFR-006
- NFR-007
- NFR-008
- NFR-010
- C-010
planning_base_branch: feat/terminaux-paiement-en-ligne
merge_target_branch: feat/terminaux-paiement-en-ligne
branch_strategy: Planning artifacts for this mission were generated on feat/terminaux-paiement-en-ligne. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/terminaux-paiement-en-ligne unless the human explicitly redirects the landing branch.
subtasks:
- T066
- T067
- T068
- T069
- T070
- T071
- T072
phase: Phase 4 - Preuves et consignation
history:
- timestamp: '2026-10-22T14:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks-packages
agent_profile: node-norris
authoritative_surface: apps/api/test/integration/end-to-end/
create_intent:
- apps/api/test/integration/end-to-end/payment-journey.spec.ts
- apps/api/test/integration/end-to-end/payment-isolation.spec.ts
- apps/api/test/integration/end-to-end/payment-secrets.spec.ts
- apps/api/test/integration/end-to-end/payment-latency.spec.ts
- apps/api/test/integration/end-to-end/payment-concurrency.spec.ts
execution_mode: code_change
owned_files:
- apps/api/test/integration/end-to-end/payment-journey.spec.ts
- apps/api/test/integration/end-to-end/payment-isolation.spec.ts
- apps/api/test/integration/end-to-end/payment-secrets.spec.ts
- apps/api/test/integration/end-to-end/payment-latency.spec.ts
- apps/api/test/integration/end-to-end/payment-concurrency.spec.ts
- .github/workflows/ledger-tests.yml
- .github/CI.md
- docs/POINTS_OUVERTS.md
- docs/DECISIONS_ADR.md
- PROMPTS-A-ENVOYER.md
- PRD.md
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP14 – Preuves de bout en bout, CI, consignation

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load node-norris` (Profile : node-norris / Role : implementer / Agent : claude).
Lis ensuite la fiche de contexte d'implémentation fournie par l'orchestrateur, ce prompt, puis seulement :
- `spec.md` : Success Criteria SC-001 à SC-008, NFR-001, NFR-002, NFR-005 à NFR-008, NFR-010, C-010, Edge Cases ;
- `plan.md` : IC-12 et « Charter Check » (limites et renforcements consignés) ; `research.md` R-11 (A26, liste des
  fichiers à relire) ;
- les comptes rendus de lots WP01 à WP13 (fin de chaque `tasks/WPxx-*.md`) : écarts, points soumis au porteur,
  fichiers à relire, critères couverts ;
- modèles : `apps/api/test/integration/end-to-end/device-journey.spec.ts`, `device-isolation.spec.ts`,
  `device-secrets.spec.ts`, `device-latency.spec.ts`, `apps/api/test/support/device-e2e.ts`,
  `.github/workflows/ledger-tests.yml`, `.github/CI.md` ;
- `docs/POINTS_OUVERTS.md` (OP-N43, OP-N56, OP-N74, OP-N76), `docs/DECISIONS_ADR.md` (ADR-120, ADR-121),
  `PROMPTS-A-ENVOYER.md` (« Mission 5b » et blocs « Hérité de la mission 5b » des missions 7, 10, 11), `PRD.md`.

Règle §0.3 : en cas de contradiction entre sources, appliquer la priorité (tests exécutables > schéma SQL,
`openapi.yaml`, `sync_protocol.md` > SPECIFICATION > PRD) et **la signaler**. Ne jamais modifier un fichier `.sql`
généré de `packages/ledger-sql/`.

## Objective

Prouver la mission de bout en bout par l'API (parcours, isolation, secrets, latence, concurrence), ajouter les
mesures à la CI, **vérifier** que la consignation faite au fil des lots est complète, et dresser la liste des fichiers
à faire relire par une personne.

## Context

- Exigences : SC-001 à SC-008, NFR-001, NFR-002, NFR-005 à NFR-008, NFR-010, C-010 ; IC-12. La matrice d'acceptation
  (`acceptance-matrix.json`) est tenue par l'orchestrateur à chaque approbation : ce lot fournit les preuves (fichier et
  nom de cas), il ne la remplit pas.
- Consignation déjà faite au plan et au fil des lots : OP-N76 et ADR-121 (limite du PIN, levée avec OP-N56, mission 11),
  OP-N43 complété (`payPaymentRequest`, `createCustomerQrToken`), reports dans `PROMPTS-A-ENVOYER.md` et `PRD.md`.
  T071 **vérifie** et complète ; il ne reconstitue pas. Seul ajout attendu : la **levée d'OP-N74** (livrée par WP06).
- Écritures directes en base dans les tests : amorçage seulement (jeu d'essai commun), comme les suites de la 5a ;
  SC-001 exige un parcours **sans** intervention directe en base.

**Règle de sécurité du projet (`CLAUDE.md`, C-009, C-010)** : si un point de ce lot ne peut être tenu qu'en affaiblissant
la sécurité (seuil de test relâché, cas retiré d'une matrice, écart non consigné, faux toléré), **arrête-toi sur ce
point et soumets-le au porteur avant de coder**, avec le risque et les options ; continue le reste. Un renforcement se
fait, puis se consigne dans le compte rendu du lot. Un écart de sécurité trouvé dans un compte rendu sans entrée
consignée est un **constat bloquant** à remonter à l'orchestrateur (règle 4).

## Arbitrages de l'orchestrateur (22/10/2026)

Décisions prises à la génération des lots ; tous dans le sens le plus strict ou de pure répartition (aucun
affaiblissement, règle 1 de `CLAUDE.md`). Elles priment sur les « points à trancher » du texte ci-dessus et
ci-dessous. Reporter dans le compte rendu du lot les écarts au plan qui en découlent.

- T071 : lever OP-N74 et ADR-120 ; vérifier que les renforcements des arbitrages (WP04, WP05, WP06, WP07, WP11) et les écarts (pas de `x-process`, clé UUID des sessions, `reversals/`) sont consignés.

## Branch Strategy

Planification et merge sur `feat/terminaux-paiement-en-ligne`. Dépendances : WP09, WP10, WP11, WP12, WP13 (donc tous les
lots). Worktree attribué par lane (`lanes.json`). Commande : `spec-kitty agent action implement WP14 --agent claude
--mission terminaux-paiement-en-ligne-01M52QB9`. Aucune retouche de code de production attendue : un défaut trouvé
par une preuve est renvoyé à l'orchestrateur (lot propriétaire), pas corrigé ici.

## Subtasks

### T066 — Parcours complet (SC-001, SC-002, SC-004)

`payment-journey.spec.ts`, étapes numérotées comme `device-journey.spec.ts`, **tout par l'API** (HTTPS réel, terminal
de test, vraie base, festivalier par le faux) : `MERCHANT_ADMIN` crée deux vendeurs ; `ORGANIZER_ADMIN` crée le
catalogue (catégorie, articles) ; enrôlement d'une caisse `CATALOG_POS` et lecture de sa configuration (version du
catalogue) ; ouverture de session ; paiement par bracelet en un aller-retour, puis en deux temps (`tap_id`) ; QR
commerçant payé par le festivalier ; QR client encaissé ; annulation par le vendeur ; annulation hors fenêtre par un
`SUPERVISOR` (jeton sur place) ; 5 PIN faux → vendeur bloqué sur **tous** les terminaux, débloqué par un nouveau PIN
(SC-004) ; changement de prix pendant que la caisse a l'ancienne configuration (ancien prix accepté). Contrôles finaux
en lecture : 100 % des ventes attribuées au bon vendeur, Σ lignes = montant pour chaque vente au catalogue (SC-002),
aucune vente sans lignes ni ligne sans vente, aucun passage consommé par un paiement refusé (NFR-006).

### T067 — Isolation (NFR-007, SC-007)

`payment-isolation.spec.ts` sur le modèle de `device-isolation.spec.ts` : deux prestataires A et B, et deux
commerçants d'un même prestataire. Test de garde : **le contrat déclare les routes de la mission, et chacune a un cas
dans ce fichier** (liste lue dans `openapi.yaml`). Pour chaque route : B (personne, terminal ou festivalier) sur un
objet de A → jamais `2xx`, `404` sans fuite, rien ne change (comparaison avant/après) ; listes de B sans objet de A ;
commerçant 1 ne voit ni vendeurs, ni sessions, ni ventes du commerçant 2. Pour chaque **nouvelle table** (vendeurs,
essais, sessions, catalogue, versions, versions servies, `sale_line`, `sale_attribution`, `payment_request_detail`) :
sous `cashless_app` avec le prestataire B posé, 0 ligne de A lisible.

### T068 — Secrets (NFR-002, NFR-008, SC-003)

`payment-secrets.spec.ts` sur le modèle de `device-secrets.spec.ts` (A26) : PIN de test reconnaissables, aléatoires et
propres à la suite ; jetons QR commerçant et client émis par le parcours ; valeur de `VENDOR_PIN_SECRET` du test.
Recherche sous toutes leurs formes (texte, hexadécimal comme `bytea`) dans **toutes** les tables (dont
`api_idempotency`, `audit_log`, `device_seq_registry`), dans tout ce qui part au journal (`Logger`, `console`,
sorties) et dans toutes les réponses, y compris d'erreur : 0. Préfixe `$argon2id$` : présent seulement dans
`vendor.pin_hash`, jamais dans une réponse, un journal, l'audit ni la configuration servie. Contrôle du balayage : les
empreintes attendues sont bien en base (le test échoue s'il ne cherche rien).

### T069 — Latence (NFR-001, SC-006) et CI (NFR-010)

- `payment-latency.spec.ts` : 200 paiements par bracelet en un aller-retour, **en série**, serveur seul (temps mesuré
  autour du traitement, comme `device-latency.spec.ts`) : p95 ≤ 200 ms et p99 ≤ 500 ms ; sauté sous `SKIP_LATENCY`
  (`const latency = process.env.SKIP_LATENCY ? it.skip : it`) ; valeurs mesurées écrites sur la sortie.
- `.github/workflows/ledger-tests.yml` : étape « Latence du paiement, NFR-001 (suite seule, sans nouvel essai) »
  après la passe parallèle (`npm test -w @cashless/api -- --runInBand end-to-end/payment-latency`) ; vérifier que les
  suites pgTAP nouvelles (`tests_vendors.sql` … `tests_payment_rights.sql`) sont bien prises par `test:pgtap` et le
  contrôle des fichiers générés (`check:generated`) par la CI ; aucune étape existante retirée ni rendue facultative.
- `.github/CI.md` : tableau des passes à jour (nombre de suites et de tests, mesures de latence de la mission).

### T070 — Concurrence transverse (NFR-005)

`payment-concurrency.spec.ts` : 20 paiements simultanés avec la même lecture embarquée → 1 vente ; 20 avec le même
`tap_id` → 1 ; 20 paiements simultanés du même jeton QR commerçant → 1 ; 20 encaissements du même QR client → 1 ;
20 annulations simultanées d'une vente → 1 ; et croisés : paiement QR pendant l'annulation de la demande, annulation
de vente pendant la suspension du terminal. Chaque cas vérifie aussi l'absence d'écriture partielle (NFR-006) et
qu'aucun interblocage n'est remonté (ordre global des verrous). Lancé en série avec le reste ; aucune hypothèse
d'horloge entre Node et la base.

### T071 — Consignation (vérification)

Vérifier, et compléter seulement ce qui manque :
- `docs/POINTS_OUVERTS.md` : OP-N76 (risque, raison, mission 11, condition de levée, test de borne de WP07) ; OP-N43
  complété ; **OP-N74 levé** (date, migration `0035_enrollment_event_state.sql`, suite `tests_enrollment_event_state.sql`,
  nom des cas) ; tout écart de sécurité accepté dans un compte rendu de WP01 à WP13 a son entrée.
- `docs/DECISIONS_ADR.md` : ADR-121 présent et cohérent avec OP-N76 ; ADR-120 marqué levé par la 5b ; un ADR pour
  chaque nouvel écart accepté en cours de mission (sinon : constat bloquant).
- `PROMPTS-A-ENVOYER.md` et `PRD.md` : reports vers les missions 7, 10 et 11 présents (OP-N76/OP-N56, côté festivalier
  du QR, identification au guichet, PIN hors ligne) ; section « Mission 5b » à jour de ce qui a été livré.
- Liste des renforcements faits (R-05, R-06, R-07, R-09, secret hors base, et ceux des comptes rendus), chacun consigné.

### T072 — Liste des fichiers à faire relire par une personne

Dresser dans le compte rendu, avec la raison pour chacun : `packages/ledger-sql/migrations/0031_vendors.sql` (dont
`set_device_status` remplacée), `0033_payments.sql` (`assert_reversible`, appelant terminal d'`approval_token_use`),
`0034_payment_requests.sql`, `0035_enrollment_event_state.sql`, `packages/ledger-sql/post-roles.sql` (droits de la
base), `apps/api/src/vendor-pin/` (argon2id, secret), `apps/api/src/config/config.ts` (`VENDOR_PIN_SECRET`),
`apps/api/src/vendors/`, `apps/api/src/approval/onsite/` (variante de garde), `apps/api/src/payment-requests/qr-token.ts`,
plus ceux signalés par les comptes rendus. L'agent qui a écrit le code ne vaut pas relecture indépendante.

## Test Strategy

Ordre : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`,
`npm run test:pgtap -w @cashless/ledger-sql`, puis `npm run reset-db -w @cashless/ledger-sql && npm test -w
@cashless/api -- --runInBand` (avec `SKIP_LATENCY=1`), puis la suite de latence seule. Jamais pgTAP sur une base où
Jest vient de tourner (rejouer `reset-db`). Base partagée : passes par l'orchestrateur, en série ; latence et
concurrence jamais en parallèle d'autres suites. Dans un worktree de lane, créer d'abord les liens
`node_modules/@cashless/{api,contracts,ledger-sql,tag-format}`. Horloge de la base Docker qui peut reculer : aucun test
ne compare l'heure de Node à `now()` de la base sans marge.

## Definition of Done

- Cinq suites vertes ; latence sous les seuils en local (valeurs notées) ; CI à jour ; NFR-010 : suites de la base,
  missions 1 à 5a et scénario de référence verts.
- Consignation vérifiée, OP-N74 levé, aucun écart de sécurité sans entrée.
- Chaque sous-tâche marquée : `spec-kitty agent tasks mark-status Txxx --status done --mission
  terminaux-paiement-en-ligne-01M52QB9`.
- Compte rendu du lot en fin de ce fichier : écarts au plan (sens), retouches hors carte, points soumis au porteur,
  liste T072, **critères couverts avec leur preuve** (SC-001 à SC-008, NFR-001, NFR-002, NFR-005 à NFR-008, NFR-010 :
  fichier et nom du cas) pour `acceptance-matrix.json`.

## Risks

- Mesure de latence faussée par une autre suite en parallèle, ou seuil relâché pour passer (interdit sans porteur).
- Balayage des secrets qui ne cherche rien (contrôle du balayage obligatoire).
- Matrice d'isolation figée sur une liste écrite à la main : une route ajoutée plus tard échapperait au test.
- Consignation reconstituée à la fin au lieu d'être vérifiée : écart oublié, ou entrée inventée sans décision.

## Reviewer Guidance

Vérifier : parcours sans écriture directe en base après l'amorçage ; isolation lue depuis le contrat, chaque route et
chaque nouvelle table couvertes ; secrets cherchés sous toutes leurs formes, dans `api_idempotency` et `audit_log`,
`$argon2id$` confiné à `vendor.pin_hash` ; latence en série, seuils exacts (200/500 ms, 200 paiements) ; 20 envois
simultanés → 1 dans chaque cas, sans écriture partielle ; CI : rien retiré, latence lancée seule ; OP-N74 levé avec ses
tests ; OP-N76/ADR-121 cohérents ; chaque écart des comptes rendus consigné ; liste T072 complète.

## Reports de l'orchestrateur (23/10/2026)
- Relecture WP08 cycle 1 (constat 4) : `argon2-supply-chain.spec.ts` doit échouer si une entrée nouvelle apparaît dans
  l'arbre d'argon2 : comparer l'ensemble des transitives résolues à `EXPECTED_NEW_LOCK_ENTRIES` (qui inclut
  `@epic-web/invariant@1.0.0`, acceptée par le porteur le 23/10, R-01).
- Consignation à vérifier : ADR-124 (clé relâchée sur `DEBIT_AUTHORITY_*`, SPECIFICATION §10.2 mise à jour), ADR-125 /
  OP-N77 (secrets exigés par tous les processus, mission 13).

## Reports de l'orchestrateur (26/10/2026, relecture WP09 cycle 3 : approuvé)
- Dimensionnement du pool de `SessionLock` : le verrou d'essai de PIN tient une connexion du pool dédié pendant toute la
  requête (argon2 compris) ; au-delà de `poolSize` terminaux simultanés, `pool.connect` attend 10 s puis rend `500`.
  Mesurer en charge, ajuster la taille ou rendre `429` au lieu d'attendre ; test ou consignation.
- `VENDOR_PIN_IDEMPOTENCY_SECRET` (ADR-126) : l'exiger dans les manifestes de déploiement et la documentation
  d'exploitation ; rotation = invalidation des empreintes d'idempotence des routes à PIN seulement.
- Lignes de commentaires de plus de 100 caractères laissées par WP09 (hasher, request-lock, pin-attempt-lock,
  session-lock, config, env.sh) : à reformater au passage de la fusion (décision du 14/10).
- Toujours ouverts : alignement de `contracts/vendors.md` (`422`, `409` au renvoi, liste sans les vendeurs bloqués,
  renvoi qui refait l'essai seulement pour le `429`) ; propriétaire des fonctions de purge sous RLS forcée.

## Reports de l'orchestrateur (26/10/2026, implémentation WP11)
- Décision du porteur : corriger dans ce lot le défaut antérieur de `apps/api/src/configuration/sql-config-resolver.ts`
  (l.86 et l.215) : `resolve` lance des requêtes en parallèle sur le même client `pg` de la transaction
  (`DeprecationWarning: Calling client.query() when the client is already executing a query`, retiré dans pg@9 ;
  chaque vente le déclenche). Rendre les requêtes séquentielles ; test qui échoue si l'avertissement revient
  (écoute de `process.on('warning')` pendant une vente).
- ADR-128 : l'extension `authority_epoch` de `STALE_AUTHORITY_EPOCH` est au contrat ; le compte d'opérations de
  `media-isolation.spec.ts` inclut `createPayment` et `getPayment` (`x-process: public`).
- Relecture WP11 cycle 1 : test d'ordre des verrous terminal → session → QR → bracelet → portefeuille en charge ;
  sonde de la mission 7 (numéro posé hors idempotence puis paiement falsifié : anomalie consignée).
- Relecture WP11 cycle 2 : si WP12/WP13 ne l'ont pas fait, tester dans `payments.service.ts` le chemin « erreur du
  registre sur un refus qui n'est pas une lecture » et l'échec de `settleRefusal` sans erreur du registre ; resserrer
  le cas `createPayment` de `media-isolation.spec.ts` à `refused: [404]`.

## Reports de l'orchestrateur (26/10/2026, fusion de WP12 et WP13)
- `idempotency.interceptor.ts` : WP12 (lane-l) et WP13 (lane-m) l'ont modifié chacun pour les routes « terminal ou
  personne ». Retenir l'option explicite de WP13, `deviceSeq: 'when-device'` (la plus stricte) : `deviceSeq: true`
  reste exclusivement terminal (paiement par bracelet), `reversePayment` passe à `'when-device'` ; retirer la branche
  générale de WP12. Test : une route `deviceSeq: true` appelée sans terminal est refusée par sa garde.
- `x-process: public` sur `reversePayment` (convention de WP11 et WP13, retiré au WP12 seulement pour le compte du
  balayage) : le remettre, ajouter son cas à `media-isolation.spec.ts` et additionner les comptes (41 + 5 + 1 = 47).
- Fichier de cas `payments.qr.cases.ts` (WP13) exécuté après `payments.cases.ts` (ouverture de session).

## Reports de l'orchestrateur (26/10/2026, relecture WP13 cycle 1 : approuvé)
- Mineur 1 : les 5 cas des demandes de paiement QR dans `media-isolation.spec.ts` amorcent la demande de A avec un
  jeton inconnu ; le refus se produirait sans isolation. Amorcer avec un jeton **connu et valide** de A et l'envoyer
  depuis un festivalier (et un terminal) de B : `404` en GET et en annulation, `409` en paiement, A inchangée.
  Mutation à tuer : filtre de prestataire retiré du service.
- Mineur 2 : la garde `written.replayed` de `pay` (`payment-request.service.ts`) survit à la mutation `if (false)` ;
  ajouter le test du rejeu de la même clé d'idempotence sur `payPaymentRequest` (une seule vente, réponse rejouée).
