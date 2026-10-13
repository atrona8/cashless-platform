# Data model — mission bracelets-nfc-01M4TD3W

Le schéma de référence fournit déjà `media_batch`, `media`, `tag_key`, `tag_data_key`, `media_tap`, `media_assignment`,
`media_identity_history`, `media_status_history`, `media_transition`, `media_batch_transition`,
`media_batch_status_history`, `anomaly`, `device`, `wallet` et la vue `batch_inventory`. Ils ne sont pas modifiés dans
les fichiers générés ; les ajouts ci-dessous passent par migrations.

## Migration 0010 — rattachement (S19)

**`claim_code`** — un code imprimé d'un lot `PUBLIC`.

| Colonne | Type | Règle |
|---|---|---|
| `id` | uuid | clé |
| `operator_id` | uuid | prestataire, RLS |
| `batch_id` | uuid | lot ; seul un lot `PUBLIC` a des codes |
| `code_hash` | bytea (32) | empreinte à clé du code normalisé ; unique par prestataire |
| `media_id` | uuid, NULL | bracelet associé ; NULL jusqu'à la personnalisation ; unique |
| `associated_at` | timestamptz, NULL | présent si et seulement si `media_id` l'est |
| `invalidated_at` | timestamptz, NULL | posé à la clôture du lot pour un code jamais associé |

**`media`** (colonnes ajoutées) : `claim_code_hash` bytea (32) unique par prestataire, `claim_code_used_at`
timestamptz, `claim_attempts` int ≥ 0.

**`media_batch`** (colonne ajoutée) : `claim_codes_issued_at` timestamptz — le fichier de commande n'est produit
qu'une fois.

**`media_claim`** — demande en attente.

| Colonne | Type | Règle |
|---|---|---|
| `id`, `operator_id` | uuid | RLS |
| `media_id`, `wallet_id` | uuid | bracelet et portefeuille anonyme visés |
| `customer_id` | uuid | compte demandeur |
| `status` | text | `PENDING`, `CONFIRMED`, `EXPIRED`, `CANCELLED` |
| `confirmation_hash` | bytea (32) | empreinte à clé du code à 6 chiffres |
| `attempts` | int | 0 à 5 ; à 5, la demande ne peut plus être confirmée |
| `expires_at` | timestamptz | création + 24 h |
| `confirmed_device_id`, `confirmed_by`, `confirmed_at` | | terminal, agent, date |

Invariants en base : au plus 3 demandes `PENDING` non expirées par bracelet ; une seule `CONFIRMED` par bracelet et
par rattachement ; confirmer une demande annule les autres `PENDING` du bracelet, dans la même transaction.

**`claim_attempt`** — trace d'un essai : `operator_id`, `customer_id` NULL, `device_ref` texte, `attempted_at`,
`outcome` (`OK`, `PENDING_CREATED`, `REFUSED`, `BLOCKED`). Sert aux limites (5 par compte et par heure, 20 par
appareil et par jour). En ajout seul.

Fonctions (INVOKER sauf mention) : `issue_claim_codes(lot, empreintes[])`, `associate_claim_code(empreinte, bracelet)`,
`claim_media(empreinte, compte, appareil)` qui rend `ATTACHED`, `PENDING` ou `REFUSED` sans distinguer inconnu et
utilisé, `confirm_media_claim(demande, bracelet, empreinte du code, terminal, agent)`, `invalidate_unassociated_codes(lot)`.

## Migration 0011 — rôle PERSONALIZER et actions à deux

- `role_assignment_role` : ajout de `PERSONALIZER`, portée `OPERATOR` seulement.
- `approval_request_action_check` : ajout de `TAG_KEY_CREATE`, `TAG_DEK_ROTATE`, `TAG_KEY_RETIRE`, `MEDIA_REINSTATE`.
  Toutes sont de portée prestataire (jamais plateforme).

## Migration 0012 — travaux de clé et contrôle quotidien

**`tag_key_job`** : `id`, `operator_id`, `key_index`, `kind` (`CREATE_KEY`, `CREATE_DEK`, `ROTATE_DEK`, `REENCRYPT`, `RETIRE_KEY`,
`DISABLE_KMS_KEY`), `status` (`PENDING`, `RUNNING`, `DONE`, `FAILED`), `payload` jsonb (sans secret), `progress` jsonb,
`attempts`, `last_error`, `approval_request_id`, `created_at`, `finished_at`. Un seul travail non terminé par
(prestataire, index, sorte). Pris par `FOR UPDATE SKIP LOCKED`.

**`tag_key_check_run`** : `id`, `operator_id`, `started_at`, `sampled`, `mismatches`, `status` (`OK`, `MISMATCH`,
`ERROR`). Un écart ouvre une anomalie ; la sorte d'anomalie à utiliser est arrêtée au lot concerné (liste fermée de
§12.2 : si aucune ne convient, la contradiction est signalée au porteur plutôt que d'en ajouter une en silence).

## Migration 0013 — fonctions d'appui de l'API

- `register_personalized_media(lot, empreinte de l'identité, UID, empreinte de la signature, signature valide, chiffré,
  clé de données)` : insère le bracelet au statut `PERSONALIZED`, refuse au-delà de la quantité du lot, une signature
  invalide, une clé non active, un UID déjà connu.
- `set_media_batch_status(lot, statut, motif)` : passage de statut par la table des passages.
- `blacklist_media(bracelet, motif)`, `suspend_media(bracelet, motif)` : passages `BLACKLISTED` et `SUSPENDED` tracés.
- `media_summary(bracelet)` : lecture sans colonne secrète.

Ces fonctions n'ajoutent aucune règle métier nouvelle : elles regroupent des écritures que la base contrôle déjà par
ses déclencheurs, pour que chaque rôle de base n'ait que les droits nécessaires.

## Rôles de base (`post-roles.sql`)

| Rôle | Processus | Lit | Écrit |
|---|---|---|---|
| `cashless_app` | API publique | tout sauf `media.pwd_pack_enc`, `media.pwd_pack_dek_id`, `tag_data_key.encrypted_dek`, `offline_snapshot_rows` | comme avant, sauf insertion dans `media`, `tag_key`, `tag_data_key` ; insère des `tag_key_job` |
| `cashless_tagkeys` | clés de bracelet | `media` (dont le chiffré), `tag_key`, `tag_data_key`, `device`, `tag_key_job` | `media.pwd_pack_enc` et `pwd_pack_dek_id` (rechiffrement), `tag_data_key.status`, `tag_key_job` |
| `cashless_perso` | personnalisation | `media_batch`, `tag_key`, `tag_data_key`, `claim_code`, `tag_key_job` | `media` (insertion par fonction), `tag_key`, `tag_data_key`, `claim_code` (association), `tag_key_job`, audit |
| `cashless_tagcheck` | contrôle quotidien | `media` (dont le chiffré), `tag_key`, `tag_data_key` | `tag_key_check_run`, `anomaly` |
| `cashless_keyadmin` | commande d'administration des clés | `tag_key`, `tag_key_job` | `tag_key` (insertion, `kms_disabled_at`, statut), `tag_key_job`, audit |

Chaque rôle a ses politiques RLS permissives et restrictives par table, sur le modèle de `cashless_platform`
(mission 3). Aucun de ces rôles n'a de droit sur `journal_transaction`, `posting` ni `account_balance`.

## Cycles de vie (rappel, inchangés)

- Lot : `ORDERED → PERSONALIZED → DELIVERED → ACTIVE ⇄ SUSPENDED → CLOSED` (table `media_batch_transition`).
- Bracelet : table `media_transition` du schéma, qui fait foi.
- Demande en attente : `PENDING → CONFIRMED | EXPIRED | CANCELLED`.
- Travail de clé : `PENDING → RUNNING → DONE | FAILED` ; `FAILED → PENDING` à la relance.
