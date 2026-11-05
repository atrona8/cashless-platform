# R-protocole : protocole et contrat, mission 7 (hors-ligne-snapshots-lots-01M645RN)

Sources lues en entier ou ciblées : `docs/sync_protocol.md` (933 lignes), `packages/contracts/openapi.yaml`
(routes 1049-1147, 3889-4262, schémas 11188-11300, 11845-11885, 12107-12120, 12191-12225, 13265-13700, 14270-14295),
`docs/SPECIFICATION.md` §9.1-9.6 (lignes 940-1027), `docs/POINTS_OUVERTS.md` (OP-N13, N41, N73), `docs/DECISIONS_ADR.md`
(ADR-128, ADR-132), `scenario_reference.json` (transaction 22), et, pour juger de la faisabilité,
`packages/ledger-sql/schema_grand_livre_cashless.sql` (lignes cités), `apps/api/src/payments/device-seq-registry.ts`,
`apps/api/src/kms/kms.ports.ts`. Rien n'a été exécuté. Les références `§` sans fichier sont celles de `sync_protocol.md`.

---

## 1. Résumé opérationnel du protocole utile au serveur

### 1.1 Snapshot (§4, SPEC §9.4)

**Fait vérifié.**

- Contenu : une entrée par rattachement ouvert de la vue `offline_snapshot_rows` (schéma:2354-2372 environ ; une ligne
  par `media_assignment` sans `released_at`) : `token_hash, nfc_uid, key_index, originality_sig_sha256, status,
  batch_event_id, batch_status, wallet_status, spendable, last_counter, pwd_pack_enc` (§4.1-1). `spendable` = solde
  PAID + PROMO du portefeuille de la devise du grand livre (la vue le calcule).
- En-tête `SnapshotHeader` (§4.1-2, openapi:13327) : `format` (= `CASHLESS-SNAPSHOT/v1`), `kind` (`FULL`|`DELTA`),
  `operator_id, ledger_id, event_id, currency, version, base_version` (null pour FULL), `generated_at, valid_until,
  entries, removed, content_sha256, authority_epoch, key_id`. Les 15 champs sont tous requis.
- Signature (§4.1-2) : sur `JCS(header)` entier (RFC 8785), algorithme donné par `key_id` : `ECDSA_P256_SHA256` par
  défaut, `Ed25519` permis par le schéma (`snapshot_signing_key.algorithm`, schéma:2295). OP-N13 : ECDSA P-256
  (`ECC_NIST_P256`). Clé privée dans le KMS (§4.1-5) ; ici simulée (décision `01M645SWY4PETSJE3PJ7YXKYTP`).
- Empreinte de contenu (§4.1-3) : `content_sha256 = SHA-256(JCS({entries sans pwd_pack_enc, removed_token_hashes}))`.
- Mots de passe (§4.1-4) : `pwd_pack_enc` en AES-256-GCM, clé de contenu propre à la version, AAD =
  `"CASHLESS/SNAPPWD/v1" ‖ ledger_id ‖ version ‖ token_hash ‖ nfc_uid`. La clé de contenu est enveloppée par terminal,
  « ECDH-ES P-256 sur sa clé d'accord » (`device.agreement_public_key`, 65 octets, point non compressé, schéma:173).
  Le contrat précise l'enveloppe : `WrappedKey.alg = ECDH-ES+HKDF-SHA256+A256KW`, champs `epk` (base64url) et
  `wrapped_key` (openapi:12209). Ce n'est donc ni HPKE ni JWE standard (voir §4, C-A).
- Un terminal révoqué ne reçoit plus de clé de contenu (§4.1-4). Au plus deux clés publiques valides par signataire dans
  `config.snapshot_keys` (§4.1-5) ; le schéma n'autorise qu'une clé `ACTIVE` par signataire (index unique, schéma:2307).
- FULL/DELTA (§4.2) : `version` strictement croissante par grand livre ; DELTA porte `base_version` ; le terminal ne
  l'applique que si `base_version` = sa version locale, sinon il demande un FULL (sans `since_version`). Le déclencheur
  `check_offline_snapshot` (schéma:2314-2350) impose : version > max existante, DELTA sur une version de base déjà
  inscrite, `authority_epoch` = époque courante du grand livre (sinon `CL015`), clé `ACTIVE` de propriétaire `CENTRAL`,
  en-tête identique aux colonnes (mais `removed` n'est pas contrôlé, et il n'y a pas de colonne `removed`).
- Cadence (§4.2-1) : DEVRAIT 60 s si changement ; DOIT ≤ 5 s après un statut bloquant (bracelet `SUSPENDED`,
  `BLACKLISTED`, `REPLACED`, `RETIRED` ; lot non `ACTIVE` ; portefeuille `BLOCKED`).
- Fraîcheur (§4.3), côté terminal : `âge_max = min(policy.max_snapshot_age_seconds, valid_until − generated_at)`.
  Côté serveur, `SNAPSHOT_TOO_OLD` se juge avec la même formule (§7.2).
- Accusé (§4.2-4) : `POST /offline-snapshots/ack {version, content_sha256}` ; `device.last_snapshot_version`.
- Terminal sans droit au hors ligne : `403 OFFLINE_NOT_ALLOWED` (§4 chapeau, openapi:3901).

### 1.2 Lot (§3, §6, §10)

- En-tête signé (`OfflineBatchHeader`, openapi:13507) : `batch_id, device_serial, ledger_id, authority_epoch, seq_from,
  seq_to, count (1-500), created_at, device_time_at_send (facultatif), prev_chain_hash, last_chain_hash`.
  Signature : ECDSA P-256 de la clé Keystore du terminal (`device.public_key`), sur `JCS(header)` (§10.3, openapi:13555).
  Vérifiée par le serveur avant tout traitement : `400 BATCH_SIGNATURE_INVALID`, lot non traité.
  Une signature n'est PAS portée par opération : le terminal signe l'en-tête, et l'en-tête engage les opérations
  uniquement par `prev_chain_hash`/`last_chain_hash` (§9.5-5).
- Clé d'opération (§0, §7.1-1) : `<serial>:<seq>`, seq en décimal, 4 chiffres au moins, jamais tronqué.
- Empreinte d'une opération (§3.3) : `content_sha256 = SHA-256(JCS(champs chaînés))`, champs chaînés = `seq, type,
  occurred_at, amount, currency, tap, lines, reverses_seq, reverses_transaction_id, online_operation, void_reason`
  (absents = omis). Champs d'état hors empreinte : `online_status, online_transaction_id, online_tap_id,
  snapshot_version, config_id, local_available_before, clock, état_local`.
- Chaîne (§3.3) : `chain_hash(n) = SHA-256(chain_hash(n−1) ‖ content_sha256(n))`, octets bruts ;
  `chain_hash(0) = SHA-256("CASHLESS/CHAIN/v1" ‖ device_id)`, `device_id` = 16 octets bruts (schéma:1973-1977,
  `chain_step`, `device_chain_genesis`). Après ré-enrôlement : `last_chain_seq = next_seq_floor − 1`, `last_chain_hash`
  = genèse.
- Raccord (§3.3, schéma:2183-2262 `open_offline_batch`) : recalcul depuis `prev_chain_hash`, doit aboutir à
  `last_chain_hash` ; sinon `BROKEN`. Puis `k = last_chain_seq − seq_from + 1` : `k<0` → `PENDING` (lot antérieur
  manquant) ; `k≥n` → `RESENT` ; sinon comparaison de `hs[k+1]` avec `device.last_chain_hash` (ou genèse si
  `last_chain_seq = 0`) → `VERIFIED`|`BROKEN`|`UNVERIFIABLE` (après un numéro levé). `BROKEN` : lot inscrit `REJECTED`
  (`CHAIN_BROKEN`) + anomalie, et le contrat dit `409 CHAIN_BROKEN`.
- Tailles et cadence (§6.1) : 500 opérations et 1 Mio ; un seul lot en vol ; `Idempotency-Key` = `batch_id` ;
  `seq_from` = plus petit numéro non `ACKED`.
- Borne (§6.1-6) : dernier numéro > `contiguous_acked_seq + 10 000` → `409 SEQ_OUT_OF_RANGE` (`CL021`), rien traité,
  pas d'anomalie.
- Trou à l'intérieur du lot : `400 SEQ_OUT_OF_ORDER` avant tout traitement (§6.3-1). Lot après un trou : traité, `missing_seqs`,
  anomalie `SEQ_GAP` (montant 0) par numéro manquant (§6.3-2, créée par `open_offline_batch`).
- Un lot concurrent : `409 BATCH_IN_PROGRESS` (`CL010`). Lot `PROCESSING` > 15 min : `REJECTED`/`ABANDONED` à l'ouverture
  du suivant (§6.2-6) ; `GET` répond alors `200` avec `abandoned = true`.
- Reprise (§6.2-1) : `GET /offline-batches/{id}` ; `404` → renvoyer le même lot ; `202` → attendre `Retry-After`
  (valeur non fixée par le protocole).
- Réponse (`OfflineBatchResult`, openapi:13634) : `batch_id, processed_at, results[], contiguous_acked_seq, missing_seqs,
  next_snapshot_version, abandoned, server_time`. Le terminal marque `ACKED` les statuts finaux (`ACCEPTED`, `DUPLICATE`,
  `ACCEPTED_WITH_SHORTFALL`, `REJECTED` avec `retryable = false`) (§6.2-4). Ce que le contrat appelle
  `contiguous_acked_seq` est le « max_contiguous_seq » de la demande.

### 1.3 Formats des opérations par type (§3.3, §5.4, §7.1, openapi:13401-13505)

Le contrat n'a pas de `oneOf` par type : seuls `seq, type, occurred_at, chain_hash` sont requis. Pour le serveur :

| Type | Champs chaînés attendus | Champs d'état attendus | Traitement |
|---|---|---|---|
| `PURCHASE` | `seq,type,occurred_at,amount,currency,tap,lines` | `snapshot_version, config_id` (hors ligne), `online_status`, `online_tap_id`, `local_available_before`, `clock` | §7.1 étapes 2-12 |
| `REVERSAL` | idem sans `tap` ; `reverses_seq` (vente de ce terminal) ou `reverses_transaction_id` (vente écrite en ligne) | `snapshot_version, config_id, online_status` ; `reason` (non listé en §3.3) | lignes exactement opposées + réduit l'anomalie `OFFLINE_SHORTFALL` (§7.1 fin, cas 23) |
| `TOPUP_CASH` | `seq,type,occurred_at,amount,currency,tap` | idem | `CASH_DESK` au débit, `WALLET_PAID` au crédit ; découpage `L-ESP-A-RENDRE` (cas 22, §8) ; tardif : `LATE_OFFLINE_SYNC` (§7.5) |
| `VOID` | `seq,type,occurred_at,void_reason` (`ABORTED_BY_OPERATOR, ONLINE_REJECTED, NFC_READ_FAILED, APP_CRASH_RECOVERY`) | `online_status` (`UNKNOWN` possible, cas 2) | registre `VOID`, résultat `ACCEPTED`, effet `NONE` ; si la clé existe : `DUPLICATE` + `VOID_CONFLICT` (cas 2) |
| `ONLINE_REF` | `seq,type,occurred_at,online_operation` | `online_status` | clé absente : registre `VOID` raison `ONLINE_NOT_EXECUTED`, `ACCEPTED`/`NONE` ; sinon étapes 2-3 |
| `ACTIVATION`, `DEPOSIT_CASH` | interdits dans un lot de terminal (openapi:13408) | | à rejeter côté serveur (voir §5, P-12) |

Exemption (§7.2) : `online_status = CONFIRMED` exemptée des contrôles de conformité ; si introuvable : anomalie
`ONLINE_CONFIRMED_MISSING`, puis traitement §7.3 « comme une opération hors ligne (I4), sans les contrôles de l'étape 5 ».

### 1.4 Ordre exact du traitement d'une opération (§7.1) et des contrôles

Ordre normatif, opération par opération, chacune dans sa transaction :

1. Clé `<serial>:<seq>`.
2. Registre : même empreinte → résultat mémorisé (`DUPLICATE` si écrit) ; autre empreinte → `REJECTED
   IDEMPOTENCY_KEY_REUSED` + anomalie `IDEMPOTENCY_CONFLICT`, fin.
3. `journal_transaction(ledger, clé)` existe → inscrire au registre, `DUPLICATE`, fin.
4. Selon le type : `VOID`, `ONLINE_REF` (voir 1.3) ; `CONFIRMED` introuvable → `ONLINE_CONFIRMED_MISSING`.
5. Si `online_status ≠ CONFIRMED` : contrôles de conformité §7.2 (échec → `REJECTED` + `NON_COMPLIANT_OPERATION`).
   Pour toute opération : contrôles de période (échec → `REJECTED` + `PERIOD_CLOSED_OPERATION`/`LATE_OFFLINE_SYNC`).
6. `register_tap(..., 'OFFLINE', p_online_tap, p_signature)` avec `occurred_at_corrigé`.
7. §7.3 : `(couvert, manque, raison)`.
8. Lignes : débit portefeuille `couvert` (PROMO/PAID selon `spend_order`) + débit `SUSPENSE` `manque` + crédit commerçant
   `amount` + frais/commissions REALTIME sur `amount`.
9. `post_transaction(ledger,'PURCHASE',clé,occurred_at_corrigé,'OFFLINE_SYNC',lignes,event)` ; `CL007` → reprendre en 7
   (3 fois) ; 4e `CL007` → `REJECTED INSUFFICIENT_FUNDS_RETRY`, `retryable = true`, rien au registre (voir C-F).
10. `consume_tap(tap_id, tx)` si `tap_id` non nul (`CL022` si déjà utilisé ; pas de délai pour `OFFLINE_SYNC`).
11. `manque > 0` → `anomaly('OFFLINE_SHORTFALL', manque, tx)`.
12. Registre `(tx, statut)` par `record_device_seq`, COMMIT.

Ordre des contrôles de conformité §7.2 (tableau, dans l'ordre d'écriture) : `CURRENCY_MISMATCH` ; `OFFLINE_NOT_ALLOWED` ;
`POLICY_LIMIT_EXCEEDED` (par vente, par bracelet, par terminal, `config_id` absent/inconnu/autre terminal) ;
`SNAPSHOT_VERSION_UNKNOWN` ; `SNAPSHOT_TOO_OLD` ; `MEDIA_NOT_IN_SNAPSHOT` ; `MEDIA_BLOCKED_IN_SNAPSHOT` ;
`MEDIA_WRONG_EVENT` ; `PACK_NOT_VERIFIED` ; `REVERSAL_TARGET_NOT_FOUND`/`ALREADY_REVERSED`. Le protocole ne dit pas que
cet ordre est normatif pour le motif renvoyé quand plusieurs échouent ; c'est l'ordre du tableau (retenu en P-9).
Ordre des contrôles de période (second tableau) : `PERIOD_CLOSED` (`occurred_at_corrigé ≤ ledger.locked_until`) ;
`LEDGER_LOCKED` ; `SYNC_DEADLINE_PASSED` (vente et annulation seulement, événement en `SETTLING` ou au-delà ;
anomalie `LATE_OFFLINE_SYNC` au lieu de `PERIOD_CLOSED_OPERATION`). Les contrôles de période s'appliquent aussi aux
opérations `CONFIRMED`, et le terminal n'est pas fautif.

### 1.5 Table de conflit §7.3 (exhaustive), avec SPEC §9.6

`t_blocage` : `media_status_history.at`, `media_batch_status_history.at` (portefeuille : voir C-K). `tol` = 120 s.

| # | Situation | couvert | manque | statut / raison |
|---|---|---|---|---|
| 1 | tap `OK`, solde ≥ montant | montant | 0 | `ACCEPTED` |
| 2 | tap `OK`, solde < montant | solde | montant − solde | `ACCEPTED_WITH_SHORTFALL` / `INSUFFICIENT_FUNDS` |
| 3 | tap `BLOCKED`/`REPLACED`/`RETIRED`/`RELEASED`/`BATCH_INACTIVE`, `occurred_at_corrigé < t_blocage + tol` | min(solde, montant) | reste | `ACCEPTED` ou `…_WITH_SHORTFALL`/`INSUFFICIENT_FUNDS` |
| 4 | idem, `occurred_at_corrigé ≥ t_blocage + tol`, snapshot utilisé antérieur au blocage | 0 | montant | `…_WITH_SHORTFALL` / `MEDIA_BLOCKED_AFTER_SNAPSHOT` |
| 5 | tap `CLONE_SUSPECTED` | 0 | montant | `…_WITH_SHORTFALL` / `MEDIA_CLONE_SUSPECTED` |
| 6 | tap `UID_MISMATCH` | 0 | montant | `…_WITH_SHORTFALL` / `MEDIA_UID_MISMATCH` |
| 7 | tap `SIGNATURE_MISMATCH` (bracelet en liste noire) | 0 | montant | `…_WITH_SHORTFALL` / `MEDIA_SIGNATURE_MISMATCH` |
| 8 | signature absente alors que la puce en a une | comme ci-dessus | comme ci-dessus | statut inchangé + anomalie `SIGNATURE_MISMATCH` (pas de `SIGNATURE_MISSING` hors ligne) |
| 9 | portefeuille `BLOCKED`/`CLOSED` | 0 | montant | `…_WITH_SHORTFALL` / `WALLET_BLOCKED` |
| 10 | tap `UNKNOWN` ou `NOT_ACTIVATED` | n/a | n/a | `REJECTED` / `MEDIA_NOT_IN_SNAPSHOT` |
| 11 | tap `WRONG_EVENT` | n/a | n/a | `REJECTED` / `MEDIA_WRONG_EVENT` |

Cas non couvert par le tableau : ligne 3 sans « snapshot antérieur au blocage » (blocage ≥ `t_blocage+tol` avec un
snapshot postérieur au blocage) → c'est `MEDIA_BLOCKED_IN_SNAPSHOT` en §7.2 (rejeté avant). Un `tap` `RETIRED`
(« identité retirée », ADR-34) renvoie `CLONE_SUSPECTED` selon §11 cas 34 ; le tableau §7.3 ne le dit pas.

Calcul d'écriture : la transaction 22 du scénario (`scenario_reference.json`, no 22, `TPE-FOOD-02:0087`, `OFFLINE_SYNC`,
`2026-12-13T21:30:00+00:00`) : `L-WAL-W04-P +6000` (débit portefeuille), `S-ATTENTE +3000`, `L-MCH-FOOD −9000` (crédit
commerçant), `L-MCH-FOOD +1080` (commission TTC 12 % de 9000), `L-ORG-COM −915` (HT), `L-ORG-TVA −165`. Convention : débit
positif, crédit négatif. 6 lignes. Commission calculée sur le MONTANT TOTAL (9000), pas sur la part couverte. Soldes
attendus après coup : `S-ATTENTE = 3000` après la transaction 23 (`after_festival`) puis résolution par la 25.

### 1.6 Horloge (§7.4)

- `tol = 120 s` (plateforme). Futur : `occurred_at > recorded_at + tol` → `occurred_at_corrigé = recorded_at`, anomalie
  `CLOCK_SKEW`. Antérieur au snapshot : `occurred_at < generated_at(snapshot_version) − tol` → `occurred_at_corrigé =
  generated_at(snapshot)`, `CLOCK_SKEW`. Sinon inchangé. L'original reste dans `journal_transaction.metadata.
  device_occurred_at`.
- Inversion `occurred_at` décroissant avec `seq` (à `tol` près) : `CLOCK_SKEW`, résultat inchangé (§7.4-3).
- `counter_time_inversion` (vue) avec la même tolérance de 2 min (§7.4-4).
- Terminal : `t_trusted = server_time + (monotonic_now − monotonic_ms)` tant que `boot_id` inchangé (§7.4-1).
- `server_time` vs horloge système > `clock_tolerance_seconds` → alerte ; `CLOCK_SKEW_TOO_LARGE` (> 24 h) → `DEGRADED`
  (§7.4-5, côté terminal).

### 1.7 Codes de résultat, raisons, codes HTTP

- Statuts d'opération : `ACCEPTED`, `DUPLICATE`, `ACCEPTED_WITH_SHORTFALL`, `REJECTED` (+ `reject_reason`, `retryable`, `detail`).
- Raisons de rejet (openapi:13559, 19 valeurs) : voir le tableau de comparaison §2.1.
- Raisons de manque (`ShortfallReason`, 6 valeurs, identiques à §7.3).
- Erreurs HTTP de lot : `400 BATCH_SIGNATURE_INVALID`, `400 SEQ_OUT_OF_ORDER`, `409 SEQ_OUT_OF_RANGE (CL021)`,
  `409 BATCH_IN_PROGRESS (CL010)`, `409 CHAIN_BROKEN (CL017)`, `409 DEBIT_AUTHORITY_EDGE (CL006)`,
  `409 DEBIT_AUTHORITY_MOVING`, `409 STALE_AUTHORITY_EPOCH (CL015)`, `413 BATCH_TOO_LARGE (CL011)`,
  `403 OFFLINE_NOT_ALLOWED` (snapshot), `409 SNAPSHOT_VERSION_UNKNOWN`, `409 SEQ_GAP_NOT_FOUND (CL012)` (waive).
- `Retry-After` : seulement sur `202` de `getOfflineBatchResult` (openapi:4251) ; valeur libre.

### 1.8 Import de journal d'un terminal révoqué (§11 cas 33, openapi:1102)

Format : `DeviceJournalImport {batches: OfflineBatch[], reason (≥10 car.)}`. « L'export a le format des lots »
(`OfflineBatch`) et est signé par la clé Keystore du terminal (une signature par lot d'origine). Vérification dès la
création de la demande (signatures et chaîne, refus immédiat), traitement à l'approbation (`DEVICE_JOURNAL_IMPORT`,
action unique, `SUPERVISOR` ≠ appelant). Terminal non `REVOKED` : `409 CONFLICT_STATE`. N'utilise pas `open_offline_batch`
(qui refuse un révoqué, schéma:2192) : la mission devra donc rejouer la logique de chaîne et de registre hors de cette
fonction (voir P-13). Une opération datée après la révocation : `REJECTED OFFLINE_NOT_ALLOWED` + `NON_COMPLIANT_OPERATION`.
Le protocole ne définit pas le format de l'export au-delà de « lots signés » : voir P-13.

---

## 2. Écarts protocole / `openapi.yaml`

### 2.1 Écarts de champs, de noms et de codes

| # | Constat | Fait (référence) | Écart ou manque | Recommandation |
|---|---|---|---|---|
| E-1 | Raisons de rejet | `OfflineRejectReason` (openapi:13559-13594) : 19 valeurs | Absentes du contrat : `ABANDONED` (raison de lot, §6.2-6), `ONLINE_NOT_EXECUTED` (raison de registre d'un `ACCEPTED`, §7.1-4), raison du refus d'une recharge sans session (décision du porteur). Présentes au contrat mais absentes du protocole : `MALFORMED_OPERATION`, `WALLET_LIMIT_EXCEEDED` (le protocole n'écrit pas ce rejet : `TOPUP_CASH` est découpé, cas 22) | Ajouter la ou les raisons de recharge sans session (P-4). Documenter `MALFORMED_OPERATION` (opération inexploitable : type interdit, champs manquants) et laisser `WALLET_LIMIT_EXCEEDED` inutilisé pour `TOPUP_CASH` (le protocole prime). `ABANDONED` n'est pas une raison par opération : à laisser hors de l'enum, mais le dire dans le contrat |
| E-2 | `retryable` | `OfflineOperationResult.retryable` (openapi:13628) | Aucune règle par raison : seul `INSUFFICIENT_FUNDS_RETRY` est `true` (§7.1-9) ; tout le reste `false` | Poser dans le contrat : `retryable = true` uniquement pour `INSUFFICIENT_FUNDS_RETRY` |
| E-3 | `effect` | `LEDGER_WRITTEN`\|`NONE` (openapi:13609) | `DUPLICATE` et `ACCEPTED_WITH_SHORTFALL` écrits : `LEDGER_WRITTEN`. `DUPLICATE` d'une clé écrite en ligne : l'effet est « déjà écrit », pas « écrit par ce lot » | Fixer : `DUPLICATE` → `effect = LEDGER_WRITTEN` + `transaction_id` (le registre l'exige : schéma:2005 `CHECK … DUPLICATE ⇒ transaction_id`), `VOID`/`ONLINE_REF` non exécuté → `NONE` |
| E-4 | En-tête du lot : champs non définis par le protocole | `device_time_at_send` facultatif (openapi:13530) ; `created_at` | Le protocole (§6, §10.3) ne liste pas les champs de l'en-tête signé ; seul le contrat les donne. `authority_epoch` est dans l'en-tête ET dans `X-Authority-Epoch` | Traiter l'en-tête du contrat comme normatif pour la signature (tous les champs reçus, `device_time_at_send` inclus s'il est présent) ; exiger `X-Authority-Epoch == header.authority_epoch` (sinon `400`) |
| E-5 | Encodage de la signature | `signature: contentEncoding: base64` (openapi:13552) ; exemple `MEUCIQ…` = DER | Ni DER ni IEEE P1363 (r‖s) n'est dit. Idem pour la signature de snapshot (exemple aléatoire, openapi:3957) | Écrire dans le contrat : ECDSA en DER (ASN.1), base64 standard ; sortie directe de `SHA256withECDSA` Android et de `kms:Sign` `ECDSA_SHA_256` |
| E-6 | Types des numéros | `format: int64` partout ; ADR-128 reconnaît la limite 2^53 | Pas de `maximum` | Voir P-3 |
| E-7 | `BATCH_TOO_LARGE` 413 « lot vide ou de plus de 500 opérations » (openapi:11284) vs `operations.minItems: 1`, `maxItems: 500`, `count: 1..500` | Un lot vide ou de 501 opérations est un 400 de validation si le schéma s'applique en premier | Décider une seule règle (P-10) : 413 pour > 500 opérations ou > 1 Mio ; 400 `VALIDATION_FAILED` pour lot vide ; corriger la description de `BATCH_TOO_LARGE` |
| E-8 | `SNAPSHOT_VERSION_UNKNOWN` | Contrat : `409` « demander un FULL » (openapi:11284) ; aussi raison de rejet par opération ; spec (cas limite) : delta demandé sur base inconnue → `FULL` | Un seul code pour deux sens (HTTP et raison d'opération) | `getOfflineSnapshot` ne renvoie jamais `409 SNAPSHOT_VERSION_UNKNOWN` : il sert un `FULL` ; le code reste la raison d'opération. Retirer la phrase « demander un FULL » du contrat ou la réserver à l'`ack` (version jamais servie à ce terminal) |
| E-9 | `ackOfflineSnapshot` | Réponses `204`, `401`, `409` seulement (openapi:4030-4037) | Pas de `400`/`403`/`404`/`422` ; pas de règle pour une `version` inconnue, un `content_sha256` qui ne correspond pas, une version plus ancienne que `last_snapshot_version` | `204` idempotent (même version, ou plus ancienne : sans effet, jamais de recul, FR-039) ; version jamais servie à ce terminal ou `content_sha256` ≠ en-tête : `409 SNAPSHOT_VERSION_UNKNOWN` ; terminal révoqué : refus d'authentification déjà en amont |
| E-10 | `getOfflineSnapshot` | Réponses `200`, `401`, `403`, `409` | Pas de `304`/`ETag` (snapshot inchangé), pas de cas « aucune version encore produite » ni « terminal sans événement » (la spec dit : politique « interdit », pas de snapshot) | Terminal sans événement ou hors ligne interdit → `403 OFFLINE_NOT_ALLOWED` ; aucune version produite → `409 CONFLICT_STATE` avec `Retry-After` ; `since_version` = version courante → `200` DELTA vide (entries 0, removed 0) ou `304` : à trancher (recommandation : DELTA vide, déjà signé et accusé) |
| E-11 | `pwd_pack_key` | Facultatif au schéma (openapi:13394) | Obligatoire dès qu'une entrée porte un `pwd_pack_enc` non nul | Le rendre conditionnellement requis (texte du contrat) |
| E-12 | `removed_token_hashes` | Facultatif au schéma ; `header.removed` requis | Pour un `FULL`, la forme de l'empreinte dépend de la présence de la clé | Voir P-7 (toujours présent, tableau vide pour FULL) |
| E-13 | `authority_epoch` | `int64` au contrat, `int` au schéma (`offline_snapshot.authority_epoch int`, `ledger.authority_epoch int`) | Écart de largeur sans effet pratique (époque +1 par bascule) | Ajouter `maximum: 2147483647` au contrat ou ignorer ; à signaler |
| E-14 | `getOfflineBatchResult` 202 | Pas de corps ; `Retry-After` en ligne dans la réponse (openapi:4253), alors que `components/headers/Retry-After` existe (openapi:10494) | Valeur et `Content-Type` non fixés ; pas de schéma de corps pour `202` | Réutiliser `$ref headers/Retry-After`, corps `OfflineBatchProgress {batch_id, status: PROCESSING, processed, total}` facultatif ; valeur 2 s (P-8) |
| E-15 | POST d'un lot déjà en cours | Pas de réponse prévue pour un renvoi du même `batch_id` pendant `PROCESSING` | `open_offline_batch` rend le lot existant (schéma:2201-2207) sans erreur, donc le service doit choisir | `409 BATCH_IN_PROGRESS` + `Retry-After` (P-8) |
| E-16 | `Idempotency-Replayed` sur le POST | Présent au 200 | Rejeu d'un lot terminé : 200 avec les résultats mémorisés ; lot `REJECTED` (`CHAIN_BROKEN`) : doit rejouer le même 409 | Le dire au contrat |
| E-17 | `429`/`503` | Non listés pour `/offline-batches` ni snapshots | Les terminaux relancent après 5xx (§5.1-2) | Ajouter `503 SERVICE_UNAVAILABLE` (lot non démarré) avec `Retry-After` |
| E-18 | Codes d'erreur manquants | `DEVICE_REVOKED` existe ; pas de code pour « série du jeton ≠ `header.device_serial` / `X-Device-Serial` » ni « `ledger_id` du lot ≠ grand livre du terminal » | FR-013 les exige | `400 VALIDATION_FAILED` avec `errors[].pointer` (`/header/device_serial`, `/header/ledger_id`) |
| E-19 | Clés publiques de snapshot | `DeviceConfig.snapshot_keys[]` : `key_id, algorithm, public_key (SPKI base64), not_after` | `not_before`/état non fournis ; au plus deux clés par signataire (central ; chaque passerelle) | Servir les deux clés `ACTIVE`+`RETIRED` non expirées du central ; le schéma n'autorise qu'une `ACTIVE` : la seconde est `RETIRED` pendant la rotation |
| E-20 | Algorithme `Ed25519` | Schéma et en-tête l'admettent ; la spec reporte à 12b | `algorithm` du contrat n'est qu'un exemple | Contrat : enum `[ECDSA_P256_SHA256]` aujourd'hui, `Ed25519` « réservé » |

### 2.2 Routes absentes du contrat

**Fait.** `grep` des `operationId` : aucune route de politique hors ligne, de plafonds du prestataire, ni de risque maximal.
Les tags existants : `Hors ligne` (snapshots, lots, trous, import, `getEventDeviceSyncStatus`), `Configuration`,
`Événements`. `OfflinePolicy` (openapi:11845) décrit seulement la politique EFFECTIVE (`required` : 7 champs dont `capped`).
`DeviceConfig.offline_policy` la sert. Aucun schéma de niveau (champs hérités nullables).
Table `offline_policy` (schéma:747-761) : `scope_type` ∈ `OPERATOR_CEILING|ORGANIZER|EVENT|DEVICE`, `scope_id`, champs
nullables = hérite, `max_snapshot_age interval`, `version`, `UNIQUE (scope_type, scope_id)`. `OPERATOR_CEILING` : `scope_id =
operator_id` (schéma:787). Le plafond du prestataire plafonne aussi les booléens (`offline_enabled`, `cash_topup_offline`) et
l'âge, mais `capped` ne signale que les trois montants (schéma:828-831).

**Style existant à imiter.**

- Les routes les plus récentes (mission 6) sont hors du préfixe `/operators/{operator_id}` : `/events/{event_id}/psp-selections`,
  `/organizers/{organizer_id}/psp-configurations`, `security: humanBearer`, `description` qui énonce les rôles, `404` neutre
  pour un autre prestataire. Les routes de gestion de la hiérarchie utilisent `/operators/{operator_id}/…`.
- `PUT` + objet singulier pour un réglage : `/points-of-sale/{pos_id}/catalog-policy`, `operationId: setCatalogPolicy`,
  `Idempotency-Key` requis, `200` avec l'objet, `Idempotency-Replayed`.
- `operationId` en verbe+objet camelCase : `getEventPspSelections`, `setCatalogPolicy`, `getEventDeviceSyncStatus`.

**Forme REST proposée** (tag `Hors ligne`, `security: humanBearer`, `Idempotency-Key`, `X-Request-Id`, `Accept-Language`) :

| Méthode et chemin | `operationId` | Rôles | Rôle de la route |
|---|---|---|---|
| `GET /operators/{operator_id}/offline-ceiling` | `getOfflineCeiling` | `OPERATOR_ADMIN` ; lecture `ORGANIZER_ADMIN` du prestataire | Plafond (niveau `OPERATOR_CEILING`) ; `404`/valeurs nulles si aucun |
| `PUT /operators/{operator_id}/offline-ceiling` | `setOfflineCeiling` | `OPERATOR_ADMIN` seul | Remplace les plafonds (champ nul = pas de plafond) ; renvoie le niveau + `risk` des événements touchés |
| `GET /organizers/{organizer_id}/offline-policy` | `getOrganizerOfflinePolicy` | `ORGANIZER_ADMIN`, `OPERATOR_ADMIN` | Niveau `ORGANIZER` + valeurs effectives par héritage |
| `PUT /organizers/{organizer_id}/offline-policy` | `setOrganizerOfflinePolicy` | `ORGANIZER_ADMIN` | Remplace le niveau |
| `GET /events/{event_id}/offline-policy` | `getEventOfflinePolicy` | idem | Niveau `EVENT` |
| `PUT /events/{event_id}/offline-policy` | `setEventOfflinePolicy` | `ORGANIZER_ADMIN` | Remplace le niveau |
| `GET /devices/{device_id}/offline-policy` | `getDeviceOfflinePolicy` | `ORGANIZER_ADMIN`, `OPERATOR_ADMIN` | Niveau `DEVICE` + politique effective calculée (`effective_offline_policy`, `capped`) |
| `PUT /devices/{device_id}/offline-policy` | `setDeviceOfflinePolicy` | `ORGANIZER_ADMIN` (et `OPERATOR_ADMIN` pour couper un terminal, §6.3-5) | Remplace le niveau |
| `GET /events/{event_id}/offline-risk` | `getEventOfflineRisk` | `ORGANIZER_ADMIN`, `OPERATOR_ADMIN` | Risque maximal |

Schémas à ajouter : `OfflinePolicyLevel {offline_enabled, max_per_sale, max_per_media_per_device, max_total_per_device,
max_snapshot_age_seconds, cash_topup_offline}` (tous `nullable`, nul = hérite ; ne PAS réutiliser `OfflinePolicy`, dont les
champs sont requis), `OfflinePolicyLevelView {level (ORGANIZER|EVENT|DEVICE|OPERATOR_CEILING), scope_id, policy, version,
updated_at, updated_by, effective? (OfflinePolicy), risk? (OfflineRisk)}`, `OfflineRisk {event_id, currency,
max_total_risk, offline_devices, devices[{device_id, serial, max_total_per_device, capped}], computed_at}`.
Décisions de forme : `PUT` remplace le niveau entier, `version` pour la concurrence optimiste (`409 CONFLICT_STATE` si la
version diffère), valeurs `integer` `minimum: 0`, `max_snapshot_age_seconds` ≥ 0 et converti en `interval`, corps `{}`
pour effacer le niveau (tout hérite), `If-Match`/`version` dans le corps. Le risque (somme des `max_total_per_device` des
terminaux de l'événement dont la politique effective a `offline_enabled`) se renvoie aussi dans la réponse du `PUT`
(SPEC §9.3 : « afficher … quand il règle ses plafonds »). Champ de réponse `capped` : pas de valeur à écrire par l'appelant.
Historique : écrit uniquement par le déclencheur `offline_policy_log` (FR-004 : l'application n'a plus d'`INSERT` sur
`offline_policy_history`).

---

## 3. Tests minimaux §13 côté serveur

Liste exacte de `sync_protocol.md` §13 (7 tests). FR-044 et SC-012 en retiennent cinq pour la mission 7 ; 4 et 5 relèvent
de la bascule `EDGE` (mission 8) :

1. Rejouer 100 fois le même lot (et le même paiement) : une seule écriture par clé. (Mission 7.)
2. Couper le serveur au milieu d'un lot de 500 opérations puis rejouer : résultats identiques, aucune écriture en double,
   `contiguous_acked_seq` correct. (Mission 7.)
3. Scénario de référence, transaction 22 : écritures identiques à `scenario_reference.json`. (Mission 7.)
4. Bascule CENTRAL → EDGE sous charge (100 débits/s) : aucune transaction de débit de portefeuille de source ≠ `EDGE_SYNC`
   avec `recorded_at` postérieur à la bascule ; aucune perte. (Mission 8, hors périmètre.)
5. Bascule EDGE → CENTRAL avec 10 000 opérations en file : continuité `edge_seq`, aucun débit passerelle après
   `RELEASING`. (Mission 8, hors périmètre.)
6. Terminal avec horloge à +2 h, puis −2 h : corrections §7.4 et anomalies `CLOCK_SKEW`. (Mission 7.)
7. Bracelet bloqué pendant qu'un terminal est isolé : ventes antérieures débitées, postérieures en `SUSPENSE`.
   (Mission 7.)

Points de vigilance par test :

- Test 1 : le « même paiement » est le chemin en ligne (ADR-128) ; le test mélange les deux chemins (lot + paiement avec la même clé).
- Test 2 : exige un point d'arrêt injectable entre deux transactions d'opérations (par exemple une exception levée après N
  opérations), puis nouveau `POST` du même `batch_id` ; vérifier le registre (500 lignes), `journal_transaction` (nombre
  exact), `contiguous_acked_seq`. Sans l'abandon à 15 min, le lot reste `PROCESSING` (voir P-8 : le renvoi du même lot doit reprendre, pas être refusé).
- Test 3 : comparer lignes et montants à `scenario_reference.json` no 22 (6 lignes, montants et comptes ci-dessus) ; à
  faire par le moteur lui-même, pas par une copie. Le scénario a la clé `TPE-FOOD-02:0087`.
- Test 6 : le protocole ne donne pas de valeurs de seuil : +2 h → `occurred_at_corrigé = recorded_at` ; −2 h : `occurred_at`
  de 2 h avant `generated_at(snapshot)` → `occurred_at_corrigé = generated_at`. Les deux avec `CLOCK_SKEW` et
  `metadata.device_occurred_at`. Attention au contrôle d'horloge de la couche de signature de requête (C-H).
- Test 7 : trois ventes autour de `t_blocage` (avant, entre `t_blocage` et `t_blocage+tol`, après avec un snapshot antérieur).

---

## 4. Contradictions entre sources non déjà listées dans « Contradictions de sources » de la spec

Déjà listées (8) : politique sans route ; recharge tardive/caisse fermée ; session de rattrapage ; colonnes OP-N69 ;
« signature invalide » ; KMS simulé ; fréquence 60 s/5 s ; algorithme de signature.

| # | Contradiction | Sources | Effet sur la mission |
|---|---|---|---|
| C-A | Enveloppe de clé : « ECDH-ES P-256 » (§4.1-4, SPEC §9.4) / `ECDH-ES+HKDF-SHA256+A256KW` (openapi:12209). Ce n'est pas JWE (`ECDH-ES+A256KW` utilise Concat KDF), pas HPKE. Sel et `info` du HKDF, longueur de clé, variante de key wrap (RFC 3394 ou 5649), encodage de `epk` ne sont écrits nulle part. La route sœur `getMediaAuthKey` (openapi:1157+) décrit une autre construction (ECDH-ES + HKDF-SHA256 + AES-256-GCM, AAD `CASHLESS/PWDPACK/DEV/v1 ‖ device_id ‖ nfc_uid`) et aucune implémentation n'existe encore dans `apps/api` (aucun `hkdf` dans `src`) | protocole, contrat | Le plan doit figer la construction et livrer des vecteurs de test (le terminal Flutter est hors périmètre) |
| C-B | Champs chaînés : §3.3 liste 11 champs (dont `reverses_seq`, `reverses_transaction_id`, `online_operation`, `void_reason`) ; ADR-128, FR-017 et `device-seq-registry.ts:21-22,52-56` n'en ont que 7 (`seq,type,occurred_at,amount,currency,tap,lines`) | protocole vs ADR-128/spec | Identique pour `PURCHASE`. Pour `REVERSAL`, `VOID`, `ONLINE_REF` : sans `reverses_seq` ou `void_reason` dans l'empreinte, deux opérations différentes auraient la même empreinte. Le protocole prime sur la forme de FR-017 pour ces types ; l'extension est compatible avec les vecteurs de 5b (champs absents omis) |
| C-C | `reason` (annulation, openapi:13476, exemple « INPUT_ERROR ») : ni chaîné ni état dans §3.3 | contrat vs protocole | Non couvert par la chaîne : modifiable sans rompre la signature. À classer comme champ d'état informatif |
| C-D | Exposition des plafonds : terminal = exposition « non acquittée » (§5.2-9/10, §5.3, §8 col. 2) ; serveur = cumul « recalculé sur les opérations non reflétées » (§7.2). « Reflétée » (snapshot appliqué ≥ `next_snapshot_version`) et « acquittée » (résultat reçu) sont deux notions différentes (§5.3) | protocole | Le serveur ne peut pas observer ni l'une ni l'autre à l'instant de l'opération (voir P-6) |
| C-E | Commentaire de `device_config_served` : « Le terminal renvoie config_id … (sync_protocol §3.3, champ chaîné) » (schéma:2425) vs §3.3, SPEC §9.5, openapi:13441 : `config_id` est un champ d'ÉTAT, hors empreinte | schéma (commentaire) vs protocole | Le commentaire est périmé ; le code suit le protocole. Ne pas modifier le fichier `.sql` de référence : le noter dans l'ADR |
| C-F | Rejet réessayable (`INSUFFICIENT_FUNDS_RETRY`) : §7.1-9 « rien n'est écrit au registre, le numéro reste non acquitté » vs `complete_offline_batch` (schéma:2270-2285) qui lève `CL001` tant qu'un numéro du lot n'a pas de ligne au registre (I2). Le lot ne pourrait jamais passer `COMPLETED`, resterait `PROCESSING` 15 min et bloquerait les lots suivants (`CL010`) | protocole vs schéma | Voir P-5 : une migration est nécessaire |
| C-G | Raison de rejet unique mais plusieurs causes : le tableau §7.2 n'indique pas la priorité entre deux échecs ; §7.1 dit « contrôles de période » pour toute opération, mais le tableau §7.2 les place après les contrôles de conformité, et l'étape 6 (`register_tap`) vient après les deux | protocole | Retenir l'ordre d'écriture (P-9) |
| C-H | Horloge : couche de signature de requête (`real-device-identity.ts:211-216`, `nonce-store.ts`) refuse `400 CLOCK_SKEW_TOO_LARGE` toute requête dont `created` s'écarte de `clock_tolerance_seconds` (1-300 s), y compris `POST /offline-batches`. Le protocole (§7.4-5, test 6) attend qu'un terminal à +2 h envoie ses lots et soit corrigé par `CLOCK_SKEW`, et ne dit pas que `CLOCK_SKEW_TOO_LARGE` s'applique au lot | protocole + contrat (« 400 : horloge hors de la tolérance ») vs protocole §7.4-5 (24 h) | Si le terminal date `created` avec l'horloge système, il ne peut jamais synchroniser. À vérifier avec la mission 5a : `created` doit être `t_trusted`. Le test 6 doit simuler l'horloge dans les OPÉRATIONS (`occurred_at`), pas dans la signature |
| C-I | `OFFLINE_NOT_ALLOWED` à `occurred_at` : §7.2 « versions de politique » (historique `offline_policy_history`) vs dernier paragraphe de §7.2 et cas 21 : plafonds de `policy_in_force(terminal, config_id)` (configuration détenue) | protocole | Deux sources pour le même contrôle. Voir P-5 |
| C-J | Terminal `SUSPENDED` : §10-5 et spec (hypothèse) : les opérations datées après la suspension sont rejetées comme non conformes. Le tableau §7.2 n'a aucune ligne pour cela, ni de raison de rejet adaptée ; le schéma a `device.status` sans date de suspension (audit seulement) | spec vs protocole/contrat | Nécessite une source de date de suspension (journal d'audit ou nouvelle colonne) et une raison (`OFFLINE_NOT_ALLOWED` + détail `DEVICE_SUSPENDED`) |
| C-K | `t_blocage` d'un portefeuille : §7.3 cite `media_status_history` et `media_batch_status_history` « ou portefeuille » mais ne nomme aucune table d'historique de statut du portefeuille | protocole vs schéma | À vérifier dans le schéma (non trouvé dans les extraits lus) ; sans elle, `WALLET_BLOCKED` ne s'applique qu'à l'état à la synchro |
| C-L | `CLOCK_SKEW_TOO_LARGE` : openapi « 400, horloge hors de la tolérance » vs §7.4-5 « alerte au-delà de la tolérance, `DEGRADED` au-delà de 24 h » | contrat vs protocole | Voir C-H |
| C-M | Registre et `REVERSAL` : §7.2 `ALREADY_REVERSED` (rejet de lot) vs `ALREADY_REVERSED 409 CL035` (contrat, code HTTP en ligne) | protocole vs contrat | Même nom, deux usages ; sans conflit si le lot renvoie la raison dans `reject_reason` |
| C-N | Anomalie `EDGE_REPLAY_FAILED`/`CASH_TOPUP_OVER_LIMIT` figurent dans la liste fermée du schéma ; aucune anomalie n'existe pour la recharge espèces refusée (le schéma ne l'a pas prévu, voir P-4) ; et la spec de la mission 6 (ADR-133) a déjà ajouté une valeur par migration (0038:1280) | schéma | Une migration `DROP/ADD CONSTRAINT anomaly_kind_check` est le précédent |
| C-O | Rôle du port de clés : la spec (FR-037) et OP-N41 parlent d'un « port de clés existant » pour signer. Les ports existants (`apps/api/src/kms/kms.ports.ts`) sont `MacPort`, `DataKeyPort`, `DecryptPort`, `KeyAdminPort`, et `KmsKeyKind` n'a que `HMAC_256` et `SYMMETRIC_DEFAULT` : aucun `Sign`, aucune clé asymétrique | spec vs code | Un nouveau port `SignPort` (`kms:Sign`) et une valeur `ECC_NIST_P256` sont à créer, suivant la règle « un port par droit » (commentaire du fichier) |
| C-P | Snapshot : la clé de contenu est « propre à la version » et enveloppée « pour chaque terminal » (§4.1-4) ; la clé privée de signature DOIT être dans le KMS (§4.1-5) ; mais l'API publique n'a « aucun port de clé » (`kms.ports.ts:1-9`) et le déchiffrement des `pwd_pack_enc` exige `DecryptPort` | protocole vs architecture des droits | Voir P-2 : production dans un processus distinct qui détient `DecryptPort` + `SignPort` |
| C-Q | Seuils de volumétrie : §4.1 « 6 Mo pour 50 000 bracelets, ≈ 120 octets par entrée » ; l'exemple du contrat (entrée JSON avec hex 64 + champs) pèse plus de 400 octets en JSON non compressé | protocole vs contrat | 50 000 entrées JSON ≈ 20-25 Mo avant gzip. NFR FULL 50 000 bracelets en 30 s : préciser si c'est avant ou après compression |
| C-R | Mission 7 spec, hypothèse « un numéro > 2^53 est lu sans perte ou refusé » vs FR-033 « traiter un numéro supérieur à 2^53 sans perte de précision » | spec interne | Les deux ne s'équivalent pas ; voir P-3 |

---

## 5. Points laissés ouverts par le protocole : recommandations pour le plan

Chaque recommandation est égale ou plus stricte que les sources.

**P-1. Conservation des versions de snapshot.**
Fait : `offline_snapshot` ne garde que l'en-tête (schéma:355-375), immuable (`forbid_mutation`, schéma:2349) ; le contenu
n'est pas stocké ; le déclencheur exige qu'une base de DELTA soit une version inscrite. Deux besoins distincts :
(a) fabriquer un DELTA depuis une `base_version` ; (b) juger une opération (`MEDIA_NOT_IN_SNAPSHOT`,
`MEDIA_BLOCKED_IN_SNAPSHOT`, `SNAPSHOT_TOO_OLD`, `generated_at`) qui exige l'état d'un bracelet À CETTE VERSION.
Recommandation : en-têtes conservés sans limite (déjà le cas, immuables) ; journal de changements par version
(`token_hash`, champs d'état sans PWD, sans `spendable` si le jugement n'en a pas besoin) conservé jusqu'à
`LOCKED + rétention de l'événement`, pas seulement quelques jours ; DELTA = pli du journal entre `base_version` et la
version courante, au plus 24 h de base (au-delà : `FULL`, cas limite de la spec) ; base inconnue ou purgée : `FULL`.
Alternative moins coûteuse mais plus fragile : reconstruire l'état à `generated_at` depuis les historiques de statut ; elle
n'est pas stricte tant que C-K n'est pas levée. Le plan doit choisir ; la recommandation est le journal de changements.
Le « absent du snapshot utilisé » doit se juger sur le journal, pas sur l'état courant.

**P-2. Architecture de production et de remise.**
Recommandation : un processus planifié distinct (modèle `main.psp-poller.ts` / `main.tag-check.ts`) qui détient
`DecryptPort` + un nouveau `SignPort` ; il produit la version, chiffre les `pwd_pack_enc` sous la clé de contenu de la
version, ENVELOPPE cette clé pour chaque terminal éligible (non révoqué, `offline_enabled`, `agreement_public_key` non
nul) et stocke les enveloppes (`version`, `device_id`, `epk`, `wrapped_key`) puis OUBLIE la clé de contenu (jamais
persistée en clair). L'API publique ne fait que lire (aucun port de clé), ce qui respecte « un port par droit ». Un
terminal enrôlé après la version reçoit l'enveloppe à la version suivante. Un terminal révoqué ou à clé d'accord changée n'a
plus d'enveloppe. Le corps (entrées chiffrées) est identique pour tous les terminaux : à mettre en cache par version.
Fichiers à faire relire par une personne (règle 4 de `CLAUDE.md`) : le module de production (clé de contenu, AES-GCM,
enveloppe), le futur `SignPort`, la fonction SQL d'inscription du snapshot (FR-006).

**P-3. Numéros supérieurs à 2^53 en JSON.**
Fait : `JSON.parse` arrondit silencieusement un nombre > 2^53−1 ; JCS (RFC 8785) sérialise les nombres en double IEEE-754 ;
ADR-128 reconnaît la limite pour le chemin en ligne. `contiguous_acked_seq + 10 000` borne les numéros acceptés (`CL021`) : un
numéro > 2^53−1 ne peut être accepté que si `contiguous_acked_seq ≥ 2^53 − 10 001`, ce qui est inatteignable.
Recommandation (stricte) : (1) corps JSON : refuser explicitement tout entier > 9007199254740991 pour `seq`, `seq_from`,
`seq_to`, `reverses_seq`, `contiguous_acked_seq` avec `400 VALIDATION_FAILED` (pointeur vers le champ), détecté sur le
texte brut (`JSON.parse` avec reviver à `context.source`, disponible en Node 22, ou analyse lexicale) ; (2) tout ce qui
est texte ou chemin (`Idempotency-Key` `<série>:<n>`, paramètre `{seq}` de `waiveSeqGap`, colonne `bigint`) se traite en
`BigInt` et se passe à SQL en texte, sans passer par `Number` : cela couvre le trou hérité de FR-033 (numéro dans une clé) ;
(3) réponses : si `contiguous_acked_seq`/`missing_seqs` dépasse 2^53−1, erreur interne plutôt que valeur arrondie ;
(4) contrat : `maximum: 9007199254740991` sur les numéros ; (5) test avec `9007199254740993` en texte brut dans un lot
(rejet) et dans une clé (accepté, exact), et vecteur d'empreinte fixe. Cela ferme l'écart « Number(seq) » de
`device-seq-registry.ts:48`.

**P-4. Recharge espèces sans session de caisse couvrante : raison et type d'anomalie.**
Décisions du porteur : `REJECTED`, rien d'écrit (ni portefeuille ni caisse), anomalie portant le montant. Le contrat n'a
aucune raison adaptée. Recommandation : deux raisons distinctes ajoutées à `OfflineRejectReason`,
`CASH_SESSION_NOT_FOUND` (aucune session du terminal ne couvre `occurred_at`) et `CASH_SESSION_CLOSED` (la session
couvrante est fermée), `retryable = false` (l'espèce est déjà dans le tiroir, un renvoi ne changerait rien). Anomalie : un
type NOUVEAU de la liste fermée, `CASH_TOPUP_NOT_BOOKED`, plutôt que de réutiliser `CASH_TOPUP_OVER_LIMIT` (sens différent :
dépassement de plafond, écrite) ; le précédent est `PSP_TOPUP_NOT_CREDITED` (ADR-133, migration 0038). Colonnes : `amount`
= montant, `ledger_id`, `media_id`, `device_id`, `seq`, `transaction_id` nul. Migration : `DROP/ADD CONSTRAINT
anomaly_kind_check`, plus SPEC §12.2 et le contrat. La régularisation au back-office suit l'existant (résolution à deux). Le
test d'inertie : aucune ligne `posting`, aucun solde de portefeuille ni de `A-CAISSE-*` ne bouge.
Cas voisins non tranchés par le protocole (même traitement recommandé : `REJECTED` + même anomalie, car l'espèce est déjà
encaissée) : recharge d'un bracelet non résolu/`WRONG_EVENT`/portefeuille `BLOCKED`/`CLOSED`/`CLONE_SUSPECTED`/`UID_MISMATCH` ;
`cash_topup_offline` faux à l'époque de la configuration détenue ; plafond `max_per_sale` dépassé. À trancher aussi :
`TOPUP_CASH` compte-t-il dans l'exposition ? §5.3 dit non (elle n'augmente pas `disponible_local`) ; recommandation :
non pour les plafonds d'exposition, oui pour `max_per_sale` (§5.4).

**P-5. Rejet réessayable et clôture de lot (conflit C-F), et source de politique pour `OFFLINE_NOT_ALLOWED`.**
Pour C-F : migration qui remplace `complete_offline_batch` pour accepter, dans `p_results`, des numéros explicitement
marqués `retryable` sans ligne de registre (le lot passe `COMPLETED`, `contiguous_acked_seq` n'avance pas au-delà, le numéro
sort dans `missing_seqs`), avec un test qui échoue si un numéro non réessayable manque. Ne pas inscrire ce rejet au
registre (le renvoi serait lu comme « mémorisé » et la vente ne serait jamais écrite : viole I4). Fichier à faire relire
(droits et I2). Pour C-I : recommandation (stricte pour la plateforme, protège le commerçant) : TOUS les plafonds et
booléens se jugent sur la configuration détenue (`policy_in_force`), conformément au dernier paragraphe de §7.2 et au cas 21 ;
l'historique `offline_policy_history` ne sert qu'à l'audit. Exception à écrire : terminal `SUSPENDED`/`REVOKED` (C-J).

**P-6. Exposition recalculée par le serveur.**
Définition recommandée, reproductible et déterministe : pour une opération `PURCHASE` de numéro `n` du terminal `D`, sur le
bracelet `t`, exposition_bracelet = Σ montants des `PURCHASE` de `D` sur `t` de numéro < `n`, non `VOID`, non rejetés, moins
les `REVERSAL` de ces ventes, QUI N'ÉTAIENT PAS ENCORE ACQUITTÉES à l'instant `occurred_at` de `n`. Une vente est acquittée
si son résultat a été renvoyé avant `occurred_at_corrigé(n) − tol` (heure `processed_at` du lot qui l'a rendue, ou
`recorded_at` d'une écriture confirmée en ligne). Le `−tol` donne le bénéfice du doute au terminal (une vente acquittée il y a
moins de 2 min compte encore dans l'exposition : plus strict pour la plateforme ; pour ne pas retirer à tort la garantie du
commerçant, l'alternative est `+tol`). Le plan doit trancher entre ces deux sens ; recommandation : compter comme non
acquittée toute vente dont l'acquittement date de moins de `tol` (plus strict). Ne compter dans « non reflétées » que si on
décide de suivre §7.2 à la lettre : la version `next_snapshot_version` n'est pas connue du serveur à l'instant de l'opération ;
recommandation : suivre §5.3 (acquittées), et signaler la contradiction C-D au porteur.

**P-7. Forme canonique exacte à figer (vecteurs).**
(a) `content_sha256` du snapshot : objet `{ "entries": [...], "removed_token_hashes": [...] }` toujours avec les DEUX clés
(tableau vide pour un FULL), entrées sans `pwd_pack_enc`, toutes les autres clés présentes, `null` conservé
(`nfc_uid`, `originality_sig_sha256`, `batch_event_id`, `batch_status`, `last_counter` peuvent être nuls au schéma) ; tri
des entrées par `token_hash` hexadécimal croissant, puis `nfc_uid` ; `removed_token_hashes` trié ; (b) même hash pour tous les
terminaux (exclut les champs propres à un terminal) ; (c) montants/compteurs en nombres entiers JSON (jamais en texte) ;
(d) l'horodatage `occurred_at` se hache TEL QUE REÇU (chaîne), jamais reformaté par un `Date` ; (e) `tap` et `lines` se
hachent tels que reçus, y compris les propriétés inconnues (`TapInput` autorise `additionalProperties`) : la validation
d'entrée ne doit pas retirer de propriétés (`whitelist` de NestJS) AVANT le calcul, d'où un calcul sur le corps brut ;
(f) à LA RÉCEPTION le serveur recalcule `content_sha256` et `chain_hash` de chaque opération à partir des champs chaînés
reçus, et ne fait jamais confiance au `content_sha256` ou `chain_hash` déclaré : sinon le corps d'une opération peut être
modifié sans invalider la signature d'en-tête (qui n'engage que `prev_chain_hash`/`last_chain_hash`). Un écart entre la valeur
déclarée et la valeur recalculée = lot `CHAIN_BROKEN` (même sort qu'une chaîne rompue).
AAD et octets : recommandation « octets bruts, sans séparateur » comme la genèse de chaîne
(`uuid_send`, schéma:1977) : `"CASHLESS/SNAPPWD/v1"` en UTF-8, `ledger_id` 16 octets, `version` entier 8 octets
gros-boutiste, `token_hash` 32 octets, `nfc_uid` 7 octets. Nonce AES-GCM : 12 octets aléatoires, sorties en base64 standard
(`EncryptedBlob`). Signature : DER (E-5). Clés publiques : SPKI DER en base64 (comme l'exemple de `snapshot_keys`).

**P-8. Fréquence interne et réponses d'un lot en cours.**
Production : une boucle toutes les 2 s qui lit un indicateur de changement (curseur sur les historiques de statut et le
dernier `posting.id`, ou notification `LISTEN/NOTIFY`) ; si le changement est BLOQUANT → nouvelle version immédiate (budget 5 s :
2 s de boucle + construction + signature + inscription < 3 s, avec un DELTA, jamais un FULL) ; sinon regroupement jusqu'à 60 s
depuis la dernière version. Une vente change `spendable` donc toute activité crée une version par minute et par grand livre
actif. Un test chronométré pour 5 s (blocage → version signée disponible) et 60 s.
Lot : le POST traite de façon synchrone (500 opérations, 60 s p95). Renvoi du même `batch_id` pendant `PROCESSING` :
`409 BATCH_IN_PROGRESS` avec `Retry-After: 2` (c'est une reprise par `GET`), jamais un second traitement en parallèle (le
verrou `device FOR UPDATE` + index `offline_batch_one_in_flight` l'empêchent). `GET` d'un lot `PROCESSING` : `202` avec
`Retry-After: 2`. Reprise après panne : le renvoi du même lot (après la fin de la requête interrompue) doit reprendre à la
première opération sans ligne de registre ; le lot ne doit pas rester bloqué `PROCESSING` jusqu'à 15 min si la requête qui le
traitait est morte : recommandation, une prise de verrou sur le terminal au début du traitement d'un renvoi du même `batch_id`
(le premier traitement est mort si le verrou est libre) puis reprise ; sinon le test 2 attendrait 15 min.

**P-9. Priorité des raisons de rejet.**
Retenir l'ordre du tableau §7.2 (devise, hors ligne permis, plafonds, snapshot connu, âge, bracelet présent, utilisable, bon
événement, PACK, annulation), puis les contrôles de période (`PERIOD_CLOSED`, `LEDGER_LOCKED`, `SYNC_DEADLINE_PASSED`), puis
les raisons issues de `register_tap` (§7.3). Premier échec seul rapporté, mais les autres peuvent figurer dans `detail`.
Comme les contrôles de période ne sont pas des fautes du terminal, la recommandation stricte est de les évaluer AVANT la
conformité pour ne pas ouvrir `NON_COMPLIANT_OPERATION` sur une opération de toute façon refusée pour période : c'est un
écart au texte (étape 5 : conformité puis période) ; à soumettre au porteur ou à garder l'ordre du protocole.

**P-10. Contrôles d'entrée d'un lot : ordre proposé.**
(1) taille > 1 Mio ou > 500 opérations → `413 BATCH_TOO_LARGE` ; lot vide → `400` ; (2) JSON valide, numéros ≤ 2^53−1 ; (3)
`X-Device-Serial == header.device_serial == sujet du jeton` ; `header.ledger_id` = grand livre de l'événement du terminal ;
`X-Authority-Epoch == header.authority_epoch` ; `count == operations.length == seq_to − seq_from + 1` ; (4) signature
(`400 BATCH_SIGNATURE_INVALID`) ; (5) continuité (`400 SEQ_OUT_OF_ORDER`) ; types interdits (`ACTIVATION`, `DEPOSIT_CASH`) →
`400 VALIDATION_FAILED` (un lot de terminal ne doit pas en contenir) ; (6) autorité (`409 DEBIT_AUTHORITY_EDGE`, sous verrou
partagé §9.1) ; (7) `open_offline_batch` (`CL021`, `CL010`, `CL011`, `CHAIN_BROKEN`). L'ordre signature avant continuité est
de FR-013. Un terminal `SUSPENDED` envoie encore ses lots ; `REVOKED` est refusé par la couche d'authentification (`DEVICE_REVOKED`).

**P-11. Époque d'autorité d'un lot quand le central est `CENTRAL`.**
Le protocole ne dit pas quoi faire d'un lot dont `authority_epoch` est inférieure à l'époque du grand livre (terminal isolé
pendant une bascule). Refuser avec `STALE_AUTHORITY_EPOCH` ferait perdre au commerçant une garantie due par I4. Recommandation :
accepter et tracer (audit) ; l'époque ne sert à refuser que si elle est SUPÉRIEURE à l'époque courante (impossible : alerte).

**P-12. Types interdits et inconnus.**
`ACTIVATION`/`DEPOSIT_CASH` dans un lot de terminal : le contrat dit « NE DOIT PAS ». Recommandation : lot entier refusé
(`400`), pas de rejet par opération (un numéro consommé sans résultat serait un trou). Un type hors liste : `400` aussi. Les
types sans effet au grand livre dans un lot de passerelle ne sont pas de cette mission.

**P-13. Import de journal d'un terminal révoqué.**
Le protocole dit « export signé par la clé Keystore » sans format. Recommandation : le contrat existant (liste de
`OfflineBatch`) est suffisant : chaque élément garde son en-tête et sa signature d'origine ; le serveur vérifie chaque
signature avec `device.public_key`, recalcule la chaîne depuis le dernier `chain_hash` connu (`device.last_chain_hash`),
exige la continuité d'un lot à l'autre et l'absence de chevauchement avec le registre (un numéro déjà au registre est
comparé par empreinte, comme pour un lot). Sans `open_offline_batch` (refus du révoqué), il faut une fonction SQL jumelle
« import » ou une migration qui laisse `open_offline_batch` accepter un appel d'import ; rien ne doit élargir les droits
de `cashless_app`. Une opération datée après la date de révocation : `REJECTED OFFLINE_NOT_ALLOWED` (contrat). La date de
révocation est lue dans l'audit ou une colonne à ajouter (comme C-J).

**P-14. Ordre de grandeur de la remise d'un FULL.**
50 000 entrées ≈ 20-25 Mo en JSON non compressé (C-Q), 2-3 Mo après gzip. Seuil FULL 50 000 bracelets en 30 s (spec).
Recommandation : corps construit et mis en cache par version (hors enveloppe du terminal), compression gzip réelle au service
(`Content-Encoding`), pas de pagination (le contrat n'en a pas) ; seuil mesuré après compression et sur cette version cachée.

**P-15. Anomalies attachées aux erreurs de lot.**
Seules `CHAIN_BROKEN` (409) et `SEQ_GAP` ouvrent une anomalie avant traitement. `BATCH_SIGNATURE_INVALID`, `SEQ_OUT_OF_ORDER`,
`SEQ_OUT_OF_RANGE`, `BATCH_IN_PROGRESS`, `DEBIT_AUTHORITY_EDGE` n'en ouvrent aucune ; la spec (conflit 5) les consigne en
audit (FR-043). Recommandation : une ligne d'audit par refus de lot (sans PII), avec le code et `batch_id`, pour le rejeu forensique.

**P-16. Risque de configuration forgée.**
Les champs d'état (`config_id`, `snapshot_version`, `online_status`, `local_available_before`) ne sont ni signés par l'en-tête
ni chaînés. `policy_in_force(device, config_id)` n'exige que l'appartenance au terminal : un terminal compromis peut citer la
configuration servie la plus permissive de son historique. Plus strict (recommandation) : `config_id` doit être posé avant
l'opération (`served_at ≤ occurred_at_corrigé`) ; un `config_id` servi APRÈS l'opération est un `POLICY_LIMIT_EXCEEDED`. Le
même contrôle vaut pour `snapshot_version` (inscrit avant l'opération, sinon `SNAPSHOT_VERSION_UNKNOWN`). À consigner
comme limite connue si le porteur ne le retient pas.

**P-17. Écarts qui affaiblissent la sécurité à soumettre au porteur avant de coder** (règle 1 de `CLAUDE.md`).
- Production des snapshots avec un `SignPort` simulé et des clés de contenu enveloppées par un faux KMS : déjà décidé (12b) ;
  dette nommée à consigner (OP-N41, OP-N73 restent ouverts), faux refusé en production avec test.
- Si le plan retient une reprise du lot qui contourne `complete_offline_batch` (P-5) : modification de fonction sensible.
- Tout choix de P-9 (période avant conformité) et P-6 (sens de la tolérance) : ce sont des écarts de lecture du protocole, pas
  des affaiblissements, mais ils changent qui porte la perte (commerçant ou prestataire) : à faire valider.

**Fichiers à faire relire par une personne** (cryptographie, droits) : production et enveloppe des snapshots
(P-2), `SignPort` (C-O), migration de `complete_offline_batch` (P-5), toute migration de droits (FR-038/039/040),
fonction d'import (P-13).
