---
work_package_id: WP10
title: Configurations PSP (API)
dependencies: [WP01, WP05, WP07]
requirement_refs: [FR-009, FR-010, FR-011, FR-023, FR-031]
planning_base_branch: feat/recharges-caisses-psp
merge_target_branch: feat/recharges-caisses-psp
branch_strategy: Planning artifacts for this mission were generated on feat/recharges-caisses-psp. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/recharges-caisses-psp unless the human explicitly redirects the landing branch.
subtasks: [T049, T050, T051, T052, T053]
phase: Phase 4 - PSP
history:
- timestamp: '2026-10-27T15:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent: claude
model: sonnet
agent_profile: implementer-ivan
role: implementer
authoritative_surface: apps/api/src/psp-configurations/
execution_mode: code_change
owned_files: [apps/api/src/psp-configurations/**, apps/api/src/configuration/sql-config-resolver.ts, apps/api/test/integration/psp-configurations/**, apps/api/src/ledger/ports/config-resolver.ts, apps/api/test/scenario/api-config-fixture.ts]
create_intent: [apps/api/src/psp-configurations/psp-configurations.module.ts, apps/api/src/psp-configurations/psp-configurations.controller.ts, apps/api/src/psp-configurations/psp-configurations.service.ts, apps/api/src/psp-configurations/psp-configurations.dto.ts, apps/api/src/psp-configurations/psp-configuration-action.ts, apps/api/src/psp-configurations/event-psp-selection.controller.ts, apps/api/src/psp-configurations/event-psp-selection.service.ts, apps/api/src/psp-configurations/event-psp-selection-action.ts, apps/api/src/psp-configurations/psp-fee-scope.ts, apps/api/test/integration/psp-configurations/psp-config-fixtures.ts, apps/api/test/integration/psp-configurations/configurations.spec.ts, apps/api/test/integration/psp-configurations/configuration-action.spec.ts, apps/api/test/integration/psp-configurations/event-selection.spec.ts, apps/api/test/integration/psp-configurations/selection-action.spec.ts, apps/api/test/integration/psp-configurations/psp-fees.spec.ts, apps/api/test/integration/psp-configurations/isolation.spec.ts]
tags: []
tracker_refs: []
---

# Work Package Prompt: WP10 – Configurations PSP (API)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche de contexte d'implémentation fournie par
l'orchestrateur, ce prompt, puis seulement, dans `kitty-specs/recharges-caisses-psp-01M5YEBA/` :
- `spec.md` : FR-009, FR-010, FR-011, FR-023, FR-031, Edge Cases, contradictions 1 à 5 ;
- `research.md` : R-07, R-08, R-13 et **R-20 en entier** (qui fait foi), section « Configurations,
  secrets, frais » ; `research-adversarial.md` (A9, A10, A15, A18, A23, A30, A34) ; `plan.md` IC-05
  ;
- `data-model.md` : `psp_configuration`, `event_psp_selection`, extension `fee_rule.scope_type` ;
- `contracts/psp.md` : sections « Configurations » (1 à 4) et « Choix par événement » (5 et 6) ;
  `contracts/openapi-additions.md` ; `contracts/database-rights.md` (fonctions accordées).

Code à lire : `apps/api/src/reversals/sale-reversal-action.ts` et `reversals.module.ts` (**modèle**
d'une action à deux personnes : portée figée lue en base, rôles bornés, `SQL_FAILURES`, méthode
`request`), `apps/api/src/approval/action-registry.ts` et `approval.service.ts` (`request`,
exécution sous point de sauvegarde, `FAILED`, `respondAccepted`),
`organization/tenant/tenant-access.ts` (`TenantAccess.actor`, `assertOrganizerScope`, `scopesHeld`),
`organization/tenant/tenant.controller.ts` (modèle de routes du back-office : `@Idempotent({ scope:
'bo:' })`, `IdempotentTransaction`), `organization/tenant/fee-rules.service.ts` (`registerScope`,
`FeeScopeInfo`), `configuration/sql-config-resolver.ts` (que ce lot modifie),
`ledger/ports/config-resolver.ts` (`ConfigQuery`), `ledger/builders/festival/topup.ts` (`buildTopup`
: lit `config.pspFees[channel]`), `audit/audit.service.ts`, `errors/sqlstate-map.ts` et
`errors/problem.ts`. Livrés en amont : `packages/ledger-sql/migrations/0037_psp_configurations.sql`
(WP03 : **signatures et codes d'erreur exacts** des fonctions que ce lot appelle), `post-roles.sql`
(WP05), `apps/api/src/psp/` (WP07) et `packages/contracts/openapi.yaml` (WP01 : forme exacte des
opérations). Si un nom de ce prompt diffère de `0037` ou de `openapi.yaml`, ces deux fichiers font
foi : applique-les et **signale** l'écart.

Priorité des sources (SPECIFICATION §0.3) : tests exécutables > schéma SQL, `openapi.yaml`,
`sync_protocol.md` > SPECIFICATION > `PRD.md` ; toute contradiction est **signalée** dans le compte
rendu, jamais tranchée en silence. Ne modifie jamais un `.sql` généré de `packages/ledger-sql/` ; ce
lot ne touche à aucun fichier SQL.

## Objective

Servir en API les configurations PSP (création, liste, lecture, activation / suspension /
réactivation à deux personnes) et le choix de configuration par événement (direct hors `LIVE`, à
deux pendant `LIVE`), sans que le secret ni sa référence ne fuient vers un rôle qui n'y a pas droit.
Remplacer la convention provisoire des frais PSP (ADR-82 §3) par la règle de frais rattachée à la
configuration de la recharge. La base est l'arbitre (titulaire, défaut unique, version, frais) ;
l'API n'en recopie aucune règle.

## Context

- Concern IC-05. Constats à tenir : **A9** (fonctions de lecture neutre, droits nommés), **A10**
  (`secret_ref` lié au titulaire, jamais lisible par `cashless_app` hors fonction), **A15** (statuts
  et version : `DRAFT → ACTIVE → SUSPENDED → ACTIVE`, modification = nouvelle version, approbation
  liée à la version), **A18** (activation refusée sans règle de frais explicite, même à 0 %),
  **A30** (approbation de la bonne version), **A34** (`compliance_ref` obligatoire dans la demande).
- Dépendent de ce lot : WP11 (résout la configuration d'une recharge ; son processeur de paiement
  porte `psp_configuration_id` dans les métadonnées de l'écriture, voir T052) et WP14 (parcours,
  isolation, secrets).
- Fonctions de la base (WP03, noms du contrat ; signatures exactes dans `0037`) :
  `create_psp_configuration`, `activate_psp_configuration` (appelée par l'exécution d'approbation
  seulement : vérifie une demande `PSP_CONFIGURATION` `APPROVED` non exécutée, de la bonne version,
  règle de frais présente, `compliance_ref`), `set_event_psp_selection`,
  `resolve_psp_configuration`, `psp_configuration_secret_ref`. **Signatures figées par WP03
  (arbitrage du 27/10/2026)** : pas de fonction `suspend_…` ; `activate_psp_configuration(p_config,
  p_request)` applique le `payload.status` de la demande (`ACTIVE` par défaut ou `SUSPENDED`), y
  compris la réactivation ; une nouvelle version se crée par `create_psp_configuration(…,
  p_supersedes uuid DEFAULT NULL)` et la demande porte `payload.version` (plus `compliance_ref` à
  la première activation). **Si `0037` n'expose aucune fonction pour lister les choix d'un
  événement, arrête-toi sur ce point et signale-le à l'orchestrateur (lacune de WP03/WP05) : ce
  lot n'écrit aucun SQL et n'ouvre aucun `UPDATE`/`INSERT` direct pour `cashless_app`.**
- Rôles : création et activation par l'`OPERATOR_ADMIN` (le prestataire configure, §11.1) ; choix
  par l'`ORGANIZER_ADMIN` ; lecture par l'un et l'autre (`secret_ref` à l'`OPERATOR_ADMIN` seul).

**Règle de sécurité du projet (`CLAUDE.md`, règle 1)** : si un point de ce lot ne peut être tenu
qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé,
faux gardé), **arrête-toi sur ce point et soumets-le au porteur avant de coder**, avec le risque et
les options ; continue le reste. Un renforcement se fait, puis se consigne dans le compte rendu.
Aucun faux en production ; aucune nouvelle dépendance npm (R-18).

## Arbitrages de l'orchestrateur (27/10/2026)

Tous dans le sens le plus strict ou de pure répartition. Ils priment sur le reste du prompt.

- **`secret_ref` : jamais dans une réponse, un journal, une audit ou une erreur pour un autre rôle
  que l'`OPERATOR_ADMIN`.** Il n'est lu que par `psp_configuration_secret_ref(id)` (jamais par
  `SELECT *` ni par colonne : la base le refuse). Une valeur refusée à la création n'est **jamais
  recopiée** dans le message d'erreur (elle peut être un vrai secret collé par erreur). Le journal
  d'audit de la création ne porte pas `secret_ref`.
- **Forme de `secret_ref`** : `psp/<holder_party_id en minuscules>/<nom>`, `<nom>` de 1 à 64
  caractères `[A-Za-z0-9._-]`, le segment du titulaire égal à `holder_party_id` du corps. Toute
  autre forme est refusée `422 VALIDATION_FAILED` (la base le refuse aussi : `CHECK`) ; en plus, une
  valeur qui ressemble à un secret (≥ 24 caractères `[A-Za-z0-9+/=_-]` sans `/`, préfixes `sk_`,
  `pk_`, `whsec_`, `Bearer `, `-----BEGIN`) est refusée avec un message **générique**.
- **Activation et suspension : jamais en direct.** Aucune route ne passe une configuration à
  `ACTIVE` ou `SUSPENDED` sans demande `PSP_CONFIGURATION` approuvée par un autre `OPERATOR_ADMIN`.
  La demande est liée à la **version** lue en base au moment de la demande ; si la configuration a
  une version plus récente à l'exécution, la demande passe `FAILED` (A30).
- **`compliance_ref`** (agrément BCEAO ou compte XOF vérifié, §11.1) : obligatoire et non vide dans
  la charge utile d'une demande d'activation ou de réactivation ; absent → `422` à la demande.
- **Choix par événement pendant `LIVE`** : jamais écrit directement. La route répond `202` avec la
  demande `EVENT_PSP_SELECTION` ; l'état de l'événement est relu **dans la transaction** et la base
  refuse de toute façon un choix sans valideur sur un événement `LIVE`. Un événement qui passe
  `LIVE` entre la lecture et l'écriture donne `409 CONFLICT_STATE`, jamais une écriture directe.
- **Cloisonnement** : un objet d'un autre prestataire ou d'un organisateur non administré par
  l'appelant est `404` (identique à un objet inexistant), jamais `403` ni `200` vide trahissant
  l'existence.
- **Convention d'ADR-82 §3 retirée** : le résolveur de frais ne lit plus aucune règle `EVENT` +
  `PSP:<canal>`. Si cela casse un test existant (voir T052), arrête-toi et demande.
- Retouches hors carte, d'une ligne ou de quelques lignes chacune, consignées dans le compte rendu :
  `apps/api/src/app.module.ts` (import de `PspConfigurationsModule`, fichier de WP07) ;
  `apps/api/src/errors/sqlstate-map.ts` (un code s'il manque, fichier de WP07) ;
  `apps/api/src/ledger/ports/config-resolver.ts` (champ facultatif `pspConfigurationId` de
  `ConfigQuery` ; fichier désormais dans la carte du lot, ainsi que
  `apps/api/test/scenario/api-config-fixture.ts`) et
  `apps/api/src/ledger/ledger-engine.service.ts` (hors carte, appartient à WP06 ; appel du
  résolveur : passe
  `pspConfigurationId` lu dans `command.metadata?.psp_configuration_id` quand c'est une chaîne ; ≤ 5
  lignes au total, le fichier appartient à WP06). Au-delà : arrête-toi et demande.

- **Noms de WP07** (font foi, à utiliser tels quels) : jetons `PSP_ADAPTERS`
  (`PspAdapterRegistry`) et `PSP_SECRET_STORE`, `FakePspAdapter`, `FakePspSecretStore`, types
  `Secret`, `NormalizedPayment`, `NormalizedNotification`. Ce lot ne lit jamais un secret du
  coffre : il ne manipule que `secret_ref` (référence) ; une valeur de `secret_ref` ne passe pas par
  `Secret`.
- **`AuditAction` (règle commune de `tasks.md`)** : valeurs ajoutées par ce lot, en retouche hors
  carte d'une ligne chacune, en fin d'union de `apps/api/src/audit/audit.service.ts` :
  `PSP_CONFIGURATION_CREATED`, `PSP_CONFIGURATION_STATUS_CHANGED`, `EVENT_PSP_SELECTION_CHANGED`
  (nom à ajuster à ce que T-selection audite ; consigne-le). L'orchestrateur résout les conflits.
- **Matrice d'authentification des terminaux** : aucune route de ce lot n'est servie à un terminal
  (toutes en `humanBearer`) ; aucun fichier `*.cases.ts` n'est attribué ici. Si une route de
  terminal apparaît, arrête-toi et signale-le.
- **Codes SQL nouveaux** : `CL042` (`PSP_NOT_CONFIGURED`, 409), `CL043`, `CL044` (409) viennent
  de WP03/WP04 ; leur mappage dans `errors/sqlstate-map.ts` est fait par WP07 ou par le premier lot
  qui les rencontre (retouche d'une ligne).
## Branch Strategy

Planification et fusion sur `feat/recharges-caisses-psp`. Dépendances : WP01 (contrat), WP05
(droits), WP07 (ports, `sqlstate-map`, `app.module`). Worktree attribué par lane d'après
`lanes.json`. Commande : `spec-kitty agent action implement WP10 --agent claude --mission
recharges-caisses-psp-01M5YEBA`.

## Subtasks

### T049 — Routes de configuration (création, liste, lecture, `secret_ref` réservé)

But : trois routes du back-office, cloisonnées par prestataire, qui traduisent `psp_configuration`
sans jamais exposer plus que le rôle ne permet.

1. `psp-configurations.dto.ts` : `parseCreatePspConfiguration(body)` (champs : `method`
   `WAVE|ORANGE_MONEY|CARD`, `provider` `WAVE|ORANGE_MONEY|PAYDUNYA|STRIPE`, `holder_party_id`,
   `secret_ref`, `is_default?`, `valid_from?`, `valid_until?`, et tout champ que `openapi.yaml` de
   WP01 ajoute, par exemple la configuration remplacée pour une nouvelle version). Champ inconnu →
   `422`. Compatibilité moyen / fournisseur (`WAVE→WAVE`, `ORANGE_MONEY→ORANGE_MONEY`,
   `CARD→PAYDUNYA|STRIPE`) ; UUID valides ; `valid_until` > `valid_from` ; forme de `secret_ref`
   selon l'arbitrage. Constantes exportées (`PSP_METHODS`, `PSP_PROVIDERS`, `METHOD_PROVIDERS`) :
   WP11 et WP14 les importent.
2. `psp-configurations.controller.ts`, `@Controller()` avec les chemins du contrat :
   - `POST /organizers/:organizer_id/psp-configurations` (`createPspConfiguration`) : `@Idempotent({
     scope: 'bo:', keyUuid: true })`, `@HttpCode(201)`, acteur `TenantAccess.actor(req,
     ['OPERATOR_ADMIN'])`. Dans `tx.run` : l'organisateur est lu (RLS : autre prestataire ou
     inexistant → `404`), puis `create_psp_configuration(...)` (signature de `0037`). Reponse : la
     configuration `DRAFT` avec `secret_ref` (rôle `OPERATOR_ADMIN`). Audit
     `PSP_CONFIGURATION_CREATED` (auteur, rôle, objet, `after` **sans** `secret_ref`).
   - `GET /organizers/:organizer_id/psp-configurations` (`listPspConfigurations`) : acteur
     `['OPERATOR_ADMIN','ORGANIZER_ADMIN']` ; un `ORGANIZER_ADMIN` doit administrer cet organisateur
     (`assertOrganizerScope` ; sinon `404`, pas `403`). Filtres et pagination exactement ceux de
     `openapi.yaml` (WP01).
   - `GET /psp-configurations/:psp_configuration_id` (`getPspConfiguration`) : même acteur ;
     configuration d'un autre prestataire ou d'un organisateur non administré → `404`.
3. `psp-configurations.service.ts` : `toDto(row, role, secretRef?)` unique ; `secret_ref` n'est
   ajouté que si `role === 'OPERATOR_ADMIN'`, lu par `psp_configuration_secret_ref(id)` (une lecture
   par configuration de la page ; la page est bornée par le contrat). Pour les autres rôles la
   propriété est **absente** (pas `null`). Les `SELECT` énumèrent leurs colonnes (jamais `SELECT
   *`).
4. Traduction des refus de la base (codes de `0037`) : titulaire incohérent, défaut déjà pris,
   fournisseur incompatible → `409`/`422` avec le code de problème de WP01/WP07 ; ajoute au
   `sqlstate-map.ts` seulement le code manquant (retouche d'une ligne). Aucun `500` pour un refus
   connu.

Cas limites : deux créations simultanées avec `is_default = true` pour le même organisateur et le
même moyen (la base fait foi ; le second passe en `409`) ; rejeu de la même clé d'idempotence
(réponse rejouée, une seule ligne) ; `holder_party_id` qui n'est pas une partie du prestataire
(refus de la base) ; organisateur sans événement ; liste vide.

Validation :
- [ ] Un `ORGANIZER_ADMIN` ne reçoit jamais `secret_ref` (liste et lecture), même clé absente du
      JSON.
- [ ] Une valeur ressemblant à un secret est refusée `422` sans être recopiée dans la réponse, le
      journal ni l'audit (canari dans le test).
- [ ] Aucune route n'écrit `ACTIVE` ou `SUSPENDED`.

### T050 — Action `PSP_CONFIGURATION` (activation, suspension, réactivation, version)

But : `PspConfigurationActions` (`psp-configuration-action.ts`) sur le modèle de
`SaleReversalActions`.

1. Classe `@Injectable()`, constructeur : `ApprovalActionRegistry`, `ApprovalService`. Enregistre sa
   définition (`action: 'PSP_CONFIGURATION'`, `requiredRole: PSP_CONFIGURATION_ROLES` =
   `['OPERATOR_ADMIN']`, constante exportée et testée : aucun autre rôle). Portée : `scopeOf: (p) =>
   ({ type: 'OPERATOR', id: p.scope_id })`, `scope_id` = prestataire de la configuration, **lu en
   base à la demande**, jamais pris d'un corps.
2. Charge utile figée : `{ psp_configuration_id, version, status: 'ACTIVE' | 'SUSPENDED',
   compliance_ref?, scope_type: 'OPERATOR', scope_id }` (le contrat nomme `status` ; `version` et
   `compliance_ref` viennent de R-20 A30/A34). `validate` : champs inconnus refusés ;
   `compliance_ref` 1 à 200 caractères, obligatoire si `status = 'ACTIVE'`.
3. `request(client, operatorId, input, actor)` : lit la configuration (statut, version, prestataire)
   ; refuse les transitions illégales avec `409 CONFLICT_STATE` : seules `DRAFT → ACTIVE`, `ACTIVE →
   SUSPENDED`, `SUSPENDED → ACTIVE` ; fige la version lue ; appelle `ApprovalService.request(client,
   operatorId, { action: 'PSP_CONFIGURATION', targetId: id, payload }, actor)`. À appeler dans
   l'`IdempotentTx.run` de la route qui expose la demande.
4. `execute(client, { request, payload, requestedBy, approvedBy })` : appelle la fonction de `0037`
   (`activate_psp_configuration(p_config, p_request)`, qui applique `payload.status` : suspension et
   réactivation comprises) avec l'identifiant de la **demande**
   ; c'est la base qui vérifie demande `APPROVED` non exécutée, version, auteur ≠ valideur, règle de
   frais et `compliance_ref`. Retourne `{ result: { psp_configuration_id, status, version },
   executedTxId: undefined }`. Table `SQL_FAILURES` (code de `0037` → message lisible, la demande
   passe `FAILED`) : version dépassée, règle de frais absente (« aucune règle de frais
   PSP_CONFIGURATION »), `compliance_ref` vide, défaut déjà pris, configuration plus `DRAFT`. Jamais
   de `500` pour un refus connu.
5. Route de demande : `requestPspConfigurationChange` (WP01 : `POST
   /psp-configurations/{psp_config_id}/approval-requests`, `OPERATOR_ADMIN`, `202`) ; sers-la sur le
   modèle de `reversals.controller.ts` (`@Idempotent({ scope: 'bo:', keyUuid: true })`,
   `respondAccepted`). Relis `openapi.yaml` : si elle n'y est pas, arrête-toi et signale-le.
   L'approbation et le rejet passent par les routes générales `approveApprovalRequest` /
   `rejectApprovalRequest`.
6. Audit (FR-031) : la demande et l'exécution sont auditées par `ApprovalService` ; ajoute l'audit
   `PSP_CONFIGURATION_STATUS_CHANGED` à l'exécution (avant / après, sans `secret_ref`).

Cas limites : approbation par l'auteur de la demande (refus de la base) ; deux demandes concurrentes
sur la même configuration (une seule s'exécute, l'autre `FAILED`) ; configuration modifiée (nouvelle
version) entre la demande et l'approbation ; activation de la nouvelle version : l'ancienne passe
`SUSPENDED` (fait par la base, à vérifier) ; défaut unique : activer une seconde configuration par
défaut du même moyen → refus de la base traduit.

Validation :
- [ ] Sans règle de frais, l'approbation échoue (demande `FAILED`, configuration restée `DRAFT`).
- [ ] Même auteur et valideur : refus ; configuration inchangée.
- [ ] Rôles de l'action bornés par une constante testée.

### T051 — Choix par événement et action `EVENT_PSP_SELECTION`

But : `GET /events/:event_id/psp-selections` (`getEventPspSelections`) et `PUT
/events/:event_id/psp-selections/:method` (`setEventPspSelection`).

1. `event-psp-selection.controller.ts` / `.service.ts`. Lecture : acteur
   `['ORGANIZER_ADMIN','OPERATOR_ADMIN']`, l'événement doit être de l'organisateur administré
   (`assertOrganizerScope` sur l'organisateur de l'événement lu en base ; sinon `404`). Réponse :
   une entrée par moyen choisi (`method`, `psp_configuration_id`, `provider`, `selected_at`) ; aucun
   `secret_ref`.
2. Écriture : acteur `['ORGANIZER_ADMIN']` sur l'événement ; `@Idempotent({ scope: 'bo:', keyUuid:
   true })` ; `method` du chemin validé (`WAVE|ORANGE_MONEY|CARD`) ; corps `{ psp_configuration_id
   }`. Dans `tx.run` : événement lu (`404` sinon) avec son statut ; si **non `LIVE`** :
   `set_event_psp_selection` en direct (`selected_by` = appelant, pas de valideur), `200` avec le
   choix ; si `LIVE` : demande `EVENT_PSP_SELECTION` par `ApprovalService.request`,
   `respondAccepted` (`202`), **aucune écriture** du choix. Le contrôle fait foi en base (même
   organisateur, `ACTIVE`, même moyen, titulaire = `ledger.funds_holder_id`) : refus traduit en `422
   VALIDATION_FAILED` avec un détail lisible.
3. `event-psp-selection-action.ts`, classe `EventPspSelectionActions` : `requiredRole`
   `['ORGANIZER_ADMIN']` (constante testée), portée `{ type: 'EVENT', id: payload.scope_id }`,
   charge utile `{ event_id, method, psp_configuration_id, scope_type: 'EVENT', scope_id }` (portée
   lue en base). `execute` : `set_event_psp_selection(event, method, config, selected_by =
   requestedBy, approved_by = approvedBy)` ; `SQL_FAILURES` : configuration devenue inactive,
   titulaire différent, événement passé hors `LIVE`/clos.
4. L'historique du choix est dans l'audit (une entrée par changement : ancien, nouveau, auteur,
   valideur) ; une recharge garde sa configuration (aucune mise à jour des recharges `PENDING`).

Cas limites : choix identique à l'actuel (idempotent, `200`) ; configuration d'un autre organisateur
(`422`, rien d'écrit) ; configuration `SUSPENDED` ; événement clos ; demande approuvée alors que la
configuration a été suspendue entre-temps (`FAILED`).

Validation :
- [ ] Événement `LIVE` : `202`, la table `event_psp_selection` inchangée avant l'approbation.
- [ ] Un `ORGANIZER_ADMIN` d'un autre organisateur reçoit `404` sur les deux routes.
- [ ] Le titulaire différent du détenteur des fonds est refusé par la base, pas seulement par l'API.

### T052 — Résolveur de frais par configuration (convention d'ADR-82 §3 retirée)

But : `SqlConfigResolver.resolve` rend `pspFees` d'après la règle de la configuration de la
recharge.

1. `ledger/ports/config-resolver.ts` : `ConfigQuery.pspConfigurationId?: string`. Le moteur le
   remplit depuis `command.metadata?.psp_configuration_id` (retouche bornée de l'arbitrage). Le
   processeur de paiement de WP11 pose cette métadonnée sur chaque `TOPUP` ; le contrat est :
   **chaîne UUID de la configuration figée par la recharge**, pas celle que l'événement a choisie
   ensuite.
2. `sql-config-resolver.ts` : retire la boucle `PSP_PREFIX` et la constante ; si
   `query.pspConfigurationId` est présent, lit la règle `scope_type = 'PSP_CONFIGURATION'`,
   `scope_id = <configuration>`, `basis = 'TOPUP_AMOUNT'`, en vigueur à `occurredAt` (`valid_from ≤
   t < valid_to`), version la plus haute ; elle ne vaut que si la configuration est **de
   l'organisateur de l'événement du grand livre** (jointure sur `psp_configuration`, RLS du
   prestataire) : une configuration étrangère ne donne aucune règle (frais nuls) et n'est pas une
   erreur du résolveur. La règle est rangée sous le canal du moyen de la configuration : `WAVE →
   'WAVE'`, `ORANGE_MONEY → 'OM'`, `CARD → 'CARTE'` (clés lues par `buildTopup`), jamais d'après
   `beneficiary_purpose`. Sans règle : `pspFees = {}` (frais nuls, R-13) ; l'activation a déjà exigé
   la règle (A18).
3. Requêtes l'une après l'autre sur le client de la transaction (le résolveur le dit déjà : pas de
   `Promise.all` sur un même client `pg`).
4. `psp-fee-scope.ts` : déclare la portée `PSP_CONFIGURATION` au `FeeRulesService.registerScope`
   (rôle `OPERATOR_ADMIN`, `organizerId` et pays lus sur la configuration, sans `eventId`), pour que
   `createFeeRule` / `replaceFeeRule` acceptent cette portée. `PspConfigurationsModule` importe
   `TenantModule`. Si `FeeRuleScopeType` de `openapi.yaml` n'accepte pas encore `PSP_CONFIGURATION`,
   c'est un **manque de contrat de WP01** : signale-le (sans règle de frais par l'API, aucune
   activation de bout en bout).
5. **Régression à traiter avant de retirer la convention** :
   `apps/api/test/scenario/api-config-fixture.ts` crée aujourd'hui `PSP:<canal>` en règles `EVENT`
   pour le rejeu du scénario de référence (`api-config-replay.spec.ts`). Lance ce rejeu d'abord.
   S'il casse, l'adaptation minimale (fixture : créer une configuration et une règle
   `PSP_CONFIGURATION` par canal ; commandes `TOPUP` : métadonnée `psp_configuration_id`) est une
   retouche hors carte **à demander à l'orchestrateur si elle dépasse 20 lignes ou change une valeur
   attendue** (NFR-010 : le scénario reste vert, ses valeurs ne bougent pas).

Cas limites : règle fermée (`valid_to`) avant l'opération ; deux versions (la plus haute) ; recharge
dont la configuration a été suspendue ensuite (la règle reste lue : la recharge garde sa
configuration) ; `pspConfigurationId` absent (`pspFees = {}`) ; configuration d'un autre
organisateur.

Validation :
- [ ] Le `TOPUP` d'une recharge `WAVE` à 1,5 % donne la ligne de frais attendue, par la règle de sa
      configuration, même si l'événement a changé de configuration depuis.
- [ ] Une règle `EVENT` + `PSP:WAVE` n'a plus aucun effet (test qui échoue si elle est relue).
- [ ] `api-config-replay.spec.ts` et `sql-config-resolver.spec.ts` verts.

### T053 — Tests d'intégration des configurations

Voir « Test Strategy ». Fixtures : `psp-config-fixtures.ts` (prestataires A et B, un organisateur
par prestataire, deux `OPERATOR_ADMIN`, un `ORGANIZER_ADMIN`, un événement, partie titulaire des
fonds, règle de frais `PSP_CONFIGURATION` par l'API). Modèle :
`test/integration/reversals/reversal-fixtures.ts` et `test/support/app.ts`. Écritures directes en
base : amorçage seulement (jeu d'essai commun).

## Test Strategy

Pgtap n'est pas touché par ce lot. Jest ciblé sur ta base propre : `npm run reset-db -w
@cashless/ledger-sql` (base `cashless_wp10`, variables d'environnement du worktree), puis `cd
apps/api && npx jest --runInBand psp-configurations configuration/sql-config-resolver
scenario/api-config-replay`, `npm run lint` et `npm run typecheck`. Suites à écrire (mutations à
tuer en tête) :
- `configurations.spec.ts` : création (`DRAFT`, `201`), liste, lecture ; `secret_ref` absent pour
  l'`ORGANIZER_ADMIN`, présent pour l'`OPERATOR_ADMIN` ; refus de la forme et du secret collé
  (canari absent partout) ; défaut unique ; rejeu. *Mutation* : `secret_ref` rendu à tous.
- `configuration-action.spec.ts` : activation à deux (règle de frais présente), auteur = valideur
  refusé, version dépassée, sans règle de frais, sans `compliance_ref`, suspension, réactivation,
  concurrence de deux demandes. *Mutation* : activation sans demande approuvée.
- `event-selection.spec.ts` et `selection-action.spec.ts` : direct hors `LIVE`, `202` en `LIVE`,
  titulaire différent, autre organisateur, `SUSPENDED`, approbation puis exécution.
- `psp-fees.spec.ts` : T052. `isolation.spec.ts` : prestataire B et organisateur B sur chaque route
  et chaque nouvelle table de ce lot, `404` sans fuite, rien ne change (avant / après).
  `cashless_test` est réservée à l'orchestrateur, qui rejoue en série. Aucune comparaison entre
  l'horloge de Node et celle de la base (Docker, qui peut reculer). Lignes de 100 caractères.

## Definition of Done

- [ ] Sous-tâches T049 à T053 faites ; `spec-kitty agent tasks mark-status Txxx --status done
      --mission recharges-caisses-psp-01M5YEBA` pour chacune.
- [ ] Lint, types, Jest ciblé verts ; aucune suite existante cassée (dont rejeu du scénario) ;
      aucune nouvelle dépendance.
- [ ] Aucun `secret_ref` hors du rôle `OPERATOR_ADMIN` (réponses, journaux, audit, erreurs).
- [ ] Compte rendu du lot, en fin de ce fichier : écarts au plan (avec leur sens), retouches hors
      carte justifiées, points soumis au porteur, manques de contrat ou de base (route de demande
      d'activation, `FeeRuleScopeType`, fonction de suspension), **fichiers à faire relire par une
      personne** (au moins `psp-configurations.service.ts` et `psp-configuration-action.ts` : secret
      et approbation), critères couverts (FR-009, FR-010, FR-011, FR-023, FR-031) avec **commande et
      résultat** pour la matrice d'acceptation.

## Risks

- `secret_ref` rendu à un rôle qui n'y a pas droit, ou recopié dans une erreur / un audit.
- Activation sans demande approuvée, ou approbation d'une version qui n'est plus la bonne.
- Titulaire des fonds non contrôlé par la base (contrôle seulement côté API).
- Frais appliqués d'après la configuration choisie après coup plutôt que celle de la recharge.
- Rejeu du scénario de référence cassé par le retrait de la convention `PSP:<canal>` (NFR-010).
- Retouche du moteur au-delà de la borne (fichier de WP06).

## Reviewer Guidance

Tenter de casser : un `ORGANIZER_ADMIN` qui lit `secret_ref` (liste, lecture, audit, erreur de
validation) ; une route qui passe une configuration à `ACTIVE` sans demande ; auteur et valideur
identiques ; approbation d'une version périmée ; deux configurations par défaut ; choix d'une
configuration d'un autre organisateur ou d'un autre titulaire ; choix direct pendant `LIVE` ; `404`
contre `403` sur un objet étranger ; fuite par la liste ou le compte ; règle de frais d'une
configuration étrangère lue par le résolveur ; règle `PSP:<canal>` encore lue ; test qui « prouve »
le cloisonnement avec un identifiant inexistant plutôt que celui d'un autre prestataire. Vérifier
que chaque mutation listée est réellement tuée et que les retouches hors carte sont consignées.
