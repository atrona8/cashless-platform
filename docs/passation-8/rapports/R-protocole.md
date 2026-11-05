# R-protocole : protocole et contrat de la passerelle (mission 8)

Abréviations : SP = `docs/sync_protocol.md` ; OA = `packages/contracts/openapi.yaml` ; SCH = `packages/ledger-sql/schema_grand_livre_cashless.sql` ;
SPEC = `docs/SPECIFICATION.md` ; M8 = `kitty-specs/passerelle-locale-01M6NM1S/spec.md`. Lecture seule, rien n'a été exécuté.
## 1. Machines à états
### 1.1 Handover (central, table `debit_authority_handover`)
- États : GRANTED, ACTIVE, RELEASE_REQUESTED, RELEASING, COMPLETED, FORCED, FAILED (SCH:2491 ; OA:14661).
- Transitions autorisées (table SCH:2520-2525) :
  - TO_EDGE : GRANTED→ACTIVE, GRANTED→FAILED, GRANTED→FORCED, ACTIVE→COMPLETED, ACTIVE→FORCED.
  - TO_CENTRAL : RELEASE_REQUESTED→RELEASING, RELEASE_REQUESTED→COMPLETED (direct), RELEASING→COMPLETED, RELEASE_REQUESTED|RELEASING→FORCED|FAILED.
- Un seul handover ouvert par (grand livre, direction) (index `handover_one_open`, SCH:2516).
- Fonctions et ce qu'elles écrivent avant de répondre :
  - `grant_edge_authority` (SCH:2547) : verrou exclusif, `set_debit_authority(EDGE)` (époque e+1), filigrane W = `max(posting.id)`, insère GRANTED. Refus `CL013` si passerelle non `ACTIVE`/`PRIMARY`, autre événement, bascule déjà ouverte. Réponse OA `202` (OA:6789).
  - `ack_edge_handover` (SCH:2579) : exige GRANTED, époque = e+1 (sinon `CL015`), `replicated_posting_id ≥ W` (sinon `CL014`) ; écrit `last_replicated_posting_id`, `last_seen_at`, ACTIVE. La passerelle ne débite qu'après le 200 (OA:6868 ; SP:605).
  - `fail_edge_grant` (SCH:2602) : GRANTED seulement ; `set_debit_authority(CENTRAL)` donc l'époque augmente encore (e+2) ; FAILED.
  - `request_edge_release` (SCH:2617) : exige TO_EDGE ACTIVE ; insère RELEASE_REQUESTED, le grand livre reste EDGE.
  - `complete_edge_release` (SCH:2638) : exige RELEASE_REQUESTED|RELEASING ; époque = celle du handover (`CL015`) ; `contiguous_edge_seq < final` → `CL014` ; `>` final ou chaîne différente → `CL017` ; puis CENTRAL (époque e+2), les deux handovers COMPLETED.
  - `force_central_authority` (SCH:2670) : deux personnes distinctes et motif ; passerelle `REVOKED` ; CENTRAL ; FORCED.
  - `record_edge_seq` (SCH:2726) : ordre strict (`CL016`), contenu différent pour un même `edge_seq` (`CL002`), chaîne calculée par le central.
- Le passage en RELEASING n'est posé par aucune fonction SQL : c'est l'API, à la réception de `release`, avant toute vérification (SP:648 ; OA:6916 ; SPEC:1036). Constat : la table autorise aussi RELEASE_REQUESTED→COMPLETED sans passer par RELEASING (SCH:2523), ce que SP:648 ne prévoit pas ("avant toute vérification"). L'API doit donc écrire RELEASING avant d'appeler `complete_edge_release`.
### 1.2 Passerelle (côté site)
- Colonne centrale `edge_gateway.status` : ACTIVE, ISOLATED, CATCHING_UP, REVOKED (SCH:733). Seul REVOKED est écrit par une fonction existante (SCH:2686). Rien dans SCH, SP ni OA ne dit qui écrit ISOLATED et CATCHING_UP, ni sur quel signal central : SP:706-709 les cite sans les définir. À décider (voir §6).
- Rôle `PRIMARY` ou `STANDBY` (SCH:730) ; une `STANDBY` ne débite pas (SP:809, SPEC:1040), `grant_edge_authority` la refuse (SCH:2560).
- État local à persister (déduit de SP:645, 651, 701, 684) ; proposition de machine, hors texte normatif sauf mention :
  - `STANDBY` (inerte, aucun débit) ;
  - `ARMED` (rôle PRIMARY, autorité CENTRAL, réplique) ;
  - `GRANTED_PENDING` (accord reçu, rattrape jusqu'à W, aucun débit) ;
  - `ACTIVE` (débite à l'époque e ; état du lien en sous-état : connecté / `ISOLATED` / `CATCHING_UP`, SP:706-709) ;
  - `RELEASING` (aucun débit, refuse les nouveaux lots avec `409 DEBIT_AUTHORITY_MOVING`, vide la file) ;
  - `RELEASED` (autorité rendue, époque e+2) ;
  - `STALE` (époque supérieure vue : ne débite plus, persistant, SP:592) ;
  - `REVOKED`.
- À persister AVANT de répondre à un terminal : l'entrée de file (`edge_seq`, chaîne, clé d'origine `<serial>:<seq>`, décision) et son effet local sur le solde, dans une même transaction locale (M8 FR-014, NFR-004 ; SP:701). L'attribution de `edge_seq` et son effet sont durables avant la réponse, sinon un arrêt brutal perd un numéro.
- À persister AVANT d'agir : `RELEASING` avant de cesser de débiter ou de répondre (SP:645 "persiste son état local de rendu") ; il ne se quitte que sur `FAILED` du central pour la même époque (SP:651-652). `STALE` doit être persistant (M8 FR-012). L'époque détenue et `last_replicated_posting_id` aussi (SP:684-685).
- Débit permis seulement si : état ACTIVE, `X-Authority-Epoch` = époque détenue, ack 200 reçu (SP:590-592). Époque supérieure reçue → `409 STALE_AUTHORITY_EPOCH` et cesse de débiter (SP:592, 861).
- Lien perdu entre GRANTED et ack : aucun débit nulle part (SP:608 ; M8 "Edge Cases"). `fail_edge_grant` exige une action humaine : pas d'expiration automatique de GRANTED (aucune dans SCH:2547-2616). Point à décider.
- Panne du lien pendant RELEASING : cas 28 (SP:862) ; la vidange reprend au retour.
### 1.3 Routes `/edge/*` (OA)
| Route | OA | Rôle |
|---|---|---|
| GET `/ledgers/{id}/debit-authority`, POST (même chemin) | 6720, 6753 | `humanBearer` ou `edgeMtls` pour GET ; POST `OPERATOR_ADMIN` seul |
| GET `/edge/handovers/current` (`wait` ≤ 25) | 6827 | canal de contrôle + battement `last_seen_at` |
| POST `/edge/handovers/{id}/ack` {epoch, replicated_posting_id} | 6861 | → ACTIVE |
| POST `/edge/handovers/{id}/release` {epoch, final_edge_seq, last_chain_hash, operations_count} | 6909 | → RELEASING puis COMPLETED |
| GET `/edge/replication-feed?after_posting_id&limit` | 6968 | `ReplicationPage` |
| POST `/edge/sync-batches` | 7018 | `EdgeSyncBatch`, clé = `batch_id` |

Erreurs : `HANDOVER_INVALID_STATE` CL013, `EDGE_NOT_CAUGHT_UP` CL014 (avec `missing_edge_seqs`, OA:6919), `STALE_AUTHORITY_EPOCH` CL015, `SEQ_OUT_OF_ORDER` CL016, `CHAIN_BROKEN` CL017 (OA:11800-11815, SCH:2955-2962).
Remarque : `operations_count` du `release` n'est vérifié nulle part dans `complete_edge_release` (SCH:2638-2668 ne le reçoit pas). À décider si l'API le contrôle (= `final_edge_seq` si la numérotation commence à 1).
### 1.4 Opérations servies (16 `x-edge-available`, FR-010)
`refreshDeviceToken`, `getDeviceConfig`, `postDeviceHeartbeat`, `getDeviceSeqStatus`, `getMediaAuthKey`, `createTap`, `activateMedia`, `takeDeposit`, `createPayment`, `getPayment`, `reversePayment`, `createCashTopup`, `getOfflineSnapshot`, `ackOfflineSnapshot`, `submitOfflineBatch`, `getOfflineBatchResult` (lignes OA 429-4764 ; compte de 16 vérifié par script). Les routes de session (`openVendorSession`, `closeVendorSession`, `openCashSession`…) ne le sont pas (OA:2451, 2535).
## 2. Écarts protocole / contrat / spec et ajouts facultatifs
### 2.1 Ce que `ReplicationPage` porte aujourd'hui
`ledger_id, epoch, from_posting_id, to_posting_id, wallets[{wallet_id,status,paid,promo}], media[SnapshotEntry], has_more` (OA:14690-14728). Aucun champ n'est `additionalProperties:false` (à confirmer à l'édition). Les statuts de lots sont dans `SnapshotEntry.batch_status` (OA:13990).
### 2.2 Ce que la passerelle doit vérifier pour servir les 16 opérations (cité du contrat)
- Terminal : mTLS avec empreinte du certificat (OA:10964), jeton `device+jwt` ES256 dont `kid` du signataire central, `fid` non révoquée à chaque requête, terminal/statut/affectation "relus en base" (OA:10953-10962), signature RFC 9421 avec la clé du terminal, `@authority` = adresse de la passerelle (OA:10970-10990), nonce anti-rejeu par terminal.
- Personne au guichet : `X-Staff-Authorization` JWT OIDC, "prestataire, statut et rôles relus en base" (OA:10946-10952) ; `createCashTopup` exige `CASHIER` ou `SUPERVISOR` de l'événement (OA:2576-2578).
- Vente et annulation : `vendor_session_id` ouverte sur ce terminal, non expirée, vendeur `ACTIVE` et non bloqué, sinon `409 VENDOR_SESSION_INVALID` (OA:1945-1948, 2104).
- Recharge, caution, rendu : session de caisse `OPEN` du terminal (`cash_session_id`, OA:2577-2578, 1479).
- Catalogue : prix et lignes pour `CATALOG_POS` (OA:1950) ; `getDeviceConfig` (OA:496) sert config, catalogue, politique, clés de snapshot, `terminal_settings`.
- Activation et caution : événement et canal `DESK`, lot de bracelets (OA:14438-14465).
### 2.3 Ajouts facultatifs proposés à `ReplicationPage` (tous sous `/edge/*`, aucune autre route modifiée)
Tous optionnels, absents pour les clients actuels (compatibles ascendants : OA:14692 `required` inchangé). Chacun avec un curseur ou un état complet, pour que la reprise soit sans trou.
1. `cash_sessions[]` : `{cash_session_id, device_id, cash_account_id, status (OPEN|CLOSING|CLOSED), opened_at, closed_at?}` (états SCH 0036:90 : le contrat ne connaît que OPEN et CLOSED, OA:14793 ; CLOSING doit être traité comme fermé pour les recharges). Sert FR-015 et le cas "session fermée au central" (voir §3.5).
2. `vendor_sessions[]` : `{vendor_session_id, vendor_id, device_id, expires_at, closed_at?, closed_reason?}` (0031:84) + `vendors[]` : `{vendor_id, display_name, status, blocked}` sans PIN ni empreinte. Pas d'`openVendorSession` sur la passerelle (M8 Assumptions).
3. `devices[]` : `{device_id, serial, kind, app_mode, status, public_key (clé de signature de requête), cert_sha256, agreement_public_key?, station/pos}` (SCH:150 ; SP:922). Inclut les révocations et suspensions.
4. `device_token_families[]` (ou liste de `fid` révoquées) + `device_token_keys[]` (clés publiques de vérification des jetons d'appareil du central, `kid`) : sans eux `deviceToken` ne se vérifie pas hors réseau. À confirmer dans le code de `apps/api/src/device-tokens` (non lu).
5. `staff_authorizations[]` : `{user_id (sub + émetteur), status, roles ∈ {CASHIER, SUPERVISOR, …}, event_id}` pour l'événement, plus `identity_keys[]` (JWKS du serveur d'identité) : M8 le met en hypothèse ("copie des clés publiques", M8:297) mais ne l'écrit pas dans `ReplicationPage` ; sans rôles répliqués, `createCashTopup` ne peut pas être vérifié.
6. `catalog` : `{pos_id, version, items[]}` par point de vente de l'événement (`CatalogItem` OA:13946) ; ou renvoyer l'`ETag` de `getDeviceConfig` par terminal.
7. `event_settings` : `{event_id, status, currency, minor_units, timezone, activation_modes, terminal_settings, offline_policy effective par terminal + historique `policy_in_force` (SP:479), `config_id`/`device_config_served` (SP:926)}`. Le `config_id` doit rester celui du central (OA:12606) pour que `POLICY_LIMIT_EXCEEDED` se contrôle sur la bonne politique.
8. `snapshot_keys[]` du central (pour vérifier ce que la passerelle relaie) ; la clé de la passerelle est la sienne (SP:692-694).
9. `media_batches[]` / `wallet_limits` si les contrôles `check_wallet_limits` d'une recharge doivent tourner à l'identique (OA:2579-2580 plafonds réglementaires, `MONTHLY_TOPUP_LIMIT_EXCEEDED`) : cumul mensuel du portefeuille ; non décrit par M8, à vérifier au plan.
Format : chaque tableau avec sa propre pagination par `has_more` partagé ; ajouter `next_cursor` facultatif si un type n'est pas indexé par `posting.id` (sessions et appareils n'ont pas de `posting.id` : cursor séparé ou "état complet à chaque page 0"). À décider.
### 2.4 Autres routes à changer ?
- Aucune route hors `/edge/*` ne doit changer. Vérifications :
  - `DebitAuthority` exige déjà `edge_base_url` (OA:12539) ; `getDeviceConfig` expose déjà l'autorité (OA:12590).
  - `DEBIT_AUTHORITY_MOVING` existe en erreur 409 sans code CLxxx (OA:11807 : "(409)" seul, sans `CL`) ; aucune route à toucher.
  - `releaseEdgeHandover` : `missing_edge_seqs` déjà décrit (OA:6919) et porté par `Handover` (OA:14671).
- À SIGNALER (soumettre au porteur, C-002) : la **fermeture d'une session de caisse au central pendant `EDGE`** (voir §3.5) est une règle de comportement des routes `/cash-sessions/*`, sans changement de schéma ni de code d'erreur (`409 CONFLICT_STATE` existe déjà, OA:2577) ; c'est un changement de comportement hors `/edge/*`, à valider par le porteur.
- Inscription d'une passerelle : aucune route, outil admin (M8 FR-002) ; `edge_gateway` n'a pas de colonne `registered_by` ni d'audit (SCH:726-745).
## 3. Cas limites
### 3.1 SP §11 appliqué à la passerelle
- Cas 25, 26, 27 (SP:859-861) : cœur de M8 (`409 DEBIT_AUTHORITY_EDGE` central, lot complet refusé, `STALE_AUTHORITY_EPOCH`).
- Cas 28 coupure pendant RELEASING (862), 29 perte (863), 30 confirmée puis perdue (864), 31 webhook PSP pendant EDGE (865), 32 remboursement (866) : à tester côté central (crédits PSP répliqués).
- Cas 12 (846) : même lecture : la passerelle doit tenir sa propre table `media_tap` (`register_tap`/`consume_tap`) ; un `tap_id` reçu du central n'est pas valable sur la passerelle sauf réplication. À décider : les `tap_id` sont-ils locaux à la passerelle (OA "Lecture du bracelet", `createTap` est `x-edge-available`) ? Le rejeu "même clé" vers la passerelle avec un `tap_id` central donnerait `TAP_UNUSABLE`.
- Cas 36 (870) `SEQ_OUT_OF_RANGE` : le registre de numéros du terminal vit au central (`contiguous_acked_seq`), répliqué ? Voir 3.2.
- Cas 38 (872) et SP:738-753 : rejeu impossible → `REJECTED EDGE_REPLAY_FAILED`, anomalie, espèces en `SUSPENSE` ; `DEPOSIT_TAKEN` en `EDGE_SYNC`, `metadata.replay_failed`.
- Cas 17 (851) : ventes `EDGE_SYNC` acceptées en CLOSING/RECONCILING, `SYNC_DEADLINE_PASSED` à partir de SETTLING. Mais SPEC:1037 exige l'autorité au central avant RECONCILING (`CL019`) : cohérent, à tester (FR-024).
- Cas 21 (855) : plafond abaissé pendant isolement : s'applique aussi aux lots `DEVICE_OFFLINE` relayés ; la passerelle doit garder l'historique de politique (voir §2.3-7).
### 3.2 Registre de numéros et chaîne
- Deux registres : `device_seq_registry` par terminal (SP:97-105) et `edge_sync_registry` par passerelle (SCH:2710-2724). Un `POST /payments` servi par la passerelle écrit sa propre entrée locale ; le central n'apprend le `(device, seq)` qu'au rejeu `EDGE_SYNC`. `getDeviceSeqStatus` servi par la passerelle doit relayer le `contiguous_acked_seq` du central (SP:718-720 ; M8 FR-026), donc un appel central pendant le lien, ou valeur la plus récente connue. Hors lien, c'est la dernière valeur connue (stale, jamais provisoire). À décider.
- `content_sha256` : défini pour les 11 champs chaînés (SP:112-122 ; `apps/api/src/payments/chained-content.ts:10-22`). Vecteurs existants : `apps/api/test/fixtures/offline-vectors/vectors.json` (10 cas : `5b_purchase_*`, `batch_sale_lines`, `reversal_by_*`, `void`, `online_ref`, `seq_2_pow_32`, `seq_max_safe`, `unknown_tap_property`), générés par `gen_vectors.py` (jamais par le code testé).
- Trous :
  - le hachage du contenu d'une `ACTIVATION` et d'un `DEPOSIT_CASH` n'est défini nulle part (ni `chainedContent`, ni SP) ; le terminal les enverrait plus tard en `ONLINE_REF` avec son `content_sha256` (SP:415-419), donc la passerelle doit calculer le même au bit près, sinon `IDEMPOTENCY_KEY_REUSED` (SP:412). Les routes `activateMedia`/`takeDeposit` n'apparaissent pas parmi les appelants de `DeviceSeqRegistry` (grep `apps/api/src` : cash-topup, payments, reversal, payment-request, offline processor). À vérifier si l'activation inscrit déjà son numéro.
  - la chaîne de la passerelle : SP:701 pose `chain_hash(n)=H(chain_hash(n−1) ‖ content_sha256(n))` avec genèse `H("CASHLESS/EDGE-CHAIN/v1" ‖ gateway_id)` (SCH:1979), mais ne dit pas ce que couvre `content_sha256(n)` d'une opération de passerelle. `record_edge_seq(p_content)` reçoit une empreinte déjà faite (SCH:2726). Vecteurs à prévoir : (a) genèse (UUID en 16 octets bruts, comme `uuid_send`), (b) 3 liens pour `EDGE_ONLINE` PURCHASE/VOID, (c) un `DEVICE_OFFLINE` relayé, (d) `ACTIVATION`, (e) `DEPOSIT_CASH`, (f) `edge_seq` > 2^32, (g) un contenu avec et sans `edge_decision` (doit être exclu ou inclus, à décider). Aucun vecteur EDGE dans `gen_vectors.py` ni `gen_tests.py` hors `EG = edge_chain_genesis(...)` (gen_tests.py:662).
  - Ambiguïté de l'exemple `EdgeSyncBatch` : `OfflineOperation.chain_hash` est requis (OA:14128), la 3e opération (`DEVICE_OFFLINE`) porte `8a7b…` = `last_chain_hash` du lot d'origine du terminal (OA:14623), alors que `60303a…` (op 4211) est présenté comme `last_chain_hash` du lot pour `edge_seq_to: 4212` (OA:14550). Le champ `chain_hash` désigne donc tantôt la chaîne du terminal, tantôt celle de la passerelle. Contradiction à signaler.
### 3.3 Forme du contenu par type d'opération
- `PURCHASE`, `REVERSAL` (`reverses_seq` ou `reverses_transaction_id`), `VOID` (`void_reason`), `ONLINE_REF` (`online_operation`), `TOPUP_CASH` : champs de `OfflineOperation` (OA:14114-14233).
- `EdgeSyncOperation` ajoute `edge_seq, device_serial, authorized_mode, device_batch_id?, edge_guichet?, edge_decision?` (OA:14416-14484). `edge_decision` est "obligatoire" par description (OA:14466-14470) mais absent de `required` (OA:14420 : seulement `edge_seq`, `device_serial`, `authorized_mode`). Contradiction interne.
- `TOPUP_CASH` est toujours rejeté dans un lot de terminal (OA:14114-14124 ; C-006) mais est une opération servie par la passerelle en ligne : son type dans la file de passerelle est `TOPUP_CASH` avec `authorized_mode=EDGE_ONLINE`. L'énumération `OfflineOperationType` dit "TOPUP_CASH toujours rejeté" sans exception pour la passerelle : point à trancher (SP:698 "recharges en espèces décidées par la passerelle").
- `edge_decision` : le central reprend `status, charged_to_wallet, shortfall_amount, shortfall_reason, reject_reason` tels quels et ne recalcule que frais et commissions (SP:714-716). Risque : une décision incohérente (`charged + shortfall ≠ amount`, ou `shortfall_reason` absente) doit être refusée par le central ; à prévoir en test.
- Une écriture `EDGE_SYNC` porte `metadata.origin_key`, `origin_occurred_at`, `origin_mode` (SP:710-713 ; OA:7041-7043).
- Dans SP:746-750, une écriture `DEPOSIT_TAKEN` d'attente est écrite avec la clé d'origine ; le registre refuse `transaction_id` dans un REJECTED (SCH:2723).
### 3.4 Rejeu après reprise forcée (SP:774-779)
- Le terminal renvoie tout son journal non `ACKED`, y compris les `online_status=CONFIRMED` de la passerelle : traitées en `OFFLINE_SYNC` selon §7.3, sans les contrôles de §7.2. Clé unique `(ledger_id, idempotency_key)` garantit I1 (SP:34) mais les opérations `ACTIVATION`/`DEPOSIT_CASH` n'existent que dans la file de la passerelle (type absent des lots de terminal, OA:14121-14124) : si la passerelle est perdue avant le rejeu, le terminal ne peut renvoyer qu'un `ONLINE_REF` (SP:415-419) → `VOID/ONLINE_NOT_EXECUTED` : une activation faite au guichet pendant EDGE puis passerelle détruite est perdue silencieusement côté central (contraire à I2, SP:35) tandis que les espèces de la caution sont en caisse. Cas non couvert par SP:763-785 ni par le cas 30 (SP:864, qui ne parle que de ventes). À décider : anomalie à ouvrir à la reprise forcée pour tout `ONLINE_REF` d'activation ou caution sans rejeu ?
- Passerelle zombie (SP:780-785) : risque accepté ; borné par `SUSPENSE`.
- Après `REVOKED`, la passerelle est refusée au TLS (SP:804) ; l'API doit refuser aussi un `edge_gateway.status=REVOKED` par fichier de révocation, pas seulement par mTLS (FR-031).
### 3.5 Session de caisse fermée au central pendant `EDGE`
- `cash_session` : OPEN, CLOSING, CLOSED (0036:90). La fermeture écrit une transaction de caisse (0036:410-450) ; `expected_amount` provient de `cash_session_tx`. Une recharge faite sur la passerelle puis rejouée après la fermeture n'entre pas dans le comptage fermé : écart de caisse sans lien avec une faute du caissier. SP:7.5 couvre ce cas pour `TOPUP_CASH` et `DEPOSIT_CASH` (anomalie `LATE_OFFLINE_SYNC`, écriture normale, SP:548-551) mais seulement pour `SETTLING` et au-delà, pas pour une session fermée avant. Le texte M8 (US3 scénario 4 : fermeture "après le rendu") suppose que la session reste ouverte jusqu'au rendu ; le cas "fermée au central pendant EDGE" (M8:191) est traité côté passerelle (la fermeture répliquée met fin aux recharges), mais pas côté central pour les recharges déjà faites sur le site mais non encore rejouées.
- Options : (a) refuser la fermeture au central tant que la passerelle a des opérations non rejouées pour ce terminal (`409 CONFLICT_STATE`, comportement hors `/edge/*`, à soumettre au porteur) ; (b) accepter et rattacher à la session fermée avec anomalie (écart de caisse expliqué) ; (c) ouvrir un état "caisse complémentaire". Aucune n'est dans SP ni dans OA. Point à décider.
- Le crédit reçu ensuite : le central l'écrit (c'est un crédit, SP:593 ; SCH:573 ne refuse que les débits wallet), donc `TOPUP_CASH` en `EDGE_SYNC` sur la session fermée est faisable côté SQL ; reste le rattachement à `cash_session_tx`.
### 3.6 Horloges
- Terminal : `t_trusted = server_time + (monotonic_now − monotonic_ms)` (SP:523-528). Avec la passerelle, `server_time` vient de la passerelle : si son horloge dérive, tous les terminaux datent faux, et `CLOCK_SKEW` ne se détecte qu'au rejeu (SP:529-535, tolérance 120 s). À décider : la passerelle renvoie-t-elle sa propre heure ou la dernière heure centrale + monotone ? `deviceSignature` : `created` contrôlé à ±`clock_tolerance_seconds` de "l'heure de la base" (OA:10987), donc de la passerelle.
- Passerelle : doit dater `origin_occurred_at` par l'heure du terminal corrigée, et `recorded_at` par la sienne. Aucune règle SP sur l'horloge de la passerelle elle-même (NTP/GNSS non précisé). `CLOCK_SKEW_TOO_LARGE` (> 24 h) rend le terminal `DEGRADED` (SP:540) : s'applique à la passerelle ? À décider.
- §13-6 (SP:912) : tester les corrections à +2 h/−2 h aussi sur le chemin passerelle.
## 4. Plan de preuve
### 4.1 NFR → tests proposés
| NFR | Test exact | Seuil |
|---|---|---|
| NFR-001 | `sync_protocol` §13-4 (SP:908-909) : 100 débits/s via `POST /payments` central pendant `grant_edge_authority` ; requête SQL : aucun `journal_transaction` avec débit wallet, `source <> 'EDGE_SYNC'`, `posting.id > W`, ni `recorded_at` postérieur au COMMIT de la bascule ; 0 réponse perdue (chaque requête 2xx/4xx ou `409 DEBIT_AUTHORITY_EDGE`) | 0 |
| NFR-002 | 10 000 opérations en file, rendu (SP:910-911), redémarrage de la passerelle au milieu ; contrôle de `edge_seq` 1..10 000 continus (`edge_sync_registry`), chaîne égale, 0 débit passerelle après RELEASING (journal local, horodatage) | 0 |
| NFR-003 | 100 rejeux de la même opération par trois chemins (direct, `EDGE_SYNC`, journal après reprise) : 1 seule écriture par `idempotency_key` | 1 |
| NFR-004 | arrêt brutal (kill -9) à trois points d'injection : avant écriture locale, après écriture avant réponse, pendant vidage ; au redémarrage `edge_seq` continus, aucune réponse 2xx sans entrée de file | 0 perte |
| NFR-005 | 200 paiements sur LAN simulé ; p95 ≤ 200 ms et p99 ≤ 500 ms, mesuré **serveur seul** (ADR-60, SPEC:1439, OA:1939) ; ne pas mélanger avec la tranche réseau+serveur (800 ms) | voir §4.3 |
| NFR-006 | 10 000 opérations en 20 lots de 500, un lot en vol (SP:707) ; mesure sur poste | voir §4.3 |
| NFR-007 | grant puis ack, central et passerelle en deux processus, 10 000 écritures à rattraper | voir §4.3 |
| NFR-008 | blocage au central, mesure jusqu'à l'application sur la passerelle (lecture de son état), p95 sur N essais | 5 s |
| NFR-009 | un test par port à faux : démarrage refusé avec `NODE_ENV=production` | 100 % |
| NFR-010 | canari (clé maître et PWD factices) : recherche dans le flux (`pwd_pack_enc` seulement chiffré, OA:13990-14010), la base de la passerelle (dump) et les journaux ; la garde de l'API publique OP-N97 (`docs/POINTS_OUVERTS.md:78`) montre la méthode déjà employée | 0 |
| NFR-011 | pour chaque route `/edge/*` (6 routes + `getDebitAuthority`) : certificat d'une autre passerelle, d'un autre événement, d'un autre prestataire, révoqué ; attendre 401/403/404 sans fuite | 0 |
| NFR-012 | comparaison de l'`openapi.yaml` avec celui du 05/11/2026 : seuls des ajouts de propriétés non `required` sous `/edge/*` ; témoin positif sur contrat modifié (SC-006) | 0 |
### 4.2 §13-4, §13-5 et autres tests minimaux
- §13-1 (100 rejeux), §13-2 (coupure serveur au milieu d'un lot de 500) : à refaire sur `POST /edge/sync-batches` (lot de 500 ; `Idempotency-Key = batch_id`, OA:7030).
- §13-3 (transaction 22) : doit produire les mêmes écritures via `edge_decision` (ACCEPTED_WITH_SHORTFALL 6000/3000, exemple OA:14596-14610) : écriture `L-WAL-W04-P +6000`, `S-ATTENTE +3000`, `L-MCH-FOOD −9000` (SP:452-453).
- §13-4 : tester avec 100 débits/s ; §13-5 : 10 000 en file (SP:910) ; §13-6 horloge (SP:912) ; §13-7 blocage pendant isolement (SP:913-914), à refaire avec snapshot signé par la clé de la passerelle.
### 4.3 Simulation de la coupure et seuils
- Coupure : un proxy TCP (processus de test) entre la passerelle et le central, pass-through pour l'mTLS (le certificat client voyage jusqu'au central, SCH:726-745) ; commandes `pause`, `close`, `latence`. Éviter de modifier la configuration réseau du poste (une API écoute sur le port 80, contexte M8). Pour NFR-004, des points d'arrêt par variable d'environnement dans le code de test, désactivés en production (cohérent avec NFR-009). Toxiproxy ou équivalent : à vérifier dans `docs/08-pile-logicielle.md` (C-011), je n'ai pas relevé de mention.
- NFR-006 : 10 000 opérations en 10 min = 16,7 op/s. C'est large : SP:890 fixe 500 op / 1 Mio par lot ; un lot en vol (SP:707) donne 20 lots, donc 30 s par lot de 500, soit 60 ms par opération avec `post_transaction` + registres (chacun dans une transaction, SP:408-446). Réaliste sur poste ; seuil pas dimensionné sur la source (aucun chiffre en SP ni SPEC). Réserve : 500 × `record_edge_seq` en `FOR UPDATE` sur la ligne `edge_gateway` (SCH:2735) sérialise, mais reste linéaire.
- NFR-007 : accusé en 30 s après l'accord. Dépend du délai entre l'accord et le tirage de la passerelle : `getCurrentEdgeHandover` en long-polling ≤ 25 s (OA:6833) ; le réveil immédiat sur changement est requis, sinon le premier tirage seul peut atteindre 25 s. Hors cette réserve, 10 000 écritures (soldes, pas postings) sont réalistes si le flux est paginé par `limit` (valeur par défaut du paramètre `Limit` à vérifier). Seuil acceptable avec réveil immédiat ; sans, il est tangent.
- NFR-008 (5 s, p95) : la chaîne complète vers un terminal dépasse 5 s : génération de snapshot 60 s / 5 s après blocage (SP:889), battement de cœur 60 s (SP:895) ; NFR-008 ne couvre que "appliqué sur la passerelle". À préciser pour ne pas être lu comme un délai de bout en bout.
- NFR-005 : 200 ms "comme au central" (M8:245, SC-004 M8:288) est le seuil serveur seul du central (ADR-60). Sur poste, deux processus et un LAN simulé : respecter l'unité. Les 200 paiements sont un petit échantillon pour un p99 (2 observations au-delà) ; proposer 1 000.
## 5. Reports et interactions
### 5.1 OP-N89 à OP-N99 (`docs/POINTS_OUVERTS.md:70-80`)
Touchent la passerelle :
- **OP-N89** (faux KMS, `SignPort`, `DataKeyPort`, mission 12b) : la passerelle produit ses propres snapshots, signés par une clé hors KMS dans son stockage matériel (SP:692-694, M8 FR-027, FR-032). Les mêmes gardes de production (`production-guard.spec.ts`) servent de modèle ; le port de stockage matériel est un nouveau faux, même dette (C-007).
- **OP-N92** (rotation, lecture des clés publiques, `docs/POINTS_OUVERTS.md:73`) : `snapshot_signing_key` a un `owner = EDGE` et un `edge_gateway_id` (SCH:2295-2308) ; la rotation des clés de la passerelle (déclarée dans `config.snapshot_keys`, deux au plus par signataire, OA:12640) n'est pas traitée par OP-N92 (le central uniquement).
- **OP-N93** (limites des processus de contenu, clés par prestataire en 12b) : la passerelle réutilise la construction de contenu de snapshot ; ses limites héritées (clé d'emballage sans référence, etc.) s'appliquent.
- **OP-N94** (lots et import : vente hors catalogue sans lignes, `config_id` inconnu) : touche le traitement des lots `DEVICE_OFFLINE` relayés par la passerelle (même code, SP:721-723).
- **OP-N96** (`event_device_sync_status_api`) : `SETTLING` attend que chaque terminal soit à jour (SP:555-556) ; vérifier que les terminaux servis par la passerelle sont comptés après le rendu.
- **OP-N99** (câblage de `LEDGER_LOCKED` / `SYNC_DEADLINE_PASSED` non prouvé en intégration) : les mêmes refus doivent être prouvés pour `EDGE_SYNC` (cas 17, SP:851).
- **OP-N95** (corps de plus de 100 ko → 500 au lieu de 413) : un `EdgeSyncBatch` de 1 Mio (`413 BATCH_TOO_LARGE`, OA:7030) est exposé tant que la limite de corps n'est pas relevée sur `/edge/sync-batches` ; à vérifier au plan.
Sans lien direct : OP-N90 (4e `CL007`), OP-N91 (droits), OP-N97 (garde des noms secrets), OP-N98 (fraîcheur 60 s) ; OP-N98 rappelle que la fraîcheur d'un changement ordinaire est 60 s, ce qui borne la fraîcheur du snapshot passerelle (SP:889).
### 5.2 Section Mission 8 de `PROMPTS-A-ENVOYER.md` (lignes 338-363)
- Bloc "Tranché le 05/11" et "Contrat stable" présents (338-352) ; spécifiée ; héritage de la mission 7 : tests §13-4 et §13-5 (362-363). `/spec-kitty.specify` coché ; `plan` non coché (ligne 360).
- Le prompt de plan (ligne 360) dit "Docker absent de la machine de développement actuelle" ; le mémo du poste dit que la base tourne en Docker (colima) : à rapprocher.
- Aucun report des OP-N89 à N99 touchant la passerelle n'est écrit dans la section (OP-N89 cité seulement par M8 C-007 : report à écrire en 12b, `PRD.md` et `PROMPTS-A-ENVOYER.md`).
## 6. Contradictions entre sources (sans trancher)
1. `ReplicationPage` ne porte que portefeuilles et bracelets (OA:14690) alors que SPEC:1035 et OA (16 opérations) exigent sessions, appareils, catalogue : déjà signalée par M8:305.
2. SP:648 ("avant toute vérification, RELEASING") contre SCH:2523 (RELEASE_REQUESTED→COMPLETED permis).
3. `edge_gateway.status` ISOLATED/CATCHING_UP existe (SCH:733 ; SP:706) mais aucune fonction ni route ne les écrit.
4. OA:14420 `required` de `EdgeSyncOperation` sans `edge_decision` alors que la description la dit obligatoire (OA:14466) ; et `chain_hash` à double sens (OA:14128, exemple OA:14550-14623).
5. `OfflineOperationType` : "TOPUP_CASH toujours rejeté" (OA:14115) contre recharge servie par la passerelle (SP:698, M8 FR-015).
6. `cash_session.status` a CLOSING (0036:91), contrat OPEN/CLOSED (OA:14793).
7. OA:11807 `DEBIT_AUTHORITY_MOVING` sans code `CL` ; les autres erreurs de bascule en ont un.
8. SP:889/895 contre NFR-008 : un blocage appliqué en 5 s sur la passerelle n'arrive au terminal qu'après génération de snapshot et battement.
9. PROMPTS:360 (Docker absent du poste) contre le mémo du poste (base en Docker/colima).
## 7. Points à décider (porteur ou plan)
1. Contenu exact de `ReplicationPage` (§2.3) et pagination des types sans `posting.id` ; JWKS d'identité et clés de jeton d'appareil répliquées ou non.
2. Qui écrit ISOLATED/CATCHING_UP ; expiration éventuelle de GRANTED ; contrôle de `operations_count`.
3. Définition de `content_sha256` côté passerelle (opération complète, avec ou sans `edge_decision`) et vecteurs ; hachage d'une activation et d'une caution ; sens de `chain_hash` dans `EdgeSyncOperation`.
4. Fermeture d'une session de caisse au central avec recharges de passerelle non rejouées (§3.5) : comportement hors `/edge/*`, soumettre au porteur (C-002).
5. Activation ou caution faite sur la passerelle puis passerelle perdue avant rejeu (§3.4) : anomalie ou accepté ?
6. Horloge de référence de la passerelle (heure servie aux terminaux, correction à deux sources) et NTP.
7. `tap_id` : locaux à la passerelle ou répliqués.
8. Seuils NFR-005 (échantillon), NFR-007 (réveil immédiat du long-polling), NFR-008 (périmètre).
9. Techniques d'essai : proxy TCP et points d'arrêt, à vérifier contre `docs/08-pile-logicielle.md`.
