# Contrat : paiement par QR

Exigences : FR-018 à FR-020, NFR-005, NFR-008. SPECIFICATION §8.3, ADR-64. Décision de plan : côté festivalier derrière
le port d'identité du festivalier (`DM-01M5HPJ4C0DQYEZCB49FTPE3D4`). Passe contradictoire : A3, A10, A17, A24, A25.

Fonctions de la base (SECURITY DEFINER) ; `cashless_app` perd `INSERT` et `UPDATE` directs sur `payment_request`.
Le moteur d'écritures (TypeScript) écrit la vente **entre** une fonction qui verrouille et contrôle et une fonction
qui confirme (A10).

## Jetons

- QR commerçant : 128 bits aléatoires (base64url) ; QR client : 12 caractères base32 (60 bits). Seul le SHA-256 est
  gardé (`nonce_hash`). Durée : 60 s (bornes du contrat : 15 à 300 s pour le commerçant).
- Les deux routes qui rendent un jeton (`createPaymentRequest`, `createCustomerQrToken`) sont `@Idempotent` avec
  `transient: true` (A3) : aucune réponse enregistrée dans `api_idempotency` ; un renvoi de la même clé reçoit `409`
  et le terminal ou l'app crée une nouvelle demande.
- Aucun jeton dans la base, les journaux (champs masqués), l'audit ni le registre d'idempotence (test de recherche
  des secrets étendu à `api_idempotency` et `audit_log`).

## QR commerçant (`MERCHANT_QR`)

1. **Terminal** `POST /payment-requests` (trois preuves, clé `<serial>:<seq>` enregistrée par `record_device_seq`,
   `vendor_session_id`) : ordre global des verrous ; lignes contrôlées comme une vente (sans écriture) ;
   `create_merchant_payment_request(device, vendor_session, amount, currency, ttl, nonce_hash, idempotency_key, lines,
   catalog_version)`. Réponse : jeton une fois, `qr_payload`, expiration.
2. **Festivalier** `POST /payment-requests/{id}/pay` (`CustomerAuth`) `{token, wallet_id}` :
   - `lock_payment_request_for_pay(id, nonce_hash, wallet, customer)` : lit sans verrou le terminal et la session de la
     demande, puis verrouille dans l'ordre global (terminal `FOR SHARE`, vendeur et session `FOR SHARE`, demande
     `FOR UPDATE`, portefeuille `FOR SHARE`) et contrôle : demande `PENDING`, non expirée
     (heure de la base), même jeton ; portefeuille du festivalier, `ACTIVE` (`FOR SHARE`), du même événement ; terminal
     de la demande `ACTIVE` ; session de vendeur de la demande encore ouverte et non expirée. Rend ce qu'il faut pour
     écrire la vente.
   - moteur : `PURCHASE`, clé de la demande, lignes ;
   - `confirm_payment_request(id, tx)` : la demande est celle verrouillée par cette transaction ; `tx` est une
     `PURCHASE` du montant, du portefeuille, du terminal et de la clé de la demande ; statut `CONFIRMED`,
     `transaction_id` posé ; attribution par la session de la demande (`channel MERCHANT_QR`).
   - Toute autre issue : `409 PAYMENT_REQUEST_NOT_PENDING`, même réponse pour inconnue, payée, annulée, expirée ou
     mauvais jeton.
3. **Annulation** `POST /payment-requests/{id}/cancel` : terminal d'origine (garde exclusive) ; festivalier seulement
   avec le jeton (A10). `PENDING` → `CANCELLED`.
4. **Consultation** `GET /payment-requests/{id}` (`?wait` 0 à 25 s) : terminal d'origine ; festivalier avec le jeton
   (montant et commerçant avant confirmation, A24).

## QR client (`CUSTOMER_QR`)

1. **Festivalier** `POST /me/customer-qr-tokens` (`CustomerAuth`, `transient`) `{wallet_id}` :
   `create_customer_qr_token(customer, wallet, nonce_hash)` ; l'événement écrit est celui du grand livre du portefeuille
   (A25 ; un portefeuille couvre un grand livre, donc un événement) ; montant nul.
2. **Terminal** `POST /payments` avec `customer_qr_token` : dans la transaction de la vente,
   `lock_customer_qr_token(nonce_hash, device)` (demande `FOR UPDATE`, `CUSTOMER_QR`, `PENDING`, non expirée, même
   événement que le terminal, portefeuille `ACTIVE`) rend le portefeuille ; moteur ; `confirm_payment_request(id, tx)`.
   Sinon `409 PAYMENT_REQUEST_NOT_PENDING`.

## Règles communes

- Aucun jeton préchargé ; un jeton sert une fois ; iOS : seul moyen de payer ; les deux sens toujours permis.
- Côté festivalier : seul le faux du port existe, refusé en production ; utilisable en production avec la mission 10
  (OP-N43 complété).
