---
work_package_id: WP09
title: "Vendeurs : back-office et sessions"
dependencies:
- WP07
- WP08
requirement_refs:
- FR-001
- FR-002
- FR-003
- FR-004
- FR-005
- FR-006
- FR-026
- NFR-002
- NFR-003
- NFR-004
- NFR-007
- C-003
planning_base_branch: feat/terminaux-paiement-en-ligne
merge_target_branch: feat/terminaux-paiement-en-ligne
branch_strategy: Planning artifacts for this mission were generated on feat/terminaux-paiement-en-ligne. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/terminaux-paiement-en-ligne unless the human explicitly redirects the landing branch.
subtasks:
- T039
- T040
- T041
- T042
- T043
phase: "Phase 3 - Routes"
history:
- timestamp: '2026-10-22T14:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks-packages
agent_profile: node-norris
role: implementer
agent: claude
authoritative_surface: apps/api/
create_intent:
- apps/api/src/vendors/vendors.module.ts
- apps/api/src/vendors/vendors.controller.ts
- apps/api/src/vendors/vendors.service.ts
- apps/api/src/vendors/vendors.dto.ts
- apps/api/src/vendors/vendor-sessions.controller.ts
- apps/api/src/vendors/vendor-sessions.service.ts
- apps/api/src/vendors/vendor-session-guard.ts
- apps/api/test/integration/vendors/vendors.spec.ts
- apps/api/test/integration/vendors/vendor-sessions.spec.ts
- apps/api/test/unit/vendors/vendors.dto.spec.ts
- apps/api/test/integration/end-to-end/device-auth-cases/vendors.cases.ts
execution_mode: code_change
owned_files:
- apps/api/src/vendors/**
- apps/api/test/integration/vendors/**
- apps/api/test/unit/vendors/**
- apps/api/test/integration/end-to-end/device-auth-cases/vendors.cases.ts
tags: []
tracker_refs: []
---

# Work Package Prompt: WP09 – Vendeurs : back-office et sessions

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load node-norris` (Profile : node-norris / Role : implementer / Agent : claude).
Lis ensuite la fiche de contexte d'implémentation fournie par l'orchestrateur, ce prompt, puis, dans
`kitty-specs/terminaux-paiement-en-ligne-01M52QB9/` : `spec.md` (FR-001 à FR-006, FR-026, NFR-002 à NFR-004, NFR-007),
`data-model.md` (sections `vendor`, `vendor_public`, `vendor_pin_check`, `vendor_session`, codes CL032 et CL033),
`research.md` R-02, R-10 et R-11 (A6, A7, A15, A20, A22, A23), `contracts/vendors.md` (en entier),
`contracts/openapi-additions.md` (opérations des vendeurs), `plan.md` IC-02. Lis aussi la migration
`packages/ledger-sql/migrations/0031_vendors.sql` livrée par WP02 (signatures exactes) et le code livré par WP08
(`apps/api/src/vendor-pin/`, `DeviceContext` enrichi, idempotence de terminal, codes CL03x traduits, registre des cas).

Règle §0.3 : en cas de contradiction entre sources, applique la priorité (tests exécutables > schéma SQL,
`openapi.yaml`, `sync_protocol.md` > SPECIFICATION > PRD) et **signale-la** dans le compte rendu. Ne modifie jamais un
fichier `.sql` généré de `packages/ledger-sql/` ; ce lot ne touche à aucun fichier SQL.

## Objective

Servir les routes des vendeurs (back-office du `MERCHANT_ADMIN`), la liste des vendeurs pour le terminal, l'ouverture
de session « compter d'abord » et la fermeture de session, et fournir aux lots WP11 à WP13 le service de garde de
session (`assert_vendor_session`). Aucun PIN ni empreinte ne sort du serveur ; même réponse pour tout échec de PIN.

## Context

- Exigences : FR-001 à FR-006, FR-026 ; NFR-002 (aucun PIN en clair), NFR-003 (blocage au 5e échec, même sous
  essais simultanés), NFR-004 (pas d'énumération), NFR-007 (isolation) ; C-003 (trois preuves). Carte : IC-02.
- Décisions : PIN vérifié par le serveur (`DM-01M5HJXZ4QPS4NY8SABQKY95Q2`), règles du PIN
  (`DM-01M5HKT8GW5ZCAESAJC6WV5S6H`), secret hors base (R-10), limite consignée OP-N76 / ADR-121
  (`DM-01M5HRNFEFWDG47YEGE5N3C3GN`) : l'API lit l'empreinte et la base ouvre la session sur la foi de la transaction B.
  Cette limite est **acceptée et bornée** ; ce lot ne doit pas l'élargir (aucune autre lecture de `pin_hash`, aucune
  ouverture de session hors `open_vendor_session`).
- Fonctions de la base (WP02, 0031) : `create_vendor(merchant, name, pin_hash, actor)`, `set_vendor_pin(vendor,
  pin_hash, actor)`, `set_vendor_status(vendor, status, actor)`, `begin_vendor_pin_check(vendor, device)`,
  `open_vendor_session(check_id, device)`, `close_vendor_session(…)`, `assert_vendor_session(device,
  vendor_session_id)` ; lecture par la vue `vendor_public` seulement (A20). Droits : WP07 (`post-roles.sql`).
- Socle WP08 : hachage et vérification argon2id avec `VENDOR_PIN_SECRET`, empreinte factice tirée au démarrage
  (`apps/api/src/vendor-pin/`) ; `DeviceContext` enrichi (`appMode`, `personalPhone`, commerçant et participation du
  point de vente) ; idempotence d'une route de terminal (prestataire tiré du terminal, R-03) ; traduction CL032 →
  `409 VENDOR_SESSION_INVALID`, CL033 → `401 VENDOR_PIN_INVALID` ; masquage du champ `pin` dans les journaux ;
  registre des cas de la matrice des preuves. Utilise les noms exacts livrés par WP08 ; n'en réécris aucun.
- Ce qui en dépend : WP11 (paiement), WP12 (annulation), WP13 (QR) appellent la garde de session de ce lot.

**Règle de sécurité du projet (`CLAUDE.md`, C-009, C-010)** : si un point de ce lot ne peut être tenu qu'en
affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé, faux gardé plus longtemps
que prévu), **arrête-toi sur ce point et soumets-le au porteur avant de coder**, avec le risque et les options ;
continue le reste. Un renforcement se fait, puis se consigne dans le compte rendu du lot.

## Arbitrages de l'orchestrateur (22/10/2026)

Décisions prises à la génération des lots ; tous dans le sens le plus strict ou de pure répartition (aucun
affaiblissement, règle 1 de `CLAUDE.md`). Elles priment sur les « points à trancher » du texte ci-dessus et
ci-dessous. Reporter dans le compte rendu du lot les écarts au plan qui en découlent.

- Pas de `x-process` (voir WP01). Un essai de PIN à la fois par terminal : mécanisme **en base** (verrou consultatif ou ligne d'essai en cours), jamais en mémoire du processus.
- Renvoi de la même clé sur `openVendorSession` : `409` (clé UUID, voir WP01).
- `apps/api/src/audit/audit.service.ts` : retouche hors carte autorisée, limitée à l'ajout des actions du lot à `AuditAction`. Vaut pour WP10 à WP13.
- Propositions du texte retenues : liste vide sans point de vente, `204` sans session, essai non compté sans audit, noms d'actions d'audit proposés.

## Branch Strategy

Planification et fusion sur `feat/terminaux-paiement-en-ligne`. Dépendances : WP07 (droits), WP08 (socle). L'espace de
travail (worktree) est attribué par lane calculée dans `lanes.json`. Commande :
`spec-kitty agent action implement WP09 --agent claude --mission terminaux-paiement-en-ligne-01M52QB9`.

Retouches hors carte autorisées, chacune consignée en une ligne dans le compte rendu :
- `apps/api/src/app.module.ts` : **une ligne** d'import de `VendorsModule` ;
- `packages/contracts/openapi.yaml` : lignes `x-process: public` des huit opérations servies par ce lot (voir T043) ;
- `apps/api/src/audit/audit.service.ts` : ajout des actions d'audit du lot à l'union `AuditAction` (ce fichier n'est
  dans aucune carte ; ajout seul, aucune autre ligne).

## Subtasks

### T039 — Back-office des vendeurs

Routes (`vendors.controller.ts`) : `listVendors` `GET /merchants/{merchant_id}/vendors`, `createVendor` `POST
/merchants/{merchant_id}/vendors`, `getVendor` `GET /vendors/{vendor_id}`, `setVendorPin` `POST
/vendors/{vendor_id}/pin`, `setVendorStatus` `POST /vendors/{vendor_id}/status`.
- Accès : `TenantAccess.actor(req, ['OPERATOR_ADMIN', 'MERCHANT_ADMIN'])` (prestataire de la personne). Un
  `MERCHANT_ADMIN` n'agit que sur un commerçant de `scopesHeld(principal, 'MERCHANT_ADMIN', 'MERCHANT')` ; commerçant
  ou vendeur hors de ce périmètre, ou d'un autre prestataire : `404` neutre (même corps qu'un objet inexistant).
- Lecture : uniquement `vendor_public` (`id`, `merchant_id`, `display_name`, `status`, `locked`) ; jamais la table
  `vendor`. Réponse = schéma `Vendor` de WP01 (aucun champ PIN, empreinte ou compteur).
- `createVendor` : `display_name` non vide, 80 caractères au plus ; `pin` exactement `^[0-9]{6}$` sinon
  `422 VALIDATION_FAILED` **sans écho de la valeur** (ni dans `detail`, ni dans `violations`). Empreinte calculée par
  le service de WP08, puis `create_vendor(merchant, name, pin_hash, actor_user_id)`. `201` + `Vendor`.
- `setVendorPin` (`{pin}`) : même contrôle ; `set_vendor_pin` (compteur à 0, blocage levé, sessions fermées
  `PIN_CHANGED`, par la base). `setVendorStatus` (`{status: ACTIVE|DISABLED}`) : `set_vendor_status` (désactivation :
  sessions fermées `VENDOR_DISABLED`, par la base).
- Écritures `@Idempotent({ scope: 'bo:' })` + `IdempotentTx.run`. La réponse enregistrée ne contient ni PIN ni
  empreinte (vérifié par test).
- Audit (même transaction, `AuditService.record`) : `VENDOR_CREATED`, `VENDOR_PIN_CHANGED` (avec « débloqué » si
  `locked` était vrai), `VENDOR_DISABLED`, `VENDOR_REACTIVATED` — `after` sans PIN ni empreinte. Ces noms d'action ne
  sont pas arrêtés au plan : garde-les sauf contradiction avec WP01/WP02, et note-les au compte rendu.
- Fichiers : `vendors.controller.ts`, `vendors.service.ts`, `vendors.dto.ts`, `vendors.module.ts`.

### T040 — Liste des vendeurs pour le terminal (A22)

`listTerminalVendors` `GET /vendor-sessions/vendors`, `@DeviceAuth()` (trois preuves). Lit `vendor_public` : vendeurs
`status = 'ACTIVE'` et non bloqués du commerçant du point de vente du terminal (champ du `DeviceContext` enrichi par
WP08), et rend `vendor_id`, `display_name` **seulement**, triés par nom. Transaction du prestataire du terminal.
Terminal sans point de vente : liste vide (point à confirmer, voir Risks). Mode `TOPUP_DESK` : le contrat ne le
refuse pas explicitement ; suis le schéma de WP01 et signale si tu ajoutes un refus.

### T041 — Ouverture de session « compter d'abord » (A6)

`openVendorSession` `POST /vendor-sessions` `{vendor_id, pin}` : `@DeviceAuth()`, `@Idempotent` en mode terminal (WP08)
avec `transient: true`.
1. Contrôles avant toute écriture : mode `CATALOG_POS` ou `KEYPAD_TPE` (sinon `422 DEVICE_MODE_NOT_ALLOWED`) ;
   `pin` au format (sinon `401 VENDOR_PIN_INVALID`, pas `422`, pour ne rien distinguer ; signale ce choix) ;
   `vendor_id` UUID.
2. **Un essai à la fois par terminal** : un second essai simultané du même terminal reçoit `429` (code et en-tête
   `Retry-After` selon WP01). Le mécanisme n'est pas arrêté au plan : propose un verrou consultatif de session
   PostgreSQL non bloquant (`pg_try_advisory_lock` sur une clé dérivée du `device_id`, tenu sur une connexion dédiée
   pendant A → argon2 → B, relâché dans `finally`) ou, à défaut, un verrou en mémoire du processus ; consigne le
   choix. Le blocage par vendeur (NFR-003) ne dépend pas de ce verrou : il reste tenu par la base.
3. **Transaction A, validée** (`TenantTx.run` du prestataire du terminal) : `begin_vendor_pin_check(vendor, device)`.
   Vendeur valide → `check_id` + empreinte (essai déjà compté, blocage au 5e posé par la base) ; sinon rien (aucune
   écriture, aucun comptage d'un vendeur d'un autre commerçant). Lis le retour exact dans 0031.
4. **Hors transaction, aucun verrou de ligne tenu** : vérification argon2id par le service de WP08, sur l'empreinte
   réelle ou sur l'**empreinte factice** quand A n'a rien rendu (temps comparable, NFR-004).
5. **Transaction B** (`IdempotentTx.run`) seulement si le PIN est bon et qu'un `check_id` existe :
   `open_vendor_session(check_id, device)` (revérifie tout, ferme la session précédente `REPLACED`). Audit
   `VENDOR_SESSION_OPENED` dans B. `201` + `VendorSession` (`vendor_session_id`, `vendor_id`, `vendor_display_name`,
   `expires_at`).
6. Toute autre issue (PIN faux, vendeur inconnu, bloqué, désactivé, d'un autre commerçant, refus de B, 6e essai avec le
   bon PIN) : `401 VENDOR_PIN_INVALID`, **même corps** (aucun `detail` propre au cas). Si un essai a été compté, audit
   `VENDOR_PIN_FAILED` (et `VENDOR_LOCKED` si A a posé le blocage) dans une transaction C séparée et validée, avant de
   lever l'erreur. Un essai non compté (vendeur inconnu ou d'un autre commerçant) n'écrit aucune ligne d'audit sur un
   vendeur (point à confirmer, voir Risks).
- L'empreinte reste en mémoire le temps de la vérification seulement ; jamais journalisée (masquage WP08), jamais dans
  une exception. Un plantage entre A et B laisse l'essai compté (échec sûr, voulu).
- Note contrat : `contracts/vendors.md` dit « un renvoi refait l'essai » ; `openapi-additions.md` et `transient` disent
  qu'un renvoi de la même clé reçoit `409`. L'intercepteur existant enregistre les `4xx` et rend `409` après un succès
  `transient` : suis ce comportement (un renvoi n'est jamais recompté) et signale la contradiction.
- Fichiers : `vendor-sessions.controller.ts`, `vendor-sessions.service.ts`.

### T042 — Fermeture de session et service de garde de session

- `closeVendorSession` `DELETE /vendor-sessions/current` (`@DeviceAuth()`, idempotence de terminal WP08) :
  `close_vendor_session` sur la session ouverte du terminal, motif `LOGOUT` ; audit `VENDOR_SESSION_CLOSED`. Sans
  session ouverte : le plan ne dit rien ; propose `204` (rien à cacher, rien écrit) et consigne-le.
- `vendor-session-guard.ts` : `VendorSessionGuard` (fournisseur exporté par `VendorsModule`) avec
  `assert(client: TxClient, device: DeviceContext, vendorSessionId: string): Promise<string>` →
  `SELECT assert_vendor_session($1, $2)` → `vendor_id`. Contrat d'usage, écrit en tête du fichier : appelé **dans la
  transaction de l'écriture**, après la prise du terminal (`record_device_seq` ou `assert_device_active`) et avant
  toute lecture du bracelet, de la demande QR ou du portefeuille (ordre global terminal → vendeur → session → demande QR
  → bracelet → portefeuille). CL032 → `409 VENDOR_SESSION_INVALID` (traduction de WP08). `vendorSessionId` non UUID :
  `422 VALIDATION_FAILED` avant toute requête.
- Fermetures par la base (suspension, révocation, désactivation, blocage, nouveau PIN) : rien à coder ici ; elles sont
  prouvées par les tests de T043.

### T043 — Tests des vendeurs et cas de la matrice

- `test/unit/vendors/vendors.dto.spec.ts` : formats du PIN (5, 7 chiffres, lettres, espaces, nombre JSON) refusés sans
  écho ; `display_name` vide ou > 80 ; aucune clé `pin`, `pin_hash`, `failed_attempts`, `locked_at` dans la forme de
  réponse.
- `test/integration/vendors/vendors.spec.ts` (HTTPS, vraie base) : création, liste, fiche, changement de PIN,
  désactivation et réactivation par `MERCHANT_ADMIN` et `OPERATOR_ADMIN` ; `404` pour le `MERCHANT_ADMIN` d'un autre
  commerçant et pour un autre prestataire (NFR-007) ; `403` pour un rôle non admis ; lignes d'audit présentes, sans PIN
  ni préfixe `$argon2id$` ; corps enregistré dans `api_idempotency` sans PIN.
- `test/integration/vendors/vendor-sessions.spec.ts` (terminal de test WP08) : ouverture réussie ; PIN faux, vendeur
  inconnu, vendeur d'un autre commerçant, vendeur désactivé : statut et corps identiques (comparaison du corps hors
  `instance`/identifiant de requête, NFR-004) ; 5 échecs → bloqué, 6e essai avec le bon PIN → `401`, aussi depuis un
  second terminal (NFR-003) ; 20 essais simultanés de PIN faux (même terminal : `429` pour les essais concurrents ;
  plusieurs terminaux si le jeu d'essai le permet) → au plus 5 comptés, aucune session ; nouveau PIN → débloqué ;
  désactivation, suspension du terminal (route de la 5a) et révocation → garde `409 VENDOR_SESSION_INVALID` ; ouverture
  d'une seconde session → première `REPLACED` ; expiration (12 h) simulée par une écriture d'amorçage du propriétaire
  sur `expires_at`, signalée comme telle ; mode `TOPUP_DESK` → `422` ; liste des vendeurs du terminal limitée aux
  vendeurs actifs de son commerçant ; renvoi de la même clé d'ouverture → `409`, sans nouveau comptage.
- Garde : test direct de `VendorSessionGuard.assert` (identifiant d'une autre session, session d'un autre terminal,
  session close).
- `device-auth-cases/vendors.cases.ts` (forme imposée par le registre de WP08) : `GET /vendor-sessions/vendors`
  (`ok: 200`), `POST /vendor-sessions` (vendeur et **bon** PIN du jeu d'essai, `ok: 201` — un `401` métier se
  confondrait avec un refus de preuve), `DELETE /vendor-sessions/current` (`ok` selon T042). Le test « routes de
  terminal du contrat non servies : 404 » doit rester vert.
- `x-process: public` sur les huit opérations du lot. **Attention** : `media-isolation.spec.ts` lit toutes les
  opérations marquées `x-process` et exige exactement 39 opérations, chacune avec un cas. Avant de poser la marque,
  vérifie ce test ; s'il casse, ne le modifie pas (hors carte) : arrête ce point et demande à l'orchestrateur.

## Test Strategy

Ordre : `npm run lint`, `npm run typecheck`, `npm run reset-db -w @cashless/ledger-sql`,
`npm run test:pgtap -w @cashless/ledger-sql`, puis `npm run reset-db -w @cashless/ledger-sql && npm test -w
@cashless/api -- --runInBand`. Jamais pgTAP sur une base où Jest vient de tourner (rejouer `reset-db`). La base
partagée appartient à l'orchestrateur : tests en série seulement ; demande-lui un créneau ou lance seulement tes
fichiers (`npx jest test/integration/vendors test/unit/vendors`) quand il te le permet. Dans un worktree de lane, crée
d'abord les liens `node_modules/@cashless/{api,contracts,ledger-sql,tag-format}`. Horloge de la base Docker qui peut
reculer : aucun test ne compare l'heure de Node à `now()` de la base sans marge (expiration : relire `expires_at` en
base).

## Definition of Done

- Les huit opérations servies, conformes au contrat (schémas validés par les tests de contrat existants).
- `npm run lint`, `npm run typecheck`, suites pgTAP et Jest vertes en série ; matrice des preuves verte, y compris
  « routes non servies : 404 ».
- Chaque sous-tâche marquée : `spec-kitty agent tasks mark-status T039 --status done --mission
  terminaux-paiement-en-ligne-01M52QB9` (idem T040 à T043).
- Compte rendu ajouté en fin de ce fichier : écarts au plan (sens : renforcement ou non) ; retouches hors carte (une
  ligne chacune : `app.module.ts`, `x-process`, `audit.service.ts`) ; points soumis au porteur ; mécanisme du `429`
  retenu ; fichiers à faire relire par une personne (`vendor-sessions.service.ts`, `vendor-session-guard.ts` : PIN,
  comptage, limite OP-N76) ; **critères couverts avec leur preuve** (fichier de test et nom du cas) pour FR-001 à
  FR-006, FR-026 (part vendeurs), NFR-002 (part réponses et audit), NFR-003, NFR-004, NFR-007 (part vendeurs).

## Risks

- Réponse qui distingue les cas (statut, corps, `detail`, temps grossièrement différent) : NFR-004 cassé.
- Verrou de ligne tenu pendant argon2 : interdit (A6) ; A est validée avant la vérification.
- Lecture de `pin_hash` ailleurs que par `begin_vendor_pin_check` : élargit OP-N76 (à soumettre au porteur).
- Points à trancher (à signaler, pas à inventer) : mécanisme du `429` ; terminal sans point de vente (liste vide) ;
  fermeture sans session (`204`) ; audit d'un essai non compté ; noms des actions d'audit ; `x-process` et
  `media-isolation.spec.ts` ; `audit.service.ts` hors carte.

## Reviewer Guidance

Le relecteur distinct vérifie, refus par refus :
- PIN faux, vendeur inconnu, bloqué, désactivé, d'un autre commerçant, 6e essai bon : même statut, même corps ;
  empreinte factice utilisée quand A ne rend rien.
- A validée avant argon2, aucune transaction ouverte pendant la vérification ; B seule ouvre la session.
- Aucun PIN, aucune empreinte dans une réponse, un journal, l'audit, `api_idempotency` ou un message d'erreur.
- Un seul chemin de lecture des vendeurs : `vendor_public` ; aucun `SELECT … FROM vendor`.
- Garde de session : appelée dans la transaction de l'écriture, après le terminal ; refus `409` ; aucune voie qui
  accepte un `vendor_id` envoyé par le terminal pour attribuer une vente (FR-006).
- Isolation : `404` neutre hors périmètre ; le terminal ne voit que les vendeurs actifs de son commerçant.

## Reports de relecture (orchestrateur, 23/10/2026)

- Relecture WP02 cycle 1, mineur 2 : deux ouvertures de session simultanées sur un même terminal pour deux vendeurs
  différents rendent `23505` (unicité) en base. L'API doit le traduire en réponse prévue par le contrat (429 / refus
  propre), jamais en 500, avec un test.

## Reports de l'orchestrateur (26/10/2026, relecture WP09 cycle 1 : rejet, cycle 2)
- Bloquant 1 (à corriger) : aucun test ne prouve le verrou « un essai de PIN à la fois par terminal » (mutations M3a,
  verrou relâché aussitôt pris, et M3b, verrou jamais relâché, laissent tout vert). Exiger un `429` pour deux essais
  concurrents du même terminal (concurrence réelle, pas de chance) ; prouver le verrou libre après un succès, un refus
  de PIN et une erreur (essai suivant accepté).
- ADR-126 (décision du porteur) : dans l'empreinte d'idempotence, tout PIN (ouverture de session, création de vendeur,
  changement de PIN) est remplacé par un dérivé argon2 déterministe (socle WP08, sel tiré de la clé et de la portée).
  Tests : empreinte ≠ HMAC du corps en clair ; même clé avec un autre PIN → `409`, jamais de rejeu. Retouche hors carte
  autorisée de `apps/api/src/idempotency/` si l'empreinte s'y calcule ; aucun autre comportement de l'idempotence ne
  change (rejouer la batterie).
- Mineurs du relecteur à traiter si simples : `429` enregistré puis rejoué sous la même clé ; clé d'idempotence non
  contrôlée comme UUID. Sinon, les décrire.


## Reports de l'orchestrateur (26/10/2026, relecture WP09 cycle 2 : rejet, cycle 3)

Relecture : `tasks/WP09-vendeurs-sessions/review-cycle-2.md`. Décisions du porteur du 26/10 (complément d'ADR-126) :
- **Constat 1, bloquant (à corriger)** : le test « empreinte ≠ HMAC du corps en clair » doit couvrir aussi la création
  de vendeur (`POST /v1/merchants/:id/vendors`, corps `{display_name, pin}`) ; retirer `pinFields` de cette route doit
  faire échouer un test. Ajouter un vrai témoin : l'empreinte stockée est **égale** au HMAC du corps dérivé
  (`hasher.idempotencyBody(...)`), sur les trois routes.
- **Constat 2 (option b retenue)** : à l'ouverture de session, prendre le verrou d'essai du terminal **avant** le
  calcul du dérivé argon2 (garde ou intercepteur dédié, ordonné avant `IdempotencyInterceptor`, qui tient le verrou
  jusqu'à la fin de la requête, succès, refus ou erreur). Un essai concurrent reçoit `429 RATE_LIMITED` sans aucun
  argon2 : le prouver par un test (espion sur le hacheur : zéro appel pour le second essai). Garder les preuves du
  cycle 2 (verrou libre après succès, refus, 500 et 422 ; un seul essai compté). Retouche hors carte de
  `apps/api/src/idempotency/` et `apps/api/src/db/session-lock.ts` autorisée si nécessaire ; aucun autre comportement de
  l'idempotence ne change (rejouer la batterie d'idempotence).
- **Constat 3 (option c retenue)** : nouveau secret `VENDOR_PIN_IDEMPOTENCY_SECRET` pour le dérivé, mêmes règles que
  `VENDOR_PIN_SECRET` dans `apps/api/src/config/config.ts` (32 octets au moins, hexadécimal ou base64, exigé en
  production, secret de test refusé, distinct de tous les autres secrets via `assertDistinctHmacKeys`). Tests dans
  `config.spec.ts` (démarrage refusé sans lui en production, refusé s'il égale un autre secret) et un test que le
  dérivé change avec ce secret et ne change pas avec `VENDOR_PIN_SECRET`. Mettre à jour les environnements de test
  (`apps/api/test/support/`, `.env.example` s'il existe). Retouche hors carte de `config.ts` autorisée.
- **Constat 5, mineur (simple)** : un test qui fixe « un `429` hors `nonFinal` est enregistré » (mutation M8).
- Reports toujours ouverts du cycle 1, sans changement : alignement de `contracts/vendors.md` ; ordre d'appel de
  `VendorSessionGuard` pour WP11 à WP13 ; propriétaire des fonctions de purge sous RLS forcée.
