---
work_package_id: WP22
title: 'Guichet sur la passerelle : tolérance des jetons de personne, recharges, activations, cautions'
dependencies: [WP18, WP19, WP20]
requirement_refs:
- FR-015
- FR-016
- C-005
planning_base_branch: feat/passerelle-locale
merge_target_branch: feat/passerelle-locale
branch_strategy: Planning artifacts for this mission were generated on feat/passerelle-locale. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/passerelle-locale unless the human explicitly redirects the landing branch.
subtasks: [T098, T099, T100, T101, T102]
phase: Phase 4 - Passerelle
agent: claude
history:
- timestamp: '2026-11-05T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/gateway/src/staff/
create_intent: [apps/gateway/src/staff/staff-token.guard.ts, apps/gateway/src/staff/identity-keys.service.ts, apps/gateway/src/staff/tolerance-audit.ts, apps/gateway/src/staff/staff.module.ts, apps/gateway/src/operations/counter/cash-topup.service.ts, apps/gateway/src/operations/counter/media-activation.service.ts, apps/gateway/src/operations/counter/deposit.service.ts, apps/gateway/src/operations/counter/counter.controller.ts, apps/gateway/src/operations/counter/counter.module.ts, apps/gateway/test/counter/staff-token.spec.ts, apps/gateway/test/counter/tolerance-bounds.spec.ts, apps/gateway/test/counter/cash-topup.spec.ts, apps/gateway/test/counter/activation.spec.ts, apps/gateway/test/counter/deposit.spec.ts, apps/gateway/test/counter/refusals.spec.ts, apps/gateway/test/counter/contract.spec.ts]
execution_mode: code_change
model: sonnet
owned_files: [apps/gateway/src/staff/**, apps/gateway/src/operations/counter/**, apps/gateway/test/counter/**]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP22 – Guichet sur la passerelle

> **Arbitrages de l'orchestrateur** : `contracts/interfaces.md` § 12 fait foi sur ce prompt, notamment pour `edge_identity_key` et `GATEWAY_IDENTITY_JWKS_URL`.


## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude).
Lis ensuite la fiche de contexte, ce prompt, puis seulement :

- `contracts/gateway-served-operations.md` : paragraphe « Personne au guichet », « Exclusion »,
  lignes 7, 8, 12 du tableau, notes 1 et 6, tableau « Opérations refusées pendant `EDGE` » ;
- `contracts/interfaces.md` § 4, § 7, § 10 (`StaffTokenGuard`), § 8 ;
- **`research.md` R-20 en entier** (sept conditions dans l'ordre, A15), R-10 (clés d'origine, A10,
  A24), R-11 (garde de caisse ADR-132), R-14 (horloge) ;
- `data-model.md` B.4 (`edge_cash_session`, `edge_staff`, `edge_identity_key`), B.1 (`activated_at`,
  `token_tolerance_until`), B.6 (`edge_audit` `STAFF_TOKEN_TOLERATED`), B.7 (invariants 1, 3, 8) ;
- `docs/passation-8/rapports/plan-adversarial.md` A09, A10, A15, A24 ;
  `docs/passation-8/contexte-m8.md` décisions 3, 14, 18 ; ADR-132 dans `docs/DECISIONS_ADR.md`.

Code produit par les lots précédents : `DeviceProofsGuard`, `IdempotencyService` (WP19),
`AuthorityService` (WP17), `EdgeQueue` (WP20), `effectiveBalance` (WP18), `GatewayClock` (WP16).
Code de référence de l'API (à lire, **ne pas importer**) : le garde de personne et `counter-auth` de
`apps/api/src/`, `cash-topups`, `media/activation`. Priorité des sources : SPECIFICATION §0.3 ;
contradiction signalée.

## Objective

Servir `createCashTopup`, `activateMedia` et `takeDeposit` sur la passerelle, avec l'identité d'une
personne vérifiée **sans le serveur d'identité** au besoin, sur une **session de caisse répliquée
ouverte avant la bascule**.
Ce lot porte l'écart accepté le plus délicat de la mission (jeton de personne expiré toléré,
décision 3, `OP-N103`, `ADR-158`) : ses bornes sont l'essentiel de la preuve.

## Branch Strategy

Planification `feat/passerelle-locale`, cible `feat/passerelle-locale`, worktree alloué par lane
selon `lanes.json`.

## Commande

`spec-kitty agent action implement WP22 --agent claude --mission passerelle-locale-01M6NM1S`
(précédée de `LC_ALL=C LANG=C`).

Rappels : ni Jest, ni pgTAP, ni `reset-db` (l'orchestrateur, en série) ; pas de commit ; port 80
intouché ; aucun `GRANT` ; aucune dépendance npm nouvelle ; **toute tolérance plus large que R-20
est un écart qui s'arrête et remonte au porteur**.

## T098 – `StaffTokenGuard` : sept conditions, ordre, audit

`class StaffTokenGuard implements CanActivate` (`interfaces.md` § 10), appliqué aux seules routes
`CounterAuth` (`activateMedia`, `takeDeposit`, `createCashTopup`), en-tête `X-Staff-Authorization`.

- **Jeton non expiré** : règle normale (aucune tolérance) : signature (clé publique de
  `edge_identity_key`), `iss`, `aud`, `exp`, puis personne relue dans `edge_staff` (`ACTIVE`, rôle
  `CASHIER` ou `SUPERVISOR` de l'événement).
- **Jeton expiré** : les conditions de R-20, **toutes** exigées, **dans cet ordre**, la première qui
  échoue refuse (`401`, comme un jeton expiré au central) :
  1. signature valide, `kid` dans la copie répliquée, `iss`, `aud` ; 2. `sub` + `iss` égalent
     `edge_cash_session.opened_by_sub/_iss` de la session citée ; 3. terminal de la requête =
     `device_id` de la session ;
  4. session `OPEN` et `usable_on_edge` ; 5. `iat <= activated_at`, **`exp >= activated_at`** (A15)
     et `maintenant <= edge_authority.token_tolerance_until` (borne fixe `activated_at + 12 h`,
     jamais prolongée) ;
  6. personne `ACTIVE` avec rôle habilité dans l'état répliqué ; 7. ligne d'audit
     `STAFF_TOKEN_TOLERATED` (`sub`, `jti`, secondes de dépassement, route, terminal, `edge_seq`)
     écrite **avant la réponse, dans la même transaction que l'opération**.
- « Maintenant » = `GatewayClock.now()`, jamais l'horloge système. `activated_at` est l'heure
  **centrale** de l'accusé (WP17). Si `edge_authority` n'est pas `ACTIVE`, aucune tolérance : refus.
- La tolérance ne vaut que pour ces trois routes et **jamais** hors passerelle ; aucun autre garde
  ne l'appelle.
- `identity-keys.service.ts` : tient la copie `edge_identity_key` en rafraîchissant les clés
  publiques à `GATEWAY_IDENTITY_JWKS_URL` tant que le serveur d'identité est joignable ; il n'y a
  **aucune clé d'identité dans le flux du central** (B.4). Ce service est **sans propriétaire** dans
  le plan : il est pris ici (gap signalé). Il n'accepte une clé que de l'URL configurée, refuse une
  clé sans `kid`, ne supprime jamais une clé connue sur une erreur réseau. En production, un
  vérificateur de clés en mémoire est un faux (`GATEWAY_IDENTITY_VERIFIER=test`) : refusé au
  démarrage par la garde de WP16 ; enregistre ta règle par `registerProductionRule`.
- `tolerance-audit.ts` : écrit la ligne dans `edge_audit` (chaînée) ; elle sera versée au central
  par le lot suivant (`staff_token_audit`, WP20) ; la ligne locale reste jusqu'à la purge.

## T099 – `createCashTopup` : session répliquée seulement

- Route `POST /topups/cash`, trois preuves + `staffBearer` + `X-Authority-Epoch` +
  `Idempotency-Key`. Terminal en mode `TOPUP_DESK` (`403` sinon). `assertCanDebit(epoch)` d'abord
  (une recharge est un crédit mais la passerelle ne le sert qu'en `ACTIVE`, FR-015).
- **Session de caisse** : `edge_cash_session` `OPEN`, `usable_on_edge`, du terminal de la requête,
  **répliquée avant la bascule** ; absente ou ouverte après la bascule : `409 CONFLICT_STATE`,
  **rien d'écrit** (FR-015). Aucune exemption de garde de caisse (C-005).
- Plafonds (`wallet_limits`, `topup_month_paid`, `kyc_verified`) lus dans l'état répliqué : `422
  WALLET_LIMIT_EXCEEDED`, `422 MONTHLY_TOPUP_LIMIT_EXCEEDED`. **La recharge n'est jamais rejetée
  pour un plafond au rejeu** (décision 14, deux parts côté central) : les plafonds sont donc
  appliqués ici, à la vente, sur l'état répliqué.
- File : `TOPUP_CASH`, `EDGE_ONLINE`, clé d'origine = `Idempotency-Key`. Le delta positif relève le
  solde effectif **immédiatement** (B.7-5) ; **une recharge n'est créditée qu'avec sa trace en
  file** (même transaction).
- Contradiction de texte à consigner (note 6) : `OfflineOperationType` rejette `TOPUP_CASH` dans un
  lot de terminal sans exception pour la passerelle ; la file de la passerelle l'emploie avec
  `EDGE_ONLINE`. Ne change rien, signale.

## T100 – `activateMedia` sans frais sur solde

- `POST /media/activations` ; `Idempotency-Key` `<serial>:<seq>` = clé d'origine (A10). Pas
  d'`X-Authority-Epoch` déclaré au contrat (note 1) : le contrôle de l'état `ACTIVE` et de l'accusé
  est fait par la passerelle seule.
- Bracelet cherché dans `edge_media`/`unassigned_media` ; **`wallet_id` d'une activation anonyme
  généré par la passerelle doit être nouveau** (A24 : le central le vérifie au rejeu ; ici, génère
  un UUID v4 et vérifie qu'il n'existe pas localement) ; `422 ACTIVATION_MODE_NOT_ALLOWED` selon
  `event.activation_modes`.
- Frais d'activation prélevés sur le solde : `409 DEBIT_AUTHORITY_EDGE` (via la table de WP21,
  `retryable: false`, sans `edge_base_url`). Caution en espèces : session `OPEN` requise (sinon `409
  CONFLICT_STATE`) ; file : `ACTIVATION` puis `DEPOSIT_CASH` à la suite, clé
  `<serial>:<seq>#deposit`, deux numéros consécutifs dans la **même** transaction. `channel = DESK`.

## T101 – `takeDeposit` en espèces

- `POST /media/{media_id}/deposit` ; `FROM_BALANCE` et `payment.method` autre que `CASH` : `409
  DEBIT_AUTHORITY_EDGE`. Session `OPEN` **du terminal** et `cash_session_id` concordant, sinon `409
  CONFLICT_STATE`. Idempotent si déjà `HELD`. File : `DEPOSIT_CASH`, `edge_guichet` (`media_id`,
  `deposit_amount`, `cash_desk_account_id` = celui de la session du terminal, que le central
  revérifie).

## T102 – Tests (`apps/gateway/test/counter/`)

- `staff-token.spec.ts` : jeton valide ; jeton expiré toléré dans le cas nominal (une ligne d'audit,
  même transaction que l'opération) ; la ligne d'audit **disparaît si l'opération échoue**
  (rollback) ; clé inconnue ; `iss`/`aud` faux.
- `tolerance-bounds.spec.ts` : chaque borne qui échoue **seule**, et la **limite exacte** : 12 h
  après `activated_at` accepté, **12 h + 1 s refusé** (horloge de test pilotée, jamais l'horloge de
  Node comparée à celle de la base) ; `exp` antérieur à la bascule refusé même sur une session
  ouverte depuis des jours ; autre personne ; autre terminal ; session fermée ; session ouverte
  **après** la bascule ; `iat` après la bascule ; personne dont l'affectation est devenue inactive
  dans l'état répliqué ; état d'autorité non `ACTIVE` ; horloge reculée de 13 h après redémarrage
  (jamais plus de 12 h de tolérance, WP16). **Ces tests échouent si la limite s'élargit (règle 3 du
  porteur).**
- `cash-topup.spec.ts` : session répliquée seule ; sans session ou ouverte après la bascule : rien
  d'écrit ; plafonds ; trace en file avec le crédit ; 100 rejeux : un effet.
- `activation.spec.ts` / `deposit.spec.ts` : anonyme, nominatif, `wallet_id` déjà connu refusé,
  caution espèces, deux numéros consécutifs, `FROM_BALANCE` et frais sur solde refusés sans numéro
  consommé, caution idempotente.
- `refusals.spec.ts` : un test par ligne du tableau « Opérations refusées » qui concerne ce lot ;
  `contract.spec.ts` : schémas.

## Décisions du porteur du 09/11/2026 (font foi sur ce prompt)

Source : `docs/passation-8/contexte-m8.md`, décisions 19 à 31, et les notes adressées à ce lot dans
`docs/passation-8/suivi-lots.md` (à lire en entier pour ce lot).

- Décision 21 : plafond par recharge en espèces à la saisie, réglable (500 000 XOF par défaut, même réglage que la
  base, répliqué) ; au-delà, refus sans écriture ni mise en file, avec un code d'erreur déjà au contrat (sinon le
  signaler, ne rien ajouter à `openapi.yaml`) ; test à la borne et juste au-dessus.

## Sécurité

- Écart accepté `OP-N103` : un compte révoqué ou désactivé pendant la coupure peut agir jusqu'à 12
  h. Borné par : même session, même terminal, même personne, `exp >= activated_at`, 12 h fixes,
  audit versé au central. Ne l'élargis jamais ; signale tout doute.
- Aucun usage sans audit ; aucune tolérance sur une route autre que les trois ; aucune clé de
  signature dans une réponse ou un journal.
- À faire relire par une personne : `staff-token.guard.ts` (cryptographie et ordre des conditions),
  `identity-keys.service.ts`.

## Definition of Done

- [ ] Sept conditions dans l'ordre, chacune testée seule ; limites exactes (12 h, 12 h + 1 s, `exp` avant bascule).
- [ ] Recharge refusée sans session répliquée ; plafonds appliqués localement ; trace en file avec le crédit.
- [ ] `identity-keys.service.ts` livré (gap signalé) ; règle de production enregistrée.
- [ ] Contradiction note 6 et note 1 signalées ; lignes de 100 caractères.

## Ce que le relecteur doit casser

- Présenter un jeton expiré avant la bascule, ou à 12 h + 1 s, ou d'une autre personne, sur un autre
  terminal, sur une session fermée ou ouverte après la bascule.
- Faire échouer l'opération après le garde : la ligne d'audit ne doit pas survivre seule, et
  l'opération ne doit pas exister sans sa ligne d'audit.
- Recharger sans session répliquée ; recharger au-delà du plafond ; rejouer 100 fois.
- Activer avec un `wallet_id` existant ; caution sur solde ; frais d'activation sur solde.
- Faire reculer l'horloge système de 13 h puis redémarrer ; tenter la tolérance sur `createPayment`.
