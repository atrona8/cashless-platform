---
work_package_id: WP13
title: Contestations et déblocage
dependencies: [WP12]
requirement_refs: [FR-027, FR-028]
planning_base_branch: feat/recharges-caisses-psp
merge_target_branch: feat/recharges-caisses-psp
branch_strategy: Planning artifacts for this mission were generated on feat/recharges-caisses-psp. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/recharges-caisses-psp unless the human explicitly redirects the landing branch.
subtasks: [T065, T066, T067, T068]
phase: Phase 4 - PSP
history:
- timestamp: '2026-10-27T15:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent: claude
model: sonnet
agent_profile: implementer-ivan
role: implementer
authoritative_surface: apps/api/src/chargebacks/
execution_mode: code_change
owned_files: [apps/api/src/chargebacks/**, apps/api/test/integration/chargebacks/**]
create_intent: [apps/api/src/chargebacks/chargebacks.module.ts, apps/api/src/chargebacks/chargeback.service.ts, apps/api/src/chargebacks/dispute-handler.ts, apps/api/src/chargebacks/late-chargeback-action.ts, apps/api/src/chargebacks/wallet-unblock-action.ts, apps/api/src/chargebacks/chargebacks.dto.ts, apps/api/src/chargebacks/chargebacks.controller.ts, apps/api/test/integration/chargebacks/approval-routes.spec.ts, apps/api/test/integration/chargebacks/chargeback.spec.ts, apps/api/test/integration/chargebacks/late-chargeback.spec.ts, apps/api/test/integration/chargebacks/wallet-unblock.spec.ts, apps/api/test/integration/chargebacks/chargeback-concurrency.spec.ts, apps/api/test/integration/chargebacks/chargeback-fixtures.ts]
tags: []
tracker_refs: []
---

# Work Package Prompt: WP13 – Contestations et déblocage

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche de contexte d'implémentation fournie par
l'orchestrateur, ce prompt, puis seulement, dans `kitty-specs/recharges-caisses-psp-01M5YEBA/` :
- `spec.md` : FR-027, FR-028, NFR-001, NFR-008, Edge Cases (contestation), contradiction 4
  (`A-PSP-*` négatif permis, ADR-77) ;
- `research.md` : R-14 et **R-20** (qui fait foi), en particulier « Contestations et argent non
  crédité » ; `research-adversarial.md` : A14, A16 ;
- `data-model.md` : `psp_chargeback`, `psp_topup`, extensions (`approval_request.action`,
  `anomaly.kind`) ;
- `contracts/psp.md` : « Contestations » (13, 14) et tableau des écritures ;
  `contracts/database-rights.md` (`record_chargeback`, `block_wallet_after_chargeback`,
  `unblock_wallet`) ;
- `plan.md` IC-08 ; `docs/DECISIONS_ADR.md` ADR-74, ADR-75, ADR-77 ; `docs/SPECIFICATION.md` ligne
  `CHARGEBACK` du tableau des écritures et le paragraphe « Contestation tardive » (§12.1).

Code à lire :
- `apps/api/src/ledger/builders/festival/refund.ts` (`buildChargeback` : débit du solde payé jusqu'à
  son montant, reste aux pertes du payeur du contrat, crédit `A-PSP-<canal>` ; canal carte =
  `CARTE`) ;
- `apps/api/src/ledger/ledger-engine.service.ts` (`execute`, `enrich` du cas `CHARGEBACK` qui lit
  les soldes) et `ledger/status-matrix.ts` (`CHARGEBACK` accepté jusqu'à `CLOSED` ; grand livre
  `LOCKED` : source `BACKOFFICE` seulement) ;
- `packages/ledger-sql/schema_grand_livre_cashless.sql`, fonction `check_late_claim` (branche
  `CHARGEBACK`, `CL024`) ; migration `0038_psp_topups.sql` (WP04) pour les signatures réelles ;
- `apps/api/src/reversals/sale-reversal-action.ts` (**modèle** d'une action à deux personnes :
  portée figée lue en base, rôles bornés, `SQL_FAILURES`, `request(...)`) et `reversals.module.ts` ;
- `apps/api/src/approval/action-registry.ts`, `approval.service.ts` (`request`, exécution, `FAILED`)
  ;
- les comptes rendus de WP11 (processeur de paiement, nom exact, fixtures) et de WP12 (couture
  `PSP_DISPUTE_HANDLER`, `DispatchOutcome`, `EventDispatcher`).

Priorité des sources (SPECIFICATION §0.3) : tests exécutables > schéma SQL, `openapi.yaml`,
`sync_protocol.md` > SPECIFICATION > `PRD.md` ; toute contradiction est **signalée**, jamais
tranchée en silence. Ne modifie jamais un `.sql` généré de `packages/ledger-sql/` ; ce lot ne touche
à aucun fichier SQL.

## Objective

Traiter la notification `DISPUTE` : écrire `CHARGEBACK` rattaché à la recharge d'origine, une seule
fois par contestation et jamais au-delà du montant net restant, bloquer le portefeuille si le solde
payé ne couvre pas le montant ; après le verrouillage du grand livre, ne rien écrire à la réception
mais ouvrir l'anomalie `LATE_CHARGEBACK` et la demande d'approbation à deux ; et déblocage d'un
portefeuille par l'action `WALLET_UNBLOCK` à deux. Tout ou rien (NFR-008).

## Context

- Concern IC-08 (contestations). Constats : **A14** (contestation sans recharge créditée), **A16**
  (aucune écriture d'attente), R-14 (blocage, tardive, déblocage), ADR-77 (`A-PSP-*` négatif permis
  : le crédit du compte PSP par un `CHARGEBACK` le fait descendre, c'est normal ; l'alerte des
  comptes chauds est hors de ce lot).
- Dépend de WP12 : la couture `PSP_DISPUTE_HANDLER` et le traitement après conservation de
  l'événement (`RECEIVED` → `PROCESSED`/`UNMATCHED`/`RETRY`). Dépend de WP11 : la recharge, son
  verrou `FOR UPDATE`, ses fixtures. Ce lot **ne modifie pas** `webhooks/` ni `topups/` : il fournit
  un module qui enregistre un fournisseur de `PSP_DISPUTE_HANDLER`.
- Dépend de ce lot : WP14 (parcours : contestation d'une recharge carte ; 100 rejeux ; isolation).
- Fonctions de la base (noms du contrat, signatures exactes dans `0038`) : `record_chargeback`
  (unicité `(configuration, contestation)`, plafond = montant net crédité moins les contestations
  déjà écrites, exige recharge `SUCCEEDED`, `topup_tx_id`, moyen `CARD`, même devise),
  `block_wallet_after_chargeback`, `unblock_wallet` (vérifie une demande `WALLET_UNBLOCK`
  approuvée). **Si une fonction nécessaire manque** (rattacher la transaction `CHARGEBACK` écrite
  plus tard à `psp_chargeback`, ouvrir l'anomalie `LATE_CHARGEBACK`, créer la demande), arrête-toi
  sur ce point et signale la lacune à l'orchestrateur : aucun SQL ici, aucun `INSERT`/`UPDATE`
  direct pour `cashless_app`.

**Règle de sécurité du projet (`CLAUDE.md`, règle 1)** : si un point de ce lot ne peut être tenu
qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé,
faux gardé), **arrête-toi sur ce point et soumets-le au porteur avant de coder**, avec le risque et
les options ; continue le reste. Un renforcement se fait, puis se consigne. Aucun faux en production
; aucune nouvelle dépendance npm (R-18).

## Arbitrages de l'orchestrateur (27/10/2026)

Dans le sens le plus strict ou de pure répartition. Ils priment sur le reste du prompt.

- **Préconditions de la contestation (A14)** : recharge retrouvée par `(configuration, référence de
  paiement)`, statut `SUCCEEDED`, `topup_tx_id` non nul, moyen `CARD`, même devise et même
  configuration que la notification. Sinon : aucune écriture au grand livre, anomalie
  `PSP_MISMATCH`, événement `PROCESSED` avec `outcome = MISMATCH`. Jamais `UNMATCHED` pour une
  contestation dont la recharge est connue mais inéligible ; `UNMATCHED` seulement si la recharge
  est introuvable (WP12 reprend 24 h, puis `PSP_MISMATCH`).
- **Une contestation = une écriture** : clé du moteur `psp:<configuration>:<id de contestation>`
  (contrat du plan). Un rejeu, une seconde notification du même identifiant de contestation, ou la
  même contestation reçue deux fois avec des montants différents n'écrit qu'une fois ; le second
  montant est ignoré et signalé (`NO_EFFECT`), jamais appliqué.
- **Ordre des verrous** : recharge `FOR UPDATE` (pris par le processeur de WP11 ou, ici, par la
  première instruction du gestionnaire) → portefeuille → comptes. Jamais l'inverse.
- **Blocage** : le portefeuille est bloqué quand le solde payé lu **sous verrou, avant l'écriture**
  est inférieur au montant contesté (le reste va aux pertes du payeur du contrat). Blocage et
  écriture dans la **même** transaction : l'un sans l'autre est impossible (NFR-008). Un solde payé
  suffisant : pas de blocage.
- **Contestation tardive à deux personnes humaines** : la demande `LATE_CHARGEBACK` est créée par
  une personne du back-office (auteur) et approuvée par une **autre** ; une demande « créée par le
  système » avec un seul valideur humain affaiblirait la règle des deux personnes (règle 1 de
  `CLAUDE.md`) : **ne la code pas**. La réception ouvre l'anomalie `LATE_CHARGEBACK` (montant, grand
  livre) et enregistre la contestation `late = true`, `chargeback_tx_id` nul ; la demande est créée
  par `LateChargebackActions.request` (service, sur le modèle de `SaleReversalActions.request`),
  servi par la route `requestLateChargeback` ajoutée par WP01 (arbitrage du 27/10/2026) :
  `POST /chargebacks/{chargeback_id}/approval-requests`, `humanBearer`, `Idempotency-Key`, corps
  vide, `202` avec l'`ApprovalRequest`, `ORGANIZER_ADMIN` ou `OPERATOR_ADMIN`. Relis `openapi.yaml`
  ;
  si la route n'y est pas (WP01 non fusionné), arrête-toi sur ce point et signale-le.
- **Rôles** : `LATE_CHARGEBACK` : `ORGANIZER_ADMIN` ou `OPERATOR_ADMIN` de l'événement
  (SPECIFICATION : « rôle de l'opération (back-office) »), auteur et valideur distincts, bornés par
  une constante testée (aucun autre rôle). `WALLET_UNBLOCK` : `ORGANIZER_ADMIN` seul (FR-028), deux
  personnes. Si tu juges ce choix trop large ou trop étroit, signale-le : c'est une décision de rôle
  à confirmer par le porteur.
- **Portée figée à la demande** : l'événement de la recharge (contestation) ou du portefeuille
  (déblocage) est lu **en base** à la création et figé dans la charge utile ; jamais lu dans un
  corps de requête.
- Pas de remboursement ni d'écriture d'attente pour l'argent d'un paiement non crédité (OP-N82 /
  A16).

- **Contrat de WP11 consommé ici (noms exacts)** : `PspTopupLookup.findForUpdate(client,
  {configurationId, merchantRef?, providerRef?})` pour retrouver et verrouiller la recharge (ne
  recopie pas la corrélation) ; `PspPaymentProcessor.process(client, PaymentInput): PaymentOutcome`,
  `settleUnpaid` et `afterCommit(operatorId, outcome, audit)` sont ceux de WP11/WP12 : ce lot
  n'appelle pas `process` pour une contestation, mais ne le contourne pas non plus pour le verrou.
- **Fonctions de WP04** : `record_chargeback`, `block_wallet_after_chargeback`, `unblock_wallet` et
  `attach_chargeback_tx(…)` (rattache la transaction `CHARGEBACK` à `psp_chargeback`) ; la dernière
  est accordée par WP05. Si le nom ou la signature diffère dans `0038`, suis `0038` et signale-le.
- **Noms de WP07 (font foi)** : types `NormalizedNotification` (champ `dispute`) et
  `NormalizedPayment`, `FakePspAdapter`, `signFakeNotification` pour signer les notifications de
  test ; jeton `PSP_ADAPTERS`.
- **Routes de demande (WP01)** : `requestLateChargeback`
  (`POST /chargebacks/{chargeback_id}/approval-requests`) et `requestWalletUnblock`
  (`POST /wallets/{wallet_id}/unblock/approval-requests`) : chemins identiques à WP01. Contrôleur
  `chargebacks.controller.ts` (dans `chargebacks/**`), test `approval-routes.spec.ts` (`202`, rôles,
  `404` hors prestataire, rejeu de clé, `PLATFORM_ADMIN` refusé).
- **`AuditAction` (règle commune de `tasks.md`)** : valeurs ajoutées par ce lot, en retouche hors
  carte d'une ligne chacune, en fin d'union de `apps/api/src/audit/audit.service.ts` :
  `CHARGEBACK_RECORDED`, `LATE_CHARGEBACK_REQUESTED`, `WALLET_UNBLOCK_REQUESTED`,
  `WALLET_UNBLOCKED`. L'orchestrateur résout les conflits de fusion.
- **`WALLET_BLOCKED`** reste `422` (`CL039`) ; codes `CL043`, `CL044` (409) de `0038` mappés dans
  `errors/sqlstate-map.ts` (retouche d'une ligne si absents).
## Branch Strategy

Planification et fusion sur `feat/recharges-caisses-psp`. Dépendance : WP12. Worktree attribué par
lane d'après `lanes.json`. Commande : `spec-kitty agent action implement WP13 --agent claude
--mission recharges-caisses-psp-01M5YEBA`.

Retouches hors carte autorisées, d'une ligne chacune et consignées : `apps/api/src/app.module.ts`
(import de `ChargebacksModule`, fichier de WP07) ; `apps/api/src/errors/sqlstate-map.ts` (code de
base sans traduction, fichier de WP07). Aucune autre.

## Subtasks

### T065 — Contestation : `record_chargeback`, `CHARGEBACK`, blocage

But : `DisputeHandler` (`dispute-handler.ts`) enregistré sous `PSP_DISPUTE_HANDLER`, et
`ChargebackService.apply(...)`.

1. `ChargebacksModule` : fournit `{ provide: PSP_DISPUTE_HANDLER, useClass: DisputeHandler }`,
   importe le moteur (`LedgerModule`), l'audit et le résolveur de configuration comme
   `ReversalsModule`. Il est importé par `AppModule` (retouche d'une ligne).
2. `handle(client, event, notification)` (dans la transaction 2 de WP12, jamais plus) : a. `SELECT …
   FOR UPDATE` de la recharge retrouvée par la référence marchande, puis par la référence du PSP
   (même corrélation que WP11 : réutilise sa fonction, ne la recopie pas) ; introuvable →
   `UNMATCHED` ; b. préconditions de l'arbitrage ; sinon `PSP_MISMATCH` (anomalie par la fonction
   existante) ; c. grand livre : lis son statut. `LOCKED` → T066. Sinon suite ; d.
   `record_chargeback(recharge, id de contestation, montant)` : doublon → `NO_EFFECT` sans écriture
   ; dépassement du montant restant → refus de la base (`CLxxx`, vois `0038`) traduit en
   `PSP_MISMATCH` avec motif `OVER_REMAINING` (aucune écriture, événement `PROCESSED`), jamais en
   `500` ; e. solde payé : lecture du solde `WALLET_PAID` du portefeuille sous verrou (comme
   `enrich`) ; f. moteur : `engine.execute(client, { type: 'CHARGEBACK', source: 'PSP_WEBHOOK',
   idempotencyKey: 'psp:<configuration>:<contestation>', occurredAt: <heure de réception>, ledgerId,
   eventId, currency, payload: { walletId, channel: 'CARTE', amount }, metadata: { psp_topup_id,
   dispute_id } })` ; g. rattache la transaction à `psp_chargeback` (fonction de la base) ; si le
   solde payé < montant : `block_wallet_after_chargeback(wallet, chargeback)` ; h. rend
   `DispatchOutcome` `PROCESSED`, `outcome = CHARGEBACK`.
3. Erreurs : refus **définitif** du moteur (période close, compte inactif…) : l'écriture est
   impossible ; le gestionnaire n'a pas à inventer un état : événement `RETRY` s'il est inattendu,
   sinon `PSP_MISMATCH` avec le motif ; signale tout cas que tu ne sais pas classer. Aucune écriture
   partielle : la transaction 2 est annulée en entier avant de marquer `RETRY`.
4. Audit (FR-031) : une entrée par contestation traitée (auteur = système/PSP, terminal néant, date)
   par `AuditService`, même modèle que `SaleReversalActions`.

Cas limites : montant contesté supérieur au solde payé et aux pertes (le builder couvre le reste par
les pertes du payeur) ; portefeuille déjà `BLOCKED` (le blocage est idempotent, pas d'erreur) ; deux
contestations distinctes de la même recharge dont la somme dépasse le net : la seconde est refusée ;
carte déjà remboursée par `WALLET_REFUND` (le solde payé est nul, tout va aux pertes) ; recharge
Wave ou Orange Money contestée (moyen non `CARD` : `PSP_MISMATCH`).

Validation :
- [ ] Solde suffisant : `CHARGEBACK` seul, portefeuille actif. Insuffisant : portefeuille `BLOCKED`,
      pertes du payeur (`ORGANIZER` puis `OPERATOR` selon le contrat) débitées du reste.
- [ ] Rejeu de la notification et second identifiant de notification pour la même contestation : 1
      écriture.
- [ ] `A-PSP-CARTE` crédité de la contestation et autorisé à devenir négatif.

### T066 — Contestation tardive : `LATE_CHARGEBACK` et approbation

But : à la réception sur grand livre `LOCKED`, rien au grand livre ; à l'approbation, écriture dans
les bornes de `check_late_claim`.

1. Réception (suite de `handle`, branche `LOCKED`) : `record_chargeback(..., late = true)` (la
   contestation est conservée, `chargeback_tx_id` nul), anomalie `LATE_CHARGEBACK` (montant, grand
   livre) ; **aucune** écriture de `journal_transaction` ; événement `PROCESSED`, `outcome =
   CHARGEBACK`. Rejeu : toujours une seule anomalie et une seule contestation.
2. `late-chargeback-action.ts`, classe `LateChargebackActions` sur le modèle de
   `SaleReversalActions` :
   - constante `LATE_CHARGEBACK_ROLES = ['ORGANIZER_ADMIN', 'OPERATOR_ADMIN']` ;
   - `request(client, operatorId, { chargebackId }, actor)` : lit en base la contestation (`late =
     true`, `chargeback_tx_id` nul, anomalie ouverte), son événement, fige la portée `EVENT` dans la
     charge utile (`chargeback_id`, `scope_type`, `scope_id`), puis `ApprovalService.request` (rôle
     de l'auteur contrôlé sur l'événement) ; une seconde demande pour la même contestation : refusée
     tant qu'une est `PENDING` ou `EXECUTED` ;
   - définition enregistrée dans `ApprovalActionRegistry` : `validate` (champs exacts, UUID),
     `scopeOf`, `execute`.
3. `execute(client, { request, payload, requestedBy, approvedBy })` : relit la contestation sous
   verrou ; déjà écrite → `FAILED` « déjà écrite » ; écrit par le moteur `CHARGEBACK`, source
   `BACKOFFICE`, clé `psp:<configuration>:<contestation>` (la **même** que la voie normale : une
   notification rejouée après l'approbation ne peut pas écrire une seconde fois), `createdBy` =
   `requestedBy`, `approvedBy`, `metadata.approval_request_id` ; rattache la transaction à la
   contestation ; bloque le portefeuille si le solde payé ne couvrait pas ; clôt l'anomalie par la
   fonction existante si elle existe (sinon la laisse ouverte et le signale). Retourne `{ result,
   executedTxId }`.
4. Erreurs de l'exécution traduites en `FAILED` avec message lisible (table `SQL_FAILURES` comme le
   modèle) : `CL024` (hors bornes de `check_late_claim`), date `late_claims_until` dépassée,
   portefeuille introuvable, `23505` (déjà écrite). La demande `FAILED` ne laisse aucune écriture.
5. Si le grand livre n'est plus `LOCKED` à l'approbation (statut changé) : l'exécution suit le
   chemin de la source en vigueur ; signale-le si le moteur le refuse.

Validation :
- [ ] Réception sur `LOCKED` : 0 transaction, 1 anomalie, 1 contestation `late`.
- [ ] Approbation par une seconde personne : 1 transaction `BACKOFFICE`, bornes respectées ; même
      personne, ou rôle hors liste : refus.
- [ ] Contestation hors bornes : demande `FAILED`, rien d'écrit.

### T067 — Déblocage : action `WALLET_UNBLOCK`

1. `wallet-unblock-action.ts`, classe `WalletUnblockActions` : `requiredRole: 'ORGANIZER_ADMIN'`,
   `scopeOf` = événement du portefeuille figé à la création, `validate` : `{ wallet_id }` (UUID) +
   portée ; `request(client, operatorId, { walletId }, actor)` lit l'événement du portefeuille **en
   base** (portefeuille d'un autre prestataire ou événement : `404` sans fuite).
2. Conditions de la demande : portefeuille `BLOCKED` et bloqué par une contestation (au moins une
   ligne `psp_chargeback` avec `wallet_blocked`). Un portefeuille bloqué pour une autre cause
   (perte, fraude) : `409`, jamais débloqué par cette voie.
3. `execute` : `unblock_wallet(wallet, request.id)` (la base revérifie la demande approuvée et les
   deux personnes) ; audit `WALLET_UNBLOCKED`. Échec de la base → `FAILED` avec message, état
   inchangé.
4. Route : `requestWalletUnblock` (WP01) : `POST /wallets/{wallet_id}/unblock/approval-requests`,
   corps vide, `humanBearer`, `Idempotency-Key`. Expose-la sur le modèle de
   `reversals.controller.ts` (`@Idempotent({ scope: 'bo:', keyUuid: true })`, `respondAccepted`,
   `202` avec la demande, `ORGANIZER_ADMIN` sur l'événement). Relis `openapi.yaml` ; si elle n'y
   est pas, arrête-toi et signale-le. L'approbation et le rejet passent par les routes générales
   `approval-requests`.
5. Effet : après exécution, le portefeuille est `ACTIVE`, un paiement est de nouveau possible ; la
   contestation ne se rejoue pas.

Validation :
- [ ] Demande + seconde personne : portefeuille débloqué ; même personne : refus ; `ORGANIZER_ADMIN`
      d'un autre événement ou prestataire : refus sans fuite.
- [ ] Portefeuille non bloqué ou bloqué hors contestation : `409`, rien ne change.

### T068 — Tests des contestations

Intégration (vraie base `cashless_wp13`, faux PSP signeur de WP07, fixtures de WP11 ; un fichier
`chargeback-fixtures.ts` pour les recharges carte créditées et les portefeuilles) :
- `chargeback.spec.ts` : cas de T065 ; contestation par notification signée complète (de la
  réception à l'écriture) ; recharge non `CARD`, non créditée, devise différente → `PSP_MISMATCH` ;
  recharge introuvable → `UNMATCHED` puis `PSP_MISMATCH` après 24 h (WP12) ; **NFR-008** : erreur
  injectée au moteur → aucune ligne dans `psp_chargeback`, aucune écriture, portefeuille inchangé.
- `late-chargeback.spec.ts` : cas de T066 ; borne `check_late_claim` ; `late_claims_until` dépassée.
- `wallet-unblock.spec.ts` : cas de T067 ; rôles bornés (`LATE_CHARGEBACK_ROLES` et `WALLET_UNBLOCK`
  : test qui échoue si un rôle s'ajoute).
- `chargeback-concurrency.spec.ts` : 20 notifications `DISPUTE` identiques en parallèle → 1
  `CHARGEBACK` ; une contestation pendant que le portefeuille dépense son solde payé (ordre des
  verrous, pas d'interblocage, résultats cohérents avec l'ordre de passage) ; deux contestations
  dont la somme dépasse le net → une seule.
- Isolation : prestataire B ne voit ni ne débloque la contestation ou le portefeuille de A (`404`).
  Mutations à tuer : blocage non fait quand le solde ne suffit pas ; plafond net remplacé par le
  montant brut ; clé de la voie tardive différente de la clé normale ; rôle supplémentaire accepté ;
  écriture à la réception sur `LOCKED`.

## Test Strategy

Pas de pgTAP dans ce lot. Jest ciblé sur ta base propre : `npm run reset-db -w @cashless/ledger-sql`
(base `cashless_wp13`), puis `cd apps/api && npx jest --runInBand chargebacks`, `npm run lint`, `npm
run typecheck`. `cashless_test` est réservée à l'orchestrateur, qui rejoue en série. Aucune
comparaison de l'horloge de Node à celle de la base (Docker) : la date `late_claims_until` se
construit à partir de la base ou de valeurs posées par l'amorçage. Lignes de 100 caractères.

## Definition of Done

- [ ] T065 à T068 faites ; `spec-kitty agent tasks mark-status Txxx --status done --mission
      recharges-caisses-psp-01M5YEBA` pour chacune.
- [ ] Lint, types, Jest ciblé verts ; aucune nouvelle dépendance ; retouches hors carte consignées.
- [ ] Compte rendu du lot en fin de ce fichier : écarts au plan (sens), points soumis au porteur
      (rôles de `LATE_CHARGEBACK`), routes `requestLateChargeback` et `requestWalletUnblock`
      servies, manques de base (fonctions de rattachement), **fichiers à faire relire par une
      personne**
      (`late-chargeback-action.ts` : écriture en source `BACKOFFICE` dans un grand livre
      verrouillé), critères couverts (FR-027, FR-028) avec **commande et résultat** pour la matrice
      d'acceptation.

## Risks

- Double écriture d'une même contestation (voie normale + tardive, rejeu, deux identifiants).
- Plafond calculé sur le brut au lieu du net ; contestation d'une recharge non créditée.
- Blocage non atomique avec l'écriture ; portefeuille bloqué à tort ou jamais.
- Écriture dans le grand livre verrouillé hors des bornes (`CL024`) ou sans deux personnes.
- Demande tardive créée par le système (contourne la règle des deux personnes).
- Déblocage d'un portefeuille bloqué pour une autre cause.

## Reviewer Guidance

Tenter de casser : même contestation par la voie normale puis tardive (clé identique ?) ; montant de
rejeu différent ; contestation d'une recharge Wave ; seconde contestation qui dépasse le net ;
blocage omis quand le solde payé est tout juste égal au montant (limite exacte) ; portefeuille
dépensé en concurrence ; approbation par l'auteur de la demande ; rôle `CASHIER`, `SUPERVISOR` ou
`PLATFORM_ADMIN` sur `LATE_CHARGEBACK` et `WALLET_UNBLOCK` ; demande d'un autre événement ; écriture
à la réception sur `LOCKED` ; exécution tardive après `late_claims_until` ; `WALLET_UNBLOCK` sur un
portefeuille perdu ; test qui n'échoue pas si le blocage est retiré ; test qui « prouve »
l'atomicité sans erreur injectée.
