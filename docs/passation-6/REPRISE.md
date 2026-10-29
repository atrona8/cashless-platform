# Reprise de la mission 6 — `recharges-caisses-psp-01M5YEBA`

État au 27/10/2026. Branche `feat/recharges-caisses-psp` (partie de `main` à `2adf0dca`, après les PR #6 et #7 de la
5b) ; coordination `kitty/mission-recharges-caisses-psp-01M5YEBA` ; PR vers `main` prévue (`pr_bound`), branches et
worktrees gardés après la fusion.

## Où en est la mission

| Étape | État | Commits |
|---|---|---|
| Spécification | Faite (discovery réduite à la demande du porteur, « ne m'attends pas ») ; 31 FR, 10 NFR, 10 C | `ab31d7e`, `6729bb4`, `c1bf43a` |
| Décisions du porteur | Adaptateurs PSP réels et coffre AWS **reportés** (mission 6b) ; OP-N81, ADR-131 | `c1bf43a` |
| Plan | Fait : plan, research (R-20 fait foi), data-model, contrats, quickstart | `52bdf27`, `c3519af` |
| Passe contradictoire du plan | 34 constats (4 bloquants) : 31 corrigés, 3 reportés avec raison | `c3519af` |
| Addendum documentaire post-plan | Fait (journal de `06-docs-status.md` écrit) | `202d027`, `cb01670` |
| Tâches (`/spec-kitty.tasks`) | Faites : 14 lots (T001-T074), prompts mis en cohérence (signatures SQL, ports, routes), 13 lanes, matrice d'acceptation créée | `de274f5` |

## Ce qui est consigné

- Décision du porteur du 27/10/2026 (tâches) : comptes `A-PSP-*` créés par une fonction dédiée `open_psp_accounts`
  (`SECURITY DEFINER`, comptes PSP seulement) ; `open_event_ledger` inchangée. ADR à écrire par WP14 ; `0037` à faire
  relire par une personne.
- Arbitrages des tâches : `WALLET_BLOCKED` reste 422 (écart avec `contracts/psp.md` signalé) ; routes de demande
  ajoutées pour `CASH_DEPOSIT`, `WALLET_UNBLOCK`, `LATE_CHARGEBACK` ; `account_purpose_guard` en `SECURITY INVOKER`
  (renforcement).

- OP-N81 (PSP et coffre en faux, bloque les recharges en ligne en production), OP-N82 (remboursement au payeur d'un
  paiement non crédité hors plateforme) ; ADR-131 (report), ADR-132 (contrôle des caisses renforcé), ADR-133 (frais
  par configuration, anomalie `PSP_TOPUP_NOT_CREDITED`, actions `WALLET_UNBLOCK` et `CASH_DEPOSIT`, `A-PSP-*`
  négatif).
- Mission 6b « Adaptateurs PSP réels et coffre des secrets » ajoutée à `PROMPTS-A-ENVOYER.md` et `PRD.md`.
- Reports nommés à d'autres missions : session d'une recharge espèces hors ligne (mission 7, A17) ; rapprochement qui
  exclut les anomalies de paiements non crédités et contrôle « aucune session ouverte » avant `RECONCILING`
  (mission 9, A16, A32) : reportés dans PROMPTS (missions 7 et 9) et PRD le 27/10/2026.

## Prochaines actions

0. (27/10, en cours) Analyse enregistrée (prête). Implémentation lancée : WP01 (lane-a), WP02 (lane-b), WP03 (lane-c) ;
   fiche des agents : `docs/passation-6/fiche-implementation.md` ; bases `cashless_wpXX`, `cashless_test` à
   l'orchestrateur ; `--force` sur le garde kitty-specs autorisé pour cette mission (artefacts du runtime seuls).
   14:50 : WP01 rejeté au cycle 1 (charge `PSP_CONFIGURATION` contre 0037, motif `secret_ref`) → correction
   cycle 2 relancée ; relectures WP02/WP03 abandonnées sans verdict (session effacée) → relancées.
   WP02 **approuvé** (pgTAP 174/174, mutations des gardes détectées). WP01 cycle 2 (`0d87b69e`) en relecture.
   WP06 lancé (lane-f). Points de la relecture de WP02 à reprendre :
   - WP05 doit fermer `EXECUTE` sur `cash_actor_allowed`, `cash_session_usable`, `cash_session_attach_own` et
     les écritures directes sur `cash_desk`/`cash_session` (aujourd'hui ouvertes par `roles.sql`).
   - WP09 : contrôler côté API que l'acteur a un rôle sur l'événement (`…_for_session`, `attach_cash_tx`,
     `refund_cash_due`) et prouver le rattachement des recharges (test 147 de 0036 seulement descriptif).
   - Relecture humaine de 0036 : `posting_cash_desk_guard` laisse passer si la recherche dans `cash_desk` ne
     voit rien ; sûr tant que le propriétaire des fonctions contourne la RLS (superutilisateur), échec
     ouvert sinon. `attach_cash_tx` n'impose pas une transaction postérieure à l'ouverture.
   - `LATE_CHARGEBACK` : déjà en base (0009/0011/0033) ; `data-model.md` l.116 est exact (relecture WP01 c2).
   WP01, WP03 **approuvés**. WP04 : lane-d réparée à la main (fusion de lane-c, conflit de prompt seul),
   implémentation relancée. WP06 (`ee906623`) en relecture. Points :
   - `open_cash_due_anomaly` (0036) ne vérifie que le grand livre du bracelet, pas qu'il est celui du
     portefeuille crédité (conforme au prompt de WP02, plus faible que ce que supposait WP06) :
     renforcement possible, à garantir au moins côté API (WP09 : portefeuille déduit du bracelet).
   - WP07 : `secret_ref` dont le nom commence par un point refusé par le coffre (ajout au prompt).
   - WP05 : `REVOKE EXECUTE` explicite sur les fonctions internes (précision au prompt) ; ses droits
     directs (INSERT d'une configuration ACTIVE, lecture de `secret_ref`) sont bloquants à sa revue.
   WP06 **approuvé** (124 tests moteur, 2 mutations détectées). Reports dans le prompt de WP09 : `source`
   fixée par le serveur, portefeuille déduit du bracelet, rôle de l'acteur, rattachement prouvé.
   WP08 et WP11 : ajouter leurs opérations de terminal à `device-auth-matrix.spec.ts` (à vérifier à leur revue).
   Échecs du Jest complet vus par le relecteur de WP06 (claim-code-order, personalization, platform,
   migrate-rights) : batterie de l'orchestrateur sur lane-f (cashless_test remise à zéro) : 2197 verts,
   2 échecs (`personalization` délai de 5 s sous charge, `idempotency` 429) ; les deux suites seules,
   deux fois après reset : 57/57. Instabilités de charge, pas un défaut de WP02/WP06.
   WP04 (`eea02fd2`, 0038, 284 tests pgTAP) en relecture. Reports :
   - WP07 : mapper `CL043` et `CL044` dans `sqlstate-map.ts`.
   - WP11 : `CL039` sort en 422, le contrat veut 409 → contrôler le statut avant d'appeler la base.
   - WP13 : clé d'écriture des contestations `psp:<config>:<provider_dispute_id>`.
   - WP05 : fonctions internes de 0038 à fermer aussi (`psp_session_operator`, `psp_key_prefix`,
     `psp_topup_net_credited`, `psp_complete_core`, `psp_topup_replay_row`, déclencheurs).
   - Configuration SUSPENDED : notifications refusées (research l.248, A15), le commentaire de 0037
     sur `psp_webhook_context` est trompeur (« reçoit encore ») : à reformuler à la relecture humaine.
   WP04 rejeté au cycle 1 (double crédit après résolution manuelle d'une anomalie : régression du lot),
   **approuvé** au cycle 2 (`7158248e`, 295 tests). WP05 lancé sur lane-e, préparée à la main : fusion
   de b, c, d ; conflit de code `tests_definer_trigger_writers.sql` résolu par union (`023d4e10`) ;
   suites 0036-0038 vertes sur cashless_test après reset. À signaler au porteur : `psp_poll_candidates`
   et `psp_events_to_retry` voient tous les prestataires (voulu par `database-rights.md`, travail de fond).
   WP05 **approuvé** (`1ae2910e` ; 213 + 52 tests ; 57 fonctions classées ; post-roles rejouable à ACL
   identiques). Pour la revue post-fusion : INSERT direct de `cashless_app` sur `anomaly` (défaut antérieur,
   utilisé par payments.service.ts:187 et reversal.service.ts:212) ; `ALTER DEFAULT PRIVILEGES` non couvert
   par les tests (non exploitable). WP07 lancé sur lane-g préparée (fusion a + e, conflits kitty-specs seuls).
   WP07 **approuvé** (`21acd126` + `a6afb6cb` : test de borne OP-N81 étendu à import()/require()/import nu,
   mutation revérifiée par l'orchestrateur). Consigné : montant nul refusé partout (cohérent avec 0038) ;
   processus public bloqué en production par le faux d'identité du festivalier (antérieur). À relire par
   une personne : `apps/api/src/psp/hmac-signature.ts`, `secret.ts`. WP08 lancé (lane-h préparée : a, e,
   f, g fusionnées, `tsc` propre) et WP10 lancé (lane-g) en parallèle.
   - `cashless_test` a reçu des fixtures d'un Jest mal aiguillé (WP06) : `reset-db` avant la batterie.
   28/10 : **reprise sur le poste Windows.** Branches `kitty/mission-…` et lanes poussées par le porteur ;
   worktree de coordination recréé (`.worktrees/recharges-caisses-psp-01M5YEBA-coord`, sinon « no canonical
   status ») ; cluster PG17 privé (`tools/dev-db/start.sh`, port 5433) ; Jest toujours `--runInBand
   --forceExit`, un fichier par appel ; Avast interceptait le TLS local (exclusion de 127.0.0.1 faite par le
   porteur). WP10 **approuvé** (`2ff8666` ; mineurs : nom `secret_ref` ≤ 100 contre 64 au prompt, JWT avec
   point non détecté par `looksLikeSecret`, `ORG_FPSP` attendu changé dans `api-config-replay`, cohérent
   ADR-133). WP08 terminé (`b8ebd96` : fixtures réparées, 5 suites ajoutées ; 56 tests + matrice 12/12) et
   **approuvé** (`716f3ef`). Reports de la relecture de WP08 :
   - WP14 : masquer `cash_diff_anomaly_id` dans la vue AGENT (renforcement de l'aveugle) ; test d'API seule
     pour fermeur ≠ compteur (la base, CL041, est le contrôle de référence) ; documenter `counted_at` ignoré.
   WP09 lancé sur lane-i (prompt de la lane réécrit en double encodage par `implement`, réaligné).
   WP09 **approuvé** (`8b3a340` ; code 8b54f84..21a0c20 ; 13 suites vertes, 9 mutations de l'implémenteur
   tuées). Écarts acceptés : `content_sha256` sans `tap_id` (sync_protocol §3.3 ; mission 7 à aligner,
   `TOPUP_CASH` chaîné) ; `moneyAccount` gardé dans `DelegatedPayload` (refusé avec `cashSessionId` ; code
   mort à retirer, `test/scenario/commands.ts` en dépend) ; 400 au lieu de 422 ; un 409 « pas de session »
   consomme le numéro du terminal. Reports :
   - WP14 : test du portefeuille d'un autre grand livre (**mutation survivante** : contrôle présent, non
     testé) ; test où le contrôle API de `CLOSING` est seul rempart (la base 0036 tient) ; `toEqual` dans
     `release.spec`.
   - WP11 : utiliser et tester `takeDueDepositForWallet`. WP12 : reprise de caution au rejeu (A33).
   - Relecture humaine : `ledger/db/ledger-queries.ts`, cas `take_deposit`/`refund_deposit` du moteur,
     `media/lifecycle/counter-access.ts`, `topups/cash/cash-topup.service.ts`.
   WP11 **approuvé** (code `10309af`..`25986f3` sur lane-j ; lane-j créée à la main : conflit de prompt WP09
   et union `app.module.ts`/`audit.service.ts` entre g et i ; 37 fichiers de `kitty-specs/` remis en LF pour
   lever « stale_analysis_report »). Écarts acceptés : verrou consultatif `psp-topup:<id>` au lieu de FOR
   UPDATE (droits inchangés) ; CL039 422 contre 409 de `contracts/psp.md` ; succès après annulation crédité
   (R-20 contre openapi : **à confirmer par le porteur**) ; plafond carte sur le jour UTC de la base ;
   `notificationUrl` relative (pas d'URL publique en configuration) ; `PSP_MISMATCH` par INSERT direct dans
   `anomaly` (droit antérieur). Reports :
   - WP12 : prendre `PspTopupLookup.lock`/`findForUpdate` avant `expire_psp_topups`, `mark_psp_topup_initiated`
     et toute écriture sur `psp_topup` ; classer CL029 « anomalie déjà résolue » (pas de RETRY en boucle ;
     motif carte erroné `CARD_DAILY_LIMIT`) ; `afterCommit` après le COMMIT ; reprise de caution au rejeu.
   - WP13 : `findForUpdate` avant `record_chargeback` et `block_wallet_after_chargeback`.
   - WP14 : tests de MISMATCH concurrent (mutation de clé survivante), `process` contre `cancel` en HTTP,
     succès rejoué après anomalie résolue ; écart CL039 dans les contradictions.
   - Relecture humaine : `topups/psp/psp-payment-processor.ts`, `card-checks.ts`, `psp-topup-caller.guard.ts`,
     `psp-topup-lookup.ts`, `psp-refusals.ts`.
   29/10 : **reprise sur macOS.** Doublons locaux de WP11 abandonnés (accord du porteur ; sauvegardes
   `backup/coord-local-20261029`, `backup/lane-j-local-20261029`). WP12 repris (lane-k du poste Windows) :
   `880b5c9e` (tsc, isolation des suites, test CL029) ; `--force` après `align-lane.sh k` ; **approuvé** par un
   relecteur distinct (aucun bloquant ; 90 tests du lot ; 7 mutations tuées, 2 survivantes). Retouche de
   `psp-payment-processor.ts` (WP11) : NO_EFFECT sur anomalie résolue, n'affaiblit rien. `mark_psp_topup_initiated`
   prend `FOR UPDATE` en SQL (0038 l.492) : report de WP11 sans objet. Piège : Jest exige
   `source tools/dev-db/env.sh` (sinon `cashless_test`), fiche corrigée. Reports :
   - WP13 : brancher `PSP_DISPUTE_HANDLER` (DISPUTE reste RECEIVED sans gestionnaire).
   - WP14 : reprise des cautions DUE si le processus meurt entre COMMIT et `afterCommit` (affaiblit A33,
     fenêtre étroite) ; démarrage de `PspPollerProcessModule` en production avec un faux ; canari de secrets
     dans les journaux ; NFR-006 ; 100 rejeux concurrents ; test qui tue `a || b` sur les deux secrets.
   - Mineurs : `alarmCode` jamais remis à zéro en mode boucle ; une écriture en base par refus (amplification
     sous déni de service, conforme au plan) ; 404 non chronométrés à l'identique.
   - Relecture humaine : `webhooks/webhook-verifier.ts`, `webhooks.controller.ts`, `webhook-intake.service.ts`,
     `psp/hmac-signature.ts`, `db/psp-poller-db.module.ts` (rôle `cashless_app`, pas de rôle dédié), delta de
     `psp-payment-processor.ts`.
   Batterie complète sur lane-k (`cashless_test` après reset) : 2556 verts, **2 échecs hérités de lots
   approuvés** (jamais signalés) :
   - `test/unit/idempotency-guard.spec.ts` (RISK-2) : `CashSessionsController` (WP08) injecte `TenantTx` pour
     une lecture seule (fausse alerte, sortir la lecture) ; `PspTopupsController.initiate`/`.cancel` (WP11)
     sans `@IdempotentTransaction()`, voulu par l'arbitrage (appel PSP hors transaction) : **exception au
     garde soumise au porteur** (29/10).
   - `end-to-end/media-port-swap.spec.ts` (SC-007 de la mission 4) : `cash-due`, `deposit`, `release`
     modifiés par WP09 (rattachement de la session de caisse, prévu) : liste du test à mettre à jour.
   - **Décision du porteur (29/10)** : garde RISK-2 **reporté à WP14**, batterie rouge jusque-là. WP14 tranche
     l'exception de `initiate`/`cancel` (porteur à resolliciter, dette nommée si exception) et corrige aussi
     la fausse alerte de `CashSessionsController` et la liste de SC-007.
   WP13 : implémenté (`196a4fa5`, lane-l), **approuvé** par un relecteur distinct (aucun bloquant ; 38 tests
   du lot + 42 webhooks ; 6 mutations tuées). Écarts jugés renforce/neutre (blocage sur lignes écrites, refus
   du moteur → PSP_MISMATCH ENGINE_REFUSED, CLOSED sans blocage). Rôles : LATE_CHARGEBACK = ORGANIZER_ADMIN
   ou OPERATOR_ADMIN (**OPERATOR_ADMIN à confirmer par le porteur**), WALLET_UNBLOCK = ORGANIZER_ADMIN seul.
   Reports à WP14 :
   - `EventDispatcher.expireUnmatched` (WP12) ne traite que PAYMENT_SUCCEEDED : une contestation introuvable
     reste UNMATCHED sans PSP_MISMATCH après 24 h (T068 l'attendait) ; corriger avec un test.
   - **Sécurité, défaut de 0038 (WP04)** : portefeuille déjà BLOCKED pour une autre cause (perte, fraude) +
     contestation à solde insuffisant → `block_wallet_after_chargeback` pose `wallet_blocked` sans distinguer
     la cause ; `unblock_wallet` pourrait alors le débloquer par la voie contestation (toujours à deux
     ORGANIZER_ADMIN). À soumettre au porteur ; POINTS_OUVERTS + test.
   - Relecture humaine : `chargebacks/late-chargeback-action.ts`, `chargeback.service.ts` (`post`),
     `wallet-unblock-action.ts`, avec `unblock_wallet`/`block_wallet_after_chargeback` de 0038.
   Batterie lane-l (`cashless_test` après reset) : 2594 verts, seuls les 2 échecs hérités (WP14).
   **Décisions du porteur (29/10) pour WP14** : (1) RISK-2 : **revoir les routes** `initiate`/`cancel` (dernière
   transaction, référence du PSP et réponse, par `IdempotentTx`) ; garde intact, pas d'exception. (2) Défaut
   de déblocage de 0038 : **corriger dans WP14** (renforcement ; ne remettre ACTIVE que si le blocage vient de
   la contestation seule), test, relecture humaine. (3) LATE_CHARGEBACK : ORGANIZER_ADMIN ou OPERATOR_ADMIN
   **confirmé**.
   WP14 cycle 1 (`ecb481e0`, `791ff0d5`, `6d5fb6ea`) : décisions A-E appliquées (RISK-2 tenu sans exception,
   0039, SC-007, DISPUTE > 24 h) ; **approuvé** par un relecteur distinct ; batterie de lane-m : **2635 verts,
   0 échec**. Restaient : interblocage fermeture/recharges espèces (500 `40P01`, `it.failing`), `[A8-DETTE]`
   (OP-N84) non levé, 0039 partiel (contestation → perte → déblocage remet ACTIVE ; ADR-134 attribuait à tort
   la limite au porteur). **Décisions du porteur (29/10)** : corriger l'interblocage et lever A8-DETTE **avant
   fusion**. WP14 renvoyé en cycle 2 par l'orchestrateur (retour : interblocage, A8-DETTE, 0039 complet),
   implémentation du cycle 2 lancée sur lane-m. Reports non faits jugés non bloquants : voir
   `WP14-matrice-et-relecture.md` (lane-m).
   WP14 cycle 2 (`0989a93e`, `05105026`) : 0040 (fermeture : terminal puis session puis solde, interblocage
   levé, `cash-concurrency` ×6 vert), 0041 (OP-N84 levé : `take_deposit_from_balance`,
   `refund_deposit_from_balance`, anciennes fonctions retirées à `cashless_app`), 0042 (`wallet.other_block`,
   déclencheur `wallet_block_cause_guard`, OP-N83 complet). **Approuvé** par un relecteur distinct (5 mutations
   tuées). Batterie lane-m : Jest **2637 verts, 0 échec** ; pgTAP **43 fichiers, 3826 verts**. **Les 14 lots
   sont approuvés.** Mineurs : `cashless_app` peut poser `app.wallet_block_origin='CHARGEBACK'` et écrire
   `wallet.status` (pas d'escalade, il peut déjà écrire ACTIVE) : ADR-134/OP-N83 à reformuler (la base ne peut
   pas l'imposer) ; lignes > 100 dans `wallet-unblock-action.ts` (Prettier à la fusion). Relecture humaine en
   plus : 0040, 0041, 0042, `post-roles.sql` §4, 7b-bis, 7c, 7d, `ledger-engine.service.ts`,
   `ledger/db/ledger-queries.ts`. Suite : addendum documentaire post-review, matrice d'acceptation, `accept`,
   `merge`, PR vers `main`.
   29/10 après-midi : diagrammes de la mission régénérés et relus, flux global « Recharge mobile money » de 05
   recalé (`d619306a`) ; matrice d'acceptation remplie (49 critères, 5 invariants ; `8de768cd` coordination,
   `37e56667` feat) ; **mission acceptée** (`d62258a2`, `0a423895`). `consolidate` (ex-`merge`) refusé sans
   rien changer : (1) WP01-WP11 sans tampon d'approbation (approuvés avec `--force`) ; vérifié qu'aucune lane n'a
   reçu de code après son approbation : **attestation accordée par le porteur** ; (2) lane-m porte `8250e55`
   (textes ADR-133/OP-N82/openapi, décision du porteur) après l'approbation de WP14 : **relecture courte
   accordée** ; WP14 repassé en `for_review` (lane-m réalignée `9f7dad04`, `--force` sur artefacts seuls).
   Ensuite : approbation de WP14, `spec-kitty consolidate --mission … --keep-branch --keep-worktree --yes
   --attest-approved-reviewed WP01 … WP11 --attest-reason …`, comparaison du code de feat à la tête testée de
   lane-m, Prettier, batterie, PR (accord du porteur).
   29/10 soir : **mission fusionnée sur feat** (`consolidate`, squash `a865462c`). Obstacles levés : WP14 relu à
   nouveau pour `8250e55` (relecteur distinct, approuvé) ; attestation de WP01-WP11 (accord du porteur) ;
   lanes périmées rattrapées en y fusionnant la lane précédente (conflits de code : unions de
   `tests_definer_trigger_writers.sql`, `app.module.ts`, `audit.service.ts`) ; `PROMPTS-A-ENVOYER.md` remis à
   la base avant la fusion puis recoché ; coordination mise à jour contre feat (journal d'événements uni, 361) ;
   comptes rendus de relecture de WP12-WP14 recopiés sur feat et lanes réalignées (le script `align-lane.sh`
   supprimait des lanes les fichiers absents de feat). Code de feat identique à `8250e552` (batterie verte de
   lane-m valable) ; Prettier propre ; contrats alignés (`0315a210`) ; docs « mergée » (`d0352e4a`).
   Reste : PR vers `main` (accord du porteur ; CI = preuve de NFR-010), revue post-fusion
   (`spec-kitty-mission-review` : écarts de sécurité ouverts, fichiers à relire par une personne),
   `docs/Mission-06-Recharges-caisses-PSP.docx`, retrospective (`spec-kitty agent retrospect synthesize`).
   29/10 nuit : PR #8 ouverte. CI : suites de concurrence de la mission sorties de la passe parallèle (`026bcc09`,
   connexions épuisées), test de contestation concurrente corrigé (dépense refusée admise), footprint des webhooks
   limité au prestataire (`cc49912f`). Revue post-fusion (relecteur distinct) : 1 bloquant de consignation, 1
   majeur ; **décision du porteur : consigner** → OP-N86, OP-N87, ADR-136, 3 tests de borne (`2001f663`, relus,
   mutations tuées) ; verdict publiable avec réserves. Document Word de la mission : `docs/Mission-06-…docx`.
   Reste : CI verte de la PR #8, relecture humaine des fichiers listés, puis fusion dans main (porteur).
   **Pause du 28/10 après WP09** (demande du porteur), tout poussé. Reprendre par WP11 (lane-j :
   dépend de g et i) : `spec-kitty agent action implement WP11 --agent claude --mission …`, puis contrôler
   l'encodage du prompt dans la lane (`grep -c "Ã©"`) et réaligner au besoin (`scripts/align-lane.sh`,
   chemin `R` à adapter à la machine).

1. (Fait) addendum post-plan.
2. (Fait) reports A16, A17, A32.
3. (Fait) `/spec-kitty.tasks` ; matrice d'acceptation à tenir au fil des lots matrice d'acceptation tenue au fil des lots (mémoire « Suivre le modèle Spec Kitty »).
4. Créer `docs/Mission-06-Recharges-caisses-PSP.docx` (gabarit de la 5b : `docs/passation-5b/scripts/gen_5b_doc.py`).
5. Implémentation : un implémenteur et un relecteur distincts par lot (sous-agents sur Sonnet ;
   `CLAUDE_CODE_SUBAGENT_MODEL=sonnet` réglé dans `.claude/settings.local.json`), tests en série par l'orchestrateur.

## Fichiers à faire relire par une personne (prévus)

Migrations `0036` à `0038` (garde de caisse, `account_purpose_guard`, droits), `post-roles.sql`, réception et
vérification des notifications (`apps/api/src/webhooks/`), ports PSP et coffre (`apps/api/src/psp/`), contestations
et blocage de portefeuille.

## Rapports

`contexte-m6.md` (sources normatives extraites, 24 questions ouvertes) ; `rapports/plan-adversarial.md`.
Environnement de test : voir `docs/passation-5b/REPRISE.md` (« Environnement de test ») ; `pg_prove` par
`docs/passation-5b/scripts/pg_prove-docker`.
