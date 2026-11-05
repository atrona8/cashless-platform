# WP21 : relecture indépendante, cycle 1 (04/11/2026)

Relecteur : agent indépendant (aucune ligne du lot écrite). Verdict : **retour à `planned`** (3 bloquants, petits).

## Bloquants

1. **`end-to-end/offline-isolation` rouge dans la passe parallèle de la CI** (`SKIP_LATENCY=1 npm test`).
   `digest()` (offline-isolation.spec.ts:~221-250) interroge les tables en propriétaire (la RLS ne s'applique pas) : le
   `set_config('app.operator_id')` ne filtre rien, l'empreinte « par prestataire » couvre donc TOUTES les lignes de la
   base ; toute suite voisine qui écrit entre l'avant et l'après la fait échouer. Reproduit :
   `SKIP_LATENCY=1 npx jest end-to-end/offline-isolation test/integration/offline/processing test/integration/offline/batches --maxWorkers=4`
   donne 8 échecs (« rien n'a bougé », « aucune écriture »). Verte seule (8 suites e2e offline en `--runInBand` : 72/72).
   La suite n'est pas dans la liste `SKIP_LATENCY` de `jest.config.cjs` : la CI sera rouge (ou instable).
   Correction préférée : filtrer chaque requête de l'empreinte par `operator_id` du prestataire (ou par les
   `device_id`/`ledger_id` du prestataire) ; à défaut, l'ajouter à la liste et à l'étape « suites seules » du workflow.
   (Le suivi attribuait cela à « une comparaison d'état global » sans le corriger ni l'écarter de la passe parallèle.)
2. **`npm run lint` échoue (5 erreurs)**, or la CI a une étape « Lint et vérification des types » avant les tests :
   `apps/api/test/support/offline-dataset.ts:508` (`any`, WP21) ; hérités : `src/offline/processing/offline-operation.processor.ts:335`
   (`opts` inutilisé), `src/offline/seq/seq-gap.service.ts:10` (import `ProblemException` inutilisé),
   `test/integration/offline/processing-reversal-clock.spec.ts:41` (`any`), `test/integration/snapshots-content/cadence.spec.ts:261`
   (`kill` inutilisé). `npm run typecheck` est vert. Le lot T090 doit laisser la CI exécutable : corriger les cinq
   (retouches sans effet, hors logique).
3. **Garde `assertProcessing` (partie J) non prouvée : deux mutants survivants.** (A1) retirer les deux appels
   `ctx.assertProcessing?.(client)` de `offline-operation.processor.ts` ; (A2) rendre le corps de la garde de
   `batch-runner.ts` sans effet (`return;` au lieu de lever `BatchNotProcessing`) : les 24 suites `test/integration/offline`
   + `test/unit/offline` restent vertes (312 tests). Aucun test jest ne rend un lot `ABANDONED`/`REJECTED` en cours de
   traitement ; `abandoned: true` n'est jamais assertée (batches-run.spec.ts:46 vérifie seulement `false`). La partie J a
   déplacé la garde dans la transaction de l'opération en affirmant « plus strict (sous le verrou du terminal) » : à
   prouver. Test attendu : lot de N opérations dont le lot passe à `REJECTED ABANDONED` (SQL propriétaire, ou crochet du
   processeur factice) après l'opération k ; vérifier `abandoned: true`, qu'aucune opération > k n'est écrite
   (journal, registre), et la même chose avec le vrai processeur (rien écrit pour l'opération qui voit l'abandon).
   Le chemin sans `ctx.assertProcessing` (import, tests) doit rester couvert.

## Non bloquants

- **Numérotation des SC : `spec.md` a raison, les titres de test sont décalés.** Spec : SC-007 = secrets, SC-008 =
  production (démarrage refusé), SC-011 = isolation. Tests : `offline-isolation` dit SC-007, `offline-secrets` dit SC-008,
  `offline-production` dit SC-011 (permutation circulaire, reprise de l'ordre de l'intitulé de T088 du prompt du lot, qui
  énumérait « SC-007, SC-008, SC-011 » dans l'ordre isolation, secrets, production). À corriger dans les titres/en-têtes
  des trois suites et dans les notes de la matrice. SC-009 (levées) et SC-010 (recharges espèces) sont bien cités.
- **FR-036 cité par aucun test.** Le comportement existe : `test/integration/offline/processing.spec.ts:106` (même numéro,
  autre contenu : `IDEMPOTENCY_KEY_REUSED`, anomalie `IDEMPOTENCY_CONFLICT`, une seule transaction, solde inchangé). Mais la
  sonde de la spec pose le numéro « hors idempotence » par le propriétaire ; le test pose le numéro par un premier lot. Citer
  FR-036 dans le titre de ce test (et, mieux, ajouter le cas « registre posé par le propriétaire »). Attention : `ADR-103`
  cite « FR-036 » pour un autre sens (mission 4) : sans lien.
- **FR-042 sans test nommé** : la preuve est `npm run check -w @cashless/contracts` (vérifié vert : types TS et Dart à jour)
  + l'étape CI « Types du contrat régénérés sans écart » + la complétude des routes de `offline-isolation`. Le dire dans la
  matrice (type de preuve `command`, pas `automated_test`).
- **FR-024 (preuve mince)** : `LEDGER_LOCKED` et `SYNC_DEADLINE_PASSED` / `LATE_OFFLINE_SYNC` ne sont couverts que par
  `period.spec.ts` (fonction pure). Aucun test d'intégration ni pgTAP ne met un grand livre en `LOCKED` ou un événement en
  `SETTLING` puis soumet un lot (le câblage `compliance-input.reader.ts` -> `period.ts` n'est donc pas prouvé ; seul
  `PERIOD_CLOSED` l'est par `processing.spec.ts`). Lot WP19 (approuvé), pas WP21 : à inscrire en réserve de la matrice, ou
  deux cas d'intégration à ajouter.
- **OP-N98** : fiche (POINTS_OUVERTS §2, l.1273), ADR-151, test de borne (`cadence-bounds.spec.ts`, `it.failing` +
  marge 62,5 s dans `snapshot-latency.spec.ts`), reports `PROMPTS-A-ENVOYER.md:574` et `PRD.md:316` : tout y est. Manque la
  **ligne du tableau de tête** de `POINTS_OUVERTS.md` (le tableau s'arrête à OP-N97, l.78). Ce n'est pas un écart de
  sécurité (CLAUDE.md règle 3 appliquée par prudence : OK).
- **Migrations hors plan sans ADR** : 0052 (exposition bornée, réécrit `offline_device_exposure`), 0054 à 0057 ne sont dans
  aucun ADR/OP (seule 0053 est citée par ADR-151). Pour 0050/0051 le lot avait ouvert ADR-146/148 : faire de même
  (un ADR court : migrations 0052, 0054-0057, équivalence prouvée, aucun droit changé, index ajoutés sur `media_*_history`
  et `media_assignment`, `device_seq_registry`, `offline_batch`).
- **Signataire, course bénigne** : `runOnce()` lit `readyDrafts()` avant de tester `inFlight` ; si une tâche vient de finir
  entre la lecture et le test, le brouillon (déjà publié) est relancé : `content()` puis éventuellement `discard` sur un
  brouillon disparu lèverait une erreur que `processLedger` convertit en alarme 3 (fausse alerte). Les protections base
  (`publish_offline_snapshot` : `DRAFT_NOT_READY` ignoré par `isDraftGone`, version = max + 1) empêchent toute double
  publication ; aucune signature sans vérification. À durcir (relire l'état ou traiter `isDraftGone` dans `discard`).
- **Mesures** : `snapshot-latency.spec.ts` répète jusqu'à `MAX_SERIES = 3` localement (1 en CI) tant que le p95 dépasse 2 s :
  tolérable car le critère reste le dernier/meilleur essai noté ; à ne pas confondre avec une mesure sans nouvel essai.
  `offline-latency` : 20 lots, p95 = quasiment le maximum (assumé dans l'en-tête).
- **`platform-party` mémorisé** (seule mémorisation sans déclencheur d'immuabilité) : l'argument (aucun chemin ne modifie
  `account.owner_party_id`) tient et n'est pas un contrôle ; à garder dans la liste de relecture humaine.

## Points vérifiés sans réserve

- **Migrations 0053 -> 0054 -> 0055 -> 0057 : équivalence.** Lecture : la vue `offline_snapshot_rows` = affectation ouverte x
  média x portefeuille (`schema_grand_livre_cashless.sql:2362`), donc « token absent de la vue du grand livre » <=> « aucun
  média de ce prestataire portant ce jeton avec affectation ouverte dans un portefeuille du grand livre » (retraits en
  EXCEPT, clé primaire `(ledger_id, token_hash)`) ; le sur-ensemble `cand` couvre chacune des cinq conditions du filtre
  conservé. `assert_tenant` reste la première instruction effective (après `tenant_of_ledger` pur, comme en 0053), SECURITY
  DEFINER, `search_path` figé, `CREATE OR REPLACE` conserve propriétaire et ACL, aucun GRANT. Le test pgTAP recopie 0053 en
  `pg_temp.old_rows` et compare ligne à ligne sur 11 scénarios dont le jeton d'un autre grand livre, le jeton retiré, la date
  nulle, le futur et le bord des 5 s. `npm run reset-db` + `test:pgtap` : **4896 tests, PASS** (55 fichiers).
  Migration 0052 (hors liste, vérifiée aussi) : partitions A/B/C équivalentes à la règle de 0048/0049 (cas limite théorique
  d'un registre BATCH dont le lot n'existe plus : compté avant, ignoré maintenant ; interdit par clé étrangère).
- **Mémoire de lot** : ne contient que contrat (`contract_immutable`, 0007), profil de législation
  (`jurisdiction_profile_immutable`, 0007) et propriétaire `PLT_REDEV` ; ligne `event`, règles datées, version de
  configuration, droits de place (non lus : getter qui lève), statuts, conformité, soldes : relus à chaque appel. Une
  mémoire par exécution de lot (`new ReferenceMemo()` dans `run`), échecs non gardés. Chemin en ligne : `engineOptions`
  rend `undefined` sans `ctx.reference`, `memo`/`skipPitchFees` absents ; seule différence, `SELECT e.*` identique à
  `eventColumns` de la cascade. `skipPitchFees` : seul `closing/fees.ts` lit `pitchFees` (hors ligne : jamais).
- Reports et dette : OP-N57, N58, N68, N69, N75 levés (lignes 38, 39, 49, 50, 57 + récapitulatif l.1384-1388), N89, N90, N91
  tenus, ADR-137 à ADR-151 présents.
- CI : `ledger-tests.yml` garde toutes les étapes d'avant, ajoute concurrence, parcours, mesures ; variables
  `DATABASE_URL_SNAPCONTENT/SNAPSIGN/MAINT` posées ; `jest.config.cjs` écarte journey, minimal, concurrency, latences.
  Quickstart : scripts `start:snapshot-content/signer/maintenance` et `dist/main.*.js` existent ; `npm run check -w @cashless/contracts` vert.
- Lanes : suites e2e offline (hors latences) 72/72 en série ; 94/94 sur signataire, mémoire, intégration signataire.

## Mutants (lane, tous annulés par `git checkout`, base remise par `reset-db`)

| # | Mutation | Résultat |
|---|---|---|
| M1 | DELTA retraits en `NOT EXISTS` (forme 0054), fonction rechargée en base | **tué** (`no_stats` hors délai 5 s) |
| M2 | `OFFSET 0` retiré de 0057 | **tué** (`no_stats`) |
| M4 | `cand` sans la branche historique de statut | **tué** (candidates : 9 échecs) |
| A1 | retrait des 2 `assertProcessing` du vrai processeur | **SURVIT** (bloquant 3) |
| A2 | garde du runner sans effet | **SURVIT** (bloquant 3) |
| A3 | mémorisation de la ligne `event` | tué (`batch-reference.spec`) |
| B1 | signataire sans `inFlight` | tué |
| B2 | pas de vérification contre la clé publiée | tué (3 cas) |
| B3 | verdict de vérification du brouillon ignoré | tué (7 cas) |
| B4 | mémoire partagée entre lots | tué (3 cas) |
| B5 | ordre des brouillons inversé | tué |
| B6 | pas de détachement sur FULL | tué |
| C1 | classe `isFake` non couverte ajoutée dans `src/` | tué (`offline-production` a, 2 cas) |
| C2 | blocage non prioritaire dans la cadence (DELTA attend 60 s) | tué (parcours étapes 3 à 6) |

Non exécutés : retrait d'une colonne du balayage de secrets (assertion `columns.length > 200` + canaris), 100 rejeux
sans clé, seuils de latence (lus : 60 s / 2 s / 5 s / 62,5 s documentés ; pas relancés, mesures de l'orchestrateur
NFR-003 p95 43,4 s et 42,8 s, NFR-005 4,1 s max).

## Fichiers à faire relire par une personne

- Migrations `0052`, `0054`, `0055`, `0057` (fonctions DEFINER `offline_device_exposure`, `offline_snapshot_source_rows`),
  `0056` (index) ; en plus de la liste du lot (0043 à 0049, `post-roles.sql`, `apps/api/src/kms/`,
  `snapshots-content/crypto/`, `snapshots-signer/`, `device-envelope.ts`, `offline/batches/`, `offline/processing/`,
  `payments/chained-content.ts`).
- `configuration/sql-config-resolver.ts` (périmètre de la mémoire de lot), `offline/batches/batch-runner.ts` (garde sous
  verrou de terminal), `snapshots-signer/snapshot-signer.worker.ts` (concurrence par grand livre).
- `OP-N95(3)` : refus de `DATABASE_URL_MAINT` propriétaire en production.

## Anti-pattern checklist (WP)

1 code mort : PASS. 2 fixture synthétique : PASS (parcours par l'API, canaris testés). 3 retours silencieux : PASS.
4 couverture FR : **FAIL partiel** (FR-036 non citée, comportement présent ailleurs ; voir non bloquants). 5 surface gelée :
PASS (aucun `.sql` généré modifié ; `check:generated` non rejoué ici, `git diff` sur les `.sql` générés de ledger-sql :
seuls `tests_grand_livre_cashless.sql`/`gen_tests.py` touchés, hors lot). 6 décision verrouillée : PASS. 7 fichiers partagés :
PASS (merges de lanes). 8 fragilité de production : PASS (`throw` de la mémoire = `skipPitchFees`, fail-loud voulu).
