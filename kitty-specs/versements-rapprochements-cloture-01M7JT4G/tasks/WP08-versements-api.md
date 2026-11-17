---
work_package_id: WP08
title: Versements (API)
dependencies: [WP01, WP06]
requirement_refs: [FR-009, FR-010, FR-011, FR-012, FR-024, NFR-001, NFR-004]
planning_base_branch: feat/versements-rapprochements-cloture
merge_target_branch: feat/versements-rapprochements-cloture
branch_strategy: Planning artifacts for this mission were generated on feat/versements-rapprochements-cloture. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/versements-rapprochements-cloture unless the human explicitly redirects the landing branch.
subtasks: [T035, T036, T037, T038, T039]
phase: Phase 3 - Services et routes
agent: claude
history:
- timestamp: '2026-11-17T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/payouts/
create_intent: [apps/api/src/payouts/payouts.module.ts, apps/api/src/payouts/entitlements.ts, apps/api/src/payouts/payout-action.ts, apps/api/src/payouts/payout-batches.controller.ts, apps/api/src/payouts/payouts.controller.ts, apps/api/src/payouts/payouts.service.ts, apps/api/src/payouts/payouts.dto.ts, apps/api/test/unit/payouts/payout-roles.spec.ts, apps/api/test/integration/payouts/entitlements.spec.ts, apps/api/test/integration/payouts/payout-batch.spec.ts, apps/api/test/integration/payouts/payout-export.spec.ts, apps/api/test/integration/payouts/payout-confirm.spec.ts, apps/api/test/integration/payouts/payout-concurrency.spec.ts]
execution_mode: code_change
model: sonnet
owned_files: [apps/api/src/payouts/**, apps/api/test/integration/payouts/**, apps/api/test/unit/payouts/**]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP08 : Versements (API)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis `docs/passation-9b/fiche-implementation.md` (démarrage, base
`cashless_wp08`, Jest, fin de lot), ce prompt, puis seulement :

- `docs/passation-9b/contexte-9b.md` : décisions 3 à 5 (rôle selon le bénéficiaire) ;
- `contracts/interfaces.md` : `EntitlementService`, `PAYOUT_ROLES_BY_BENEFICIARY`,
  `PayoutBatchPayload`, `Csv` ;
- `contracts/contract-additions.md` : routes 5 à 9, schémas `Payout*`, code
  `PAYOUT_EXCEEDS_ENTITLEMENT` ;
- `research.md` R-06, R-07, contradiction 1 ; `data-model.md` : `payout`, `create_payout_batch`,
  `settle_payout`, invariants 2 et 3 ;
- `packages/contracts/openapi.yaml` de ta base (WP01) : routes 5 à 9 et schémas ; existant :
  `approveApprovalRequest` l. 6604, `ApprovalAction` l. 15787 ;
- `packages/ledger-sql/migrations/0085_payouts.sql` de ta base : forme exacte de `lines jsonb`,
  SQLSTATE levés ;
- code : `cash-sessions/cash-deposit-action.ts` l. 1-196 et `chargebacks/late-chargeback-action.ts`
  l. 1-235 (gabarit : rôles exportés, `FIELDS`, `validatePayload`, `SQL_FAILURES`, `request()`,
  `definition()`) ; `chargebacks/chargebacks.controller.ts` l. 20-50 ; `approval/action-registry.ts`
  l. 25-61 ; `approval/approval.service.ts` l. 70-175 (`request`, `approve`, point de sauvegarde l.
  124-150) ; `approval/approval.mapper.ts` ; `ledger/builders/closing/payout.ts` l. 18-56
  (bénéficiaires et comptes) ; `refunds/refund-confirm.service.ts` (modèle d'une route de résultat
  sans approbation) ; `schema_grand_livre_cashless.sql` l. 824-840 (`payout`) et l. 934-937
  (`party_position`).

Priorité des sources (SPECIFICATION §0.3). Contradiction : tu la signales. `interfaces.md` fait foi
sur ce prompt.

## Objective

Servir les routes 5 à 9 : droits nets, demande de lot (action `PAYOUT` à deux personnes), liste,
export CSV, résultat de chaque ligne. L'API ne verse rien (C-003) : paiement hors système, puis
confirmation. La borne « montant au plus le droit net » est tenue par la base
(`create_payout_batch`, `CL055`) ; l'API la précontrôle seulement. Aucun faux : rien n'est écrit
sans `create_payout_batch` et `settle_payout` (WP03).

## Branch Strategy

- Branche de planification et de fusion : `feat/versements-rapprochements-cloture`.
- Worktree alloué par lane, calculé dans `lanes.json`.
- Commande :

  ```bash
  LC_ALL=C LANG=C spec-kitty agent action implement WP08 --agent claude \
    --mission versements-rapprochements-cloture-01M7JT4G
  ```

## Périmètre et arbitrages

- Hors lot : migrations (WP03), droits (WP06), `csv.ts` et `iban.ts` (WP01, tu les utilises), étapes
  de clôture.
- Une ligne d'import dans `app.module.ts` (`PayoutsModule`), hors carte, signalée dans la note de
  lane : WP07 possède ce fichier, l'union se fait à la consolidation.
- `AuditAction` : ajouts en fin d'union (`PAYOUT_BATCH_REQUESTED`, `PAYOUT_BATCH_EXECUTED`,
  `PAYOUT_BATCH_CLOSED`, `PAYOUT_BATCH_EXPORTED`, `PAYOUT_CONFIRMED`, `PAYOUT_FAILED`) : une ligne
  par valeur.
- **Rôle selon le bénéficiaire** (décision du porteur, contradiction 1 ; SPECIFICATION §3.2 amendée
  par WP14) : `ORGANIZER_ADMIN` pour `MERCHANT` et `ORGANIZER` ; `OPERATOR_ADMIN` pour `OPERATOR` et
  `PLATFORM`. Exporte `PAYOUT_ROLES_BY_BENEFICIARY` et un test de liste figée (un ajout ou un
  retrait fait échouer le test). Le registre d'actions ne connaît qu'une liste de rôles : l'auteur
  ET le valideur doivent tenir le rôle de CHAQUE classe présente dans le lot. Contrôle fait par toi
  dans `request()` (principal) et dans `execute` (le valideur n'y est qu'un identifiant : lis ses
  attributions actives en base, même source que `identify` de
  `identity/authentication.guard.ts:67`). Un lot qui mêle les deux classes exige donc les deux
  rôles. Signale-le.
- Bénéficiaire `LEGAL` (compte sans titulaire) : aucun rôle n'est décidé. Refuse-le (`422`) et
  signale-le au porteur ; ne choisis pas un rôle.
- **IBAN et numéro dans la charge de l'approbation** : `approval_request.payload` est renvoyé par
  les routes d'approbation et recopié par l'audit (`approval.service.ts:100-111`,
  `approval.mapper.ts:55`). Renforcement demandé (retouche hors carte, une fonction) :
  `approval/approval.mapper.ts` masque `iban` et `msisdn` de la charge de TOUTE action (récursif,
  `maskIban` de `common/iban.ts`, numéro réduit à ses 3 derniers chiffres). La ligne en base garde
  la valeur complète, `execute` la lit depuis la ligne. Dis-le au compte rendu : WP10 a le même
  besoin (`LATE_CLAIM`), le masque est unique et générique. Sans ce masque, n'écris pas la charge :
  arrête-toi sur ce point et soumets-le (règle 1).

## Subtasks

### T035 : `EntitlementService` et route 5

- `entitlements.ts` : `forLedger(client, ledgerId)` rend, par partie, `net_claim` (`party_position`,
  S:934-937), `available = net_claim` et, à part, `in_progress = sum(payout INITIATED non réglés)`
  (affiché, **jamais déduit** : `PAYOUT_INITIATED` débite déjà le compte de droits, donc `net_claim`
  est déjà diminué des versements en cours ; les déduire une seconde fois sous-estime le droit.
  Constat de la relecture de WP03, approuvée le 17/11/2026 ; `interfaces.md` à lire ainsi), avec la
  nature de la partie (`MERCHANT`, `ORGANIZER`, `OPERATOR`, `PLATFORM`) et le nom (`party.legal_name`). Une
  requête par page, pas de N+1.
- Route `GET /ledgers/{ledger_id}/payout-entitlements`, rôles ORGANIZER_ADMIN et OPERATOR_ADMIN,
  portée lue par l'événement du grand livre (`canReadEvent`) ; grand livre d'un autre prestataire :
  `404`.
- Un droit négatif ou nul : `available` jamais négatif dans la réponse ; la partie reste listée.

### T036 : action `PAYOUT` et route 6

- `payout-action.ts` (gabarit `late-chargeback-action.ts`) : `PayoutBatchPayload` figée
  (`ledger_id`, `lines[]` avec bénéficiaire, `amount` entier, `method`, `msisdn` ou `iban`,
  `idempotency_key` = `bo:<clé>`, portée lue en base : l'événement du grand livre, ou l'organisateur
  si le grand livre est de portée `ORGANIZER`). `FIELDS` fermée : champ étranger refusé `422`.
  Montants entiers positifs, `method` parmi `WAVE`, `ORANGE_MONEY`, `BANK_TRANSFER`, `CASH` ; numéro
  `^\+[1-9][0-9]{6,14}$` ; IBAN par `isValidIban` puis `normalizeIban` (WP01). Un bénéficiaire par
  ligne ; doublons dans le lot refusés.
- `request()` : lit le grand livre (404 sinon), refuse un grand livre `LOCKED`, contrôle le rôle
  (arbitrage ci-dessus), précontrôle par `EntitlementService` (`409 PAYOUT_EXCEEDS_ENTITLEMENT` avec
  le bénéficiaire), `approvals.request` (action `PAYOUT`, `targetId` = grand livre), audit
  `PAYOUT_BATCH_REQUESTED` sans IBAN.
- `execute` : relis le droit SOUS VERROU en appelant `create_payout_batch(ledger, approval_request,
  lines, actor, approver)` : c'est elle qui verrouille les comptes, borne (`CL055`), écrit
  `PAYOUT_INITIATED` et les lignes `payout`. Auteur = `requestedBy`, valideur = `approvedBy`.
  `SQL_FAILURES` : `CL055` donne `PAYOUT_EXCEEDS_ENTITLEMENT`, plus `CL003`, `CL004`, `CL005` ; la
  demande passe `FAILED`, rien d'écrit. `onClosed` : écrit seulement l'audit `PAYOUT_BATCH_CLOSED`
  (aucune ligne n'existe avant la validation).
- Route `POST /ledgers/{ledger_id}/payout-batches/approval-requests` : `@HttpCode(202)`,
  `@Idempotent({ scope: 'bo:', keyUuid: true })`, `respondAccepted` ; corps lu strictement
  (`objectBody`).

### T037 : liste et export CSV (routes 7 et 8)

- Route 7 `GET /ledgers/{ledger_id}/payouts` : page de `Payout` (`Cursor`, `Limit`, `PageMeta`,
  comme `listRefundRequests`), filtres `status`, `approval_request_id` ; statut inconnu : `400`.
  IBAN et numéro rendus MASQUÉS dans la liste.
- Route 8 `GET /ledgers/{ledger_id}/payout-batches/{approval_request_id}/export` : `text/csv`,
  colonnes de `openapi.yaml` (bénéficiaire, moyen, numéro ou IBAN, montant, référence), écrit par
  `Csv.write` (WP01 : anti-injection de formules, un nom `=SOMME(...)` sort neutralisé). Lot inconnu
  ou non validé : `404`. Seul endroit où l'IBAN et le numéro sortent en clair. Rôles : ceux du lot
  (même contrôle que la demande). Chaque export est audité (`PAYOUT_BATCH_EXPORTED`, nombre de
  lignes, jamais de destination) et n'est pas rejoué par l'idempotence (WP01 l'a ajoutée à la liste
  de `IdempotencyKey`) : ne mets pas `@Idempotent`.

### T038 : confirmation (route 9)

`POST /payouts/{payout_id}/confirm`, `@Idempotent({ scope: 'bo:' })`, rôle du lot (nature du
bénéficiaire de la ligne). Corps `PayoutConfirm` : `CONFIRMED` avec `external_reference` non
blanche, ou `FAILED` avec `failure_reason` non blanche ; autre combinaison : `400`. Appelle
`settle_payout(payout, outcome, ref, reason, actor)` (une transaction `PAYOUT_CONFIRMED` ou
`PAYOUT_FAILED`, une seule fois). Ligne déjà réglée : `409 CONFLICT_STATE` ; ligne inconnue ou d'un
autre prestataire : `404`. `FAILED` recrédite le droit (`available` remonte, un nouveau lot est
possible). Audit sans destination. Réponse `200 Payout`. Aucune règle de deux personnes sur le
résultat (FR-012).

### T039 : tests

Voir « Tests et preuves ».

## Tests et preuves

```bash
cd <lane>/apps/api
export PGDATABASE=cashless_wp08; source ../../tools/dev-db/env.sh; env | grep DATABASE_URL
SKIP_LATENCY=1 npx jest test/unit/payouts test/integration/payouts --runInBand --forceExit
npm run typecheck -w @cashless/api
```

La base doit porter les migrations `0083` à `0088` et la section 12 de `post-roles.sql` (reset-db
depuis ta lane). Cas exigés (chacun nomme son FR ou NFR) :

- FR-009, SC-002 : ligne de 40 000 pour un droit net de 39 225 : `409 PAYOUT_EXCEEDS_ENTITLEMENT` à
  la demande ; droit baissé entre la demande et la validation : demande `FAILED` avec ce code,
  aucune écriture ; deux lots qui cumulent au-delà : le second `FAILED` ; route 5 : après un lot
  `INITIATED`, `available` baisse une seule fois (pas de double déduction) et `in_progress` l'affiche.
- FR-010 : auteur ≠ valideur (refus par le service ET par la base, aucune écriture) ;
  `PAYOUT_INITIATED` unique, une ligne `payout` par bénéficiaire avec `initiated_by`, `approved_by`,
  destination ; rôle `SUPERVISOR` ou `CASHIER` : `403`.
- Rôles : liste figée de `PAYOUT_ROLES_BY_BENEFICIARY` ; `ORGANIZER_ADMIN` qui demande un versement
  du prestataire : `403` ; l'inverse aussi ; lot mixte exigeant les deux rôles ; valideur du mauvais
  rôle refusé à l'exécution ; bénéficiaire `LEGAL` refusé.
- FR-011 : export CSV complet ; IBAN et numéro présents dans le CSV et ABSENTS de la liste, des
  réponses d'approbation et de toute ligne d'`audit_log` ; nom commençant par `=` neutralisé ;
  export audité.
- FR-012 : `CONFIRMED` sans référence : `400` ; `FAILED` recrédite (droit net de retour) ; deuxième
  résultat sur la même ligne : `409` ; transition vers `CLOSED` refusée tant qu'une ligne est
  `INITIATED` (`PAYOUT_PENDING_ZERO`).
- NFR-001 : 50 approbations concurrentes du même lot : une transaction `PAYOUT_INITIATED`, un jeu de
  lignes ; 50 `confirm` concurrents d'une ligne : un seul `PAYOUT_CONFIRMED` ; 50 rejeux de la clé
  de demande : une demande.
- NFR-004 (mesure légère) : la route 5 et la route 7 d'un événement du scénario répondent sans N+1.
- Le grand livre reste équilibré (somme nulle par transaction) après chaque cas.

## Definition of Done

- [ ] Routes 5 à 9 servies ; action `PAYOUT` enregistrée ; rôle selon le bénéficiaire testé par
  liste figée.
- [ ] Charge figée ; droit relu sous verrou par `create_payout_batch` ; précontrôle API sans effet
  d'écriture.
- [ ] IBAN et numéro en clair seulement dans le CSV ; masque générique de `approval.mapper.ts` posé
  et testé.
- [ ] Aucun SQL écrit, aucune dépendance, aucune route hors `contract-additions.md`.
- [ ] Tests verts sur `cashless_wp08` ; typecheck et Prettier (100 caractères) verts.
- [ ] Compte rendu : retouches hors carte (`app.module.ts`, `AuditAction`, `approval.mapper.ts`),
  décisions signalées (lot mixte, `LEGAL`, masque), écarts au plan (renforce / affaiblit).

## Ce que le relecteur doit casser

1. Approuver son propre lot, ou le faire valider par un `SUPERVISOR` : refusé, aucune écriture.
2. Modifier la charge de la demande par la base (propriétaire) puis approuver : `validatePayload` ou
   `create_payout_batch` refuse, aucune écriture.
3. Deux lots de 30 000 pour un droit net de 39 225, approuvés en parallèle : un seul passe, l'autre
   `FAILED`.
4. 50 approbations simultanées du même lot : une seule transaction `PAYOUT_INITIATED`.
5. Chercher l'IBAN dans `GET /approval-requests`, `GET .../payouts`, `audit_log` et les journaux :
   introuvable.
6. Export d'un lot d'un autre prestataire ou sans le rôle du lot : `404` ou `403`, jamais le CSV.
7. Un `confirm` rejoué avec une autre clé : `409`, jamais un second `PAYOUT_CONFIRMED` ni un double
   recrédit.
8. `ORGANIZER_ADMIN` qui prépare un versement `OPERATOR` : `403` ; liste de rôles élargie : le test
   échoue.
9. Montant à `0`, négatif, décimal ou au-delà de 2^53 ; IBAN au modulo 97 faux ; bénéficiaire en
   double : refusés.
10. Lot demandé sur un grand livre `LOCKED` ou après `CLOSED` hors compte légal : refusé, rien
    d'écrit.

## Fichiers à faire relire par une personne

- `payouts/payout-action.ts` (sortie d'argent, deux personnes, rôle par bénéficiaire, droit relu à
  l'exécution) ;
- `payouts/payouts.service.ts` (export CSV, IBAN en clair, confirmation) ;
- `approval/approval.mapper.ts` (masque des données de paiement).
