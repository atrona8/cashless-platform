---
work_package_id: WP06
title: Révocation d'une identification à deux personnes (API)
dependencies: [WP05]
requirement_refs:
- FR-005
- C-002
planning_base_branch: feat/serveur-app-festivalier
merge_target_branch: feat/serveur-app-festivalier
branch_strategy: >-
  Planning artifacts for this mission were generated on feat/serveur-app-festivalier. During
  /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must
  merge back into feat/serveur-app-festivalier unless the human explicitly redirects the landing branch.
base_branch: kitty/mission-serveur-app-festivalier-01M7WB69
base_commit: c069399e837a60c6f4625a5de46f0f926bd757f1
created_at: '2026-11-20T15:31:53.326837+00:00'
subtasks: [T023, T024, T025, T026]
phase: Phase 2 - API
agent: claude
history:
- timestamp: '2026-11-20T10:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/kyc/kyc-revocation-action.ts
create_intent:
- apps/api/src/kyc/kyc-revocation-action.ts
- apps/api/src/kyc/kyc-revocation.controller.ts
- apps/api/test/integration/kyc/revoke.spec.ts
execution_mode: code_change
model: sonnet
owned_files:
- apps/api/src/kyc/kyc-revocation-action.ts
- apps/api/src/kyc/kyc-revocation.controller.ts
- apps/api/test/integration/kyc/revoke.spec.ts
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP06 : Révocation d'une identification à deux personnes (API)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche commune
`docs/passation-10a/fiche-implementation.md`, ce prompt, puis seulement :

- `kitty-specs/serveur-app-festivalier-01M7WB69/contracts/kyc.md` (section `revoke`, contradiction
  §6.3), `interfaces.md` (lignes « Révocation » et `revoke_kyc_verification`), `research.md` R-03 ;
- le code **fusionné** de WP05 : `apps/api/src/kyc/kyc.module.ts`, `kyc.service.ts` (convertisseur
  de ligne `kyc_verification` vers `KycVerification`, s'il est exporté), et la migration `0096` de
  WP01 (signature réelle de `revoke_kyc_verification` : elle fait foi) ;
- `apps/api/src/late-claims/late-claim-action.ts` : constante de rôles l. 33, `FIELDS` l. 54-65,
  classe l. 185-195 (`registry.register(this.definition())` dans le constructeur), `request`
  l. 202-257 (verrou, lecture sous RLS, demande ouverte unique l. 226-236, `approvals.request`
  l. 252-257, audit l. 258-274), `definition()` l. 329-441 (`validate`, `execute`, conversion d'une
  erreur SQL en `ProblemException` par `failure()`, l. 455-462) ;
- `apps/api/src/late-claims/late-claims.controller.ts` l. 28-53 (route `202` : `@HttpCode(202)`,
  `@Idempotent({ scope: 'bo:', keyUuid: true })`, `access.actor`, `tx.run`, `respondAccepted`) et
  `late-claims.module.ts` ;
- `apps/api/src/approval/action-registry.ts` l. 48-82 (`ApprovalActionDefinition` : `requiredRole`
  en liste, `scopeOf`, `validate`, `guardDecision`, `execute`) et `approval.service.ts` l. 70-115
  (`request`), l. 117-175 (`approve` : point de sauvegarde, `FAILED` sur erreur métier de statut <
  500, audit `APPROVAL_EXECUTED` avec `approverId`), l. 271-303 (`prepareDecision`, appel de
  `guardDecision`) ;
- `apps/api/src/payouts/payout-action.ts` l. 366-385 : **seul usage de `guardDecision`** du code
  (signature `({ client, payload, actor }, decision)`) ; `late-claim-action.ts` n'en a pas ;
- `packages/contracts/openapi.yaml` l. 3248-3290 (`revokeKycVerification`) et l. 16592-16640
  (`KycVerification`) ;
- `apps/api/test/integration/late-claims/late-claim.spec.ts` l. 40-80 et 170-210 (deux personnes,
  auteur refusé) et `late-claim-fixtures.ts` l. 100-115 (`approve`), modèle du jeu d'essai.

Priorité des sources (SPECIFICATION §0.3). Contradiction ou manque : tu le signales, tu ne tranches
pas en silence.

## Objective

Servir `revokeKycVerification` (`POST /kyc-verifications/{kyc_verification_id}/revoke`, `202`) :
l'appel crée une demande d'approbation `KYC_REVOCATION` `PENDING` sans rien écrire ; une seconde
personne habilitée, autre que l'auteur, l'approuve par `approveApprovalRequest`, qui appelle
`revoke_kyc_verification` (`REVOKED`, `revoked_by` = auteur de la demande, valideur au journal
d'audit). Identification déjà révoquée : `409 CONFLICT_STATE` à la demande, demande `FAILED` à
l'exécution (FR-005, FR-006, C-002).

## Context

- **Décisions du porteur (20/11/2026)** : aucune ne change ce lot. C-002 : le contrat prime sur §6.3
  point 5 (« un administrateur ») ; la contradiction est signalée, pas tranchée par toi (T026).
- **Interfaces consommées** : `revoke_kyc_verification(p_id uuid, p_by uuid, p_reason text) RETURNS
  kyc_verification` (`DEFINER`, `VERIFIED` vers `REVOKED`, déjà révoquée `CL063`, motif de moins de
  10 caractères `CL062`, introuvable ou autre prestataire `no_data_found`) ; mappage HTTP des
  `CL06x` dans `errors/sqlstate-map.ts` (WP05, `CL063` vers `409 CONFLICT_STATE`, `CL062` vers
  `422`). **Tu ne modifies pas `sqlstate-map.ts`** : tu t'appuies sur lui.
- **Interface possédée** : `KycRevocationActions` (enregistre `KYC_REVOCATION`, rôles
  `OPERATOR_ADMIN` et `ORGANIZER_ADMIN`) et `KycRevocationController`.
- **Retouche hors carte (deux lignes, à signaler)** : `apps/api/src/kyc/kyc.module.ts` (WP05) :
  ajouter `KycRevocationController` à `controllers` et `KycRevocationActions` à `providers`. Rien
  d'autre dans ce fichier.
- `cashless_app` garde `SELECT` sur `kyc_verification` (`post-roles.sql` l. 650 ne retire que
  `INSERT, UPDATE`) : la lecture de la demande se fait sous la RLS du prestataire.
- `KYC_REVOCATION` est déjà dans l'énumération `approval_request.action` (migrations 0009, 0011,
  0033, 0038) : aucune migration.
- **Écart à signaler, ne pas corriger** : `research.md` R-03 dit que `guardDecision` « vérifie
  l'état avant décision », alors que `contracts/kyc.md` veut une demande `FAILED` (pas `PENDING`)
  quand l'identification est déjà révoquée à l'exécution. Tu suis le contrat : l'état `REVOKED`
  n'est **pas** testé dans `guardDecision`.

## Subtasks

### T023 : `kyc-revocation-action.ts` (`KYC_REVOCATION`, `guardDecision`, `execute`)

But : une action enregistrée dans le registre global, sur le modèle de `LateClaimActions`.

1. `export const KYC_REVOCATION_ROLES: readonly StaffRole[] = ['OPERATOR_ADMIN', 'ORGANIZER_ADMIN']`
   (modèle `LATE_CLAIM_ROLES`, l. 33). Charge figée : `KycRevocationPayload { kyc_verification_id,
   wallet_id, reason, scope_type: 'EVENT' | 'OPERATOR', scope_id }` ; un champ hors de la liste est
   refusé `422` (modèle `validateShape`, l. 464 et suivantes) ; `reason` d'au moins 10 caractères
   après `trim`, sinon `422`. Jamais de `id_last4` ni de numéro de pièce dans la charge.
2. `request(client, operatorId, { kycVerificationId, reason }, actor)` : lire sous RLS `SELECT k.id,
   k.status, k.wallet_id, l.scope_id AS event_id FROM kyc_verification k JOIN wallet w ON w.id =
   k.wallet_id JOIN ledger l ON l.id = w.ledger_id AND l.scope_type = 'EVENT' WHERE k.id = $1`.
   Absente ou d'un autre prestataire : `404`. **`wallet_id` nul** (identification posée par
   `p_customer`, `interfaces.md`) : la jointure ne rend rien, lis alors `kyc_verification` seule et
   prends la portée `OPERATOR` du prestataire (seul `OPERATOR_ADMIN` peut alors demander et
   approuver : signale-le). `status = 'REVOKED'` : `ProblemException('CONFLICT_STATE', { detail })`,
   `409`. Une seule demande ouverte par identification (modèle l. 226-236 : `PENDING` non échue ou
   `APPROVED`, `action = 'KYC_REVOCATION' AND target_id = $1`) : sinon `409`. Puis
   `approvals.request(client, operatorId, { action: 'KYC_REVOCATION', targetId: id, payload },
   actor)` : le rôle de l'auteur sur la portée `EVENT` est contrôlé par le service (`403` sinon).
   L'audit `APPROVAL_REQUESTED` est écrit par le service : n'ajoute aucune action d'audit (l'union
   `AuditAction` n'est pas à toi).
3. `definition()` : `requiredRole: KYC_REVOCATION_ROLES`, `scopeOf: (p) => ({ type: p.scope_type,
   id: p.scope_id })`, `validate`. **`guardDecision`** (approuver comme refuser, avant `decide`, un
   refus laisse la demande `PENDING`) : défense en profondeur, deux contrôles seulement :
   `request.target_id === payload.kyc_verification_id`, sinon `ProblemException('APPROVAL_INVALID')`
   ; l'identification est visible sous RLS, sinon `NOT_FOUND`. Le rôle de l'approbateur est déjà
   contrôlé par `roleOn` (`approval.service.ts` l. 287) : ne le refais pas.
4. **`execute`** (sous le point de sauvegarde `approval_exec`) : revalider la charge
   (`this.validate(payload)`, comme l. 84 du modèle), puis `SELECT * FROM
   revoke_kyc_verification($1, $2, $3)` avec `[payload.kyc_verification_id, requestedBy,
   payload.reason]` (**`requestedBy`, pas `approvedBy`** : le contrat dit `revoked_by` = auteur ; le
   valideur est tracé par l'audit `APPROVAL_EXECUTED` du service d'approbation,
   `approval.service.ts` l. 162-176, qui porte `approverId`). Résultat : la `KycVerification` du
   contrat (réutilise le convertisseur de WP05 s'il est exporté, sinon écris-en un de six lignes,
   mêmes champs que le schéma l. 16592) ; `executedTxId` absent (aucune transaction du grand livre).
5. Une erreur SQL de refus (`CL063` déjà révoquée, `no_data_found`) doit faire passer la demande
   `FAILED` : le service le fait tout seul quand l'erreur se traduit en statut inférieur à 500
   (`businessFailure`, `approval.service.ts` l. 411-415 : `isSqlError` et `resolveProblem`). Ne
   convertis rien si le mappage de WP05 suffit ; sinon `failure()` du modèle (l. 455) avec un détail
   lisible, jamais le texte SQL.

Cas limites : (a) deux demandes concurrentes sur la même identification : la seconde voit la
première (`409`) ; (b) identification révoquée entre la demande et l'approbation (autre voie) :
demande `FAILED`, pas `500` ; (c) le `result` contient `id_last4` (le contrat exige la
`KycVerification` entière) et `APPROVAL_EXECUTED` le recopie dans l'audit : **admis**
(`interfaces.md`, « Audit et journaux »), mais jamais dans les journaux applicatifs ; ne modifie pas
`approval.service.ts`.

### T024 : `KycRevocationController` (`202`, `409` à la demande)

1. `@Controller()`, `@Post('kyc-verifications/:kyc_verification_id/revoke')`, `@HttpCode(202)`,
   `@Idempotent({ scope: 'bo:', keyUuid: true })` (modèle `late-claims.controller.ts` l. 28-53).
2. `const actor = this.access.actor(req, KYC_REVOCATION_ROLES)` (rôle tenu quelque part, `403`
   sinon) ; l'identifiant du chemin doit être un UUID (`isUuid`, sinon `404`, comme l. 209 du
   modèle) ; corps `{ reason }` : objet avec la seule clé `reason`, chaîne de 10 caractères au
   moins, sinon `422 VALIDATION_FAILED` sans écho de la valeur.
3. `tx.run((client) => respondAccepted(res, await this.actions.request(client, actor.operatorId,
   {...}, { principal: actor.principal, audit: actor.audit })))`.

Validation : `202` avec `Location: /v1/approval-requests/<id>` et un corps `ApprovalRequest`
(`action: 'KYC_REVOCATION'`, `status: 'PENDING'`, `target_id` = l'identification).

Cas limites : `Idempotency-Key` rejouée : même réponse (mécanisme existant, ne rien ajouter) ;
identification d'un autre prestataire : `404`, jamais `403`.

### T025 : intégration `kyc/revoke.spec.ts`

Jeu d'essai : monde de `late-claims/late-claim-fixtures.ts` (`LateWorld` ou `PspWorld`) ; un
festivalier au numéro vérifié (modèle `refunds/create-fixtures.ts` l. 85 : `customer_identity`) ;
l'identification posée **par le propriétaire** avec la fonction de WP01
(`SELECT create_kyc_verification(...)`, `p_wallet` renseigné, `p_customer` NULL, agent caissier ; un
cas avec `p_customer` pour la portée `OPERATOR`) : ne pas passer par la route de WP05 pour
l'amorçage. Auteur : `lw.author()` (`OPERATOR_ADMIN`) ; valideur : `lw.validator()`
(`ORGANIZER_ADMIN`).

Cas à écrire, chacun avec une assertion sur le **corps et l'état de la base** :

1. Rôles bornés : `[...KYC_REVOCATION_ROLES].sort()` égal à `['OPERATOR_ADMIN', 'ORGANIZER_ADMIN']`.
2. `202 PENDING`, aucune écriture : l'identification reste `VERIFIED`, `wallet_kyc_level` vaut
   `VERIFIED`.
3. Approbation par une autre personne : `200`, `status: 'EXECUTED'`, `result` de forme
   `KycVerification` (`contractViolations('KycVerification', result)` vide), `revoked_by` = auteur,
   `revoked_reason` = motif ; journal d'audit : `APPROVAL_EXECUTED` avec `approver_id` = valideur.
4. **Niveau `NONE` après** (SC-001, FR-006) : `SELECT wallet_kyc_level($1)` du portefeuille (et d'un
   second portefeuille du même client) vaut `NONE` ; avant l'approbation, `VERIFIED`. Une recharge
   au-delà du plafond non identifié est refusée après (réutilise l'appel de WP05 si pratique, sinon
   la fonction du plafond).
5. Auteur refusé : `lw.approve(id, lw.author())` : statut 4xx, demande toujours `PENDING`,
   identification toujours `VERIFIED` ; l'approbation par un `SUPERVISOR` refusée (`403`).
6. Déjà révoquée : demande de révocation d'une identification `REVOKED` : `409 CONFLICT_STATE`,
   aucune demande créée ; **et** (contrat) demande `PENDING` créée, identification révoquée par une
   autre voie (`revoke_kyc_ verification` en propriétaire), approbation : `200` avec
   `status: 'FAILED'`, `failure_code: 'CONFLICT_STATE'`.
7. Motif de 9 caractères : `422` ; clé en trop : `422` ; identification inconnue ou d'un autre
   prestataire : `404` ; rôle `CASHIER` : `403`.
8. Deux demandes sur la même identification : la seconde `409`.
9. Journaux : `id_last4` admis dans `audit_log` (`result`), mais absent des sorties standard et
   d'erreur espionnées pendant la demande et l'approbation.

**Mutations obligatoires** (note de lane : mutation et résultat) : (a) retire le contrôle `REVOKED`
à la demande : le test 6 échoue ; (b) remplace `requestedBy` par `approvedBy` dans `execute` : le
test 3 échoue ; (c) ajoute `CASHIER` à `KYC_REVOCATION_ROLES` : le test 1 échoue ; (d) retire le
contrôle `target_id` du `guardDecision` : un test qui fabrique une demande à `target_id` différent
(insertion par le propriétaire) échoue.

### T026 : contradiction §6.3 notée en tête du module

En-tête de `kyc-revocation-action.ts` (commentaire, ton des en-têtes du dépôt) : SPECIFICATION §6.3
point 5 dit « un administrateur PEUT révoquer » ; `openapi.yaml` (`revokeKycVerification`) exige
deux personnes ; le contrat prime (§0.3, C-002) ; contradiction signalée au porteur, consignée par
WP11 (point ouvert et ADR). **N'édite pas `SPECIFICATION.md`.** Cite aussi ADR-74 (deux personnes)
et l'écart de `research.md` R-03 ci-dessus.

## Branch Strategy

- Planification et fusion : `feat/serveur-app-festivalier`.
- Worktree de lane calculé par `lanes.json` ; la base contient WP05 (donc WP01 à WP04).
- Commande : `LC_ALL=C LANG=C spec-kitty agent action implement WP06 --agent claude --mission
  serveur-app-festivalier-01M7WB69`.

## Commandes de preuve

```
cd <lane>/apps/api
export PGDATABASE=cashless_wp06; source ../../tools/dev-db/env.sh; env | grep DATABASE_URL
SKIP_LATENCY=1 npx jest test/integration/kyc/revoke.spec.ts --runInBand --forceExit
npx eslint src/kyc test/integration/kyc && npx tsc --noEmit -p tsconfig.json
node ../../tools/contract-stability/check.mjs   # 0 refus : aucun changement de contrat
```

## Definition of Done

- [ ] `KYC_REVOCATION` enregistrée (rôles bornés), route `202`, `409` à la demande, `FAILED` à
  l'exécution.
- [ ] `revoked_by` = auteur de la demande ; valideur dans l'audit ; niveau `NONE` après approbation
  (FR-006).
- [ ] `revoke.spec.ts` vert sur `cashless_wp06` ; quatre mutations vérifiées et consignées.
- [ ] Contradiction §6.3 en tête du module ; `SPECIFICATION.md`, `sqlstate-map.ts`, `kyc.service.ts`
  intacts.
- [ ] Deux lignes hors carte dans `kyc.module.ts`, listées dans la note de lane.
- [ ] `check.mjs` à 0 refus ; `eslint` et `tsc` propres ; lignes de 100 caractères au plus.

## Risks

1. Le rôle exigé est contrôlé sur la portée `EVENT` : une identification sans portefeuille prend la
   portée `OPERATOR` ; `requestedBy` et `approvedBy` inversés : le test 3 le fige.
2. `guardDecision` trop zélé (refuser une identification révoquée) laisse la demande `PENDING` au
   lieu de `FAILED` : contraire au contrat.
3. Ligne hors carte de `kyc.module.ts` oubliée : la route répond `404` ; ajoutée deux fois : le
   registre refuse le doublon.

## Ce que le relecteur doit casser

- Approuver sa propre demande (auteur) ; approuver avec un rôle hors liste ; approuver depuis un
  autre prestataire.
- Lancer deux demandes concurrentes sur la même identification ; révoquer une identification déjà
  révoquée avant et après la demande.
- Falsifier la charge (`reason`, `kyc_verification_id`, champ en trop) par une écriture du
  propriétaire dans `approval_request.payload` : l'exécution doit refuser sans écrire.
- Vérifier `revoked_by` (auteur) et le valideur dans `audit_log` ; chercher un `id_last4` dans les
  journaux applicatifs.
- Retirer chaque contrôle listé en mutation et vérifier que le test échoue ; chercher un test qui
  passe sans assertion sur la base.
- Vérifier que `sqlstate-map.ts`, `approval.service.ts` et `openapi.yaml` n'ont pas bougé.
