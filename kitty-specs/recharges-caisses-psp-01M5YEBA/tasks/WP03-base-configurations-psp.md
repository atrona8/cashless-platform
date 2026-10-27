---
work_package_id: WP03
title: 'Base : configurations PSP (migration 0037)'
dependencies: []
requirement_refs: [FR-009, FR-010, FR-011, FR-023, C-004]
planning_base_branch: feat/recharges-caisses-psp
merge_target_branch: feat/recharges-caisses-psp
branch_strategy: Planning artifacts for this mission were generated on feat/recharges-caisses-psp. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/recharges-caisses-psp unless the human explicitly redirects the landing branch.
base_branch: kitty/mission-recharges-caisses-psp-01M5YEBA
base_commit: 47b13897c79c7eaca0bd79bf3bf40461795ad3b7
created_at: '2026-10-27T12:28:53.984262+00:00'
subtasks: [T011, T012, T013, T014, T015, T016]
phase: Phase 1 - Contrat et base de données
agent: claude
history:
- timestamp: '2026-10-27T15:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/ledger-sql/
create_intent: [packages/ledger-sql/migrations/0037_psp_configurations.sql, packages/ledger-sql/tests/tests_psp_configurations.sql]
execution_mode: code_change
model: sonnet
owned_files: [packages/ledger-sql/migrations/0037_psp_configurations.sql, packages/ledger-sql/tests/tests_psp_configurations.sql]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP03 – Base : configurations PSP (migration 0037)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche de contexte d'implémentation fournie par
l'orchestrateur, ce prompt, puis seulement : `spec.md` (FR-009 à FR-011, FR-023, C-004),
`data-model.md` (sections `psp_configuration`, `event_psp_selection`, extensions `fee_rule` et
`account`, correspondances), `research.md` R-07, R-08, R-13 et **R-20 (fait foi, bloc «
Configurations, secrets, frais »)**, `research-adversarial.md` (A9, A10, A15, A18, A30, A34),
`contracts/psp.md` (règles 1 à 6), `contracts/database-rights.md` (`secret_ref` non lisible). Code
de référence : `packages/ledger-sql/migrations/0031_vendors.sql` (style),
`0020_tag_key_job_approval.sql` (`enqueue_tag_key_job` : vérification d'une demande d'approbation
par la base), `0008_event_ledger.sql` (`open_event_ledger`, plan de comptes),
`0007_configuration.sql` (`fee_rule_guard`), `0033_payments.sql` (liste
`approval_request_action_check` à ne pas toucher ici), `0021_definer_search_path.sql` (règle du
`search_path`), `tests/tests_tag_key_job_approval.sql` et `tests/tests_approvals.sql` (fixtures de
demandes approuvées), `apps/api/src/configuration/sql-config-resolver.ts` (convention `PSP:<canal>`
qui disparaît, WP10). En cas de contradiction entre sources, applique la priorité de SPECIFICATION
§0.3 (tests exécutables > schéma SQL, `openapi.yaml`, `sync_protocol.md` > SPECIFICATION > PRD) et
**signale-la**. Ne modifie jamais un `.sql` généré de `packages/ledger-sql/`.

## Objective

Créer en base les configurations de prestataire de paiement (une référence de secrets, jamais un
secret), le choix par événement contrôlé par déclencheur, la résolution revérifiée à chaque
recharge, les fonctions neutres qui servent la réception des notifications, les comptes `A-PSP-*` de
chaque grand livre (nouveaux et existants) et la portée de frais `PSP_CONFIGURATION`. La base
garantit titulaire, organisateur, statut et unicité du défaut quelle que soit l'API (C-004).

## Context

- IC-04 du plan. Constats : A9 (fonctions neutres), A10 (`secret_ref` lié au titulaire), A15
  (revérification, suspension, versions), A18 (activation refusée sans règle de frais explicite),
  A30 (approbation liée à la version), A34 (`compliance_ref`).
- Ce qui dépend de ce lot : WP04 (`psp_topup` référence `psp_configuration`, appelle
  `resolve_psp_configuration`), WP05 (droits, `secret_ref` non lisible), WP07 (port du coffre : le
  segment titulaire du `secret_ref`), WP10 (routes et actions d'approbation), WP11 à WP13.
- Fonctions neutres (`psp_webhook_context`) : elles lisent sans prestataire de session, comme
  `check_device_enrollment_code` (0022). **Hypothèse sur le propriétaire** (écris-la dans l'en-tête)
  : elles supposent un propriétaire qui ignore la RLS (poste local, 0019, 0020) ; avec un
  propriétaire soumis à la RLS l'échec est fermé (aucune ligne). À faire relire par une personne.
- Droits : `REVOKE ALL ON FUNCTION … FROM PUBLIC` seulement ; accords et retraits de table : WP05.
- Les codes d'erreur : `CL001` (422), `CL023` (`APPROVAL_INVALID`, 409), `CL029` (`CONFLICT_STATE`,
  409), `P0002` (404) existent ; **`CL042` nouveau : `PSP_NOT_CONFIGURED` (409)**. Le mappage
  TypeScript appartient à WP07 : ne touche pas `sqlstate-map.ts`, signale `CL042` dans le compte
  rendu et dans l'en-tête.

**Règle de sécurité du projet (`CLAUDE.md`, règle 1)** : si un point de ce lot ne peut être tenu
qu'en affaiblissant la sécurité (droit plus large, contrôle retiré ou reporté, secret plus exposé,
faux gardé), **arrête-toi sur ce point et soumets-le au porteur avant de coder**, avec le risque et
les options ; continue le reste. Un renforcement se fait, puis se consigne. Aucun faux en production
; aucune nouvelle dépendance npm (R-18).

## Arbitrages de l'orchestrateur (27/10/2026)

Ces points de R-20 priment sur tout texte antérieur.

- **Noms imposés** (WP05 et WP10 les attendent) : `create_psp_configuration`,
  `activate_psp_configuration`, `set_event_psp_selection`, `resolve_psp_configuration`,
  `psp_configuration_secret_ref`, `psp_webhook_context`. `activate_psp_configuration(p_config,
  p_request)` applique le statut demandé par la charge utile de la demande `PSP_CONFIGURATION` :
  `ACTIVE` (activation d'un brouillon, réactivation d'une configuration suspendue) ou `SUSPENDED`
  (suspension). Le contrat parle d'une seule action ; ne crée pas de fonction `suspend_…` (WP05 ne
  l'accorderait pas).
- **Versions** : une modification est une NOUVELLE ligne (`supersedes_id`, `version = ancienne + 1`)
  ; à l'activation de la nouvelle, l'ancienne (si `ACTIVE`) passe `SUSPENDED` dans la même fonction,
  AVANT la nouvelle (l'index du défaut unique). La demande d'approbation porte la version
  (`payload.version`) ; une demande ne sert qu'une fois et ne rejoue pas une ancienne décision
  (colonnes `last_request_id`, `last_decided_at`).
- **Règle de frais explicite** (A18) : activation refusée sans règle de frais `PSP_CONFIGURATION` en
  vigueur pour cette configuration (une règle à 0 % suffit). Chaque version a sa propre
  configuration, donc sa règle.
- **`compliance_ref`** (A34) : obligatoire dans la charge utile de la demande à la première
  activation ; copiée dans la configuration par la fonction (jamais fournie par l'appelant
  autrement).
- **Choix de l'événement jamais contourné** : si l'événement a un choix pour le moyen et qu'il ne
  passe plus la vérification (suspendu, expiré, titulaire changé), `resolve_psp_configuration`
  refuse (`CL042`) ; elle ne retombe PAS sur le défaut de l'organisateur (renforcement : aucun
  argent n'est routé vers un autre PSP en silence).
- **Changement de choix** : permis seulement tant que l'événement est `DRAFT` ou `LIVE`
  (renforcement) ; en `LIVE`, une demande approuvée par une autre personne est exigée.
- **Décision du porteur du 27/10/2026 (point soumis, option b retenue)** : `open_event_ledger`
  reste **inchangée** (pas de `SECURITY DEFINER`, aucun compte `A-PSP-*` ajouté à sa liste). Une
  fonction dédiée étroite `open_psp_accounts(p_ledger uuid)`, `SECURITY DEFINER SET search_path =
  public, pg_temp`, contrôle explicite du prestataire (grand livre d'un autre prestataire :
  `P0002`), ne crée que les trois comptes `A-PSP-*` (titulaire = détenteur des fonds), idempotente
  (`ON CONFLICT DO NOTHING`), `REVOKE ALL … FROM PUBLIC`. Elle est appelée en interne par
  `set_event_psp_selection` (même transaction) ; WP04 l'appelle aussi depuis `create_psp_topup`
  (filet pour un grand livre sans choix). Aucun droit `EXECUTE` à `cashless_app` si l'API ne
  l'appelle pas (WP05 tranche selon la migration). Consigne dans le compte rendu.
- **Comptes `A-PSP-*`** : `A-PSP-WAVE`, `A-PSP-OM`, `A-PSP-CARTE` ; famille `ASSET`, but `PSP`,
  titulaire = détenteur des fonds, côté `D`, `allow_negative = true`, `hot = true` (ADR-77, contre
  §5.2 : contradiction signalée, ADR-77 appliqué).

## Branch Strategy

Planification et fusion sur `feat/recharges-caisses-psp`. Dépendances : aucune. Worktree attribué
par lane (`lanes.json`). Commande : `spec-kitty agent action implement WP03 --agent claude --mission
recharges-caisses-psp-01M5YEBA`.

## Subtasks

### T011 — Table `psp_configuration` (contraintes, `secret_ref` lié au titulaire, versions)

1. En-tête de la migration (modèle 0031) : contenu, fonctions avec leur rôle et leur caractère
   INTERNE, codes, hypothèse sur le propriétaire.
2. Table `psp_configuration` aux colonnes de `data-model.md` : `psp_configuration_id` PK,
   `operator_id`, `organizer_id`, `method`, `provider`, `holder_party_id`, `secret_ref`,
   `compliance_ref` (nullable), `status`, `is_default`, `valid_from`, `valid_until`, `version`,
   `created_by`, `approved_by`, plus les colonnes de ce lot : `supersedes_id uuid REFERENCES
   psp_configuration`, `activated_at timestamptz`, `last_request_id uuid`, `last_decided_at
   timestamptz`, `created_at timestamptz NOT NULL DEFAULT clock_timestamp()`. Les colonnes
   complémentaires sont à signaler comme complément du data-model.
3. Contraintes nommées : `method IN ('WAVE','ORANGE_MONEY','CARD')` ; `provider IN
   ('WAVE','ORANGE_MONEY','PAYDUNYA', 'STRIPE')` ; correspondance `(method, provider)` ∈ {(WAVE,
   WAVE), (ORANGE_MONEY, ORANGE_MONEY), (CARD, PAYDUNYA), (CARD, STRIPE)} ; `status IN
   ('DRAFT','ACTIVE','SUSPENDED')` ; **`secret_ref LIKE 'psp/' || holder_party_id::text || '/%'`**
   (A10) ET `secret_ref ~ '^psp/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,100}$'` (jamais un secret : seuls des
   caractères de nom) ; `valid_until IS NULL OR valid_until > valid_from` ; `approved_by IS NULL OR
   approved_by <> created_by` ; `status = 'DRAFT' OR (approved_by IS NOT NULL AND compliance_ref IS
   NOT NULL AND btrim( compliance_ref) <> '' AND length(compliance_ref) <= 200)` ; `version >= 1`.
4. Index uniques : `psp_configuration_default_active ON (organizer_id, method) WHERE is_default AND
   status = 'ACTIVE'` (FR-010) ; `psp_configuration_one_successor ON (supersedes_id) WHERE
   supersedes_id IS NOT NULL`.
5. Déclencheur `psp_configuration_immutable` (BEFORE UPDATE, `SECURITY DEFINER`, `search_path` fixé)
   : seules `status`, `is_default`, `approved_by`, `compliance_ref`, `activated_at`,
   `last_request_id`, `last_decided_at` peuvent changer ; tout autre changement (donc `secret_ref`,
   titulaire, organisateur, dates, version) → `CL001`. Déclencheur BEFORE DELETE : refus (`CL001`),
   une recharge peut s'y référer. Transitions de statut admises : `DRAFT → ACTIVE`, `ACTIVE →
   SUSPENDED`, `SUSPENDED → ACTIVE` ; `ACTIVE`/`SUSPENDED → DRAFT` et `SUSPENDED → SUSPENDED` :
   refusées.
6. RLS activée et forcée, politique `tenant_isolation` (boucle `DO` de 0031).

Validation :
- [ ] `secret_ref` d'un autre titulaire, avec un caractère hors liste ou trop long : refusé par la
      contrainte.
- [ ] Deux configurations par défaut `ACTIVE` pour le même `(organisateur, moyen)` : `23505`.
- [ ] `UPDATE psp_configuration SET secret_ref = …` (propriétaire) refusé ; `DELETE` refusé.

### T012 — Table `event_psp_selection` et déclencheur du titulaire

1. Table `event_psp_selection(event_id uuid REFERENCES event, method text, psp_configuration_id uuid
   NOT NULL REFERENCES psp_configuration, selected_by uuid NOT NULL, approved_by uuid, selected_at
   timestamptz NOT NULL DEFAULT clock_timestamp(), request_id uuid, operator_id uuid NOT NULL,
   PRIMARY KEY (event_id, method))`, `method IN ('WAVE','ORANGE_MONEY','CARD')`, `approved_by IS
   NULL OR approved_by <> selected_by`. RLS forcée.
2. Déclencheur `event_psp_selection_guard` (BEFORE INSERT OR UPDATE, `SECURITY DEFINER`,
   `search_path = public, pg_temp`) : la configuration est du même prestataire, de l'organisateur de
   l'événement, `ACTIVE`, de `method = NEW.method`, et `holder_party_id = ledger.funds_holder_id` du
   grand livre de l'événement (`scope_type = 'EVENT'`, `scope_id = event_id`) ; sinon `CL001` (API :
   `422 VALIDATION_FAILED`). Si l'événement est `LIVE` : `approved_by` obligatoire (`CL001` sinon).
   Un événement sans grand livre : `CL001`.
3. Pas d'historique en base : l'API l'écrit à l'audit ; une recharge garde SA configuration
   (`psp_topup`, WP04).
4. Cas limites : la configuration choisie est suspendue plus tard → la ligne reste (le déclencheur
   ne se rejoue pas), mais `resolve_psp_configuration` (T013) refuse ; une mise à jour du même
   `(event, method)` change la configuration (nouvelle version) en repassant par le déclencheur.

Validation :
- [ ] Configuration d'un autre organisateur, `DRAFT`, `SUSPENDED`, d'un autre moyen, d'un autre
      titulaire : chacune refusée par le déclencheur (écriture directe en propriétaire).
- [ ] Événement `LIVE` sans `approved_by` : refusé.

### T013 — `resolve_psp_configuration`, `psp_webhook_context`, `psp_configuration_secret_ref`

Toutes `SECURITY DEFINER SET search_path = public, pg_temp`. Sauf `psp_webhook_context`, elles
nomment le prestataire de la session (`app.operator_id`, absent : `P0002`).

1. `resolve_psp_configuration(p_event uuid, p_method text) RETURNS TABLE (psp_configuration_id uuid,
   provider text, holder_party_id uuid, from_selection boolean)` : événement du prestataire (`P0002`
   sinon) ; choix de l'événement pour le moyen, sinon défaut `ACTIVE` de l'organisateur pour ce
   moyen ; **dans les deux cas**, même vérification : statut `ACTIVE`, `valid_from <=
   clock_timestamp()` et `valid_until` nul ou postérieur, organisateur de l'événement, moyen,
   titulaire = `ledger.funds_holder_id`. Échec ou absence : `CL042`. Si un choix existe et échoue :
   `CL042`, sans repli sur le défaut (arbitrage). Ne rend PAS `secret_ref`.
2. `psp_webhook_context(p_config uuid) RETURNS TABLE (operator_id uuid, provider text, method text,
   status text, holder_party_id uuid, currently_valid boolean, secret_ref text)` : lecture neutre
   par identifiant, sans verrou ni écriture, zéro ligne si inconnue. Elle rend `secret_ref` (la
   route publique n'a pas de prestataire de session ; `currently_valid` = dans les dates). Seule
   autre porte de lecture de `secret_ref`, avec la suivante. Prévois `STABLE`.
3. `psp_configuration_secret_ref(p_config uuid) RETURNS text` : prestataire de session obligatoire ;
   rend `secret_ref` d'une configuration du prestataire au statut `ACTIVE` ou `SUSPENDED` (une
   configuration suspendue reste interrogeable pour ses recharges `PENDING`, A15) ; `DRAFT` ou autre
   prestataire : `P0002`. Le contrôle de rôle (`OPERATOR_ADMIN` pour l'affichage) est fait par l'API
   ; ici, la fonction ne sert qu'au port du coffre.
4. Cas limites : moyen inconnu (`CL001`) ; événement sans grand livre (`CL042`) ; plusieurs défauts
   impossibles (index) ; `from_selection` vrai quand le choix a servi.

Validation :
- [ ] Résolution : choix valide, défaut valide, choix suspendu (refus, pas de repli), défaut expiré
      (`valid_until` passé), titulaire différent du détenteur des fonds, configuration d'un autre
      organisateur, moyen sans rien : les sept cas sont couverts.
- [ ] `psp_webhook_context` : inconnue → zéro ligne ; suspendue → `status = 'SUSPENDED'` ;
      `secret_ref` rendu.

### T014 — Comptes `A-PSP-*` et portée de frais `PSP_CONFIGURATION`

1. Helper `psp_account_code(p_method text) RETURNS text` (IMMUTABLE, `search_path` fixé) : `WAVE` →
   `A-PSP-WAVE`, `ORANGE_MONEY` → `A-PSP-OM`, `CARD` → `A-PSP-CARTE`, autre → `CL001`. WP04 et les
   tests s'en servent.
2. `open_psp_accounts(p_ledger uuid) RETURNS void` (décision du porteur du 27/10/2026, voir
   « Arbitrages ») : `SECURITY DEFINER SET search_path = public, pg_temp` ; si le grand livre n'est
   pas du prestataire de la session (ou introuvable), `RAISE … USING ERRCODE = 'no_data_found'` ;
   insère les trois comptes `('A-PSP-WAVE','ASSET','PSP','H','D', true, true)`, `('A-PSP-OM', …)`,
   `('A-PSP-CARTE', …)` avec `ledger.funds_holder_id` pour titulaire, `ON CONFLICT (ledger_id, code)
   DO NOTHING`. Ne modifie rien d'autre. **Ne touche pas à `open_event_ledger`** (test : son corps
   et son mode de sécurité sont inchangés, aucune fonction applicative ne crée de compte `PSP`
   autrement que par `open_psp_accounts`). `REVOKE ALL … FROM PUBLIC`.
3. Grands livres existants : `INSERT INTO account … SELECT` pour chaque `ledger` `scope_type =
   'EVENT'`, avec `ledger.funds_holder_id` comme titulaire, `ON CONFLICT (ledger_id, code) DO
   NOTHING` (idempotent). Le propriétaire qui applique la migration n'est pas `cashless_app` :
   `account_purpose_guard` laisse passer.
4. Frais : remplace la contrainte `fee_rule_scope_type_check` (vérifie le nom réel dans
   `pg_constraint` de la base) par la même liste plus `'PSP_CONFIGURATION'` ; `CREATE OR REPLACE
   FUNCTION fee_rule_guard()` : corps de 0007 (relis-le) plus la branche `WHEN 'PSP_CONFIGURATION'
   THEN SELECT operator_id, true INTO obj_op, found_obj FROM psp_configuration WHERE
   psp_configuration_id = NEW.scope_id`, et pour cette portée `basis` doit être `TOPUP_AMOUNT`
   (sinon `CL001`) ; conserve `SECURITY DEFINER SET search_path = public, pg_temp`, le trigger
   existant n'est pas recréé.
5. Bloc `DO` de la migration : s'il existe une `fee_rule` dont `beneficiary_purpose LIKE 'PSP:%'`,
   la migration échoue avec un message qui l'explique (A18 : la convention d'ADR-82 §3 est retirée ;
   aucune règle de ce type ne doit survivre). Teste les deux issues (base sans règle : passe ; base
   avec une règle : échoue — dans un test pgTAP par `throws_ok` sur le bloc extrait en fonction
   temporaire, ou par une exécution manuelle consignée).

Validation :
- [ ] `open_event_ledger` inchangée (mêmes comptes qu'avant, corps et mode de sécurité intacts).
      `open_psp_accounts` : trois comptes `A-PSP-*` (but `PSP`, `hot`, négatif permis, titulaire =
      détenteur des fonds) ; grand livre d'un autre prestataire : `P0002` ; deux appels : un seul
      jeu de comptes, sans erreur ; ne crée aucun autre compte.
- [ ] Grands livres existants : les trois comptes présents après la migration, une seule fois (rejeu
      sans effet).
- [ ] Une règle `PSP_CONFIGURATION` s'insère pour une configuration du prestataire, refusée pour une
      inconnue, une autre base de prestataire ou un `basis` différent de `TOPUP_AMOUNT`.

### T015 — `create_psp_configuration`, `activate_psp_configuration`, `set_event_psp_selection`

Toutes `SECURITY DEFINER SET search_path = public, pg_temp`, prestataire de la session, heure =
`clock_timestamp()`. Helper INTERNE `psp_operator_admin(p_operator uuid, p_actor uuid) RETURNS
boolean` (personne `ACTIVE`, `OPERATOR_ADMIN` du prestataire, attribution non révoquée) et
`psp_organizer_admin(p_operator uuid, p_organizer uuid, p_actor uuid)` (même chose pour
`ORGANIZER_ADMIN`, `scope_type = 'ORGANIZER'`). Jamais accordés.

1. `create_psp_configuration(p_organizer uuid, p_method text, p_provider text, p_holder uuid,
   p_secret_ref text, p_is_default boolean, p_valid_from timestamptz, p_valid_until timestamptz,
   p_actor uuid, p_supersedes uuid DEFAULT NULL) RETURNS uuid` : auteur `OPERATOR_ADMIN` sinon
   `P0002` ; organisateur = `party` `ORGANIZER` du prestataire ; titulaire = partie du prestataire
   (`id = prestataire` ou `operator_id = prestataire`) ; statut `DRAFT`, `created_by = p_actor`.
   Avec `p_supersedes` : la précédente est du même prestataire, organisateur et moyen, n'a pas de
   successeur, et `version = précédente + 1` ; sinon `version = 1`. Toute violation de contrainte
   donne un `CL001` lisible, sans écho de `secret_ref`.
2. `activate_psp_configuration(p_config uuid, p_request uuid) RETURNS void` (modèle
   `enqueue_tag_key_job`) :
   a. configuration `FOR UPDATE` du prestataire ; demande `FOR UPDATE` du prestataire ; sinon
      `P0002` ;
   b. demande : `action = 'PSP_CONFIGURATION'`, `status = 'APPROVED'`, `target_id = p_config`,
      `payload ->> 'psp_configuration_id' = p_config`, `payload ->> 'version' = version`, `payload
      ->> 'status'` ∈ {`ACTIVE` (absent = `ACTIVE`), `SUSPENDED`}, `decided_by` non nul et différent
      de `requested_by`, tous deux `OPERATOR_ADMIN` actifs du prestataire, `decided_by` différent de
      `created_by` quand le statut visé est `ACTIVE`, `decided_at` strictement postérieure à
      `last_decided_at` et demande différente de `last_request_id` ; toute violation : `CL023` ;
   c. cible `ACTIVE` (depuis `DRAFT` ou `SUSPENDED`, sinon `CL029`) : `valid_until` pas passé ;
      règle de frais `PSP_CONFIGURATION` en vigueur, `basis = 'TOPUP_AMOUNT'` (sinon `CL029`,
      message « règle de frais explicite requise ») ; `payload ->> 'compliance_ref'` non vide (≤
      200) à la première activation (sinon `CL023`), conservée ensuite ; si `supersedes_id` et la
      précédente `ACTIVE` : elle passe `SUSPENDED` d'abord ; si `is_default` et une AUTRE
      configuration par défaut `ACTIVE` existe pour `(organisateur, moyen)` : `CL029` ; pose
      `status`, `approved_by = decided_by`, `compliance_ref`, `activated_at`, `last_request_id`,
      `last_decided_at` ;
   d. cible `SUSPENDED` (depuis `ACTIVE` seulement, sinon `CL029`) : pose `status`,
      `last_request_id`, `last_decided_at`.
3. `set_event_psp_selection(p_event uuid, p_method text, p_config uuid, p_actor uuid, p_request uuid
   DEFAULT NULL) RETURNS void` : événement du prestataire, `DRAFT` ou `LIVE` (sinon `CL029`) ;
   auteur `ORGANIZER_ADMIN` de l'organisateur de l'événement. Hors `LIVE` : `p_request` doit être
   NULL (sinon `CL001`), écriture directe (`approved_by` NULL). `LIVE` : `p_request` obligatoire —
   action `EVENT_PSP_SELECTION`, `APPROVED`, charge utile `{event_id, method, psp_configuration_id}`
   identique, `decided_by` ≠ `requested_by`, tous deux `ORGANIZER_ADMIN` de l'organisateur,
   `decided_at` postérieure à la dernière sélection de ce `(événement, moyen)` et demande jamais
   utilisée (`request_id`) : sinon `CL023` ; `selected_by = requested_by`, `approved_by =
   decided_by`. Insertion ou mise à jour (`ON CONFLICT (event_id, method) DO UPDATE`) ; le
   déclencheur contrôle configuration et titulaire.
4. Cas limites : activation par la personne qui a créé la configuration (refus `CL023`) ; demande
   liée à la version 1 rejouée pour la version 2 (refus) ; demande d'activation rejouée après une
   suspension (refus : date) ; configuration expirée ; deux activations concurrentes du même défaut
   (l'index tranche, l'une échoue).

Validation :
- [ ] Parcours `DRAFT → ACTIVE → SUSPENDED → ACTIVE` et nouvelle version qui suspend l'ancienne ;
      chaque refus listé.
- [ ] Activation sans règle de frais : refusée ; avec règle à 0 % : acceptée.
- [ ] Choix hors `LIVE` direct, en `LIVE` à deux personnes ; demande réutilisée, d'un autre moyen ou
      d'une autre configuration : refusée.

### T016 — Suite `tests_psp_configurations.sql`

Fichier pgTAP écrit à la main, modèle `tests/tests_vendors.sql` ; deux prestataires A et B (un
organisateur et un événement chacun, un grand livre par `open_event_ledger`), deux `OPERATOR_ADMIN`
et deux `ORGANIZER_ADMIN` pour A, demandes `APPROVED` insérées par le propriétaire (fixtures de
`tests_tag_key_job_approval.sql`). Sections :

1. Structure : tables, RLS forcée, contraintes de T011, index uniques, immuabilité, suppression
   refusée.
2. `secret_ref` : titulaire différent, caractères interdits, longueur ; valeur qui ressemble à un
   secret refusée.
3. Création, activation, suspension, réactivation, versions (T015) avec tous les refus et le rejeu
   de demandes.
4. Défaut unique : deux défauts actifs, défaut de la version précédente, concurrence simulée par
   séquence.
5. Choix par événement : déclencheur (cinq refus), `LIVE` à deux personnes, `DRAFT` direct,
   événement `CLOSING`.
6. Résolution : les sept cas de T013 ; `psp_webhook_context`, `psp_configuration_secret_ref` (autre
   prestataire, `DRAFT`, suspendue).
7. Comptes et frais : trois `A-PSP-*` par grand livre neuf, rejeu de la migration sur l'existant,
   `open_psp_accounts` (autre prestataire, double appel), portée `PSP_CONFIGURATION`, activation
   sans règle.
8. Cloisonnement : chaque fonction avec un objet du prestataire B sous la session de A : `P0002` ;
   sans session : `P0002` (sauf `psp_webhook_context`).
9. Prestataire sans règle `PSP:%` : documenté (T014 point 5).

Validation :
- [ ] Suite verte sur la base du lot ; elle échoue si on retire la contrainte du titulaire, la
      revérification de la résolution ou l'exigence de règle de frais (essai de neutralisation, puis
      restauration).

## Test Strategy

Base propre au lot : `PGDATABASE=cashless_wp03 npm run reset-db -w @cashless/ledger-sql` puis
`pg_prove -d cashless_wp03 packages/ledger-sql/tests/tests_psp_configurations.sql`. Lance aussi sur
cette base les suites de référence (`tests_grand_livre_cashless.sql`, `scenario_reference_test.sql`)
et les suites existantes de `tests/` : `tests_event_ledger.sql` et `tests_configuration.sql` (le
absence de changement d'`open_event_ledger` le confirme), `tests_definer_search_path.sql`,
`tests_definer_trigger_writers.sql`. Les tests Jest qui créent des événements passent par
`open_event_ledger` : note-les comme risque pour l'orchestrateur (il rejoue en série).
`cashless_test` est réservée à l'orchestrateur. Aucune comparaison avec l'horloge de Node ; dates
relatives à `clock_timestamp()`.

## Definition of Done

- [ ] Migration `0037_psp_configurations.sql` appliquée sur base propre et sur une base déjà peuplée
      de grands livres ; en-tête complet ; aucun `GRANT`/`REVOKE` de table.
- [ ] Toutes les fonctions `SECURITY DEFINER` fixent `search_path = public, pg_temp` ; `REVOKE ALL …
      FROM PUBLIC`.
- [ ] `tests_psp_configurations.sql` vert ; suites de référence et suites existantes vertes.
- [ ] Compte rendu du lot : signatures réelles (WP05, WP10 les lisent) ; colonnes ajoutées au
      data-model ; `open_psp_accounts` (décision du porteur, `open_event_ledger` inchangée) ;
      `CL042` à mapper
      (WP07) ; contradictions signalées (ADR-77 contre §5.2, `database-rights.md`) ; hypothèse sur
      le propriétaire ; retouches hors carte justifiées ; points soumis au porteur ; fichiers à
      faire relire par une personne (cette migration : titulaire, `secret_ref`, `open_psp_accounts`)
      ; critères couverts avec commande et résultat (FR-009 à FR-011, FR-023).

## Risks

- `open_psp_accounts` : une fonction DEFINER qui crée des comptes sans contrôle du prestataire ou
  qui en crée d'autres que les trois `A-PSP-*`.
- Grands livres existants : comptes ajoutés avec le mauvais titulaire ou en double.
- Titulaire contrôlé à l'écriture ET à la résolution : l'un sans l'autre laisse une porte.
- Rejeu d'une ancienne demande d'approbation ; version d'approbation non liée.
- `secret_ref` lisible par erreur dans une fonction qui rend la ligne entière.

## Reviewer Guidance

Essaie de casser : (1) activer une configuration sans seconde personne, avec la demande d'une autre
version, d'un autre prestataire, rejouée, ou par son propre créateur ; (2) router une recharge vers
un titulaire qui n'est pas le détenteur des fonds (choix, défaut, configuration modifiée après coup)
; (3) obtenir `secret_ref` par une fonction autre que les deux prévues, ou en changer par UPDATE ;
(4) créer un compte `PSP` sous `cashless_app` autrement que par `open_psp_accounts` ; (5) activer
sans règle de frais ou avec une règle d'une autre portée ; (6) un test qui ne prouve pas ce qu'il
dit (vérification faite par le propriétaire au lieu de la fonction, grand livre fabriqué à la main
sans `open_event_ledger`). Vérifie que la résolution ne retombe jamais sur le défaut quand un choix
existe.
