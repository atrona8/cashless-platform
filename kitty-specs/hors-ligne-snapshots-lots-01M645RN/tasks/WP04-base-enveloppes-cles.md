---
work_package_id: WP04
title: 'Base : enveloppes, lecture du terminal, clés de signature (migration 0045)'
dependencies: [WP03]
requirement_refs:
- FR-010
- FR-011
- FR-037
planning_base_branch: feat/hors-ligne-snapshots-lots
merge_target_branch: feat/hors-ligne-snapshots-lots
branch_strategy: Planning artifacts for this mission were generated on feat/hors-ligne-snapshots-lots. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/hors-ligne-snapshots-lots unless the human explicitly redirects the landing branch.
subtasks: [T014, T015, T016, T017, T018]
phase: Phase 1 - Contrat et base de données
agent: claude
history:
- timestamp: '2026-10-30T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: packages/ledger-sql/migrations/0045_offline_snapshot_keys.sql
create_intent: [packages/ledger-sql/migrations/0045_offline_snapshot_keys.sql, packages/ledger-sql/tests/tests_offline_snapshot_keys.sql]
execution_mode: code_change
model: sonnet
owned_files: [packages/ledger-sql/migrations/0045_offline_snapshot_keys.sql, packages/ledger-sql/tests/tests_offline_snapshot_keys.sql]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP04 – Base : enveloppes, lecture du terminal, clés de signature (migration 0045)

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche de contexte d'implémentation fournie par
l'orchestrateur, ce prompt, puis seulement :

- `contracts/interfaces.md` § 1 (CL049 à CL054) et § 3 (partie WP04, signatures figées) ;
- `research.md` R-04, R-08 et **R-30.5, R-30.9, R-30.8 dernier point** (font foi) ;
- `data-model.md` sections `offline_snapshot_key`, `snapshot_signing_key` ;
- `contracts/snapshots.md` § `GET /offline-snapshots/current`, § Configuration et battement de cœur ;
- `spec.md` FR-006, FR-008, FR-009, FR-038.

Code de référence : `schema_grand_livre_cashless.sql` l.150-176 (`device` : `agreement_public_key`
l.173, `personal_phone` l.175, `status`), l.355 (`offline_snapshot`), l.766 (`effective_offline_policy`),
l.2291-2310 (`snapshot_signing_key` et index `snapshot_signing_key_one_active` l.2307), l.2314-2353
(`check_offline_snapshot`, exige une clé `ACTIVE` `CENTRAL`), l.1982 (`tenant_of_device`), l.1706
(`assert_tenant`) ; `migrations/0023_device_tokens_nonces.sql:312-335` (statut du terminal, `42501`
révoqué, `CL030` suspendu). Ce que WP03 a posé (`offline_snapshot.content_key_wrapped`,
`offline_snapshot_entry`, `offline_snapshot_media_log`) est dans `migrations/0044_…` de ta base de lot.
Priorité des sources (SPECIFICATION §0.3) : tests exécutables > schéma SQL, `openapi.yaml`,
`sync_protocol.md` > SPECIFICATION > PRD ; contradiction : **signale-la**. Aucun `.sql` généré modifié.

## Objective

Poser ce qui sépare le contenu du snapshot (public pour les terminaux éligibles) de la clé qui l'ouvre :
une enveloppe de la clé de contenu `K_v` par terminal et par clé d'accord (`offline_snapshot_key`), la
lecture réservée à un terminal éligible (`offline_snapshot_for_device`, choix du FULL ou du pas suivant),
et la gestion des clés de signature (deux au plus, rotation par la base). Un terminal suspendu, révoqué ou
dont la clé d'accord a changé ne reçoit jamais l'enveloppe d'un autre ni une enveloppe périmée.

## Périmètre et arbitrages

- Dans le lot : table `offline_snapshot_key` (RLS), déclencheur de bornes sur `snapshot_signing_key`,
  `offline_snapshot_keys_to_wrap`, `wrap_offline_snapshot_key`, `offline_snapshot_for_device`,
  `snapshot_public_keys`, `rotate_snapshot_signing_key`, suite pgTAP **sous le propriétaire uniquement**.
  `REVOKE ALL … FROM PUBLIC` sur chaque fonction ; aucun `GRANT` (WP08 : `cashless_snapcontent`,
  `cashless_app`, `cashless_keyadmin`).
- Hors lot : brouillon, publication, purge (WP03) ; accusés (WP07) ; chiffrement et appels KMS (WP12 :
  la base reçoit une enveloppe déjà construite) ; création de la clé dans le KMS (WP09) ; route HTTP (WP15).
- **Numéro de migration** : `interfaces.md` § 1 met la table et le déclencheur en 0045 ; `data-model.md`
  les place en 0044 (indicatif). 0045 fait foi. Signale-le au rapport.
- Hypothèse de propriétaire (0023 l.19-25) pour `offline_snapshot_keys_to_wrap` (pas de prestataire de
  session) : propriétaire qui ignore la RLS, sinon liste vide (échec fermé). Dis-le en en-tête.
- Les enveloppes ne sont faites que pour des versions **publiées** (clé `K_v` lue dans
  `offline_snapshot.content_key_wrapped`), jamais pour un brouillon : un brouillon abandonné libère sa
  version, qui serait réservée à une autre `K_v`. Coût : un tour de boucle de plus (1 s) entre publication
  et enveloppe, tenu par le budget de 5 s ; à rapporter.
- Enveloppes : terminaux `ACTIVE` seulement (R-30.9), jamais `SUSPENDED` ni `REVOKED`.

## Subtasks

### T014 – Table `offline_snapshot_key` et borne de deux clés de signature

**But** : stockage des enveloppes et garde des clés (`data-model.md`).

**Étapes**
- `offline_snapshot_key (ledger_id, version, device_id, agreement_key_sha256)` PK (SHA-256 de la clé
  d'accord, 32 octets), `operator_id` FK `party`, `envelope jsonb NOT NULL`, `created_at`. FK
  `(ledger_id, version)` → `offline_snapshot`, FK `device`. `CHECK` sur `envelope` : exactement les clés
  `alg`, `epk`, `iv`, `wrapped_key` (textes non vides), `alg = 'ECDH-ES+HKDF-SHA256+A256GCM'`.
  `tenant_isolation` ENABLE + FORCE (R-30.2). Déclencheur `forbid_mutation` (une enveloppe ne se réécrit
  pas : une nouvelle clé d'accord donne une nouvelle ligne).
- Déclencheur sur `snapshot_signing_key` (`BEFORE INSERT OR UPDATE OF status`) : si la ligne résultante est
  `ACTIVE` ou `RETIRED`, compter les **autres** lignes `ACTIVE|RETIRED` du même signataire
  `(owner, operator_id, edge_gateway_id)` (comparaison nulle-sûre) ; deux ou plus : `CL054`. Verrou
  `pg_advisory_xact_lock(hashtextextended('snapshot-signer:' || …, 0))` avant le comptage (deux insertions
  concurrentes). Fonction de déclencheur `SECURITY DEFINER` seulement si elle lit hors RLS ; `search_path =
  public, pg_temp`.

**Cas limites** : une ligne `REVOKED` ou `PENDING` ne compte pas ; la rotation (T017) respecte la borne à
chaque instruction (révoquer la plus ancienne avant d'insérer la nouvelle).

**Critère** : troisième clé `ACTIVE|RETIRED` insérée à la main : `CL054` ; RLS forcée sur la table.

### T015 – `offline_snapshot_keys_to_wrap`, `wrap_offline_snapshot_key`

**But** : file de travail du processus `snapshot-content` (WP12), sans que la base voie une clé.

**Étapes**
- `offline_snapshot_keys_to_wrap(p_limit)` `STABLE` : une ligne par (version publiée du **dernier `FULL`
  et des versions postérieures** d'un grand livre, terminal éligible) sans enveloppe pour la clé d'accord
  courante. Terminal éligible : `ACTIVE`, `event_id` = événement du grand livre, hors `personal_phone`,
  `agreement_public_key` non nulle, `effective_offline_policy(...).offline_enabled`. Colonnes figées
  (`agreement_key_sha256` = `sha256(agreement_public_key)` calculé par la base). Ordre : version
  croissante puis terminal ; `p_limit` borné (1 à 1 000, sinon `CL001`). Grand livre `LOCKED` : exclu.
- `wrap_offline_snapshot_key(p_ledger, p_version, p_device, p_agreement_key_sha256, p_envelope)` :
  `assert_tenant(tenant_of_ledger(p_ledger))` ; terminal `ACTIVE` de l'événement du grand livre (sinon
  `CL001`) ; `p_agreement_key_sha256` égal à `sha256(device.agreement_public_key)` **maintenant** (clé
  changée entre-temps : `CL001`, l'enveloppe périmée n'est jamais inscrite) ; version publiée et conservée
  (>= dernier `FULL`) ; forme de l'enveloppe (clés exactes). Insertion `ON CONFLICT DO NOTHING` (la
  première enveloppe fait foi, idempotent).

**Cas limites** : terminal passé `SUSPENDED` entre la liste et l'inscription : refus. Clé d'accord
re-enrôlée : l'ancienne ligne reste, ne sera jamais servie (T016).

**Critère** : liste vide pour un terminal `SUSPENDED`, `REVOKED`, `personal_phone` ou sans clé d'accord ;
l'enveloppe d'une ancienne empreinte est refusée.

### T016 – `offline_snapshot_for_device`, `snapshot_public_keys`

**But** : la seule lecture d'un snapshot par un terminal (`cashless_app`, `STABLE`).

**Étapes** (règles : `contracts/snapshots.md` § `GET`, R-30.5, R-30.9)
- `assert_tenant(tenant_of_device(p_device))`. Terminal `REVOKED` : `42501` (comme 0023, traduit 403
  `DEVICE_REVOKED`) ; `SUSPENDED` : `CL051` détail `DEVICE_SUSPENDED` ; sans événement : `NO_EVENT` ;
  `personal_phone` : `PERSONAL_PHONE` ; politique effective sans hors ligne : `OFFLINE_DISABLED` ; aucune
  clé `CENTRAL` `ACTIVE` utilisable pour le prestataire : `SNAPSHOTS_UNAVAILABLE`. Le détail est dans le
  `MESSAGE` du `RAISE` (forme de `interfaces.md` § 3), jamais un secret.
- Aucune version publiée : `CL050`. Choix de la version servie, avec `b = p_since`, `L` = dernière version,
  `F` = dernier `FULL` : `b` NULL, inconnue ou antérieure au plus ancien contenu conservé : `F` ; `b = L` :
  `L` ; `F > b` ou plus de 5 versions entre `b` et `L` : `F` ; sinon la version `b + 1` (un `DELTA` de base
  `b`). Contrôle : un `DELTA` servi a `base_version = b`, sinon `F`.
- Enveloppe : la ligne `offline_snapshot_key` de la version choisie pour **cette** `device_id` et
  l'empreinte de la clé d'accord **courante** ; absente : `CL050` (la version existe, l'enveloppe n'est pas
  prête). Jamais l'enveloppe d'un autre terminal, jamais celle d'une ancienne clé.
- Rend `version`, `latest_version`, `header`, `signature`, `entries`, `envelope`. Choix à rapporter :
  `entries` est un objet `{"entries": [...], "removed_token_hashes": [...]}` (entrées triées par
  `token_hash` hex, chacune avec `pwd_pack_enc` en base64 si elle en a ; `envelope` complétée de
  `agreement_key_sha256` en hex pour l'`ETag` de WP15). Lecture par fonction `SECURITY DEFINER` : `cashless_app`
  n'a aucun `SELECT` sur `offline_snapshot_entry` (WP08).
- `snapshot_public_keys(p_operator)` `STABLE` : au plus deux clés `CENTRAL` `ACTIVE|RETIRED` visibles du
  prestataire (`operator_id IS NULL` ou égal), la plus récente d'abord. `not_after` : `retired_at + 24 h`
  pour une `RETIRED`, **NULL pour une `ACTIVE`** (`DeviceConfig.snapshot_keys[].not_after` exige une date : signale-le, WP15 la complète).

**Critère** : tableau de choix de `snapshots.md` rejoué par la suite (T018), un cas par ligne.

### T017 – `rotate_snapshot_signing_key`

**But** : seule écriture sur `snapshot_signing_key` (`cashless_keyadmin`, WP08 retire l'`INSERT`).

**Étapes**
- Paramètres `(p_new_key_id, p_public_key, p_kms_key_ref, p_actor)` ; signataire = clé `CENTRAL` de la
  plateforme (`operator_id IS NULL`, `edge_gateway_id IS NULL`). Aucun paramètre de prestataire : signale
  l'hypothèse au rapport.
- Dans l'ordre, sous le verrou de T014 : la plus ancienne `RETIRED` passe `REVOKED` ; l'`ACTIVE` actuelle
  passe `RETIRED` (`retired_at = clock_timestamp()`) ; la nouvelle ligne est insérée `ACTIVE`, algorithme
  `ECDSA_P256_SHA256`. Aucune `ACTIVE` au départ : simple création (première clé, WP09 T041).
- Contrôles : `p_public_key` de 91 octets (SPKI P-256), `p_new_key_id` et `p_kms_key_ref` non vides et
  `p_new_key_id` inconnu (`CL001`) ; `p_actor` non nul. Jamais d'accès à une clé privée.

**Critère** : après trois rotations il reste une `ACTIVE`, une `RETIRED`, le reste `REVOKED` ; aucun état
transitoire à trois clés `ACTIVE|RETIRED`.

### T018 – Suite `tests_offline_snapshot_keys.sql`

**Étapes** (gabarit `tests_cash_sessions.sql`, `no_plan()`, ROLLBACK, données propres, une identité par
prestataire A et B)
- Enveloppes : liste et inscription ; terminal `SUSPENDED`/`REVOKED`/`personal_phone` absent ; clé d'accord
  changée entre liste et inscription : refus ; deuxième inscription : sans effet ; autre prestataire : refus.
- `offline_snapshot_for_device` : un cas par ligne du tableau de choix (`b` nul, `b = L`, `b < L` à 1 pas, à
  6 pas, `FULL` plus récent, `b` purgée) ; `CL050` (aucune version, enveloppe absente, enveloppe d'une
  ancienne clé) ; `CL051` avec chacun des cinq détails ; `REVOKED` : `42501` ; session de B sur un terminal de A.
- L'enveloppe rendue est celle du terminal appelant (deux terminaux, deux enveloppes distinctes).
- Clés : troisième clé insérée : `CL054` ; `rotate_…` trois fois ; `snapshot_public_keys` ≤ 2 ; clé d'un
  autre prestataire non rendue ; `REVOKED` jamais rendue ; RLS forcée ; `search_path` des fonctions.

## Sécurité

- **À faire relire par une personne** : toute la migration 0045 (`offline_snapshot_for_device`,
  `wrap_offline_snapshot_key`, `rotate_snapshot_signing_key`, règle 4 de `CLAUDE.md`).
- L'enveloppe est l'unique lien entre un terminal et `K_v` : jamais d'enveloppe pour un terminal non `ACTIVE`,
  jamais celle d'une autre clé d'accord, jamais celle d'un autre terminal.
- `rotate_…` ne reçoit que la clé publique et la référence KMS : aucun secret en base ni dans un message
  d'erreur. Aucun `GRANT` ici. Règle 1 : tout écart qui affaiblit la sécurité (éligibilité élargie, borne de
  clés retirée, enveloppe servie à un suspendu) est soumis au porteur AVANT d'être codé.

## Tests

- `reset-db` puis `pg_prove -d cashless_wp04 packages/ledger-sql/tests/tests_offline_snapshot_keys.sql` (base
  du lot, pas `cashless_test`). Relance `tests_definer_search_path.sql` ; `tests_execute_grants.sql` peut
  échouer sur les fonctions nouvelles (liste figée) : signale-le, WP08 la met à jour.
- L'orchestrateur relance tout en série.

## Ce que le relecteur doit casser

1. Demander la version d'un terminal `SUSPENDED` ou `REVOKED` : jamais de contenu ni d'enveloppe.
2. Ré-enrôler un terminal (clé d'accord changée) puis lire : l'ancienne enveloppe ne doit pas sortir.
3. Session du prestataire B, `p_device` du prestataire A : refus avant toute lecture.
4. Deux insertions concurrentes de clés de signature : jamais plus de deux `ACTIVE|RETIRED`.
5. `wrap_offline_snapshot_key` avec un `p_ledger` d'un autre événement que celui du terminal.
6. `p_since` négatif, énorme ou nul : pas d'erreur interne, un `FULL` ou `CL050`.
7. Une `ACTIVE` du plateforme et une d'un prestataire : `snapshot_public_keys` ne mélange pas les prestataires.
8. `rotate_…` avec une clé publique tronquée ou un `key_id` déjà pris.

## Definition of Done

- [ ] `0045_offline_snapshot_keys.sql` appliquée sur base propre ; en-tête (codes, hypothèse sur le
      propriétaire, enveloppes des seules versions publiées) ; aucun `GRANT`.
- [ ] Toutes les fonctions : `search_path = public, pg_temp`, `REVOKE ALL … FROM PUBLIC`.
- [ ] `tests_offline_snapshot_keys.sql` vert ; suites existantes vertes sur `cashless_wp04` (hors listes figées).
- [ ] Rapport : signatures réelles ; ajouts/choix (forme de `entries`, `agreement_key_sha256` dans
      l'enveloppe) ; contradictions ; fichiers à relire par une personne ; matrice (FR-006, FR-008, FR-009).

## Branch Strategy

- Branche de planification et de fusion : `feat/hors-ligne-snapshots-lots`.
- Worktree par lane, calculée dans `lanes.json`.
- Commande : `spec-kitty agent action implement WP04 --agent claude --mission
  hors-ligne-snapshots-lots-01M645RN`.

## Activity Log

- 2026-10-30T12:00:00Z – claude – Prompt generated via /spec-kitty.tasks
