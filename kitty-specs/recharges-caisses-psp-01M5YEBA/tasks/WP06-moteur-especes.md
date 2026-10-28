---
work_package_id: WP06
title: Moteur - découpage hors ligne et fermeture à théorique nul
dependencies: [WP02]
requirement_refs: [FR-005, FR-006]
planning_base_branch: feat/recharges-caisses-psp
merge_target_branch: feat/recharges-caisses-psp
branch_strategy: Planning artifacts for this mission were generated on feat/recharges-caisses-psp. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/recharges-caisses-psp unless the human explicitly redirects the landing branch.
base_branch: kitty/mission-recharges-caisses-psp-01M5YEBA
base_commit: 87bcc1bacb73d14ecea6c48bf7a4edc6f6cb16db
created_at: '2026-10-27T14:57:32.713571+00:00'
subtasks: [T027, T028, T029, T030]
phase: Phase 2 - Socle applicatif
agent: claude
history:
- timestamp: '2026-10-27T15:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/ledger/
create_intent: [apps/api/test/integration/engine/topup-cash-split.spec.ts]
execution_mode: code_change
model: sonnet
owned_files: [apps/api/src/ledger/ledger-engine.service.ts, apps/api/src/ledger/builders/closing/cash.ts, apps/api/test/integration/engine/topup-cash-split.spec.ts, apps/api/test/unit/builders/closing/closing-builders.spec.ts]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP06 – Moteur : découpage hors ligne et fermeture à théorique nul

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche de contexte d'implémentation fournie par
l'orchestrateur, ce prompt, puis seulement, dans `kitty-specs/recharges-caisses-psp-01M5YEBA/` :
`spec.md` (FR-005, FR-006, FR-003), `research.md` R-03, R-05 et **R-20** (section « Caisses »),
`research-adversarial.md` (A1, A17), `contracts/cash.md` (règles 7, 8 et table des écritures),
`plan.md` IC-03, `data-model.md` (`cash_session`, extension `anomaly`). Code de référence :
`apps/api/src/ledger/ledger-engine.service.ts` (`writeLines`, `enrich`, `commandFingerprint`),
`apps/api/src/ledger/builders/festival/topup.ts` (`buildTopupCash`), `builders/closing/cash.ts`
(`buildCashClose`), `apps/api/src/ledger/db/ledger-queries.ts` (`readTopupHeadroom`,
`postTransaction`), `apps/api/src/ledger/types.ts` (`SOURCES`, `AccountRef`, `cashDue`), le schéma
de référence (`wallet_topup_headroom`, `check_wallet_limits`, table `anomaly` et son `CHECK` pour
`CASH_TOPUP_OVER_LIMIT`, lecture seule), et la fonction `open_cash_due_anomaly` de
`packages/ledger-sql/migrations/0036_cash_sessions.sql` (WP02, **déjà fusionnée** : sa signature
réelle fait foi). Tests modèles : `test/integration/engine/engine.spec.ts` et `mini-fixture.ts`,
`test/unit/builders/closing/closing-builders.spec.ts`. En cas de contradiction entre sources,
applique la priorité de SPECIFICATION §0.3 (tests exécutables > schéma SQL, `openapi.yaml`,
`sync_protocol.md` > SPECIFICATION > PRD) et **signale-la**. Ne modifie jamais un `.sql` généré de
`packages/ledger-sql/`.

## Objective

Corriger deux défauts du moteur d'écritures. (1) Le découpage d'une recharge en espèces vers
`L-ESP-A-RENDRE` ne doit s'appliquer qu'aux sources `OFFLINE_SYNC` et `EDGE_SYNC` ; en ligne, la
base refuse au-delà du plafond (`CL008`, `CL009`). Le découpage ouvre, dans la même transaction,
l'anomalie `CASH_TOPUP_OVER_LIMIT` qui manquait. (2) Le constructeur de fermeture de caisse accepte
un théorique nul (surplus seul).

## Context

- IC-03 (plan). FR-005 (refus en ligne), FR-006 (découpage hors ligne et anomalie), FR-003
  (fermeture et écart).
- Défaut existant (R-05) : `enrich` lit la marge `wallet_topup_headroom` pour **toute** source de
  `TOPUP_CASH` et le constructeur découpe sans ouvrir d'anomalie : l'excédent devient des espèces
  dues que `refund_cash_due` ne peut pas rendre, car elle ne rend que les anomalies
  `CASH_TOPUP_OVER_LIMIT` ouvertes du bracelet. Aucune autre source de `TOPUP_CASH` n'existe à ce
  jour dans l'API ; la mission 7 (synchronisation hors ligne) et la mission 8 (passerelle) seront
  les premières à poser `OFFLINE_SYNC`/`EDGE_SYNC`.
- **A1/A17** : les suites de référence générées posent `A-CAISSE-C1` sans session ; WP02 limite la
  garde de caisse aux comptes inscrits dans `cash_desk`. Ce lot ne touche pas à la garde. La garde
  vaut pour toutes les sources : le découpage hors ligne sur une caisse inscrite sans session `OPEN`
  est donc refusé par la base dans cette mission (la mission 7 définira la session d'une recharge
  hors ligne, report A17) ; les tests de ce lot utilisent une caisse **non inscrite** (comme le
  mini-fixture) pour le découpage hors ligne. Mentionne-le dans le compte rendu.
- Ce qui dépend de ce lot : WP08 (fermeture : `CASH_CLOSE` à théorique nul ou compté nul), WP09
  (recharge espèces en ligne), les missions 7 et 8 (découpage hors ligne).

**Règle de sécurité du projet (`CLAUDE.md`)** : si un point de ce lot ne peut être tenu qu'en
affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux
gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder**, avec le
risque et les options ; continue le reste. Un renforcement se fait, puis se consigne dans le compte
rendu.

## Arbitrages de l'orchestrateur (27/10/2026)

- Le découpage (lecture de `wallet_topup_headroom` et lignes vers `L-ESP-A-RENDRE`) n'a lieu que
  pour les sources `OFFLINE_SYNC` et `EDGE_SYNC`. Pour toute autre source (`ONLINE`, `PSP_WEBHOOK`,
  `BATCH`, `BACKOFFICE`), `enrich` ne lit pas la marge **et retire** une éventuelle clé `headroom`
  de la charge : un appelant ne peut pas provoquer un découpage en ligne en la fournissant. Le
  constructeur reçoit alors `headroom` absent et crédite le montant entier ; la base refuse au-delà
  du plafond (`CL008`, `CL009`), rien n'est écrit.
- L'empreinte de la commande (`commandFingerprint`) continue d'être calculée sur la commande
  **d'origine** (avant `enrich`), comme aujourd'hui : un rejeu de la même clé reste un rejeu, et une
  clé réutilisée avec un autre contenu reste `IDEMPOTENCY_KEY_REUSED`.
- L'anomalie `CASH_TOPUP_OVER_LIMIT` est ouverte par `open_cash_due_anomaly` (fonction de la base,
  WP02) **dans la même transaction** que `post_transaction`, après lui (l'anomalie porte
  l'identifiant de la transaction). Si cet appel échoue, toute la transaction est annulée : jamais
  de découpage sans anomalie. Un rejeu (clé déjà écrite) rend l'existant sans rouvrir d'anomalie.
- Le montant de l'anomalie est lu **dans les lignes construites** : la somme des lignes dont le
  compte est `CUSTOMER_CASH_DUE` (en valeur absolue). Ne recalcule pas la marge une seconde fois
  dans le moteur : une seule source de vérité, le constructeur.
- Un découpage sans support (`mediaId` absent de la commande) est refusé **avant** toute écriture :
  `BuildError('VALIDATION_FAILED', …)` → 422. La table `anomaly` exige `media_id` pour ce type
  d'anomalie (`CHECK`).
- `buildCashClose` : `expected` nul accepté (surplus seul), `expected` négatif refusé, `counted`
  négatif refusé. Compté et théorique **tous deux nuls** : le constructeur refuse (`BuildError`, «
  fermeture sans écriture ») ; la session est alors fermée par WP08 sans appeler le moteur (R-03).
- Aucune nouvelle dépendance npm (R-18). Aucun fichier SQL touché.

## Branch Strategy

Planification et fusion sur `feat/recharges-caisses-psp`. Dépendance : WP02 (migration 0036
fusionnée dans ta lane). Worktree attribué par lane (`lanes.json`). Commande : `spec-kitty agent
action implement WP06 --agent claude --mission recharges-caisses-psp-01M5YEBA`. Base de validation :
`cashless_wp06` (`PGDATABASE=cashless_wp06 bash packages/ledger-sql/scripts/reset-db.sh`, puis
`DATABASE_URL_*` vers elle). `cashless_test` est réservée à l'orchestrateur. Worktree sans
`node_modules` : fais les liens de `node_modules/@cashless/*` (voir mémoire du poste).

## Subtasks

### T027 — Découpage `TOPUP_CASH` limité à `OFFLINE_SYNC`/`EDGE_SYNC` (`enrich`)

But : en ligne, la marge n'est pas lue ; le montant entier est présenté à la base, qui refuse
au-delà du plafond.

1. Dans `apps/api/src/ledger/ledger-engine.service.ts`, fonction `enrich`, cas `'TOPUP_CASH'` (ligne
   ~446) : remplace la condition d'entrée par une garde sur `command.source`. Ajoute une constante
   en tête de fichier, documentée : `const OFFLINE_SPLIT_SOURCES: readonly Source[] =
   ['OFFLINE_SYNC', 'EDGE_SYNC']` (importe `Source` de `./types`). Corps attendu :
   - source hors de la liste : retourne la commande **sans** `headroom` (si `payload.headroom !==
     undefined`, reconstruis la charge sans cette clé : `const { headroom: _ignored, ...rest } =
     payload`) ; aucune requête ;
   - source dans la liste : comportement actuel (lecture de `readTopupHeadroom` si `walletId`
     présent et `headroom` non fourni).
2. Garde le commentaire d'intention (SPECIFICATION §5.3, §5.7, ADR-63 ; R-05) : « en ligne, la base
   refuse ».
3. Vérifie que `plan(...)` (registre des constructeurs) reçoit bien la commande enrichie ; ne change
   pas le constructeur `buildTopupCash` (non possédé) : `headroom` absent ⇒ `margin = amount`.
4. Vérifie l'interaction avec la verrouillage : `wallet_topup_headroom` verrouille le solde du
   portefeuille « jusqu'à la fin de la transaction » (commentaire du schéma, DB-I10). En ligne, ce
   verrou n'est plus pris ici : le contrôle `check_wallet_limits` de `post_transaction` fait foi (il
   lit le solde sous le verrou de l'écriture).
5. Cas limites : `payload.walletId` absent (le constructeur refuse déjà) ; `headroom` négatif fourni
   hors ligne (le constructeur le ramène à 0 : inchangé) ; `headroom` fourni hors ligne par
   l'appelant (gardé tel quel : c'est le chemin des tests qui connaissent la marge).

Fichiers : `apps/api/src/ledger/ledger-engine.service.ts`.

Validation :
- [ ] `npx tsc --noEmit -p apps/api` sans erreur ; lint du fichier propre.
- [ ] `ONLINE` + montant au-delà du plafond : la base lève `CL008` (ou `CL009`), aucune ligne
      écrite.
- [ ] `ONLINE` + `payload.headroom` fourni : ignoré (test T030).

### T028 — Anomalie `CASH_TOPUP_OVER_LIMIT` dans la transaction du découpage

But : tout découpage hors ligne ouvre l'anomalie qui permet de rendre l'excédent.

1. Lis `open_cash_due_anomaly` dans `0036_cash_sessions.sql` : signature, paramètres (grand livre,
   support, montant, transaction, éventuellement `p_operator`), retour, `SECURITY DEFINER`, codes
   d'erreur. Écris l'appel exactement ainsi ; si la signature diffère de ce que ce prompt suppose,
   **la migration fait foi** et tu le notes.
2. Dans `writeLines`, après `postTransaction(...)` et avant le `return` :
   - si `command.type === 'TOPUP_CASH'` et que `built.lines` contient une ou plusieurs lignes dont
     `account` est `{ purpose: 'CUSTOMER_CASH_DUE' }` : `over = -(somme de leurs montants)` (crédits
     négatifs ⇒ valeur positive) ; `over > 0n` ⇒ appelle `open_cash_due_anomaly` avec
     `command.ledgerId`, `command.mediaId`, `over` et `transactionId` ;
   - `over === 0n` ou aucune ligne : rien.
3. **Avant** `postTransaction` (donc avant toute écriture), si les lignes contiennent un découpage
   et que `command.mediaId` est absent ou n'est pas un UUID : `throw new
   BuildError('VALIDATION_FAILED', 'TOPUP_CASH : support (mediaId) requis pour un découpage hors
   ligne')`. Place ce contrôle juste après `checkLines`.
4. Les montants passent en `bigint` jusqu'à la requête, en texte (`$n::bigint` avec
   `over.toString()`), comme les autres appels de `ledger-queries.ts`. Ajoute si utile une petite
   fonction `openCashDueAnomaly(client, …)` dans `ledger-queries.ts` — **fichier non possédé** : une
   retouche d'ajout seul est admise (compte rendu) ; sinon garde la requête locale dans
   `ledger-engine.service.ts`.
5. Transaction : l'appel partage `client` avec `postTransaction` : un échec de l'anomalie annule le
   tout (c'est l'effet voulu, NFR-008). Ne `catch`e pas cette erreur.
6. Le rejeu : `readExisting` renvoie la transaction existante et retourne **avant** ce code : aucun
   doublon d'anomalie.
7. Cas limites : plusieurs lignes `CUSTOMER_CASH_DUE` (le constructeur n'en produit qu'une, mais
   somme-les) ; montant de l'anomalie > 0 imposé par le `CHECK` ; support d'un autre portefeuille
   que celui de la commande : la fonction de la base le refuse (ne dédouble pas ce contrôle) ;
   `deviceId` de la commande transmis à la fonction seulement si la signature le prévoit.

Fichiers : `apps/api/src/ledger/ledger-engine.service.ts` (et, en ajout seul,
`ledger/db/ledger-queries.ts`).

Validation :
- [ ] Découpage hors ligne : `journal_transaction` `TOPUP_CASH` + une ligne `anomaly`
      `CASH_TOPUP_OVER_LIMIT` ouverte, montant = excédent, `transaction_id` renseigné, `media_id` =
      support de la commande.
- [ ] Sans `mediaId` : 422 `VALIDATION_FAILED`, aucune ligne ni anomalie.
- [ ] Rejeu de la même clé : même transaction, une seule anomalie.

### T029 — `buildCashClose` : théorique nul accepté

But : fermer une caisse dont le théorique est nul mais où des espèces ont été comptées (surplus), ou
dont le compté est nul alors qu'il y avait du théorique (manque total).

1. Dans `apps/api/src/ledger/builders/closing/cash.ts`, `buildCashClose` : remplace
   `requirePositive(expected, …)` par un contrôle explicite : `expected < 0n` ⇒
   `BuildError('VALIDATION_FAILED', 'solde théorique de la caisse : montant négatif')` ; `counted <
   0n` : message existant conservé.
2. Ajoute : `if (counted === 0n && expected === 0n) throw new BuildError('VALIDATION_FAILED',
   'fermeture de caisse sans écriture : compté et théorique nuls')`. Elle évite l'échec obscur de
   `balanced` (« Constructeur défaillant ») sur zéro ligne.
3. Vérifie à la main les trois cas par le raisonnement des lignes (`push` omet les montants nuls) :
   - manque (compté < théorique) : `A-TRANSIT +compté`, pertes `+(théorique − compté)`, caisse
     `−théorique` ;
   - surplus (compté > théorique) : `A-TRANSIT +compté`, pertes `−(compté − théorique)` (crédit),
     caisse `−théorique` ;
   - théorique nul, compté > 0 : `A-TRANSIT +compté`, pertes `−compté`, **pas de ligne de caisse**
     (montant nul omis) : deux lignes, somme nulle, `balanced` passe ;
   - compté nul, théorique > 0 : pas de ligne `A-TRANSIT`, pertes `+théorique`, caisse `−théorique`.
4. Mets à jour le commentaire de la fonction (compte du payeur `cash_diff_bearer`) ; ne touche pas à
   `buildCashDeposit` ni `buildPspSettlement`.
5. Le code de la caisse (`cashDesk`) reste la **série** du terminal (`A-CAISSE-<série>`) : inchangé.

Fichiers : `apps/api/src/ledger/builders/closing/cash.ts`.

Validation :
- [ ] Les vecteurs existants de `closing-builders.spec.ts` et `registry.spec.ts` (CASH_CLOSE)
      restent verts sans modification de leurs attentes.
- [ ] Les quatre cas ci-dessus donnent des lignes équilibrées ; compté et théorique nuls :
      `BuildError`.
- [ ] Le moteur traduit ce `BuildError` en 422 (`execute` le fait déjà).

### T030 — Tests du moteur

But : prouver T027 à T029 par des tests qui échouent si le code est annulé.

1. `apps/api/test/unit/builders/closing/closing-builders.spec.ts` (existant) : ajoute dans le
   `describe` des constructeurs de clôture : « CASH_CLOSE à théorique nul : surplus seul » (lignes
   attendues : `A-TRANSIT` +, pertes −, **aucune** `A-CAISSE-…`), « CASH_CLOSE à compté nul : manque
   total », « compté et théorique nuls : refus », « théorique négatif : refus ». Utilise
   `command(...)`, `coded(...)`, `expectBalanced` du fichier.
2. `apps/api/test/integration/engine/topup-cash-split.spec.ts` (nouveau) : modèle `engine.spec.ts`
   (`createMiniFixture`, `createTestApp` avec `LedgerModule.register(inMemoryConfigResolver(...))`,
   `TenantTx`). Le mini-fixture ne pose ni plafond ni compte `CUSTOMER_CASH_DUE` : **dans le spec**,
   par `withOwner`, pose un plafond sur le profil de la fixture (`UPDATE jurisdiction_profile SET
   unidentified_max_balance = 10000, unidentified_monthly_limit = 100000 WHERE id = (SELECT
   jurisdiction_id FROM event WHERE id = $1)` — ce profil est propre à la fixture, version
   aléatoire), et le compte `L-ESP-A-RENDRE` du portefeuille 1 (`family CLAIM`, `purpose
   CUSTOMER_CASH_DUE`, `wallet_id`, `normal_side C`). Colonnes exactes : relis l'INSERT de `account`
   dans `mini-fixture.ts`.
3. Cas à écrire (chacun avec ses assertions sur la base lue par le propriétaire) :
   - en ligne, recharge de 6 000 sur un portefeuille à 8 000 (plafond 10 000) : rejet SQLSTATE
     `CL008`, **aucune** `journal_transaction` de cette clé, **aucune** anomalie ;
   - en ligne, même recharge avec `payload.headroom = 2000` (tentative de forcer le découpage) :
     même rejet ;
   - `OFFLINE_SYNC`, même recharge, `mediaId = fx.mediaId` : transaction écrite, portefeuille +2
     000, `L-ESP-A-RENDRE` +4 000, **une** anomalie `CASH_TOPUP_OVER_LIMIT` ouverte de 4 000 liée à
     la transaction ;
   - `EDGE_SYNC` : idem (clé distincte) ;
   - `OFFLINE_SYNC` sans `mediaId` : 422 `VALIDATION_FAILED`, rien d'écrit ;
   - rejeu `OFFLINE_SYNC` de la même clé : `replayed = true`, toujours **une** anomalie ;
   - recharge sous le plafond hors ligne : pas de ligne `L-ESP-A-RENDRE`, pas d'anomalie ;
   - atomicité : provoque l'échec de `open_cash_due_anomaly` (support d'un autre portefeuille :
     `fx.wallet2` avec le support de `wallet1`) et prouve qu'aucune `journal_transaction` n'a été
     écrite (annulation de tout).
4. Isolation des données : identifiants aléatoires de la fixture (les suites tournent en parallèle
   sur une base partagée) ; aucune hypothèse d'heure (utilise `new Date()` de Node uniquement pour
   `occurredAt`, jamais comparé à une heure de la base).
5. Lance : `npx jest test/unit/builders test/integration/engine` dans `apps/api` (en série), puis
   `npx jest test/unit` entier.

Validation :
- [ ] Les nouveaux tests échouent si l'on annule T027 (garde de source) ou T028 (appel d'anomalie) —
      essai local.
- [ ] Tests existants du moteur et des constructeurs verts, inchangés.

## Test Strategy

- Unitaires : constructeurs (`jest test/unit/builders`). Intégration : `jest
  test/integration/engine` sur ta base `cashless_wp06`, **en série** (`--runInBand`), après
  `reset-db` ; `cashless_test` est réservée à l'orchestrateur.
- Pas de pgTAP dans ce lot. Les suites de référence (`test:pgtap`) ne sont pas lancées par toi, mais
  tu ne touches à aucune règle de la base.
- Horloge Docker : aucune comparaison d'horloge Node/base ; les montants et les états suffisent.

## Definition of Done

- [ ] T027 à T030 faits ; `tsc`, lint et Prettier (lignes de 100 caractères) propres sur les
      fichiers touchés.
- [ ] Tests nouveaux verts ; tests du moteur et des constructeurs existants verts sans changement
      d'attente.
- [ ] Aucun `.sql` modifié ; aucune nouvelle dépendance ; `ledger-queries.ts` touché en ajout seul,
      ou pas du tout.
- [ ] Matrice d'acceptation : FR-005 et FR-006 (partie moteur) passés à `pass` avec commande et
      résultat.
- [ ] Compte rendu du lot : écarts au plan avec leur sens (signature réelle de
      `open_cash_due_anomaly`, lecture du montant dans les lignes) ; retouches hors carte justifiées
      ; points soumis au porteur ; fichiers à faire relire par une personne (aucun ici, mais cite le
      moteur comme fichier central) ; critères couverts avec preuve ; rappel de la limite A17 (garde
      de caisse et découpage hors ligne : mission 7).

## Risks

- Un découpage hors ligne sur une caisse **inscrite** sans session est refusé par la garde de WP02 :
  ne contourne pas, ne désactive pas la garde ; c'est la limite A17, à reporter à la mission 7.
- Les vecteurs du moteur (`scenario_reference.json`) couvrent `TOPUP_CASH` : une modification de
  `enrich` qui change les lignes en ligne les ferait échouer. Lance les tests de scénario
  (`test/scenario`) avant de conclure.
- L'anomalie doit rester dans la transaction du découpage : ne l'écris pas dans un `finally` ni hors
  du `client`.
- `commandFingerprint` doit rester calculée sur la commande d'origine ; la calculer sur la commande
  enrichie casserait l'idempotence (la marge change d'un appel à l'autre).

## Reviewer Guidance

Tente de casser : (1) une recharge `ONLINE` avec `headroom` forgé dans la charge qui obtient un
découpage ; (2) un découpage sans anomalie (échec silencieux, `catch` avalé) ; (3) une anomalie
doublée au rejeu, ou ouverte alors que la transaction a été annulée ; (4) le montant de l'anomalie
différent de l'excédent réellement écrit dans le grand livre ; (5) un test qui passe parce que la
source `OFFLINE_SYNC` n'est jamais exercée, ou parce que le plafond n'est pas posé (la recharge «
au-delà » passe) ; (6) `buildCashClose` à compté et théorique nuls qui écrit ou lève une erreur
obscure ; (7) les vecteurs de référence modifiés pour faire passer le lot ; (8) la fixture qui
partage un profil de législation global.
