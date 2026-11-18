---
work_package_id: WP10
title: Réclamations tardives (API)
dependencies: [WP01, WP06]
requirement_refs: [FR-016, FR-024]
planning_base_branch: feat/versements-rapprochements-cloture
merge_target_branch: feat/versements-rapprochements-cloture
branch_strategy: Planning artifacts for this mission were generated on feat/versements-rapprochements-cloture. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/versements-rapprochements-cloture unless the human explicitly redirects the landing branch.
subtasks: [T043, T044, T045, T046]
phase: Phase 3 - Services et routes
agent: claude
history:
- timestamp: '2026-11-17T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/late-claims/
create_intent: [apps/api/src/late-claims/late-claims.module.ts, apps/api/src/late-claims/late-claim-action.ts, apps/api/src/late-claims/late-adjustment-action.ts, apps/api/src/late-claims/late-claims.controller.ts, apps/api/src/late-claims/late-claims.dto.ts, apps/api/src/late-claims/late-claim-proof.ts, apps/api/test/integration/late-claims/late-claim.spec.ts, apps/api/test/integration/late-claims/late-claim-proof.spec.ts, apps/api/test/integration/late-claims/late-adjustment.spec.ts, apps/api/test/integration/late-claims/money-account.spec.ts]
execution_mode: code_change
model: sonnet
owned_files: [apps/api/src/late-claims/**, apps/api/src/ledger/builders/festival/refund.ts, apps/api/test/integration/late-claims/**]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP10 : Réclamations tardives (API)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis `docs/passation-9b/fiche-implementation.md` (démarrage, base
`cashless_wp10`, Jest, fin de lot), ce prompt, puis seulement :

- `docs/passation-9b/contexte-9b.md` : décision 4 (`postLateClaim` plus `ADJUSTMENT` ajouté) ;
- `contracts/interfaces.md` : `moneyAccountFor` étendu ; `contracts/contract-additions.md` : route
  14 ;
- `research.md` R-09, contradiction 2 ; `spec.md` FR-016 ;
- `packages/contracts/openapi.yaml` : `postLateClaim` l. 6457-6521 (description comprise),
  `LateClaimRequest` l. 15690-15726, `LateClaimResult` l. 15727-15758 ; route 14 et
  `LateAdjustmentRequest` dans ta base (WP01) ;
- `packages/ledger-sql/schema_grand_livre_cashless.sql` : `check_late_claim` l. 639-722 (CL024),
  garde d'écriture sur grand livre `LOCKED` l. 559-565, `media_tap` l. 338-351, `cash_session`
  (`migrations/0036_cash_sessions.sql` l. 81-100) ;
- code : `chargebacks/late-chargeback-action.ts` l. 1-235 (MODÈLE : verrou consultatif, relecture
  sous verrou, `BACKOFFICE`, `approval_request_id` en métadonnée, `SQL_FAILURES`) ;
  `chargebacks/chargebacks.controller.ts` l. 20-50 ; `refunds/wallet-refund-action.ts` l. 90-98
  (`refuseUnderEdge`) et l. 130-200 ; `ledger/builders/festival/refund.ts` l. 14-45
  (`moneyAccountFor`, `buildWalletRefund`) ; `ledger/builders/closing/backoffice.ts` l. 53-135
  (`buildAdjustment`, `buildBreakageReversal`) ; `ledger/db/ledger-queries.ts` l. 82-90
  (`lockWalletPaidBalance`) ; `ledger/status-matrix.ts` l. 156-165.

Priorité des sources (SPECIFICATION §0.3). Contradiction : tu la signales. `interfaces.md` fait foi
sur ce prompt.

## Objective

Servir `postLateClaim` (contrat existant, inchangé) et `postLateAdjustment` (route 14, ajoutée) :
après le verrouillage du grand livre, jusqu'à `late_claims_until`, une personne propose et une autre
valide. `LATE_CLAIM` écrit l'annulation de casse puis le remboursement du festivalier ; `ADJUSTMENT`
écrit l'apport d'un bénéficiaire de la casse. Les bornes sont celles de la base (`check_late_claim`,
`CL024`), que l'API précontrôle seulement. Le contrat ne change pas ; aucune dépendance ; aucun SQL.

## Branch Strategy

- Branche de planification et de fusion : `feat/versements-rapprochements-cloture`.
- Worktree alloué par lane, calculé dans `lanes.json`.
- Commande :

  ```bash
  LC_ALL=C LANG=C spec-kitty agent action implement WP10 --agent claude \
    --mission versements-rapprochements-cloture-01M7JT4G
  ```

## Périmètre et arbitrages

- Hors lot : contestation tardive (déjà faite, mission 6), migrations, droits, route de
  remboursement du back-office (WP11), `debit-paths` hors la retouche nommée plus bas.
- Une ligne d'import dans `app.module.ts` (`LateClaimsModule`), hors carte, signalée dans la note de
  lane (WP07 possède le fichier ; union à la consolidation).
- `AuditAction` : ajouts en fin d'union (`LATE_CLAIM_REQUESTED`, `LATE_ADJUSTMENT_REQUESTED`), une
  ligne par valeur.
- Retouches hors carte permises, minimales, signalées : `debit-authority/debit-paths.ts` (l'entrée
  `postLateClaim`, l. 121-126, passe de `ABSENT` à `DEBIT`/`ENGINE`, protection : `refuseUnderEdge`
  avant l'écriture) et le cas `ABSENT` de
  `test/integration/debit-authority/debit-paths-refused.spec.ts` l. 169-179 (il attend `404` : il
  échouera dès que la route existe). Sans cela la suite existante casse.
- **Destination dans la charge** : `destination.iban` et `msisdn` entrent dans
  `approval_request.payload`, renvoyé par les routes d'approbation et recopié par l'audit. Le masque
  générique (`approval/approval.mapper.ts`) est posé par WP08, pas par toi : ne touche pas ce
  fichier. Écris le test d'absence d'IBAN et de numéro dans l'audit et dans `GET /approval-requests`
  ; s'il échoue parce que WP08 n'est pas encore dans ta base, signale-le (rejoué à la
  consolidation).
- **Frais de remboursement** : `buildWalletRefund` écrit des lignes de frais (`ORG_FFEST`,
  `ORG_TAX`, crédit de comptes de droits) et `check_late_claim('WALLET_REFUND')` n'admet que «
  portefeuille débité, compte d'argent crédité, rien d'autre » (l. 715-722). Un frais non nul serait
  donc refusé (`CL024`). Vérifie-le d'abord par un test sur la base. Si c'est confirmé : n'invente
  pas de règle. Écris le remboursement tardif SANS frais (variante explicite de `buildWalletRefund`
  pour `BACKOFFICE` sur grand livre `LOCKED`, test à l'appui) et dis-le au compte rendu comme
  arbitrage fonctionnel à faire confirmer par le porteur.
- **Mobile money vers un autre numéro** : le corps de `LateClaimRequest` n'a pas de code de
  vérification : les conditions d'ADR-76 ne s'appliquent pas à ce parcours du back-office, la
  seconde personne est le contrôle. N'ajoute aucun champ. Signale-le au compte rendu.

## Subtasks

### T043 : `moneyAccountFor` étendu (`refund.ts`)

- `moneyAccountFor(method, cashAccount?)` : `WAVE` donne `A-PSP-WAVE`, `ORANGE_MONEY` donne
  `A-PSP-OM` (inchangés), `BANK_TRANSFER` donne `A-BANQUE` (compte ouvert à l'ouverture du grand
  livre), `CASH` donne `cashAccount` (compte `A-CAISSE-<n>`), refusé sans lui (`BuildError
  VALIDATION_FAILED`). Autre valeur : refus comme aujourd'hui. Les deux appelants existants
  (`wallet-refund-action.ts`) ne passent pas de caisse : leur comportement ne change pas.
- Mets à jour le commentaire d'en-tête (le virement est servi). Test unitaire de chaque branche.
- Pour `CASH`, la caisse est celle d'une `cash_session` `OPEN` du grand livre ouverte par l'auteur
  de la demande ; aucune : `422 REFUND_NOT_ALLOWED`. Attention : `RECONCILING` exige zéro caisse
  ouverte (FR-002, WP07), donc sur un grand livre `LOCKED` aucune session n'est ouverte et `CASH`
  sera toujours refusé en pratique. Fais-le quand même, prouve le refus par un test, et signale ce
  constat à l'orchestrateur.

### T044 : action `LATE_CLAIM` et route `postLateClaim`

- `late-claim-action.ts`, copie du modèle `late-chargeback-action.ts` : rôles exportés
  `LATE_CLAIM_ROLES` (`ORGANIZER_ADMIN`, `OPERATOR_ADMIN`, test de bornage), charge figée
  (`ledger_id`, `wallet_id`, `amount` entier, `currency`, `proof`, `destination`, `reason`,
  `idempotency_key` = `bo:<clé>`, portée `EVENT` lue en base), `FIELDS` fermée, `SQL_FAILURES`
  (`CL024` `LATE_CLAIM_INVALID`, `CL003` `LEDGER_LOCKED`, `CL006`, `CL005`).
- `request()` : verrou consultatif `late-claim:<wallet>` ; grand livre non `LOCKED` : `409
  CONFLICT_STATE` ; `late_claims_until` nulle ou dépassée : `409 LEDGER_LOCKED` ; `debit_authority =
  EDGE` : `409 DEBIT_AUTHORITY_EDGE` (`refuseUnderEdge`) ; montant au plus la casse prise moins la
  casse déjà annulée sur ce portefeuille (précontrôle, sinon `409 LATE_CLAIM_INVALID`) ; refuse une
  seconde demande `PENDING` ou `APPROVED` du même portefeuille ; `reason` d'au moins 10 caractères ;
  `IBAN` par `isValidIban` (WP01) ; audit.
- **Preuve du droit** (`late-claim-proof.ts`, contrôlée par l'API, aucune garde SQL) : `MEDIA_TAP` :
  `tap_id` doit désigner un `media_tap` du même prestataire, lu par un terminal (`device_id` non
  nul), dont le bracelet est ou a été rattaché à ce portefeuille ; `CUSTOMER_ACCOUNT` : le
  portefeuille porte un `customer_id`. Preuve manquante, étrangère ou d'un autre portefeuille :
  `422`, même réponse, rien d'écrit. Refaite à l'exécution.
- `execute` (relecture sous verrou, ordre : portefeuille puis comptes) : `lockWalletPaidBalance` ;
  relis les conditions ; parts d'origine (`originalShares`) lues des écritures `BREAKAGE` de ce
  portefeuille (même calcul que `check_late_claim` l. 667-690) ; puis, **sous le même point de
  sauvegarde** de l'approbation (donc tout ou rien) : `BREAKAGE_REVERSAL` (clé `bo:<clé>:reversal`),
  puis `WALLET_REFUND` (clé `bo:<clé>:refund`, `moneyAccountFor(method, caisse)`), source
  `BACKOFFICE`, `createdBy` = auteur, `approvedBy` = valideur, `metadata.approval_request_id`. Un
  rejeu (`replayed`) : `IDEMPOTENCY_KEY_REUSED`.
- Résultat `LateClaimResult` (`openapi.yaml:15727-15758`) : les deux identifiants de transaction,
  `approved_by`.
- Route `POST /ledgers/{ledger_id}/late-claims`, `202`, `@Idempotent({ scope: 'bo:', keyUuid: true
  })`, `respondAccepted`.

### T045 : action `ADJUSTMENT` et route 14 `postLateAdjustment`

- `late-adjustment-action.ts` : l'action `ADJUSTMENT` existe déjà dans l'enum ; il manque sa
  définition. Apport d'un bénéficiaire de la casse (`ORGANIZER` ou `OPERATOR`) : lignes `A-BANQUE`
  (ou compte du canal, `moneyAccountFor`) au débit, `ORG_CASSE` ou `OPE_CASSE` du bénéficiaire au
  crédit (références `{ purpose, ownerPartyId }` avec l'organisateur et le prestataire lus en base),
  `metadata.reason` obligatoire, via `buildAdjustment` (`BACKOFFICE`, auteur ≠ valideur). Corps
  `LateAdjustmentRequest` du contrat de ta base ; champ étranger `422`.
- Bornes : même précontrôle de portée (grand livre `LOCKED`, délai, `EDGE`) ; l'apport est au plus
  ce qui a été annulé sur le compte de casse depuis le verrouillage : la base refuse (`CL024`),
  l'API précontrôle. Bénéficiaire `LEGAL` (casse vers un compte légal) : refuse `422` et signale-le
  (hors de ce que le contrat décrit).
- Route `POST /ledgers/{ledger_id}/late-adjustments`, `202`, mêmes décorateurs que `postLateClaim`.

### T046 : tests

Voir « Tests et preuves ».

## Tests et preuves

```bash
cd <lane>/apps/api
export PGDATABASE=cashless_wp10; source ../../tools/dev-db/env.sh; env | grep DATABASE_URL
SKIP_LATENCY=1 npx jest test/integration/late-claims test/integration/debit-authority \
  --runInBand --forceExit
npm run typecheck -w @cashless/api
```

La base doit porter les migrations `0083` à `0088` et la section 12 de `post-roles.sql` (reset-db
depuis ta lane). Monte un grand livre `LOCKED` par le scénario de clôture des tests existants (casse
faite, puis verrou). Cas exigés (chacun nomme son FR) :

- FR-016 : annulation de casse puis remboursement à deux : deux transactions, solde payé du
  portefeuille à 0, droit de l'organisateur et du prestataire diminué au prorata ; annulation
  au-delà de la casse prise : `409 LATE_CLAIM_INVALID` ; au-delà du délai : `409 LEDGER_LOCKED` ;
  grand livre non verrouillé : `409 CONFLICT_STATE` ; sous `EDGE` : `409 DEBIT_AUTHORITY_EDGE`, rien
  d'écrit.
- Deux personnes : même personne comme valideur refusée (service et base), rôles `SUPERVISOR`,
  `CASHIER` : `403` ; `ORGANIZER_ADMIN` d'un autre organisateur : `404` ou `403`.
- Tout ou rien : un échec du remboursement (`CASH` sans caisse, compte d'argent absent) annule
  l'annulation de casse (aucune des deux transactions), la demande passe `FAILED` avec un motif
  lisible.
- Preuve du droit : `tap_id` inconnu, d'un autre prestataire, d'un autre portefeuille, sans terminal
  : `422` ; `CUSTOMER_ACCOUNT` sur un portefeuille anonyme : `422` ; preuve valide acceptée.
- Moyens : `WAVE`, `ORANGE_MONEY`, `BANK_TRANSFER` (`A-BANQUE`) ; `CASH` sans caisse ouverte refusé
  ; IBAN faux refusé ; test unitaire de `moneyAccountFor`. Frais : test qui prouve ce que la base
  accepte (voir arbitrage).
- `ADJUSTMENT` : apport borné par l'annulation de casse déjà faite ; au-delà : `409
  LATE_CLAIM_INVALID` ; apport sans casse annulée : refusé ; `LEGAL` refusé.
- FR-024 : une ligne d'audit par demande et par exécution ; ni IBAN ni numéro dans l'audit (voir
  arbitrage).
- Concurrence : 20 approbations simultanées de la même demande : une seule paire d'écritures ; 20
  rejeux de la même clé : une seule demande ; deux demandes pour le même portefeuille : la seconde
  `409`.
- `debit-paths-refused.spec.ts` vert avec l'entrée `postLateClaim` reclassée.

## Definition of Done

- [ ] `postLateClaim` et `postLateAdjustment` servies ; actions `LATE_CLAIM` et `ADJUSTMENT`
  enregistrées.
- [ ] Deux écritures sous le même point de sauvegarde ; bornes de la base respectées, précontrôle
  API.
- [ ] `moneyAccountFor` étendu ; `CASH` sans caisse refusé ; preuve du droit contrôlée côté API.
- [ ] Aucun contrat, SQL ni dépendance modifié ; `debit-paths` reclassé ; suites existantes vertes.
- [ ] Tests verts sur `cashless_wp10` ; typecheck et Prettier (100 caractères) verts.
- [ ] Compte rendu : retouches hors carte, frais tardifs (arbitrage), `CASH` toujours refusé en
  pratique, destination hors ADR-76, écarts au plan (renforce / affaiblit).

## Ce que le relecteur doit casser

1. Annuler plus de casse que prise, ou deux fois la même : refusé, aucune des deux écritures.
2. Valider sa propre demande, ou par un `SUPERVISOR` : refusé, rien d'écrit.
3. 20 approbations simultanées : une seule paire `BREAKAGE_REVERSAL` + `WALLET_REFUND`.
4. Preuve d'un bracelet d'un autre portefeuille, ou `tap_id` d'un autre prestataire : `422`, même
   message.
5. Réclamation après `late_claims_until`, sur un grand livre `OPEN` ou `CLOSING`, sous `EDGE` :
   refusée.
6. Modifier la charge par la base (propriétaire) puis approuver : `validatePayload` refuse, rien
   d'écrit.
7. `CASH` : refusé sans caisse ouverte de l'auteur ; la caisse d'un autre prestataire n'est jamais
   utilisée.
8. Remboursement tardif avec frais : la base le refuse ou l'API l'écrit sans frais, jamais
   d'écriture partielle.
9. `ADJUSTMENT` au-delà de l'annulation de casse, sur un compte autre que de casse, ou vers un
   compte de portefeuille.
10. IBAN et numéro : introuvables dans `audit_log` et dans les réponses d'approbation (une fois WP08
    fusionné).

## Fichiers à faire relire par une personne

- `late-claims/late-claim-action.ts` (sortie d'argent après verrouillage, deux personnes, tout ou
  rien) ;
- `late-claims/late-claim-proof.ts` (preuve du droit, seul contrôle, aucune garde SQL) ;
- `ledger/builders/festival/refund.ts` (compte d'argent de sortie, variante sans frais).
