---
work_package_id: WP11
title: 'Recharges PSP : demande et traitement d''un paiement'
dependencies: [WP07, WP09, WP10]
requirement_refs: [FR-012, FR-013, FR-016, FR-017, FR-018, FR-024, FR-025, FR-026, C-009, C-010]
planning_base_branch: feat/recharges-caisses-psp
merge_target_branch: feat/recharges-caisses-psp
branch_strategy: Planning artifacts for this mission were generated on feat/recharges-caisses-psp. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/recharges-caisses-psp unless the human explicitly redirects the landing branch.
subtasks: [T054, T055, T056, T057, T058, T059]
phase: Phase 4 - PSP
history:
- timestamp: '2026-10-27T15:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent: claude
model: sonnet
agent_profile: implementer-ivan
role: implementer
authoritative_surface: apps/api/src/topups/psp/
execution_mode: code_change
owned_files: [apps/api/src/topups/psp/**, apps/api/test/integration/topups/psp-*.spec.ts, apps/api/test/integration/end-to-end/device-auth-cases/psp-topups.cases.ts, apps/api/test/integration/topups/psp-fixtures.ts]
create_intent: [apps/api/src/topups/psp/psp-topups.module.ts, apps/api/src/topups/psp/psp-topups.controller.ts, apps/api/src/topups/psp/psp-topups.service.ts, apps/api/src/topups/psp/psp-topups.dto.ts, apps/api/src/topups/psp/psp-topup-caller.guard.ts, apps/api/src/topups/psp/psp-topup-lookup.ts, apps/api/src/topups/psp/psp-payment-types.ts, apps/api/src/topups/psp/psp-payment-processor.ts, apps/api/src/topups/psp/psp-refusals.ts, apps/api/src/topups/psp/card-checks.ts, apps/api/test/integration/topups/psp-request.spec.ts, apps/api/test/integration/topups/psp-read-cancel.spec.ts, apps/api/test/integration/topups/psp-process.spec.ts, apps/api/test/integration/topups/psp-card.spec.ts, apps/api/test/integration/topups/psp-deposit.spec.ts, apps/api/test/integration/topups/psp-concurrency.spec.ts, apps/api/test/integration/end-to-end/device-auth-cases/psp-topups.cases.ts, apps/api/test/integration/topups/psp-fixtures.ts]
tags: []
tracker_refs: []
---

# Work Package Prompt: WP11 – Recharges PSP : demande et traitement d'un paiement

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche de contexte d'implémentation fournie par
l'orchestrateur, ce prompt, puis seulement, dans `kitty-specs/recharges-caisses-psp-01M5YEBA/` :
- `spec.md` : FR-012, FR-013, FR-016, FR-017, FR-018, FR-024, FR-025, FR-026, C-009, C-010, Edge
  Cases, contradictions 2, 5 ; `research.md` : R-06, R-11, R-16 et **R-20 en entier** (qui fait foi)
  ; `research-adversarial.md` (A2, A3, A4, A11, A12, A13, A20, A25, A31, A33) ; `plan.md` IC-08 ;
- `data-model.md` : `psp_topup` (dont le **tableau des transitions**), `psp_event`, «
  Correspondances » (moyen, compte, préfixe de clé) ; `contracts/psp.md` : sections « Recharge PSP »
  (7 à 9), « Notifications » (11, 12), « Écritures » ; `contracts/database-rights.md` (fonctions
  accordées).

Code à lire : `apps/api/src/media/lifecycle/counter-access.ts` (`CounterAccess`, adapté par WP09 :
session de caisse), `deposit.service.ts` (`takeDueDeposit`, et `takeDueDepositForWallet` ajouté par
WP09), `apps/api/src/topups/cash/` (WP09 : résolution du portefeuille d'un `tap_id` ou d'un
`wallet_id` au guichet, **réutilise-la**), `apps/api/src/ledger/ledger-engine.service.ts`
(`execute`, `LedgerCommand`), `ledger/status-matrix.ts` (`isAccepted`),
`ledger/db/ledger-queries.ts` (`readTopupHeadroom`), `ledger/builders/festival/topup.ts`
(`buildTopup` : canal, frais), `apps/api/src/customer-identity/` (`CustomerAuth`, `requestCustomer`,
`CustomerGuard`), `device-identity/device-or-caller.guard.ts` (`hasDeviceMarker`, structure de la
garde exclusive), `identity/authentication.guard.ts`, `identity/staff-token.decorator.ts`,
`device-identity/device.guard.ts`, `idempotency/idempotent.decorator.ts` et
`idempotency.interceptor.ts` (**lis comment `tx.run` et `writes: false` enregistrent la réponse**,
voir T054), `payments/payments.service.ts` (modèle d'un service transactionnel d'écriture et
d'ouverture d'anomalie), `configuration/cascade.service.ts` (`resolveForEvent`), `db/tenant-tx.ts`,
`audit/audit.service.ts`. Livrés en amont : `apps/api/src/psp/` (WP07 : ports `PspAdapter`,
`PspSecretStore`, registre des fournisseurs, types normalisés, faux signeur),
`apps/api/src/psp-configurations/` (WP10), `packages/ledger-sql/migrations/0038_psp_topups.sql`
(WP04) et `0037_psp_configurations.sql` (WP03) : **signatures, valeurs permises et codes d'erreur
exacts des fonctions que ce lot appelle**. Lis d'abord les comptes rendus de WP07, WP09 et WP10 (fin
de leurs fichiers `tasks/WP07-*.md`, `WP09-*.md`, `WP10-*.md`) pour les noms exacts que ce prompt
désigne par leur rôle (« le registre des adaptateurs », « le type de notification normalisée »).

Priorité des sources (SPECIFICATION §0.3) : tests exécutables > schéma SQL, `openapi.yaml`,
`sync_protocol.md` > SPECIFICATION > `PRD.md` ; toute contradiction est **signalée** dans le compte
rendu, jamais tranchée en silence. Ne modifie jamais un `.sql` généré de `packages/ledger-sql/` ; ce
lot ne touche à aucun fichier SQL.

## Objective

Servir la demande de recharge PSP (guichet et festivalier), sa consultation et son annulation ; et
livrer **le service qui traite un paiement** (notification ou interrogation) selon R-11 et le
tableau des transitions : un seul crédit par paiement, jamais d'écriture partielle, tout paiement
non créditable ouvre une anomalie portant l'argent à rendre. Ce service est appelé par WP12
(réception et travailleur) et par WP13 (couture des contestations) : ses noms et signatures
ci-dessous sont un contrat.

## Context

- Concern IC-08 (demande, consultation, annulation, traitement). Constats : **A2** (corrélation par
  la référence marchande), **A3** (tableau des états), **A4** (refus définitifs du moteur : jamais
  de `500` en boucle), **A11** (carte sans empreinte ou sans 3-D Secure : non créditée), **A12**
  (plafond par carte sous verrou consultatif, jour UTC), **A13** (verrou de ligne), **A20**
  (portefeuille bloqué), **A25** (plafonds de recharges en attente), **A31** (clés qualifiées par la
  configuration), **A33** (caution due aussi sur le chemin doublon).
- Dépend de ce lot : WP12 (appelle `process`, `settleUnpaid`, `afterCommit` ci-dessous), WP13
  (appelle `PspTopupLookup.findForUpdate`), WP14 (preuves).
- Ce que ce lot ne fait pas : la route de notification, la conservation des événements, les reprises
  et l'interrogation planifiée (WP12) ; les contestations (WP13).
- **Contrat de service pour WP12 et WP13 (noms exacts, à ne pas renommer).** Dans
  `apps/api/src/topups/psp/` :
  - `PspTopupLookup.findForUpdate(client: TxClient, ref: { configurationId: string; merchantRef?:
    string | null; providerRef?: string | null }): Promise<PspTopupRow | null>` : `SELECT … FOR
    UPDATE` de la recharge, d'abord par `merchantRef` (= `psp_topup_id`), puis par
    `(configurationId, providerRef)` ; `null` si aucune. `PspTopupRow` exporté.
  - `PspPaymentProcessor.process(client: TxClient, input: PaymentInput): Promise<PaymentOutcome>` :
    traite un paiement **dans la transaction de l'appelant** (n'ouvre aucune transaction, ne
    contacte jamais le PSP).
  - `PspPaymentProcessor.settleUnpaid(client: TxClient, input: UnpaidInput):
    Promise<PaymentOutcome>` : échec confirmé par l'interrogation (`verdict: 'FAILED'`) ou échéance
    dépassée (`verdict: 'EXPIRED'`), sous le même verrou de ligne.
  - `PspPaymentProcessor.afterCommit(operatorId: string, outcome: PaymentOutcome, audit:
    AuditContext): Promise<void>` : à appeler **après le COMMIT** de la transaction qui a appelé
    `process` (caution due, transaction distincte, erreurs avalées et journalisées).
  - Types exportés de `psp-payment-types.ts` : `PaymentInput = { configurationId: string; origin:
    'NOTIFICATION' | 'POLL'; receivedAt: Date; pspEventId: string | null; notification: <type de
    notification normalisée de WP07> }` ; `UnpaidInput = { configurationId: string; topupId: string;
    verdict: 'FAILED' | 'EXPIRED'; observedAt: Date }` ; `PaymentOutcome = { disposition:
    'PROCESSED' | 'UNMATCHED'; outcome: 'CREDITED' | 'NOT_CREDITED' | 'MISMATCH' |
    'DUPLICATE_PAYMENT' | 'NO_EFFECT' | null; topupId: string | null; walletId: string | null;
    operatorId: string; depositDue: boolean }`. `UNMATCHED` (recharge introuvable) ne lève pas et
    n'écrit rien. `outcome` reprend les valeurs de `psp_event.outcome` ; `CHARGEBACK` est à WP13. Un
    type de notification inconnu → `NO_EFFECT`. Une erreur inattendue **remonte** (WP12 l'enregistre
    `RETRY`) ; un refus définitif connu est traduit en `NOT_CREDITED` (voir T056), jamais relancé.

**Règle de sécurité du projet (`CLAUDE.md`, règle 1)** : si un point de ce lot ne peut être tenu
qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé,
faux gardé), **arrête-toi sur ce point et soumets-le au porteur avant de coder**, avec le risque et
les options ; continue le reste. Un renforcement se fait, puis se consigne dans le compte rendu.
Aucun faux en production ; aucune nouvelle dépendance npm (R-18).

## Arbitrages de l'orchestrateur (27/10/2026)

Tous dans le sens le plus strict ou de pure répartition. Ils priment sur le reste du prompt.

- **Aucun appel réseau sous transaction.** `adapter.initiate` s'exécute **hors** de toute
  transaction, entre deux transactions courtes. Un test espionne le registre des adaptateurs et
  prouve qu'aucun appel n'a lieu pendant un `TenantTx.run` (profondeur de transaction suivie par
  l'espion).
- **La demande n'utilise pas `IdempotentTx.run`.** L'intercepteur ne l'accepte qu'une fois par
  requête et enregistre la réponse *dans* cette transaction : l'adresse de paiement obtenue après le
  COMMIT ne pourrait pas y figurer. La route déclare `@Idempotent({ scope, writes: false, … })` et
  enchaîne ses transactions elle-même (`TenantTx.run`) ; la réponse est enregistrée seule à la fin.
  **Une reprise avec la même clé ne doit pas créer deux recharges** : la recharge prend un
  identifiant **déterministe** dérivé de `(portée, clé d'idempotence)` (SHA-256 tronqué en UUID) si
  `create_psp_topup` accepte un identifiant fourni (c'est le cas : `p_psp_topup` est la clé
  primaire, un rejeu au même contenu rend `replayed = true`, un contenu différent `CL029`). La
  reprise retrouve ainsi la ligne existante au lieu d'en créer une.
- **Contrat de garde inexistant : garde composée dans ce lot.** `initiatePspTopup` accepte un
  guichet (terminal + jeton de personne `X-Staff-Authorization`) **ou** un festivalier ;
  `getPspTopup` accepte en plus un `ORGANIZER_ADMIN`. `DeviceOrCallerAuth` refuse l'en-tête
  `X-Staff-Authorization` et ne sait pas composer terminal + personne : écris `PspTopupCallerGuard`
  (`@Public()` pour la garde globale, garde propre) : un marqueur de terminal (`hasDeviceMarker`) →
  chemin guichet complet **sans repli** (preuves du terminal par `DeviceGuard`, jeton de personne
  par `AuthenticationGuard` lu dans `X-Staff-Authorization`, avec un lecteur de métadonnées qui voit
  la route comme « jeton de personne », sur le modèle de `StrictReflector`) ; sans marqueur : jeton
  de festivalier (`CustomerGuard`) ; pour la lecture seulement, à défaut, jeton de personne. Un
  jeton `X-Staff-Authorization` sans marqueur de terminal : `401`. Ne modifie pas
  `device-or-caller.guard.ts` ; si c'est impossible sans le modifier, arrête-toi et demande.
  `TerminalOrPersonGuard` (WP08, cas « terminal + personne **ou** personne seule ») est un cas
  différent : ne la réutilise pas telle quelle, **garde** `PspTopupCallerGuard`, mais **réutilise la
  lecture de `X-Staff-Authorization` de WP08** (même lecteur de métadonnées) et **adapte aussi la
  collecte de la matrice des gardes** de `device-auth-matrix.spec.ts` pour qu'elle connaisse
  `PspTopupCallerGuard` (si l'adaptation dépasse une vingtaine de lignes, arrête-toi et signale-le).
- **Clés d'écriture qualifiées par la configuration** : `wave:<configuration>:<paiement>`,
  `om:<configuration>:<paiement>`, `psp:<configuration>:<paiement>`, `<paiement>` = référence du
  paiement chez le PSP (stable entre notification et interrogation). Sources : `PSP_WEBHOOK`.
  `occurredAt` = `receivedAt` (pas l'heure d'une comparaison avec la base).
- **Dans le sens strict en cas de doute** : paiement qui ne se rapproche pas exactement de la
  recharge (configuration, montant, devise) → `MISMATCH`, rien d'écrit au grand livre. Carte : tout
  ce qui n'est pas un 3-D Secure `SUCCEEDED` explicite, ou une empreinte absente, est non crédité.
  Aucune « valeur par défaut » qui crédite.
- **Un échec (`PAYMENT_FAILED`) ne finalise jamais** une recharge `PENDING` : il reste `PENDING` (le
  paiement peut être repris chez le PSP) ; seule l'interrogation confirme `FAILED` (`settleUnpaid`).
- **Jour de la limite par carte** : jour civil UTC de `receivedAt`, jamais l'horloge de la base ni
  de Node comparées entre elles.
- **Anomalies** : une par paiement non crédité (dédoublonnage par la base ou par `ON CONFLICT` : lis
  `0038`) ; jamais deux pour un même paiement rejoué. L'anomalie `PSP_MISMATCH` s'ouvre par la
  fonction de `0038` si elle existe, sinon par l'`INSERT` dans `anomaly` utilisé par
  `payments.service.ts` (table ancienne, droit existant).
- **Aucun secret** (clés des adaptateurs, secrets de notification) dans une réponse, un journal, un
  audit ou une erreur ; la référence `secret_ref` n'est lue que par `psp_configuration_secret_ref`
  et ne sort jamais de ce service.
- **Retouches hors carte** (une ligne chacune, consignées) : `apps/api/src/app.module.ts` (import de
  `PspTopupsModule`) ; `apps/api/src/errors/sqlstate-map.ts` (un code s'il manque, ex. recharges en
  attente) . Le fichier `apps/api/test/integration/topups/psp-fixtures.ts` est dans la carte du lot
  (voir
  plus bas).

- **Signatures SQL de WP02-WP04 (font foi)** : `create_psp_topup(p_psp_topup uuid, p_wallet uuid,
  p_method text, p_amount bigint, p_kind text, p_device uuid, p_person uuid, p_customer uuid,
  p_expires_at timestamptz)` rend `(psp_topup_id, psp_configuration_id, provider, expires_at,
  replayed boolean)` ; refus : `CL039` portefeuille bloqué (422), `CL004` grand livre non ouvert,
  `CL042` configuration absente (409 `PSP_NOT_CONFIGURED`), `CL029` au-delà de 3 `PENDING` par
  portefeuille ou 20 par terminal, ou contenu différent pour un identifiant déjà pris. Signatures de
  `complete_card_topup`, `complete_psp_topup`, `fail_psp_topup`, `card_topups_today`,
  `wallet_card_count` : voir T056 et T057. Codes nouveaux : `CL041`, `CL042`, `CL043`, `CL044` ;
  mappage dans `errors/sqlstate-map.ts` (retouche d'une ligne si WP07 ne l'a pas fait).
- **Noms de WP07 (font foi)** : jetons `PSP_ADAPTERS` (`PspAdapterRegistry`) et
  `PSP_SECRET_STORE`, `FakePspAdapter`, `FakePspSecretStore`, `signFakeNotification`,
  `verifyHmacSignature`, `WEBHOOK_TOLERANCE_SECONDS`, types `NormalizedPayment`,
  `NormalizedNotification`, `Secret`. `PspAdapter.cancel(query, secrets)` existe (annulation) ;
  `verifyNotification` rend `signedAt`.
- **Fichiers ajoutés à la carte du lot** : `apps/api/test/integration/topups/psp-fixtures.ts`
  (fixtures partagées avec WP12 et WP13, qui l'importent sans le copier) et
  `apps/api/test/integration/end-to-end/device-auth-cases/psp-topups.cases.ts` (cas de la matrice
  d'authentification des
  terminaux pour `initiatePspTopup`, `getPspTopup`, `cancelPspTopup` servis à un terminal).
- **`AuditAction` (règle commune de `tasks.md`)** : valeurs ajoutées par ce lot, en retouche hors
  carte d'une ligne chacune, en fin d'union de `apps/api/src/audit/audit.service.ts` :
  `PSP_TOPUP_REQUESTED`, `PSP_TOPUP_CANCELLED`, `PSP_TOPUP_CREDITED`, `PSP_TOPUP_NOT_CREDITED`.
## Branch Strategy

Planification et fusion sur `feat/recharges-caisses-psp`. Dépendances : WP07 (ports et faux), WP09
(`DepositService`, `CounterAccess` à session), WP10 (résolution de configuration, frais par
configuration). Worktree attribué par lane d'après `lanes.json`. Commande : `spec-kitty agent action
implement WP11 --agent claude --mission recharges-caisses-psp-01M5YEBA`.

## Subtasks

### T054 — Demande de recharge (guichet et festivalier), bornes, appel de l'adaptateur après
validation

But : `POST /topups/psp` (`initiatePspTopup`), `201`, en trois temps.

1. `psp-topups.dto.ts` : `parsePspTopupRequest(body)` d'après `PspTopupRequest` de `openapi.yaml`
   (relève la forme finale de WP01 ; le champ `provider` du corps désigne le **moyen**
   `WAVE|ORANGE_MONEY|CARD` dans le contrat actuel, alors que le schéma de la base nomme `method` le
   moyen et `provider` le fournisseur : applique le contrat, **signale** l'ambiguïté). `wallet_id`
   ou `tap_id` (exactement un ; festivalier : `wallet_id` seul, `tap_id` → `422`), `amount` entier ≥
   1, `currency`, `payer_msisdn` facultatif (motif du contrat), `return_url` facultatif (schémas
   `https:` ou `cashless:` seulement). Champ inconnu → `422`.
2. `psp-topup-caller.guard.ts` : voir l'arbitrage ; pose `req.pspCaller = { kind: 'DESK' |
   'CUSTOMER' | 'PERSON' }` à côté de `req.device`, `req.customer`, `req.principal`. Test unitaire
   de la garde : chaque combinaison d'identifiants (terminal sans personne, personne sans terminal,
   festivalier + en-tête de personne, aucun) est refusée sauf les trois autorisées.
3. Route : `@Idempotent({ scope: (req) => device ? counterScope(req) : customerScope(req), writes:
   false, deviceSeq: 'when-device', keyUuid: 'without-device' })` (modèles :
   `media/lifecycle/counter-access.ts` `counterScope`, `media/claims/claims.controller.ts`
   `customerScope`). `Idempotency-Key` obligatoire.
4. `PspTopupsService.request(...)`, **transaction 1** (`TenantTx.run(operatorId)`, courte, base
   seule) :
   a. contexte : guichet → `CounterAccess.authorize` (terminal actif, événement, grand livre,
      devise, `CASHIER`/`SUPERVISOR`) et résolution du portefeuille par `tap_id` ou `wallet_id`
      comme `CashTopupService` (WP09, sans consommer la lecture) ; festivalier → le portefeuille
      doit être **le sien** (`wallet.customer_id` = compte), sinon `404` ; autre prestataire → `404`
      ;
   b. grand livre `LIVE` sinon `409 EVENT_CLOSING` ; devise ≠ celle de l'événement → `422
      CURRENCY_MISMATCH` ; portefeuille `BLOCKED`/`CLOSED` → `WALLET_BLOCKED`
      (`422`, `CL039` : décision de l'orchestrateur ; `contracts/psp.md` écrit 409 : **signale
      l'écart**, ne le corrige pas et ne change pas le mapping) ;
   c. configuration : `resolve_psp_configuration(événement, moyen)` ; absente → `409
      PSP_NOT_CONFIGURED` ;
   d. plafonds estimés (refus anticipé, non garanti) : `readTopupHeadroom(client, walletId, now)` ;
      montant > marge → `422 WALLET_LIMIT_EXCEEDED`/`MONTHLY_TOPUP_LIMIT_EXCEEDED` selon la limite
      en cause ; le contrôle qui fait foi est à la notification (T056) ;
   e. `create_psp_topup(...)` (recharge `PENDING`, au plus 3 `PENDING` par portefeuille et 20 par
      terminal, base) ; refus traduit en `429`/`409` selon le code de problème de WP01/WP07 (jamais
      `500`) ;
   f. audit `PSP_TOPUP_REQUESTED` (auteur, terminal, portefeuille, montant, moyen, configuration ;
      aucun secret). COMMIT.
5. **Hors transaction** : secrets par le port (`psp_configuration_secret_ref` puis
   `PspSecretStore`), `adapter.initiate({ merchantRef: psp_topup_id, amount, currency, method,
   payerMsisdn, returnUrl })`. Échec de l'adaptateur : la recharge **reste `PENDING`**
   (l'interrogation tranche) ; indisponible → `503 PSP_UNAVAILABLE` ; refus du PSP → `422
   PSP_REJECTED` ; jamais le message brut de l'adaptateur dans la réponse (code et motif normalisés
   seulement).
6. **Transaction 2** : `mark_psp_topup_initiated(topup, référence du PSP, échéance)`. Réponse `201`
   : `PspTopup` (identifiant, statut, moyen, `psp_config_id`, référence, montant, devise,
   portefeuille, action de paiement (URL ou instruction), échéance, `transaction_id` nul) et, si
   `psp_fee_bearer = CUSTOMER`, frais estimés calculés avec la règle de la configuration
   (`SqlConfigResolver.resolve` avec `pspConfigurationId`, puis `fee` de `ledger/money`).

Cas limites : rejeu de la même clé après un plantage entre les temps (une seule recharge) ; 4e
recharge `PENDING` du même portefeuille ; 21e du même terminal ; portefeuille d'un autre festivalier
; montant `0`/négatif ; `tap_id` d'un autre événement ; grand livre `CLOSING` ; adaptateur qui lève
une erreur inattendue (`503`, recharge `PENDING`, aucun secret journalisé).

Validation :
- [ ] Aucun appel de l'adaptateur pendant une transaction (espion).
- [ ] Même clé deux fois (y compris reprise après échec de l'adaptateur) : une recharge.
- [ ] Festivalier : jamais le portefeuille d'un autre ; guichet : jamais d'un autre événement.

### T055 — Consultation et annulation d'une recharge

1. `GET /topups/psp/:topup_id` (`getPspTopup`) : `PspTopupCallerGuard` en mode lecture. Visible par
   le **demandeur** (même terminal **et** même personne, ou même festivalier, ces identités étant
   gardées à la création : `requested_by_kind`, `device_id`, `person_id`/`customer_id`) ou par un
   `ORGANIZER_ADMIN` de l'événement (`assertOrganizerScope`) ; sinon `404`, identique à une recharge
   inexistante. Réponse : `PspTopup` avec `failure_reason` si `FAILED`. Lecture seule : aucun appel
   du PSP.
2. `POST /topups/psp/:topup_id/cancel` (`cancelPspTopup`) : demandeur seulement (mêmes règles),
   `@Idempotent` comme T054 (`writes: false`). Étapes : tx 1 lecture (`404` si non demandeur) ;
   recharge ni `PENDING` ni `CANCELLED` → `409 CONFLICT_STATE` ; déjà `CANCELLED` → `200`
   (idempotent) ; **hors transaction** : confirmation d'annulation par l'adaptateur (méthode du port
   de WP07 ; **si le port n'a aucune méthode d'annulation ou de statut qui l'établisse, arrête-toi
   et signale cette lacune de WP07**, n'étends pas le port) ; tx 2 : `SELECT … FOR UPDATE` de la
   ligne, re-contrôle `PENDING`, `cancel_psp_topup`. Si le PSP répond que le paiement est déjà
   réussi : aucune annulation, `409` ; la notification ou l'interrogation créditera. Un succès
   notifié **après** `CANCELLED` suit le tableau (T056).
3. Audit `PSP_TOPUP_CANCELLED`.

Cas limites : annulation concurrente d'une notification de succès (le verrou de ligne sérialise :
soit `CANCELLED` puis succès traité par le tableau, soit `SUCCEEDED` puis `409`) ; annulation d'une
recharge expirée ; autre demandeur du même terminal (autre personne) → `404`.

Validation :
- [ ] Un tiers (autre festivalier, autre personne du même terminal, autre prestataire) reçoit `404`.
- [ ] `CANCELLED` uniquement après confirmation de l'adaptateur (test avec un faux qui refuse).

### T056 — Traitement d'un paiement (tableau des états, verrou de ligne, refus définitifs)

But : `PspPaymentProcessor.process` et `settleUnpaid`, exactement R-11 corrigé par R-20.

1. Première instruction : `PspTopupLookup.findForUpdate` (référence marchande, puis référence du
   PSP, A2). Introuvable → `{ disposition: 'UNMATCHED', outcome: null }`, rien d'écrit. Verrou pris
   **avant** toute lecture de solde (ordre : recharge → portefeuille → comptes).
2. Selon le type de notification et l'état (tableau de `data-model.md`) :
   - `PAYMENT_FAILED` : aucun changement (`NO_EFFECT`) ; `PAYMENT_CANCELLED` : `PENDING` →
     `cancel_psp_topup` (annulation confirmée par le PSP), sinon `NO_EFFECT` ; `SUCCEEDED` :
     `NO_EFFECT` signalé.
   - `PAYMENT_SUCCEEDED` sur `SUCCEEDED` : `DUPLICATE_PAYMENT`, aucune écriture, `depositDue =
     true`.
   - `PAYMENT_SUCCEEDED` sur `PENDING`, `FAILED`, `EXPIRED`, `CANCELLED` : contrôles puis crédit.
3. Contrôles, dans cet ordre (le premier qui échoue décide) : (a) configuration, montant ou devise
   différents de la recharge → anomalie `PSP_MISMATCH`, `MISMATCH`, recharge inchangée ; (b)
   portefeuille `BLOCKED`/`CLOSED` → non crédité `WALLET_BLOCKED` ; (c) grand livre : `isAccepted({
   eventStatus, ledgerStatus, type: 'TOPUP', source: 'PSP_WEBHOOK' })` faux → non crédité
   `LEDGER_STATUS` ; (d) carte : T057 ; (e) plafonds de solde et mensuel : le moteur et la base
   refusent `CL008`/`CL009` → non crédité `PSP_TOPUP_OVER_LIMIT` (ne précalcule pas les frais : la
   base tranche).
4. Crédit : `engine.execute` dans un `SAVEPOINT` : `{ type: 'TOPUP', source: 'PSP_WEBHOOK',
   idempotencyKey: <clé du moyen>, occurredAt: receivedAt, ledgerId, eventId, currency, payload: {
   walletId, channel, amount }, metadata: { psp_topup_id, psp_configuration_id, psp_event_id } }`,
   canal `WAVE` → `WAVE`, `ORANGE_MONEY` → `OM`, `CARD` → `CARTE`. **`psp_configuration_id` en
   métadonnée est obligatoire** : le résolveur de frais de WP10 la lit. Succès :
   `complete_psp_topup(p_psp_topup, p_tx, p_fee_amount, p_provider_payment_ref DEFAULT NULL)`
   (recharge `SUCCEEDED`, la base vérifie la transaction ; frais renseignés ; **refuse la carte** :
   une carte ne se crédite que par `complete_card_topup`, T057) ;
   `outcome = CREDITED`, `depositDue = true`. Écriture rejouée (`replayed`) sur une recharge non
   `SUCCEEDED` : erreur inattendue (remonte).
5. **Refus définitifs du moteur** (`classifyRefusal` dans `psp-refusals.ts`, fonction pure testée) :
   `PERIOD_CLOSED`, `DEBIT_AUTHORITY_EDGE`, portefeuille bloqué ou fermé (`CL039`), compte inactif,
   frais ≥ montant (`BuildError`), `CL002`, plafonds `CL008`/`CL009`. `ROLLBACK TO SAVEPOINT`, puis
   `fail_psp_topup(p_psp_topup, p_reason, p_paid, p_anomaly_kind DEFAULT
   'PSP_TOPUP_NOT_CREDITED', p_card_fingerprint DEFAULT NULL, p_three_ds DEFAULT NULL)` (rend l'id
   de l'anomalie, ou `NULL` si `p_paid` est faux) : recharge `FAILED` + anomalie
   `PSP_TOPUP_NOT_CREDITED` (ou `PSP_TOPUP_OVER_LIMIT` pour les plafonds) dont le **montant est
   l'argent à rendre au payeur** ; `outcome = NOT_CREDITED`. Toute autre erreur est rattrapée par
   aucun `catch` : elle remonte avec la transaction (WP12 : `RETRY`). Table des motifs (constantes
   exportées, restreintes à ce que `0038` accepte) : `THREE_DS`, `NO_FINGERPRINT`, `LEDGER_STATUS`,
   `WALLET_BLOCKED`, `CARD_DAILY_LIMIT`, `WALLET_LIMIT`, `MONTHLY_LIMIT`, `PERIOD_CLOSED`,
   `DEBIT_AUTHORITY_EDGE`, `FEE_EXCEEDS_AMOUNT`, `CANCELLED`, `KEY_CONFLICT`.
6. Recharge déjà `FAILED`/`EXPIRED`/`CANCELLED` et succès non recevable : anomalie
   `PSP_TOPUP_NOT_CREDITED` **une par paiement** (la 2e notification du même paiement n'en ouvre
   pas), motif `CANCELLED` si l'annulation avait été confirmée. `settleUnpaid` : `verdict 'FAILED'`
   → `fail_psp_topup` sans anomalie d'argent (rien n'a été payé) ; `'EXPIRED'` → `expire_psp_topups`
   ciblé sur cette recharge, toujours sous le verrou de ligne, après que l'appelant a relu le
   statut.
7. Audit `PSP_TOPUP_CREDITED` / `PSP_TOPUP_NOT_CREDITED` (FR-031) dans la transaction.

Cas limites : 100 appels concurrents pour le même paiement (le verrou de ligne sérialise : un
crédit, 99 `DUPLICATE_PAYMENT`) ; succès par notification puis par interrogation (même clé, une
écriture) ; recharge créée sans référence du PSP (`initiate` en échec) retrouvée par la référence
marchande ; deux paiements distincts pour une même recharge (le second : `PSP_MISMATCH` ou doublon
selon `0038`, jamais deux crédits).

Validation :
- [ ] Chaque ligne du tableau de `data-model.md` a un test (état × notification).
- [ ] Un refus du moteur laisse recharge `FAILED`, anomalie portant le montant, aucune ligne au
      grand livre.
- [ ] Aucun `500` pour un refus connu ; une erreur inattendue remonte intacte.

### T057 — Carte : 3-D Secure, empreinte, plafond par carte, `CARD_VELOCITY`

`card-checks.ts`, appelé par T056 pour `method = CARD` avant le crédit.

1. 3-D Secure : seul `SUCCEEDED` explicite crédite ; `FAILED`, `NOT_PERFORMED`, absent → non crédité
   `THREE_DS`. Empreinte absente ou vide → `NO_FINGERPRINT` (FR-024, A11).
2. Plafond par carte et par jour : `complete_card_topup(p_psp_topup, p_tx, p_fee_amount,
   p_card_fingerprint, p_three_ds, p_provider_payment_ref DEFAULT NULL)` (retour `void`) prend
   `pg_advisory_xact_lock(grand livre, empreinte)`, **puis** contrôle `card_topups_today(p_ledger,
   p_fingerprint, p_at)` (qui prend elle-même le verrou consultatif) de
   l'empreinte sur le jour UTC de `receivedAt` + montant contre `card_topup_daily_max_per_card` (lu
   par `CascadeService.resolveForEvent(client, eventId, receivedAt)`), et enregistre empreinte et
   `three_ds` sur la recharge. Le verrou est tenu jusqu'à la fin de la transaction, qui contient
   aussi le crédit : deux cartes identiques simultanées sont sérialisées. Dépassement strict →
   `CARD_DAILY_LIMIT` (anomalie `PSP_TOPUP_OVER_LIMIT`) ; égalité acceptée. Si `0038` fait passer
   `SUCCEEDED` dans `complete_card_topup`, adapte l'ordre mais garde : verrou avant contrôle,
   contrôle avant écriture, tout dans la même transaction. `wallet_card_count(p_wallet,
   p_fingerprint)` sert `CARD_VELOCITY` (point 3).
3. `CARD_VELOCITY` (FR-026) : après un crédit, si l'empreinte est **nouvelle** pour ce portefeuille
   et que `wallet_card_count` atteint `card_alert_cards_per_wallet`, anomalie `CARD_VELOCITY`
   (montant 0, une fois par portefeuille et par empreinte nouvelle ; rejeu de la même notification :
   pas de seconde).
4. La notification ne porte jamais le numéro de carte : n'enregistre, ne journalise ni n'audite que
   l'empreinte (opaque) ; aucun champ libre de l'adaptateur n'est copié tel quel en base.

Validation :
- [ ] 3-D Secure absent, `NOT_PERFORMED`, `FAILED` : non crédité ; `SUCCEEDED` : crédité.
- [ ] Limite : `max − 1` accepté, égalité acceptée, `max + 1` refusé ; jour suivant UTC : compteur
      neuf.
- [ ] Deux notifications simultanées de la même empreinte au-delà du plafond cumulé : une seule
      créditée.

### T058 — Caution due après un crédit PSP (aussi sur le chemin doublon)

1. `PspPaymentProcessor.afterCommit(operatorId, outcome, audit)` : si `outcome.depositDue` et
   `outcome.walletId`, appelle `DepositService.takeDueDepositForWallet(operatorId, walletId, audit)`
   (WP09) dans **sa propre transaction** (celle de la méthode). Aucune caisse : caution prélevée sur
   le solde seulement (R-06, mode `FROM_BALANCE`). Erreur : journal sans donnée personnelle
   (`wallet_id`, code de problème), jamais relancée ; la caution reste `DUE`.
2. `depositDue` est vrai pour `CREDITED` **et** `DUPLICATE_PAYMENT` (A33 : un crédit passé sans
   caution prise est repris au doublon suivant) ; faux pour `NOT_CREDITED`, `MISMATCH`, `NO_EFFECT`,
   `UNMATCHED`.
3. Idempotent : le moteur ne reprend pas une caution `HELD`.

Cas limites : portefeuille sans bracelet (retour `null`) ; caution supérieure au solde (reste `DUE`)
; échec simulé de la prise (le crédit et la recharge `SUCCEEDED` restent).

Validation :
- [ ] La prise a lieu après le COMMIT (lecture concurrente : crédit visible avant la caution).
- [ ] Un échec de caution n'altère ni le crédit, ni l'issue, ni la réponse de la notification.

### T059 — Tests d'intégration des recharges

Voir « Test Strategy ». Fixtures partagées dans `psp-fixtures.ts` (prestataire, organisateur,
événement `LIVE` avec grand livre, configuration `ACTIVE` par moyen avec règle de frais, terminal
`TOPUP_DESK` et agent, festivalier (faux de la 5b), portefeuilles, bracelets avec caution due) :
WP12 et WP13 les réutilisent sans copie, soigne leur lisibilité.

## Test Strategy

Pgtap n'est pas touché par ce lot. Jest ciblé sur ta base propre : `npm run reset-db -w
@cashless/ledger-sql` (base `cashless_wp11`, variables d'environnement du worktree), puis `cd
apps/api && npx jest --runInBand topups/psp`, `npm run lint` et `npm run typecheck`. Suites :
- `psp-request.spec.ts` (T054, HTTP réel) : guichet et festivalier, plafonds en attente,
  configuration absente, adaptateur indisponible / refusant, rejeu de clé, aucun appel sous
  transaction. *Mutations* : appel de l'adaptateur dans `TenantTx.run` ; deux recharges pour une
  clé.
- `psp-read-cancel.spec.ts` (T055). *Mutation* : annulation sans confirmation.
- `psp-process.spec.ts` (T056, appels directs du service dans `TenantTx.run`, notifications
  construites à la main avec `receivedAt` fixé) : tout le tableau, `MISMATCH`, refus définitifs,
  `UNMATCHED`, une anomalie par paiement. *Mutations* : verrou de ligne retiré ; clé sans
  configuration ; `PAYMENT_FAILED` qui finalise ; crédit malgré un montant différent.
- `psp-card.spec.ts` (T057), `psp-deposit.spec.ts` (T058).
- `psp-concurrency.spec.ts` : 100 `process` simultanés du même paiement (notifications aux
  identifiants distincts et interrogation mêlées) → 1 `TOPUP`, 1 solde crédité ; `process` contre
  `cancel` ; aucun interblocage (ordre recharge → portefeuille → comptes). `cashless_test` est
  réservée à l'orchestrateur, qui rejoue en série. Aucune comparaison entre l'horloge de Node et
  celle de la base (Docker, qui peut reculer) ; les dates passent par `receivedAt`. Lignes de 100
  caractères.

## Definition of Done

- [ ] Sous-tâches T054 à T059 faites ; `spec-kitty agent tasks mark-status Txxx --status done
      --mission recharges-caisses-psp-01M5YEBA` pour chacune.
- [ ] Lint, types, Jest ciblé verts ; aucune suite existante cassée ; aucune nouvelle dépendance.
- [ ] Noms et signatures du « contrat de service » conservés, **recopiés tels quels dans le compte
      rendu** (WP12 et WP13 les lisent).
- [ ] Compte rendu du lot, en fin de ce fichier : écarts au plan (avec leur sens), retouches hors
      carte justifiées, points soumis au porteur, lacunes de base ou de port (identifiant
      déterministe, annulation), contradictions signalées (`WALLET_BLOCKED` 409 / 422, `provider` /
      `method`), **fichiers à faire relire par une personne** (au moins `psp-payment-processor.ts`,
      `card-checks.ts` et `psp-topup-caller.guard.ts` : argent, 3-D Secure, authentification),
      critères couverts (FR-012, FR-013, FR-016, FR-017, FR-018, FR-024, FR-025, FR-026) avec
      **commande et résultat** pour la matrice d'acceptation.

## Risks

- Double crédit : verrou de ligne oublié, clé d'écriture non qualifiée, doublon non vu.
- Crédit d'un paiement non conforme (montant, devise, configuration) ou carte sans 3-D Secure.
- Appel réseau sous verrou (blocage de tout un portefeuille) ; double recharge sur reprise de clé.
- Garde composée mal faite : un festivalier qui passe pour un guichet, ou l'inverse.
- Refus définitif transformé en `500` en boucle ; anomalie sans montant ou en double.
- Plafond par carte contourné par concurrence ; jour calculé sur une horloge comparée à la base.

## Reviewer Guidance

Tenter de casser : deux notifications simultanées du même paiement ; notification de succès pour un
montant ou une devise différents ; succès puis annulation puis succès ; carte avec `NOT_PERFORMED`,
sans empreinte, deux fois la même empreinte à la limite ; jour UTC limite (23:59:59 / 00:00:00) ;
recharge d'un autre festivalier ou d'un autre terminal lue ou annulée ; la même clé d'idempotence
rejouée après un plantage ; adaptateur appelé dans une transaction ; guichet sans jeton de personne,
festivalier avec un jeton de personne ; clé d'écriture identique pour deux configurations ; anomalie
en double ; caution prise avant le COMMIT ; secret ou empreinte complète dans un journal ; test qui
« prouve » l'unicité sans verrou réel (séquentiel) ; test qui s'appuie sur l'horloge de la base.
Vérifier que chaque mutation listée est réellement tuée.
