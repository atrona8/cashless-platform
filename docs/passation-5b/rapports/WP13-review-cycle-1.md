---
cycle_number: 1
mission_slug: terminaux-paiement-en-ligne-01M52QB9
reviewer_agent: claude
wp_id: WP13
verdict: APPROUVÉ
---
# Relecture WP13 (Paiement par QR), cycle 1 : APPROUVÉ (deux constats mineurs à consigner)

Base `cashless_wp13r`. Jest sur les 5 suites du lot (payment-requests x2, unit, media-isolation, matrice des preuves) : 44/44.

## Points examinés
1. Jetons : 128 bits `randomBytes` base64url ; QR client 12 car. `octet & 31` (sans biais) ; seule l'empreinte (`qrTokenHash` de WP11) part en base ; 60 s via la base ; usage unique par `FOR UPDATE` + statut. Refus sans oracle : `pay` renvoie un seul 409 `PAYMENT_REQUEST_NOT_PENDING` (CL037) pour inconnue/expirée/annulée/payée/mauvais jeton/portefeuille d'autrui ; GET/cancel du festivalier : 404 unique. Aucun jeton dans les journaux (le journal d'erreur ne porte que code/sqlstate/message), ni dans une réponse hors `qr_payload` / `createCustomerQrToken`. Routes de création `transient`.
2. Service : ordre terminal -> vendeur -> session -> demande -> portefeuille respecté (`lock_payment_request_for_pay`), `record_device_seq` (terminal FOR UPDATE) avant la session ; verrou -> moteur -> `confirm_payment_request` dans une transaction ; refus du moteur annule tout. Course 20 paiements : une vente ; annulation/paiement : une issue. Preuves réelles (tests de concurrence présents).
3. Intercepteur : `'when-device'` ne saute le contrôle `<serial>:<seq>` que si `req.device` est posé, et seul `DeviceOrCallerGuard` le pose, sans repli quand un marqueur de terminal est présent. `deviceSeq: true` inchangé. Mutations : option jamais contrôlée -> 4 échecs ; toujours contrôlée -> 1 échec.
4. Garde exclusive, 404 pour un autre terminal, faux festivalier refusé en production (`customer-routes-production.spec.ts`) : conformes. Mutations (GET sans filtre terminal, cancel sans contrôle de propriété, assertToken retiré, route non `transient`) : chacune fait échouer un test.
5. Écart contrat/prompt : confirmé. `PaymentRequestObject` n'a pas de champ `token`, le jeton n'est que dans `qr_payload` (exemple du contrat idem). Décision de l'implémenteur correcte. Le retrait du 404 de `payPaymentRequest` (+ `generated/openapi.ts`) est cohérent avec FR-020.
6. media-isolation 41 -> 46 : voir constat 1.
7. Vérification hors suite : un festivalier d'un autre prestataire muni de l'id ET du jeton valides obtient GET 404, cancel 404, pay 409 (même tenant : 200). L'isolation tient.

## Constats
1. (mineur, test) `media-isolation.spec.ts` : les cas `getPaymentRequest`, `cancelPaymentRequest` (sans jeton), `payPaymentRequest` (jeton aléatoire, portefeuille inconnu) refusent quel que soit le prestataire : ils passeraient même sans isolation, car la demande de A est amorcée avec un `nonce_hash` aléatoire inconnu. Correction attendue (WP14 ou ajout ici) : amorcer la demande de A avec un jeton connu du test et l'envoyer depuis un festivalier de B (attendu 404/404/409, comme ma sonde ; contrôle témoin du même prestataire = 200). Aucune faille constatée.
2. (mineur, test) Garde `written.replayed` de `pay` (service.ts, « clé déjà utilisée ») : la mutation `if (false)` survit, aucun test ne crée une vente avec la clé de la demande avant le paiement. Ajouter un cas ou consigner.

Défauts antérieurs/hors lot : `humanBearer` au contrat contre `CustomerAuth` (déjà signalé par l'implémenteur). Fusion WP12 (intercepteur, x-process) : reportée à WP14, non reprochée.
Fichiers à faire relire par une personne : `qr-token.ts`, `payment-request.service.ts`.
