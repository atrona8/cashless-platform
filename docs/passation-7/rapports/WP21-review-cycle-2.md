# WP21 : relecture indépendante, cycle 2 (04/11/2026)

Relecteur indépendant (aucune ligne du lot écrite). Verdict : **approuvé**. Aucun bloquant.

## Constats du cycle 1

1. Empreinte d'isolation : LEVÉ. Les 10 requêtes de `digest()` sont filtrées par `operator_id = $1` ; les 10 tables
   (offline_policy, offline_policy_history, offline_snapshot, offline_snapshot_key, offline_batch, anomaly,
   device_journal_import, device_seq_registry, approval_request, journal_transaction) portent toutes `operator_id NOT NULL`
   (vérifié dans le schéma). Aucune table sans colonne, donc rien à filtrer autrement. Une écriture de l'attaquant chez la
   victime change l'empreinte (mutant I1 tué) ; une écriture chez un tiers ne la change plus (contrôle I2 : 11/11 vert).
   Passe parallèle reproduite (isolation + processing + batches + signataire, --maxWorkers=4) : 11 suites, 114 tests verts.
2. Lint : LEVÉ. `npm run lint` vert dans la lane (les 5 erreurs corrigées, sans effet de logique).
3. Garde `assertProcessing` : LEVÉ. Deux tests ajoutés (processeur factice dans `batches-run.spec.ts`, vrai processeur dans
   `processing.spec.ts`) assertent `abandoned: true`, l'arrêt, l'absence d'écriture au-delà (résultats, registre,
   transactions, solde). A1 et A2 tués.

Non bloquants du cycle 1 : numérotation des SC corrigée (isolation SC-011, secrets SC-007, production SC-008, conforme à
spec.md) ; FR-036 cité dans le titre du test ; FR-042 passée en preuve `command` ; réserve FR-024 inscrite dans la matrice ;
ligne OP-N98 ajoutée au tableau de tête ; ADR-152 couvre 0052 et 0054-0057 ; course du signataire corrigée
(capture de `inFlight` avant `readyDrafts()`, test unitaire dédié).

## Mutants (lane, annulés par git checkout, base remise par reset-db, lane propre)

| # | Mutation | Résultat |
|---|---|---|
| A1 | retrait des 2 `ctx.assertProcessing` du vrai processeur | tué (test « garde du vrai processeur ») |
| A2 | garde du runner sans effet (`|| true`) | tué (2 tests : factice et vrai processeur) |
| I1 | écriture chez la victime (`UPDATE offline_policy`) dans le balayage | tué (7 tests d'isolation) |
| I2 | écriture chez un tiers | non détectée, voulu (11/11 vert) |
| S1 | signataire sans la capture `flying` | tué (test « ne relance pas un brouillon publié ») |

## Nouveaux constats

Bloquants : aucun. Non bloquants : (a) `.length > 100` dans les lignes ajoutées (ex. `offline-dataset.ts` type de `inOperator`,
`processing-reversal-clock.spec.ts`) : reformatage Prettier prévu à la fusion (décision 14/10) ; (b) la réserve FR-024
(LEDGER_LOCKED / SYNC_DEADLINE_PASSED non câblés en intégration, lot WP19) reste ouverte, consignée en matrice.

Fichiers à faire relire par une personne : inchangés (cycle 1), plus `batch-runner.ts` (garde sous verrou) et
`snapshot-signer.worker.ts` (concurrence).
