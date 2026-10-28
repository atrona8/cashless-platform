---
work_package_id: WP09
title: Recharge espèces et guichet des bracelets
dependencies: [WP08]
requirement_refs: [FR-004, FR-005, FR-007, FR-008, NFR-009]
planning_base_branch: feat/recharges-caisses-psp
merge_target_branch: feat/recharges-caisses-psp
branch_strategy: Planning artifacts for this mission were generated on feat/recharges-caisses-psp. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/recharges-caisses-psp unless the human explicitly redirects the landing branch.
base_branch: kitty/mission-recharges-caisses-psp-01M5YEBA
base_commit: a17b59de48cccdec7f2c81c1df7193122004e207
created_at: '2026-10-28T13:29:13.837193+00:00'
subtasks: [T043, T044, T045, T046, T047, T048]
phase: Phase 3 - Caisses et espèces
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

# Work Package Prompt: WP09 – Recharge espèces et guichet des bracelets

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche de contexte d'implémentation fournie par
l'orchestrateur, ce prompt, puis seulement, dans `kitty-specs/recharges-caisses-psp-01M5YEBA/` :
`spec.md` (FR-004 à FR-008, NFR-009, C-010), `plan.md` (IC-02, IC-03), `research.md` (R-01, R-02,
R-05, R-06 et **R-20, section « Caisses », qui fait foi**), `research-adversarial.md` (A8, A17, A27,
A33), `data-model.md` (`cash_session`, `cash_desk`, `cash_session_tx`), `contracts/cash.md` (règles
2, 3, 7, 8) et `contracts/openapi-additions.md` (lignes `takeDeposit`, `refundCashDue`,
`releaseMedia`). Code de référence : `apps/api/src/media/lifecycle/counter-access.ts`,
`deposit.controller.ts`, `deposit.service.ts` (`takeDueDeposit`), `cash-due.controller.ts`,
`cash-due.service.ts`, `release.service.ts`, `lifecycle.dto.ts` (règle `cash_due.no_session`),
`apps/api/src/ledger/ledger-engine.service.ts` (`delegate`) et `ledger/db/ledger-queries.ts`
(`takeDeposit`), `apps/api/src/payments/device-seq-registry.ts`,
`apps/api/src/idempotency/device-key.ts`. Livrés par les lots précédents :
`packages/ledger-sql/migrations/0036_cash_sessions.sql` (WP02 : signatures exactes de
`open_cash_session`, `attach_cash_tx`, `take_deposit_for_session`, `refund_deposit_for_session`,
`refund_cash_due_for_session`), le moteur corrigé (WP06), les routes de session (WP08),
`post-roles.sql` (WP05).

Règle §0.3 : en cas de contradiction entre sources, applique la priorité (tests exécutables > schéma
SQL, `openapi.yaml`, `sync_protocol.md` > SPECIFICATION > `PRD.md`) et **signale-la**. Ne modifie
jamais un `.sql` généré de `packages/ledger-sql/` ; ce lot ne touche à aucun fichier SQL.

## Objective

Servir `createCashTopup` (`POST /topups/cash`) : un `TOPUP_CASH` en ligne rattaché à la session
ouverte du terminal. Faire passer la caution en espèces, le rendu des espèces dues et la libération
par la session (variantes `…_for_session` de la base), de sorte que **aucune route ne passe plus de
compte de caisse** (FR-008, A8). Prendre la caution due après chaque crédit payé (FR-007). Lever
OP-N49 : les tests de la mission 4 ouvrent une vraie session.

## Context

- Exigences : voir frontmatter. IC-02 (routes) et IC-03 (le moteur est déjà corrigé par WP06 :
  découpage réservé au hors ligne ; ici, en ligne, la base refuse au-delà du plafond
  `CL008`/`CL009`, déjà traduits en `422 WALLET_LIMIT_EXCEEDED` / `MONTHLY_TOPUP_LIMIT_EXCEEDED`
  dans `errors/sqlstate-map.ts`).
- Garde de caisse (WP02) : tout compte inscrit dans `cash_desk` n'accepte une écriture que sous une
  session `OPEN` du même terminal. Cette garde est le filet ; l'API doit refuser **avant** d'écrire,
  avec le `409 CONFLICT_STATE` d'ADR-89 (contrat : `CASH_SESSION_REQUIRED` n'est pas créé).
- État actuel à remplacer : `CounterActor.cashDeskCode` est cherché par `a.code = 'A-CAISSE-' ||
  d.serial`, et les services passent ce code au moteur (`moneyAccount`) ; `cash-due.controller.ts`
  refuse tout `cash_session_id` (`cash_due.no_session`). Après ce lot, la **session** est la source
  ; `cashDeskCode` ne sert plus qu'à l'affichage.
- Ce qui en dépend : WP11 (caution due après un crédit PSP) réutilise `DepositService` ; WP14
  (parcours de bout en bout et latence) réutilise `POST /topups/cash`.

**Règle de sécurité du projet (`CLAUDE.md`, règle 1)** : si un point de ce lot ne peut être tenu
qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé,
faux gardé plus longtemps que prévu), **arrête-toi sur ce point et soumets-le au porteur avant de
coder** (risque, options), continue le reste. Un renforcement se fait, puis se consigne. Aucun faux
en production. Aucune nouvelle dépendance npm (R-18).

## Arbitrages de l'orchestrateur (27/10/2026)

Tous dans le sens le plus strict ou de pure répartition ; ils priment sur le texte ci-dessus en cas
de doute.

- **La session décide de la caisse.** Aucune route n'accepte ni ne transmet un compte de caisse.
  `cash_session_id` facultatif dans les corps : s'il est présent, il doit être la session `OPEN` du
  terminal (sinon `409 CONFLICT_STATE`, règle propre `cash.session_mismatch`) ; il est toujours
  renvoyé dans la réponse (FR-008).
- **Caution et espèces dues : variantes `…_for_session`** (R-20, A8). Plus aucun appel à
  `take_deposit`, `refund_deposit` ni `refund_cash_due` avec un compte de caisse depuis
  `media/lifecycle/`.
- **Caution due : transaction distincte, après validation** (R-06). Comme l'intercepteur
  d'idempotence enregistre puis renvoie la réponse produite dans la transaction du crédit (la valeur
  rendue par le contrôleur après `tx.run` n'est pas envoyée), le champ `deposit` de la réponse de
  `createCashTopup` porte l'état lu **dans** la transaction du crédit (`DUE` avec son montant, ou
  `null` s'il n'y a rien à prendre), pas le résultat de la prise qui suit. Écart de lecture au
  contrat (« résultat dans `deposit` ») : à signaler au compte rendu. Ne pas prendre la caution dans
  la transaction du crédit pour contourner (un échec de caution ne doit jamais annuler le crédit).
- **Rejeu de la même clé** : la réponse enregistrée est servie par l'intercepteur sans atteindre le
  contrôleur ; la reprise de la caution (A33) y est donc impossible. Elle a lieu au crédit suivant
  et par WP12 pour le chemin PSP. Le consigner, ne pas bricoler l'intercepteur (hors carte).
- **Une seule recherche de session par requête** : elle est ajoutée à la requête existante de
  `CounterAccess.authorize` (sous-requête), pas en aller-retour supplémentaire (NFR-009).
- **Un compte `CASH_DESK` n'est jamais lu ni rendu à un `CASHIER`** (A27) : aucune réponse de ce lot
  ne porte le solde ou le théorique de la caisse.

- **`AuditAction` (règle commune de `tasks.md`)** : ce lot ajoute une valeur, `CASH_TOPUP`, à
  l'union de `apps/api/src/audit/audit.service.ts` (retouche hors carte d'une ligne, en fin
  d'union ; l'orchestrateur résout les conflits de fusion avec WP08). Les valeurs `MEDIA_*`
  existent déjà.
- **Matrice d'authentification des terminaux** : `createCashTopup` gagne `staffBearer` (WP01) donc
  la route est modifiée : ajoute ses cas dans
  `apps/api/test/integration/end-to-end/device-auth-cases/cash-topup.cases.ts` (nouveau, dans la
  carte du lot ; modèle : `payments.cases.ts` du même dossier, enregistré par `registry.ts` sans
  index). Les routes de caution et d'espèces dues existantes gardent leurs cas ; ajoute ceux dont
  l'attente change (session obligatoire).
- **Garde** : `TerminalOrPersonGuard` est créée par WP08 (pas ici).
- **Ajouts du 27/10 (relectures de WP02 et WP06)** :
  - `source` de la commande `TOPUP_CASH` fixée par le serveur (`ONLINE` sur ces routes), jamais lue
    dans le corps ; test : un corps qui porte `source: OFFLINE_SYNC` ou `headroom` n'obtient aucun
    découpage.
  - Portefeuille et `mediaId` cohérents : le portefeuille crédité est déduit du bracelet (attribution
    ouverte), jamais pris séparément ; test : bracelet d'un portefeuille et `wallet_id` d'un autre
    du même grand livre → refus avant écriture (`open_cash_due_anomaly` ne contrôle que le grand
    livre).
  - Rôle de l'acteur sur l'événement de la session contrôlé côté API pour les variantes
    `…_for_session`, `attach_cash_tx` et `refund_cash_due` (la base ne le fait pas).
  - Rattachement à la session prouvé pour chaque recharge en espèces (le test 147 de 0036 est
    descriptif).
  - Ajoute `createCashTopup` à `device-auth-matrix.spec.ts` (relecture de WP01).

## Branch Strategy

Planification et fusion sur `feat/recharges-caisses-psp`. Dépendance : WP08 (et, par lui, WP01,
WP05, WP06, WP07). Le worktree est attribué par lane d'après `lanes.json`. Commande : `spec-kitty
agent action implement WP09 --agent claude --mission recharges-caisses-psp-01M5YEBA`.

Retouches hors carte autorisées, chacune consignée en une ligne au compte rendu :
`apps/api/src/app.module.ts` (**une ligne** : import de `CashTopupModule`) ;
`apps/api/src/errors/sqlstate-map.ts` (un code s'il manque) ;
`apps/api/test/support/media-fixtures.ts` (nouveau helper de session, voir T047) ; les specs de la
mission 4 non possédées qui cassent par ce lot : `test/integration/media/replace.spec.ts`,
`test/integration/end-to-end/media-journey.spec.ts`, `media-isolation.spec.ts` (T047) ; et la
retouche du moteur décrite en T045 (≤ 15 lignes : `ledger/db/ledger-queries.ts` et le cas
`take_deposit`/`refund_deposit` de `ledger-engine.service.ts`). Si la retouche du moteur dépasse 15
lignes, arrête-toi et demande.

## Subtasks

### T043 — `counter-access.ts` : session ouverte du terminal

But : que toute route de guichet connaisse la session ouverte du terminal sans requête de plus.

1. `CounterActor` gagne `cashSession: { id: string; accountId: string; code: string } | null`.
   `cashDeskCode` reste (recherche par série inchangée, R-01) mais n'est plus passé aux services
   d'écriture.
2. Dans `CounterAccess.authorize`, ajoute à la requête existante une sous-requête `(SELECT s.id FROM
   cash_session s WHERE s.device_id = d.id AND s.status = 'OPEN')` et le compte
   (`s.cash_account_id`, `a.code`). Une session `CLOSING` n'est **pas** ouverte : aucune écriture
   d'espèces.
3. Nouvelle fonction exportée `requireCashSession(actor, language, provided?: string | null)` :
   retourne la session ; `null` → `conflict(...)` avec le message d'ADR-89 déjà présent dans
   `deposit.service.ts` (« Aucune caisse ouverte pour ce terminal… ») ; `provided` différent de
   `actor.cashSession.id` → règle `cash.session_mismatch` (`counterRefusal(..., 'CONFLICT_STATE',
   409)`), à ajouter à `RULES` de `lifecycle.dto.ts` en français et en anglais. Supprime la règle
   `cash_due.no_session` (plus utilisée).
4. `parseCashSessionId(body)` dans `lifecycle.dto.ts` : champ facultatif, UUID sinon `422
   VALIDATION_FAILED` (reprendre `isUuid`, `invalid` de `platform.dto`).
5. Le mode d'application n'est **pas** contrôlé ici (les routes de caution servent aussi d'autres
   modes) ; le contrôle `TOPUP_DESK` est propre à la recharge (T044).

Validation :
- [ ] aucune requête SQL ajoutée par route de guichet (la session vient de la requête existante) ;
- [ ] session `CLOSING` ou `CLOSED` → `cashSession = null` ;
- [ ] tests unitaires ou d'intégration de `requireCashSession` (null, autre session, bonne session).

### T044 — Recharge en espèces `createCashTopup`

Fichiers : `topups/cash/cash-topup.{module,controller,service,dto}.ts`.

1. Route `POST /topups/cash`, `@HttpCode(201)`, `@CounterAuth()` (terminal ET personne
   `CASHIER`/`SUPERVISOR`, `X-Staff-Authorization`), `@Idempotent({ scope: deviceScope, deviceSeq:
   true })` : `Idempotency-Key = <série>:<seq>` contrôlé avant la réservation (`parseDeviceKey`,
   `422` si la série n'est pas celle du terminal).
2. DTO (`cash-topup.dto.ts`) : `amount` entier > 0 lu en `bigint` (`amountField`) ; `currency` =
   devise de l'événement (sinon `422 VALIDATION_FAILED`) ; `occurred_at` requis par le contrat mais
   **ignoré pour l'écriture** : l'heure est celle de la base (`clock_timestamp()`), l'heure reçue va
   en `metadata.device_occurred_at` ; `tap` (lecture embarquée) ou `tap_id`, exactement un des deux
   (reprendre `parseTap` / la règle de `cash-due.controller.ts`) ; `cash_tendered` informatif
   (entier ≥ 0, ≥ `amount` s'il est donné, jamais écrit au grand livre) ; `cash_session_id`
   facultatif (T043) ; tout autre champ → `422`.
3. Dans **une** transaction (`tx.run`), dans cet ordre : a. prise du terminal en tête : `SELECT 1
   FROM device WHERE id = $1 FOR UPDATE` (ordre global des verrous de la 5b : terminal d'abord) ; b.
   `CounterAccess.authorize` ; `assertDeviceMode(actor.device, ['TOPUP_DESK'])` (`422
   DEVICE_MODE_NOT_ALLOWED`) ; c. `requireCashSession(actor, language, body.cash_session_id)` —
   **avant toute écriture** ; d. lecture : `TapService.registerOrRefuse` (embarquée) ou
   `TapService.byId` ; bracelet visible de l'organisateur (`lockCounterMedia`, `FOR UPDATE`), statut
   `ACTIVE` sinon `409 MEDIA_STATE_INVALID` (règle existante `cash_due.media_blocked`), portefeuille
   du bracelet (`media.wallet_id`) ; bracelet sans portefeuille → refus `MEDIA_NOT_ACTIVATED` (code
   existant) ; e. `debit_authority = EDGE` : **permis** (une recharge est un crédit, contrat) ; ne
   pas lever `DEBIT_AUTHORITY_EDGE` ici ; f. `engine.execute(client, { type: 'TOPUP_CASH', source:
   'ONLINE', idempotencyKey: <Idempotency-Key>, occurredAt: <heure base>, ledgerId, eventId,
   currency, deviceId, mediaId, createdBy: actor.userId, payload: { walletId, cashDesk: <série du
   terminal>, amount }, metadata: { cash_session_id, device_occurred_at } })`. `cashDesk` est la
   **série** (`buildTopupCash` préfixe `A-CAISSE-`) : la prendre de `actor.cashSession.code` sans le
   préfixe, jamais d'un champ du corps ; g. `SELECT attach_cash_tx($1, $2)` (session, transaction)
   dans la même transaction ; signature lue dans 0036 ; h. `TapService.consume` si une lecture a été
   présentée ; i. relire les soldes (`spendable`, `paid`, `promo`) comme `TapService.register` et
   l'état de caution (T046) ; j. `audit.record` : action `CASH_TOPUP`, objet `journal_transaction`,
   `after` = montant, session, terminal ; jamais de solde de caisse.
4. Réponse `201` conforme à `TopupResult` : `transaction_id`, `idempotency_key`, `type:
   'TOPUP_CASH'`, `status: 'SUCCEEDED'`, `amount`, `currency`, `wallet_id`, `balance_after`,
   `deposit`, plus `cash_session_id` (FR-008). Montants en nombre (`Number(bigint)`) comme
   `deposit.service.ts`.
5. Registre des numéros : lis `docs/sync_protocol.md` §3.2 et §3.3 et `DeviceSeqRegistry` (exporté
   par `PaymentsModule`). Si `TOPUP_CASH` y est un type chaîné, enregistre la réussite dans la
   transaction (`accept`, canal `ONLINE`) et les refus définitifs en transaction séparée (`reject`),
   avec un `content_sha256` calculé par `contentSha256` sur `seq`, `type`, `occurred_at`, `amount`,
   `currency`, `tap` / `tap_id` ; sinon n'en enregistre pas. Dans les deux cas **signale ton choix**
   (la mission 7 devra aligner les lots hors ligne).
6. Refus : `catch (e) { return this.taps.settleRefusal(e, requestDevice(req), tap) }` comme les
   routes de caution. Plafond dépassé : `422 WALLET_LIMIT_EXCEEDED` ou
   `MONTHLY_TOPUP_LIMIT_EXCEEDED`, **rien d'écrit** (la transaction est annulée, y compris le
   rattachement).
7. Import du module dans `app.module.ts` (une ligne). `CashTopupModule` importe `LifecycleModule`,
   `TapsModule`, `PaymentsModule`, `ConfigResolverModule`, `TenantModule` (ce qu'il utilise, rien de
   plus).

Cas limites : montant 0 ou négatif ; devise étrangère ; terminal d'un autre mode ; session d'un
autre terminal du même événement (`409`) ; bracelet d'un autre organisateur (`404`) ; bracelet
`BLOCKED` (`409`) ; lecture déjà consommée (`409 TAP_UNUSABLE`) ; deux recharges simultanées du même
portefeuille (verrous du moteur, une seule passe si la marge ne suffit pas à deux).

Validation :
- [ ] aucun champ du corps ne désigne un compte de caisse ni n'est reflété avec un solde de caisse ;
- [ ] la refus « pas de session » arrive avant toute écriture et avant la consommation de la lecture
      ;
- [ ] `TOPUP_CASH` du jour écrit en source `ONLINE`, jamais découpé (pas de `L-ESP-A-RENDRE`, pas
      d'anomalie).

### T045 — Caution, espèces dues, libération par la session

1. **Retouche du moteur (≤ 15 lignes, consignée).** Ajouter `cashSessionId?: string` à
   `DelegatedPayload` (`ledger-engine.service.ts`) ; dans `ledger/db/ledger-queries.ts`,
   `takeDeposit(client, mediaId, session)` et `refundDeposit(client, mediaId, session)` appellent
   `take_deposit_for_session` / `refund_deposit_for_session` quand `session` est donné (compte
   `null` : caution `FROM_BALANCE`, inchangée). Le cas `moneyAccount` n'existe plus pour les
   cautions d'espèces : le retirer pour éviter qu'un appelant repasse un compte (test de la
   non-régression en T048).
2. `deposit.service.ts` : `DepositContext.cashDeskCode` est remplacé par `cashSessionId: string |
   null`. `moneyAccount` devient `cashSession(context, row, payment)` : mode `SEPARATE` et
   `payment.method = 'CASH'` exigent une session (`requireCashSession`), sinon `409` ; paiement
   autre que `CASH` → règle existante `deposit.cash_only`. La prise comme le rendu passent `payload:
   { cashSessionId }`.
3. `deposit.controller.ts` : lire `cash_session_id` (T043), l'envoyer au service, le **renvoyer**
   dans la réponse (`DepositState` + `cash_session_id` si fourni ou si la session a servi).
   `activation.service.ts` (caution prise à l'activation, `cashDeskCode: actor.cashDeskCode`) passe
   la session de la même façon.
4. `cash-due.service.ts` : remplacer la recherche de `cash_account` par la session ; appeler
   `refund_cash_due_for_session` (mêmes autres paramètres que `refund_cash_due`, voir 0036) ; garder
   les contrôles non faits par la base (bracelet `ACTIVE`, grand livre de l'événement du terminal).
   La réponse `{ transaction_id, ..., approved_by }` gagne `cash_session_id`. Retirer le refus de
   `cash_session_id` dans `cash-due.controller.ts`.
5. `release.controller.ts` / `release.service.ts` : accepter `cash_session_id` (T043) et le renvoyer
   dans le résultat de libération. La libération n'écrit aucune espèce (`cash_to_hand_back: 0`,
   enchaînements refusés, inchangé) : ne **pas** inventer de rendu ; si une session est fournie,
   elle est seulement validée (session ouverte du terminal) et renvoyée.
6. Audit : les actions existantes (`MEDIA_DEPOSIT_TAKEN`, `MEDIA_DEPOSIT_REFUNDED`,
   `MEDIA_CASH_DUE_REFUNDED`) gagnent `cash_session_id` dans `after`.

Validation :
- [ ] `grep -rn "moneyAccount\|cashDeskCode" apps/api/src/media/lifecycle` ne montre plus d'usage
      d'écriture ;
- [ ] caution `SEPARATE` en espèces sans session : `409`, rien d'écrit, bracelet inchangé ;
- [ ] caution prise sous la session A, terminal B (même événement) : refus (garde de la base) ;
- [ ] les routes ne transmettent jamais un code ou un identifiant de compte de caisse.

### T046 — Caution due après chaque crédit payé

1. `CashTopupService.afterCredit(operatorId, mediaId, audit)` : appelé **après** `await tx.run(...)`
   dans le contrôleur (la transaction du crédit est alors validée), appelle
   `DepositService.takeDueDeposit(operatorId, mediaId, audit)` (transaction distincte,
   `TenantTx.run`). Toute erreur est attrapée, journalisée sans donnée personnelle (identifiants
   seulement : `media_id`, code de problème) et n'altère ni le statut ni le corps de la réponse ; la
   caution reste `DUE`.
2. `takeDueDeposit` ne prend que les cautions `FROM_BALANCE` dues : ajoute la condition
   `deposit_mode = 'FROM_BALANCE'` (une caution `SEPARATE` reste payée en espèces au guichet, R-06)
   et un retour neutre sinon.
3. Nouvelle méthode `DepositService.takeDueDepositForWallet(operatorId, walletId, audit)` pour WP11
   : retrouve le bracelet `ACTIVE` du portefeuille ayant une caution `DUE` (`media.wallet_id`), puis
   délègue à `takeDueDeposit`. Aucun bracelet → retour `null`. Idempotente (le moteur ne reprend pas
   une caution `HELD`).
4. L'état `deposit` de la réponse (arbitrage ci-dessus) est lu dans la transaction du crédit par
   `DepositService.state`.

Cas limites : crédit partiel qui ne couvre pas la caution (reste `DUE`, la base ne prend rien) ;
bracelet sans caution (`deposit: null`) ; échec simulé de la prise (sonde sur le moteur) : crédit
inchangé, réponse `201`.

Validation :
- [ ] un échec de caution ne change pas le `201` ni le solde crédité ;
- [ ] la prise a lieu **après** le COMMIT (test : lecture concurrente du crédit visible avant la
      caution).

### T047 — Adapter les tests de la mission 4 ; OP-N49 levé

1. `test/support/media-fixtures.ts` (hors carte, consigné) : nouveau helper `openCashSession(db, {
   deviceId, userId })` qui appelle `open_cash_session` de la base et rend `{ sessionId, accountId,
   code }` ; `openCashDesk` reste pour les tests qui n'écrivent pas d'espèces. Ne modifie pas la
   signature de `openCashDesk`.
2. `deposit.spec.ts`, `cash-due.spec.ts`, `release.spec.ts` : chaque cas qui écrit des espèces ouvre
   d'abord une session ; ajouter les cas : sans session `409` ; `cash_session_id` d'une autre
   session `409` ; `cash_session_id` renvoyé ; terminal sans session n'a créé aucun compte
   `CASH_DESK` (le cas existant « terminal sans caisse ouverte » est conservé et renforcé).
3. `replace.spec.ts`, `media-journey.spec.ts`, `media-isolation.spec.ts` (hors carte, consigné) :
   seul changement nécessaire pour qu'elles restent vertes (session ouverte avant les espèces).
4. Le texte « cette mission ne crée aucun compte de caisse » (décision n° 10) des commentaires de
   `deposit.service.ts` et `counter-access.ts` est mis à jour : la mission des caisses l'a levé.

Validation :
- [ ] `npx jest apps/api/test/integration/media` vert, ainsi que les deux parcours de bout en bout
      touchés ;
- [ ] aucune assertion existante affaiblie : toute assertion modifiée est justifiée au compte rendu.

### T048 — Tests d'intégration du guichet

Fichiers : `test/integration/topups/cash-topup.spec.ts`, `cash-topup-refusals.spec.ts`,
`cash-desk-guard.spec.ts`. Harnais : reprendre celui de `test/integration/media/deposit.spec.ts`
(HTTPS avec le terminal de test, vraie base).

- `cash-topup.spec.ts` : recharge réussie (`TOPUP_CASH`, source `ONLINE`, lignes
  caisse/portefeuille, rattachée à la session : ligne dans `cash_session_tx`) ; rejeu de la même clé
  → même réponse, `Idempotency-Replayed`, une seule écriture ; `cash_session_id` renvoyé ; caution
  `FROM_BALANCE` due prise après le crédit (état `HELD`, deux transactions distinctes) ; échec de la
  caution laisse le crédit ; recharge sur grand livre `EDGE` permise.
- `cash-topup-refusals.spec.ts` : sans session ; session d'un autre terminal ; session fermée
  (`CLOSING`) ; plafond de solde et plafond mensuel (`422`, **rien d'écrit** : zéro ligne
  `journal_transaction`, `posting`, `cash_session_tx`, lecture non consommée) ; mode autre que
  `TOPUP_DESK` ; rôle insuffisant ; clé `<série>` fausse ; devise étrangère ; bracelet bloqué ;
  bracelet d'un autre organisateur (`404`).
- `cash-desk-guard.spec.ts` (preuve de FR-004 par l'API) : pour chaque route d'espèces
  (`createCashTopup`, `takeDeposit`, `refundDeposit`, `refundCashDue`) sans session → `409` ; avec
  session → réussite et rattachement ; vérifier aussi qu'**aucune réponse** de ces routes ni de
  `listCashSessions` appelée par un `CASHIER` ne contient de solde de la caisse (A27) : balayage des
  corps JSON pour les montants de la caisse.
- Latence (NFR-009) : mesure côté serveur de 200 recharges, p95 ≤ 200 ms, **sautée sous
  `SKIP_LATENCY`**.

## Test Strategy

- pgTAP : aucun (lot sans SQL). Les suites de base de WP02 et WP05 doivent rester vertes : tu ne les
  lances pas toi-même sur `cashless_test` (réservée à l'orchestrateur).
- Jest, sur ta propre base `cashless_wp09` (créée par le script du dépôt, migrations jouées,
  `post-roles.sql` appliqué) : `npx jest --runInBand apps/api/test/integration/topups/cash
  apps/api/test/integration/media/deposit apps/api/test/integration/media/cash-due
  apps/api/test/integration/media/release`. Puis les trois specs de la mission 4 hors carte et `npm
  run lint` / `npm run typecheck` du paquet `apps/api`.
- Horloge Docker : aucune comparaison entre l'horloge Node et celle de la base ; les heures de test
  viennent de la base. Lignes de 100 caractères (Prettier du dépôt).
- Mutations à tuer (le relecteur les essaiera) : retirer `requireCashSession` ; repasser
  `moneyAccount` ; prendre la caution dans la transaction du crédit ; ignorer `cash_session_id` ;
  rendre le solde de la caisse dans une réponse.

## Definition of Done

- [ ] T043 à T048 faits ; tous les tests ci-dessus verts sur `cashless_wp09` ; commande et résultat
      dans le compte rendu.
- [ ] Aucun fichier SQL modifié ; aucune dépendance ajoutée ; aucune retouche hors carte en dehors
      de la liste ci-dessus, chacune justifiée en une ligne.
- [ ] Critères couverts passés à `pass` avec preuve par l'orchestrateur : FR-004, FR-005, FR-007,
      FR-008, NFR-009, et la levée d'OP-N49 (le compte rendu fournit commande + résultat de chaque
      preuve).
- [ ] Compte rendu du lot : écarts au plan avec leur sens (dont le champ `deposit` lu avant la
      prise, le registre des numéros, la retouche du moteur), retouches hors carte justifiées,
      points soumis au porteur, fichiers à faire relire par une personne
      (`ledger/db/ledger-queries.ts` et le cas du moteur : chemin d'écriture des espèces),
      contradictions entre sources signalées.
- [ ] Aucun écart qui affaiblit la sécurité codé sans l'accord du porteur (règle 1).

## Risks

- Régression de la mission 4 : la caution et les espèces dues dépendent désormais de la session ;
  les suites existantes doivent prouver les mêmes refus qu'avant.
- Retouche du moteur : fichier de WP06, déjà fusionné ; rester minimal, ne pas toucher au découpage
  hors ligne.
- Caution et idempotence : la réponse enregistrée précède la prise de caution (voir arbitrages).
- Une route qui laisserait passer un compte de caisse (corps, paramètre, en-tête) contournerait A8.

## Reviewer Guidance

Cherche à casser, dans cet ordre :
1. **Contournement de la session** : une route d'espèces qui écrit sans `requireCashSession` ;
   `cash_session_id` d'une autre session accepté ; session `CLOSING` traitée comme ouverte ;
   terminal B écrivant sous la session de A.
2. **Compte de caisse transmis** : toute trace de `moneyAccount`, `cashAccount`, `cash_account_id`
   dans le corps ou la charge utile du moteur.
3. **Double crédit / double caution** : rejeu de la clé, deux terminaux sur le même bracelet,
   caution prise deux fois (le moteur doit rendre `NOOP`).
4. **Fuite** : solde ou théorique de la caisse dans une réponse, un journal ou l'audit ; secret ou
   jeton dans les journaux d'un échec de caution.
5. **Isolation** : bracelet, portefeuille ou session d'un autre organisateur ou prestataire (`404`,
   jamais `403` révélateur).
6. **Tests qui ne prouvent pas ce qu'ils disent** : un cas « sans session » qui passerait aussi
   parce que le bracelet est invalide ; un cas de plafond qui ne vérifie pas l'absence d'écriture ;
   un test de latence qui mesure le client.
