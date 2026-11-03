---
work_package_id: WP12
title: 'Processus snapshot-content : chiffrement des mots de passe et enveloppes par terminal'
dependencies: [WP04, WP11]
requirement_refs:
- FR-010
- NFR-007
planning_base_branch: feat/hors-ligne-snapshots-lots
merge_target_branch: feat/hors-ligne-snapshots-lots
branch_strategy: Planning artifacts for this mission were generated on feat/hors-ligne-snapshots-lots. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/hors-ligne-snapshots-lots unless the human explicitly redirects the landing branch.
base_branch: kitty/mission-hors-ligne-snapshots-lots-01M645RN
base_commit: 87169a1ba7c18327f3535e495ecd26df5aa7d006
created_at: '2026-11-03T11:19:26.186258+00:00'
subtasks: [T049, T050, T051, T052]
phase: Phase 2 - Ports et processus
agent: claude
history:
- timestamp: '2026-10-30T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/snapshots-content/crypto/
create_intent: [apps/api/src/snapshots-content/crypto/snapshot-entry-encryptor.ts, apps/api/src/snapshots-content/crypto/snapshot-key-wrapper.ts, apps/api/src/snapshots-content/crypto/device-wrapping.worker.ts, apps/api/src/snapshots-content/crypto/snapshot-crypto.module.ts, packages/tag-format/test/snapshot-vectors.json, packages/tag-format/test/snapshot-envelope.spec.ts, apps/api/test/unit/snapshots-content/crypto-encryptor.spec.ts, apps/api/test/unit/snapshots-content/crypto-zeroize.spec.ts, apps/api/test/integration/snapshots-content/secrets-sweep.spec.ts, apps/api/test/integration/snapshots-content/secrets-envelope.spec.ts]
execution_mode: code_change
model: sonnet
owned_files: [apps/api/src/snapshots-content/crypto/**, packages/tag-format/src/device-envelope.ts, packages/tag-format/test/**, apps/api/test/integration/snapshots-content/secrets*.spec.ts, apps/api/test/unit/snapshots-content/crypto*.spec.ts]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP12 – snapshot-content : chiffrement et enveloppes

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude). Lis ensuite la fiche de contexte d'implémentation fournie par
l'orchestrateur, ce prompt, puis seulement : `research.md` R-08, R-30.8, R-30.9 ; `contracts/
interfaces.md` § 3 (`offline_snapshot_keys_to_wrap`, `wrap_offline_snapshot_key`) et § 8 (ligne
« Enveloppe de snapshot ») ; `contracts/snapshots.md` (« Contenu », `pwd_pack_key`) ; `spec.md` FR-010,
NFR-007 ; le fichier `tasks/WP11-snapshot-content-cadence.md` (interface `EntryEncryptor`).
Priorité des sources (SPECIFICATION §0.3) : contradiction signalée, jamais choisie en silence.
Ne modifie jamais un `.sql` généré de `packages/ledger-sql/`.

## Objective

Donner au processus `snapshot-content` sa partie secrète : rouvrir chaque `pwd_pack_enc` de la source
(clé de données via `DecryptPort`), le rechiffrer sous une clé de contenu `K_v` propre à la version
(`DataKeyPort`), calculer `pwd_pack_sha256`, puis envelopper `K_v` pour chaque terminal `ACTIVE`
(`sealForRecipient`). Aucun mot de passe ni `K_v` en clair ailleurs qu'en mémoire, le temps de servir, puis
mis à zéro. **Lot de cryptographie : relecture humaine obligatoire.**

## Périmètre et arbitrages

Dans le lot : AAD et correspondance `WrappedKey` dans `@cashless/tag-format`, vecteurs fixes,
`SnapshotEntryEncryptor` (branché sur le jeton `ENTRY_ENCRYPTOR` de WP11), travailleur d'enveloppes,
tests de secret. Hors lot : cadence et brouillon (WP11), signature (WP13), service HTTP (WP15),
`TestTerminal` (WP18, qui ouvrira l'enveloppe plus tard ; ici on l'ouvre avec `openForRecipient`).
Décisions : R-08 (AAD `CASHLESS/SNAPPWD/v1` et `CASHLESS/SNAPKEY/v1`), R-30.9 (enveloppes pour les
terminaux `ACTIVE` seulement, dernier `FULL` et versions postérieures, `pwd_pack_sha256` dans le contenu
signé), R-30.8 (`snapshot-content` détient `DecryptPort` et `DataKeyPort`, rien d'autre).
Rappel de délais : calcul, chiffrement et appels KMS hors transaction (R-30.6).

## Subtasks

### T049 – AAD de snapshot et vecteurs fixes

Fichier : `packages/tag-format/src/device-envelope.ts` (`deviceAad` `:26`, `stationAad` `:36`,
`sealForRecipient` `:55`, `openForRecipient` `:89`). Exporté par `src/index.ts` déjà.
- `snapshotKeyAad(ledgerId: string, version: bigint, deviceId: string): Buffer` = `"CASHLESS/SNAPKEY/v1"`
  ‖ ledger (16 o, `uuidToBytes`) ‖ version (8 o gros-boutiste, `writeBigUInt64BE`) ‖ device (16 o).
- `snapshotPwdAad(ledgerId, version: bigint, tokenHash: Uint8Array, nfcUid: Uint8Array): Buffer` =
  `"CASHLESS/SNAPPWD/v1"` ‖ ledger ‖ version ‖ token_hash (32 o) ‖ nfc_uid (7 o, `assertUid`). Longueurs
  vérifiées (`requireLength`) ; version négative ou > 2^64−1 refusée.
- Correspondance avec le contrat `WrappedKey` (`{alg: "ECDH-ES+HKDF-SHA256+A256GCM", epk, iv,
  wrapped_key}`, corrigé par WP01 ; l'actuel `A256KW` est faux) : `toWrappedKey(blob: EncryptedBlob)` et
  `fromWrappedKey(key)` : `epk` inchangé (base64url), `iv = nonce`, `wrapped_key = base64(ciphertext ‖ tag)`.
  La forme exacte n'est écrite nulle part : la fixer ici, la signaler à l'orchestrateur et à WP01/WP15.
- Vecteurs : `test/snapshot-vectors.json` produits HORS du code testé par un script Python indépendant
  (bibliothèque `cryptography`) : octets des deux AAD pour des entrées fixes, et UNE enveloppe complète
  (clé privée P-256 fixe, `K_v` fixe, éphémère fixe) que `openForRecipient` doit ouvrir. Le script n'est pas
  du code testé ; le garder sous `packages/tag-format/test/` en commentaire d'en-tête du JSON.
- Critère : `snapshot-envelope.spec.ts` rejoue les vecteurs ; `deviceAad` et les vecteurs existants
  (`vectors.ts`, `cross-impl.spec.ts`) restent identiques.

### T050 – Chiffrement sous `K_v`, `pwd_pack_sha256`, effacement

Fichier : `snapshots-content/crypto/snapshot-entry-encryptor.ts`, implémente `EntryEncryptor` (WP11).
Modèle de lecture : `media/auth-keys/auth-keys.service.ts:89-132` (`DekCache.withKey`, `openPwdPack`
avec `pwdPackAad`, `zeroize` en `finally`), `media/keys/dek-cache.ts:18`, `kms/zeroize.ts`.
- Pour chaque ligne portant `pwd_pack_enc` : lire la clé de données chiffrée (`DataKeyRepository.
  encrypted`, `media/keys/data-key.repository.ts`, dans `tx.run(operatorId)`) en vérifiant que les
  colonnes lues sont dans la liste accordée (R-30.12) ; `DecryptPort.decrypt` via `DekCache.withKey` (un
  déchiffrement par clé de données, pas par bracelet) ; `openPwdPack({dek, blob, aad: pwdPackAad({mediaId,
  operatorId, keyIndex, uid})})` ; chiffrer avec `sealPwdPack({dek: K_v, nonce: 12 o aléatoires,
  pwdPack, aad: snapshotPwdAad(ledger, version, tokenHash, nfcUid)})` ; `pwd_pack_sha256 =
  SHA-256(pwd_pack_enc)` posé dans `entry` (hex). Entrée sans mot de passe : `pwd_pack_enc` et
  `pwd_pack_sha256` nuls.
- `K_v` : `DataKeyPort.generateDataKey(config.tagWrappingKeyRef)` ; `encrypted` rendu comme
  `contentKeyWrapped` (colonne `content_key_wrapped`). Un `K_v` par version, jamais réutilisé. `K_v` et
  chaque `pwdPack` sont mis à zéro (`zeroize`) dès l'usage, y compris en cas d'erreur (`finally`).
- Hors transaction : aucun appel KMS ni calcul dans une transaction. Un bracelet dont la clé de données
  est `RETIRED` ou dont l'ouverture échoue : entrée sans mot de passe + erreur nommée sans secret (pas de
  repli en clair). `KmsUnavailableError` : remonte telle quelle (alarme 3 de WP11).
- Brancher : `SnapshotCryptoModule` fournit `ENTRY_ENCRYPTOR` ; l'import et le remplacement de
  l'implémentation provisoire de WP11 passent par une retouche hors carte de `snapshots-content/
  snapshot-content.module.ts` (propriété de WP11), une ligne de rapport.
- **Point bloquant, à soumettre à l'orchestrateur avant de coder ce sous-lot** : la `version` entre dans
  l'AAD du chiffré, donc dans `pwd_pack_sha256`, donc dans `content_sha256` de l'en-tête ; mais
  `save_offline_snapshot_draft` réserve la version et ne rend que l'id du brouillon (`interfaces.md`
  § 3). On ne peut pas chiffrer avant de connaître la version. Proposition : la fonction rend aussi la
  version (ou une réservation préalable `RESERVED` complétée ensuite). Coder `encrypt(ledger, version, rows)`
  avec la version en paramètre ; le raccord attend la réponse (une migration de WP03 serait à rouvrir).
- Critère : un mot de passe chiffré se rouvre avec `K_v` et l'AAD (test), jamais sans.

### T051 – Enveloppes par terminal

Fichiers : `crypto/snapshot-key-wrapper.ts`, `crypto/device-wrapping.worker.ts` (`ProcessWorker`, nom
`snapshot-wrapping`, modèle `daily-check.worker.ts:13`, inscrit au `WorkerRegistry`).
- Boucle : `offline_snapshot_keys_to_wrap(p_limit)` (terminaux `ACTIVE`, clé d'accord courante, versions ≥
  dernier `FULL` publié, sans enveloppe) → pour chaque ligne : vérifier `agreement_key_sha256 ==
  SHA-256(agreement_public_key)` ; rouvrir `K_v` (`DecryptPort.decrypt(config.tagWrappingKeyRef,
  content_key_wrapped)`) ; `sealForRecipient({recipientPublicKey: agreement_public_key, plaintext: K_v, aad:
  snapshotKeyAad(ledger, version, device)})` ; `toWrappedKey` ; `wrap_offline_snapshot_key(ledger, version,
  device, agreement_key_sha256, envelope)` ; `zeroize(K_v)`. Regrouper par (ledger, version) : un
  déchiffrement KMS par version, pas par terminal.
- Terminal devenu éligible (ACTIVE, clé d'accord nouvelle) : couvert par la même requête (dernier `FULL` et
  versions postérieures). Terminal `SUSPENDED` ou `REVOKED` : jamais de ligne (R-30.9) ; test.
- La base refuse (`wrap_…` : terminal non `ACTIVE`, clé périmée) : ignorer, le prochain passage relit ;
  pas d'alarme. Idempotent : rejouer ne duplique rien.
- Limite connue à signaler : `content_key_wrapped` ne porte pas la référence de la clé d'emballage ;
  la réouverture utilise la référence COURANTE de la configuration. Après une rotation de cette clé, les
  versions plus anciennes ne seraient plus rouvrables. À consigner (rapport), pas à contourner seul.
- Critère : un terminal `ACTIVE` reçoit une enveloppe qu'il ouvre (`openForRecipient` + `fromWrappedKey`)
  et qui déchiffre un `pwd_pack_enc` de la version.

### T052 – Tests de secret

- `secrets-sweep.spec.ts` : bracelet de test dont le mot de passe est un CANARI reconnaissable (6 octets
  distincts, ex. `c4 a5 5e 7f 01 99`) ; produire un `FULL` ; balayer TOUTES les colonnes texte et `bytea`
  (hex, base64, base64url, octets) des tables `offline_snapshot*`, de `audit_event`, des journaux capturés
  (`console.*`, journal Nest) : le canari n'apparaît nulle part en clair. Un contrôle positif (le canari
  posé volontairement dans une table témoin) PROUVE que le balayage le trouve.
- `secrets-envelope.spec.ts` : l'enveloppe du terminal s'ouvre avec sa clé privée ; l'autre terminal (autre
  clé d'accord, autre `device_id` dans l'AAD) ne l'ouvre pas ; un terminal suspendu ou révoqué n'a aucune
  enveloppe ; une enveloppe d'une ancienne clé d'accord n'est plus écrite.
- `crypto-zeroize.spec.ts` : avec un `DecryptPort`/`DataKeyPort` espion qui garde les tampons rendus, ces
  tampons sont entièrement à zéro après `encrypt`, y compris quand une ligne échoue.
- `crypto-encryptor.spec.ts` : AAD liée à la version et au bracelet (changer l'un des deux casse le
  déchiffrement), nonces distincts, `pwd_pack_sha256` = SHA-256 du chiffré, entrée sans mot de passe.

## Sécurité

- **À faire relire par une personne** (règle 4) : `packages/tag-format/src/device-envelope.ts`,
  `crypto/snapshot-entry-encryptor.ts`, `crypto/snapshot-key-wrapper.ts`, `crypto/device-wrapping.worker.ts`.
- Aucun repli en clair, aucune clé ni mot de passe dans un message d'erreur, une trace ou une réponse ;
  `K_v` jamais enveloppée pour un terminal non `ACTIVE`.
- `DekCache` garde la clé de données en mémoire jusqu'à `tagDekCacheSeconds` : acceptable (même règle que
  le processus des clés de bracelet) ; ne pas l'allonger. Tout élargissement (port, droit de base, durée)
  est un écart soumis au porteur avant codage (règle 1 de `CLAUDE.md`).
- `HKDF` : sel vide et `info` = AAD (contrat de `sealForRecipient`) ; ne pas modifier l'existant, ajouter
  seulement. Les vecteurs de `deviceAad` et de `stationAad` doivent rester identiques.

## Tests

- `packages/tag-format` : `npx jest` dans le paquet (vecteurs, AAD, aller-retour de `WrappedKey`).
- `apps/api` : `npx jest test/unit/snapshots-content/crypto` ; intégration `secrets*.spec.ts` en base de lot
  `cashless_wp12` (l'orchestrateur relance en série ; le lot ne lance pas Jest sur `cashless_test`).

## Ce que le relecteur doit casser

1. Chiffrer deux mots de passe de deux bracelets avec le même nonce : le test de nonces doit échouer.
2. Changer `version` d'un octet dans l'AAD : le déchiffrement échoue.
3. Rejouer le balayage avec le canari en hexadécimal, en base64 et sur un `bytea` : trouvé par le contrôle
   positif, absent des tables réelles.
4. Faire échouer `wrap_offline_snapshot_key` à mi-chemin : pas de `K_v` laissée dans un tampon vivant.
5. Un terminal dont la clé d'accord change entre `keys_to_wrap` et `wrap` : enveloppe refusée, relue ensuite.
6. Ouvrir l'enveloppe d'un terminal A avec la clé de B : `AUTH_FAILED`.
7. Un bracelet à clé de données `RETIRED` : aucune fuite en clair, entrée sans mot de passe + erreur nommée.
8. Les vecteurs Python et le TypeScript divergent d'un octet : le test de vecteur échoue.

## Definition of Done

- [ ] `snapshotKeyAad`, `snapshotPwdAad`, `toWrappedKey`, `fromWrappedKey` ; vecteurs indépendants.
- [ ] Chiffrement sous `K_v`, `pwd_pack_sha256`, effacement vérifié par test.
- [ ] Enveloppes pour terminaux `ACTIVE` seulement ; terminal devenu éligible couvert ; idempotent.
- [ ] Balayage avec canari et contrôle positif ; enveloppe ouvrable.
- [ ] Point bloquant (version avant chiffrement) et forme `WrappedKey` soumis à l'orchestrateur.
- [ ] Fichiers à relire par une personne listés dans le rapport.
- [ ] Lignes de 100 caractères au plus ; aucun `.sql` généré modifié.

## Branch Strategy

- Branche de planification et de fusion : `feat/hors-ligne-snapshots-lots`.
- Worktree par lane, calculée dans `lanes.json`.
- Commande : `spec-kitty agent action implement WP12 --agent claude --mission
  hors-ligne-snapshots-lots-01M645RN`.

## Activity Log

- 2026-10-30T12:00:00Z – claude – Prompt generated via /spec-kitty.tasks
