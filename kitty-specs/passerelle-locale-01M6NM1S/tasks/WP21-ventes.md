---
work_package_id: WP21
title: 'Ventes sur la passerelle : passages, paiements, annulations, refus'
dependencies: [WP18, WP19, WP20]
requirement_refs:
- FR-010
- FR-011
- FR-012
- NFR-005
planning_base_branch: feat/passerelle-locale
merge_target_branch: feat/passerelle-locale
branch_strategy: Planning artifacts for this mission were generated on feat/passerelle-locale. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/passerelle-locale unless the human explicitly redirects the landing branch.
subtasks: [T093, T094, T095, T096, T097]
phase: Phase 4 - Passerelle
agent: claude
history:
- timestamp: '2026-11-05T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/gateway/src/operations/sales/
create_intent: [apps/gateway/src/operations/sales/taps.service.ts, apps/gateway/src/operations/sales/payments.service.ts, apps/gateway/src/operations/sales/reversals.service.ts, apps/gateway/src/operations/sales/sales.controller.ts, apps/gateway/src/operations/sales/unavailable-operations.ts, apps/gateway/src/operations/sales/sales.module.ts, apps/gateway/test/sales/taps.spec.ts, apps/gateway/test/sales/payments.spec.ts, apps/gateway/test/sales/reversals.spec.ts, apps/gateway/test/sales/refusals.spec.ts, apps/gateway/test/sales/reference-scenarios.spec.ts, apps/gateway/test/sales/contract.spec.ts, apps/gateway/test/sales/latency.spec.ts]
execution_mode: code_change
model: sonnet
owned_files: [apps/gateway/src/operations/sales/**, apps/gateway/test/sales/**]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP21 – Ventes sur la passerelle

> **Arbitrages de l'orchestrateur** : `contracts/interfaces.md` § 12 fait foi sur ce prompt, notamment pour l'annulation par le vendeur seul (§ 12.10).


## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude).
Lis ensuite la fiche de contexte, ce prompt, puis seulement :

- `contracts/gateway-served-operations.md` en entier, mais surtout les lignes 6, 9, 10, 11 du
  tableau, les notes 4, 5, 7, « Comportements communs » et « Opérations refusées pendant `EDGE` » ;
- `contracts/interfaces.md` § 4 (`AUTHORITY`, `EDGE_QUEUE`), § 5, § 7 (lignes « passerelle
  `ACTIVE`... » à « `ARMED`, `STANDBY` »), § 10 ;
- `data-model.md` B.2 (`edge_op`, `edge_op_delta`), B.3 (`edge_wallet`, `edge_media`, `edge_tap`),
  B.4 (`edge_vendor_session`, `edge_vendor`, `edge_catalog_item`, `edge_event_setting`), B.5, B.7
  (invariants 1, 3, 5) ;
- `research.md` R-18 (`tap_id` locaux), R-21 (sessions vendeur), R-25 (verdicts des opérations 6, 9,
  10, 11), R-12 (contenu haché), R-28 (NFR-005) ;
- `docs/passation-8/rapports/plan-adversarial.md` A07, A08, A27 ; `docs/passation-8/contexte-m8.md`
  décisions 4, 13.

Code de référence de l'API (à lire, **ne pas importer**) : `apps/api/src/payments/` (services
`createPayment`, `reversePayment`, correspondance des erreurs, formats de réponse),
`apps/api/src/taps/`. Les règles de calcul
(arrondis, `spend_order`, lignes, commissions) viennent de `@cashless/shared-rules`. Le schéma de
réponse est `openapi.yaml` (WP01 l'a déjà). Priorité des sources : SPECIFICATION §0.3 ;
contradiction signalée.

## Objective

Servir `createTap`, `createPayment`, `getPayment`, `reversePayment` sur la passerelle avec **les
mêmes formats et les mêmes erreurs** qu'au central (FR-010), sous l'autorité de la passerelle
(FR-011, FR-012), en écrivant
la décision en file avant de répondre. Refuser avec les codes figés tout ce que la passerelle ne
sert pas, sans rien écrire ni consommer de numéro.

## Branch Strategy

Planification `feat/passerelle-locale`, cible `feat/passerelle-locale`, worktree alloué par lane
selon `lanes.json`.

## Commande

`spec-kitty agent action implement WP21 --agent claude --mission passerelle-locale-01M6NM1S`
(précédée de `LC_ALL=C LANG=C`).

Rappels : ni Jest, ni pgTAP, ni `reset-db` (l'orchestrateur, en série) ; pas de commit ; port 80
intouché ; aucun `GRANT` ; aucune dépendance npm nouvelle ; un écart qui affaiblit la sécurité
s'arrête et remonte au porteur.

## T093 – `createTap` et `edge_tap` locale

- `POST /taps`, trois preuves (`DeviceProofsGuard`), lecture de `edge_media` (par `token_hash`),
  `edge_wallet`, `edge_device`. Écrit `edge_tap` (`tap_id` bigserial **local**, compteur, résultat)
  dans sa propre transaction ; le compteur est comparé au compteur répliqué (anti-clone, R-18).
  Résultats `BLOCKED`, `NOT_ACTIVATED`, `UNKNOWN`... en `200` comme au central ; `409 TAP_UNUSABLE`
  pour un `tap_id` non local ou déjà consommé.
- Le `tap_id` n'entre pas dans le contenu haché et n'est **jamais** envoyé au central ; l'objet
  `tap` de l'opération (compteur, UID, signature) l'est, c'est ce que le central rejoue (R-18).
- Aucun écriture en file : un passage n'est pas une décision. `createTap` ne dépend pas de
  l'autorité de débit (lecture, servie dans tous les états sauf `REVOKED`).

## T094 – `createPayment`, `getPayment`

**But** : décision locale, déterministe, numérotée avant la réponse.

Ordre, **dans une seule `GatewayTx`** : (1) preuves (garde) ; (2) idempotence : même clé
`<serial>:<seq>` et même empreinte -> même réponse, sans nouvelle entrée ; (3)
`AuthorityService.assertCanDebit(X-Authority-Epoch)` avec
la transaction courante ; (4) session vendeur valide (`edge_vendor_session` : non expirée, non
fermée, du terminal ; sinon `409 VENDOR_SESSION_INVALID`) ; (5) lecture du tap consommable et du
bracelet (statut, lot) et du
portefeuille ; (6) lignes de vente et prix contre `edge_catalog_item` (`422 SALE_LINES_INVALID`),
`EVENT_CLOSING` ; (7) calcul par `@cashless/shared-rules` (montants, répartition `spend_order`,
frais et commissions) ;
(8) solde effectif via `ReplicationService.effectiveBalance(tx, walletId)` : insuffisant -> refus
`INSUFFICIENT_FUNDS` avec le solde disponible ; (9) `EdgeQueue.append(tx, op, deltas)` avec
`edge_decision` ; (10) idempotence et nonce
consignés, tap consommé ; (11) `COMMIT` ; (12) `failpoint('after-local-write-before-reply')` ;
réponse.

- **Refus final qui consomme un numéro** (contrat, note 4) : `INSUFFICIENT_FUNDS`, `MEDIA_BLOCKED`,
  `WALLET_BLOCKED`... sont enregistrés comme entrée `VOID` (`void_reason`) dans la même transaction
  : un trou de numéro est interdit. Un refus **avant** l'autorité (étape 3 ou preuves) n'écrit rien,
  ne consomme rien.
- Paiement par `customer_qr_token` ou QR commerçant : `409 DEBIT_AUTHORITY_EDGE`, `retryable:
  false`, sans `edge_base_url`, avec l'époque, rien d'écrit (note 7).
- `getPayment` : lecture des écritures locales du terminal ; `404` neutre hors de ses propres ventes
  (garde exclusive terminal) ; jamais la vente d'un autre terminal.
- Le `payment.status` rendu doit avoir **la même forme** que celui du central ; si le central
  renvoie un champ qui n'existe pas localement (par exemple `transaction_id` définitif), utilise le
  champ du contrat prévu pour une décision de passerelle et signale l'écart si le schéma n'en
  prévoit pas (ne l'invente pas).

**Cas limites** : montant zéro, très grand (2^53), lignes vides, devise différente, vendeur bloqué,
bracelet d'un autre événement, `X-Authority-Epoch` absent (la route le déclare), deux requêtes
simultanées pour le même
bracelet (le verrou du portefeuille local évite la double dépense : `SELECT ... FOR UPDATE` sur
`edge_wallet`), deux paiements de même clé en parallèle (un seul effet).

## T095 – `reversePayment`

- Annulation d'une vente décidée **par cette passerelle** (entrées locales) : `REVERSAL`
  `EDGE_ONLINE` avec `reverses_seq` (ou `reverses_transaction_id` si la vente est déjà `ACCEPTED`).
  Fenêtre `event.terminal_settings.reversal_window_minutes` mesurée sur `GatewayClock` : `409
  REVERSAL_WINDOW_EXPIRED` ; `409 ALREADY_REVERSED` ; `422 REVERSAL_NOT_ALLOWED` ; session vendeur ;
  `409 STALE_AUTHORITY_EPOCH` ; `404` si la vente d'origine est inconnue
  (`REVERSAL_TARGET_NOT_FOUND` au rejeu côté central, A11).
- Le montant annulé est **celui de la vente d'origine**, jamais supérieur (A08 : une annulation ne
  crée pas d'argent) ; une seconde annulation de la même vente est refusée localement. Le delta est
  positif, borné à la vente.
- `X-Approval-Token` (superviseur) : **non servi** dans ce lot (note 5 dépend de la vérification
  OIDC hors central, non décidée) ; un jeton d'approbation présenté est refusé `403
  APPROVAL_INVALID` et seule l'annulation par le vendeur de la vente est servie. C'est un
  **renforcement** : consigne-le dans le rapport et signale-le au porteur ; ne fabrique pas de
  vérificateur d'approbation.

## T096 – Refus des opérations indisponibles (`unavailable-operations.ts`)

Une table unique, codes figés par `interfaces.md` § 7 et « Opérations refusées pendant `EDGE` » :
`FROM_BALANCE` et frais d'activation sur solde (les endpoints sont servis par WP22 qui s'appuie sur
cette table), QR client,
`releaseMedia` (`POST /media/{media_id}/release`) -> `409 DEBIT_AUTHORITY_EDGE` (`retryable: false`,
sans `edge_base_url`, époque présente), `ARMED`/`STANDBY` -> `409 CONFLICT_STATE` détail
`GATEWAY_NOT_AUTHORITY`,
`RELEASING` -> `DEBIT_AUTHORITY_MOVING`, `STALE` -> `STALE_AUTHORITY_EPOCH`. Les routes de session
(caisse, vendeur) restent `404`. Chaque refus : **rien d'écrit, aucun numéro**.
Les lectures restent servies dans tous les états sauf `REVOKED`.

## T097 – Conformité, scénarios de référence, latence

- `reference-scenarios.spec.ts` : lit `packages/ledger-sql/scenario_reference.json` (jamais modifié)
  et rejoue les scénarios applicables à une vente sur la passerelle ; les montants, répartitions et
  commissions égalent ceux de la référence. Un scénario non applicable est listé avec sa raison dans
  le test (pas de saut silencieux).
- `contract.spec.ts` : réponses de `createTap`, `createPayment`, `getPayment`, `reversePayment`
  (200, 201, 4xx, 409) valides contre `openapi.yaml` ; formes d'erreur égales à celles du central.
- `latency.spec.ts` : **1 000 paiements** en série puis à concurrence 10, serveur seul : p95 <= 200
  ms, p99 <= 500 ms (NFR-005). Le test lit `SKIP_LATENCY` comme celui de l'API (mesure écartée de la
  passe parallèle) ; la preuve **à deux processus** est reprise par WP25.

## Tests attendus (`apps/gateway/test/sales/`)

`taps.spec.ts` : anti-clone, `TAP_UNUSABLE`, tap non local. `payments.spec.ts` : chemin heureux,
idempotence (100 rejeux : une entrée), concurrence sur le même portefeuille (jamais de solde
négatif), `VOID` sans trou,
rien d'écrit avant l'autorité, arrêt avant/après écriture (voir WP20), recharge locale puis
paiement. `reversals.spec.ts` : fenêtre, double annulation, montant borné, `X-Approval-Token`
refusé. `refusals.spec.ts` : **un test par
ligne du tableau** (rien d'écrit, aucun numéro consommé : compare `edge_chain_head` avant/après).
Chaque test doit échouer sur une implémentation qui oublie `assertCanDebit` ou qui écrit hors
transaction.

## Sécurité

- Aucun débit hors `ACTIVE` et époque ; le refus précède toute écriture. Aucune route hors liste.
- A07/A08 côté passerelle : ce lot ne dépasse jamais le solde effectif et n'annule jamais plus que
  la vente d'origine ; les plafonds de rejeu sont au central (WP06).
- À faire relire par une personne : `payments.service.ts` (ordre des étapes 3 à 11),
  `unavailable-operations.ts`.

## Definition of Done

- [ ] Ordre des étapes respecté, une seule transaction, `COMMIT` avant la réponse.
- [ ] Tous les refus du tableau prouvés sans écriture ni numéro ; schémas du contrat valides.
- [ ] Scénarios de référence égaux ; NFR-005 mesuré (p95, p99).
- [ ] `X-Approval-Token` : renforcement consigné et signalé ; lignes de 100 caractères.

## Ce que le relecteur doit casser

- Payer en `RELEASING`, `STALE`, `ARMED`, `GRANTED_PENDING` : un `edge_op` ne doit jamais
  apparaître.
- Payer deux fois en parallèle sur un solde qui n'en permet qu'un ; rejouer 100 fois la même clé.
- Tuer le processus après le `COMMIT` et avant la réponse, puis rejouer : même réponse, une entrée.
- Annuler une vente deux fois, annuler pour plus que la vente, annuler hors fenêtre, après
  changement d'horloge de 2 h.
- Utiliser un `tap_id` du central sur la passerelle et inversement.
