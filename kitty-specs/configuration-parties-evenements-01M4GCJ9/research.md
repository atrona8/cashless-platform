# Research — Configuration, parties et événements

Décisions techniques de la mission `configuration-parties-evenements-01M4GCJ9`. Les décisions de cadrage (périmètre,
rôle de base distinct, grand livre à la création, actions à deux) ont été confirmées par le porteur du projet
(spec, section « Decisions »). Les décisions ci-dessous ont été prises par l'agent, **par délégation du porteur du
projet (2026-10-09)**, à partir des sources normatives et du code des missions 1 et 2.

## R-01 — Rôle de base de la plateforme (`cashless_platform`)

- **Decision** : un second rôle PostgreSQL `cashless_platform` (`LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOBYPASSRLS`), créé et réglé dans `packages/ledger-sql/post-roles.sql` (rejoué après `roles.sql`), avec les mêmes
  durées de transaction que `cashless_app`. Son mot de passe vient de `CASHLESS_PLATFORM_PASSWORD`, posé par
  `migrate.ts` comme celui de `cashless_app`. L'API ouvre un **second pool** (`DATABASE_URL_PLATFORM`, obligatoire en
  production) et une classe `PlatformTx` (transaction sans prestataire, `set_config('app.scope', 'platform', true)`
  pour lisibilité dans les journaux). Seules les routes réservées à `PLATFORM_ADMIN` l'utilisent.
- **Droits** : `SELECT` sur les tables de référence qu'il doit lire ; `INSERT` sur `party`, `jurisdiction_profile`,
  `contract`, `config_version`, `fee_rule`, `audit_log`, `approval_request`, `api_idempotency` ; `UPDATE` de
  colonnes descriptives (`party.legal_name`, `country_code`, `tax_id`), de `fee_rule.valid_to`, des colonnes de
  statut d'`approval_request` et d'`api_idempotency` ; **aucun** droit sur `journal_transaction`, `posting`,
  `account_balance`, `ledger`, `account`, `event` (NFR-002). Politiques RLS `TO cashless_platform`, posées par
  `post-roles.sql` (DROP/CREATE, idempotent) : `party` (lecture `kind IN ('PLATFORM','OPERATOR')`, écriture
  `kind = 'OPERATOR'`), `contract` (`kind = 'PLATFORM_OPERATOR'`), `config_version` (`scope_type = 'PLATFORM'`),
  `fee_rule` (`scope_type = 'PLATFORM_CONTRACT'`), `audit_log`, `approval_request`, `api_idempotency`
  (`operator_id IS NULL`). Les politiques existantes `tenant_isolation` restent inchangées : sans
  `app.operator_id`, elles ne laissent rien voir au rôle plateforme ; les nouvelles sont permissives et nominatives,
  donc sans effet pour `cashless_app`.
- **`jurisdiction_profile`** n'a pas de RLS : `post-roles.sql` retire `INSERT, UPDATE` à `cashless_app` (aujourd'hui
  accordés par `roles.sql` sur toutes les tables, ce qui contredit §2.2 — défaut corrigé, test pgTAP dédié).
- **Rationale** : lettre de §2.2 (décision du porteur). Les politiques nominatives `TO cashless_platform` doivent
  vivre dans `post-roles.sql` : une migration ne peut pas nommer un rôle absent d'une base neuve (leçon du commit
  `1680391` de la mission 2).
- **Alternatives considered** : fonctions `SECURITY DEFINER` comme `create_platform_admin` (précédent de la
  mission 2, écarté par le porteur) ; `BYPASSRLS` pour le rôle plateforme (supprime tout cloisonnement, refusé).
- **Écart consigné** : la mission 2 reste sur sa fonction `SECURITY DEFINER` ; la coexistence des deux méthodes
  est ajoutée à `docs/DECISIONS_ADR.md` (ADR-80, à rédiger en WP de documentation). La migration de
  `create_platform_admin` vers le rôle plateforme est hors périmètre.

## R-02 — Idempotence et demandes d'approbation de niveau plateforme

- **Decision** : une migration rend `api_idempotency.operator_id` et `approval_request.operator_id` facultatifs
  (NULL = plateforme). `api_idempotency` : contrainte d'unicité remplacée par `UNIQUE NULLS NOT DISTINCT
  (operator_id, scope, idempotency_key)` (PostgreSQL ≥ 15). `approval_request` : `CHECK (operator_id IS NOT NULL OR
  action IN (<actions plateforme>))`. `decide_approval_request` est remplacée par migration : si `operator_id` est
  NULL, la décision exige que la session soit celle du rôle plateforme (`pg_has_role(session_user,
  'cashless_platform', 'MEMBER')`, testé par une fonction interne pour ne pas nommer le rôle à la création), sinon
  `assert_tenant` comme avant ; toutes les autres règles (auteur ≠ valideur, expiration, passages) sont inchangées.
- `@Idempotent({ scope: 'plt:', platform: true })` fait réserver et enregistrer la clé par `PlatformTx` ;
  `ApprovalService` reçoit une variante plateforme (même code, transaction plateforme). Les routes
  `/approval-requests` servent une personne de la plateforme (prestataire NULL) par la transaction plateforme et ne
  lui montrent que les demandes de niveau plateforme.
- **Rationale** : FR-019 (plafond réglementaire, contrat plateforme à deux) et FR-021 (clé d'idempotence sur toute
  écriture) s'appliquent aussi au niveau plateforme ; réutiliser les tables et le mécanisme de la mission 2 évite un
  second registre.
- **Alternatives considered** : tables séparées `platform_approval_request` et `platform_idempotency` (duplication du
  garde et du code) ; écritures plateforme sans clé, comme `POST /platform-admins` (contraire à FR-021).

## R-03 — Chemins des routes back-office

- **Decision** : toutes les routes de la mission rattachées à un prestataire sont sous `/operators/{operator_id}/…`,
  comme les routes « Personnes » de la mission 2 : un `PLATFORM_ADMIN` peut y superviser n'importe quel prestataire
  (`IdentityTenantContext`), les autres personnes seulement le leur (sinon 404). Les routes de niveau plateforme
  sont hors de ce préfixe (`/jurisdiction-profiles`, `/operators`, `/platform/config-versions`) et réservées à
  `PLATFORM_ADMIN`.
- **Rationale** : cohérence avec le contrat existant ; le prestataire de la transaction reste déduit et contrôlé
  (C-005), jamais lu dans un corps.
- **Alternatives considered** : routes plates (`/events`, `/organizers`) avec le prestataire de la personne seulement
  (la plateforme ne pourrait plus superviser) ; deux familles de routes (doublon de contrat).

## R-04 — Création du grand livre et des comptes

- **Decision** : deux fonctions SQL `SECURITY INVOKER` (exécutées sous RLS par `cashless_app`, dans la transaction
  de la route) : `open_event_ledger(p_event uuid) RETURNS uuid` crée le grand livre `EVENT` (devise, émetteur,
  titulaire des fonds) et les comptes fixes de §5.2 ; `open_participation_account(p_participation uuid) RETURNS uuid`
  crée `L-MCH-<id>`. Comptes fixes créés : `A-TRANSIT`, `A-BANQUE` (titulaire = détenteur des fonds) ; `L-ORG-COM`
  (chaud), `L-ORG-PLACE`, `L-ORG-FFEST`, `L-ORG-TVA` (chaud), `L-ORG-CASSE`, `L-ORG-CAUTION`, `L-ORG-CAUTION-ACQ`,
  `L-ORG-PROMO`, `L-ORG-FPSP` (chaud), `L-ORG-FPREST`, `L-ORG-PERTES`, `L-ORG-CREANCES`, `L-ORG-VERS` ;
  `L-OPE-FRAIS`, `L-OPE-TVA`, `L-OPE-CASSE`, `L-OPE-FPSP` (chaud), `L-OPE-PERTES`, `L-OPE-REDEV`, `L-OPE-VERS` ;
  `L-PLT-REDEV`, `L-PLT-TVA`, `L-PLT-VERS` ; `L-ESP-A-RENDRE`, `L-VERS-ENCOURS`, `S-ATTENTE` ; `L-LEGAL-CASSE`
  seulement si le profil de législation a `breakage_destination = LEGAL_ACCOUNT`. Familles, sens, négatif permis et
  chaleur suivent le tableau de §5.2 ; le déclencheur `account_merchant_hot` reste seul juge de `allow_negative`
  pour `MERCHANT` et les comptes de casse. Les comptes par portefeuille, par caisse et par canal PSP restent créés
  par les missions qui les introduisent.
- **Rationale** : §2.2 règle 2 (règles métier en base), atomicité (NFR-004), un seul endroit qui connaît le plan
  de comptes ; `INVOKER` garde la RLS et n'élargit aucun droit (le rôle applicatif peut déjà insérer `ledger` et
  `account`).
- **Alternatives considered** : création en TypeScript (plan de comptes dupliqué entre code et tests) ; `SECURITY
  DEFINER` (inutile, élargit la surface).

## R-05 — Cascade de configuration et réglages d'événement

- **Decision** : un **catalogue des réglages** en TypeScript (`apps/api/src/configuration/settings-catalog.ts`) décrit
  chaque réglage : clé, niveaux permis, type, bornes fixes (§4.2, §9.8), rôle qui le règle, et s'il est porté par une
  colonne d'`event` (bornée aussi par la base) ou par `config_version.settings`. Toute modification d'un niveau crée
  une nouvelle `config_version` (version = précédente + 1, `valid_from` = instant de l'écriture ou de l'exécution de
  l'approbation) ; pour l'événement, la version contient aussi l'instantané des réglages portés par des colonnes,
  pour que `config_version_id` d'une transaction redonne tous les réglages en vigueur (SC-004). La résolution lit,
  pour chaque niveau, la dernière version `valid_from ≤ date`, puis fusionne du plus général au plus précis ; chaque
  valeur rendue porte son niveau et sa version d'origine (FR-014).
- **Concurrence** : `UNIQUE (scope_type, scope_id, version)` existante ; la seconde écriture concurrente reçoit
  `23505`, traduit en `409 CONFLICT_STATE`.
- **Rationale** : un seul endroit pour bornes, rôles et messages (NFR-005) ; les bornes de colonnes restent doublées
  par les CHECK du schéma.
- **Alternatives considered** : tout dans `config_version` (les fonctions de la base lisent les colonnes d'`event`) ;
  tout dans les colonnes (pas d'historique ni de version par transaction).

## R-06 — Bornes de la législation et maximums du prestataire

- **Decision** : validation à l'enregistrement par un `BoundsValidator` (TypeScript) qui reçoit le profil de
  législation de l'événement et la configuration résolue des niveaux supérieurs ; chaque refus est un `422
  VALIDATION_FAILED` dont le détail cite la règle (identifiant stable, par exemple `jurisdiction.min_refund_window_days`),
  la valeur demandée, la borne et sa source (`SN v1` ou « maximum du prestataire, version n »), traduit selon
  `Accept-Language` (FR, EN). Défense en profondeur en base : déclencheur `event_jurisdiction_bounds` (migration)
  qui refuse `refund_deadline < ends_at + min_refund_window_days` (`CL001`). Rattacher un événement `LIVE` à une
  nouvelle version de profil passe par la modification d'événement à deux (§ edge cases de la spec).
- **Rationale** : §4.1 (refus à l'enregistrement, message qui cite la règle) ; la règle la plus coûteuse à
  contourner est doublée en base.
- **Alternatives considered** : toutes les bornes en déclencheurs (messages SQL bruts interdits, traduction
  difficile).

## R-07 — Valeurs provisoires (§17.2)

- **Decision** : un module `provisional-defaults.ts` porte les défauts provisoires (Sénégal : `unidentified_monthly_limit`
  200 000 XOF, `identified_monthly_limit` 2 000 000 XOF, pas de plafond de solde ; TVA 18 % TTC ; `refund_deadline`
  absente = `ends_at` + 30 jours ; destination de la casse `ORGANIZER`), avec pour chacun « qui confirme » (juriste,
  expert-comptable, porteur). À la création d'un profil, un champ omis prend son défaut provisoire et son nom est
  ajouté à `rules.provisional` (`{field, confirm_by}`) ; les réponses exposent `provisional_fields`. Une valeur
  saisie explicitement n'est plus provisoire. `refund_deadline` calculée est renvoyée avec `refund_deadline_source:
  "PROVISIONAL_DEFAULT"`.
- **Rationale** : C-006, FR-003.

## R-08 — Statuts : conditions visibles et passage

- **Decision** : fonction SQL de lecture `event_transition_conditions(p_event uuid, p_to event_status)` (`SECURITY
  DEFINER`, `assert_tenant`, `STABLE`) qui rend `(code, met, detail, source)` pour chaque condition que
  `set_event_status` vérifie (mêmes calculs, sans verrou ni écriture), plus les conditions de configuration de
  `DRAFT → LIVE` calculées par l'API (détenteur des fonds, contrat applicable en vigueur, profil de législation) et les
  conditions « externes » (`source = 'EXTERNAL'`, `met = null`, mission responsable nommée). Passage :
  `POST /operators/{operator_id}/events/{event_id}/status-transitions` (`{ "to": "<statut>" }`). `DRAFT → LIVE` crée
  une demande `EVENT_GO_LIVE` (payload : statut visé et `config_version_id` en vigueur à la demande) ; à l'exécution,
  si la configuration a changé ou une condition n'est plus remplie, la demande passe `FAILED`. Les autres passages
  appellent directement `set_event_status` (auteur = personne connectée). `CL018` → `409 EVENT_TRANSITION_INVALID`,
  `CL019` → `409 CLOSING_CONDITION_NOT_MET` (déjà dans la table SQLSTATE de la mission 1 ; à vérifier, sinon ajout).
  Le `PATCH` d'événement refuse toute clé `status`.
- **Rationale** : FR-017, FR-018, C-001 ; une seule source des conditions calculées (la base).

## R-09 — Actions à deux de la mission

| Action (`approval_request.action`) | Opération | Rôle (auteur et valideur) | Portée | Prestataire |
|---|---|---|---|---|
| `EVENT_GO_LIVE` | Passage `DRAFT → LIVE` | `ORGANIZER_ADMIN` | événement | oui |
| `EVENT_SETTINGS_CHANGE` | Modification d'un événement `LIVE` (réglages de l'organisateur) | `ORGANIZER_ADMIN` | événement | oui |
| `EVENT_OPERATOR_SETTINGS_CHANGE` | Modification d'un événement `LIVE` (réglages du prestataire) | `OPERATOR_ADMIN` | événement | oui |
| `PARTICIPATION_CHANGE` | Modification d'une participation d'un événement `LIVE` | `ORGANIZER_ADMIN` | événement | oui |
| `FEE_RULE_CHANGE` | Création ou remplacement d'une règle de frais applicable à un événement `LIVE` | rôle qui règle la portée de la règle | portée de la règle | oui |
| `CONTRACT_VERSION` | Nouvelle version d'un contrat `OPERATOR_ORGANIZER` | `OPERATOR_ADMIN` | prestataire | oui |
| `PLATFORM_CONTRACT_VERSION` | Nouvelle version d'un contrat `PLATFORM_OPERATOR` | `PLATFORM_ADMIN` | plateforme | NULL |
| `JURISDICTION_LIMITS_CHANGE` | Nouvelle version d'un profil qui change un plafond réglementaire | `PLATFORM_ADMIN` | plateforme | NULL |

Ajoutées à la liste fermée par migration et à `ApprovalAction` du contrat. Une modification qui mêle réglages de
l'organisateur et du prestataire est refusée (`422`, « deux demandes distinctes »).

## R-10 — Résolveur de configuration réel (`SqlConfigResolver`)

- **Decision** : implémentation SQL du port `ConfigResolver` de la mission 1 : lit l'événement du grand livre, sa
  configuration résolue à `occurredAt`, son contrat, son profil de législation et les règles de frais valides à cette
  date (`valid_from ≤ t < coalesce(valid_to, ∞)`), et construit `ResolvedConfig` (`configVersionId` = version
  d'événement en vigueur ; commissions par participation ; frais PSP, d'activation, de remboursement, du prestataire,
  de la plateforme, par `payer_purpose`/`beneficiary_purpose`/`basis` ; taux de taxe depuis `rules`). Les
  constructeurs posent déjà `fee_rule_id` par ligne : le résolveur fournit l'identifiant de chaque `FeeRule`.
  Fourni par le module de configuration au `LedgerModule`. Preuve (SC-004) : test d'intégration qui construit la
  configuration du scénario de référence **par l'API** puis rejoue le scénario avec `SqlConfigResolver` ; soldes
  identiques à ceux du rejeu par fixture.
- **Rationale** : FR-016 ; le port existe et n'avait que des fixtures.

## R-11 — Pas de nouvelle dépendance

Aucun paquet ajouté : validation des corps à la main comme `users.dto.ts` (mission 2), `pg`, NestJS et `jose`
existants. Section supply-chain sans objet ; aucune passe adversariale requise.

## R-12 — Environnement local (macOS)

Le poste de développement est désormais macOS (PostgreSQL 18 client, Docker via Colima). La base de test est un
conteneur `postgres:17` + `postgresql-17-pgtap` (`cashless-platform-pg17`, port 5433, dépôt monté au même chemin,
`pg_prove` exécuté dans le conteneur). Ligne de base mesurée le 2026-10-09 avant tout changement : 7 suites pgTAP,
676 assertions ; 29 suites Jest, 670 tests ; lint, types et contrat à jour. Le quickstart documente ce mode en plus
du cluster privé Windows de `tools/dev-db/`.

## Contradictions signalées

| # | Sources | Constat | Traitement |
|---|---|---|---|
| X-1 | SPECIFICATION §3.2 / §2.2 et schéma | §3.2 confie les profils de législation à `OPERATOR_ADMIN` ; §2.2 et `jurisdiction_profile` (sans `operator_id`) en font une donnée de plateforme | Tranché par le porteur : `PLATFORM_ADMIN` gère, prestataires lisent (spec, Decisions) |
| X-2 | §2.2 / mission 2 | Rôle de base distinct exigé ; la mission 2 a utilisé `SECURITY DEFINER` | Rôle distinct pour cette mission ; coexistence consignée (ADR-80) |
| X-3 | §2.2 / `roles.sql` | `roles.sql` accorde `INSERT, UPDATE` sur `jurisdiction_profile` à `cashless_app` | Retiré par `post-roles.sql` (R-01) |
| X-4 | §4.2 / schéma | `issuer` et le tiers détenteur des fonds sont des paramètres d'événement, absents des colonnes d'`event` | Colonnes ajoutées par migration (data-model) |
| X-5 | §12.1 / schéma | Le droit de place est porté par la participation (§3.1) mais `merchant_participation` n'a ni montant ni référence de paiement d'avance | Colonnes ajoutées par migration (data-model) |
