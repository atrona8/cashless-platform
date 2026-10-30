# Contrat : snapshots hors ligne

Sources : `sync_protocol.md` §4, `openapi.yaml` (`getOfflineSnapshot`, `ackOfflineSnapshot`, `OfflineSnapshot`,
`SnapshotHeader`, `WrappedKey`), research R-04 à R-09.

## Production (R-30.8 : `snapshot-content` prépare, `snapshot-signer` signe et publie)

1. Boucle de 1 s. Pour chaque grand livre d'un événement non `LOCKED` ayant au moins un terminal éligible : lire les
   curseurs (historiques de statut du bracelet, du lot, du portefeuille ; `posting.id`).
2. Changement bloquant → nouvelle version immédiate ; autre changement → nouvelle version si 60 s depuis la dernière ;
   `FULL` toutes les heures ou si le `DELTA` dépasse 20 % des entrées ; première version d'un grand livre : `FULL`.
3. `snapshot-content`, hors transaction : source (`offline_snapshot_source_delta` pour un `DELTA`, recouvrement 5 s ;
   complète pour un `FULL`) ; différences avec `offline_snapshot_state` ; `K_v = generateDataKey` ; déchiffrement des
   `pwd_pack_enc` (clé de données via `DecryptPort`, AAD `CASHLESS/PWDPACK/v1`) et chiffrement sous `K_v` (AAD
   `CASHLESS/SNAPPWD/v1`) ; `pwd_pack_sha256` ; enveloppes des terminaux `ACTIVE` ; effacement de `K_v` et des mots de
   passe. Puis transaction courte : `save_offline_snapshot_draft` (version réservée sous verrou, entrées par paquets).
4. `snapshot-signer` : brouillon `READY` → recalcul de `content_sha256` depuis les entrées, vérification de l'en-tête,
   signature `SignPort` (clé `ACTIVE`), `publish_offline_snapshot(draft, signature, key_id)` (en-tête recalculé par
   la base). Version de maintien (`DELTA` vide) à `valid_until/3`.
5. Terminal devenu éligible (`ACTIVE`, clé d'accord nouvelle) : enveloppes pour le dernier `FULL` et les versions
   postérieures (`K_v` rouverte par `DecryptPort`).
6. Aucune clé `ACTIVE`, échec KMS ou de signature : rien de publié, alarme (code 3).

## En-tête signé (`SnapshotHeader`, 15 champs, tous présents)

`format = "CASHLESS-SNAPSHOT/v1"`, `kind`, `operator_id`, `ledger_id`, `event_id`, `currency`, `version`,
`base_version` (nul pour `FULL`, version précédente pour `DELTA`), `generated_at`, `valid_until`
(`generated_at + max_snapshot_age` du plafond du prestataire, 15 min par défaut), `entries`, `removed`,
`content_sha256` (hex), `authority_epoch`, `key_id`. Signature : ECDSA P-256 / SHA-256 sur `JCS(header)`, **DER**,
base64 standard.

## Contenu

- `content_sha256 = SHA-256(JCS({"entries": [...], "removed_token_hashes": [...]}))` : deux clés toujours présentes,
  entrées sans `pwd_pack_enc`, triées par `token_hash` hex croissant, `null` gardé ; `removed_token_hashes` trié.
- Entrée : `token_hash, nfc_uid, key_index, originality_sig_sha256, status, batch_event_id, batch_status,
  wallet_status, spendable, last_counter, pwd_pack_sha256` (signés) et `pwd_pack_enc` (objet `EncryptedBlob`
  `{nonce, ciphertext, tag}` en base64, `openapi.yaml` prime ; nul si aucun ; hors empreinte, lié par
  `pwd_pack_sha256` = SHA-256 de nonce ‖ chiffré ‖ tag, 34 octets).
- `pwd_pack_key` (`WrappedKey`) : `{alg: "ECDH-ES+HKDF-SHA256+A256GCM", epk, iv, wrapped_key}`, construction
  `sealForRecipient` de `@cashless/tag-format`, AAD `CASHLESS/SNAPKEY/v1 ‖ ledger_id ‖ version ‖ device_id`. Requise
  dès qu'une entrée porte un mot de passe. Vecteurs fixes livrés (`packages/tag-format/test/snapshot-vectors.json`).
- Le terminal conserve avec chaque entrée la clé de la version qui l'a apportée.

## `GET /offline-snapshots/current?since_version=`

| Cas | Réponse |
|---|---|
| Hors ligne interdit (politique effective), terminal sans événement, `personal_phone` ; aucune clé de signature `ACTIVE` (détail `SNAPSHOTS_UNAVAILABLE`) | `403 OFFLINE_NOT_ALLOWED` |
| Terminal `SUSPENDED` | `403 DEVICE_SUSPENDED` |
| `If-None-Match` égal à l'`ETag` courant | `304` |
| Plus de 5 pas entre `b` et la dernière, ou `FULL` plus récent que `b` | dernier `FULL` |
| Aucune version encore produite, ou enveloppe pas encore prête pour ce terminal | `409 CONFLICT_STATE`, `Retry-After: 2` |
| Sans `since_version`, version inconnue, ou antérieure au plus ancien contenu conservé | dernier `FULL` |
| `since_version = b` conservée, `b` < dernière | artefact de version suivant `b` (`DELTA` de base `b`, ou `FULL`) |
| `since_version` = dernière | dernier artefact |

En-têtes : `X-Snapshot-Latest` (dernière version du grand livre), `ETag` =
`"<ledger>:<version>:<device>:<empreinte clé d'accord>"`, `Cache-Control: private, no-store`, `Content-Encoding: gzip`
si demandé. Le terminal redemande tant que la version reçue < `X-Snapshot-Latest`.
Lecture par `offline_snapshot_for_device` : seule l'enveloppe du terminal appelant est rendue.

## `POST /offline-snapshots/ack`

Corps `{version, content_sha256}` → `ack_offline_snapshot` : version enveloppée pour ce terminal et empreinte égale,
sinon `409 SNAPSHOT_VERSION_UNKNOWN` ; `last_snapshot_version` ne recule jamais ; `204` idempotent.

## Configuration et battement de cœur

`DeviceConfig.snapshot_keys` : clés `ACTIVE` et `RETIRED` non révoquées du signataire central (≤ 2), `{key_id,
algorithm: "ECDSA_P256_SHA256", public_key (SPKI DER base64), not_after}`. `heartbeat.latest_snapshot_version` =
dernière version du grand livre du terminal ; `sync_requested` = événement en `CLOSING`.

## Garde de production

Le faux `SignPort` (et tout faux du processus) fait refuser le démarrage en production (`createKms`,
`assertProcessIsSafe`) : aucun snapshot n'est servi en production avant la mission 12b (dette nommée).
