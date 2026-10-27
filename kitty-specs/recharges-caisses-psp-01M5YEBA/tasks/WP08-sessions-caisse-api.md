---
work_package_id: WP08
title: Sessions de caisse (API) et dépôt en banque
dependencies: [WP01, WP05, WP06, WP07]
requirement_refs: [FR-001, FR-002, FR-003, FR-029, FR-031]
planning_base_branch: feat/recharges-caisses-psp
merge_target_branch: feat/recharges-caisses-psp
branch_strategy: Planning artifacts for this mission were generated on feat/recharges-caisses-psp. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/recharges-caisses-psp unless the human explicitly redirects the landing branch.
subtasks: [T037, T038, T039, T040, T041, T042]
phase: Phase 3 - Caisses et espèces
agent: claude
model: sonnet
agent_profile: implementer-ivan
role: implementer
history:
- timestamp: '2026-10-27T15:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
authoritative_surface: apps/api/src/cash-sessions/
execution_mode: code_change
owned_files: [apps/api/src/cash-sessions/**, apps/api/test/integration/cash-sessions/**, apps/api/test/integration/end-to-end/device-auth-cases/cash-sessions.cases.ts]
create_intent: [apps/api/src/cash-sessions/cash-sessions.module.ts, apps/api/src/cash-sessions/cash-sessions.controller.ts, apps/api/src/cash-sessions/event-cash-sessions.controller.ts, apps/api/src/cash-sessions/cash-sessions.service.ts, apps/api/src/cash-sessions/cash-session-read.service.ts, apps/api/src/cash-sessions/cash-sessions.dto.ts, apps/api/src/cash-sessions/terminal-or-person.guard.ts, apps/api/src/cash-sessions/cash-deposit-action.ts, apps/api/test/integration/cash-sessions/cash-session-fixtures.ts, apps/api/test/integration/cash-sessions/open-count.spec.ts, apps/api/test/integration/cash-sessions/blind-count.spec.ts, apps/api/test/integration/cash-sessions/close.spec.ts, apps/api/test/integration/cash-sessions/read.spec.ts, apps/api/test/integration/cash-sessions/cash-deposit.spec.ts, apps/api/test/integration/cash-sessions/close-concurrency.spec.ts, apps/api/test/integration/end-to-end/device-auth-cases/cash-sessions.cases.ts]
tags: []
tracker_refs: []
---

# Work Package Prompt: WP08 – Sessions de caisse (API) et dépôt en banque

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche de contexte d'implémentation fournie par
l'orchestrateur, ce prompt, puis seulement, dans `kitty-specs/recharges-caisses-psp-01M5YEBA/` :
`spec.md` (FR-001 à FR-003, FR-029, FR-031, NFR-007, NFR-008), `research.md` R-01 à R-04, R-15 et
**R-20** (section « Caisses »), `research-adversarial.md` (A7, A8, A21, A26, A27, A32),
`contracts/cash.md` (règles 1 à 6, 9, 10 et table des écritures), `contracts/database-rights.md`,
`plan.md` IC-01, IC-02, IC-10, `data-model.md` (`cash_session`, `cash_desk`, `cash_session_count`,
`cash_session_tx`, extension `anomaly`). Livré en amont : `packages/contracts/openapi.yaml` (WP01 :
`openCashSession`, `countCashSession`, `closeCashSession`, `getCashSession`, `listCashSessions`),
`packages/ledger-sql/migrations/0036_cash_sessions.sql` (WP02 : **les signatures réelles de
`open_cash_session`, `count_cash_session`, `begin_cash_close`, `finish_cash_close`, `attach_cash_tx`
font foi** ; relis aussi ses commentaires pour les `ERRCODE`), `post-roles.sql` (WP05 : tes appels
tournent sous `cashless_app`), `apps/api/src/ledger/builders/closing/cash.ts` (WP06 :
`buildCashClose` à théorique nul), `apps/api/src/psp/` (WP07, seulement pour `app.module.ts`). Code
de référence : `apps/api/src/media/lifecycle/counter-access.ts` (`CounterAuth`,
`CounterAccess.authorize`, `counterScope`), `deposit.controller.ts` (route de guichet idempotente),
`apps/api/src/device-identity/device-or-caller.guard.ts` (garde exclusive : **le modèle de ta
garde**), `device.guard.ts`, `apps/api/src/identity/authentication.guard.ts`,
`staff-token.decorator.ts`, `scope-resolver.ts` (`resolveChain`, `exercisedRole`, `hasRole`),
`apps/api/src/idempotency/` (`idempotent.decorator.ts`, `device-key.ts`), `apps/api/src/reversals/`
(`reversals.controller.ts`, `sale-reversal-action.ts` : **le modèle de l'action `CASH_DEPOSIT`**),
`apps/api/src/approval/action-registry.ts` et `approval.service.ts` (`request`, `respondAccepted`),
`apps/api/src/ledger/ledger-engine.service.ts` (`execute`), `apps/api/src/audit/audit.service.ts`,
`apps/api/src/payments/payments.service.ts` (insertion d'anomalie, ligne ~187). Tests modèles :
`test/integration/media/deposit.spec.ts`, `test/integration/reversals/*`,
`test/support/media-fixtures.ts`, `fake-device.ts`, `fake-idp.ts`, `app.ts`, `db.ts`. En cas de
contradiction entre sources, applique la priorité de SPECIFICATION §0.3 (tests exécutables > schéma
SQL, `openapi.yaml`, `sync_protocol.md` > SPECIFICATION > `PRD.md`) et **signale-la**. Ne modifie
jamais un `.sql` généré de `packages/ledger-sql/`.

## Objective

Servir les routes de session de caisse : ouverture et comptage (terminal ET personne), fermeture
(back-office par un `SUPERVISOR`, ou terminal + personne) avec `CASH_CLOSE`, `CASH_DIFF` et
idempotence, lecture (`getCashSession`, `listCashSessions`) selon le rôle, et l'action d'approbation
`CASH_DEPOSIT` du dépôt en banque. Le comptage est à l'aveugle : aucune réponse, aucune erreur ne
révèle le théorique avant la fermeture ; la fermeture exige un `SUPERVISOR` qui n'a fait aucun
comptage de la session.

## Context

- Concerns IC-02 (routes de session), IC-10 (dépôt) ; FR-001, FR-002, FR-003, FR-029, FR-031.
- Décision R-04 : un jeton de personne volé ne doit pas ouvrir une caisse depuis n'importe où : les
  trois preuves du terminal **et** `X-Staff-Authorization` (ADR-113), comme les autres routes du
  guichet.
- La base fait foi (WP02) : garde de caisse sur `posting`, `begin_cash_close` (verrou du solde puis
  état de ligne `CLOSING`), `finish_cash_close`. L'API refuse **avant** d'écrire pour donner le bon
  code, la base reste le filet. Aucune variable de session n'ouvre la garde (A7).
- La session d'un terminal est cherchée par `CounterAccess` (WP09 y ajoute `cashSession` ; **ne
  touche pas** à `counter-access.ts`, il n'est pas à toi) : ici tu lis la session dans ta propre
  requête.
- Dépendants : WP09 (recharge espèces et guichet : session `OPEN` du terminal, `cash_session_id`
  renvoyé), WP14 (parcours complet, concurrence fermeture/recharge, latence), mission 9
  (rapprochement).

**Règle de sécurité du projet (`CLAUDE.md`, règle 1)** : si un point de ce lot ne peut être tenu
qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé,
faux gardé plus longtemps), **arrête-toi sur ce point et soumets-le au porteur avant de coder**,
avec le risque et les options ; continue le reste. Un renforcement se fait, puis se consigne dans le
compte rendu. Aucun faux en production. Aucune nouvelle dépendance npm (R-18).

## Arbitrages de l'orchestrateur (27/10/2026)

Tous dans le sens le plus strict ou de pure répartition ; ils priment sur le texte ci-dessus.

- **Authentification** : `openCashSession` et `countCashSession` = `@CounterAuth()` (terminal +
  personne), mode du terminal `TOPUP_DESK` contrôlé par `assertDeviceMode(actor.device,
  ['TOPUP_DESK'])` (`422 DEVICE_MODE_NOT_ALLOWED`). `closeCashSession` et `getCashSession` admettent
  **deux** chemins exclusifs (garde `TerminalOrPersonGuard`, T037) : terminal +
  `X-Staff-Authorization`, ou `humanBearer` seul, jamais un mélange (un marqueur de terminal présent
  = chemin terminal complet, sans repli). `listCashSessions` = `humanBearer` seul. Un jeton de
  personne ne suffit jamais à ouvrir ou compter.
- **Le terminal décide de la caisse.** Le corps ne choisit ni terminal ni compte. `cash_account_id`
  facultatif ; fourni, il doit être le compte `A-CAISSE-<série>` du terminal (sinon `422
  VALIDATION_FAILED`). Aucun `device_id` accepté (champ inconnu : `422`).
- **Comptage à l'aveugle, sans exception.** Ni `expected_amount` ni `difference` ne sont jamais
  rendus par `openCashSession`, `countCashSession`, ni par `getCashSession` à un `CASHIER`, ni tant
  que la session est `OPEN` (à personne). Aucune erreur ne cite un montant de caisse : les messages
  viennent du catalogue, jamais du texte SQL. Aucune route accessible à un `CASHIER` ne rend le
  solde d'un compte `CASH_DESK` (A27) : inventaire et test (T042).
- **Fermeture** : un `SUPERVISOR` de l'événement (jamais `CASHIER` ni `ORGANIZER_ADMIN`) n'ayant
  fait **aucun** comptage de la session, même s'il a plusieurs rôles (`CounterAccess` choisit
  `CASHIER` avant `SUPERVISOR` : ne t'y fie pas, contrôle `SUPERVISOR` toi-même par
  `exercisedRole`/`hasRole`). Contrôle d'API avant l'appel (`403 FORBIDDEN` si le fermeur a compté),
  la base le re-vérifie (`CL041`, `403`, à mapper dans `errors/sqlstate-map.ts` si WP07 ne l'a pas
  fait : retouche d'une ligne). Comptage obligatoire (`409 CONFLICT_STATE`). Une seule transaction :
  ouverture de fermeture, écriture, anomalie, fin ; tout ou rien (NFR-008).
- **Valeurs lues sous verrou, jamais du client** : le théorique est celui que `begin_cash_close`
  rend ; le compté est le dernier comptage ; le compte de caisse vient de la session ; `occurredAt`
  vient de la base (`clock_timestamp()`), jamais de l'horloge Node. Clé d'écriture exactement
  `cash-close:<cash_session_id>`.
- **Théorique et compté tous deux nuls** : aucune écriture (le constructeur refuse, WP06) ; la
  session est fermée sans transaction (`close_tx_id` nul), sans anomalie.
- **Terminal hors service** : un terminal suspendu ou révoqué ne ferme pas ; le chemin back-office
  reste possible (la fermeture ne dépend pas de l'état du terminal).
- **Dépôt `CASH_DEPOSIT`** : `ORGANIZER_ADMIN` ou `OPERATOR_ADMIN` de l'événement (constante bornée
  testée, aucun autre rôle), auteur et valideur distincts, portée figée lue en base (événement du
  grand livre), exécution en source `BACKOFFICE`, jamais au-delà du solde de `A-TRANSIT` (refus de
  la base, demande `FAILED`).
- **Route de demande du dépôt (arbitrage du 27/10/2026)** : WP01 ajoute `requestCashDeposit` :
  `POST /ledgers/{ledger_id}/cash-deposits/approval-requests` (`humanBearer`, `Idempotency-Key`,
  `202` avec l'`ApprovalRequest`, corps `{amount, bank_reference}`, `ORGANIZER_ADMIN` ou
  `OPERATOR_ADMIN`). Sers-la (contrôleur dans `cash-sessions/`, modèle `reversals.controller.ts`,
  `@Idempotent({ scope: 'bo:', keyUuid: true })`, `respondAccepted`) en plus de
  `CashDepositActions.request(...)`. Relis `openapi.yaml` : si la route n'y est pas (WP01 non
  fusionné), arrête-toi sur ce point et signale-le.
- **Retouches hors carte autorisées, consignées** : `apps/api/src/app.module.ts` (une ligne : import
  de `CashSessionsModule`, fichier de WP07) ; `apps/api/src/errors/sqlstate-map.ts` (les codes de la
  base que la migration 0036 introduit et que WP07 n'aurait pas pu ajouter) ;
  `apps/api/src/audit/audit.service.ts` (règle commune de `tasks.md` : quatre valeurs
  d'`AuditAction`
  ajoutées en fin d'union, une ligne par valeur : `CASH_SESSION_OPENED`, `CASH_SESSION_COUNTED`,
  `CASH_SESSION_CLOSED`, `CASH_DEPOSIT_REQUESTED` ; l'orchestrateur résout les conflits) ;
  `apps/api/test/integration/end-to-end/device-auth-matrix.spec.ts` et son registre (le fichier
  `apps/api/test/integration/end-to-end/device-auth-cases/cash-sessions.cases.ts` est, lui, dans la
  carte du lot) et, si la matrice ne connaît pas
  `TerminalOrPersonGuard`, son ajout à la collecte des routes gardées. Si l'adaptation de la matrice
  dépasse une vingtaine de lignes, arrête-toi et signale-le (le plan ne l'a pas attribuée à un lot).

- **Garde `TerminalOrPersonGuard`** : ce lot la crée (T037, `cash-sessions/`) ; WP09 et WP11 ne la
  créent pas (WP11 garde son `PspTopupCallerGuard`, cas différent). Si WP09 ou WP11 en a besoin plus
  tôt, ils lisent `X-Staff-Authorization` comme elle le fait.
## Branch Strategy

Planification et fusion sur `feat/recharges-caisses-psp`. Dépendances : WP01, WP05, WP06, WP07 (donc
WP02 à WP04). Le worktree est attribué par lane d'après `lanes.json`. Commande : `spec-kitty agent
action implement WP08 --agent claude --mission recharges-caisses-psp-01M5YEBA`. Base de validation :
`cashless_wp08` (`PGDATABASE=cashless_wp08 bash packages/ledger-sql/scripts/reset-db.sh`, puis
`DATABASE_URL_*` vers elle ; pgTAP après reset si besoin). `cashless_test` est réservée à
l'orchestrateur. Worktree sans `node_modules` : fais les liens de `node_modules/@cashless/*` (voir
la mémoire du poste).

## Subtasks

### T037 — Ouverture de session (terminal + personne) et garde `TerminalOrPersonGuard`

But : `POST /cash-sessions` (`openCashSession`, `201`) et la garde à deux chemins que T039 et T040
utilisent.

1. `cash-sessions.dto.ts` : `parseOpen(body)` — corps objet, seul champ admis `cash_account_id`
   (UUID, facultatif) ; tout autre champ, y compris `device_id`, `422 VALIDATION_FAILED` (reprendre
   `isUuid`, `invalid` de `organization/platform/platform.dto`). `CashSessionDto` et `toDto(row,
   view)` où `view` est `'AGENT'` ou `'MANAGER'` (voir T040) : champs `cash_session_id`,
   `cash_account_id`, `device_id`, `status` (`OPEN`|`CLOSED`), `opened_by`, `opened_at`,
   `last_count`, `closed_at`, `closed_by`, `counted_amount`, `expected_amount`,
   `cash_close_transaction_id`, `difference`, `cash_diff_anomaly_id`.
2. `terminal-or-person.guard.ts` : copie la structure de `DeviceOrCallerGuard` (mêmes dépendances
   injectées, mêmes `Reflector` internes). `canActivate` : (a) marqueur de terminal
   (`hasDeviceMarker`, exporté) → l'en-tête `X-Staff-Authorization` doit être présent (sinon `401`),
   `DeviceGuard.canActivate` (trois preuves, sans repli), puis `AuthenticationGuard` construit avec
   un lecteur de métadonnées qui répond « route de guichet » (`STAFF_TOKEN_ROUTE` vrai, `IS_PUBLIC`
   absent) pour lire la personne dans l'en-tête de guichet ; (b) sinon : `X-Staff-Authorization`
   présent → `401`, puis `AuthenticationGuard` avec un lecteur qui ignore `@Public()` et
   `STAFF_TOKEN_ROUTE`. Décorateur `TerminalOrPersonAuth()` = `Public()`, `StaffToken()` (sans eux
   la garde globale refuse l'en-tête de guichet avant la tienne), `SetMetadata(DEVICE_AUTH_OPTIONS,
   {})`, `UseGuards(TerminalOrPersonGuard)`. Lis l'ordre des vérifications dans
   `authentication.guard.ts` avant de coder et décris-le en commentaire.
3. `cash-sessions.service.ts`, `open(client, actor, input)` : `assertDeviceMode` ;
   `open_cash_session` avec le terminal et la personne **de l'acteur** (jamais du corps) ;
   `cash_account_id` fourni → comparé au compte de la caisse du terminal (`code = 'A-CAISSE-' ||
   serial`), sinon `422` ; refus de la base (grand livre hors `LIVE`/`CLOSING`, session déjà ouverte
   pour la caisse ou le terminal) → `409 CONFLICT_STATE` ; aucune écriture comptable (vérifié par
   test). Audit `CASH_SESSION_OPENED` (auteur, terminal, compte).
4. `cash-sessions.controller.ts`, `POST /cash-sessions` : `@HttpCode(201)`, `@CounterAuth()`,
   `@Idempotent({ scope: deviceScope, deviceSeq: true })` (clé `<série>:<seq>`, `422` sinon) ; dans
   `tx.run`, `counter.authorize(client, req)` puis `service.open`. Réponse = DTO vue `AGENT`.
5. `cash-sessions.module.ts` : importe `LifecycleModule` (pour `CounterAccess`),
   `ConfigResolverModule`, `TenantModule` ; `ApprovalModule` est global. Enregistre les contrôleurs
   et services ; ligne unique dans `app.module.ts`.

Cas limites : première ouverture (le compte `A-CAISSE-<série>` n'existe pas : créé par la base) ;
deuxième ouverture après fermeture (nouvelle session, même compte) ; terminal sans événement
(`CounterAccess` refuse, `409`) ; deux ouvertures simultanées de clés différentes (une seule gagne,
l'autre `409`).

Validation :
- [ ] `openCashSession` sans jeton de personne `401`, sans preuve de terminal `401`, avec les deux
  `201`.
- [ ] `journal_transaction` et `posting` inchangés après l'ouverture.

### T038 — Comptage et lecture à l'aveugle

But : `POST /cash-sessions/{cash_session_id}/counts` (`countCashSession`, `200`).

1. `parseCount(body)` : `counted_amount` entier `Number.isSafeInteger` ≥ 0 (`422` sinon, y compris
   `-0`, décimal, chaîne), `counted_at` horodatage ISO valide (obligatoire par le contrat), `note` ≤
   500 caractères, champs inconnus refusés. Convertis en `bigint` à la frontière.
2. `service.count(client, actor, sessionId, input)` : session lue sous RLS ; session absente, d'un
   autre événement ou **d'un autre terminal que celui de l'acteur** → `404 NOT_FOUND` (neutre) ; non
   `OPEN` → `409 CONFLICT_STATE` ; `count_cash_session(...)` ; au plus 10 comptages (le 11e : refus
   de la base → `409`). Tout `CASHIER` ou `SUPERVISOR` de l'événement du terminal peut compter la
   session de ce terminal.
3. L'heure du comptage est celle de la base (le contrat exige `counted_at` du client : valide-le, ne
   l'utilise que si la fonction a un paramètre prévu pour une heure déclarée ; sinon ignore-le et
   **signale** cet écart d'interprétation). `last_count` de la réponse porte l'heure de la base.
4. Audit `CASH_SESSION_COUNTED` : session, numéro du comptage, montant compté, auteur (le compté
   n'est pas le théorique).
5. Contrôle à l'aveugle : le DTO `AGENT` n'a **pas** les clés `expected_amount` ni `difference`
   (absentes ou `null`, choisis une forme et garde-la partout, conforme à WP01). Les erreurs de la
   base ne transmettent jamais leur texte (`ProblemFilter`) : ajoute un test qui plante un théorique
   reconnaissable et cherche sa valeur dans toute réponse et tout problème de la suite.

Cas limites : comptage à 0 d'une caisse non vide (autorisé) ; deux comptages simultanés (numéros
distincts, pas de saut) ; comptage sur session `CLOSED` (`409`) ; montant très grand (borne
`bigint`) ; comptage par la personne qui fermera plus tard (autorisé, mais la fermera-t-elle ? non,
T039).

Validation :
- [ ] Réponse sans théorique ni écart, quelle que soit la personne.
- [ ] 11e comptage `409`, session inchangée.

### T039 — Fermeture (`CASH_CLOSE`, `CASH_DIFF`, `begin`/`finish_cash_close`, idempotence)

But : `POST /cash-sessions/{cash_session_id}/close` (`closeCashSession`, `200`), une transaction,
rejouable.

1. Contrôleur : `@TerminalOrPersonAuth()`, `@Idempotent({ scope: (req) => device ? deviceScope(req)
   : 'bo:', deviceSeq: 'when-device', keyUuid: 'without-device' })` (modèle
   `reversals.controller.ts`, qui lit `(req as DeviceRequest).device`). Pas de corps.
2. Autorisation, dans `tx.run` : chemin terminal → `counter.authorize` (terminal actif relu en base)
   et la session doit être celle de **ce** terminal (sinon `404`) ; chemin back-office → événement
   de la session lu sous RLS (introuvable ou autre prestataire : `404`) et `resolveChain(client,
   {type:'EVENT', id})`. Dans les deux cas : `hasRole(principal, ['SUPERVISOR'], chain)` sinon `403
   FORBIDDEN` ; pose le rôle exercé pour l'audit (`RolesRequest.exercisedRole`).
3. Contrôles d'API (dans cet ordre, avant tout appel d'écriture) : session `OPEN` sinon `409
   CONFLICT_STATE` (déjà `CLOSED` avec une autre clé : même code) ; au moins un comptage sinon `409`
   ; le fermeur n'a fait aucun comptage de la session (lecture de `cash_session_count`) sinon `403
   FORBIDDEN`.
4. Écritures : `begin_cash_close(session, fermeur)` rend le théorique verrouillé (ne le recalcule
   pas) ; compte de caisse et série lus depuis la session (`A-CAISSE-<série>` → `cashDesk` du
   constructeur) ; `engine.execute` `CASH_CLOSE`, source `ONLINE`, `createdBy` = fermeur, `deviceId`
   = terminal seulement sur le chemin terminal (la garde compare), `idempotencyKey: 'cash-close:' +
   sessionId`, `occurredAt` base, `payload {cashDesk, counted, expected}` ; rattachement par
   `attach_cash_tx` **si** `finish_cash_close` ne le fait pas déjà (lis la migration) ; anomalie
   `CASH_DIFF` si compté ≠ théorique : montant `|écart|`, grand livre, terminal de la session,
   transaction de fermeture — par la fonction de la base si 0036 en expose une, sinon par l'`INSERT`
   dans `anomaly` que `payments.service.ts` pratique déjà (vérifie le droit après WP05) ; **ne
   contourne pas** un refus de droit, signale-le. Le signe est lu sur la session (`difference =
   compté − théorique`, négatif = manque) : la table d'anomalie n'a pas de colonne de note.
5. `finish_cash_close(...)` : session `CLOSED`, `closed_by`, montants figés, `close_tx_id`,
   `cash_diff_anomaly_id`. Audit `CASH_SESSION_CLOSED` (auteur, terminal, théorique, compté, écart,
   transactions). Réponse = DTO vue `MANAGER` (le fermeur voit `expected_amount` et `difference`).
6. Atomicité (NFR-008) : toute erreur annule tout, la session reste `OPEN` (jamais `CLOSING` visible
   après validation). Concurrence : deux fermetures simultanées de clés différentes — la seconde
   attend le verrou puis reçoit `409` ; une recharge simultanée est sérialisée par le verrou du
   solde (preuve de WP14, T071).
7. Rejeu de la même clé : l'intercepteur rend la même réponse (`Idempotency-Replayed: true`), aucune
   seconde écriture ; clé réutilisée avec un autre contenu : `IDEMPOTENCY_KEY_REUSED`.

Cas limites : théorique 0 et compté > 0 (surplus seul) ; théorique > 0 et compté 0 (tout en manque)
; les deux nuls (T039 point « arbitrages », aucune écriture) ; payeur de l'écart `cash_diff_bearer`
`ORGANIZER` ou `OPERATOR` (les deux testés) ; grand livre `CLOSING` (fermeture autorisée) ; terminal
révoqué (chemin back-office).

Validation :
- [ ] Après fermeture, la caisse est à 0, `A-TRANSIT` augmenté du compté, `CASH_CLOSE` de clé
  `cash-close:<id>`.
- [ ] Le comptable ne peut pas fermer (`403`), session intacte ; un tiers peut.

### T040 — Liste et lecture des sessions (droits par rôle)

But : `GET /cash-sessions/{id}` (`getCashSession`) et `GET /events/{event_id}/cash-sessions`
(`listCashSessions`).

1. `cash-session-read.service.ts` : requêtes en lecture seule sous RLS sur `cash_session` (sélection
   accordée à `cashless_app` par WP05) avec le dernier comptage ; **aucune lecture** d'un solde de
   compte `CASH_DESK` ni de `posting` (A27). `expected_amount` est la valeur figée à la fermeture,
   pas un calcul.
2. Vues : `MANAGER` = `SUPERVISOR` ou `ORGANIZER_ADMIN` de l'événement (chaîne `resolveChain`) :
   toutes les sessions de l'événement, `expected_amount` et `difference` **seulement si `CLOSED`**
   (nuls sinon) ; `AGENT` = `CASHIER` : seulement ses sessions (`opened_by` = lui), jamais le
   théorique ni l'écart, même fermées. Une session hors vue : `404`, identique à une session
   inexistante. Un `OPERATOR_ADMIN` seul n'a aucune vue (`403`).
3. `getCashSession` : garde `TerminalOrPersonAuth()` ; chemin terminal → `counter.authorize` et la
   session doit être celle du terminal pour un `CASHIER` (un `SUPERVISOR` au terminal voit celles de
   son événement).
4. `listCashSessions` : `humanBearer` seul ; rôles `SUPERVISOR` et `ORGANIZER_ADMIN` seulement (un
   `CASHIER` `403`) ; filtre `status` (`OPEN`|`CLOSED`, autre valeur `422`), pagination par curseur
   et `limit` bornée (reprendre la convention de `listApprovalRequests` et son curseur), tri
   `opened_at` décroissant puis id ; réponse `{data, next_cursor, has_more}`. Événement d'un autre
   prestataire ou d'un autre organisateur administré : `404`/`403` selon la convention des routes
   d'événement existantes.
5. Audit de lecture non exigé ; FR-031 couvre ouverture, comptage, fermeture, dépôt.

Cas limites : curseur falsifié (`400`/`422`, jamais `500`) ; liste vide ; session ouverte par un
autre `CASHIER` du même événement (`404` pour le premier) ; `limit` hors bornes.

Validation :
- [ ] `CASHIER` : jamais d'`expected_amount`/`difference`, jamais la session d'un autre.
- [ ] `SUPERVISOR` : `expected_amount` après fermeture seulement.

### T041 — Action d'approbation `CASH_DEPOSIT`

But : enregistrer l'action à deux personnes du dépôt en banque et son exécution.

1. `cash-deposit-action.ts`, `@Injectable() class CashDepositActions` (modèle de
   `SaleReversalActions` : le constructeur appelle `registry.register(this.definition())`).
   Constante exportée `CASH_DEPOSIT_ROLES = ['ORGANIZER_ADMIN', 'OPERATOR_ADMIN'] as const` (test de
   bornage).
2. Définition : `action: 'CASH_DEPOSIT'` (valeur ajoutée à l'énumération par WP01 et par la
   migration de WP04), `requiredRole: CASH_DEPOSIT_ROLES`, `scopeOf: payload => ({type:'EVENT', id:
   payload.scope_id})`, `validate` : champs exacts `ledger_id` (UUID), `amount` (entier > 0 en
   `number` sûr, converti en `bigint` à l'exécution), `bank_reference` (chaîne non vide ≤ 100
   caractères, sans retour à la ligne), `scope_type`, `scope_id` — tout autre champ refusé `422`.
3. `request(client, operatorId, input, actor)` : lit en base l'événement du grand livre
   (`ledger.scope_type = 'EVENT'`, `scope_id`) — la portée n'est jamais celle d'un corps — puis
   `ApprovalService.request` avec `targetId = ledger_id` ; un grand livre introuvable ou d'un autre
   prestataire : `404`. Audit `CASH_DEPOSIT_REQUESTED`.
4. `execute` : relit le grand livre et la devise sous la transaction de l'approbation ;
   `engine.execute` `CASH_DEPOSIT`, source `BACKOFFICE`, `createdBy` = auteur, `approvedBy` =
   valideur (la base impose distincts), `idempotencyKey: 'cash-deposit:' + request.id` (un dépôt par
   demande), `occurredAt` base, `payload {amount}`, `metadata {approval_request_id,
   bank_reference}`. Refus connus (`SQL_FAILURES` : `CL007` « dépôt supérieur aux espèces en transit
   », `CL003`/`CL004`/`CL005` état du grand livre) → `ProblemException` avec message lisible : la
   demande passe `FAILED`, rien n'est écrit. Résultat `{transaction_id, amount}`.
5. Route : `requestCashDeposit`, chemin ci-dessus (arbitrages), contrôleur dans `cash-sessions/`,
   test d'intégration (`202`, rôles, `404` hors prestataire, rejeu de clé). Les routes générales
   `approveApprovalRequest` et `rejectApprovalRequest` existent déjà et suffisent pour la décision.
6. Enregistre `CashDepositActions` dans `CashSessionsModule`.

Cas limites : montant supérieur au transit (demande `FAILED`) ; deux dépôts approuvés en même temps
dont la somme dépasse le transit (un seul passe, l'autre `FAILED`, `CL007`) ; approbation par
l'auteur (refusée par le service d'approbation, vérifier le code) ; demande expirée ; dépôt sur
grand livre `LOCKED`.

Validation :
- [ ] Après approbation par une autre personne : `CASH_DEPOSIT` source `BACKOFFICE`, `A-BANQUE`
  +montant,
      `A-TRANSIT` −montant, auteur et valideur tracés.
- [ ] Au-delà du transit : demande `FAILED`, aucune transaction.

### T042 — Tests d'intégration des sessions et du dépôt

But : prouver chaque règle de `contracts/cash.md` 1 à 6, 9, 10. Vraie base `cashless_wp08`,
`supertest` et `createTestApp`, modèle `deposit.spec.ts`. Identifiants aléatoires (les suites
tournent sur une base partagée), aucune comparaison d'horloge Node/base ; recul de dates par SQL du
propriétaire si besoin.

1. `cash-session-fixtures.ts` : monde (prestataires A et B, événement `LIVE`, deux terminaux
   `TOPUP_DESK`, `CASHIER`, deux `SUPERVISOR`, `ORGANIZER_ADMIN`, `OPERATOR_ADMIN`) ; aides `open`,
   `count`, `close`, `seedCash(session, amount)` qui pose un théorique par une écriture réelle
   `TOPUP_CASH` du moteur sous la session (jamais par UPDATE de solde).
2. `open-count.spec.ts` : cas de T037 et T038 (sans jeton de personne `401`, sans terminal `401`,
   mode incorrect `422`, grand livre `DRAFT`/`LOCKED` `409`, double ouverture `409`, rejeu de la
   clé, clé mal formée `422`, `cash_account_id` d'une autre caisse `422`, personne sans rôle `403`,
   prestataire B `404`).
3. `blind-count.spec.ts` : théorique reconnaissable (par exemple 123 457), puis balayage de
   **toutes** les réponses et problèmes des routes accessibles à un `CASHIER` (ouverture, comptage,
   lecture, erreurs provoquées) : la valeur n'apparaît nulle part ; inventaire écrit en tête du
   fichier des routes qui lisent `account`/`account_balance` (grep de `src/`) avec la conclusion
   pour A27.
4. `close.spec.ts` : tous les cas de T039, y compris compté = théorique (aucune anomalie), manque et
   surplus avec les deux payeurs, deux nuls, comptage inexistant, fermeur = compteur (`403`, session
   `OPEN`), deux compteurs A et B puis fermeur C, `ORGANIZER_ADMIN` et `CASHIER` refusés, autre
   terminal `404`, terminal révoqué puis fermeture back-office, rejeu, nouvelle clé sur session
   fermée `409`, atomicité (échec injecté dans le moteur : session `OPEN`, aucun `CLOSING`, aucune
   transaction), et **après fermeture, une écriture d'espèces sur la caisse est refusée** par la
   garde (via le moteur).
5. `read.spec.ts` : T040 en entier, dont filtres, pagination, vues par rôle, `404` croisés.
6. `cash-deposit.spec.ts` : T041 en entier, via `CashDepositActions.request` puis
   `approveApprovalRequest`.
7. `close-concurrency.spec.ts` : deux fermetures simultanées (une gagne) ; fermeture pendant un
   comptage.
8. Matrice des preuves : `device-auth-cases/cash-sessions.cases.ts` (voir arbitrages) pour les
   routes de terminal de ce lot.

Validation :
- [ ] Chaque test de sécurité échoue si la règle est retirée (essai local : retire le contrôle «
  fermeur ≠
      compteur », retire le filtre de vue `AGENT`).

## Test Strategy

- Intégration : `cd apps/api && npx jest test/integration/cash-sessions --runInBand` sur
  `cashless_wp08` après `reset-db` ; puis `npx jest test/unit` ; la matrice des preuves
  (`test/integration/end-to-end/device-auth-matrix.spec.ts`) seulement si tu l'as adaptée, **en
  série**.
- pgTAP de la base : tu n'y touches pas ; ne lance pas la batterie complète (à l'orchestrateur).
- `cashless_test` est réservée à l'orchestrateur ; horloge Docker : aucune comparaison d'horloge
  Node/base.
- Lignes de 100 caractères ; `tsc`, lint, Prettier propres sur les fichiers touchés.

## Definition of Done

- [ ] T037 à T042 faits ; `tsc`, lint, Prettier propres ; aucune dépendance ajoutée ; aucun `.sql`
  modifié.
- [ ] Tests nouveaux verts ; tests existants verts sans changement d'attente.
- [ ] Aucun théorique rendu avant fermeture (preuve : balayage à canari) ; fermeur ≠ compteur prouvé
  ;
      fermeture atomique et rejouable prouvée.
- [ ] Matrice d'acceptation : FR-001, FR-002, FR-003, FR-029, FR-031 passés à `pass` avec commande
  et résultat.
- [ ] Compte rendu du lot : écarts au plan avec leur sens (heure de comptage, création de l'anomalie
      `CASH_DIFF`, rattachement par `attach_cash_tx`, garde à deux chemins) ; retouches hors carte
      justifiées (`app.module.ts`, `sqlstate-map.ts`, `audit.service.ts`, matrice des preuves et
      fichier de cas) ; route `requestCashDeposit` servie ; points soumis au
      porteur ; fichiers à faire relire par une personne : `terminal-or-person.guard.ts`
      (authentification), `cash-sessions.service.ts` (fermeture et argent), `cash-deposit-action.ts`
      ; critères couverts avec preuve ; inventaire A27.

## Risks

- Garde à deux chemins : un marqueur de terminal présent doit fermer le chemin de la personne seule
  (pas de repli) ; un chemin personne qui accepte `X-Staff-Authorization` serait un contournement de
  R-04.
- Fermeture : lire le théorique ailleurs que dans `begin_cash_close` (sans verrou) permet un écart
  faux ; oublier l'atomicité laisse une caisse `CLOSING`.
- Fuite du théorique par un message d'erreur, un en-tête, un journal ou une audit lisible par un
  `CASHIER`.
- `CounterAccess` retient `CASHIER` avant `SUPERVISOR` : un fermeur à deux rôles serait refusé à
  tort, ou accepté à tort si tu ne contrôles pas le rôle toi-même.
- Dépôt : portée lue d'un corps au lieu de la base ; `OPERATOR_ADMIN` d'un autre prestataire.
- Tests qui n'exercent pas la garde de caisse parce que la fixture pose le solde par UPDATE.

## Reviewer Guidance

Tente de casser : (1) fermer sa propre caisse (compter puis fermer, y compris avec un second compte
du même utilisateur ou deux rôles) ; (2) ouvrir ou compter avec un jeton de personne seul, ou depuis
un terminal d'un autre mode ; (3) lire le théorique avant la fermeture par une réponse, une erreur,
un `404`/`409` différencié, un en-tête, une liste ; (4) un `CASHIER` qui lit la session d'un autre ;
(5) une fermeture partielle (transaction sans session fermée, session fermée sans transaction,
caisse non ramenée à 0) ; (6) deux fermetures ou un rejeu qui écrivent deux `CASH_CLOSE` ; (7) une
fermeture dont le compte de caisse vient du client ; (8) un dépôt supérieur au transit, ou approuvé
par son auteur, ou sur la portée d'un autre événement ; (9) une écriture d'espèces acceptée sur une
caisse fermée ; (10) un test qui passe parce que `seedCash` écrit le solde sans passer par la garde,
ou parce que le canari n'est jamais cherché dans les erreurs ; (11) un `TerminalOrPersonGuard` qui
laisse passer une requête portant un certificat client mais sans jeton d'appareil valide.
