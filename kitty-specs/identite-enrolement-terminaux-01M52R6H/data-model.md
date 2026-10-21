# Data Model — mission identite-enrolement-terminaux-01M52R6H

Toutes les tables nouvelles portent `operator_id`, la RLS forcée (politique `operator_id = current_setting('app.operator_id')::uuid`)
et des droits accordés dans `post-roles.sql`. Aucune modification des fichiers générés du kit (C-002) : tout passe par
les migrations `0021` à `0025`.

## Terminal (`device`, schéma de référence, colonnes ajoutées par `0022`)

| Colonne | Type | Règle |
|---|---|---|
| `app_version` | text | version de l'app à l'enrôlement, mise à jour par le battement de cœur |
| `attestation_kind` | text | `ANDROID_KEY_ATTESTATION` ou `IOS_APP_ATTEST` |
| `attestation_security_level` | text NULL | Android : `TRUSTED_ENVIRONMENT` ou `STRONGBOX` ; iOS : NULL |
| `cert_not_after` | timestamptz | fin de validité du certificat client |
| `enrolled_at` | timestamptz | date de l'enrôlement |
| `enrollment_code_id` | uuid | code consommé |
| `status_reason` | text NULL | motif du dernier changement de statut |

Colonnes existantes utilisées : `serial`, `os`, `app_mode`, `nfc_enabled`, `personal_phone`, `provided_by`,
`event_id`, `pos_id`, `station_name`, `public_key` (SPKI DER de la clé de signature), `agreement_public_key` (point non
compressé, 65 octets), `cert_sha256`, `status`, `last_seq`, `next_seq_floor`, `last_seen_at`.

**Invariants**

- `serial` unique **dans le prestataire** parmi les terminaux non révoqués : `0022` remplace l'index de référence
  `device_serial_active (serial)` par `(operator_id, serial) WHERE status <> 'REVOKED'` (décision du porteur, ADR-109).
- `public_key`, `agreement_public_key`, `cert_sha256` non NULL pour un terminal enrôlé par la mission ; ne s'écrivent
  que par `enroll_device` ; `status` ne s'écrit que par `set_device_status` (OP-N63 et R-11 : `cashless_app` n'a ni
  `INSERT` sur `device` ni `UPDATE` de `status`, `public_key`, `agreement_public_key`, `cert_sha256`, `serial`, `os`,
  `operator_id`).
- Android : version 12 au moins (attestation KeyMint) ; iOS : `nfc_enabled = false` (contrainte existante) et
  `app_mode <> 'TOPUP_DESK'` ; téléphone personnel :
  `app_mode = 'KEYPAD_TPE'`, jamais de hors ligne.

**Transitions de statut** (`set_device_status`, seule écriture permise de `status`)

| De | Vers | Qui | Effets |
|---|---|---|---|
| `ACTIVE` | `SUSPENDED` | `OPERATOR_ADMIN`, `ORGANIZER_ADMIN` du périmètre | motif obligatoire |
| `SUSPENDED` | `ACTIVE` | idem | motif obligatoire |
| `ACTIVE`, `SUSPENDED` | `REVOKED` | idem | motif obligatoire ; familles de jetons révoquées dans la même transaction |
| `REVOKED` | — | — | refus (`CL0xx` → `409 CONFLICT_STATE`) |

Chaque transition écrit `device_status_history` et une ligne d'audit.

## Code d'enrôlement (`device_enrollment_code`, S5)

| Colonne | Type | Règle |
|---|---|---|
| `id` | uuid PK | |
| `operator_id` | uuid | prestataire de l'auteur |
| `code_hash` | bytea UNIQUE | HMAC-SHA256 (clé `ENROLLMENT_CODE_HMAC_KEY`, hors base) du code normalisé |
| `event_id` | uuid NOT NULL | obligatoire (analyse U1, 19/10/2026) ; même prestataire ; un `ORGANIZER_ADMIN` doit viser un événement de son organisateur |
| `pos_id` | uuid NULL | point de vente de cet événement |
| `app_mode` | text NULL | `CATALOG_POS`, `KEYPAD_TPE`, `TOPUP_DESK` ; `PAIRED_TPE` refusé par la fonction (`DEVICE_MODE_NOT_ALLOWED`) |
| `personal_phone` | boolean NOT NULL | **sans défaut**, choisi par l'administrateur (R-17) ; vrai seulement avec `KEYPAD_TPE` |
| `created_by` | uuid | personne |
| `expires_at` | timestamptz | `created_at` + durée (défaut 24 h, bornes 5 min à 7 jours) |
| `used_at`, `device_id` | NULL tant que non utilisé | posés ensemble par `enroll_device` |

**Invariants** : utilisé au plus une fois (`used_at` posé sous `FOR UPDATE`) ; jamais consommé par un enrôlement
refusé ; le code en clair n'existe que dans la réponse de création (route `transient`, rien dans le registre
d'idempotence).

## Jeton de rafraîchissement (`device_refresh_token`, S5)

| Colonne | Type | Règle |
|---|---|---|
| `id` | uuid PK | |
| `operator_id`, `device_id` | uuid | |
| `family_id` | uuid | une famille par enrôlement |
| `token_hash` | bytea UNIQUE | SHA-256 du jeton |
| `expires_at` | timestamptz | 30 jours |
| `consumed_at` | timestamptz NULL | posé à l'échange |
| `revoked_at`, `revoked_reason` | NULL | `REUSE`, `DEVICE_REVOKED`, `REENROLLED`, `GRACE_REPLACED` |
| `successor_id` | uuid NULL | jeton émis à l'échange (sert à la grâce de 60 s) |
| `grace_used_at` | timestamptz NULL | représentation acceptée une fois dans la grâce (OP-N65) |

**Invariants** : au plus un jeton non consommé et non révoqué par famille ; échange concurrent : `FOR UPDATE NOWAIT`,
un seul gagnant, le perdant reçoit `409` ; jeton consommé représenté dans les 60 s par le même terminal (même
`cert_sha256`), `grace_used_at` vide : nouvelle paire, le successeur jamais utilisé est révoqué (`GRACE_REPLACED`) ;
tout autre cas de représentation révoque la famille (`revoke_device_token_family`). Famille révoquée : les jetons
d'appareil qui portent son `fid` sont refusés à la requête suivante.

## Nonce de requête (`device_request_nonce`)

| Colonne | Type | Règle |
|---|---|---|
| `device_id` | uuid | |
| `nonce` | bytea | 16 à 64 octets |
| `expires_at` | timestamptz | `created` + 2 × tolérance (heure de la base) |
| PK | (`device_id`, `nonce`) | un doublon = rejeu |

Écrite seulement par `consume_device_nonce` (`SECURITY DEFINER`), appelée par l'API publique et par le processus des
clés de bracelet **après** vérification des trois preuves ; RLS forcée ; purge par lots des lignes expirées (heure de la
base).

## Essais d'enrôlement (`device_enrollment_attempt`, R-16)

`code_hash` (empreinte HMAC de tout code bien formé, connu ou non ; NULL seulement si le code est mal formé), adresse,
`at`, `result` ; écrite hors de la transaction d'enrôlement ; purge à 24 h ; sert aux limites (10 par code et par
heure, 30 refus par adresse et par heure ; ADR-117). Contrainte : `operator_id IS NULL OR code_hash IS NOT NULL`.
Un refus passe par `record_enrollment_refusal(code_hash, address, result, reason, serial, os, origin, request_id)`
(migration 0027) : essai et audit `DEVICE_ENROLLMENT_REFUSED` dans la chaîne du code ou de la plateforme, une seule
trace au-delà d'une limite.

## Historique des statuts (`device_status_history`)

`device_id`, `from_status`, `to_status`, `reason`, `actor_id`, `at` ; ajout seul.

## Fonctions (toutes `SECURITY DEFINER`, `search_path = public, pg_temp`)

| Fonction | Rôle |
|---|---|
| `create_device_enrollment_code(code_hash, event, pos, mode, personal_phone, ttl, actor)` | contrôles de portée et de mode, insertion |
| `enroll_device(code_hash, serial, os, app_version, public_key, agreement_key, cert_sha256, cert_not_after, attestation_kind, security_level, refresh_hash, refresh_expires)` | verrouille le code, contrôle expiration et mode, refuse un `serial` actif du même prestataire, crée le terminal (affectation et `personal_phone` du code), calcule `next_seq = max(last_seq de ce serial dans le prestataire) + 1`, pose `next_seq_floor`, consomme le code, crée la famille et le premier jeton ; rend `device_id`, `next_seq` |
| `rotate_device_refresh_token(token_hash, cert_sha256, new_hash, new_expires)` | échange ; verrou pris → refus « en cours » ; grâce de 60 s ; sinon réutilisation → famille révoquée ; statut vérifié |
| `revoke_device_token_family(device, family, reason)` | révocation |
| `set_device_status(device, to, reason, actor)` | transitions ci-dessus |
| `record_device_heartbeat(device, app_version, device_time)` | `last_seen_at`, `app_version` |
| `consume_device_nonce(device, nonce, created, tolerance_seconds)` | contrôle `created` contre `now()` de la base et la tolérance bornée (≤ 300 s) ; insertion ; doublon → refus |
| `assert_device_active(device)` | relit le statut `FOR SHARE` dans la transaction métier (R-14) |

## Erreurs normalisées utilisées

`ENROLLMENT_CODE_INVALID`, `ENROLLMENT_CODE_EXPIRED`, `ATTESTATION_FAILED`, `DEVICE_MODE_NOT_ALLOWED`,
`DEVICE_SUSPENDED`, `DEVICE_REVOKED`, `UNAUTHENTICATED`, `CONFLICT_STATE` (existants au contrat) ;
`CLOCK_SKEW_TOO_LARGE` (existant) ; `DEVICE_SIGNATURE_INVALID` (ajouté) ; refus d'un `serial` actif du même
prestataire : `409 DEVICE_SERIAL_IN_USE` (ajouté) ; échange de jeton en cours : `409 CONFLICT_STATE`.
