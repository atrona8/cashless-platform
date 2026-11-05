# R-api — État réel de apps/api pour la mission 7 (hors ligne, snapshots, lots)

Lecture seule, branche `feat/hors-ligne-snapshots-lots`. Chemins relatifs à `apps/api/src/` sauf mention.
Pour chaque constat : Fait / Manque / Reco.

Résumé en cinq lignes :
- Le registre des numéros, la clé `<série>:<numéro>` et `content_sha256` (JCS) existent et se réutilisent tels quels.
- Le moteur sait déjà écrire une vente `OFFLINE_SYNC` avec part non couverte vers `S-ATTENTE`. Il manque l'anomalie `OFFLINE_SHORTFALL`, le retry `CL007`, la réduction d'anomalie à l'annulation et tous les contrôles de §7.2/§7.3.
- Le port de clés n'a AUCUNE opération de signature ni de clé asymétrique. Il faut un nouveau port.
- Aucune des fonctions de lot (`open_offline_batch`, `complete_offline_batch`, `waive_seq_gap`, `device_missing_seqs`) n'est accordée à `cashless_app`.
- Le code TypeScript n'écrit directement sur `device` nulle part : les 4 UPDATE de colonnes (OP-N69) sont des droits inutilisés.

---

## 1. Paiement en ligne de la mission 5b (réutilisation pour les lots)

### 1.1 Registre des numéros — `payments/device-seq-registry.ts`
- Fait : classe `DeviceSeqRegistry` (l.73-118) avec deux méthodes.
  - `accept(client, {deviceId, seq: bigint, content: Buffer, transactionId}, channel='ONLINE')` (l.78-93) appelle `record_device_seq(..., 'ACCEPTED', channel, tx)` dans la transaction de l'écriture. Si `replayed !== false`, elle lève `IDEMPOTENCY_KEY_REUSED`.
  - `reject(operatorId, {deviceId, seq, content, reason}, channel, inside?)` (l.99-117) ouvre une transaction SÉPARÉE, prend `SELECT … FOR UPDATE` du terminal, puis `record_device_seq(..., 'REJECTED', channel, NULL, reason)`.
  - Le type `SeqChannel = 'ONLINE' | 'BATCH' | 'EDGE'` (l.30) est déjà prêt pour `'BATCH'`. Le paramètre `batch_id` (8e argument de `record_device_seq`) n'est PAS passé : `accept`/`reject` ne l'exposent pas.
- Fait : `isRegistrable(problem, error)` (l.65-71) exclut 5xx, `NON_FINAL_CODES` (`idempotency/device-key.ts:32-35`), `CL002` et `CL021`.
- Fait : `device_seq_registry` accepte les résultats `ACCEPTED, ACCEPTED_WITH_SHORTFALL, DUPLICATE, REJECTED, VOID, WAIVED` (schéma l.2003). L'API n'envoie aujourd'hui que `ACCEPTED` et `REJECTED`. Le CHECK exige `transaction_id` non nul pour `ACCEPTED_WITH_SHORTFALL`/`DUPLICATE`, et nul pour `REJECTED/VOID/WAIVED`.
- Manque :
  - `accept` fige `'ACCEPTED'` (l.84) : il faut un paramètre `outcome` (`ACCEPTED_WITH_SHORTFALL`, `DUPLICATE`, `VOID`) et un `reason`, ainsi que `batchId`.
  - Il n'y a pas de méthode pour `VOID`/`ONLINE_REF` (aucune transaction, §7.1 étape 4) ni pour le mode « résultat mémorisé » (rejeu : `record_device_seq` renvoie `replayed=true` avec l'issue et la transaction d'origine ; aucun appelant n'exploite ce retour).
  - Reco : ajouter une méthode `record(client, {deviceId, seq, content, outcome, reason?, transactionId?, batchId?}, channel)` qui rend la ligne complète `(replayed, outcome, reason, transaction_id, contiguous_acked_seq)`, et garder `accept`/`reject` comme enveloppes. Le registre est `SECURITY DEFINER` et prend le verrou terminal lui-même.
- Reco (verrouillage) : l'ordre global est terminal → vendeur → session → demande QR → bracelet → portefeuille (`payments/payments.service.ts:1-21`). Pour un lot, le verrou consultatif de `open_offline_batch` (`FOR UPDATE` du terminal) est pris une fois ; chaque opération prend ensuite sa propre transaction (sync_protocol §7.1 « dans sa transaction »).

### 1.2 `content_sha256` — forme, champs, vecteurs
- Fait : `contentSha256(fields)` (`payments/device-seq-registry.ts:39-44`) retire les champs `undefined`, applique `canonicalize` (paquet npm `canonicalize`, RFC 8785), puis SHA-256 (UTF-8) et rend un `Buffer` de 32 octets. Le paquet est ESM-seul : voir `jest.config.cjs` (`transformIgnorePatterns`).
- Fait : champs d'une vente `purchaseContent(seq, body)` (l.51-57) = `seq`, `type:'PURCHASE'`, `occurred_at` (chaîne TELLE QUE REÇUE), `amount`, `currency`, `tap` (objet embarqué tel que reçu, y compris ses propres clés `nfc_uid, token_hash, counter, key_index, pack_verified, originality_signature, occurred_at`), `lines` (tel que reçu). Exclus : `tap_id`, `customer_qr_token`, `vendor_session_id`, champs d'état.
- Fait : autres types déjà chaînés avec la même fonction :
  - `TOPUP_CASH` : `topups/cash/cash-topup.service.ts:74-85` (`seq, type, occurred_at, amount, currency, tap`).
  - `REVERSAL` : `reversals/reversal.dto.ts:79-92` (`seq, type, occurred_at, reverses_transaction_id`).
  - Demande QR marchand : `payment-requests/payment-request.service.ts:451` et `:463`.
- Vecteurs fixes : `apps/api/test/unit/payments/device-seq-registry.spec.ts` (l.1-40) :
  - `VECTOR_TAP = 3bea7bf2…5c7b` (vente avec lecture embarquée et lignes, seq 1) ;
  - `VECTOR_KEYPAD = 24c53c20…f704` (vente saisie, seq 7).
  - Ils ont été calculés HORS du code testé (Python). Le commentaire de tête dit que c'est « la forme exacte que les lots hors ligne devront reproduire ». Autres vecteurs JCS : `test/unit/idempotency/request-hash.spec.ts`, `test/unit/approval/act-hash.spec.ts`, `test/unit/kms/fake-kms.spec.ts`.
- Manque / écart avec sync_protocol §3.3 :
  - §3.3 liste comme champs chaînés : `seq, type, occurred_at, amount, currency, tap, lines, reverses_seq, reverses_transaction_id, online_operation, void_reason`. Le code ne couvre pas `reverses_seq`, `online_operation`, `void_reason`. `PURCHASE_FIELDS` (l.33) est fermé sur cinq champs.
  - `reversalContent` ne connaît que `reverses_transaction_id` (chemin en ligne). Une annulation hors ligne d'une vente elle-même hors ligne non encore connue du central ne peut référencer que `reverses_seq` (la transaction n'a pas d'identifiant). Les deux formes de hash doivent coexister sans changer le hash d'une annulation en ligne existante (champ absent = omis, donc compatible).
  - Pour un lot, le hash doit être calculé sur l'entrée du lot (`OfflineOperation`), pas sur un corps de requête HTTP. Les champs `occurred_at` et `tap.*` sont déjà des chaînes/objets JSON ; il faut recalculer à partir de l'objet reçu sans normaliser (aucune coercion de date).
  - Reco : extraire une fonction pure `chainedContent(op: Record<string, unknown>)` qui choisit les champs selon `op.type` (vente, recharge, annulation, VOID, ONLINE_REF) et que `purchaseContent`/`topupContent`/`reversalContent` appellent. Ajouter les vecteurs de lot au même fichier de test (calculés en Python, hors du code testé).
- CONTRADICTION à signaler (sans trancher) : l'ordre `type` dans le hash est sans effet (JCS trie), mais `OfflineOperation` (openapi) peut nommer le type autrement que `PURCHASE/TOPUP_CASH/REVERSAL` (ex. `VOID`, `ONLINE_REF`). À confirmer dans `packages/contracts/openapi.yaml` schéma `OfflineOperation` avant d'écrire la fonction.

### 1.3 Clé `<série>:<numéro>` et lecture des numéros
- Fait : `idempotency/device-key.ts:12` regex `^(.+):([0-9]{4,})$` ; `parseDeviceKey` (l.20-29) rend un `bigint` (`BigInt(match[2])`), refuse un `<serial>` différent de `device.serial` et un numéro > `MAX_DEVICE_SEQ = 2^63-1` (l.14). `requestDeviceSeq(req)` lit `req.deviceSeq`. Portée : `deviceScope` (`device:<deviceId>:`).
- Fait : la clé écrite au grand livre = l'en-tête `Idempotency-Key` complet (`payments.service.ts:161`). §7.1 étape 1 impose le remplissage à 4 chiffres minimum, jamais tronqué (`87 → 0087`, `12345 → 12345`) : la regex `{4,}` l'accepte, mais le code n'a aucune fonction qui FABRIQUE la clé à partir de `(serial, seq)`. Pour les lots, il faut cette fonction (`seq.toString().padStart(4,'0')`). Attention : l'écriture en ligne utilise la chaîne reçue ; `0087` et `087` ne sont pas la même clé de journal. La regex refuse `087` (3 chiffres).
- Risque > 2^53 :
  - `seqNumber(seq)` = `Number(seq)` (`device-seq-registry.ts:60-62`), de même `Number(seq)` dans `cash-topup.service.ts:78` et `reversal.dto.ts:~88`. Au-delà de 2^53 le hash est imprécis. `MAX_DEVICE_SEQ` autorise jusqu'à 2^63-1 : écart.
  - Dans un lot, `seq` arrive en nombre JSON, déjà converti en `double` par `JSON.parse` d'Express avant tout code de l'API. Un numéro > 2^53 est donc ambigu dès l'entrée.
  - Les lectures SQL de `int8` sont des `bigint` (`types.setTypeParser(20, BigInt)` dans `db/db.module.ts` et `db/process-db.module.ts`). `devices/config/device-config.service.ts:246-247` fait `Number(...)` sur `next_seq_floor` et `contiguous_acked_seq` (lus `::text`). `enrollment.service.ts:204` : `Number(enrolled.next_seq)`.
  - Reco : borner `seq` à `Number.MAX_SAFE_INTEGER` dans le contrat des lots (`422 VALIDATION_FAILED`) et dans `parseDeviceKey`, OU imposer le texte. Le plan doit trancher, car le contrat OpenAPI dit `integer int64`. Un test de limite à 2^53.

### 1.4 Session de vendeur (expiration 12 h)
- Fait : table `vendor_session` (`packages/ledger-sql/migrations/0031_vendors.sql:84-101`), colonnes `opened_at, expires_at, closed_at, closed_reason`, contrainte `expires_at = opened_at + interval '12 hours'`, UNE session ouverte par terminal (index partiel). Raisons de fermeture : `LOGOUT, REPLACED, VENDOR_DISABLED, VENDOR_LOCKED, DEVICE_SUSPENDED, DEVICE_REVOKED, PIN_CHANGED`.
- Fait : garde `vendors/vendor-session-guard.ts:25-32` appelle `assert_vendor_session(device, session)` (0031:411-). Contrôle : session de ce terminal, `closed_at IS NULL`, `expires_at > now()`, vendeur `ACTIVE` et non bloqué. Sinon `CL032` → `409 VENDOR_SESSION_INVALID`.
- Manque pour le hors ligne : cette garde juge « maintenant ». Une vente hors ligne synchronisée plus tard a sa session fermée ou expirée à l'arrivée. `record_sale_attribution` (0033:154-205) refuse aussi `closed_at IS NOT NULL OR expires_at <= clock_timestamp()` (CL032). Décision du porteur : « vendeur hors ligne = session ouverte en ligne valable 12 h ». Il faut donc une version « à l'instant `occurred_at` » : session du terminal avec `opened_at <= occurred_at_corrigé < least(expires_at, closed_at)`. Même exigence pour `record_sale_attribution` (mode lot). Fonctions SQL à ajouter (migration), pas de contournement par `UPDATE`.
- Reco : nouvelle fonction `assert_vendor_session_at(device, session, at)` et variante d'attribution `record_sale_attribution_offline`, `SECURITY DEFINER`, avec `REVOKE ALL … FROM PUBLIC` et GRANT à `cashless_app` dans `post-roles.sql`. Test pgTAP et test d'intégration « session fermée après la vente = vente acceptée ; session non ouverte à `occurred_at` = REJECTED ».
- La session ne se stocke que dans `vendor_session` (base). Le terminal l'envoie dans `vendor_session_id` (champ d'état, hors hash).

### 1.5 Passages (`register_tap` / `consume_tap`)
- Fait : `media/taps/tap.service.ts`.
  - `registerEmbedded` (l.42-69) : appelle `assert_device_active` puis `register_tap(op, token_hash, uid, counter, occurred_at, device, 'ONLINE', NULL, NULL, signature)`. Le mode (`'ONLINE'`) et `p_online_tap` (`NULL`) sont FIGÉS dans le SQL de la ligne 49.
  - `consume(client, tapId, txId)` (l.71-73) appelle `consume_tap(tap, tx)`.
  - `registerOrRefuse` (l.168), `settleRefusal` (l.187), `byId` (l.201), `withEmbeddedTap` (l.149).
- Fait : en base, `register_tap(p_operator, p_token_hash, p_uid, p_counter bigint, p_occurred, p_device, p_mode, p_tx, p_online_tap, p_signature)` (schéma l.964) renvoie `(result, tap_id)` ; `consume_tap` (0026, redéfini en 0033:298) exige `CL022` pour un passage déjà utilisé et n'applique la fenêtre de 120 s qu'à `source='ONLINE'` : « une opération de lot hors ligne consomme son passage quel que soit le délai » (0026:46-48).
- Manque : le mode `'OFFLINE'` avec `p_online_tap = op.online_tap_id` (§7.1 étape 6) n'est appelable par aucune méthode de `TapService`. Reco : ajouter `registerOffline(client, device, tap, onlineTapId)` (même forme que `registerEmbedded`, mode `'OFFLINE'`, `p_tx` nul).
- `TapInput.counter` est un `number` (`media/taps/taps.dto.ts:60`, borné 0..16 777 215 ligne 85) : pas de risque 2^53.
- Réutilisation : `TapRefused`, `tapProblem` (mapping des résultats `UID_MISMATCH`, `CLONE_SUSPECTED`… vers les codes), `TapService.settleRefusal`. Pour un lot le mapping résultat → `(couvert, manque, raison)` est différent (§7.3) : ne pas réutiliser `tapProblem`, qui lève des erreurs HTTP.

### 1.6 Ce qui se réutilise tel quel
- `contentSha256`, `DeviceSeqRegistry.accept/reject` (avec les compléments ci-dessus), `isRegistrable`, `parseDeviceKey`, `deviceScope`, `NON_FINAL_CODES`.
- `resolveOperationTime` (`payments/operation-time.ts:21-26`) : ±120 s autour de l'heure de la base. Pour un lot, la règle est différente (§7.4) : correction par rapport à `recorded_at` ET à `generated_at(snapshot)`. Ne PAS réutiliser telle quelle. Reco : nouvelle fonction `resolveOfflineTime(occurredAt, recordedAt, snapshotGeneratedAt, tol)`.
- `assertAuthorityEpoch` (l.33-47) : en-tête `X-Authority-Epoch`. Pour un lot, l'époque est dans `header.authority_epoch`.
- Le motif « une transaction, verrous dans l'ordre global, refus 4xx rangé dans une transaction séparée » (`payments.service.ts` l.83-92, 289-331) est le modèle de `OfflineOperationProcessor`.
- Bouchons de test : `test/integration/payments/payments-fixtures.ts`.

---

## 2. Moteur d'écritures — `ledger/`

### 2.1 Support de `OFFLINE_SYNC`
- Fait : `ledger/types.ts:36-43` contient `ONLINE, OFFLINE_SYNC, EDGE_SYNC, PSP_WEBHOOK, BATCH, BACKOFFICE`.
- Fait : `ledger/builders/festival/purchase.ts:36-47` appelle `spendSplit` avec `mode: command.source === 'ONLINE' ? 'ONLINE' : 'OFFLINE'`. En `OFFLINE` (`ledger/money/spend.ts:45-48`) : `covered = min(amount, max(paid,0)+max(promo,0))`, répartition promo/payé selon `spend_order`, `uncovered = amount - covered`. Lignes (l.49-54) : débit `WALLET_PROMO`, `WALLET_PAID`, débit `suspense()` pour le manque, crédit commerçant `-amount`, commission calculée sur `amount` TOTAL (l.55-63). Cela correspond à l'étape 8 de §7.1 et à l'exemple (transaction 22 : `+6000 / S-ATTENTE +3000 / −9000`).
- Fait : `ledger-engine.service.ts` `enrich` (case `PURCHASE`) lit les soldes signés (`readSignedBalances`) ; pas de verrou explicite du portefeuille pour `PURCHASE` (seulement `CHARGEBACK` verrouille `lockWalletPaidBalance`, l.133).
- Fait : `ledger/status-matrix.ts:42` `SYNC = ['OFFLINE_SYNC','EDGE_SYNC']`. Matrice : `LIVE` accepte tout sauf `BREAKAGE` ; `CLOSING` et `RECONCILING` n'acceptent que `PURCHASE`, `TOPUP_CASH`, `DEPOSIT_TAKEN` en source `SYNC` (l.83-110), plus `REVERSAL` en `SYNC` en `RECONCILING` ; `SETTLING` et au-delà : aucun de ces types. La matrice refuse donc d'elle-même `PURCHASE`/`REVERSAL` en `SETTLING` (`VALIDATION_FAILED` avant la base).
- Manque (par rapport à sync_protocol §7) :
  1. Anomalie `OFFLINE_SHORTFALL` : aucun code dans `apps/api/src` ne l'écrit (recherche vide). Le type d'anomalie existe dans le schéma (l.847). Le moteur ne remonte pas `uncovered` à l'appelant (`EngineResult` = `{transactionId, replayed, outcome?}`, l.47-53). Reco : ajouter `shortfall?: bigint` à `EngineResult` pour `PURCHASE` en `OFFLINE_SYNC` ET écrire l'anomalie dans la même transaction (étape 11), sur le modèle de `open_cash_due_anomaly` appelé en l.196-203.
  2. Raison du manque (`INSUFFICIENT_FUNDS`, `MEDIA_BLOCKED_AFTER_SNAPSHOT`, `MEDIA_CLONE_SUSPECTED`, `MEDIA_UID_MISMATCH`, `MEDIA_SIGNATURE_MISMATCH`, `WALLET_BLOCKED`) : `spendSplit` ne connaît pas de « couvert forcé à 0 ». Cas « couvert = 0, manque = montant » (clone, UID, signature, portefeuille bloqué, blocage après snapshot) : le moteur ne l'exprime pas. Reco : champ de payload `forceUncovered: true` (ou `coveredCap`) dans `PurchasePayload`, appliqué par `spendSplit(mode OFFLINE)`. Le calcul de `t_blocage` + `tol` (`media_status_history.at`, `media_batch_status_history.at`) se fait en base, pas dans le moteur : fonction SQL ou requête de lecture dans `ledger-queries.ts`.
  3. Recalcul sur `CL007` : le moteur laisse remonter l'erreur SQL (l.93-98 ne traduit que `BuildError`). Les étapes 7 et 9 « reprendre en 7 au plus 3 fois, puis `REJECTED(INSUFFICIENT_FUNDS_RETRY)`, `retryable=true`, rien au registre » ne sont pas codées. Reco : boucle dans le processeur d'opération (pas dans le moteur), avec `SAVEPOINT` autour de `engine.execute` (une erreur SQL aborte la transaction PostgreSQL), relecture des soldes à chaque tour. Test déterministe avec un `ConfigResolver`/`client` truqué qui lève `CL007` trois fois puis quatre fois.
  4. Annulation d'une vente avec manque : `buildReversal` (`ledger/builders/festival/reversal.ts:7-17`) inverse toutes les lignes (part `SUSPENSE` incluse) sans toucher l'anomalie. §7.1 impose de « réduire d'autant l'anomalie `OFFLINE_SHORTFALL` liée ». Rien dans l'API ni (à vérifier côté schéma) dans une fonction SQL ne le fait. `reversals/reversal.service.ts` (l.176-190) passe `source:'ONLINE'` et ne connaît que l'annulation en ligne. Reco : étape après `REVERSAL` : si la vente d'origine a une anomalie `OFFLINE_SHORTFALL` ouverte, la réduire/clore (colonnes modifiables par `cashless_app` : `status, resolution_tx_id` seulement — `post-roles` l.~534 `GRANT UPDATE (status, resolution_tx_id) ON anomaly`). Réduire le montant n'est PAS possible par UPDATE direct : il faut une fonction SQL `SECURITY DEFINER`. À confirmer dans le schéma (colonne `amount` d'`anomaly`).
  5. Le `source` d'une annulation hors ligne doit être `OFFLINE_SYNC` ; `assert_reversible` (appelée en l.~197 de `reversal.service.ts`) contrôle fenêtre, vendeur et mode `VENDOR`/`SUPERVISOR_DEVICE` avec preuve de jeton : rien de tout cela n'existe hors ligne. §7.2 : « annulation sans vente cible valide : `REVERSAL_TARGET_NOT_FOUND` / `ALREADY_REVERSED` ». Il faut une variante hors ligne de `assert_reversible` (ou un contrôle côté processeur) sans fenêtre « maintenant ».
  6. Contrôles de période : voir 2.3.

### 2.2 Découpage `TOPUP_CASH` hors ligne
- Fait : `ledger-engine.service.ts:75` `OFFLINE_SPLIT_SOURCES = ['OFFLINE_SYNC','EDGE_SYNC']`. `enrich` case `TOPUP_CASH` : en source de synchronisation, lit `readTopupHeadroom(client, walletId, occurredAt)` (`ledger/db/ledger-queries.ts:92-103`, `wallet_topup_headroom`, qui verrouille le solde) et ajoute `headroom` au payload. En ligne, `headroom` est retiré du payload.
- Fait : `buildTopupCash` (`builders/festival/topup.ts:59-74`) : `credited = min(amount, headroom)`, reste au crédit de `cashDue(walletId)` (compte `L-ESP-A-RENDRE`). Le moteur détecte alors `over > 0` (l.149-156), exige `mediaId` (l.157-161), puis appelle `open_cash_due_anomaly(ledger, media, over, tx)` (l.196-203) : anomalie `CASH_TOPUP_OVER_LIMIT`.
- Fait : rendu ultérieur `media/lifecycle/cash-due.service.ts` (anomalies `CASH_TOPUP_OVER_LIMIT` ouvertes → `WALLET_REFUND`) et `release.service.ts:55`.
- Fait : test existant `test/integration/engine/topup-cash-split.spec.ts`.
- Manque : la décision du porteur « recharge espèces hors ligne sans session de caisse OUVERTE couvrante = REJECTED, rien écrit, anomalie portant le montant » n'est codée nulle part. Le service en ligne exige la session via `requireCashSession` (`topups/cash/cash-topup.service.ts` + `media/lifecycle/counter-access.ts`) et rattache l'écriture par `attach_cash_tx`. Aucune fonction ne cherche une session « couvrante à `occurred_at` ». Reco : fonction SQL `find_cash_session_at(device, at)` (session ouverte du terminal couvrant l'instant) et variante `attach_cash_tx` hors ligne ; sinon `REJECTED` + anomalie de type à choisir dans la liste fermée (`LATE_OFFLINE_SYNC`, `PERIOD_CLOSED_OPERATION` ou `NON_COMPLIANT_OPERATION` ; aucune ne dit « pas de session » : à trancher par le porteur, ne pas ajouter de type sans migration).

### 2.3 Contrôle de période
- Fait en base : `ledger.locked_until` (schéma l.214) ; `post_transaction` lève `CL005` si `p_occurred <= lg.locked_until` (l.569-570) ; `CL003` si le grand livre est `LOCKED` ; `CL004` si `CLOSING`. Traduction : `errors/sqlstate-map.ts:12-14` → `PERIOD_CLOSED 409`, `LEDGER_LOCKED 409`, `EVENT_CLOSING 409`.
- Manque : §7.2 veut, pour un lot, `REJECTED(PERIOD_CLOSED | LEDGER_LOCKED | SYNC_DEADLINE_PASSED)` (rien écrit, `retryable=false`) PLUS une anomalie `PERIOD_CLOSED_OPERATION` ou `LATE_OFFLINE_SYNC`, et jamais une réponse HTTP 409 pour une opération d'un lot. Reco : contrôle de lecture AVANT `engine.execute` (lire `locked_until`, statut du grand livre, statut de l'événement) pour décider du rejet et poser l'anomalie ; garder la base comme filet (`CL003/CL005` converties en `REJECTED` dans le processeur, anomalie dans la même transaction que `record_device_seq REJECTED`).
- À signaler : l'étape « grand livre `LOCKED` » existe en lecture seule (l.569) mais `SYNC_DEADLINE_PASSED` n'a aucun code, ni message (`http/messages.*.json` ne le contient pas ; il est dans openapi). Voir §6.3.

### 2.4 Ce que fait déjà le moteur pour l'idempotence
- `writeLines` (l.104-117) : verrou de clé puis lecture de l'existant par `(ledger_id, idempotency_key)` ; même clé et même type → `replayed:true` ; autre type ou autre empreinte (`engine_command_sha256`) → `IDEMPOTENCY_KEY_REUSED`. Étape 3 de §7.1 (« transaction déjà écrite en ligne ou via la passerelle ») peut donc se lire par `findTransactionId`/`readExisting` (non exporté : `readExisting` est une fonction privée de fichier, l.~520). Reco : exporter une lecture `findByKey(ledgerId, key)`.
- Point d'attention : l'empreinte du moteur (`commandFingerprint`, l.~493) exclut la date et les métadonnées. Une vente écrite en ligne (source `ONLINE`) puis renvoyée en lot (source `OFFLINE_SYNC`) a une empreinte différente (le champ `source` en fait partie) : `IDEMPOTENCY_KEY_REUSED`. Il faut donc traiter le doublon AVANT d'appeler le moteur (étapes 2 et 3 de §7.1), en comparant `content_sha256` au registre, jamais en rappelant le moteur.

### 2.5 Ce qui manque pour les règles de §7.3 (liste)
1. Résultat `tap` → `(couvert, manque, raison)` : table de décision à coder (fonction pure `conflictOutcome(tapResult, balances, tBlock, occurredAt, snapshotGeneratedAt, tol)`), à tester par table.
2. Lecture de `t_blocage` : requête sur `media_status_history`, `media_batch_status_history`, et statut du portefeuille (aucun historique de statut de portefeuille cité dans le plan : vérifier le schéma).
3. `forceUncovered` dans le payload de `PURCHASE`.
4. `OFFLINE_SHORTFALL` et `ACCEPTED_WITH_SHORTFALL` (voir 2.1.1).
5. Anomalies `SIGNATURE_MISMATCH` (signature absente alors que la puce en a une), `ONLINE_CONFIRMED_MISSING`, `VOID_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `NON_COMPLIANT_OPERATION`, `PERIOD_CLOSED_OPERATION`, `LATE_OFFLINE_SYNC`, `CLOCK_SKEW` : toutes dans la liste fermée du schéma (l.847-852). Le seul INSERT d'anomalie du code existant est `CLOCK_SKEW` (`payments.service.ts:186-190`). Reco : un `AnomalyWriter` (INSERT dans `anomaly`, droit `cashless_app` : INSERT accordé par `roles.sql`) ou une fonction SQL unique.
6. Contrôles de conformité §7.2 : tous sont à coder (devise, politique à `occurred_at`, plafonds de `policy_in_force(terminal, config_id)`, version de snapshot, âge, `MEDIA_NOT_IN_SNAPSHOT`, `MEDIA_BLOCKED_IN_SNAPSHOT`, `MEDIA_WRONG_EVENT`, `PACK_NOT_VERIFIED`). Les tables sources existent (`offline_policy_history`, `device_config_served`, `offline_snapshot` + contenu) mais aucune lecture dans l'API.

---

## 3. Port de clés — `kms/`

### 3.1 Interface et faux
- Fait : `kms/kms.ports.ts` définit quatre ports : `MacPort.generateMac(ref, message)` (HMAC_256), `DataKeyPort.generateDataKey(wrappingRef)`, `DecryptPort.decrypt(wrappingRef, encrypted)`, `KeyAdminPort.createKey/disableKey`. Types de clé : `'HMAC_256' | 'SYMMETRIC_DEFAULT'` seulement. Jetons : `MAC_PORT, DATA_KEY_PORT, DECRYPT_PORT, KEY_ADMIN_PORT`.
- Manque : AUCUNE opération de signature (`sign`/`verify`), AUCUN type de clé asymétrique (`ECC_NIST_P256`), pas de lecture de clé publique. Or `snapshot_signing_key` (schéma l.2290-2308) exige `algorithm IN ('ECDSA_P256_SHA256','Ed25519')`, `public_key bytea`, `kms_key_ref`. Reco : nouveau port `SignPort { sign(kmsKeyRef, message: Uint8Array): Promise<Buffer>; publicKey(kmsKeyRef): Promise<Buffer> }` (jeton `SIGN_PORT`), capacité `'sign'` dans `KmsCapability`, et `KmsKeyKind` étendu à `'ECC_P256_SIGN'`. Cela suit le principe « un port par droit » du fichier (en-tête l.1-9).
- Fait : `FakeKms` (`kms/fake-kms.ts`) : `isFake = true` (l.41), clés dérivées d'une graine fixe dans le code (l.21), `failNext(operation, count)` pour simuler une panne, compteurs `calls`. Il implémente les quatre ports. Pour le faux de signature : générer la paire P-256 déterministe depuis la graine et la référence (ou stockée en mémoire du processus ; les processus sont distincts, donc déterministe est nécessaire pour qu'une clé créée par `key-admin` signe dans le producteur de snapshots). `ECDSA` en `node:crypto` (`sign('sha256', …, {dsaEncoding:'ieee-p1363'})`).
- Reco : l'adaptateur AWS reste en 12b ; le port ne doit pas coder AWS (le `kms_key_ref` est une chaîne opaque).

### 3.2 Garde de production
- Fait : `kms/production-guard.ts` : `assertNoFakeInProduction(production, providers)` lève `FakeInProductionError` si un fournisseur a `isFake === true` (l.20-29). `assertSafeTransport` (l.51-61) pour TLS.
- Fait : `kms/kms.module.ts:13-16` `createKms(config)` lève `FakeInProductionError` en production avant même de construire le faux.
- Fait : `processes/bootstrap.ts:31-44` `assertProcessIsSafe(app)` énumère huit fournisseurs (service de clés, identité terminal, identité festivalier, autorité des terminaux, signataire de jetons, vérificateur d'attestation, adaptateurs PSP, coffre PSP). Appelée par `serve` (l.111) et `runWorkers` (l.143).
- Tests : `test/unit/production-guard.spec.ts` (un test par faux), `test/unit/kms/kms-module.spec.ts`, `test/unit/kms/identity-guards.spec.ts`, `test/integration/end-to-end/psp-production.spec.ts`.
- Reco : pas de nouveau jeton si le signataire de snapshots est le même fournisseur (`KMS_PROVIDER`). Si l'on crée un `SNAPSHOT_SIGNER` distinct, l'ajouter à la liste de `bootstrap.ts:33-42` ET un test dans `production-guard.spec.ts` (règle du porteur n°2).

### 3.3 Signatures et clés d'accord des terminaux
- Fait : signature du terminal ECDSA P-256 / SHA-256 (`device-identity/request-signature.ts`, `SIGNATURE_ALG='ecdsa-p256-sha256'`, format brut `r‖s` 64 octets `ieee-p1363`). Jetons d'appareil ES256 (`device-tokens/token-signer.port.ts:8`).
- Fait : les clés d'accord DES TERMINAUX EXISTENT. `device.agreement_public_key` (point P-256 non compressé, 65 octets, `enroll_device` exige `octet_length = 65`, migration 0022:375). Lue dans `DeviceContext.agreementPublicKey` (`device-identity/device-identity.port.ts:30-31`), posée par `device.guard.ts:77` et `device-identity.module.ts:43-90`. Attestée à l'enrôlement (`attestation/*`).
- Fait : enveloppe pour un terminal : `@cashless/tag-format` (`packages/tag-format/src/device-envelope.ts`) : `sealForRecipient({recipientPublicKey, plaintext, aad})` (ECDH-ES + HKDF-SHA256 + AES-256-GCM, `RECIPIENT_ALG = 'ECDH-ES+HKDF-SHA256+A256GCM'`), `openForRecipient`, `deviceAad(deviceId, uid)`, `stationAad`. Utilisée par `media/auth-keys/auth-keys.service.ts:90-98` pour `POST /media/auth-keys`.
- Manque pour le snapshot (§4.1-4) : la clé de contenu propre à la version doit être enveloppée « pour chaque terminal (`pwd_pack_key`, ECDH-ES P-256 sur sa clé d'accord) ». `sealForRecipient` est la brique, mais l'AAD `deviceAad(deviceId, uid)` est faite pour un bracelet. Il faut une AAD de snapshot (ex. `"CASHLESS/SNAPKEY/v1" ‖ ledger_id ‖ version ‖ device_id`) : nouvelle fonction dans `packages/tag-format/src/device-envelope.ts` (le paquet est partagé avec la future app : vérifier que l'ajout ne casse pas les vecteurs du kit).
- Fait (mots de passe des bracelets) : `media.pwd_pack_enc` (34 octets : nonce 12 + AES-256-GCM(PWD‖PACK 6 o) + tag 16), `pwd_pack_dek_id` → `tag_data_key` (clé de données, elle-même enveloppée par la clé d'emballage du KMS : `wrapping_kms_key_ref`). AAD `pwdPackAad({mediaId, operatorId, keyIndex, uid})` (`CASHLESS/PWDPACK/v1`). Schéma l.280-292.
- Qui peut lire ces secrets : `cashless_app` NE PEUT PAS lire `pwd_pack_enc` (`post-roles.sql:170-177` retire SELECT sur `media` puis ne rend que certaines colonnes) ni `tag_data_key.encrypted` (l.192-193). La vue `offline_snapshot_rows` (schéma l.2360-2377) porte `pwd_pack_enc, pwd_pack_dek_id` ; `post-roles.sql:196` : `REVOKE ALL ON offline_snapshot_rows FROM cashless_app`. Le processus qui lit `pwd_pack_enc` est `cashless_tagkeys` (`GRANT SELECT (… pwd_pack_enc, pwd_pack_dek_id) ON media`, post-roles l.284) et ouvre avec `DecryptPort` : `media/keys/*`, `media/auth-keys/auth-keys.service.ts` (cache `DekCache`, `zeroize`).
- CONSÉQUENCE POUR LE PLAN : le producteur de snapshots ne peut ni tourner dans l'API publique (aucun droit sur les secrets ni port `decrypt`) ni utiliser `cashless_app` pour lire la vue. Il lui faut un processus et un rôle de base dédiés (voir §5), dont les droits lisent `offline_snapshot_rows`, écrivent `offline_snapshot`, et dont les ports sont `DecryptPort` + `SignPort`. Un fichier de droits `post-roles.sql` + test `tests_execute_grants.sql`/nouveau test de droits doivent le figer. Fichier à faire relire par une personne (règle du porteur n°4) : droits de base, chiffrement/enveloppe, signature.

---

## 4. Authentification du terminal et vérification d'une signature de lot

- Fait : trois preuves sur chaque requête (`device-identity/real-device-identity.ts:1-26`) : certificat mTLS (`socket.authorized`, empreinte = `device.cert_sha256`), jeton d'appareil (`Authorization: Bearer`, `cnf.jkt` = empreinte RFC 7638 de `device.public_key`), signature RFC 9421 `dev` de la requête (composants `@method, @authority, @path, @query, content-digest, x-request-id` et `idempotency-key` si présent), nonce consommé. Garde : `@DeviceAuth({allowSuspended?, nfcOnly?})` (`device-identity/device.guard.ts`).
- Fait : `DeviceContext` porte `deviceId, operatorId, eventId, posId, agreementPublicKey, serial, appMode, os, nfcEnabled, personalPhone, merchantId, participationId`. `DeviceRecord` (même fichier port, l.55-63) ajoute `publicKey` (SPKI DER P-256), `certSha256`. `DeviceContext` NE porte PAS `publicKey`. `device-identity.module.ts` lit `public_key` (l.56). Reco : pour vérifier la signature du lot, lire `public_key` en base dans la transaction du lot (`SELECT public_key FROM device WHERE id=$1`), ou l'ajouter à `DEVICE_DETAILS_QUERY` (attention : « lus par l'API publique seule, jamais par le processus des clés », `device-identity.port.ts:36-38`).
- Comment vérifier une signature de lot : `createPublicKey({key: spki, format:'der', type:'spki'})`, puis `crypto.verify('sha256', Buffer.from(canonicalize(header)), {key, dsaEncoding: 'ieee-p1363'}, sig)`. C'est le geste de `request-signature.ts` (`verify` importé de `node:crypto`). Le message signé est `JCS(header)` (openapi `OfflineBatch.signature`, sync_protocol §10.3). Le test peut signer avec `TestTerminal`.
- CONTRADICTION à signaler (sans trancher) : l'exemple de signature de lot dans `openapi.yaml:4158` (`MEUCIQCq2...base64`) est du DER (`30 45 02 21`), alors que la description de la signature des requêtes précise `r‖s` 64 octets `ieee-p1363` en base64 (openapi l.11829) et que `OfflineBatch.signature` (l.13553) ne dit que « ECDSA P-256 sur JCS(header) ». Le format (DER ou brut) n'est pas fixé pour les lots : à arbitrer avant d'écrire le vérificateur (le plus simple : accepter le brut 64 octets comme les requêtes).
- Fait : `BATCH_SIGNATURE_INVALID` a un message (fr/en) mais AUCUN SQLSTATE (le code est levé par l'API, `400`).
- Fait : `header` ne contient pas `op_hashes` ; `open_offline_batch` reçoit `p_op_hashes` et `p_signature` et vérifie la cohérence interne de la chaîne. L'API doit donc recalculer `content_sha256` de CHAQUE opération du lot (et le comparer au chaînage) avant d'appeler `open_offline_batch`.
- Terminal suspendu : `@DeviceAuth({allowSuspended:true})` (exemple `devices/heartbeat/heartbeat.controller.ts:30`) : sync_protocol §10.5 veut qu'un terminal `SUSPENDED` puisse envoyer ses lots. Terminal `REVOKED` : refusé (`42501` → `403 DEVICE_REVOKED`, `errors/sqlstate-map.ts:67`) ; `open_offline_batch` lève aussi `insufficient_privilege` si révoqué.
- Le jeton d'appareil et le nonce n'imposent pas d'`Idempotency-Key` sur `POST /offline-batches` ; l'intercepteur d'idempotence (`idempotency/idempotency.interceptor.ts`) accepte une clé libre quand la route n'est pas `deviceSeq` (clé de lot = `batch_id`, openapi l.4046-4048). Prévoir `@Idempotent({ scope: deviceScope })` SANS `deviceSeq`, et un contrôle `Idempotency-Key === header.batch_id`.

---

## 5. Processus planifiés et alertes

### 5.1 Modèle
- Fait : `processes/worker.ts` : interface `ProcessWorker {name, runOnce(): Promise<number>, describe?(), alarm?(): number}` et `WorkerRegistry` (`register`, `runOnce`, `drain(maxPasses=1000)`, `alarm()`, `describe()`).
- Fait : `processes/bootstrap.ts` `runWorkers(rootModule, argv)` (l.140-164) : `--list`, `--once` (traite tout puis rend `workers.alarm()` comme code de sortie : « l'ordonnanceur alerte sur tout code non nul »), sinon boucle `drain` toutes les `TAG_JOB_POLL_SECONDS` (5 s par défaut, 0..3600). `serve(rootModule, port)` (l.97-134) fait tourner les travailleurs du registre dans le processus HTTP à intervalle.
- Modèle à suivre : processus `psp-poller`.
  - Entrée : `main.psp-poller.ts` (10 lignes) + script `start:psp-poller` (`apps/api/package.json:13`).
  - Module : `processes/psp-poller.module.ts` (importe `PspPollerDbModule`, `ProcessBaseModule`, `AuditModule`, `PspModule`, `PspPollerModule`).
  - Accès base : `db/psp-poller-db.module.ts` = UN pool sur `DATABASE_URL_APP` (rôle applicatif), pas de `PlatformTx`.
  - Travailleurs : `topups/poller/{psp-topup-poller,psp-event-retry,psp-event-purge}.worker.ts`, codes d'alerte `topups/poller/poller-alarms.ts` (2 interrogation en échec, 3 événement abandonné, 4 purge en échec).
  - Modèle plus proche (alerte d'écart) : `media/daily-check/daily-check.worker.ts` (24 h entre passages, `ALARM_MISMATCH=2`, `ALARM_KMS_ERROR=3`, `describe()` liste ce qui est dû).
  - Modèle d'un processus à rôle de base propre : `db/process-db.module.ts` (`KeyProcess`, `KEY_PROCESS_URL`, config `*DatabaseUrl` + variable `DATABASE_URL_*`) et `kms.module.ts` (`KmsModule.forCapabilities([...])`).
- Fait : le processus tag-check illustre la combinaison « rôle propre + ports KMS limités » (`processes/tag-check.module.ts`).

### 5.2 Recommandation pour le producteur de snapshots
- Producteur (60 s si changement, ≤ 5 s après un changement bloquant) : nouveau processus `snapshots`, entrée `main.snapshots.ts`, module `processes/snapshots.module.ts`, script `start:snapshots`, variable `DATABASE_URL_SNAPSHOTS` (même motif que `tagUrl()` dans `config/config.ts:711-712` et `LOCAL_TAG_URLS`). Ports : `DecryptPort` + `SignPort` seulement (`KmsModule.forCapabilities(['decrypt','sign'])`). Travailleur `SnapshotProducerWorker` : `runOnce()` rend le nombre de grands livres traités.
- Le délai de 5 s impose un déclencheur plus fin que le `TAG_JOB_POLL_SECONDS` de 5 s par défaut (au mieux 5 s + durée de génération). Options à trancher par le plan : intervalle propre `SNAPSHOT_POLL_SECONDS` (1 s) avec détection de changement (version max des statuts) ou notification `LISTEN/NOTIFY`. Aucun code existant ne fait de `LISTEN/NOTIFY`.
- Seuil du porteur : FULL de 50 000 bracelets en 30 s, DELTA 2 s p95 : mesure à prévoir comme test de latence (écarté sous `SKIP_LATENCY`, voir §9).
- Alerte « trou > 24 h » : n'existe nulle part. Reco : travailleur `SeqGapAgeWorker` (modèle `DailyCheckWorker`) qui lit les anomalies `SEQ_GAP` ouvertes de plus de 24 h (`anomaly.created_at`) et fixe `alarm() = 2`. Le porteur a dit « alerte seulement » : aucune action automatique.
- Mécanisme d'alerte d'exploitation existant : UNIQUEMENT le code de sortie de `--once` (ordonnanceur externe) + `Logger`/`console.error`. Aucune notification, aucun journal d'alertes en base. Les alertes `CHAIN_BROKEN` du contrat (« alerte, examen manuel ») n'ont donc pas de support : consigner dans `POINTS_OUVERTS`, ou créer l'anomalie (déjà prévue par `open_offline_batch`) et lire les anomalies ouvertes dans un travailleur.
- Fait utile : `serve()` n'enregistre les travailleurs de l'API publique que par `WorkerRegistry` du module racine (`app.module.ts`) ; `DevicePurgeWorker` s'y inscrit par `onModuleInit` (`device-identity/device-maintenance.ts:37-40`).

---

## 6. Approbations, audit, erreurs, cloisonnement

### 6.1 Actions `WAIVE_SEQ_GAP` et `DEVICE_JOURNAL_IMPORT`
- Fait : les deux actions sont DÉJÀ dans l'énumération `ApprovalAction` (contrats : `packages/contracts/openapi.yaml:14319`, type `components['schemas']['ApprovalAction']` utilisé par `approval/action-registry.ts:9-12`) et dans le CHECK de `approval_request.action` (schéma l.2911, migration 0011:25-26). Rôle exigé : `SUPERVISOR` (`docs/SPECIFICATION.md:204-205`). Aucune implémentation dans `apps/api/src`.
- Modèle à suivre : `cash-sessions/cash-deposit-action.ts` (classe `CashDepositActions`) :
  - le constructeur appelle `registry.register(this.definition())` (l.51-60) ; fournisseur à déclarer dans le module de la mission ;
  - `request(client, operatorId, input, actor)` crée la demande via `ApprovalService.request(client, operatorId, {action, targetId, payload}, actor)` (`approval/approval.service.ts:69`) puis écrit l'audit ;
  - `definition()` : `action`, `requiredRole` (liste ou rôle unique, `StaffRole`), `scopeOf(payload)`, `validate(payload)` (422), `execute(client, {request, payload, requestedBy, approvedBy})` → `{result, executedTxId?}` ;
  - une `ProblemException` ou une erreur SQL traduisible fait passer la demande `FAILED` (le motif lisible vient du dictionnaire `SQL_FAILURES` local, ex. l.35-40).
  Autre modèle : `reversals/sale-reversal-action.ts` (rôle en liste).
- `WAIVE_SEQ_GAP` : `execute` appelle `waive_seq_gap(device, seq, requestedBy, approvedBy, reason)` (schéma l.2090-2115). Erreurs : `CL012 SEQ_GAP_NOT_FOUND` (409) si le numéro n'est pas un trou, `CL010 BATCH_IN_PROGRESS` si un lot en cours le couvre. Le registre applique lui-même « deux personnes distinctes » (`device_seq_registry_check2` dans `DOUBLE_VALIDATION_CONSTRAINTS`, `errors/sqlstate-map.ts:93-94`). Motif ≥ 10 caractères (spec FR de la mission). `scopeOf` : événement du terminal (lu en base, jamais d'un corps — comme `CashDepositActions.request`, l.74-84).
- `DEVICE_JOURNAL_IMPORT` : AUCUNE fonction SQL (`importDeviceJournal` n'existe pas dans le schéma ni les migrations ; recherche vide). Conception entière à faire, fonction `SECURITY DEFINER` incluse. Terminal `REVOKED` seulement ; vérification des signatures des lots d'export avec l'ancienne clé publique du terminal (`device.public_key` reste en base après révocation : à vérifier dans `set_device_status`).
- Droits : aucune de ces fonctions n'est accordée à `cashless_app` (`post-roles.sql` : pas de `waive_seq_gap`, `open_offline_batch`, `complete_offline_batch`, `device_missing_seqs`, `advance_device_chain`). La liste d'EXECUTE est exhaustive et vérifiée par `packages/ledger-sql/tests/tests_execute_grants.sql` (liste figée). Reco : migration 0043 qui `REVOKE ALL … FROM PUBLIC` les nouvelles fonctions + `GRANT EXECUTE` dans `post-roles.sql` + mise à jour de la liste figée du test.

### 6.2 Audit — `audit/audit.service.ts`
- Fait : `AuditService.record(client, {…actor.audit, operatorId, action, objectType, objectId, after})` écrit dans la même transaction (chaînage posé par la base, migration 0004). Le type `AuditAction` (l.8-…) est une UNION FERMÉE de chaînes : toute nouvelle action doit y être ajoutée (ex. `SEQ_GAP_WAIVE_REQUESTED`, `SEQ_GAP_WAIVED`, `DEVICE_JOURNAL_IMPORT_REQUESTED`, `DEVICE_JOURNAL_IMPORTED`, `OFFLINE_SNAPSHOT_PRODUCED`, `OFFLINE_BATCH_REJECTED`). Vérifier qu'aucune contrainte SQL ne liste les actions d'audit (non vérifié ici).
- Les processus sans personne (producteur, lots) n'ont pas d'`AuditContext` de personne : voir `audit/audit-context.ts`. À trancher : l'audit d'un lot de terminal est-il un `AuditContext` « terminal » ? Le journal d'audit n'est pas l'endroit des opérations de lot (registre + anomalies suffisent).

### 6.3 Erreurs
- Fait : `errors/sqlstate-map.ts` — `CL007→INSUFFICIENT_FUNDS 422`, `CL010→BATCH_IN_PROGRESS 409`, `CL011→BATCH_TOO_LARGE 413`, `CL012→SEQ_GAP_NOT_FOUND 409`, `CL015→STALE_AUTHORITY_EPOCH 409`, `CL016→SEQ_OUT_OF_ORDER 409`, `CL017→CHAIN_BROKEN 409`, `CL021→SEQ_OUT_OF_RANGE 409`, `CL022→TAP_UNUSABLE 409`, `42501→DEVICE_REVOKED 403`. Les messages fr/en sont dans `http/messages.fr.json` et `http/messages.en.json` (clé = code, `{title, detail}`).
- Codes présents dans openapi, absents de l'API (`messages.*.json` = 0 occurrence, `sqlstate-map` = 0) : `POLICY_LIMIT_EXCEEDED`, `SNAPSHOT_TOO_OLD` (1 occurrence yaml chacun), et d'autres raisons de rejet de `OfflineRejectReason`. Ces raisons sont des champs de RÉSULTAT par opération (pas des erreurs HTTP), mais `ProblemCode` de `@cashless/contracts` doit les connaître si on les met dans un `ProblemException`. Le test de contrat qui compare les codes aux messages est à relancer (chercher `messages` dans `test/unit/errors`).
- Présents (messages) : `OFFLINE_NOT_ALLOWED`, `SNAPSHOT_VERSION_UNKNOWN`, `BATCH_IN_PROGRESS`, `BATCH_SIGNATURE_INVALID`, `CHAIN_BROKEN`, `SEQ_OUT_OF_RANGE`, `PERIOD_CLOSED`, `IDEMPOTENCY_KEY_REUSED`.
- CONTRADICTION à signaler (sans trancher) : `SEQ_OUT_OF_ORDER` vaut `409` dans `sqlstate-map.ts:30` (CL016, `edge_seq`), mais `400` pour « lot de terminal non continu » (openapi l.4066 et l.11286, SPECIFICATION l.514). Même code, deux statuts : le contrôle d'un lot non continu est fait par l'API, sans SQLSTATE, et doit lever `ProblemException('SEQ_OUT_OF_ORDER', {status: 400})`.
- Erreurs à ajouter si besoin : `SYNC_DEADLINE_PASSED` (message absent), `SNAPSHOT_*`. Étapes : `packages/contracts` (ProblemCode, régénérer types TS et Dart), `messages.fr/en.json`, test de couverture.

### 6.4 Cloisonnement
- Fait : `db/tenant-tx.ts` `TenantTx.run(operatorId, fn)` : BEGIN → `set_config('app.operator_id', $1, true)` → fn → COMMIT ; `withoutTenant(fn)` sans prestataire (l.78) pour les purges. RLS FORCE sur `device_seq_registry`, `offline_batch`, `offline_policy_history`, `device_config_served`, … (schéma l.2875-2883) avec la politique `operator_id = current_setting('app.operator_id')`. `snapshot_signing_key` : lecture des clés de la plateforme (`operator_id NULL`) par tous, écriture seulement pour son propre prestataire (l.2884-2893). Les fonctions de lot font `assert_tenant(tenant_of_device(...))`.
- Reco : tout traitement de lot passe par `TenantTx.run(device.operatorId, …)` (jamais `withoutTenant`). Le producteur de snapshots itère sur les grands livres de TOUS les prestataires : il lui faut une lecture sans prestataire (comme `DailyCheckService.operators()` qui fait `app.operator_id` = identifiant nul, `tenant-tx.ts:~95`) puis une transaction par prestataire. Tests de cloisonnement : modèle `test/integration/end-to-end/payment-isolation.spec.ts` et `isolation-sweep.spec.ts` (balayage de routes : y ajouter les nouvelles routes).

---

## 7. Configuration servie au terminal

### 7.1 `devices/config/device-config.service.ts`
- Fait : `build(client, device, language, deliver)` (l.127-253) : verrou `FOR NO KEY UPDATE` du terminal, `record_config_served(device)` (migration 0029) qui rend `config_id` (= `device_config_served.id`, `Number(s.config_id)` l.209), `next_seq_floor`, `terminal_settings`, politique. `config_id` change seulement si politique, époque, plancher, version de config ou réglages changent (migration 0029:61-66 : déduplication). L'ETag est le SHA-256 du JCS du corps hors `server_time` (l.94-100).
- Fait : politique hors ligne DÉJÀ servie : `offline_policy {offline_enabled, max_per_sale, max_per_media_per_device, max_total_per_device, max_snapshot_age_seconds, cash_topup_offline, capped}` (l.232-240), lue de `effective_offline_policy(device)` (migration 0029:55).
- Manque : `snapshot_keys: []` figé (l.241-243) : « hors ligne impossible, refus par défaut ». Reco : lire `snapshot_signing_key` (ACTIVE et RETIRED récente, au plus deux clés par signataire, §4.1-5) et servir `{key_id, algorithm, public_key}` — changer ce champ change l'ETag, donc le battement de cœur suivant. `heartbeat.controller.ts:41-46` rend `latest_snapshot_version: null` et `sync_requested: false` en dur : à remplacer (dernière version du grand livre du terminal, et `sync_requested` posé quand l'événement passe en `CLOSING`, §7.5).
- Contenu servi : aucun PIN, aucune empreinte de PIN, aucun secret. Vérifié : `terminal_settings` = neuf réglages numériques de l'événement (migration 0029:45-54 : `online_connect_timeout_ms, online_total_timeout_ms, online_retries, pending_sync_seconds, reconcile_sync_seconds, heartbeat_seconds, reversal_window_minutes, local_retention_days, tap_replay_window_seconds`). Le corps contient `device {device_id, serial, kind, app_mode, os, nfc_enabled, status, station_name}`, `event`, `pos {pos_id, name, merchant_name}`, `catalog`, `debit_authority`, `seq {next_seq_floor, contiguous_acked_seq}`, `server_time`, `clock_tolerance_seconds`. Le PIN est servi nulle part ici (vendeurs : `vendor-pin/`, hors configuration). Attention : le test `test/integration/end-to-end/device-secrets.spec.ts` existe déjà pour ce sujet.
- Remarque : le contrat §7.2 impose de conserver « l'historique des politiques effectives et versions de configuration servies à chaque terminal » : c'est `device_config_served` (immuable, RLS) et `offline_policy_history`. Le contrôle de plafonds d'une opération doit relire la ligne `device_config_served` portant `op.config_id` POUR CE TERMINAL ; `config_id` absent/inconnu/autre terminal = `POLICY_LIMIT_EXCEEDED`. Aucune lecture dans l'API aujourd'hui.

### 7.2 `configuration/sql-config-resolver.ts`
- Fait : ce n'est PAS la configuration servie au terminal : c'est le résolveur de configuration FINANCIÈRE du moteur d'écritures (port `CONFIG_RESOLVER`) : cascade, contrat, profil de législation, règles de frais en vigueur, `configVersionId`, `offlineLossBearer`, `cashDiffBearer` (l.126, 188-190). Aucun lien avec `device_config_served.id`. Ne pas confondre `config_id` (terminal) et `configVersionId` (écriture, `journal_transaction.config_version_id`).
- Reco : pour une opération de lot, `occurredAt` passé au moteur règle la version de configuration financière en vigueur à la date de l'opération (comportement voulu : « figée à la date de l'opération »).

---

## 8. Écritures directes sur `device` et purges (OP-N69, OP-N75, ADR-125)

### 8.1 UPDATE directs de `device` par l'application
- Fait : AUCUNE requête `UPDATE device` ni `INSERT INTO device` dans `apps/api/src` (recherche sur `UPDATE device`, `device SET`, multi-lignes comprises : vide). Aucun appel TypeScript n'écrit `next_seq_floor`, `last_seen_at`, `station_name` ni `last_snapshot_version`.
- Fait : les écritures de ces colonnes passent déjà par des fonctions `SECURITY DEFINER` :
  - `last_seen_at`, `app_version` : `record_device_heartbeat` (`devices/heartbeat/heartbeat.controller.ts:35`), `record_device_seq` (schéma l.2072 : `UPDATE device SET last_seq, last_seen_at`).
  - `station_name`, `next_seq_floor` : `enroll_device` (`devices/enrollment/enrollment.service.ts:170`), numérotation reprise à l'enrôlement (`next_seq = max_seen_seq + 1`).
  - `status` : `set_device_status` (`devices/admin/device-admin.service.ts:129`).
  - `last_snapshot_version` : AUCUNE fonction (le schéma le décrit « dernier snapshot accusé » ; la route `ackOfflineSnapshot` n'existe pas encore).
- Droits actuels : `packages/ledger-sql/post-roles.sql:533-534` : `REVOKE INSERT, UPDATE ON device FROM cashless_app; GRANT UPDATE (station_name, last_snapshot_version, last_seen_at, next_seq_floor) ON device TO cashless_app;`. (`roles.sql` donne d'abord `INSERT, UPDATE ON ALL TABLES` à `cashless_app`, puis des REVOKE ciblés.) Test qui échoue si la liste s'élargit : `packages/ledger-sql/tests/tests_device_rights.sql` §1.
- Conséquence pour la levée d'OP-N69 : retirer le `GRANT UPDATE (…) ON device` ne casse AUCUN appel TypeScript existant. Il faut seulement : (a) une fonction `ack_offline_snapshot(device, version)` `SECURITY DEFINER` pour `last_snapshot_version` (monotone, version connue du grand livre du terminal), (b) une fonction pour relever le plancher (`next_seq_floor` ne descend jamais) si une route de l'API doit encore le modifier (aucune ne le fait aujourd'hui), (c) mettre à jour `tests_device_rights.sql` (liste exacte → vide) et le commentaire de `post-roles.sql:517-532`. La « dernière présence » est déjà posée par les fonctions.
- À valider par pgTAP côté base avant de retirer le droit : liste figée de `tests_execute_grants.sql`.

### 8.2 Purges
- Fait : un seul appelant. `device-identity/device-maintenance.ts` :
  - l.55-56 `SELECT purge_device_request_nonces($1)::text` (lot de 1000, `NONCE_PURGE_BATCH`, l.18) ;
  - l.59 `SELECT purge_device_enrollment_attempts()::text`.
  Le travailleur `DevicePurgeWorker` (l.30-72) s'enregistre lui-même dans `WorkerRegistry` par `onModuleInit` (l.37-40). Intervalle `DEVICE_PURGE_INTERVAL_SECONDS` (1..86 400, 300 par défaut, l.17-26). Il est chargé par `devices/devices.module.ts:6,17` (`DeviceMaintenanceModule`), donc dans l'API publique, sous le pool `cashless_app` via `TenantTx.withoutTenant` (l.54).
- Droits : `post-roles.sql` section 4a (l.456-472) : EXECUTE à `cashless_app` de `purge_device_request_nonces(integer)` et `purge_device_enrollment_attempts()`. Tests : `tests_device_purge_window.sql`, `tests_execute_grants.sql`.
- Autres purges du même motif : `purge_psp_event_bodies` (`topups/poller/psp-event-purge.worker.ts:49`, processus psp-poller) — hors OP-N75 mais même conception. OP-N78 (`vendor_pin_check` sans purge) demande « le même rôle dédié » : prévoir sa fonction de purge dans le même rôle.
- Reco (OP-N75 + ADR-125) : processus `maintenance` (entrée `main.maintenance.ts`, module `processes/maintenance.module.ts`, script `start:maintenance`), pool unique sur `DATABASE_URL_MAINT` (rôle `cashless_maint`, créé dans `roles.sql`/`post-roles.sql`), `DevicePurgeWorker` déplacé hors de `DevicesModule`. `EXECUTE` retiré à `cashless_app`. Test « l'API publique ne charge plus `DeviceMaintenanceModule` » dans le genre de `test/unit/architecture.spec.ts`.

### 8.3 `loadConfig` et ses secrets (ADR-125, OP-N77)
- Fait : `config/config.ts:695-735` `loadConfig(env)` est COMMUN à tous les processus. En production il exige : `DATABASE_URL_APP`, `DATABASE_URL_PLATFORM` (l.697-708), `CLAIM_CODE_HMAC_KEY` (l.714, `claimCodeHmacKey`), les serveurs d'identité OIDC (`loadOidc`), `TAG_WRAPPING_KEY_REF`, `CLAIM_CODE_DOMAIN`, `TRUST_PROXY_HOPS`, puis via `deviceSettings(env, production, claimKey)` les secrets `IDEMPOTENCY_HMAC_KEY`, `ENROLLMENT_CODE_HMAC_KEY`, `VENDOR_PIN_SECRET`, `VENDOR_PIN_IDEMPOTENCY_SECRET` (champs `idempotencyHmacKey`, `enrollmentCodeHmacKey`, `vendorPinSecret`, `vendorPinIdempotencySecret`, l.82-96), plus les fichiers TLS et autorité des terminaux. Les secrets de test sont refusés en production (`TEST_HMAC_KEYS`, l.202-209, l.233).
- Les quatre chaînes de rôles clés (`DATABASE_URL_TAGKEYS/PERSO/TAGCHECK/KEYADMIN`) ne sont refusées vides que par le processus qui s'en sert (`tagUrl`, l.711-712 : chaîne vide en production, et le processus lève).
- Pour la connexion de maintenance (ADR-125) : ajouter `maintenanceDatabaseUrl` + `DATABASE_URL_MAINT` sur le motif de `tagUrl` (vide en production, refus par le processus de maintenance seul), pas de nouveau secret HMAC obligatoire pour les autres processus. Test dans `test/unit/config.spec.ts` (liste fermée des secrets obligatoires). Le processus de maintenance et le producteur de snapshots NE doivent PAS exiger `VENDOR_PIN_SECRET`, `IDEMPOTENCY_HMAC_KEY`, etc. (OP-N77 : « chaque processus ne reçoit que ses secrets » est levée en mission 13, mais ne pas l'aggraver). Reco : un `loadConfig` partiel par processus est hors périmètre ; documenter dans l'ADR que les nouveaux processus héritent de la limite OP-N77.

---

## 9. Tests

### 9.1 Structure
- `apps/api/test/unit/` : tests purs (sans base). Pertinents : `payments/device-seq-registry.spec.ts` (vecteurs), `payments/operation-time.spec.ts`, `kms/*.spec.ts`, `production-guard.spec.ts`, `processes.spec.ts`, `architecture.spec.ts` (dépendances entre modules), `config.spec.ts`, `status-matrix.spec.ts`, `request-signature.spec.ts`, `builders/`, `money/`, `errors/`.
- `apps/api/test/integration/` : avec base PostgreSQL réelle. Dossiers : `payments/`, `devices/`, `engine/` (`engine.spec.ts`, `mini-fixture.ts`, `topup-cash-split.spec.ts`), `reversals/`, `topups/`, `cash-sessions/`, `media/`, `transverse/`, `end-to-end/` (parcours `*-journey`, `*-isolation`, `*-secrets`, `*-latency`, `*-concurrency`, `isolation-sweep`, `device-auth-matrix`, `payment-concurrency`, `psp-production`). Il n'existe PAS de dossier `test/end-to-end` : il se trouve sous `test/integration/end-to-end/`.
- `apps/api/test/scenario/` : rejeu du scénario de référence (`replay.spec.ts`, `api-config-replay.spec.ts`, `commands.ts`, `fixture.ts`). La transaction 22 du scénario est la référence du manque hors ligne : `scenario_reference.json`, `scenario_reference_test.sql` (générés ; ne pas modifier les `.sql`).
- `apps/api/test/support/` : `app.ts` (`createTestApp`, `createKeyProcess`, `startHttpsApp`, `HeaderTenantContext`, en-tête `X-Test-Operator-Id`), `db.ts` (URLs des rôles, `resetDatabase`, `withOwner`, `connect`), `test-terminal.ts` (classe `TestTerminal`, voir ci-dessous), `fake-device.ts` (`createTestDevice`), `device-e2e.ts` (`enrollFrom`, `refresh`, `issueCode`…), `fake-customer.ts`, `fake-idp.ts`, `cash-fixtures.ts`, `media-fixtures.ts`, `seed-cash-session.ts`, `key-jobs.ts`, `tls.ts`, `attestation/`, `contract-schema.ts`.
- Jest : `apps/api/jest.config.cjs`, `testMatch **/*.spec.ts`, `roots test`. Commande : `npm test -w @cashless/api -- <motif>`.

### 9.2 Terminal de test et signature
- Fait : `test/support/test-terminal.ts:185` `TestTerminal` : deux paires P-256 générées à l'exécution (signature, accord), attestations de test, CSR, enrôlement (`enrollByRoute`, `enroll`), jeton d'appareil, client HTTPS avec certificat et signature RFC 9421 de chaque requête ; chaque preuve peut être retirée ou faussée. Clé d'accord → `openForRecipient` (importé de `@cashless/tag-format`) pour ouvrir un mot de passe de bracelet. Fonctions utiles : `postJson`, `createEnrollmentCode`, `send`. Reco : y ajouter `signBatch(header)` (`sign('sha256', JCS(header), {key: signingKey, dsaEncoding:'ieee-p1363'})`), `chainHash(prev, contents)` (SHA-256 de `prev ‖ content_sha256`, genèse `SHA-256("CASHLESS/CHAIN/v1" ‖ device_id UUID 16 octets)` = `device_chain_genesis`), `openSnapshotKey` (enveloppe ECDH-ES) et un constructeur de journal local (`buildJournal`).
- Pour les tests d'intégration de lots : `payments-fixtures.ts` (événement, point de vente, vendeur, session, bracelet) est le point de départ.

### 9.3 `SKIP_LATENCY`
- Fait : `jest.config.cjs:11-34` : sous `SKIP_LATENCY=1`, `testPathIgnorePatterns` écarte `configuration-latency`, `media-latency`, `claims-timing`, `end-to-end/psp-concurrency`, `end-to-end/cash-concurrency`, `topups/psp-concurrency`, `chargebacks/chargeback-concurrency`, `cash-sessions/close-concurrency`, `end-to-end/topup-journey`, `end-to-end/topup-secrets`, `webhooks/receive`, `webhooks/retry`, `topups/poller-`. Certains `it` se désactivent aussi eux-mêmes : `(process.env.SKIP_LATENCY ? it.skip : it)` (ex. `test/integration/devices/heartbeat.spec.ts:23-24`, `enrollment.spec.ts:770`, `topups/cash-topup.spec.ts:293-294`, `end-to-end/device-latency.spec.ts:76-77`).
- Reco : nommer les nouvelles suites de mesure `offline-latency` / `snapshot-latency` / `offline-concurrency` et les ajouter à la liste ci-dessus ; mesures : lot de 500 opérations en 60 s p95, FULL de 50 000 bracelets en 30 s, DELTA 2 s p95. Un test de charge sur 50 000 bracelets exige un jeu de données généré par SQL (pas par l'API), à écrire dans `test/support/`. Les suites qui lancent le producteur voient tous les prestataires (même remarque que `topups/poller-`, OP-N86) : les mettre dans la liste « seules, en série ».
- Mémoire locale (MEMORY.md) : la base est dans Docker, l'horloge peut reculer ; deux suites instables connues ; ne pas lancer de Jest en parallèle sur la même base.

---

## Contradictions et incohérences relevées (sans les trancher)
1. Format de la signature de lot : DER (exemple openapi.yaml:4158) ou brut `r‖s` (comme les requêtes, openapi l.11829) ; `OfflineBatch.signature` ne tranche pas (§4).
2. `SEQ_OUT_OF_ORDER` : 400 (lot de terminal non continu, openapi l.4066, SPECIFICATION l.514) contre 409 (`CL016`, `sqlstate-map.ts:30`, `edge_seq`) (§6.3).
3. `content_sha256` : §3.3 liste `reverses_seq, online_operation, void_reason` ; le code n'implémente que cinq champs de vente et `reverses_transaction_id` (§1.2).
4. `contiguous_acked_seq`/`next_seq_floor`/`seq` : `int64` dans le contrat, `Number` dans l'API (`device-config.service.ts:246-247`, `device-seq-registry.ts:60`) (§1.3).
5. sync_protocol §3.1-5 dit que le serveur fournit `next_seq = max_seen_seq + 1` au ré-enrôlement, tandis que §3.3 pose `last_chain_seq = next_seq_floor − 1` : cohérent, mais `enroll_device` (0022/0035) doit être relu pour confirmer la chaîne (non vérifié ici).
6. Heure : §7.4 corrige par rapport à `recorded_at` et `generated_at(snapshot)`, tandis que le code en ligne borne à ±120 s de l'heure de la base (`operation-time.ts`) — deux règles différentes, normales (en ligne contre lot), à ne pas confondre.
7. §7.1 étape 9 : « au 4e `CL007` : rien n'est écrit au registre, `retryable=true` » contre `device_seq_registry.outcome='REJECTED'` qui exige une raison et `complete_offline_batch` qui exige « chaque numéro du lot a un résultat final » (schéma l.2252-2255 ; `complete_offline_batch` lève `CL001` sinon). Un lot dont une opération est `INSUFFICIENT_FUNDS_RETRY` ne peut donc pas être clos : à arbitrer (lot laissé `PROCESSING` ? clos avec numéros manquants ?). Le schéma l.2279 semble gérer `missing_seqs`, à relire.

---

## Modules à créer ou modifier (chemins proposés)

### Base de données (`packages/ledger-sql/`) — migration 0043+ (jamais les `.sql` générés)
- `migrations/0043_offline_batches_api.sql` : `REVOKE ALL … FROM PUBLIC` et corps pour : `assert_vendor_session_at`, variante d'attribution hors ligne, `find_cash_session_at`/rattachement hors ligne, `ack_offline_snapshot`, `reduce_offline_shortfall` (annulation), `import_device_journal`, fonction d'écriture d'anomalie si besoin, fonction de purge `vendor_pin_check` (OP-N78) ; correction OP-N57 (borne de version de snapshot), OP-N58 (trace de politique écrite par fonction `SECURITY DEFINER`), OP-N69, OP-N75.
- `roles.sql` / `post-roles.sql` : rôles `cashless_snapshots` et `cashless_maint` (droits minimaux, lecture de `offline_snapshot_rows`, écriture de `offline_snapshot`), EXECUTE de `open_offline_batch`, `complete_offline_batch`, `waive_seq_gap`, `device_missing_seqs` à `cashless_app`, retrait de `UPDATE` sur `device` et des deux purges à `cashless_app`.
- `tests/tests_offline_rights.sql`, mise à jour de `tests_device_rights.sql`, `tests_execute_grants.sql`, `tests_device_purge_window.sql`.

### API — nouveaux modules
- `apps/api/src/offline/offline.module.ts`
- `apps/api/src/offline/batches/offline-batches.controller.ts` (`POST /offline-batches`, `GET /offline-batches/{batch_id}`)
- `apps/api/src/offline/batches/offline-batch.service.ts` (signature, chaîne, `open_offline_batch`, boucle d'opérations, `complete_offline_batch`)
- `apps/api/src/offline/batches/offline-operation.processor.ts` (algorithme §7.1, une transaction par opération)
- `apps/api/src/offline/batches/batch-signature.ts` (JCS + vérification P-256)
- `apps/api/src/offline/batches/chain.ts` (`chain_step`, genèse, vérification locale)
- `apps/api/src/offline/rules/conflict-outcome.ts` (table §7.3, fonction pure)
- `apps/api/src/offline/rules/compliance-checks.ts` (§7.2, devise/politique/plafonds/snapshot)
- `apps/api/src/offline/rules/period-checks.ts` (§7.2 fin, §7.5)
- `apps/api/src/offline/rules/offline-time.ts` (§7.4)
- `apps/api/src/offline/anomalies/anomaly-writer.ts`
- `apps/api/src/offline/snapshots/snapshots.controller.ts` (`GET /offline-snapshots/current`, `POST /offline-snapshots/ack`)
- `apps/api/src/offline/snapshots/snapshot-builder.ts` (contenu, JCS, `content_sha256`, chiffrement `pwd_pack_enc` par version, enveloppe par terminal)
- `apps/api/src/offline/snapshots/snapshot-producer.worker.ts` (60 s / 5 s)
- `apps/api/src/offline/snapshots/seq-gap-age.worker.ts` (alerte > 24 h)
- `apps/api/src/offline/seq/waive-seq-gap.action.ts` (`WAIVE_SEQ_GAP`, modèle `cash-sessions/cash-deposit-action.ts`) et `apps/api/src/offline/seq/seq-gaps.controller.ts` (`POST /devices/{device_id}/seq-gaps/{seq}/waive`, `GET /device/seq-status`)
- `apps/api/src/offline/journal/device-journal-import.action.ts` et `…/journal-imports.controller.ts` (`DEVICE_JOURNAL_IMPORT`)
- Processus : `apps/api/src/main.snapshots.ts`, `apps/api/src/processes/snapshots.module.ts`, `apps/api/src/db/snapshots-db.module.ts` (ou extension de `process-db.module.ts`), `apps/api/src/main.maintenance.ts`, `apps/api/src/processes/maintenance.module.ts` ; scripts dans `apps/api/package.json`.
- Port de signature : `apps/api/src/kms/sign.port.ts` (ou ajout à `kms/kms.ports.ts`), `apps/api/src/kms/fake-kms.ts` (opération `sign`/`publicKey`), `apps/api/src/kms/kms.module.ts` (capacité `'sign'`).

### API — fichiers existants à modifier
- `apps/api/src/payments/device-seq-registry.ts` : `chainedContent`, `record` (issue, raison, `batchId`), prudence sur `Number(seq)`.
- `apps/api/src/reversals/reversal.dto.ts` et `apps/api/src/topups/cash/cash-topup.service.ts` : appeler la fonction commune ; `reverses_seq`.
- `apps/api/src/idempotency/device-key.ts` : fabrique de clé (`deviceKey(serial, seq)`), borne de `seq`.
- `apps/api/src/media/taps/tap.service.ts` : `registerOffline`.
- `apps/api/src/ledger/ledger-engine.service.ts` et `ledger/types.ts` : `shortfall` dans `EngineResult`, `forceUncovered` ; `ledger/builders/festival/purchase.ts`, `ledger/money/spend.ts` ; export de la lecture par clé.
- `apps/api/src/devices/config/device-config.service.ts` : `snapshot_keys` ; `apps/api/src/devices/heartbeat/heartbeat.controller.ts` : `latest_snapshot_version`, `sync_requested`.
- `apps/api/src/errors/sqlstate-map.ts`, `apps/api/src/http/messages.fr.json`, `messages.en.json`, `packages/contracts` (ProblemCode ; générer types TS et Dart) : `SYNC_DEADLINE_PASSED` et autres.
- `apps/api/src/audit/audit.service.ts` : nouvelles actions.
- `apps/api/src/processes/bootstrap.ts` : liste de `assertProcessIsSafe` si un nouveau fournisseur de signature.
- `apps/api/src/config/config.ts` : `maintenanceDatabaseUrl`, `snapshotsDatabaseUrl`, clés de signature (`SNAPSHOT_SIGNING_KEY_REF`), paramètres de génération.
- `apps/api/src/devices/devices.module.ts` : retirer `DeviceMaintenanceModule` (OP-N75).
- `apps/api/src/app.module.ts` : `OfflineModule`.
- `packages/tag-format/src/device-envelope.ts` : AAD de snapshot (relecture des vecteurs du kit).
- Tests : `apps/api/test/unit/payments/device-seq-registry.spec.ts` (vecteurs de lot), `test/unit/offline/*.spec.ts` (table §7.3, période, heure, chaîne), `test/integration/offline/*.spec.ts`, `test/integration/end-to-end/offline-{journey,isolation,secrets,latency,concurrency}.spec.ts`, `test/unit/production-guard.spec.ts`, `test/unit/config.spec.ts`, `test/support/test-terminal.ts` (signature de lot, chaîne), `jest.config.cjs` (liste `SKIP_LATENCY`).
- Documentation de gouvernance (CLAUDE.md, règle du porteur) : `docs/POINTS_OUVERTS.md` (OP-N57, 58, 68, 69, 75 levées ; nouveaux écarts, par exemple les formats de signature ou `forceUncovered`), `docs/DECISIONS_ADR.md`, `PROMPTS-A-ENVOYER.md`, `PRD.md`.

### Fichiers à faire relire par une personne (règle du porteur n°4)
Le port et le faux de signature (`kms/*`), l'enveloppe de clé de contenu des snapshots (`snapshot-builder.ts`, `tag-format`), les rôles et droits de base (`roles.sql`, `post-roles.sql`, migration 0043), la vérification de la signature et de la chaîne des lots, la fonction `import_device_journal`.
