# WP14 — tableau des preuves (T073) et fichiers à faire relire par une personne (T074)

Mission `recharges-caisses-psp-01M5YEBA`, lot WP14, 29/10/2026. Format : critère · preuve (fichier : cas) · commande et
résultat. Commande type : `cd apps/api; export PGDATABASE=cashless_wp14; source ../../tools/dev-db/env.sh;
SKIP_LATENCY=1 npx jest <chemin> --runInBand --forceExit` (Jest) ; `pg_prove -d cashless_wp14 <fichier>` après `reset-db`
(pgTAP). Résultat des preuves du lot : 84 suites Jest vertes (unit, end-to-end du lot, topups, cash-sessions), 32 suites
vertes (webhooks, chargebacks, psp-configurations, media), 946 assertions pgTAP vertes (7 suites de la mission).

**Critères sans preuve complète (constats à remonter) : voir le compte rendu** — NFR-008 (fermeture et recharges
espèces simultanées par HTTP : interblocages `40P01`) ; CORRIGÉ en cycle 2 (migration 0040, `it.failing` -> `it`).

| Critère | Preuve | Commande, résultat |
|---|---|---|
| FR-001 | cash-sessions/open-count.spec.ts ; tests_cash_sessions.sql ; topup-journey.spec.ts étape 3 | Jest/pgTAP verts |
| FR-002 | cash-sessions/blind-count.spec.ts ; topup-journey étapes 3 et 7 (théorique `null`) ; topup-isolation « A27 » | verts |
| FR-003 | cash-sessions/close.spec.ts ; close-concurrency.spec.ts ; topup-journey étape 7 (fermeur qui a compté : 403) | verts |
| FR-004 | topups/cash-desk-guard.spec.ts ; tests_cash_sessions.sql (garde de caisse) ; topup-journey étape 2 `SC-002 : OP-N49 levé` | verts |
| FR-005 | topups/cash-topup.spec.ts, cash-topup-refusals.spec.ts ; engine/topup-cash-split.spec.ts ; topup-journey étape 3 | verts |
| FR-006 | engine/topup-cash-split.spec.ts ; media/cash-due.spec.ts | verts |
| FR-007 | topups/psp-deposit.spec.ts ; webhooks/retry.spec.ts (A33) ; cash-topup.spec.ts | verts |
| FR-008 | topups/cash-desk-guard.spec.ts (takeDeposit, refundDeposit, refundCashDue, createCashTopup) ; media/release.spec.ts | verts |
| FR-009 | psp-configurations/configurations.spec.ts, configuration-action.spec.ts ; topup-journey étape 1 | verts |
| FR-010 | psp-configurations/configurations.spec.ts ; tests_psp_configurations.sql | verts |
| FR-011 | psp-configurations/event-selection.spec.ts, selection-action.spec.ts ; topup-journey étape 1 (202 en LIVE) | verts |
| FR-012 | topups/psp-request.spec.ts ; topup-journey étape 4 | verts |
| FR-013 | topups/psp-read-cancel.spec.ts ; psp-request.spec.ts | verts |
| FR-014 | webhooks/verifier.spec.ts, receive.spec.ts ; unit/psp/hmac-signature.spec.ts | verts |
| FR-015 | webhooks/rejections.spec.ts ; topup-secrets.spec.ts (empreintes au journal) | verts |
| FR-016 | topups/psp-process.spec.ts ; webhooks/receive.spec.ts ; psp-concurrency.spec.ts (100 rejeux) ; topup-journey étape 4 | verts |
| FR-017 | topups/psp-process.spec.ts (montant, devise, configuration) | verts |
| FR-018 | topups/psp-process.spec.ts, psp-card.spec.ts ; topup-journey étape 5 (SC-004) | verts |
| FR-019 | topups/poller-status.spec.ts, poller-expiry.spec.ts, poller-alarm.spec.ts ; topup-journey (succès jamais notifié) | verts |
| FR-020 | unit/psp/fake-psp-adapter.spec.ts, psp-providers.spec.ts | verts |
| FR-021 | reporté (OP-N81, ADR-131) : preuve de borne `production-guard.spec.ts`, `psp-production.spec.ts` | verts |
| FR-022 | unit/psp/fake-secret-store.spec.ts ; tests_psp_configurations.sql (`secret_ref`) ; topup-secrets.spec.ts (42501) | verts |
| FR-023 | psp-configurations/psp-fees.spec.ts ; topups/psp-request.spec.ts (frais estimés) | verts |
| FR-024 | topups/psp-card.spec.ts ; topup-journey étape 5 | verts |
| FR-025 | topups/psp-card.spec.ts ; psp-concurrency.spec.ts (plafond par carte simultané) | verts |
| FR-026 | topups/psp-card.spec.ts (vélocité) | verts |
| FR-027 | chargebacks/chargeback.spec.ts, chargeback-concurrency.spec.ts, late-chargeback.spec.ts ; psp-concurrency (20 DISPUTE) ; topup-journey étape 6 | verts |
| FR-028 | chargebacks/wallet-unblock.spec.ts (dont 0039) ; tests_psp_topups.sql ; topup-journey étape 6 | verts |
| FR-029 | cash-sessions/cash-deposit.spec.ts ; topup-journey étape 7 | verts |
| FR-030 | contracts : `npm run check -w @cashless/contracts` (WP01) ; topup-isolation « garde du contrat » (19 opérations lues dans `openapi.yaml`) | verts |
| FR-031 | audits vérifiés dans chaque suite du lot (`PSP_TOPUP_REQUESTED`, `CASH_DEPOSIT_REQUESTED`, `WALLET_UNBLOCKED`…) ; retry.spec.ts (contestation introuvable) | verts |
| NFR-001 | psp-concurrency.spec.ts (100 rejeux, 100 identifiants, 20 DISPUTE) ; topups/psp-concurrency.spec.ts | verts |
| NFR-002 | webhooks/rejections.spec.ts, verifier.spec.ts ; topup-secrets.spec.ts (refus 401/404 sans écriture) | verts |
| NFR-003 | topup-secrets.spec.ts (canari, 4 cas) | verts |
| NFR-004 | psp-production.spec.ts (a, b, c) ; unit/production-guard.spec.ts | verts |
| NFR-005 | topup-isolation.spec.ts (19 opérations, 10 tables) ; psp-configurations/isolation.spec.ts | verts |
| NFR-006 | topup-latency.spec.ts : p95 82 ms (seuil 500), p99 92 ms, max 95 ms, local Docker | vert |
| NFR-007 | cash-sessions/close.spec.ts ; topup-journey étape 8 (CASH_CLOSE) | verts |
| NFR-008 | close-concurrency.spec.ts ; psp-concurrency.spec.ts ; cash-concurrency.spec.ts (3 cas verts depuis la migration 0040, 6 passes de suite) | vert (cycle 2) |
| NFR-009 | topup-latency.spec.ts : p95 73 ms (seuil 200), p99 80 ms, max 86 ms | vert |
| NFR-010 | pgTAP 946 assertions (7 suites mission) ; Jest lot 84 + 32 suites ; batterie complète : orchestrateur | à rejouer en série |
| C-001 | contradictions signalées : CL039 (ADR-135), tâches WP14 | revue |
| C-002 | `bash packages/ledger-sql/scripts/check-generated.sh` : « suites pgTAP à jour » ; aucune migration générée modifiée | vert |
| C-003 | aucune dépendance ajoutée (`git diff main -- package.json package-lock.json` vide) | revue |
| C-004 | tests_cash_psp_rights.sql, tests_execute_grants.sql ; `cashless_app` : INSERT/UPDATE/DELETE directs refusés | verts |
| C-005 | aucun nouveau secret dans `loadConfig` (revue de `config.ts`) | revue |
| C-006 | = NFR-004 | verts |
| C-007 | OP-N81 à OP-N85, ADR-131 à ADR-135 ; reports PROMPTS/PRD ; tests de borne | revue |
| C-008 | aucune route de rapprochement, de versement, d'identification ; reports mission 9 et 10 | revue |
| C-009 | topups/psp-process.spec.ts (clés `wave:`/`om:`/`psp:`) ; psp-concurrency.spec.ts ; poller-status.spec.ts | verts |
| C-010 | tests_psp_topups.sql, cash-topup.spec.ts (source `ONLINE`/`PSP_WEBHOOK`) ; aucun chemin hors ligne PSP | revue |
| SC-001 | topup-journey.spec.ts (9 cas) | vert |
| SC-002 | topup-journey étape 2 `SC-002 : OP-N49 levé` ; topups/cash-desk-guard.spec.ts | verts |
| SC-003 | psp-concurrency.spec.ts, cash-concurrency.spec.ts, topups/psp-concurrency.spec.ts | verts (sauf NFR-008 ci-dessus) |
| SC-004 | topup-journey étape 5 ; topups/psp-process.spec.ts | verts |
| SC-005 | topup-journey étapes 3, 7, 8 ; blind-count.spec.ts ; topup-isolation « A27 » | verts |
| SC-006 | topup-secrets.spec.ts | vert |
| SC-007 | topup-isolation.spec.ts | vert |
| SC-008 | psp-production.spec.ts | vert |

## T074 — fichiers à faire relire par une personne (l'agent qui a écrit le code ne vaut pas relecture indépendante)

- `packages/ledger-sql/migrations/0036_cash_sessions.sql` : `posting_cash_desk_guard`, `account_purpose_guard`,
  `begin_cash_close` / `finish_cash_close`, fonctions `..._for_session` (garde d'argent liquide, verrous).
- `0037_psp_configurations.sql` : `activate_psp_configuration`, titulaire des fonds, `secret_ref`, `open_psp_accounts`
  (`SECURITY DEFINER`, décision du porteur du 27/10/2026).
- `0038_psp_topups.sql` : `complete_card_topup` et son verrou consultatif, `record_chargeback`, `unblock_wallet`,
  `record_psp_event`. **`0039_chargeback_block_cause.sql`** : `block_wallet_after_chargeback` (correction de WP14).
- `packages/ledger-sql/post-roles.sql` : droits par colonne et par fonction (l'octroi `[A8-DETTE]` est retiré en cycle 2, OP-N84 levé).
- `apps/api/src/webhooks/webhook-verifier.ts`, `webhooks.controller.ts`, `webhook-intake.service.ts`,
  `event-dispatcher.ts` (cryptographie, route sans identité, contestation introuvable).
- `apps/api/src/psp/` (ports, coffre, comparaison à temps constant, échéance du secret précédent).
- `apps/api/src/processes/bootstrap.ts` (`assertProcessIsSafe`).
- `apps/api/src/topups/psp/` : `psp-payment-processor.ts`, `card-checks.ts`, `psp-topup-caller.guard.ts`,
  `psp-topup-lookup.ts`, `psp-refusals.ts`, `psp-topups.service.ts` (argent, 3-D Secure, authentification composée,
  découpage en temps courts et `IdempotentTx` final).
- `apps/api/src/chargebacks/` : `late-chargeback-action.ts`, `chargeback.service.ts` (`post`), `wallet-unblock-action.ts`.
- `apps/api/src/psp-configurations/` (`secret_ref`, approbation liée à la version).
- `apps/api/src/cash-sessions/` (comptage à l'aveugle, fermeture, masque de `cash_diff_anomaly_id`).
- `apps/api/src/ledger/ledger-engine.service.ts` (découpage hors ligne) et `configuration/sql-config-resolver.ts` (frais).
