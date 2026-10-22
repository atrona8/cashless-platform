# Contrat : paiement par bracelet, annulation, consultation

Exigences : FR-009 à FR-017, FR-025, NFR-001, NFR-005, NFR-006. Sources : SPECIFICATION §7.6 (frontières), §8.1, §8.2,
§9.5, §9.6, §9.8 ; `docs/sync_protocol.md` §3.2 (registre des numéros, prioritaire). Décisions : annulation par le
vendeur de la vente (`DM-01M5HK2NSDD1SSE3KDM4SCAW72`), intervention du `SUPERVISOR` (`DM-01M5HRNBX5CTP7CAKN4JRCY3F9`).
Passe contradictoire : A1, A4, A5, A8, A9, A11, A13, A14, A17 à A19, A27 (research R-11).

## Clé et registre des numéros (A4, A14)

- `Idempotency-Key` = `<serial>:<seq>` ; `<serial>` doit être le `device.serial` du terminal authentifié, sinon
  `422 VALIDATION_FAILED` (aucune écriture).
- Chaque réponse finale (2xx ou 4xx) d'une route de terminal qui porte une telle clé (`createPayment`,
  `reversePayment` depuis un terminal, `createPaymentRequest`, `cancelPaymentRequest` depuis un terminal) est
  enregistrée par `record_device_seq` dans `device_seq_registry`, **en premier** dans la transaction de l'écriture
  (elle prend le terminal `FOR UPDATE`, ordre global). Un refus 4xx est enregistré dans une transaction séparée et
  validée (comme `settleRefusal`), avec son code.
- Refus **non définitifs** du contrat (`409 DEBIT_AUTHORITY_MOVING`, `409 DEBIT_AUTHORITY_EDGE`) : ni réponse
  d'idempotence enregistrée ni numéro consommé ; la clé est relâchée comme sur un 5xx (le terminal rejoue la même clé).
- `X-Authority-Epoch` (A27) : comparé à l'époque d'autorité du grand livre (`STALE_AUTHORITY_EPOCH` existant) sur
  `createPayment` et `reversePayment`.

## Heure de l'opération (A5)

`occurred_at` reçu du terminal est borné à ±120 s de l'heure de la base (§9.6) : au-delà, l'opération est écrite à
l'heure de la base, `metadata.device_occurred_at` garde l'heure reçue et une anomalie `CLOCK_SKEW` est ouverte.

## `POST /payments` (`createPayment`) — terminal, trois preuves

Corps `PaymentRequestBody` + `vendor_session_id`. Moyens : `tap` (lecture embarquée, `nfcOnly`), `tap_id`,
`customer_qr_token` (contracts/qr-payments.md). `payment_intent_id` → `422 DEVICE_MODE_NOT_ALLOWED` (V2).

Une transaction (`@Idempotent`, prestataire tiré du terminal, R-03), verrous dans l'ordre global :

1. `record_device_seq(device, seq, …)` (terminal `FOR UPDATE`).
2. Mode : `TOPUP_DESK` → `422 DEVICE_MODE_NOT_ALLOWED` ; `CATALOG_POS` sans lignes ou `KEYPAD_TPE` avec lignes →
   `422 VALIDATION_FAILED`.
3. `assert_device_active(device)`.
4. `assert_vendor_session(device, vendor_session_id)` → vendeur.
5. Lecture :
   - embarquée : `register_tap` (via `TapService.registerOrRefuse`) ; refus à effets durables : `settleRefusal` ;
   - `tap_id` (A1, A18) : `assert_tap_payable(tap_id, device)` (SECURITY DEFINER) : lecture de ce terminal, non
     consommée, dans `tap_replay_window_seconds` (heure de la base), bracelet `ACTIVE` relu `FOR SHARE` ; sinon
     `422 MEDIA_BLOCKED` ou `409 TAP_UNUSABLE`. `TapService.byId` n'est plus utilisé pour payer.
6. `assert_wallet_payable(wallet)` (A17) : portefeuille `ACTIVE`, `FOR SHARE` ; sinon `422 WALLET_BLOCKED`.
7. Moteur : `PURCHASE`, `source ONLINE`, clé = `Idempotency-Key`, payload `{walletId, participationId, amount}`,
   `deviceId`, `mediaId`, `metadata {vendor_session_id, channel}`.
8. `record_sale_lines(tx, device, lines)` (catalogue) puis `record_sale_attribution(tx, vendor_session_id, channel)`
   (A11) : la base retrouve vendeur et terminal par la session, vérifie `tx.device_id = session.device_id`, le type
   `PURCHASE` et la session ouverte.
9. `consume_tap(tap_id, tx)` (contrôle du terminal de la lecture ajouté dans la fonction remplacée, A18).
10. `201 PaymentResult` (+ vendeur, lignes, canal, solde disponible).

Refus du moteur ou de la base (`INSUFFICIENT_FUNDS` avec le solde, `EVENT_CLOSING`, …) : transaction annulée, passage
non enregistré (§7.6 point 2), numéro enregistré à part avec son refus. Rejeu de la même clé : réponse enregistrée.

## `GET /payments/{transaction_id}` (`getPayment`)

Garde exclusive (A13) : si le mTLS ou l'en-tête `Signature` est présent, le chemin terminal complet est exigé (trois
preuves), sans repli ; sinon, chemin personne seul. Terminal : ses propres ventes. Personne : `ORGANIZER_ADMIN`,
`SUPERVISOR` de l'événement, `MERCHANT_ADMIN` du commerçant, `OPERATOR_ADMIN`. Autre périmètre : `404`.

## `POST /payments/{transaction_id}/reversal` (`reversePayment`)

`assert_reversible(tx, …)` (SECURITY DEFINER) est appelée **sur tous les chemins** (A9) : vente `PURCHASE` du même
prestataire, non annulée, événement de la vente ; l'heure vient de la base (`clock_timestamp()`, jamais reçue).

- **Terminal, vendeur de la vente** (garde exclusive, clé `<serial>:<seq>`, `vendor_session_id`) : même terminal, même
  vendeur (session ouverte), `now() ≤ recorded_at + reversal_window_minutes` (heure **de la base** à l'écriture de la
  vente, A5 ; valeur de l'événement au moment de l'annulation). Sinon `CL036` → `403 REVERSAL_NOT_ALLOWED`.
- **Terminal, avec un `SUPERVISOR`** (A8) : jeton d'approbation sur place dans l'en-tête `X-Approval-Token` seulement
  (le champ `supervisor_pin_proof` du corps est refusé : il rendrait l'empreinte de la requête circulaire). Variante de
  la garde pour un appelant terminal : appelant enregistré = terminal + session de vendeur (colonnes
  `caller_device_id`, `caller_vendor_session_id` de `approval_token_use`, migration), valideur `SUPERVISOR` de
  **l'événement de la vente**, jeton lié à la requête exacte (`act_hash`), usage unique. Lève les contrôles de
  vendeur et de fenêtre, pas ceux de terminal du même événement.
- **Back-office** (personne) : demande d'approbation à deux personnes (action à ajouter, `SALE_REVERSAL`), source
  `BACKOFFICE` (auteur et valideur distincts, contrôlés par la base) ; un `SUPERVISOR` ou `ORGANIZER_ADMIN` de
  l'événement demande, un second approuve.
- Moteur : `REVERSAL`, `reversesId`, lignes miroir ; matrice des statuts respectée (`RECONCILING` : refus hors
  synchronisation, donc pas « à tout moment »).
- Index unique sur `reverses_id` : seconde annulation → contrainte nommée `journal_transaction_reverses_once`
  traduite en `409 ALREADY_REVERSED` (A19 : traduction par le nom de la contrainte, pas sur tout `23505`).
- Attribution de l'annulation : `record_sale_attribution` (vendeur par la session) ou personne auteur.
