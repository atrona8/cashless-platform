---

work_package_id: WP09

title: Recharge espÃ¨ces et guichet des bracelets

dependencies: [WP08]

requirement_refs: [FR-004, FR-005, FR-007, FR-008, NFR-009]

planning_base_branch: feat/recharges-caisses-psp

merge_target_branch: feat/recharges-caisses-psp

branch_strategy: Planning artifacts for this mission were generated on feat/recharges-caisses-psp. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/recharges-caisses-psp unless the human explicitly redirects the landing branch.

base_branch: kitty/mission-recharges-caisses-psp-01M5YEBA

base_commit: a17b59de48cccdec7f2c81c1df7193122004e207

created_at: '2026-10-28T13:29:13.837193+00:00'

subtasks: [T043, T044, T045, T046, T047, T048]

phase: Phase 3 - Caisses et espÃ¨ces

agent: claude

history:

- timestamp: '2026-10-27T15:00:00Z'

  agent: claude

  action: Prompt generated via /spec-kitty.tasks

agent_profile: implementer-ivan

authoritative_surface: apps/api/

create_intent: [apps/api/src/topups/cash/cash-topup.module.ts, apps/api/src/topups/cash/cash-topup.controller.ts, apps/api/src/topups/cash/cash-topup.service.ts, apps/api/src/topups/cash/cash-topup.dto.ts, apps/api/test/integration/topups/cash-topup.spec.ts, apps/api/test/integration/topups/cash-topup-refusals.spec.ts, apps/api/test/integration/topups/cash-desk-guard.spec.ts, apps/api/test/integration/end-to-end/device-auth-cases/cash-topup.cases.ts]

execution_mode: code_change

model: sonnet

owned_files: [apps/api/src/topups/cash/**, apps/api/src/media/lifecycle/**, apps/api/test/integration/topups/cash-*.spec.ts, apps/api/test/integration/media/deposit.spec.ts, apps/api/test/integration/media/cash-due.spec.ts, apps/api/test/integration/media/release.spec.ts, apps/api/test/integration/end-to-end/device-auth-cases/cash-topup.cases.ts]

role: implementer

tags: []

tracker_refs: []

---



# Work Package Prompt: WP09 â€“ Recharge espÃ¨ces et guichet des bracelets



## âš¡ Do This First: Load Agent Profile



Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :

implementer / Agent : claude). Lis ensuite la fiche de contexte d'implÃ©mentation fournie par

l'orchestrateur, ce prompt, puis seulement, dans `kitty-specs/recharges-caisses-psp-01M5YEBA/` :

`spec.md` (FR-004 Ã  FR-008, NFR-009, C-010), `plan.md` (IC-02, IC-03), `research.md` (R-01, R-02,

R-05, R-06 et **R-20, section Â« Caisses Â», qui fait foi**), `research-adversarial.md` (A8, A17, A27,

A33), `data-model.md` (`cash_session`, `cash_desk`, `cash_session_tx`), `contracts/cash.md` (rÃ¨gles

2, 3, 7, 8) et `contracts/openapi-additions.md` (lignes `takeDeposit`, `refundCashDue`,

`releaseMedia`). Code de rÃ©fÃ©rence : `apps/api/src/media/lifecycle/counter-access.ts`,

`deposit.controller.ts`, `deposit.service.ts` (`takeDueDeposit`), `cash-due.controller.ts`,

`cash-due.service.ts`, `release.service.ts`, `lifecycle.dto.ts` (rÃ¨gle `cash_due.no_session`),

`apps/api/src/ledger/ledger-engine.service.ts` (`delegate`) et `ledger/db/ledger-queries.ts`

(`takeDeposit`), `apps/api/src/payments/device-seq-registry.ts`,

`apps/api/src/idempotency/device-key.ts`. LivrÃ©s par les lots prÃ©cÃ©dents :

`packages/ledger-sql/migrations/0036_cash_sessions.sql` (WP02 : signatures exactes de

`open_cash_session`, `attach_cash_tx`, `take_deposit_for_session`, `refund_deposit_for_session`,

`refund_cash_due_for_session`), le moteur corrigÃ© (WP06), les routes de session (WP08),

`post-roles.sql` (WP05).



RÃ¨gle Â§0.3 : en cas de contradiction entre sources, applique la prioritÃ© (tests exÃ©cutables > schÃ©ma

SQL, `openapi.yaml`, `sync_protocol.md` > SPECIFICATION > `PRD.md`) et **signale-la**. Ne modifie

jamais un `.sql` gÃ©nÃ©rÃ© de `packages/ledger-sql/` ; ce lot ne touche Ã  aucun fichier SQL.



## Objective



Servir `createCashTopup` (`POST /topups/cash`) : un `TOPUP_CASH` en ligne rattachÃ© Ã  la session

ouverte du terminal. Faire passer la caution en espÃ¨ces, le rendu des espÃ¨ces dues et la libÃ©ration

par la session (variantes `â€¦_for_session` de la base), de sorte que **aucune route ne passe plus de

compte de caisse** (FR-008, A8). Prendre la caution due aprÃ¨s chaque crÃ©dit payÃ© (FR-007). Lever

OP-N49 : les tests de la mission 4 ouvrent une vraie session.



## Context



- Exigences : voir frontmatter. IC-02 (routes) et IC-03 (le moteur est dÃ©jÃ  corrigÃ© par WP06 :

  dÃ©coupage rÃ©servÃ© au hors ligne ; ici, en ligne, la base refuse au-delÃ  du plafond

  `CL008`/`CL009`, dÃ©jÃ  traduits en `422 WALLET_LIMIT_EXCEEDED` / `MONTHLY_TOPUP_LIMIT_EXCEEDED`

  dans `errors/sqlstate-map.ts`).

- Garde de caisse (WP02) : tout compte inscrit dans `cash_desk` n'accepte une Ã©criture que sous une

  session `OPEN` du mÃªme terminal. Cette garde est le filet ; l'API doit refuser **avant** d'Ã©crire,

  avec le `409 CONFLICT_STATE` d'ADR-89 (contrat : `CASH_SESSION_REQUIRED` n'est pas crÃ©Ã©).

- Ã‰tat actuel Ã  remplacer : `CounterActor.cashDeskCode` est cherchÃ© par `a.code = 'A-CAISSE-' ||

  d.serial`, et les services passent ce code au moteur (`moneyAccount`) ; `cash-due.controller.ts`

  refuse tout `cash_session_id` (`cash_due.no_session`). AprÃ¨s ce lot, la **session** est la source

  ; `cashDeskCode` ne sert plus qu'Ã  l'affichage.

- Ce qui en dÃ©pend : WP11 (caution due aprÃ¨s un crÃ©dit PSP) rÃ©utilise `DepositService` ; WP14

  (parcours de bout en bout et latence) rÃ©utilise `POST /topups/cash`.



**RÃ¨gle de sÃ©curitÃ© du projet (`CLAUDE.md`, rÃ¨gle 1)** : si un point de ce lot ne peut Ãªtre tenu

qu'en affaiblissant la sÃ©curitÃ© (droit plus large, contrÃ´le retirÃ© ou reportÃ©, secret plus exposÃ©,

faux gardÃ© plus longtemps que prÃ©vu), **arrÃªte-toi sur ce point et soumets-le au porteur avant de

coder** (risque, options), continue le reste. Un renforcement se fait, puis se consigne. Aucun faux

en production. Aucune nouvelle dÃ©pendance npm (R-18).



## Arbitrages de l'orchestrateur (27/10/2026)



Tous dans le sens le plus strict ou de pure rÃ©partition ; ils priment sur le texte ci-dessus en cas

de doute.



- **La session dÃ©cide de la caisse.** Aucune route n'accepte ni ne transmet un compte de caisse.

  `cash_session_id` facultatif dans les corps : s'il est prÃ©sent, il doit Ãªtre la session `OPEN` du

  terminal (sinon `409 CONFLICT_STATE`, rÃ¨gle propre `cash.session_mismatch`) ; il est toujours

  renvoyÃ© dans la rÃ©ponse (FR-008).

- **Caution et espÃ¨ces dues : variantes `â€¦_for_session`** (R-20, A8). Plus aucun appel Ã 

  `take_deposit`, `refund_deposit` ni `refund_cash_due` avec un compte de caisse depuis

  `media/lifecycle/`.

- **Caution due : transaction distincte, aprÃ¨s validation** (R-06). Comme l'intercepteur

  d'idempotence enregistre puis renvoie la rÃ©ponse produite dans la transaction du crÃ©dit (la valeur

  rendue par le contrÃ´leur aprÃ¨s `tx.run` n'est pas envoyÃ©e), le champ `deposit` de la rÃ©ponse de

  `createCashTopup` porte l'Ã©tat lu **dans** la transaction du crÃ©dit (`DUE` avec son montant, ou

  `null` s'il n'y a rien Ã  prendre), pas le rÃ©sultat de la prise qui suit. Ã‰cart de lecture au

  contrat (Â« rÃ©sultat dans `deposit` Â») : Ã  signaler au compte rendu. Ne pas prendre la caution dans

  la transaction du crÃ©dit pour contourner (un Ã©chec de caution ne doit jamais annuler le crÃ©dit).

- **Rejeu de la mÃªme clÃ©** : la rÃ©ponse enregistrÃ©e est servie par l'intercepteur sans atteindre le

  contrÃ´leur ; la reprise de la caution (A33) y est donc impossible. Elle a lieu au crÃ©dit suivant

  et par WP12 pour le chemin PSP. Le consigner, ne pas bricoler l'intercepteur (hors carte).

- **Une seule recherche de session par requÃªte** : elle est ajoutÃ©e Ã  la requÃªte existante de

  `CounterAccess.authorize` (sous-requÃªte), pas en aller-retour supplÃ©mentaire (NFR-009).

- **Un compte `CASH_DESK` n'est jamais lu ni rendu Ã  un `CASHIER`** (A27) : aucune rÃ©ponse de ce lot

  ne porte le solde ou le thÃ©orique de la caisse.



- **`AuditAction` (rÃ¨gle commune de `tasks.md`)** : ce lot ajoute une valeur, `CASH_TOPUP`, Ã 

  l'union de `apps/api/src/audit/audit.service.ts` (retouche hors carte d'une ligne, en fin

  d'union ; l'orchestrateur rÃ©sout les conflits de fusion avec WP08). Les valeurs `MEDIA_*`

  existent dÃ©jÃ .

- **Matrice d'authentification des terminaux** : `createCashTopup` gagne `staffBearer` (WP01) donc

  la route est modifiÃ©e : ajoute ses cas dans

  `apps/api/test/integration/end-to-end/device-auth-cases/cash-topup.cases.ts` (nouveau, dans la

  carte du lot ; modÃ¨le : `payments.cases.ts` du mÃªme dossier, enregistrÃ© par `registry.ts` sans

  index). Les routes de caution et d'espÃ¨ces dues existantes gardent leurs cas ; ajoute ceux dont

  l'attente change (session obligatoire).

- **Garde** : `TerminalOrPersonGuard` est crÃ©Ã©e par WP08 (pas ici).

- **Ajouts du 27/10 (relectures de WP02 et WP06)** :

  - `source` de la commande `TOPUP_CASH` fixÃ©e par le serveur (`ONLINE` sur ces routes), jamais lue

    dans le corps ; test : un corps qui porte `source: OFFLINE_SYNC` ou `headroom` n'obtient aucun

    dÃ©coupage.

  - Portefeuille et `mediaId` cohÃ©rents : le portefeuille crÃ©ditÃ© est dÃ©duit du bracelet (attribution

    ouverte), jamais pris sÃ©parÃ©ment ; test : bracelet d'un portefeuille et `wallet_id` d'un autre

    du mÃªme grand livre â†’ refus avant Ã©criture (`open_cash_due_anomaly` ne contrÃ´le que le grand

    livre).

  - RÃ´le de l'acteur sur l'Ã©vÃ©nement de la session contrÃ´lÃ© cÃ´tÃ© API pour les variantes

    `â€¦_for_session`, `attach_cash_tx` et `refund_cash_due` (la base ne le fait pas).

  - Rattachement Ã  la session prouvÃ© pour chaque recharge en espÃ¨ces (le test 147 de 0036 est

    descriptif).

  - Ajoute `createCashTopup` Ã  `device-auth-matrix.spec.ts` (relecture de WP01).



## Branch Strategy



Planification et fusion sur `feat/recharges-caisses-psp`. DÃ©pendance : WP08 (et, par lui, WP01,

WP05, WP06, WP07). Le worktree est attribuÃ© par lane d'aprÃ¨s `lanes.json`. Commande : `spec-kitty

agent action implement WP09 --agent claude --mission recharges-caisses-psp-01M5YEBA`.



Retouches hors carte autorisÃ©es, chacune consignÃ©e en une ligne au compte rendu :

`apps/api/src/app.module.ts` (**une ligne** : import de `CashTopupModule`) ;

`apps/api/src/errors/sqlstate-map.ts` (un code s'il manque) ;

`apps/api/test/support/media-fixtures.ts` (nouveau helper de session, voir T047) ; les specs de la

mission 4 non possÃ©dÃ©es qui cassent par ce lot : `test/integration/media/replace.spec.ts`,

`test/integration/end-to-end/media-journey.spec.ts`, `media-isolation.spec.ts` (T047) ; et la

retouche du moteur dÃ©crite en T045 (â‰¤ 15 lignes : `ledger/db/ledger-queries.ts` et le cas

`take_deposit`/`refund_deposit` de `ledger-engine.service.ts`). Si la retouche du moteur dÃ©passe 15

lignes, arrÃªte-toi et demande.



## Subtasks



### T043 â€” `counter-access.ts` : session ouverte du terminal



But : que toute route de guichet connaisse la session ouverte du terminal sans requÃªte de plus.



1. `CounterActor` gagne `cashSession: { id: string; accountId: string; code: string } | null`.

   `cashDeskCode` reste (recherche par sÃ©rie inchangÃ©e, R-01) mais n'est plus passÃ© aux services

   d'Ã©criture.

2. Dans `CounterAccess.authorize`, ajoute Ã  la requÃªte existante une sous-requÃªte `(SELECT s.id FROM

   cash_session s WHERE s.device_id = d.id AND s.status = 'OPEN')` et le compte

   (`s.cash_account_id`, `a.code`). Une session `CLOSING` n'est **pas** ouverte : aucune Ã©criture

   d'espÃ¨ces.

3. Nouvelle fonction exportÃ©e `requireCashSession(actor, language, provided?: string | null)` :

   retourne la session ; `null` â†’ `conflict(...)` avec le message d'ADR-89 dÃ©jÃ  prÃ©sent dans

   `deposit.service.ts` (Â« Aucune caisse ouverte pour ce terminalâ€¦ Â») ; `provided` diffÃ©rent de

   `actor.cashSession.id` â†’ rÃ¨gle `cash.session_mismatch` (`counterRefusal(..., 'CONFLICT_STATE',

   409)`), Ã  ajouter Ã  `RULES` de `lifecycle.dto.ts` en franÃ§ais et en anglais. Supprime la rÃ¨gle

   `cash_due.no_session` (plus utilisÃ©e).

4. `parseCashSessionId(body)` dans `lifecycle.dto.ts` : champ facultatif, UUID sinon `422

   VALIDATION_FAILED` (reprendre `isUuid`, `invalid` de `platform.dto`).

5. Le mode d'application n'est **pas** contrÃ´lÃ© ici (les routes de caution servent aussi d'autres

   modes) ; le contrÃ´le `TOPUP_DESK` est propre Ã  la recharge (T044).



Validation :

- [ ] aucune requÃªte SQL ajoutÃ©e par route de guichet (la session vient de la requÃªte existante) ;

- [ ] session `CLOSING` ou `CLOSED` â†’ `cashSession = null` ;

- [ ] tests unitaires ou d'intÃ©gration de `requireCashSession` (null, autre session, bonne session).



### T044 â€” Recharge en espÃ¨ces `createCashTopup`



Fichiers : `topups/cash/cash-topup.{module,controller,service,dto}.ts`.



1. Route `POST /topups/cash`, `@HttpCode(201)`, `@CounterAuth()` (terminal ET personne

   `CASHIER`/`SUPERVISOR`, `X-Staff-Authorization`), `@Idempotent({ scope: deviceScope, deviceSeq:

   true })` : `Idempotency-Key = <sÃ©rie>:<seq>` contrÃ´lÃ© avant la rÃ©servation (`parseDeviceKey`,

   `422` si la sÃ©rie n'est pas celle du terminal).

2. DTO (`cash-topup.dto.ts`) : `amount` entier > 0 lu en `bigint` (`amountField`) ; `currency` =

   devise de l'Ã©vÃ©nement (sinon `422 VALIDATION_FAILED`) ; `occurred_at` requis par le contrat mais

   **ignorÃ© pour l'Ã©criture** : l'heure est celle de la base (`clock_timestamp()`), l'heure reÃ§ue va

   en `metadata.device_occurred_at` ; `tap` (lecture embarquÃ©e) ou `tap_id`, exactement un des deux

   (reprendre `parseTap` / la rÃ¨gle de `cash-due.controller.ts`) ; `cash_tendered` informatif

   (entier â‰¥ 0, â‰¥ `amount` s'il est donnÃ©, jamais Ã©crit au grand livre) ; `cash_session_id`

   facultatif (T043) ; tout autre champ â†’ `422`.

3. Dans **une** transaction (`tx.run`), dans cet ordre : a. prise du terminal en tÃªte : `SELECT 1

   FROM device WHERE id = $1 FOR UPDATE` (ordre global des verrous de la 5b : terminal d'abord) ; b.

   `CounterAccess.authorize` ; `assertDeviceMode(actor.device, ['TOPUP_DESK'])` (`422

   DEVICE_MODE_NOT_ALLOWED`) ; c. `requireCashSession(actor, language, body.cash_session_id)` â€”

   **avant toute Ã©criture** ; d. lecture : `TapService.registerOrRefuse` (embarquÃ©e) ou

   `TapService.byId` ; bracelet visible de l'organisateur (`lockCounterMedia`, `FOR UPDATE`), statut

   `ACTIVE` sinon `409 MEDIA_STATE_INVALID` (rÃ¨gle existante `cash_due.media_blocked`), portefeuille

   du bracelet (`media.wallet_id`) ; bracelet sans portefeuille â†’ refus `MEDIA_NOT_ACTIVATED` (code

   existant) ; e. `debit_authority = EDGE` : **permis** (une recharge est un crÃ©dit, contrat) ; ne

   pas lever `DEBIT_AUTHORITY_EDGE` ici ; f. `engine.execute(client, { type: 'TOPUP_CASH', source:

   'ONLINE', idempotencyKey: <Idempotency-Key>, occurredAt: <heure base>, ledgerId, eventId,

   currency, deviceId, mediaId, createdBy: actor.userId, payload: { walletId, cashDesk: <sÃ©rie du

   terminal>, amount }, metadata: { cash_session_id, device_occurred_at } })`. `cashDesk` est la

   **sÃ©rie** (`buildTopupCash` prÃ©fixe `A-CAISSE-`) : la prendre de `actor.cashSession.code` sans le

   prÃ©fixe, jamais d'un champ du corps ; g. `SELECT attach_cash_tx($1, $2)` (session, transaction)

   dans la mÃªme transaction ; signature lue dans 0036 ; h. `TapService.consume` si une lecture a Ã©tÃ©

   prÃ©sentÃ©e ; i. relire les soldes (`spendable`, `paid`, `promo`) comme `TapService.register` et

   l'Ã©tat de caution (T046) ; j. `audit.record` : action `CASH_TOPUP`, objet `journal_transaction`,

   `after` = montant, session, terminal ; jamais de solde de caisse.

4. RÃ©ponse `201` conforme Ã  `TopupResult` : `transaction_id`, `idempotency_key`, `type:

   'TOPUP_CASH'`, `status: 'SUCCEEDED'`, `amount`, `currency`, `wallet_id`, `balance_after`,

   `deposit`, plus `cash_session_id` (FR-008). Montants en nombre (`Number(bigint)`) comme

   `deposit.service.ts`.

5. Registre des numÃ©ros : lis `docs/sync_protocol.md` Â§3.2 et Â§3.3 et `DeviceSeqRegistry` (exportÃ©

   par `PaymentsModule`). Si `TOPUP_CASH` y est un type chaÃ®nÃ©, enregistre la rÃ©ussite dans la

   transaction (`accept`, canal `ONLINE`) et les refus dÃ©finitifs en transaction sÃ©parÃ©e (`reject`),

   avec un `content_sha256` calculÃ© par `contentSha256` sur `seq`, `type`, `occurred_at`, `amount`,

   `currency`, `tap` / `tap_id` ; sinon n'en enregistre pas. Dans les deux cas **signale ton choix**

   (la mission 7 devra aligner les lots hors ligne).

6. Refus : `catch (e) { return this.taps.settleRefusal(e, requestDevice(req), tap) }` comme les

   routes de caution. Plafond dÃ©passÃ© : `422 WALLET_LIMIT_EXCEEDED` ou

   `MONTHLY_TOPUP_LIMIT_EXCEEDED`, **rien d'Ã©crit** (la transaction est annulÃ©e, y compris le

   rattachement).

7. Import du module dans `app.module.ts` (une ligne). `CashTopupModule` importe `LifecycleModule`,

   `TapsModule`, `PaymentsModule`, `ConfigResolverModule`, `TenantModule` (ce qu'il utilise, rien de

   plus).



Cas limites : montant 0 ou nÃ©gatif ; devise Ã©trangÃ¨re ; terminal d'un autre mode ; session d'un

autre terminal du mÃªme Ã©vÃ©nement (`409`) ; bracelet d'un autre organisateur (`404`) ; bracelet

`BLOCKED` (`409`) ; lecture dÃ©jÃ  consommÃ©e (`409 TAP_UNUSABLE`) ; deux recharges simultanÃ©es du mÃªme

portefeuille (verrous du moteur, une seule passe si la marge ne suffit pas Ã  deux).



Validation :

- [ ] aucun champ du corps ne dÃ©signe un compte de caisse ni n'est reflÃ©tÃ© avec un solde de caisse ;

- [ ] la refus Â« pas de session Â» arrive avant toute Ã©criture et avant la consommation de la lecture

      ;

- [ ] `TOPUP_CASH` du jour Ã©crit en source `ONLINE`, jamais dÃ©coupÃ© (pas de `L-ESP-A-RENDRE`, pas

      d'anomalie).



### T045 â€” Caution, espÃ¨ces dues, libÃ©ration par la session



1. **Retouche du moteur (â‰¤ 15 lignes, consignÃ©e).** Ajouter `cashSessionId?: string` Ã 

   `DelegatedPayload` (`ledger-engine.service.ts`) ; dans `ledger/db/ledger-queries.ts`,

   `takeDeposit(client, mediaId, session)` et `refundDeposit(client, mediaId, session)` appellent

   `take_deposit_for_session` / `refund_deposit_for_session` quand `session` est donnÃ© (compte

   `null` : caution `FROM_BALANCE`, inchangÃ©e). Le cas `moneyAccount` n'existe plus pour les

   cautions d'espÃ¨ces : le retirer pour Ã©viter qu'un appelant repasse un compte (test de la

   non-rÃ©gression en T048).

2. `deposit.service.ts` : `DepositContext.cashDeskCode` est remplacÃ© par `cashSessionId: string |

   null`. `moneyAccount` devient `cashSession(context, row, payment)` : mode `SEPARATE` et

   `payment.method = 'CASH'` exigent une session (`requireCashSession`), sinon `409` ; paiement

   autre que `CASH` â†’ rÃ¨gle existante `deposit.cash_only`. La prise comme le rendu passent `payload:

   { cashSessionId }`.

3. `deposit.controller.ts` : lire `cash_session_id` (T043), l'envoyer au service, le **renvoyer**

   dans la rÃ©ponse (`DepositState` + `cash_session_id` si fourni ou si la session a servi).

   `activation.service.ts` (caution prise Ã  l'activation, `cashDeskCode: actor.cashDeskCode`) passe

   la session de la mÃªme faÃ§on.

4. `cash-due.service.ts` : remplacer la recherche de `cash_account` par la session ; appeler

   `refund_cash_due_for_session` (mÃªmes autres paramÃ¨tres que `refund_cash_due`, voir 0036) ; garder

   les contrÃ´les non faits par la base (bracelet `ACTIVE`, grand livre de l'Ã©vÃ©nement du terminal).

   La rÃ©ponse `{ transaction_id, ..., approved_by }` gagne `cash_session_id`. Retirer le refus de

   `cash_session_id` dans `cash-due.controller.ts`.

5. `release.controller.ts` / `release.service.ts` : accepter `cash_session_id` (T043) et le renvoyer

   dans le rÃ©sultat de libÃ©ration. La libÃ©ration n'Ã©crit aucune espÃ¨ce (`cash_to_hand_back: 0`,

   enchaÃ®nements refusÃ©s, inchangÃ©) : ne **pas** inventer de rendu ; si une session est fournie,

   elle est seulement validÃ©e (session ouverte du terminal) et renvoyÃ©e.

6. Audit : les actions existantes (`MEDIA_DEPOSIT_TAKEN`, `MEDIA_DEPOSIT_REFUNDED`,

   `MEDIA_CASH_DUE_REFUNDED`) gagnent `cash_session_id` dans `after`.



Validation :

- [ ] `grep -rn "moneyAccount\|cashDeskCode" apps/api/src/media/lifecycle` ne montre plus d'usage

      d'Ã©criture ;

- [ ] caution `SEPARATE` en espÃ¨ces sans session : `409`, rien d'Ã©crit, bracelet inchangÃ© ;

- [ ] caution prise sous la session A, terminal B (mÃªme Ã©vÃ©nement) : refus (garde de la base) ;

- [ ] les routes ne transmettent jamais un code ou un identifiant de compte de caisse.



### T046 â€” Caution due aprÃ¨s chaque crÃ©dit payÃ©



1. `CashTopupService.afterCredit(operatorId, mediaId, audit)` : appelÃ© **aprÃ¨s** `await tx.run(...)`

   dans le contrÃ´leur (la transaction du crÃ©dit est alors validÃ©e), appelle

   `DepositService.takeDueDeposit(operatorId, mediaId, audit)` (transaction distincte,

   `TenantTx.run`). Toute erreur est attrapÃ©e, journalisÃ©e sans donnÃ©e personnelle (identifiants

   seulement : `media_id`, code de problÃ¨me) et n'altÃ¨re ni le statut ni le corps de la rÃ©ponse ; la

   caution reste `DUE`.

2. `takeDueDeposit` ne prend que les cautions `FROM_BALANCE` dues : ajoute la condition

   `deposit_mode = 'FROM_BALANCE'` (une caution `SEPARATE` reste payÃ©e en espÃ¨ces au guichet, R-06)

   et un retour neutre sinon.

3. Nouvelle mÃ©thode `DepositService.takeDueDepositForWallet(operatorId, walletId, audit)` pour WP11

   : retrouve le bracelet `ACTIVE` du portefeuille ayant une caution `DUE` (`media.wallet_id`), puis

   dÃ©lÃ¨gue Ã  `takeDueDeposit`. Aucun bracelet â†’ retour `null`. Idempotente (le moteur ne reprend pas

   une caution `HELD`).

4. L'Ã©tat `deposit` de la rÃ©ponse (arbitrage ci-dessus) est lu dans la transaction du crÃ©dit par

   `DepositService.state`.



Cas limites : crÃ©dit partiel qui ne couvre pas la caution (reste `DUE`, la base ne prend rien) ;

bracelet sans caution (`deposit: null`) ; Ã©chec simulÃ© de la prise (sonde sur le moteur) : crÃ©dit

inchangÃ©, rÃ©ponse `201`.



Validation :

- [ ] un Ã©chec de caution ne change pas le `201` ni le solde crÃ©ditÃ© ;

- [ ] la prise a lieu **aprÃ¨s** le COMMIT (test : lecture concurrente du crÃ©dit visible avant la

      caution).



### T047 â€” Adapter les tests de la mission 4 ; OP-N49 levÃ©



1. `test/support/media-fixtures.ts` (hors carte, consignÃ©) : nouveau helper `openCashSession(db, {

   deviceId, userId })` qui appelle `open_cash_session` de la base et rend `{ sessionId, accountId,

   code }` ; `openCashDesk` reste pour les tests qui n'Ã©crivent pas d'espÃ¨ces. Ne modifie pas la

   signature de `openCashDesk`.

2. `deposit.spec.ts`, `cash-due.spec.ts`, `release.spec.ts` : chaque cas qui Ã©crit des espÃ¨ces ouvre

   d'abord une session ; ajouter les cas : sans session `409` ; `cash_session_id` d'une autre

   session `409` ; `cash_session_id` renvoyÃ© ; terminal sans session n'a crÃ©Ã© aucun compte

   `CASH_DESK` (le cas existant Â« terminal sans caisse ouverte Â» est conservÃ© et renforcÃ©).

3. `replace.spec.ts`, `media-journey.spec.ts`, `media-isolation.spec.ts` (hors carte, consignÃ©) :

   seul changement nÃ©cessaire pour qu'elles restent vertes (session ouverte avant les espÃ¨ces).

4. Le texte Â« cette mission ne crÃ©e aucun compte de caisse Â» (dÃ©cision nÂ° 10) des commentaires de

   `deposit.service.ts` et `counter-access.ts` est mis Ã  jour : la mission des caisses l'a levÃ©.



Validation :

- [ ] `npx jest apps/api/test/integration/media` vert, ainsi que les deux parcours de bout en bout

      touchÃ©s ;

- [ ] aucune assertion existante affaiblie : toute assertion modifiÃ©e est justifiÃ©e au compte rendu.



### T048 â€” Tests d'intÃ©gration du guichet



Fichiers : `test/integration/topups/cash-topup.spec.ts`, `cash-topup-refusals.spec.ts`,

`cash-desk-guard.spec.ts`. Harnais : reprendre celui de `test/integration/media/deposit.spec.ts`

(HTTPS avec le terminal de test, vraie base).



- `cash-topup.spec.ts` : recharge rÃ©ussie (`TOPUP_CASH`, source `ONLINE`, lignes

  caisse/portefeuille, rattachÃ©e Ã  la session : ligne dans `cash_session_tx`) ; rejeu de la mÃªme clÃ©

  â†’ mÃªme rÃ©ponse, `Idempotency-Replayed`, une seule Ã©criture ; `cash_session_id` renvoyÃ© ; caution

  `FROM_BALANCE` due prise aprÃ¨s le crÃ©dit (Ã©tat `HELD`, deux transactions distinctes) ; Ã©chec de la

  caution laisse le crÃ©dit ; recharge sur grand livre `EDGE` permise.

- `cash-topup-refusals.spec.ts` : sans session ; session d'un autre terminal ; session fermÃ©e

  (`CLOSING`) ; plafond de solde et plafond mensuel (`422`, **rien d'Ã©crit** : zÃ©ro ligne

  `journal_transaction`, `posting`, `cash_session_tx`, lecture non consommÃ©e) ; mode autre que

  `TOPUP_DESK` ; rÃ´le insuffisant ; clÃ© `<sÃ©rie>` fausse ; devise Ã©trangÃ¨re ; bracelet bloquÃ© ;

  bracelet d'un autre organisateur (`404`).

- `cash-desk-guard.spec.ts` (preuve de FR-004 par l'API) : pour chaque route d'espÃ¨ces

  (`createCashTopup`, `takeDeposit`, `refundDeposit`, `refundCashDue`) sans session â†’ `409` ; avec

  session â†’ rÃ©ussite et rattachement ; vÃ©rifier aussi qu'**aucune rÃ©ponse** de ces routes ni de

  `listCashSessions` appelÃ©e par un `CASHIER` ne contient de solde de la caisse (A27) : balayage des

  corps JSON pour les montants de la caisse.

- Latence (NFR-009) : mesure cÃ´tÃ© serveur de 200 recharges, p95 â‰¤ 200 ms, **sautÃ©e sous

  `SKIP_LATENCY`**.



## Test Strategy



- pgTAP : aucun (lot sans SQL). Les suites de base de WP02 et WP05 doivent rester vertes : tu ne les

  lances pas toi-mÃªme sur `cashless_test` (rÃ©servÃ©e Ã  l'orchestrateur).

- Jest, sur ta propre base `cashless_wp09` (crÃ©Ã©e par le script du dÃ©pÃ´t, migrations jouÃ©es,

  `post-roles.sql` appliquÃ©) : `npx jest --runInBand apps/api/test/integration/topups/cash

  apps/api/test/integration/media/deposit apps/api/test/integration/media/cash-due

  apps/api/test/integration/media/release`. Puis les trois specs de la mission 4 hors carte et `npm

  run lint` / `npm run typecheck` du paquet `apps/api`.

- Horloge Docker : aucune comparaison entre l'horloge Node et celle de la base ; les heures de test

  viennent de la base. Lignes de 100 caractÃ¨res (Prettier du dÃ©pÃ´t).

- Mutations Ã  tuer (le relecteur les essaiera) : retirer `requireCashSession` ; repasser

  `moneyAccount` ; prendre la caution dans la transaction du crÃ©dit ; ignorer `cash_session_id` ;

  rendre le solde de la caisse dans une rÃ©ponse.



## Definition of Done



- [ ] T043 Ã  T048 faits ; tous les tests ci-dessus verts sur `cashless_wp09` ; commande et rÃ©sultat

      dans le compte rendu.

- [ ] Aucun fichier SQL modifiÃ© ; aucune dÃ©pendance ajoutÃ©e ; aucune retouche hors carte en dehors

      de la liste ci-dessus, chacune justifiÃ©e en une ligne.

- [ ] CritÃ¨res couverts passÃ©s Ã  `pass` avec preuve par l'orchestrateur : FR-004, FR-005, FR-007,

      FR-008, NFR-009, et la levÃ©e d'OP-N49 (le compte rendu fournit commande + rÃ©sultat de chaque

      preuve).

- [ ] Compte rendu du lot : Ã©carts au plan avec leur sens (dont le champ `deposit` lu avant la

      prise, le registre des numÃ©ros, la retouche du moteur), retouches hors carte justifiÃ©es,

      points soumis au porteur, fichiers Ã  faire relire par une personne

      (`ledger/db/ledger-queries.ts` et le cas du moteur : chemin d'Ã©criture des espÃ¨ces),

      contradictions entre sources signalÃ©es.

- [ ] Aucun Ã©cart qui affaiblit la sÃ©curitÃ© codÃ© sans l'accord du porteur (rÃ¨gle 1).



## Risks



- RÃ©gression de la mission 4 : la caution et les espÃ¨ces dues dÃ©pendent dÃ©sormais de la session ;

  les suites existantes doivent prouver les mÃªmes refus qu'avant.

- Retouche du moteur : fichier de WP06, dÃ©jÃ  fusionnÃ© ; rester minimal, ne pas toucher au dÃ©coupage

  hors ligne.

- Caution et idempotence : la rÃ©ponse enregistrÃ©e prÃ©cÃ¨de la prise de caution (voir arbitrages).

- Une route qui laisserait passer un compte de caisse (corps, paramÃ¨tre, en-tÃªte) contournerait A8.



## Reviewer Guidance



Cherche Ã  casser, dans cet ordre :

1. **Contournement de la session** : une route d'espÃ¨ces qui Ã©crit sans `requireCashSession` ;

   `cash_session_id` d'une autre session acceptÃ© ; session `CLOSING` traitÃ©e comme ouverte ;

   terminal B Ã©crivant sous la session de A.

2. **Compte de caisse transmis** : toute trace de `moneyAccount`, `cashAccount`, `cash_account_id`

   dans le corps ou la charge utile du moteur.

3. **Double crÃ©dit / double caution** : rejeu de la clÃ©, deux terminaux sur le mÃªme bracelet,

   caution prise deux fois (le moteur doit rendre `NOOP`).

4. **Fuite** : solde ou thÃ©orique de la caisse dans une rÃ©ponse, un journal ou l'audit ; secret ou

   jeton dans les journaux d'un Ã©chec de caution.

5. **Isolation** : bracelet, portefeuille ou session d'un autre organisateur ou prestataire (`404`,

   jamais `403` rÃ©vÃ©lateur).

6. **Tests qui ne prouvent pas ce qu'ils disent** : un cas Â« sans session Â» qui passerait aussi

   parce que le bracelet est invalide ; un cas de plafond qui ne vÃ©rifie pas l'absence d'Ã©criture ;

   un test de latence qui mesure le client.

