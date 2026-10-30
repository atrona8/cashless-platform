# Research: Hors ligne : snapshots et lots

Décisions du plan, avec leur raison et les options écartées. « Renforcement » = plus strict que les sources : fait,
puis consigné (règle 1 de `CLAUDE.md`). « Porteur » = décision du porteur (Decision Moment). Références de code
relatives à la racine ; `S:` = `packages/ledger-sql/schema_grand_livre_cashless.sql` (schéma de référence, jamais
modifié à la main : toute évolution passe par une migration `CREATE OR REPLACE` / `ALTER`). Les rapports de recherche
complets sont copiés dans `docs/passation-7/rapports/` (base, API, protocole). **La section R-30 (corrections de la
passe contradictoire) fait foi sur les sections antérieures quand elles divergent.**

## R-01 — État de départ : les objets existent, rien n'est branché

- **Fait** : tout le hors ligne du schéma de référence existe (S:1952-2480 : `offline_policy`,
  `effective_offline_policy`, `offline_snapshot` + `check_offline_snapshot`, `snapshot_signing_key`,
  `offline_policy_history` + déclencheurs, `device_config_served`/`record_config_served` (remplacée par 0029),
  `policy_in_force`, `device_seq_registry`, `record_device_seq`, `device_missing_seqs`, `waive_seq_gap`,
  `offline_batch`, `open_offline_batch` (borne `CL021`, abandon 15 min, chaîne, `SEQ_GAP`, un lot en vol par index
  unique partiel), `complete_offline_batch`, `event_sync_deadline`, `event_device_sync_status`). Les 12 types
  d'anomalie de la spec sont déjà dans `anomaly_kind_check` (0038). `WAIVE_SEQ_GAP` et `DEVICE_JOURNAL_IMPORT` sont
  déjà des actions d'approbation. Le moteur sait écrire une vente `OFFLINE_SYNC` avec part en `S-ATTENTE`
  (`ledger/money/spend.ts`).
- **Manque** : aucune route, aucun droit `EXECUTE` de `cashless_app` sur les fonctions de lot, aucun stockage du contenu
  d'un snapshot, aucune signature (le port de clés n'a que HMAC, clé de données et déchiffrement), aucun contrôle de
  conformité, aucune anomalie `OFFLINE_SHORTFALL` écrite.
- **Conséquence** : la mission complète par migrations `0043` à `0048` (dernière existante `0042`, `0028` reste libre)
  et n'en réécrit aucune fonction en l'affaiblissant (C-004), sous la seule réserve de R-30.11 (trace `RETRY`, décision du porteur).

## R-02 — Recharge espèces hors ligne retirée (porteur, 30/10/2026)

- **Decision** : aucune recharge espèces hors ligne (DM `01M663D0XP43K575Q78DSSQ1MB`, remplace les trois décisions du
  29/10 sur la session couvrante). `CHECK (cash_topup_offline IS NOT TRUE)` sur `offline_policy` (migration 0043) :
  la politique effective le rend toujours faux, une route qui le règle à vrai répond `422`. Un `TOPUP_CASH` porté par
  un lot ou un import : `REJECTED` (`OFFLINE_NOT_ALLOWED`), rien d'écrit, anomalie `NON_COMPLIANT_OPERATION` portant
  bracelet, terminal, numéro et montant (`loss_bearer` selon `provided_by`) ; les autres opérations du lot passent
  (porteur : rejet par opération, pas refus du lot).
- **Rationale** : ferme tout chemin d'espèces sans contrôle de caisse ; la garde de caisse (ADR-132, 0036) reste
  inchangée (la question de sa couverture datée devient sans objet, DM `01M6630ZHCQNA8YQ1E9AGX348W` annulée).
- **Alternatives** : refus du lot entier — écarté par le porteur (le terminal ne pourrait retirer l'opération sans trou).
- **Contradiction signalée** : `sync_protocol.md` §5.4, §7.5, §8, §11 cas 22 et 39 et SPECIFICATION §9 permettent la
  recharge espèces hors ligne. Appliqué : la décision ; à mettre en accord (report `PRD.md`, ADR).
- **Conséquence** : le découpage `TOPUP_CASH` hors ligne du moteur (`OFFLINE_SPLIT_SOURCES`, mission 6) reste pour
  la passerelle (`EDGE_SYNC`, mission 8) ; la mission ne l'appelle pas.

## R-03 — Politique hors ligne : écriture par fonction, historique par la base (FR-001 à FR-005, OP-N58)

- **Decision** : `set_offline_policy(scope_type, scope_id, valeurs jsonb, expected_version, actor)` et
  `clear_offline_policy(...)` (SECURITY DEFINER) : portée contrôlée (organisateur, événement, terminal du prestataire de
  la session ; `OPERATOR_CEILING` ⇔ `scope_id = operator_id`), version attendue (concurrence optimiste, `409`),
  bornes (montants ≥ 0, âge 0 à 86 400 s), `cash_topup_offline` vrai refusé (R-02). `log_offline_policy` remplacé
  en SECURITY DEFINER (`search_path = public, pg_temp`) ; `INSERT, UPDATE, DELETE` retirés à `cashless_app` sur
  `offline_policy` et `offline_policy_history`.
- **Plafond du prestataire** : écrit par `OPERATOR_ADMIN` seul ; lisible par l'`ORGANIZER_ADMIN` du prestataire.
  `effective_offline_policy` (inchangée) applique `least()` à la lecture ; `capped` reste limité aux trois montants
  (S:828), précisé au contrat. Une valeur d'organisateur au-dessus du plafond est acceptée et réduite à la lecture
  (SPECIFICATION §9.3 : « ne peut pas dépasser » = effet, pas refus) ; la réponse du `PUT` rend la valeur effective et
  `capped`.
- **Risque maximal** : `offline_max_exposure(event)` (DEFINER STABLE) = somme des `max_total_per_device` effectifs des
  terminaux non révoqués de l'événement dont la politique effective a `offline_enabled`, hors `personal_phone` ;
  renvoyé par `GET /events/{id}/offline-risk` et dans la réponse de chaque `PUT`.
- **Configuration servie** (FR-005) : `record_config_served` (0029) inchangée ; `config_id` stable ; `snapshot_keys`
  servies (R-07) ; `latest_snapshot_version` du battement de cœur servi (version courante du grand livre du terminal).
- **Alternatives** : garder l'écriture directe avec un déclencheur de portée — écarté : C-005 (écritures contrôlées
  par fonctions), et le déclencheur aurait dû refaire le cloisonnement.

## R-04 — Production des snapshots : processus et rôle dédiés (FR-006 à FR-010)

- **Decision** (**remplacé par R-30.8 : deux processus**) : nouveau processus `snapshots` (`apps/api/src/main.snapshots.ts`, modèle `psp-poller`/`tag-check`),
  rôle de base `cashless_snapshots` (LOGIN, NOINHERIT, NOBYPASSRLS, connexion `DATABASE_URL_SNAPSHOTS`), ports
  `DecryptPort` + nouveau `SignPort` + `DataKeyPort` seulement (`KmsModule.forCapabilities`). L'API publique ne lit que
  les artefacts produits : aucun port de clé, aucun secret (principe « un port par droit », `kms.ports.ts`).
- **Rationale** : `cashless_app` ne peut lire ni `pwd_pack_enc` ni la vue `offline_snapshot_rows` (post-roles.sql:170-196) ;
  la clé privée de signature ne doit pas être joignable par l'API publique.
- **Droits de `cashless_snapshots`** (liste figée par test) : `EXECUTE` de `offline_snapshot_source(ledger)` (lecture
  DEFINER de la vue, retirés compris, R-05), `publish_offline_snapshot(...)`, `offline_snapshot_targets()`,
  `wrap_offline_snapshot_key(...)` ; `SELECT (id, encrypted, wrapping_kms_key_ref)` de `tag_data_key` ; rien d'autre
  (aucun `INSERT` direct).
- **Alternatives** : produire dans l'API publique avec `DecryptPort` — écarté (élargit l'API publique aux secrets) ;
  producteur dans le processus `tag-keys` — écarté (mélange deux rôles de clés, NOINHERIT).
- **Relecture humaine** (règle 4) : processus, rôle et droits, chiffrement et enveloppe.

## R-05 — Versions en chaîne : FULL ou DELTA de la version précédente (FR-006, FR-007, FR-011)

- **Decision** : chaque version d'un grand livre est **un** artefact signé (contrainte existante
  `UNIQUE (ledger_id, version)`) : soit un `FULL`, soit un `DELTA` dont `base_version` est la version précédente.
  Le producteur publie un `DELTA` à chaque changement et un `FULL` toutes les heures (`SNAPSHOT_FULL_EVERY_SECONDS`,
  3 600 par défaut) ou quand un `DELTA` dépasserait 20 % des entrées. Service : `GET /offline-snapshots/current`
  - sans `since_version`, ou version inconnue, ou antérieure au dernier `FULL` conservé → dernier `FULL` ;
  - `since_version = b` connue → l'artefact de version suivante (`DELTA` de base `b`, ou un `FULL`) ;
  - `since_version` = dernière version → `200` avec ce même dernier artefact (le terminal, déjà à jour, n'applique rien).
  Le terminal applique (sa règle `base_version = version locale` tient), accuse, et redemande tant que la version
  servie est inférieure à `latest_snapshot_version` (en-tête de réponse `X-Snapshot-Latest`).
- **Rationale** : un `DELTA` « de b à la dernière » exige une signature par couple (b, dernière) : impossible sans
  port de signature dans l'API publique. La chaîne garde un artefact signé par version, fidèle au schéma.
- **Contradiction signalée** : l'exemple `sync_protocol.md` l.383 (1532 → 1536 en un `DELTA`) ; le contrat dit
  « s'il en dispose, sinon un `FULL` » : appliqué le contrat (on dispose du pas suivant). En pratique un terminal en
  ligne est à un pas (une version par minute au plus hors blocage).
- **Inscription** (OP-N57) : `publish_offline_snapshot(ledger, kind, generated_at, valid_until, entries, removed,
  content_sha256, authority_epoch, key_id, signature, header)` DEFINER : verrou consultatif sur le grand livre,
  `version = max + 1` calculée, `base_version` = version précédente pour un `DELTA`, en-tête recalculé et comparé ;
  `INSERT, UPDATE` retirés à `cashless_app` sur `offline_snapshot`. Une version plantée par le propriétaire ne bloque
  pas : la fonction refuse toute version au-delà de `max + 1` (rien à planter, l'appelant ne fournit pas la version).
  L'en-tête signé est construit par le producteur AVANT l'inscription : la fonction rend la version qu'elle va
  attribuer par `next_offline_snapshot_version(ledger)` sous le même verrou consultatif (transaction du producteur :
  verrou, version, construction, signature, inscription).
- **Contenu stocké** : `offline_snapshot_entry(ledger_id, version, token_hash, entry jsonb sans PWD, pwd_pack_enc,
  removed)` pour chaque artefact ; `offline_snapshot_state(ledger_id, token_hash, entry_sha256, last_version)` (état
  courant, sert au calcul des différences) ; `offline_snapshot_media_log(ledger_id, version, token_hash, status,
  batch_status, wallet_status, in_snapshot)` (journal sans secret, pour juger une opération à sa version, R-12).
  Conservation : contenu des artefacts depuis l'avant-dernier `FULL` (purge par le producteur) ; en-têtes et journal
  jusqu'à `LOCKED` + rétention de l'événement.
- **Empreinte** : `content_sha256 = SHA-256(JCS({entries (sans pwd_pack_enc), removed_token_hashes}))`, les deux clés
  toujours présentes, entrées triées par `token_hash`, `null` gardé ; vecteurs fixes calculés hors du code testé.
- **Alternatives** : composer les `DELTA` à la demande dans le producteur (file + attente) — écarté (latence, une
  pièce de plus) ; `FULL` à chaque version — écarté (50 000 lignes par minute).

## R-06 — Cadence 60 s / 5 s (FR-008, NFR-005)

- **Decision** : boucle de 1 s (`SNAPSHOT_POLL_SECONDS`) ; curseurs sur `media_status_history`,
  `media_batch_status_history`, nouvel historique `wallet_status_history` (R-12) et `posting.id`. Changement bloquant
  (bracelet `SUSPENDED|BLACKLISTED|REPLACED|RETIRED`, lot non `ACTIVE`, portefeuille `BLOCKED`) → `DELTA` immédiat ;
  autre changement → `DELTA` si 60 s se sont écoulées depuis la dernière version. Nouveau terminal éligible (enrôlé,
  réactivé, clé d'accord nouvelle) → enveloppe ajoutée sans nouvelle version (R-07).
- **Mesure** : test chronométré « blocage → artefact signé disponible ≤ 5 s » et « vente → ≤ 60 s » ; seuils FULL
  50 000 en 30 s et DELTA servi en 2 s p95 (DM `01M64AMCNF5R4DNR87CK8DCJS7`), suites écartées par `SKIP_LATENCY`
  et lancées seules.
- **Alternatives** : `LISTEN/NOTIFY` — écarté (aucun usage existant, perte de notification à la reconnexion ; les
  curseurs suffisent à 1 s).

## R-07 — Signature et clés (FR-009, FR-037, OP-N13)

- **Decision** : nouveau port `SignPort { sign(kmsKeyRef, message): Promise<Buffer>; publicKey(kmsKeyRef) }`
  (capacité `sign`, `KmsKeyKind` `ECC_NIST_P256`) ; faux déterministe (graine + référence, `node:crypto`
  ECDSA P-256), `isFake = true`, refusé par `createKms` et `assertProcessIsSafe` en production ; test dans
  `test/unit/production-guard.spec.ts`. Signature **DER** base64 (sortie de `kms:Sign ECDSA_SHA_256`), clé publique SPKI
  DER base64. Algorithme `ECDSA_P256_SHA256` seul servi ; `Ed25519` réservé (12b).
- **Rotation** : `rotate_snapshot_signing_key(new_key_id, public_key, kms_key_ref, actor)` (DEFINER, processus
  `key-admin`) : nouvelle clé `ACTIVE`, l'ancienne `RETIRED` ; au plus deux clés `ACTIVE|RETIRED` non expirées par
  signataire (déclencheur ; renforcement de FR-009, la troisième passe `REVOKED`) ; `INSERT, UPDATE` retirés à
  `cashless_app` sur `snapshot_signing_key`. Clé inactive ou absente : aucun artefact, alarme du processus.
- **Configuration** : `snapshot_keys` = clés `ACTIVE` et `RETIRED` non révoquées du signataire central (au plus deux).
- **Dette nommée** : faux de signature gardé jusqu'à la mission 12b (décision du 29/10, `01M645SWY4PETSJE3PJ7YXKYTP`) :
  OP-N41 et OP-N73 restent ouverts, nouvelle entrée `POINTS_OUVERTS` « snapshots non servis en production avant 12b »,
  ADR, test de borne (démarrage refusé), report PROMPTS/PRD (mission 12b).

## R-08 — Mots de passe chiffrés pour le terminal (FR-010, NFR-007)

- **Decision** : à chaque artefact, le producteur tire une clé de contenu `K_v` par `DataKeyPort.generateDataKey`
  (copie enveloppée par le KMS conservée : `offline_snapshot.content_key_wrapped`, colonne ajoutée) ; chaque
  `pwd_pack_enc` de l'artefact = AES-256-GCM(`K_v`, PWD‖PACK), nonce aléatoire de 12 octets, AAD =
  `"CASHLESS/SNAPPWD/v1" ‖ ledger_id (16 o) ‖ version (8 o gros-boutiste) ‖ token_hash (32 o) ‖ nfc_uid (7 o)`.
  `K_v` est enveloppée pour chaque terminal éligible par `sealForRecipient` (`@cashless/tag-format`, ECDH-ES P-256 +
  HKDF-SHA256 + AES-256-GCM, déjà relu et vectorisé) avec l'AAD `"CASHLESS/SNAPKEY/v1" ‖ ledger_id ‖ version ‖
  device_id`, puis effacée de la mémoire (`zeroize`). Enveloppes dans `offline_snapshot_key(ledger_id, version,
  device_id, envelope)`, écrites par `wrap_offline_snapshot_key` (DEFINER, terminal non révoqué, clé d'accord
  courante). Un terminal devenu éligible plus tard : le producteur rouvre `K_v` par `DecryptPort` et ajoute son
  enveloppe pour les artefacts conservés.
- **Service** : l'API rend l'artefact et l'enveloppe de CE terminal ; sans enveloppe (terminal tout juste éligible) :
  `409 CONFLICT_STATE` + `Retry-After: 2`. Terminal révoqué : refusé par l'authentification ; aucune enveloppe n'est
  jamais lue pour lui (`offline_snapshot_key_for(device, ledger, version)` refuse un terminal non `ACTIVE|SUSPENDED`).
- **Contradiction signalée** : le contrat nomme `ECDH-ES+HKDF-SHA256+A256KW` (openapi:12209) sans fixer sel, `info`
  ni variante de key wrap ; la route sœur `getMediaAuthKey` utilise déjà la construction AES-GCM du kit. Appliqué : la
  construction du kit (AEAD, au moins aussi forte), `alg = ECDH-ES+HKDF-SHA256+A256GCM` corrigé au contrat, vecteurs
  livrés pour l'application déléguée.
- **Alternatives** : une clé par grand livre, renouvelée à la révocation d'un terminal — écarté (s'écarte de « propre à
  la version », exposition plus longue d'une clé).

## R-09 — Accusé de réception (FR-011, OP-N69)

- **Decision** : `POST /offline-snapshots/ack {version, content_sha256}` → `ack_offline_snapshot(device, version,
  content_sha256)` (DEFINER) : version servie à ce terminal (enveloppe existante) et empreinte égale, sinon
  `409 SNAPSHOT_VERSION_UNKNOWN` ; `last_snapshot_version = greatest(ancienne, version)` (jamais de recul) ; `204`
  idempotent.

## R-10 — Réception d'un lot : contrôles d'entrée (FR-013, FR-014)

- **Decision** : ordre, tous avant le moindre traitement :
  1. corps lu brut, taille ≤ 1 Mio (`413 BATCH_TOO_LARGE`) ; `JSON.parse` avec `reviver` et accès au texte source
     (Node 22) : tout entier de numéro (`seq`, `seq_from`, `seq_to`, `reverses_seq`) > 2^53−1 → `400
     VALIDATION_FAILED` (R-14) ;
  2. schéma ; 1 à 500 opérations (`413` au-delà, `400` pour un lot vide) ; `count = |operations| = seq_to − seq_from + 1` ;
     types permis `PURCHASE, REVERSAL, TOPUP_CASH, VOID, ONLINE_REF` (`TOPUP_CASH` accepté à l'entrée puis rejeté par
     opération, R-02) ; un autre type → `400` ;
  3. `header.device_serial` = série du jeton ; `header.ledger_id` = grand livre de l'événement du terminal ;
     `X-Authority-Epoch` = `header.authority_epoch` ; époque < époque courante → `409 STALE_AUTHORITY_EPOCH`
     (contrat appliqué : le terminal relit sa configuration et renvoie) ;
  4. signature ECDSA P-256 (DER) de `JCS(header)` par `device.public_key` → `400 BATCH_SIGNATURE_INVALID` + audit ;
  5. continuité des numéros → `400 SEQ_OUT_OF_ORDER` (code levé par l'API, sans SQLSTATE ; le `409` de `CL016` reste
     celui de la passerelle) ;
  6. **empreintes et chaîne recalculées par le serveur** depuis les champs chaînés reçus (R-13) ; un écart avec un
     `content_sha256`/`chain_hash` déclaré, ou une chaîne qui n'aboutit pas à `last_chain_hash` → lot `CHAIN_BROKEN`
     (renforcement : la signature n'engage que l'en-tête) ;
  7. autorité `EDGE` → `409 DEBIT_AUTHORITY_EDGE` ; `MOVING` → `409 DEBIT_AUTHORITY_MOVING` ;
  8. `open_offline_batch` (`CL021`, `CL010`, `CL011`, `CHAIN_BROKEN`, trous).
- **Terminal** : `SUSPENDED` envoie encore ses lots (`@DeviceAuth({allowSuspended: true})`) ; `REVOKED` refusé par
  l'authentification. `open_offline_batch` est complétée par migration (borne de débordement `seq_from + n − 1`,
  grand livre de l'événement du terminal) sans rien retirer.
- **Idempotence** : `Idempotency-Key` = `header.batch_id` (sinon `400`) ; rejeu d'un lot terminé : résultats mémorisés ;
  rejeu d'un lot refusé `CHAIN_BROKEN` : même `409`.
- **Audit** (FR-043, P-15) : une ligne par lot reçu et par refus (code, `batch_id`, terminal), sans donnée personnelle.

## R-11 — Traitement opération par opération et reprise (FR-015, FR-016, FR-029, FR-030, NFR-001/002/011)

- **Decision** : traitement synchrone dans la requête ; une transaction `TenantTx` par opération, dans l'ordre des
  numéros, résultat inscrit au registre (`record_device_seq`, canal `BATCH`, `batch_id`) dans la même transaction que
  l'écriture. Clé `<série>:<numéro>` fabriquée par `deviceKey(serial, seq)` (4 chiffres au moins). Algorithme §7.1 :
  registre (même empreinte → résultat mémorisé, `DUPLICATE` si écrit), clé déjà au journal → `DUPLICATE`,
  `VOID`/`ONLINE_REF`, conformité (R-12) puis période (R-15), passage `register_tap(..., 'OFFLINE', online_tap_id)`,
  table de conflit, écriture, `consume_tap`, anomalie `OFFLINE_SHORTFALL`, registre, COMMIT. Puis
  `complete_offline_batch` avec les résultats.
- **Autre empreinte sur un numéro connu** : `record_device_seq` lèverait `CL002` et annulerait la transaction. Le
  processeur lit d'abord le registre sous le verrou du terminal : même empreinte → résultat mémorisé ; autre empreinte →
  la première ligne fait foi, le résultat rendu est `REJECTED IDEMPOTENCY_KEY_REUSED` et l'anomalie
  `IDEMPOTENCY_CONFLICT` est ouverte dans une transaction propre (FR-016) ; rien n'est réécrit.
- **`CL007`** : `SAVEPOINT` autour de l'écriture, relecture des soldes, au plus trois reprises ; au quatrième échec,
  résultat `REJECTED INSUFFICIENT_FUNDS_RETRY`, `retryable = true`, **rien au registre**. `complete_offline_batch` est
  remplacée (migration 0045) : un numéro du lot sans ligne n'est admis que s'il figure dans `p_results` avec
  `retryable = true` et la raison `INSUFFICIENT_FUNDS_RETRY` ; le lot passe `COMPLETED`, le curseur continu s'arrête
  avant ce numéro, il sort dans `missing_seqs` sans anomalie `SEQ_GAP` (fonction relue par une personne, test qui échoue
  si un numéro non réessayable manque).
- **Reprise** : le traitement d'un lot tient un verrou consultatif de session `pg_try_advisory_lock(batch)` sur une
  connexion dédiée ; un renvoi du même `batch_id` `PROCESSING` dont le verrou est libre reprend à la première opération
  sans ligne au registre ; verrou tenu → `409 BATCH_IN_PROGRESS` + `Retry-After: 2`. `GET /offline-batches/{id}` :
  `200` terminé (ou `abandoned`), `202` + `Retry-After: 2` en cours, `404` inconnu.
- **Réponse** : résultats par opération, `contiguous_acked_seq`, `missing_seqs`, `next_snapshot_version` (dernière
  version du grand livre + 1 si une écriture du lot n'y est pas encore reflétée), `server_time`.
- **Registre ↔ API** : `ACCEPTED` sans écriture (`VOID`, `ONLINE_REF` non exécuté) → registre `VOID` (raison
  `ONLINE_NOT_EXECUTED` ou motif), résultat `ACCEPTED`, `effect = NONE` ; `DUPLICATE` → `effect = LEDGER_WRITTEN` +
  `transaction_id` d'origine.

## R-12 — Conformité sur la configuration détenue (FR-022, FR-023, FR-012)

- **Decision** : ordre du tableau §7.2, premier échec rapporté (les autres dans `detail`) : devise ; hors ligne permis à
  `occurred_at` (politique de `policy_in_force(terminal, config_id)`, terminal non suspendu ni révoqué à cette heure
  — `device_status_history` (0022)) ; plafonds par vente, par bracelet, par terminal ; snapshot connu ; âge
  (`min(max_snapshot_age, valid_until − generated_at)`) ; bracelet présent dans le snapshot utilisé ; utilisable dans
  ce snapshot ; bon événement ; `PACK` vérifié ; cible d'annulation. Session de vendeur : ouverte et non expirée à
  `occurred_at_corrigé` (`assert_vendor_session_at`, `record_sale_attribution_at`, migration 0047), sinon
  `REJECTED` non conforme (`OFFLINE_NOT_ALLOWED`, détail `VENDOR_SESSION`).
- **Configuration et snapshot cités** (renforcement, P-16) : `config_id` servi à ce terminal ET avant l'opération
  (`served_at ≤ occurred_at_corrigé`), sinon `POLICY_LIMIT_EXCEEDED` ; `snapshot_version` inscrite avant l'opération
  et enveloppée pour ce terminal, sinon `SNAPSHOT_VERSION_UNKNOWN` : un terminal compromis ne peut pas citer une
  configuration plus permissive servie après coup.
- **Exposition** (porteur, DM `01M66316M7AK30QY27GQ67P7ME`) : pour l'opération `n` du terminal `D`, cumul = montants
  des `PURCHASE` de `D` de numéro < `n` (moins leurs annulations), non rejetées, non `VOID`, dont le résultat
  n'était pas rendu au terminal 120 s avant `occurred_at_corrigé(n)` (`device_seq_registry.recorded_at >
  occurred_at_corrigé(n) − 120 s`, ou pas encore au registre), plus `n` ; par bracelet et par terminal.
- **État du bracelet à la version utilisée** : lu dans `offline_snapshot_media_log` (dernière ligne ≤ version), jamais
  dans l'état courant.
- **Non conforme** : `REJECTED`, rien d'écrit, anomalie `NON_COMPLIANT_OPERATION` avec `loss_bearer` = `provided_by`
  du terminal (`PLATFORM|OPERATOR` → prestataire, `ORGANIZER` → organisateur, `MERCHANT` → commerçant).
- **`online_status = CONFIRMED`** : contrôles de conformité sautés ; introuvable → `ONLINE_CONFIRMED_MISSING`, puis
  traitement hors ligne (I4).
- **Contradiction signalée** : §7.2 « versions de politique » contre « configuration détenue » (dernier paragraphe, cas
  21) : appliqué la configuration détenue pour tous les champs ; `offline_policy_history` sert à l'audit.

## R-13 — Empreinte d'opération (FR-017, ADR-128)

- **Decision** : une fonction pure `chainedContent(op)` choisit les champs chaînés de §3.3 (`seq, type, occurred_at,
  amount, currency, tap, lines, reverses_seq, reverses_transaction_id, online_operation, void_reason`, absents
  omis) ; `purchaseContent`, `topupContent`, `reversalContent` (chemin en ligne) l'appellent ; empreinte calculée sur
  l'objet reçu (chaînes et objets tels quels, sans normalisation ni retrait de propriétés inconnues). Vecteurs 5b
  inchangés (champs ajoutés absents = omis) ; nouveaux vecteurs de lot (annulation par `reverses_seq`, `VOID`,
  `ONLINE_REF`) calculés en Python hors du code testé.
- **Contradiction signalée** : ADR-128/FR-017 (7 champs) contre §3.3 (11 champs) : appliqué §3.3 (identique pour une
  vente, distingue `VOID`/`REVERSAL`).
- **Sonde** (FR-036) : numéro posé hors idempotence par le propriétaire, puis paiement falsifié portant ce numéro dans
  un lot → `REJECTED IDEMPOTENCY_KEY_REUSED`, `IDEMPOTENCY_CONFLICT`, aucun second débit.

## R-14 — Numéros au-delà de 2^53 (FR-033, renforcement)

- **Decision** : refus explicite (`400 VALIDATION_FAILED`, pointeur vers le champ) de tout numéro JSON > 2^53−1, détecté
  sur le texte source ; la clé `<série>:<numéro>`, les chemins (`{seq}`) et les colonnes passent en `BigInt` et en texte
  vers SQL, jamais par `Number` (`device-seq-registry.ts:60`, `cash-topup.service.ts:78`, `reversal.dto.ts`,
  `device-config.service.ts:246-247` corrigés) ; `MAX_DEVICE_SEQ` abaissé à 2^53−1 sur le chemin en ligne (JCS ne
  représente pas exactement un entier plus grand) ; contrat : `maximum: 9007199254740991`.
- **Rationale** : la borne `contiguous_acked_seq + 10 000` rend ces numéros inatteignables ; les refuser est plus sûr que
  d'empreinter une valeur arrondie. Trou hérité (corps en ligne non-objet) : se lève par `waiveSeqGap` dès qu'un numéro
  plus grand est reçu (test).

## R-15 — Période et temps (FR-024, FR-025)

- **Decision** : contrôles de période APRÈS la conformité (ordre du protocole : un terminal non conforme ne reçoit pas la
  garantie « synchronisation tardive ») et pour toute opération y compris `CONFIRMED` : `occurred_at_corrigé ≤
  locked_until` → `PERIOD_CLOSED` + `PERIOD_CLOSED_OPERATION` ; grand livre `LOCKED` → `LEDGER_LOCKED` ; vente ou
  annulation, événement `SETTLING` ou après → `SYNC_DEADLINE_PASSED` + `LATE_OFFLINE_SYNC` (montant, commerçant à
  garantir par le back-office). Lus avant l'écriture ; `CL003`/`CL005` de `post_transaction` restent un filet converti
  en rejet.
- **Horloge** : `resolveOfflineTime(occurred_at, recorded_at, snapshot_generated_at, 120 s)` (§7.4) : futur → heure de
  réception ; avant le snapshot → heure du snapshot ; `CLOCK_SKEW` ; original dans
  `journal_transaction.metadata.device_occurred_at` ; inversion entre numéros → `CLOCK_SKEW` sans changer le résultat.
- **Contradiction signalée** : la signature de requête refuse `created` hors tolérance (`400 CLOCK_SKEW_TOO_LARGE`) :
  le terminal doit dater `created` avec son heure de confiance (§7.4-1) ; le test +2 h / −2 h porte sur `occurred_at`.

## R-16 — Table de conflit et écritures (FR-019 à FR-021, FR-026)

- **Decision** : fonction pure `conflictOutcome(tapResult, soldes, tBlocage, occurredAt, snapshotGeneratedAt, tol)`
  (tableau §7.3, 11 lignes, testé par table) ; `t_blocage` lu dans `media_status_history`,
  `media_batch_status_history` et `wallet_status_history` (nouveau, déclencheur sur `wallet`, migration 0046 ; levée
  de C-K). Moteur : `PurchasePayload.coveredCap` (0 pour clone, UID, signature, portefeuille bloqué, blocage après
  snapshot), `EngineResult.shortfall` ; anomalie `OFFLINE_SHORTFALL` dans la transaction. Frais sur le montant total
  (transaction 22 du scénario, comparée par le moteur).
- **Annulation** : `REVERSAL` par `reverses_seq` (vente de ce terminal) ou `reverses_transaction_id` ; lignes exactement
  opposées ; `reduce_offline_shortfall(anomaly, montant, tx)` (DEFINER) réduit ou clôt l'anomalie liée ; cible absente,
  d'un autre terminal ou déjà annulée → `REJECTED` (`REVERSAL_TARGET_NOT_FOUND`, `ALREADY_REVERSED`).
- **Signature d'originalité** : `register_tap` en mode `OFFLINE` ouvre déjà `SIGNATURE_MISMATCH` (absente) ou met le
  bracelet en liste noire (différente) ; repris tel quel.

## R-17 — Anomalies par fonction (renforcement)

- **Decision** : colonnes `loss_bearer`, `detail jsonb`, `batch_id` ajoutées à `anomaly` ; `open_offline_anomaly(...)`
  (DEFINER, liste fermée des types de la mission, idempotente par type + terminal + numéro + transaction) ;
  `INSERT` direct retiré à `cashless_app` sur `anomaly` (le seul appelant, `CLOCK_SKEW` en ligne de
  `payments.service.ts:186`, passe par la fonction). Ferme le constat de fin de `post-roles.sql`.

## R-18 — Trous et levée à deux (FR-031 à FR-034)

- **Decision** : `check_seq_gap_waivable(device, seq)` (DEFINER STABLE, sans effet) à la demande ; `WAIVE_SEQ_GAP`
  (modèle `cash-sessions/cash-deposit-action.ts`, rôle `SUPERVISOR`, motif ≥ 10 caractères, périmètre lu en base)
  exécute `waive_seq_gap` (contrôles `CL010`/`CL012` rejoués). Route `POST /devices/{device_id}/seq-gaps/{seq}/waive`
  (contrat existant). Alerte : travailleur `seq-gap-age` du processus `snapshots` (modèle `daily-check`) : trous ouverts
  depuis plus de 24 h, une alerte par trou (`anomaly.detail.alerted_at` posé par fonction), code d'alarme 2 ; aucune
  action automatique (porteur, `01M64AFDTANCENGM3N0FQ56BDB`).

## R-19 — Import du journal d'un terminal révoqué (FR-035)

- **Decision** : `POST /devices/{device_id}/journal-imports` (contrat `importDeviceJournal`) : terminal `REVOKED`
  exigé (`409 CONFLICT_STATE`), signatures de chaque lot (clé publique conservée du terminal) et chaîne vérifiées dès
  la demande (refus immédiat), demande `DEVICE_JOURNAL_IMPORT` `PENDING` (`202`), journal conservé dans
  `device_journal_import` (borné à 20 lots), pas dans `approval_request.payload` (taille). À l'approbation (autre
  `SUPERVISOR`) : `begin_device_journal_import(import)` (DEFINER, jumelle d'`open_offline_batch` sans le refus du
  révoqué, canal `IMPORT`, une seule fois) puis même processeur d'opérations (approbateur = valideur) ; opération datée
  après la révocation → `REJECTED OFFLINE_NOT_ALLOWED` + `NON_COMPLIANT_OPERATION`. `offline_batch.received_via`
  admet `IMPORT` (migration).
- **Relecture humaine** : fonction d'import.

## R-20 — Dettes de droits héritées levées (FR-038 à FR-041)

- **OP-N57** : R-05. Test : `INSERT` direct refusé, version toujours max + 1, concurrence sur le verrou.
- **OP-N58** : R-03. Test : `INSERT` direct refusé ; modification sous `cashless_app` écrit l'historique ; test
  `tests_definer_trigger_writers.sql §3` inversé.
- **OP-N68** : `ALTER DEFAULT PRIVILEGES FOR ROLE <propriétaire> REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` (forme
  globale) en tête de `post-roles.sql`. Les 34 suites pgTAP qui changent de rôle (pgtap, `pg_temp.*`) incluent un
  fichier commun `tests/_grants_for_tests.sql` qui accorde nommément pgtap et leurs fonctions temporaires aux rôles de
  test ; `tests_execute_grants.sql §4` inversé.
- **OP-N69** : `REVOKE UPDATE ON device FROM cashless_app` complet ; écritures légitimes par fonctions (`record_device_heartbeat`
  existante, `ack_offline_snapshot`, `set_device_station_name`, plancher par `record_config_served`/`enroll_device`
  inchangées ; `personal_phone`, `app_mode` déjà non modifiables) ; aucun appel TypeScript ne casse (aucune écriture
  directe trouvée) ; `tests_device_rights.sql §1` → liste vide.
- **OP-N75** : rôle `cashless_maint` (LOGIN, NOINHERIT, `EXECUTE` des deux purges seulement), processus
  `maintenance` (`main.maintenance.ts`, `DATABASE_URL_MAINT`, motif `tagUrl`) ; `DevicePurgeWorker` quitte l'API
  publique ; `EXECUTE` retiré à `cashless_app` ; `tests_device_purge_window.sql` sous `cashless_maint`. OP-N78 non
  ajouté (mission 13). ADR (ADR-125) : secret de connexion de plus.
- Chaque levée : test qui échoue si le droit s'élargit, entrée `POINTS_OUVERTS` marquée levée, ADR.

## R-21 — Contrat (FR-042)

- **Decision** : routes ajoutées : `getOfflineCeiling`/`setOfflineCeiling` (`/operators/{operator_id}/offline-ceiling`),
  `get|setOrganizerOfflinePolicy`, `get|setEventOfflinePolicy`, `get|setDeviceOfflinePolicy`,
  `getEventOfflineRisk` ; schémas `OfflinePolicyLevel`, `OfflinePolicyLevelView`, `OfflineRisk`. Corrections : signature
  DER, `alg` de l'enveloppe, `pwd_pack_key` requis si une entrée a un mot de passe, `removed_token_hashes` toujours
  présent, raisons `ONLINE_NOT_EXECUTED` (registre) précisées, `retryable` vrai seulement pour
  `INSUFFICIENT_FUNDS_RETRY`, `202` de `getOfflineBatchResult` avec `$ref Retry-After`, `409 BATCH_IN_PROGRESS` au
  renvoi pendant le traitement, `maximum` des numéros, `X-Snapshot-Latest`, `409 CONFLICT_STATE` (enveloppe pas encore
  prête). Types TS et Dart régénérés. Détail : `contracts/openapi-additions.md`.

## R-22 — Pile et dépendances

- **Decision** : aucune nouvelle dépendance. `node:crypto` (ECDSA P-256, AES-256-GCM, SHA-256), `canonicalize`
  (existant, RFC 8785), `@cashless/tag-format` (enveloppe, existant), `JSON.parse` avec texte source (Node 22). Aucun
  contrôle DIRECTIVE_051 à rapporter faute de dépendance ajoutée ou mise à jour.

## R-23 — Contradictions de sources ajoutées par le plan

1. Recharge espèces hors ligne (R-02). 2. `DELTA` direct contre chaîne de versions (R-05). 3. Enveloppe `A256KW` contre
`A256GCM` (R-08). 4. Signature DER non dite au contrat, exemple DER (R-07). 5. Champs chaînés 7 contre 11 (R-13).
6. `SEQ_OUT_OF_ORDER` 400 (lot) contre 409 (`CL016`, passerelle) : deux usages gardés. 7. Rejet réessayable sans ligne
contre `complete_offline_batch` (R-11). 8. Politique à `occurred_at` contre configuration détenue (R-12).
9. `CLOCK_SKEW_TOO_LARGE` de la signature de requête contre §7.4-5 (R-15). 10. Exposition « non acquittée » contre
« non reflétée » (porteur, R-12). 11. Commentaire `device_config_served` (S:2425) : `config_id` champ chaîné, alors
que c'est un champ d'état (le protocole prime ; `.sql` non modifié). 12. `capped` limité aux montants (S:828).

## R-24 — Passe contradictoire

Passe par un agent distinct (Sonnet), lecture seule, sur `plan.md`, `research.md`, `data-model.md`, `contracts/`.
Constats et suites : `research-adversarial.md` ; corrections : R-30.

## R-30 — Corrections issues de la passe contradictoire (font foi)

Constats A1 à A33 (`research-adversarial.md`). Ces corrections font foi sur R-01 à R-23, `data-model.md` et
`contracts/` quand ils divergent.

**R-30.1 — `CONFIRMED` n'exempte que si la transaction existe (A1, renforcement).** Exemption de conformité seulement
si la transaction en ligne citée existe au journal (clé `<série>:<numéro>` ou `online_transaction_id` du même
terminal). Introuvable : `ONLINE_CONFIRMED_MISSING` ET contrôles de conformité complets. Écart au §7.1-4/§7.2
consigné (ADR, contradiction R-23.13).

**R-30.2 — Tables nouvelles fermées et cloisonnées (A2, A3).** Toute table de la mission porte `operator_id` (FK) et
`tenant_isolation` (ENABLE + FORCE). `post-roles.sql` retire `INSERT, UPDATE, DELETE` à `cashless_app` sur chacune ;
`SELECT` direct retiré aussi sur `offline_snapshot_entry`, `offline_snapshot_key`, `offline_snapshot_state`,
`device_journal_import` (lecture par fonctions DEFINER). Test générique dans `tests_offline_rights.sql` : aucune table
créée par les migrations 0043+ n'est écrivable par `cashless_app`. Tables ajoutées au balayage d'isolation.

**R-30.3 — Heures de référence (A4, A5).** `recorded_at` de §7.4 = `offline_batch.received_at` pour toutes les
opérations du lot (heure d'approbation pour un import). Exposition : une vente antérieure est « acquittée » si son
résultat a été rendu (`offline_batch.completed_at`, ou heure de la réponse en ligne = `device_seq_registry.recorded_at`
du canal `ONLINE`) avant `min(occurred_at_corrigé(n), received_at) − 120 s`. Test : lot de 500 opérations datées
`réception + 119 s`, plafond par terminal tenu.

**R-30.4 — Configuration et snapshot cités (A6, A7, A8).** `config_id` doit être la dernière configuration servie au
terminal avec `served_at ≤ occurred_at_corrigé + tol` ; une plus ancienne ou postérieure → `POLICY_LIMIT_EXCEEDED`.
Accusés historisés (`offline_snapshot_ack(device, version, acked_at)`) ; version citée inférieure à la dernière
accusée avant `occurred_at_corrigé − tol`, ou inscrite après `occurred_at_corrigé + tol` → `SNAPSHOT_VERSION_UNKNOWN`.
Âge ≤ `min(max_snapshot_age, valid_until − generated_at) + tol` (§4.3). Tests à −100 s et à une configuration périmée.

**R-30.5 — Cadence tenue à l'échelle (A9 à A12).** Version de maintien (`DELTA` vide) dès que la dernière a
`valid_until/3` d'âge, tant qu'un terminal est éligible ; version produite quand un terminal devient éligible. Les
`DELTA` lisent une source incrémentale (`offline_snapshot_source_delta(ledger, depuis)` : bracelets dont un historique
ou un solde a changé, fenêtre de recouvrement de 5 s sur `at`, dédoublonnage par empreinte d'entrée) ; `FULL` sur la
source complète. Service : dernier `FULL` si plus de 5 pas séparent `b` de la dernière version ou si un `FULL` plus
récent que `b` existe. Mesures : un blocage parmi 50 000 bracelets → version ≤ 5 s ; rattrapage après 1 h d'absence.

**R-30.6 — Délais et transactions courtes (A13).** Calcul, chiffrement et appels KMS hors transaction ; inscription
courte (`pg_advisory_xact_lock`, version, insertion par paquets de 5 000) ; délais propres aux rôles snapshots
(`statement_timeout` 30 s par paquet, `transaction_timeout` 60 s) fixés dans `post-roles.sql` hors de la boucle des
rôles de clés ; mesure du `FULL` de 50 000 sous ces réglages.

**R-30.7 — Lots : pool, résultats, reprise (A14, A25, A26).** Pool dédié aux verrous de lot
(`OFFLINE_BATCH_POOL_SIZE`, 20 par défaut, attente 1 s) ; pool plein → `503 SERVICE_UNAVAILABLE` + `Retry-After: 5`
(lot non ouvert) ; limite documentée ; test à 50 lots concurrents. Résultat de chaque opération écrit dans sa
transaction (`offline_op_result(operator_id, batch_id, seq, result jsonb)`) ; la reprise et la clôture relisent ces
lignes ; §13-2 compare les réponses octet pour octet. Statut du lot relu avant chaque opération ; `ABANDONED` pendant
une reprise → arrêt, résultats inscrits rendus (`200`, `abandoned: true`).

**R-30.8 — Deux processus de snapshots (A15, porteur).** DM `01M664RXTFR2Q90H3M0A190C20` :
- `snapshot-content` (rôle `cashless_snapcontent`, ports `DecryptPort` + `DataKeyPort`) : calcule l'artefact (entrées,
  mots de passe chiffrés sous `K_v`, `K_v` enveloppée par le KMS et pour chaque terminal), l'inscrit NON signé dans
  `offline_snapshot_draft` (en-tête complet sauf signature), sans aucun droit sur `offline_snapshot`.
- `snapshot-signer` (rôle `cashless_snapsign`, port `SignPort` seul) : relit le brouillon, recalcule `content_sha256`
  depuis les entrées, vérifie l'en-tête, signe `JCS(header)`, appelle `publish_offline_snapshot(draft, signature,
  key_id)` qui recalcule l'en-tête et publie ; aucun droit sur les mots de passe ni sur `tag_data_key`.
- Clé publique servie par lecture de `snapshot_signing_key` (aucun `sign` pour `key-admin`, qui crée la clé par
  `KeyAdminPort`). Test de borne : liste des ports et des droits de chaque processus figée.

**R-30.9 — Enveloppes et service (A16 à A20, A33).** Enveloppes pour les terminaux `ACTIVE` seulement ; `GET` d'un
`SUSPENDED` → `403 DEVICE_SUSPENDED` (ses lots restent traités). `offline_snapshot_key` porte `agreement_key_sha256`
(clé : grand livre, version, terminal, empreinte) ; enveloppe d'une ancienne clé jamais servie (`409` + nouvelle
enveloppe). Terminal devenu éligible : dernier `FULL` et versions postérieures seulement. `ETag` =
`"<ledger>:<version>:<device>:<empreinte clé d'accord>"`, `Cache-Control: private, no-store`, `304` si
`If-None-Match` correspond. Chaque entrée porte `pwd_pack_sha256` (SHA-256 du chiffré) dans le contenu signé
(renforcement, écart au §4.1-3 consigné). Sans clé de signature `ACTIVE` (production avant 12b) : `403
OFFLINE_NOT_ALLOWED` (détail `SNAPSHOTS_UNAVAILABLE`) et `offline_enabled` servi à faux dans la configuration.

**R-30.10 — Import contrôlé (A21 à A23).** La demande `DEVICE_JOURNAL_IMPORT` porte `sha256(batches)`, nombre
d'opérations, total des ventes, plage de numéros et liste des opérations datées après la dernière présence serveur
du terminal (`last_seen_at`, dernier accusé) ; l'approbateur voit cette synthèse. À l'exécution, empreinte,
signatures et chaîne sont revérifiées. États `PENDING → PROCESSING → APPLIED | FAILED` ; traitement par le travailleur
`journal-import` de l'API, une opération par transaction, reprise à la première sans résultat ; refus si un lot du
terminal est `PROCESSING` (`409`). Opération datée après la révocation : rejetée (inchangé).

**R-30.11 — Rejet réessayable tracé (A24, porteur).** DM `01M664S4Y4FW6W6TMP76BQGWV7` : au quatrième `CL007`, la
transaction de l'opération écrit `offline_batch_retry(operator_id, batch_id, device_id, seq, reason, created_at)` par
`record_offline_retry` (DEFINER) ; `complete_offline_batch` n'admet un numéro sans ligne de registre que s'il a une
ligne `offline_batch_retry` du même lot ; la ligne est close quand le numéro reçoit un résultat final. Alerte du
travailleur `seq-gap-age` si un numéro réessayable n'est pas renvoyé sous 24 h. Écart à I2 nommé : ADR, entrée
`POINTS_OUVERTS`, test qui échoue si un numéro sans trace est admis. La phrase « sans affaiblir » de R-01 vaut sous
cette réserve.

**R-30.12 — Droits (A27 à A29).** `cashless_snapcontent` : `SELECT (id, operator_id, key_index, version, status,
wrapping_kms_key_ref, encrypted_dek) ON tag_data_key` (liste figée). `mark_seq_gap_alerted` et `event_sync_deadline`
non accordés à `cashless_app` ; chaque `EXECUTE` a un appelant nommé (`contracts/database-rights.md`). Défaut global
posé pour le rôle propriétaire qui exécute `migrate.ts` (`DATABASE_URL_OWNER`, le même en CI et en production) ; test :
fonction créée par ce rôle non exécutable par `PUBLIC`. Suites pgTAP touchées : 41 (décompte par `grep`), toutes
adaptées par `tests/_grants_for_tests.sql`.

**R-30.13 — Divers (A30, A31).** `wallet_status_history` : ligne de départ à la migration pour tout portefeuille
`BLOCKED|CLOSED` (`at` = date connue la plus prudente) ; `t_blocage` inconnu → « bloqué avant la vente » (manque
entier). FR-043 et NFR-010 portés par chaque IC qui crée une route ou une table ; tests §13-4 et §13-5 (bascule `EDGE`)
reportés en mission 8 (PROMPTS).

Contradiction ajoutée : 13. `CONFIRMED` exempté par le protocole même introuvable (R-30.1). 14. `pwd_pack_enc` hors
du contenu signé (§4.1-3) contre `pwd_pack_sha256` signé (R-30.9).
