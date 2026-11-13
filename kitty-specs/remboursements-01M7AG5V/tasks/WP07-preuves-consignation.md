---
work_package_id: WP07
title: Preuves, mesures et consignation
dependencies: [WP05, WP06]
requirement_refs:
- NFR-001
- NFR-002
- NFR-003
- NFR-004
- NFR-005
- SC-001
- SC-002
- SC-003
- SC-004
- SC-005
planning_base_branch: feat/remboursements
merge_target_branch: feat/remboursements
branch_strategy: Planning artifacts for this mission were generated on feat/remboursements. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/remboursements unless the human explicitly redirects the landing branch.
subtasks: [T036, T037, T038, T039, T040, T041]
phase: Phase 4 - Preuves
agent: claude
history:
- timestamp: '2026-11-13T15:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/test/integration/refunds/
create_intent: [apps/api/test/integration/refunds/journey.spec.ts, apps/api/test/integration/refunds/concurrency.spec.ts, apps/api/test/integration/refunds/refund-latency.spec.ts]
execution_mode: code_change
model: sonnet
owned_files: [apps/api/test/integration/refunds/journey*.spec.ts, apps/api/test/integration/refunds/concurrency*.spec.ts, apps/api/test/integration/refunds/refund-latency.spec.ts, docs/POINTS_OUVERTS.md, docs/DECISIONS_ADR.md, PROMPTS-A-ENVOYER.md, PRD.md, tools/export/files/REPONSE-ENDPOINTS-FESTIVALIER.md]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP07 : Preuves, mesures et consignation

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer /
Agent : claude). Lis `docs/passation-9a/fiche-implementation.md` (démarrage, base `cashless_wp07`, Jest, fin de lot),
ce prompt, puis seulement :

- `docs/passation-9a/contexte-9a.md` (les dix décisions) et `docs/passation-9a/suivi-lots.md` (notes, écarts et
  fichiers à relire laissés par WP01 à WP06 : c'est ta source pour la matrice et pour les renforcements à consigner) ;
- `spec.md` : FR-001 à FR-020, NFR-001 à NFR-005, SC-001 à SC-005 ; `plan.md` « Charter Check » et IC-08 ;
- `research.md` R-03, R-05, R-06, R-09 ; `contracts/served-operations.md` ;
- consignation : `docs/POINTS_OUVERTS.md` l. 32, 36, 102 (tableau), 277-284 (OP-N51), 321-330 (OP-N55 / ADR-100),
  1580-1595
  (OP-N123) ; `docs/DECISIONS_ADR.md` l. 100-112 (index), 1049-1062 (ADR-91), 1196 (ADR-100), 2709 (ADR-188, dernière) ;
  `PROMPTS-A-ENVOYER.md` l. 36-42 et 369-402 ; `PRD.md` l. 290-300 et 366-376 ;
  `tools/export/files/REPONSE-ENDPOINTS-FESTIVALIER.md` l. 10-18, 63-100 et 128-139 ;
- modèle de matrice : `kitty-specs/passerelle-locale-01M6NM1S/acceptance-matrix.json` (champs, `negative_invariants`) ;
- modèle de mesure : `apps/api/test/integration/topups/cash-topup.spec.ts` l. 290-300 (`SKIP_LATENCY`),
  `end-to-end/topup-latency.spec.ts` l. 1-12 ; fixtures `test/support/*`, `reversals/reversal-fixtures.ts`.

Priorité des sources (SPECIFICATION §0.3). Contradiction : tu la signales. `interfaces.md` fait foi sur ce prompt.

## Objective

Prouver la mission de bout en bout (SC-001 à SC-005, NFR-001 à NFR-005), consigner ce qui doit l'être selon les
règles du
porteur (`CLAUDE.md` : dette nommée, écarts de sécurité, report dans les documents de pilotage) et rendre la matrice
d'acceptation complète. Aucun code de production dans ce lot : si une preuve échoue, tu ne corriges pas le lot fautif,
tu le signales (numéro de lot, test, trace) dans ton compte rendu.

## Branch Strategy

- Branche de planification et de fusion : `feat/remboursements`.
- Worktree alloué par lane, calculé dans `lanes.json`.
- Commande : `LC_ALL=C LANG=C spec-kitty agent action implement WP07 --agent claude --mission remboursements-01M7AG5V`.

## Périmètre et arbitrages

- Seuls tes `owned_files` bougent. Les tests lisent les fixtures de `test/support/` sans les modifier ; une fixture
  manquante se code dans ton propre fichier de test.
- Dates des consignations : 13/11/2026 pour les décisions du porteur ; date réelle du jour pour une levée.
- Aucune route, aucun champ ni code d'erreur ajouté (C-002). `SPECIFICATION.md` n'est pas à toi : propose dans ton
  compte
  rendu l'amendement de §12.1 (matrice) lié à ADR-189, sans l'écrire.

## Subtasks

### T036 : parcours de bout en bout (`journey.spec.ts`)

Un fichier, un `describe` par critère, sur l'API montée comme `test/support/app.ts`, base `cashless_wp07`.

- SC-001 : festivalier connecté par code (`/customer-auth/*`), `GET /me/wallets` (`refund.eligible` vrai), création,
  liste,
  décision du titulaire : aucune des trois routes ne répond `404`.
- SC-002 : (a) parcours payé : demande, `approveRefundRequest` par A, approbation par B, `PROCESSING`, `PAID` : le
  festivalier
  perd exactement son solde payé, le compte `A-PSP-WAVE` reçoit solde moins frais, `ORG_FFEST`/`ORG_TAX` les frais ;
  (b) parcours
  échoué : `FAILED` rend TOUT le solde payé, nouvelle demande possible ; (c) refusé (`REJECTED`) et bloqué
  (`BLOCKED`) : aucune
  écriture.
- SC-003 : 20 tentatives d'approbation par l'auteur (et, pour une demande créée par une personne, par ce demandeur) : 20
  refus, 0 `WALLET_REFUND`.
- SC-004 : un bracelet avec caution, crédits offerts, solde payé et espèces dues restitué par un appel ; ordre des
  écritures
  de §7.9 vérifié sur `journal_transaction` (détail déjà couvert par `release-chaining.spec.ts` de WP06 : ici, bout
  en bout depuis
  l'activation, recharge, achat).
- SC-005 : autre numéro avec titulaire vérifié : `AWAITING_HOLDER`, `approveRefundRequest` refusé (`409`) tant que ni
  `CONFIRM` ni `hold_until` ; `BLOCK` : jamais approuvable ; échéance : approuvable.
- Négatif d'ADR-189 : un `REVERSAL` d'un `PURCHASE` en événement `SETTLING`/`RECONCILING` reste refusé par le moteur
  ET par
  la base ; un `REVERSAL` de source autre que `BACKOFFICE` d'un `WALLET_REFUND` aussi ; celui d'un `WALLET_REFUND` de
  source
  `BACKOFFICE` passe en `RECONCILING`. Ce test doit échouer si la garde s'élargit à un autre `REVERSAL`.

### T037 : concurrence (`concurrency.spec.ts`)

Pool de connexions et mémoire du poste : lots de requêtes bornés par la taille du pool, `--runInBand`.

- NFR-001 : 100 exécutions concurrentes de la même approbation, puis 100 rejeux d'une même clé `bo:` : exactement une
  ligne
  `journal_transaction` `WALLET_REFUND` pour la demande, une seule réponse de succès (les autres : rejeu identique ou
  `409`), jamais `500`. Idem 100 `confirm FAILED` : un seul `REVERSAL`.
- NFR-002 : 50 créations simultanées sur le même portefeuille : 1 ligne ouverte, 1 `201`, 49
  `409 REFUND_ALREADY_OPEN` (ou
  rejeux identiques s'ils partagent une clé) ; requête SQL finale `count(*) FILTER (WHERE status IN (...)) <= 1` par
  portefeuille.
- NFR-003 : après chaque parcours (payé, échoué, refusé, bloqué, guichet) : somme des lignes de chaque transaction
  égale à
  zéro, solde payé = solde initial − remboursements payés, comptes `L-*` inchangés par `PAID`. Écris l'assertion une
  fois
  (fonction d'invariant) et appelle-la depuis `journey` et `concurrency`.

### T038 : mesures et preuve NFR-005 (`refund-latency.spec.ts`)

- NFR-004 : suite ISOLÉE, ignorée sous `SKIP_LATENCY` (`const latency = process.env.SKIP_LATENCY ? it.skip : it`). 20
  requêtes
  simultanées de création (portefeuilles DISTINCTS, sinon on mesure des `409`) et de lecture (`GET /me/refund-requests`,
  `GET /refund-requests`) : le 95e centile reste sous 500 ms ; mesure et affiche min/médiane/p95/max. Lance-la SEULE
  (`npx jest test/integration/refunds/refund-latency.spec.ts --runInBand --forceExit`, sans `SKIP_LATENCY`, aucune
  autre suite) ;
  la VM Docker ralentit : relance une fois si seul le p95 échoue, et note les chiffres dans le compte rendu.
- NFR-005 : demande `AWAITING_HOLDER` dont `hold_until` est fixé par le propriétaire de la base à
  `clock_timestamp() - 4 min`
  (jamais l'horloge de Node : décalage Docker) ; une itération de la tâche de maintenance de WP03 la passe
  `REQUESTED` ; l'écart
  `now - hold_until` calculé en SQL reste sous 5 min ; test statique : l'intervalle déclaré de la tâche est au plus
  60 s. Une
  demande non échue n'est pas promue ; la décision du titulaire après l'échéance est refusée (`409`).

### T039 : consignation (écarts de sécurité et dette, règle du porteur du 13/10/2026)

Dans `docs/DECISIONS_ADR.md` (index l. 100-112 mis à jour, entrée en fin de fichier au format des ADR voisins) :

- **ADR-189** (Acceptée, 13/11/2026, décision du porteur n° 5) : contradiction SPEC §11.4 / §12.1 ; décision : la
  garde de
  statut de `post_transaction` et `status-matrix.ts` acceptent le `REVERSAL` d'un `WALLET_REFUND` de source
  `BACKOFFICE` partout
  où `WALLET_REFUND` l'est, rien d'autre ; risque (crédit au festivalier, jamais un débit ; index
  `journal_transaction_reverses_once`) ; raison ; mission qui le lève et condition (amendement de §12.1 ; à défaut,
  la décision reste) ;
  tests qui échouent si la limite s'élargit : `tests_refund_reversal_guard.sql` (WP02, cas négatifs) et le négatif de
  `journey.spec.ts` (T036). Section « Renforcements » (se font puis se consignent) : défi du titulaire lié à la demande
  (`purpose`, `subject_id`, un code vivant par numéro ET usage), code du nouveau numéro vérifié contre la destination et
  consommé, seuil de `cash_refund_single_max` appliqué au solde payé du guichet, remboursement refusé hors
  `ACTIVE`/`BLACKLISTED`
  (décision 6). Cite les fichiers à relire par une personne (`suivi-lots.md`).
- ADR-91 et ADR-100 : ajoute une ligne « Mise à jour du 13/11/2026 : levée par la mission 9a » avec la preuve
  (`release-chaining.spec.ts`, `tests_replace_cash_due.sql`) ; index : statut « Acceptée (levée par la 9a) ».
- Écarts de sécurité éventuels trouvés par les lots (`suivi-lots.md`, colonne « affaiblit ») : un ADR et une entrée de
  `POINTS_OUVERTS.md` chacun ; si un lot a codé un affaiblissement non soumis au porteur, c'est un constat BLOQUANT :
  ne le
  consigne pas comme accepté, signale-le.

Dans `docs/POINTS_OUVERTS.md` : OP-N51 et OP-N55 passent à **levé** le jour réel, par la mission 9a, avec les preuves
(modèle
des lignes OP-N49 et OP-N54, tableau l. 30-36), et leurs sections l. 277-284 et 321-330 reçoivent un paragraphe de
levée.
OP-N123 est CONFIRMÉ ouvert (mission 9b, test de levée inchangé) : vérifie que son texte est exact et ajoute ce que
la 9a
sert vraiment (`BANK_TRANSFER` : `422 REFUND_NOT_ALLOWED` à la création).

`PROMPTS-A-ENVOYER.md` : coche les lignes de la 9a faites (specify, plan, tasks, implémentation selon
`suivi-lots.md`, jamais
accept ni merge), mets à jour la colonne « Peut démarrer » de la table l. 36-42, confirme que la 9b hérite d'OP-N123
(l. 402) et
des réclamations tardives de `WALLET_REFUND` (R-03 « hors périmètre »). `PRD.md` : enrichis la section de la mission
9a (l. 296 et
l. 366-372) avec le périmètre réel (paiement manuel, autre numéro et décision du titulaire, circuit à deux, guichet
enchaîné,
espèces dues d'un bracelet remplacé, OP levés) : le PRD reste la source de vérité du besoin.

### T040 : note pour l'app festivalier

`tools/export/files/REPONSE-ENDPOINTS-FESTIVALIER.md` : § 4 devient « routes servies » (création, liste, décision du
titulaire) ;
mets à jour la ligne « En bref » de P4 (l. 14-16) et l'exemple de `GET /me/wallets` (`refund.eligible`, date limite
effective).
Écris ce que l'équipe doit savoir, vérifié dans le code : `Idempotency-Key` obligatoire ; `BANK_TRANSFER` : `422
REFUND_NOT_ALLOWED` ; autre numéro : `new_number_otp` obtenu par `POST
/customer-auth/otp` pour CE numéro ; `AWAITING_HOLDER` et `hold_until` ;
`409 REFUND_ALREADY_OPEN`, `422 REFUND_WINDOW_CLOSED`, `422 REFUND_NOT_ALLOWED` ; `422 REFUND_NOT_ALLOWED` pour un
portefeuille inconnu ou d'autrui
; statuts et
transitions ; paiement manuel (le statut `PAID` arrive après un paiement hors système). Aucun `X-Test-Otp-Code` n'est
rendu sur la création (arbitrage de l'orchestrateur) : vérifie-le dans le code et n'écris que ce qui est vrai. Aucun
secret, aucune adresse privée.

### T041 : matrice d'acceptation et suites `SKIP_LATENCY`

> **Arbitrage de l'orchestrateur** : un lot ne peut pas posséder de fichier sous `kitty-specs/`. Tu ne crées PAS
> `acceptance-matrix.json` : tu écris son contenu (même forme, décrite ci-dessous) dans ton compte rendu et dans
> `docs/passation-9a/suivi-lots.md` (section « Matrice proposée ») ; l'orchestrateur l'enregistre dans la mission.


`acceptance-matrix.json`, même forme que celle de `passerelle-locale-01M6NM1S` : `mission_slug`, `overall_verdict`,
`criteria`
(`criterion_id`, `description`, `proof_type: automated_test`, `evidence`, `pass_fail`, `verified_by`, `verified_at`,
`notes`),
`negative_invariants`. UN critère par FR-001 à FR-020, NFR-001 à NFR-005, SC-001 à SC-005 (30), chacun avec sa preuve
(fichier
de test et nom du cas, ou pgTAP et numéro d'assertion) tirée des lignes « critère, commande, résultat » que les lots
notent dans `suivi-lots.md` et des tests présents : ne cite
jamais un test que
tu n'as pas trouvé. Invariants négatifs proposés : aucun double remboursement (NFR-001), aucun autre `REVERSAL` admis
(ADR-189),
aucune fuite entre prestataires, aucun faux en production (envoyeur de code, OP-N120). Un critère sans preuve :
`pass_fail: "fail"`
et signalé, jamais `pass` par défaut. La matrice devait être tenue au fil des lots : si `suivi-lots.md` est
incomplet, reconstitue
et signale ce qui manquait. Puis lance les suites d'intégration `SKIP_LATENCY` de la mission et la suite de latence
seule.

## Tests et preuves

```bash
cd <lane>/apps/api
export PGDATABASE=cashless_wp07; source ../../tools/dev-db/env.sh; env | grep DATABASE_URL
SKIP_LATENCY=1 npx jest test/integration/refunds test/integration/media/release-chaining \
  test/integration/customer-app/me-refund test/integration/debit-authority --runInBand --forceExit
npx jest test/integration/refunds/refund-latency.spec.ts --runInBand --forceExit   # seule, sans SKIP_LATENCY
cd ../../packages/ledger-sql && PGDATABASE=cashless_wp07 bash scripts/reset-db.sh
export PATH=<R>/docs/passation-9a/scripts/bin:/Library/PostgreSQL/18/bin:$PATH
pg_prove -d cashless_wp07 tests/tests_refund_requests.sql tests/tests_refund_reversal_guard.sql \
  tests/tests_replace_cash_due.sql
M=../../kitty-specs/remboursements-01M7AG5V/acceptance-matrix.json
python3 -c "import json,sys;print(len(json.load(open(sys.argv[1]))['criteria']))" $M
```

Relance `reset-db` après chaque Jest. Un échec dû à un lot précédent : signale-le avec le lot, sans le contourner.

## Definition of Done

- [ ] `journey`, `concurrency` et `refund-latency` verts ; NFR-004 mesurée seule, chiffres au compte rendu.
- [ ] ADR-189 écrite (contradiction, décision 5, risque, tests qui échouent si la garde s'élargit, renforcements) ;
      ADR-91 et
      ADR-100 annotées ; index des ADR à jour.
- [ ] OP-N51 et OP-N55 levés (preuves citées) ; OP-N123 confirmé ouvert pour la 9b ; aucun écart de sécurité non
      consigné.
- [ ] `PROMPTS-A-ENVOYER.md` et `PRD.md` à jour ; note pour l'app festivalier à jour et exacte.
- [ ] `acceptance-matrix.json` : 30 critères, chacun avec une preuve existante ; JSON valide.
- [ ] Aucun code de production modifié ; compte rendu : preuves lancées avec résultats, amendement proposé de §12.1,
      lots fautifs.

## Ce que le relecteur doit casser

1. Retirer la garde `EDGE` ou la condition de source de la contre-passation (en local, sur une copie) : le négatif
   d'ADR-189
   et le cas `EDGE` doivent échouer ; un test qui reste vert prouve un test creux.
2. Lancer `concurrency` avec 100 exécutions et vérifier dans la base : une seule ligne `WALLET_REFUND`, une seule
   demande
   `PROCESSING`, solde payé à 0 et non négatif.
3. Matrice : citer au hasard dix preuves et les relancer ; un cas introuvable, un FR sans preuve, un `pass` sans
   commande.
4. `refund-latency` : vérifie qu'elle mesure bien des créations distinctes et qu'elle est ignorée avec `SKIP_LATENCY=1`.
5. NFR-005 : le test lit-il l'horloge de la base ? Remplace l'intervalle de la maintenance par 10 min : il doit échouer.
6. Documents : OP-N51/N55 levés sans test cité, ADR-189 sans test négatif, report manquant dans `PRD.md` ou
   `PROMPTS-A-ENVOYER.md` : constats bloquants (règle 4 de `CLAUDE.md`).
7. Note pour l'app : chaque affirmation (codes, champs, `X-Test-Otp-Code`) se vérifie dans le code ou le contrat.
8. Aucun fichier hors `owned_files` modifié (`git diff --stat`), aucun `.sql` généré touché.

## Fichiers à faire relire par une personne

- `docs/DECISIONS_ADR.md` ADR-189 et `docs/POINTS_OUVERTS.md` (levées) : engagements du porteur sur la sécurité ;
- la liste des fichiers sensibles de WP01, WP02, WP03, WP05 et WP06, reprise de `suivi-lots.md` dans ton compte rendu.
