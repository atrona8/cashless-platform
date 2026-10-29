# Revue post-fusion, mission 6 `recharges-caisses-psp-01M5YEBA`

Revue sur HEAD `abe42d3e` (feat/recharges-caisses-psp), fusion squash `a865462c`, base `2adf0dca` (393 fichiers, +70 842 / -695). Les 14 lots sont `done`. Aucun test lancé (consigne) : preuves de l'orchestrateur reprises sur la tête testée `8250e552` (code identique à HEAD) : Jest 2637 verts, 0 échec ; pgTAP 43 fichiers / 3826 verts. Les 4 « gates » du skill (contract/architectural/e2e/issue-matrix) visent le dépôt spec-kitty : sans objet ici.

## Verdict : NON PUBLIABLE en l'état (un bloquant de consignation, règle 4 ; levé par un correctif documentaire seul)

Le code lu est sain : cryptographie des notifications, crédit en un SAVEPOINT, gardes de production. Le seul bloquant est une dette de droits jamais consignée. Dès qu'elle l'est (point ouvert, ADR, test de borne, report), le verdict passe à PUBLIABLE AVEC RÉSERVES.

Compte : 1 BLOQUANT, 1 MAJEUR, 8 MINEUR, 4 INFO.

## Constats

1. BLOQUANT (règle 3 et 4, droits non consignés) : trois droits de `cashless_app` qui dépassent le principe « lit ce qu'il sert » ne figurent dans aucun point ouvert ni ADR (`grep` de `docs/POINTS_OUVERTS.md` et `docs/DECISIONS_ADR.md` : aucun résultat) et n'ont aucun report dans `PROMPTS-A-ENVOYER.md` ni `PRD.md`.
   a. `psp_poll_candidates(int)` et `psp_events_to_retry(int)` (`0038_psp_topups.sql:569-586`, `:682-700`, accordées par `post-roles.sql:722-724`) sont `SECURITY DEFINER`, sans filtre de prestataire : elles rendent les recharges `PENDING` et les notifications de TOUS les prestataires (operator_id, configuration, référence du paiement chez le PSP, `normalized` des événements). Elles sont exécutables par `cashless_app`, donc par le processus public. Scénario : une faille du processus public (injection SQL, exécution de code) lit toutes les recharges en cours de tous les prestataires malgré la RLS. REPRISE (WP05) note « à signaler au porteur » ; aucune réponse du porteur n'est consignée. Le contrat `database-rights.md:25` les prévoit, mais prévoir n'est pas faire valider un droit plus large (règle 1).
   b. Le processus `psp-poller` tourne sous `cashless_app` (`db/psp-poller-db.module.ts`, `processes/psp-poller.module.ts`), sans rôle dédié : il porte tous les droits du processus public (écriture par fonctions, coffre via le même pool). Signalé en « relecture humaine » dans REPRISE, jamais consigné.
   c. `cashless_app` garde un INSERT direct sur `anomaly` (hérité de `roles.sql`, seule mention : commentaire `post-roles.sql:754`). La mission 6 AJOUTE cinq sites d'écriture directe : `psp-payment-processor.ts:396,419`, `event-dispatcher.ts:190,245`, `chargeback.service.ts:292` (plus deux antérieurs : `payments.service.ts:187`, `reversal.service.ts:212`). Scénario : le processus public fabrique une anomalie `PSP_MISMATCH` ou `PSP_TOPUP_NOT_CREDITED` d'un montant choisi, ou la résout (`UPDATE (status, resolution_tx_id)`), ce qui masque l'argent à rendre au payeur. Aucun test de borne ne fige ce droit.
   Correction : un OP (« Bloque la production : non », condition de levée : fonctions `open_*_anomaly` et rôle dédié pour `psp-poller`, mission 13 ou 9), un ADR (risque, raison, mission qui lève), un test pgTAP de borne (liste exacte des fonctions multi-prestataires et du droit INSERT sur `anomaly`), un report PROMPTS et PRD, et la question posée au porteur.

2. MAJEUR (sécurité, non consigné) : `posting_cash_desk_guard` (`0036_cash_sessions.sql:500-529`) échoue OUVERT. La première recherche `PERFORM 1 FROM cash_desk … IF NOT FOUND THEN RETURN NEW` sous `FORCE ROW LEVEL SECURITY` (l.147-148, politique `operator_id = current_setting('app.operator_id', true)::uuid`) ne voit aucune ligne si le propriétaire de la fonction ne contourne pas la RLS, ou si `app.operator_id` n'est pas posé : la garde laisse alors passer toute écriture d'espèces hors session. Sûr tant que le propriétaire est superutilisateur (cas du poste local, noté dans l'ADR du lot 20). Aucun test ne prouve la condition, aucun contrôle au déploiement ne la vérifie (`rolsuper`/`rolbypassrls` : aucun résultat dans `packages/`, `apps/api/src`), et REPRISE (WP02) la range en « relecture humaine » sans point ouvert. Scénario : migration jouée par un propriétaire géré (non superutilisateur) en production, la garde de caisse (FR-004, ADR-132) devient décorative sans qu'aucun test ne le dise. Correction : consigner (OP + ADR) et faire échouer `migrate.ts` ou un test si le propriétaire ne contourne pas la RLS ; ou faire échouer la garde fermée (`app.operator_id` absent ou `cash_desk` illisible = refus).

3. MINEUR (consignation, OP-N83) : la reformulation demandée par la relecture de WP14 n'est pas faite. `POINTS_OUVERTS.md:64,141,869-887` et ADR-134 écrivent « Aucun droit élargi / `cashless_app` n'écrit pas `other_block` » et ne disent pas que `cashless_app` écrit `wallet.status` (`post-roles.sql` 7b-bis : INSERT/UPDATE sur toutes les colonnes sauf `other_block`) et peut poser `app.wallet_block_origin = 'CHARGEBACK'` (`set_config` local, `0042:40`). Pas d'escalade (il pouvait déjà écrire `ACTIVE`), mais la protection de `wallet_block_cause_guard` vaut contre le code honnête, pas contre un processus API compromis. Aucun test de borne ne fige cette limite. À reformuler et à borner par un test (`cashless_app` : UPDATE de `status` possible, de `other_block` refusé).

4. MINEUR (fonctionnel, FR-015) : `apps/api/test/integration/webhooks/rejections.spec.ts:213-224` : un corps de plus de 100 Kio donne un `500 INTERNAL_ERROR` au lieu du `413` sur la route publique des notifications (le filtre `errors/problem.filter.ts` ne traduit pas l'erreur de l'analyseur), sans compteur ni alerte de refus. Rien n'est écrit au grand livre (sûr), mais la lacune n'est consignée que dans un commentaire de test (`it.failing`), pas dans POINTS_OUVERTS ni REPRISE.

5. MINEUR (consignation, règle 3) : OP-N85 n'a pas de test de borne (aucune ligne « Test » dans `POINTS_OUVERTS.md:900-912`, « Test qui tue le processus » seulement en condition de levée) et ADR-135 le dit « soumis au porteur » sans décision enregistrée. Fenêtre étroite, aucun argent perdu (caution `DUE`, `psp-payment-processor.ts` `afterCommit`), accepté comme report mission 13 ; à faire confirmer.

6. MINEUR (contrat) : `kitty-specs/recharges-caisses-psp-01M5YEBA/contracts/psp.md:30` dit encore `409 WALLET_BLOCKED` ; `openapi.yaml:2649,11230`, `sqlstate-map.ts:53` et `psp-topups.service.ts:226` disent `422` (CL039). Le test et l'openapi priment (SPECIFICATION §0.3) : écart juste, consigné dans ADR-135, mais le contrat de la mission n'est pas corrigé (le commit `0315a210` n'a corrigé que R-20).

7. MINEUR (commentaire de migration) : `0037_psp_configurations.sql:547` dit qu'une configuration suspendue « reçoit encore les notifications ». Faux : `webhook-intake.service.ts` refuse `CONFIG_NOT_ACTIVE` (404). Le report de WP04 (« reformuler ») n'est pas fait ; une migration appliquée ne se retouche pas (somme de contrôle), donc à noter dans le contrat ou dans une migration suivante.

8. MINEUR (code mort / report non fait) : `ledger-engine.service.ts:61,214` : `moneyAccount` gardé dans `DelegatedPayload` pour la caution (refusé avec `cashSessionId`) ; le report de WP09 « code mort à retirer » est encore présent (`test/scenario/commands.ts` en dépend).

9. MINEUR (travailleur) : `topups/poller/psp-topup-poller.worker.ts:47,81,170` (et `psp-event-retry.worker.ts:33,59`, `psp-event-purge.worker.ts:33,56`) : `alarmCode` jamais remis à zéro en mode boucle ; un échec ponctuel laisse le code d'alerte actif pour toute la durée du processus. Report des mineurs de WP12, non fait.

10. MINEUR (rapport de WP09, reporté) : `content_sha256` des écritures de recharge espèces sans `tap_id` (sync_protocol §3.3) ; `PRD.md:275` reprend la forme de `content_sha256` de la 5b mais pas ce point (mission 7 à aligner pour `TOPUP_CASH` chaîné).

11. INFO (garde de production, règle 2 : CONFORME) : `bootstrap.ts:40-41` ajoute les adaptateurs PSP et le coffre à `assertProcessIsSafe` (processus public ET `psp-poller`, via `runWorkers`). `psp.providers.ts` ne construit aucun faux en production (registre vide, coffre indisponible). Preuves : `production-guard.spec.ts:67-68` (chaque faux refusé), `psp-production.spec.ts` (b) démarrage refusé avec faux coffre ou faux festivalier, (c) fournisseurs indisponibles = 503 et notification 404. Réserve de conception : `optional()` (`bootstrap.ts:20-25`) avale l'absence d'un jeton ; un processus qui n'importe plus `PspModule` passerait la garde en silence (sans conséquence ici, il n'aurait alors pas de PSP).

12. INFO (process) : WP01 à WP11 approuvés avec `--force` et attestation du porteur (REPRISE 29/10) ; WP12 à WP14 relus par des relecteurs distincts, WP14 en deux cycles et relu une troisième fois pour `8250e55`. Aucun `ReviewerSelfApproval`. Restent hors de cette revue : PR vers `main` (CI = preuve de NFR-010 hors poste), `docs/Mission-06-Recharges-caisses-PSP.docx`, retrospective (le fichier existe : `retrospective.yaml`).

13. INFO (mesures) : NFR-006 (p95 82 ms, seuil 500) et NFR-009 (p95 73 ms, seuil 200) sont des mesures locales Docker, indicatives. FR-021 (adaptateurs réels) et la partie réelle de FR-022 (coffre AWS) sont reportés (OP-N81, ADR-131) : décision du porteur, conforme.

14. INFO (matrice) : `acceptance-matrix.json` `overall_verdict` = « pass », aucune note « reste » : propre, contrairement à la 5b.

## Écarts de sécurité ouverts et état de leur consignation

| Écart | Point ouvert | ADR | Test de borne | Report PROMPTS / PRD | État |
|---|---|---|---|---|---|
| Faux PSP (un par fournisseur) et faux coffre, notifications signées avec des secrets de test | OP-N81 (« Bloque : oui » pour les recharges en ligne) | ADR-131 | `production-guard.spec.ts:67-68`, `psp-production.spec.ts` (a, b, c) ; borne d'import `psp.providers.ts` seul importe `./fake/` | Mission 6b : PROMPTS:207-218 ; PRD:141 | Conforme (règle 2 prouvée) |
| Paiement réussi non crédité : remboursement hors plateforme | OP-N82 | ADR-133 | tests de la mission : aucune écriture, anomalie avec montant (`psp-process`, `psp-card`, `topup-journey` étape 5) | Mission 9 : PROMPTS:312-314 ; PRD:270 | Conforme |
| Cause d'un blocage de portefeuille (0039 puis 0042) ; limite : `cashless_app` écrit `wallet.status` et peut poser `app.wallet_block_origin` | OP-N83 | ADR-134 | `tests_psp_topups.sql` (3 ordres, mutation du déclencheur), `wallet-unblock.spec.ts` ; AUCUN test pour la limite restante | Mission 13 : PROMPTS:444 ; PRD:272 | Partiel : texte à reformuler (constat 3) |
| Octroi `take_deposit`/`refund_deposit`/`refund_cash_due` à `cashless_app` | OP-N84 LEVÉ | ADR-135 | `tests_cash_psp_rights.sql` `[A8-DETTE levée]`, `tests_execute_grants.sql`, `engine.spec.ts` | PROMPTS:445 ; PRD:273 | Conforme (levé) |
| Reprise de la caution due après arrêt entre COMMIT et `afterCommit` | OP-N85 | ADR-135 | AUCUN | Mission 13 : PROMPTS:446 ; PRD:274 | Consigné, sans test, décision du porteur non enregistrée (constat 5) |
| OP-N49 (caisses avant la mission des caisses) | LEVÉ | ADR-132 | `tests_cash_sessions.sql`, `cash-desk-guard.spec.ts`, `topup-journey` SC-002 | — | Conforme |
| `psp_poll_candidates`/`psp_events_to_retry` multi-prestataires, exécutables par `cashless_app` | AUCUN | AUCUN | AUCUN (liste figée d'EXECUTE seulement) | AUCUN | NON CONSIGNÉ : BLOQUANT (constat 1a) |
| `psp-poller` sous `cashless_app`, pas de rôle dédié | AUCUN | AUCUN | AUCUN | AUCUN | NON CONSIGNÉ : BLOQUANT (constat 1b) |
| INSERT direct de `cashless_app` sur `anomaly` (antérieur, étendu par 5 sites) | AUCUN (commentaire SQL seul) | AUCUN | AUCUN | AUCUN | NON CONSIGNÉ : BLOQUANT (constat 1c) |
| `posting_cash_desk_guard` laisse passer si le propriétaire ne contourne pas la RLS | AUCUN | AUCUN | AUCUN | AUCUN | NON CONSIGNÉ : MAJEUR (constat 2) |
| `CL039` en 422 contre 409 du contrat ; `WALLET_BLOCKED` 422 | (écart documentaire, pas de droit) | ADR-135 | `sqlstate-map.spec.ts:58`, `payments-refusals.spec.ts:119-133` | — | Conforme sur l'écart ; `psp.md:30` à corriger (constat 6) |
| Renforcements : comptes `A-PSP-*` par `open_psp_accounts` (décision du 27/10), RISK-2 sans exception, `LATE_CHARGEBACK` par `ORGANIZER_ADMIN` ou `OPERATOR_ADMIN`, vue `CASHIER` masquée, `account_purpose_guard` INVOKER | sans point ouvert | ADR-132, 133, 135 | tests nommés dans les ADR (`idempotency-guard.spec.ts`, `tests_cash_psp_rights.sql`) | — | Conformes |

## Couverture FR/NFR (spec.md, code, test)

Échantillon en profondeur (code lu, test repéré) ; le reste repris du tableau `WP14-matrice-et-relecture.md` (recoupé : suites citées présentes dans l'arbre).

| Exigence | Code | Test | Verdict |
|---|---|---|---|
| FR-004 espèces rattachées à une session | `posting_cash_desk_guard` (0036), `attach_cash_tx`, `cash-topup.service.ts` | `tests_cash_sessions.sql`, `cash-desk-guard.spec.ts`, `topup-journey` SC-002 | Couvert ; la garde SQL dépend d'un propriétaire qui contourne la RLS (constat 2) |
| FR-014 vérification des notifications | `psp/hmac-signature.ts` (HMAC `t.corps`, `timingSafeEqual`, deux secrets toujours évalués, ±300 s, échéance du précédent, jugée avant l'horodatage), `webhook-verifier.ts` (rejoue tolérance et échéance), `webhook-intake.service.ts` (ordre taille, configuration, secrets, signature) | `hmac-signature.spec.ts:111,121` (espions sur `timingSafeEqual`), `verifier.spec.ts:101`, `receive.spec.ts` | Couvert, aucun défaut trouvé |
| FR-015 refus signalés | `webhook-rejections.ts`, `psp-alert-log.ts`, `record_webhook_rejection` | `rejections.spec.ts`, `topup-secrets.spec.ts` | Couvert, sauf corps > 100 Kio (constat 4) |
| FR-016 à FR-018 crédit, non-conformité, refus après paiement | `psp-payment-processor.ts` : rapprochement exact (montant, devise, référence), portefeuille, matrice de statuts, carte, crédit sous SAVEPOINT, clés `wave:`/`om:`/`psp:` | `psp-process.spec.ts`, `psp-card.spec.ts`, `psp-concurrency.spec.ts` (100 rejeux), `tests_psp_topups.sql` | Couvert. Le contrôle du statut du portefeuille (l.~226) se fait sans verrou ; la base refuse à l'écriture (CL039), classé en refus : sans défaut |
| FR-019 interrogation, expiration, alerte | `psp-topup-poller.worker.ts`, `settleUnpaid` | `poller-status/expiry/alarm.spec.ts` | Couvert, `alarmCode` jamais remis à zéro (constat 9) |
| FR-024 à FR-026 carte | `card-checks.ts`, `complete_card_topup` (verrou consultatif, plafond) | `psp-card.spec.ts`, `psp-concurrency.spec.ts` (plafond simultané) | Couvert |
| FR-027, FR-028 contestations, déblocage | `chargeback.service.ts`, `record_chargeback`, `block_wallet_after_chargeback`, `unblock_wallet`, `wallet_block_cause_guard` (0042) | `chargeback*.spec.ts`, `wallet-unblock.spec.ts`, `tests_psp_topups.sql` | Couvert, limite restante à reformuler (constat 3) |
| FR-001 à FR-003, FR-005 à FR-013, FR-029 à FR-031 | `cash-sessions/`, `topups/`, `psp-configurations/`, `0036`-`0037` | suites citées au tableau de WP14 | Couvert (non relu en profondeur) |
| FR-020 à FR-023 | ports et faux, coffre | `fake-psp-adapter.spec.ts`, `production-guard.spec.ts` | Couvert ; FR-021 reporté, voulu |
| NFR-001 aucun double crédit | clé d'écriture par paiement, verrou `psp-topup:<id>` | `psp-concurrency.spec.ts` (100 rejeux, 20 DISPUTE) | Couvert |
| NFR-002, NFR-003 | `webhook-intake`, `Secret` (jamais sérialisé), empreintes au journal | `rejections.spec.ts`, `topup-secrets.spec.ts` (canaris, 4 cas) | Couvert |
| NFR-004 aucun faux en production | `bootstrap.ts`, `psp.providers.ts` | `production-guard.spec.ts`, `psp-production.spec.ts` | Couvert (règle 2) |
| NFR-005 cloisonnement | RLS des tables, fonctions sans filtre de prestataire = `psp_poll_candidates`, `psp_events_to_retry` | `topup-isolation.spec.ts` (19 opérations), `psp-configurations/isolation.spec.ts` | Couvert pour les routes ; fonctions multi-prestataires non consignées (constat 1a) |
| NFR-008 tout ou rien | SAVEPOINT du crédit ; `0040` (ordre des verrous de fermeture) | `cash-concurrency.spec.ts`, `close-concurrency.spec.ts` | Couvert (interblocage levé au cycle 2) |
| NFR-006, NFR-009 latence | — | `topup-latency.spec.ts` | Mesure locale, indicatif |
| NFR-010, SC-001 à SC-008 | — | batterie de l'orchestrateur ; `topup-journey.spec.ts` etc. | Couverts ; confirmation CI attendue |

Dérives non consignées : constats 1, 2, 3, 6, 7. Aucun `catch` avalant une erreur dans le code lu, hors le filet documenté `webhook-intake.service.ts` (échec de traitement : événement conservé, repris par le travailleur) et le `catch` de `optional()` (constat 11). Aucun `@ts-ignore`, `eslint-disable` ni `as any` ajouté ; un seul `it.failing` (constat 4).

## Reports des relectures par lot (REPRISE.md)

| Report | État |
|---|---|
| WP02 : fermer `EXECUTE` des fonctions internes de caisse ; WP04 : fermer celles de 0038 ; WP05 : `REVOKE EXECUTE` explicite | Fait (`post-roles.sql` 7c, `tests_execute_grants.sql`) |
| WP02 : contrôle de rôle de l'acteur, rattachement prouvé, portefeuille déduit du bracelet (WP09) | Fait (WP09 approuvé ; mutation « portefeuille d'un autre grand livre » : test ajouté par WP14, non rejoué ici) |
| WP02 : `posting_cash_desk_guard` échec ouvert | PRÉSENT, non consigné (constat 2) |
| WP05 : INSERT direct sur `anomaly` ; `ALTER DEFAULT PRIVILEGES` non couvert | PRÉSENT, non consigné (constat 1c) ; le second reste non couvert par les tests (`grep` : aucun) |
| WP05 : `psp_poll_candidates`/`psp_events_to_retry` à signaler au porteur | PRÉSENT, non consigné (constat 1a) |
| WP04 : commentaire 0037 « reçoit encore » | PRÉSENT (constat 7) |
| WP07 : `CL043`/`CL044` mappés, nom de `secret_ref` commençant par un point refusé | Fait (`sqlstate-map.ts`, `psp-configurations.dto.ts:64`) |
| WP08 : masquer `cash_diff_anomaly_id` ; `counted_at` ignoré documenté | Fait (ADR-135) |
| WP09 : `moneyAccount` code mort | PRÉSENT (constat 8) |
| WP09 : écart `content_sha256` sans `tap_id`, report mission 7 | Partiel (constat 10) |
| WP10 : `secret_ref` 100 contre 64 ; JWT avec point non détecté par `looksLikeSecret` | Non modifié (`psp-configurations.dto.ts:42,49`), cohérent entre SQL et API (100) ; INFO |
| WP11 : CL039 422 contre 409 | Consigné (ADR-135) ; contrat non corrigé (constat 6) |
| WP11/WP12 : `takeDueDepositForWallet` utilisé et testé, verrous avant écriture | Fait (`psp-deposit.spec.ts`, `retry.spec.ts`) |
| WP13 : brancher `PSP_DISPUTE_HANDLER` | Fait (`chargebacks.module.ts` global ; `poller.module.ts:26` pour le poller) |
| WP13 : contestation introuvable > 24 h sans `PSP_MISMATCH` | Fait (`event-dispatcher.ts:190`, ADR-135) |
| WP13 : défaut de déblocage de 0038 | Corrigé (0039, 0042, ADR-134, OP-N83), limite à reformuler (constat 3) |
| WP12/WP14 : reprise de la caution due si arrêt entre COMMIT et `afterCommit` | Consigné OP-N85, sans test (constat 5) |
| WP14 : `alarmCode` jamais remis à zéro ; 404 non chronométrés à l'identique ; une écriture par refus | PRÉSENT (constat 9) ; les deux autres consignés « conforme au plan », non vérifiés ici |
| RISK-2 (`initiate`/`cancel`), liste SC-007, fausse alerte `CashSessionsController`, interblocage, A8-DETTE | Faits (ADR-135, migrations 0040, 0041) |

## Fichiers à faire relire par une personne (clés, droits de la base, cryptographie)

L'agent qui a écrit le code ne vaut pas relecture indépendante.

- Droits de la base : `packages/ledger-sql/post-roles.sql` (sections 4, 7b, 7b-bis, 7c, 7d : EXECUTE, droits par colonne, `anomaly`, `wallet`), `migrations/0036_cash_sessions.sql` (`posting_cash_desk_guard`, `account_purpose_guard`, `begin_cash_close`, `finish_cash_close`, fonctions `..._for_session`), `0037_psp_configurations.sql` (`activate_psp_configuration`, `open_psp_accounts`, `secret_ref`, `psp_webhook_context`), `0038_psp_topups.sql` (`complete_card_topup`, `record_chargeback`, `unblock_wallet`, `record_psp_event`, `psp_poll_candidates`, `psp_events_to_retry`, `read_psp_event_body`), `0039` à `0042` (`block_wallet_after_chargeback`, `wallet_block_cause_guard`, `take_deposit_from_balance`, `refund_deposit_from_balance`, ordre des verrous de fermeture).
- Cryptographie et secrets : `apps/api/src/psp/hmac-signature.ts`, `psp/secret.ts`, `psp/fake/fake-notification-signer.ts` (test seulement), `webhooks/webhook-verifier.ts`, `webhooks/webhooks.controller.ts`, `webhooks/webhook-intake.service.ts`, `webhooks/event-dispatcher.ts`, `webhooks/webhook-rejections.ts`, `psp-configurations/` (`secret_ref`, approbation liée à la version).
- Garde de production et processus : `processes/bootstrap.ts`, `psp/psp.providers.ts`, `db/psp-poller-db.module.ts`, `processes/psp-poller.module.ts`.
- Argent : `topups/psp/psp-payment-processor.ts`, `card-checks.ts`, `psp-topup-caller.guard.ts`, `psp-topup-lookup.ts`, `psp-refusals.ts`, `psp-topups.service.ts`, `topups/cash/cash-topup.service.ts`, `cash-sessions/` (comptage à l'aveugle, fermeture, masque), `chargebacks/` (`late-chargeback-action.ts`, `chargeback.service.ts`, `wallet-unblock-action.ts`), `ledger/ledger-engine.service.ts`, `ledger/db/ledger-queries.ts`, `media/lifecycle/counter-access.ts`.

## Suites recommandées (avant la PR)

1. Consigner le constat 1 (OP + ADR + test de borne pgTAP + reports PROMPTS/PRD, question au porteur) : lève le bloquant.
2. Consigner le constat 2 et ajouter un contrôle du propriétaire (ou une garde fermée).
3. Reformuler OP-N83/ADR-134 (constat 3), corriger `contracts/psp.md:30`, consigner le 413 (constat 4), tests de borne d'OP-N85.
4. Confirmer NFR-010 par la CI de la PR ; document Word ; retrospective (`spec-kitty retrospect summary`, puis `spec-kitty agent retrospect synthesize --mission recharges-caisses-psp-01M5YEBA`, à blanc).

## Retrospective Reminder

`kitty-specs/recharges-caisses-psp-01M5YEBA/retrospective.yaml` existe (écrit à la fusion). Pour la suite : `spec-kitty retrospect summary` puis `spec-kitty agent retrospect synthesize --mission recharges-caisses-psp-01M5YEBA` (dry-run).
